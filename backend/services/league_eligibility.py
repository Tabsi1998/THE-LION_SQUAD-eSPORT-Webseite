"""Spielberechtigung in der Liga (docs/LIGA.md, Abschnitt 12, B.3, #2204): die eine Prüfung für Anmeldung, Kaderaufnahme,
Teilnehmerliste und den späteren Check-in.

Der Stand der Spiel-ID bleibt in ``league_roster.status``; hier legen sich die Regeln der Season darüber. Jede Regel gilt nur, wenn
die Season ihr Feld trägt - Seasons von vorher prüfen nichts Neues. Kein Wert eines Titels steht hier.

Datenschutz: Das Geburtsdatum liest nur ``_ages`` und nur hier. Es geht nie in eine Antwort, eine Nachricht oder ein Protokoll -
nach außen kommen ``met``, ``missing`` oder der Stand ``age_not_met``. Keine Meldung nennt, wem eine doppelte Spiel-ID gehört.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass, field
from datetime import date

from models import now_utc
from services import league_roster
from services.dolibarr_policy import club_today
from services.matchday_schedule import LOCAL_TZ

OTHER_TEAM, AGE_MISSING, AGE_NOT_MET_STATE, WAITING = "other_team", "age_missing", "age_not_met", "waiting"
ACTIVE_STATUSES = league_roster.ACTIVE_REGISTRATION_STATUSES
AGE_MET, AGE_NO_DATE = "met", "missing"

OTHER_TEAM_REASON = "Steht in dieser Season noch in einem anderen Co-Team. Die Teamleitung klärt das mit einem Transfer."
AGE_MISSING_REASON = "Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein."
AGE_NOT_MET = "Erfüllt die Altersvorgabe dieser Season nicht."
TRANSFER_NEEDED = "Ein Wechsel geht nur als Transfer: Teams → Co-Team → Transfer beantragen."


class EligibilityError(Exception):
    def __init__(self, detail: str, status_code: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


@dataclass
class EligibilityContext:
    """Was die Prüfung einer Season braucht: der Kader-Kontext, das Altersergebnis und wer in welchem Co-Team steht."""

    roster: league_roster.RosterContext | None
    ages: dict[str, str] = field(default_factory=dict)
    memberships: dict[str, set[str]] = field(default_factory=dict)

    @property
    def season(self) -> dict:
        return (self.roster.season if self.roster else None) or {}


def _rule_min_age(season: dict | None) -> int:
    try:
        return max(0, int((season or {}).get("min_age") or 0))
    except (TypeError, ValueError):
        return 0


def _parse_day(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def age_state(birth_date, minimum: int, today: date) -> str:
    """``met``, ``missing`` oder ``age_not_met`` - der Geburtstag zählt ganz, ein 29. Februar zählt ab dem 1. März."""
    born = _parse_day(birth_date)
    if not born:
        return AGE_NO_DATE
    years = today.year - born.year - (1 if (today.month, today.day) < (born.month, born.day) else 0)
    return AGE_MET if years >= minimum else AGE_NOT_MET_STATE


async def _ages(db, season: dict | None, user_ids: set[str]) -> dict[str, str]:
    minimum = _rule_min_age(season)
    if not minimum or not user_ids:
        return {}
    today = date.fromisoformat(club_today())
    rows = await db.users.find({"id": {"$in": sorted(user_ids)}}, {"_id": 0, "id": 1, "birth_date": 1}).to_list(len(user_ids) + 5)
    found = {row["id"]: age_state(row.get("birth_date"), minimum, today) for row in rows}
    return {user_id: found.get(user_id, AGE_NO_DATE) for user_id in user_ids}


async def season_squads(db, season_id: str) -> dict[str, dict]:
    """Die Co-Teams, die in dieser Season angemeldet sind (auch ausgetreten: Sie stehen in Tabelle und Spielplan) -
    Kennung → Co-Team. Ein Co-Team ohne Anmeldung gehört nicht zur Season."""
    tournaments = await db.tournaments.find({"league_context.season_id": season_id}, {"_id": 0, "id": 1}).to_list(200)
    ids = [row["id"] for row in tournaments if row.get("id")]
    if not ids:
        return {}
    regs = await db.tournament_registrations.find(
        {"tournament_id": {"$in": ids}, "squad_id": {"$exists": True}}, {"_id": 0, "squad_id": 1, "status": 1}
    ).to_list(2000)
    squad_ids = sorted({row["squad_id"] for row in regs if row.get("squad_id")})
    active = {row["squad_id"] for row in regs if row.get("status") in ACTIVE_STATUSES}
    squads = await db.team_squads.find({"id": {"$in": squad_ids}}, {"_id": 0, "id": 1, "member_ids": 1, "name": 1, "team_id": 1, "status": 1}).to_list(len(squad_ids) + 5) if squad_ids else []
    return {row["id"]: {**row, "active_here": row["id"] in active} for row in squads}


async def _memberships(db, season: dict | None) -> dict[str, set[str]]:
    if not (season or {}).get("one_team_per_season") or not (season or {}).get("id"):
        return {}
    out: dict[str, set[str]] = {}
    for squad_id, squad in (await season_squads(db, season["id"])).items():
        if not squad["active_here"] or not league_roster.is_active_squad(squad):
            continue
        for user_id in squad.get("member_ids") or []:
            out.setdefault(user_id, set()).add(squad_id)
    return out


async def context_for_tournament(db, tournament: dict | None, user_ids) -> EligibilityContext | None:
    """Für eine Staffel - ``None`` bei Turnieren ohne Liga-Rahmen."""
    roster = await league_roster.context_for_tournament(db, tournament, user_ids)
    return await _with_rules(db, roster, user_ids) if roster else None


async def context_for_season(db, season: dict, user_ids) -> EligibilityContext | None:
    roster = await league_roster.context_for_season(db, season, user_ids)
    return await _with_rules(db, roster, user_ids) if roster else None


async def _with_rules(db, roster: league_roster.RosterContext, user_ids) -> EligibilityContext:
    wanted = {user_id for user_id in user_ids or [] if user_id}
    return EligibilityContext(roster=roster, ages=await _ages(db, roster.season, wanted),
                              memberships=await _memberships(db, roster.season))


def status(ctx: EligibilityContext | None, user_id: str, squad_id: str | None = None) -> dict:
    """Der Stand einer Person für ein Co-Team. ``state``/``ok``/``reason`` sind das Gesamtergebnis, ``id_state``/``id_ok``/``id_reason``
    der Stand der Spiel-ID allein. ``age``: ``None`` (keine Regel oder nicht erfüllt), ``met`` oder ``missing``. ``until``: Ende der Wartezeit."""
    row = league_roster.status(ctx.roster if ctx else None, user_id, squad_id)
    out = {**row, "id_state": row["state"], "id_ok": row["ok"], "id_reason": row["reason"], "until": None, "age": None}
    if not ctx or row["state"] == league_roster.BANNED:
        return out
    age = ctx.ages.get(user_id)
    out["age"] = age if age in (AGE_MET, AGE_NO_DATE) else None
    if squad_id and ctx.memberships.get(user_id, set()) - {squad_id}:
        return {**out, "state": OTHER_TEAM, "ok": False, "reason": OTHER_TEAM_REASON}
    if age == AGE_NO_DATE:
        return {**out, "state": AGE_MISSING, "ok": False, "reason": AGE_MISSING_REASON}
    if age == AGE_NOT_MET_STATE:
        return {**out, "state": AGE_NOT_MET_STATE, "ok": False, "reason": AGE_NOT_MET}
    until = league_roster.wait_until(ctx.roster, user_id, squad_id)
    if until and now_utc() < until:
        text = until.astimezone(LOCAL_TZ).strftime("%d.%m.%Y, %H:%M")
        return {**out, "state": WAITING, "ok": False, "until": until.isoformat(),
                "reason": f"Neu im Kader: darf ab {text} spielen."}
    return out


def statuses(ctx: EligibilityContext | None, user_ids, squad_id: str | None = None) -> dict[str, dict]:
    return {user_id: status(ctx, user_id, squad_id) for user_id in user_ids or [] if user_id}


def check_participants(rows: dict[str, dict], user_ids, *, minimum: int, roster: set[str], side: str, kept=frozenset()) -> list[str]:
    """Die Liste, wer gespielt hat (oder beim Check-in anwesend ist): mindestens ``minimum``, nach oben offen, jede Person einmal,
    nur aus dem Kader, nur spielberechtigt. ``kept``: wer auf der Liste dieser Seite schon steht, hält keine Korrektur auf.
    Liefert die Liste, wirft ``EligibilityError``."""
    ids = [str(item).strip() for item in user_ids or [] if str(item or "").strip()]
    if len(set(ids)) != len(ids):
        raise EligibilityError(f"Auf der Liste von {side} steht jede Person nur einmal.")
    if len(ids) < minimum:
        raise EligibilityError(f"Bitte für {side} mindestens {minimum} Personen ankreuzen, die gespielt haben.")
    if any(user_id not in roster for user_id in ids):
        raise EligibilityError(f"Auf die Liste von {side} kommt nur, wer im Kader steht.")
    for user_id in ids:
        row = rows.get(user_id)
        if row and not row["ok"] and user_id not in kept:
            raise EligibilityError(f"{row['name']} kann nicht eingetragen werden – {row['reason']}")
    return ids


def public_row(row: dict) -> dict:
    """Was Team-Seite und Kaderübersicht sehen: kein Datum, keine Spiel-ID."""
    return {key: row.get(key) for key in ("id", "name", "state", "ok", "reason", "until", "age")}


def open_window(season: dict | None, today: str | None = None) -> dict | None:
    """Das Transferfenster, das gerade offen ist - ``None``: keines. Kalendertage in Wiener Zeit, beide Enden zählen."""
    day = today or club_today()
    for window in (season or {}).get("transfer_windows") or []:
        if str(window.get("start_date")) <= day <= str(window.get("end_date")):
            return window
    return None


def rules_view(season: dict | None) -> dict:
    """Die Regeln einer Season für die Anzeige - fehlt ein Feld, gibt es die Regel nicht."""
    season = season or {}
    return {
        "min_squad_size": season.get("min_squad_size"),
        "max_squad_size": season.get("max_squad_size"),
        "one_team_per_season": bool(season.get("one_team_per_season")),
        "new_player_wait_days": season.get("new_player_wait_days") or 0,
        "min_age": _rule_min_age(season),
        "roster_deadline": season.get("roster_deadline"),
        "unique_game_ids": bool(season.get("unique_game_ids")),
        "lineup_mode": season.get("lineup_mode") or "per_map",
        "lineup_min_players": season.get("lineup_min_players"),
        "transfer_windows": season.get("transfer_windows") or [],
        "transfer_open": bool(open_window(season)),
    }


async def _candidate_rows(db, season: dict, tournament: dict, squad: dict, team: dict) -> list[dict]:
    """Wer aus dem Hauptteam ins Co-Team kommen könnte - mit dem, was dagegen spricht. Kein Datum, keine ID."""
    members = set(squad.get("member_ids") or [])
    people = [uid for uid in team.get("member_ids") or [] if uid and uid not in members]
    ctx = await context_for_tournament(db, tournament, people)
    if not ctx or not people:
        return []
    others = await _other_squad_ids(db, season, squad["id"], people, ctx.roster.entries) if season.get("one_team_per_season") else {}
    rows = []
    for user_id in people:
        reason = None
        if user_id in others:
            reason = "Steht oder stand in dieser Season in einem anderen Co-Team. Ein Wechsel geht nur als Transfer."
        elif ctx.ages.get(user_id) == AGE_NO_DATE:
            reason = AGE_MISSING_REASON
        elif ctx.ages.get(user_id) == AGE_NOT_MET_STATE:
            reason = AGE_NOT_MET
        rows.append({"id": user_id, "name": league_roster.person_name(ctx.roster.people.get(user_id)), "can_add": reason is None,
                     "needs_transfer": user_id in others, "reason": reason})
    return sorted(rows, key=lambda row: row["name"].lower())


async def squad_view(db, team: dict, squad: dict, *, can_edit: bool, transfers, rules_doc=None) -> dict:
    """Für die Team-Seite: je Season Regeln, Stand der Spieler, mögliche Neuzugänge und Transfers. ``transfers``: liest die Anträge;
    ``rules_doc(db, league, season, squad_id)``: das Regelwerk mit Zustimmungsstand (#2269, ``league_rules.rules_info``) - die Route reicht
    es herein, damit dieses Modul nicht nach oben importiert; ohne es ``None``."""
    seasons = []
    for season, tournament in await open_seasons_of_squad(db, squad.get("id")):
        members = [uid for uid in squad.get("member_ids") or [] if uid]
        ctx = await context_for_tournament(db, tournament, members)
        players = sorted((public_row(row) for row in statuses(ctx, members, squad["id"]).values()), key=lambda row: row["name"].lower())
        league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0}) if rules_doc else None
        seasons.append({
            "season_id": season["id"],
            "title": season.get("name"),
            "rules": {**rules_view(season), "min_squad_size": league_roster.min_squad_size(tournament)},
            # Regelwerk (#2269): gültige Fassung und der Stand der Zustimmung dieses Co-Teams - für die Team-Seite.
            "rules_doc": await rules_doc(db, league, season, squad["id"]) if league else None,
            "players": players,
            "candidates": await _candidate_rows(db, season, tournament, squad, team) if can_edit else [],
            "transfers": await transfers(db, squad["id"], season["id"]),
            "can_edit": can_edit,
        })
    return {"seasons": seasons}


async def season_overview(db, season: dict) -> dict:
    """Die Kaderübersicht (``league_roster.season_overview``) mit Regeln und Stand je Spieler: dieselbe Prüfung wie überall. Das
    Geburtsdatum bleibt im Server, hier steht nur der Stand."""
    overview = await league_roster.season_overview(db, season)
    members = {player["id"] for row in overview["squads"] for player in row["players"]}
    ctx = await context_for_season(db, season, members)
    waiting = age = 0
    for row in overview["squads"]:
        for player in row["players"]:
            player["eligibility"] = public_row(status(ctx, player["id"], row.get("squad_id")))
            waiting += 1 if player["eligibility"]["state"] == WAITING else 0
            age += 1 if player["eligibility"]["state"] in (AGE_MISSING, AGE_NOT_MET_STATE) else 0
    overview["counts"].update({"waiting": waiting, "age": age})
    overview["rules"] = rules_view(season)
    return overview


async def my_status(db, user: dict) -> list[dict]:
    """Der eigene Stand je Season, in der die Person gerade in einem Co-Team steht. Ohne Datum."""
    user_id = user["id"]
    squads = await db.team_squads.find({"member_ids": user_id, "status": {"$ne": "archived"}}, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    items = []
    for squad in squads:
        for season, tournament in await open_seasons_of_squad(db, squad["id"]):
            ctx = await context_for_tournament(db, tournament, [user_id])
            league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "name": 1}) or {}
            row = status(ctx, user_id, squad["id"])
            items.append({"season_id": season["id"], "title": " · ".join(part for part in (league.get("name"), season.get("name")) if part),
                          "squad_id": squad["id"], "squad_name": squad.get("name"), "min_age": _rule_min_age(season),
                          **{key: row.get(key) for key in ("state", "ok", "reason", "until", "age")}})
    return items


# ---------------------------------------------------------------- Kader und Anmeldung


async def open_seasons_of_squad(db, squad_id: str | None) -> list[tuple[dict, dict]]:
    """Die Seasons (mit einer ihrer Staffeln), in denen dieses Co-Team gerade in einer nicht beendeten Staffel steht."""
    if not squad_id:
        return []
    out: dict[str, tuple[dict, dict]] = {}
    for reg in await league_roster.active_league_registrations(db, squad_id):
        season_id = (reg.get("league_context") or {}).get("season_id")
        if not season_id or season_id in out:
            continue
        season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
        tournament = await db.tournaments.find_one({"id": reg.get("tournament_id")}, {"_id": 0})
        if season and tournament:
            out[season_id] = (season, tournament)
    return list(out.values())


def locks_squad_changes(season: dict | None) -> bool:
    """Braucht eine Kaderänderung die Season-Sperre? Nur mit Regeln, die über Co-Teams hinweg oder auf die Größe zählen."""
    return bool((season or {}).get("one_team_per_season") or (season or {}).get("max_squad_size"))


@contextlib.asynccontextmanager
async def squad_change_lock(db, seasons: list[dict]):
    """Dieselbe Sperre wie beim Zuteilen (``league_season:<id>:squads``), je Season in fester Reihenfolge - so landet eine
    Person auch bei gleichzeitigen Aufnahmen nur in einem Co-Team. Seasons ohne diese Regeln sperren nichts."""
    from services.mutation_lock import league_season_resource, mutation_lock

    held = []
    try:
        for season_id in sorted(row["id"] for row in seasons if locks_squad_changes(row)):
            lock = mutation_lock(db, league_season_resource(season_id))
            await lock.__aenter__()
            held.append(lock)
        yield
    finally:
        for lock in reversed(held):
            await lock.__aexit__(None, None, None)


def _names(db_people: dict[str, dict], user_ids) -> dict[str, str]:
    return {user_id: league_roster.person_name(db_people.get(user_id)) for user_id in user_ids}


def _too_many(season: dict, size: int) -> str | None:
    most = season.get("max_squad_size")
    if most and size > int(most):
        return f"Der Kader darf in dieser Season höchstens {int(most)} Spieler haben, geplant sind {size}. Bitte erst jemanden herausnehmen."
    return None


async def _other_squad_ids(db, season: dict, squad_id: str, user_ids, entries: dict[str, dict]) -> dict[str, set[str]]:
    """Wer in dieser Season schon in einem anderen angemeldeten Co-Team steht oder stand."""
    squads = await season_squads(db, season["id"])
    out: dict[str, set[str]] = {}
    for user_id in user_ids:
        others = {sid for sid, squad in squads.items() if sid != squad_id and user_id in (squad.get("member_ids") or [])}
        others |= {sid for sid in (entries.get(user_id) or {}).get("squad_ids") or [] if sid != squad_id and sid in squads}
        if others:
            out[user_id] = others
    return out


async def roster_addition_problem(db, season: dict, tournament: dict, squad_id: str, added: list[str], size_after: int,
                                  *, transfer: bool = False) -> tuple[int, str] | None:
    """Darf diese Person jetzt in den Kader? Der erste Grund dagegen als ``(Statuscode, Satz)``. Eine fehlende Spiel-ID ist kein
    Grund: Die Person steht dann im Kader und kann noch nicht spielen. ``transfer``: Der Wechsel selbst ist genehmigt."""
    problem = _too_many(season, size_after)
    if problem:
        return 422, problem
    ctx = await context_for_tournament(db, tournament, added)
    if not ctx:
        return None
    names = _names(ctx.roster.people, added)
    if season.get("one_team_per_season") and not transfer:
        others = await _other_squad_ids(db, season, squad_id, added, ctx.roster.entries)
        for user_id in added:
            if user_id in others:
                return 409, f"{names[user_id]} steht oder stand in dieser Season schon in einem anderen Co-Team. {TRANSFER_NEEDED}"
    for user_id in added:
        if ctx.ages.get(user_id) == AGE_NO_DATE:
            return 422, (f"{names[user_id]}: Geburtsdatum fehlt. Die Season verlangt eine Altersangabe. {names[user_id]} trägt "
                         "es im eigenen Profil ein, dann geht die Aufnahme.")
        if ctx.ages.get(user_id) == AGE_NOT_MET_STATE:
            return 422, f"{names[user_id]} erfüllt die Altersvorgabe dieser Season nicht."
    return None


async def check_roster_addition(db, seasons: list[tuple[dict, dict]], squad_id: str, added: list[str], size_after: int) -> None:
    """Die Prüfung bei der Aufnahme in ein Co-Team - für jede Season, in der es gerade spielt (``open_seasons_of_squad``). Wirft
    ``EligibilityError``."""
    if not added:
        return
    for season, tournament in seasons:
        problem = await roster_addition_problem(db, season, tournament, squad_id, added, size_after)
        if problem:
            raise EligibilityError(problem[1], problem[0])


async def waive_wait(db, season: dict, user_id: str, squad_id: str | None, reason: str | None, actor: dict) -> dict:
    """Die Liga-Leitung hebt die Wartezeit einer Person in einem Co-Team auf - nur mit Grund, Protokoll ``league.roster.wait_waive``."""
    from models import new_id

    text = (reason or "").strip()
    if len(text) < league_roster.REASON_MIN_LENGTH:
        raise EligibilityError(f"Bitte einen Grund angeben (mindestens {league_roster.REASON_MIN_LENGTH} Zeichen). Er steht im Protokoll.")
    ctx = await context_for_season(db, season, [user_id])
    row = status(ctx, user_id, squad_id)
    if row["state"] != WAITING:
        raise EligibilityError("Für diese Person läuft in diesem Co-Team keine Wartezeit.", 409)
    now = now_utc().isoformat()
    waiver = {"squad_id": squad_id, "at": now, "by": actor.get("id"), "reason": text}
    await db.league_rosters.update_one({"season_id": season["id"], "user_id": user_id},
                                       {"$push": {"wait_waivers": waiver}, "$set": {"updated_at": now}})
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "league.roster.wait_waive", "target_id": season["id"], "actor_id": actor.get("id"),
        "data": {"season_id": season["id"], "user_id": user_id, "squad_id": squad_id, "reason": text},
        "created_at": now,
    })
    return status(await context_for_season(db, season, [user_id]), user_id, squad_id)


def registration_problems(ctx: EligibilityContext | None, squad: dict) -> list[tuple[int, str]]:
    """Für die Anmeldung eines Co-Teams: was an seinem Kader gegen die Season spricht. Der Kontext enthält alle Mitglieder.
    Fehlende Spiel-IDs bleiben ein Hinweis (#2108), die Leitung kann trotzdem zuteilen."""
    if not ctx:
        return []
    season = ctx.season
    members = [uid for uid in squad.get("member_ids") or [] if uid]
    name = squad.get("name") or "Das Co-Team"
    problems: list[tuple[int, str]] = []
    too_many = _too_many(season, len(members))
    if too_many:
        problems.append((400, f"{name}: {too_many}"))
    people = ctx.roster.people if ctx.roster else {}
    names = _names(people, members)
    doubled = [uid for uid in members if ctx.memberships.get(uid, set()) - {squad.get("id")}]
    if doubled:
        problems.append((409, f"{name}: {', '.join(names[uid] for uid in doubled)} {'steht' if len(doubled) == 1 else 'stehen'} in dieser "
                              "Season schon in einem anderen Co-Team."))
    no_date = [uid for uid in members if ctx.ages.get(uid) == AGE_NO_DATE]
    if no_date:
        problems.append((400, f"{name}: Geburtsdatum fehlt bei {', '.join(names[uid] for uid in no_date)}. Bitte im eigenen Profil eintragen, "
                              "dann geht die Anmeldung."))
    too_young = [uid for uid in members if ctx.ages.get(uid) == AGE_NOT_MET_STATE]
    if too_young:
        problems.append((400, f"{name}: {', '.join(names[uid] for uid in too_young)} {'erfüllt' if len(too_young) == 1 else 'erfüllen'} die "
                              "Altersvorgabe dieser Season nicht."))
    return problems
