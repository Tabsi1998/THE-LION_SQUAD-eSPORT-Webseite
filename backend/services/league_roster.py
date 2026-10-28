"""Liga-Kader: die Spiel-ID je Season und Spieler (docs/LIGA.md, Abschnitt 2 „Liga-Kader“; #2108).

Wer in einer Liga spielt, braucht die Pflicht-IDs des Spiels aus dem Profil, etwa die Activision-ID. Die ID des
Hauptspiels gilt für seine Versionen - genau wie im Profil und bei der Turnieranmeldung
(``tournament_common._enrich_game_identity``, ``_required_game_fields``, ``_profile_player_ids``).

``league_rosters`` hält je Season und Spieler fest, welche ID in der Liga gilt:

- **Zuteilen** eines Co-Teams: ein Eintrag für jedes Mitglied. Mit vollständiger ID wird sie festgehalten, ohne ID
  steht der Eintrag leer - der Spieler ist nicht aufstellbar, bis die ID im Profil steht.
- **Aufnahme** in ein zugeteiltes Co-Team während der Season: ebenso; nach dem Stichtag der Season
  (``league_seasons.roster_deadline``, Vorgabe: keiner) nur mit Freigabe der Liga-Leitung.
- **Erstes Aufstellen**: wer die ID erst später eingetragen hat, bekommt sie spätestens hier festgehalten.

Danach gilt die festgehaltene ID die ganze Season, auch wenn das Profil sich ändert. Eine neue ID gilt erst nach der
**Freigabe** durch die Liga-Leitung (Grund, Protokoll in ``approvals`` und ``audit_logs``). Spiele ohne Pflicht-IDs
berühren nichts davon - dort ist jeder aufstellbar.

Die IDs sehen nur die Person selbst, die Beteiligten eines Spiels und die Turnierleitung (wie Aufstellungen).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc

FREE, LOCKED, PENDING, MISSING, LATE = "free", "locked", "pending", "missing", "late"
CLOSED_SEASON_STATUSES = {"completed", "archived"}
FINISHED_TOURNAMENT_STATUSES = {"completed", "results_published", "archived", "cancelled"}
ACTIVE_REGISTRATION_STATUSES = ("pending", "approved", "checked_in", "waitlist")
REASON_MIN_LENGTH = 5
LATE_REASON = "Nach dem Stichtag ins Co-Team gekommen – die Liga-Leitung muss die Spiel-ID erst freigeben."
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PEOPLE_FIELDS = {"_id": 0, "id": 1, "display_name": 1, "username": 1, "game_ids": 1}


class LeagueRosterError(Exception):
    def __init__(self, detail: str, status_code: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


@dataclass
class RosterContext:
    """Was die Prüfung einer Season braucht: Spiel, Pflicht-IDs, Einträge und Profile der genannten Personen."""

    season_id: str
    league_id: str | None
    season: dict | None
    game: dict | None
    fields: list[dict]
    entries: dict[str, dict] = field(default_factory=dict)
    people: dict[str, dict] = field(default_factory=dict)

    @property
    def deadline(self) -> str | None:
        value = str((self.season or {}).get("roster_deadline") or "")
        return value if DAY.match(value) else None

    def deadline_passed(self) -> bool:
        from services.dolibarr_policy import club_today

        return bool(self.deadline) and club_today() > self.deadline


# ---------------------------------------------------------------- Laden


async def _game(db, game_id: str | None) -> dict | None:
    from routes.tournament_common import _enrich_game_identity

    if not game_id:
        return None
    game = await db.games.find_one({"id": game_id}, {"_id": 0})
    return await _enrich_game_identity(db, game)


def required_fields(game: dict | None) -> list[dict]:
    from routes.tournament_common import _required_game_fields

    return _required_game_fields(game)


async def _context(db, *, season_id: str | None, league_id: str | None, season: dict | None, game_id: str | None,
                   user_ids) -> RosterContext | None:
    if not season_id:
        return None
    game = await _game(db, game_id)
    ids = sorted({user_id for user_id in user_ids or [] if user_id})
    ctx = RosterContext(season_id=season_id, league_id=league_id, season=season, game=game,
                        fields=required_fields(game))
    if ids:
        ctx.entries = {
            row["user_id"]: row
            for row in await db.league_rosters.find(
                {"season_id": season_id, "user_id": {"$in": ids}}, {"_id": 0}
            ).to_list(len(ids) + 10)
        }
        ctx.people = {
            row["id"]: row for row in await db.users.find({"id": {"$in": ids}}, PEOPLE_FIELDS).to_list(len(ids) + 10)
        }
    return ctx


async def context_for_tournament(db, tournament: dict | None, user_ids) -> RosterContext | None:
    """Für eine Staffel (Turnier mit ``league_context``) - das Spiel der Staffel, der Stichtag aus der Season."""
    context = (tournament or {}).get("league_context") or {}
    season_id = context.get("season_id")
    if not season_id:
        return None
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    return await _context(db, season_id=season_id, league_id=context.get("league_id"), season=season,
                          game_id=tournament.get("game_id"), user_ids=user_ids)


async def context_for_season(db, season: dict, user_ids) -> RosterContext | None:
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "game_id": 1}) or {}
    return await _context(db, season_id=season.get("id"), league_id=season.get("league_id"), season=season,
                          game_id=league.get("game_id"), user_ids=user_ids)


# ---------------------------------------------------------------- Stand je Person


def picked(fields: list[dict], ids: dict | None) -> dict[str, str]:
    """Nur die Pflicht-IDs, als getrimmter Text."""
    return {item["key"]: str((ids or {}).get(item["key"]) or "").strip() for item in fields}


def complete(values: dict[str, str]) -> bool:
    return bool(values) and all(values.values())


def id_text(fields: list[dict], values: dict | None) -> str | None:
    """„Testloewe#1234567“ - bei mehreren Pflicht-IDs „Activision-ID: … · Plattform: …“."""
    rows = [(item.get("label") or item["key"], str((values or {}).get(item["key"]) or "").strip()) for item in fields]
    if len(rows) == 1:
        return rows[0][1] or None
    return " · ".join(f"{label}: {value}" for label, value in rows if value) or None


def labels(fields: list[dict]) -> str:
    return ", ".join(item.get("label") or item["key"] for item in fields)


def person_name(person: dict | None) -> str:
    return (person or {}).get("display_name") or (person or {}).get("username") or "Spieler"


def status(ctx: RosterContext | None, user_id: str) -> dict:
    """Der Stand einer Person in der Season.

    ``state``: ``free`` (Spiel ohne Pflicht-ID), ``locked`` (ID festgehalten), ``pending`` (ID im Profil, wird beim
    ersten Aufstellen festgehalten), ``missing`` (ID fehlt im Profil), ``late`` (nach dem Stichtag dazugekommen,
    wartet auf Freigabe). ``ok``: aufstellbar. ``text``: die ID, die in der Liga gilt bzw. gelten wird.
    ``changed``: das Profil nennt inzwischen eine andere ID als die festgehaltene."""
    person = (ctx.people.get(user_id) if ctx else None) or {}
    base = {"id": user_id, "name": person_name(person), "state": FREE, "ok": True, "text": None,
            "profile_text": None, "changed": False, "reason": None, "locked_at": None}
    if not ctx or not ctx.fields:
        return base
    from routes.tournament_common import _profile_player_ids

    profile = picked(ctx.fields, _profile_player_ids(person, ctx.game))
    base["profile_text"] = id_text(ctx.fields, profile) if complete(profile) else None
    entry = ctx.entries.get(user_id)
    locked = picked(ctx.fields, (entry or {}).get("player_ids"))
    if entry and complete(locked):
        return {**base, "state": LOCKED, "text": id_text(ctx.fields, locked), "changed": locked != profile,
                "locked_at": entry.get("locked_at")}
    # Ohne Eintrag (etwa zugeteilt, bevor es den Kader gab) zählt wie beim Zuteilen das Profil - „nach dem Stichtag“
    # weiß nur ein Eintrag aus der Aufnahme ins Co-Team.
    if entry and entry.get("late"):
        return {**base, "state": LATE, "ok": False, "reason": LATE_REASON}
    if complete(profile):
        return {**base, "state": PENDING, "text": base["profile_text"]}
    return {**base, "state": MISSING, "ok": False, "reason": f"{labels(ctx.fields)} fehlt im Profil."}


def statuses(ctx: RosterContext | None, user_ids) -> dict[str, dict]:
    return {user_id: status(ctx, user_id) for user_id in user_ids or [] if user_id}


# ---------------------------------------------------------------- Festhalten


def _new_entry(ctx: RosterContext, user_id: str, *, via: str, actor_id: str | None, now: str, late: bool) -> dict:
    return {
        "id": new_id(),
        "season_id": ctx.season_id,
        "league_id": ctx.league_id,
        "user_id": user_id,
        "game_id": (ctx.game or {}).get("id"),
        "added_at": now,
        "added_via": via,
        "added_by": actor_id,
        "created_at": now,
        "late": late,
    }


async def _lock(db, ctx: RosterContext, user_id: str, values: dict[str, str], *, via: str, actor_id: str | None,
                approval: dict | None = None) -> None:
    now = now_utc().isoformat()
    entry = _new_entry(ctx, user_id, via=via, actor_id=actor_id, now=now, late=False)
    entry.pop("late")
    update = {
        "$set": {"player_ids": values, "id_text": id_text(ctx.fields, values), "locked_at": now, "locked_via": via,
                 "locked_by": actor_id, "late": False, "updated_at": now},
        "$setOnInsert": entry,
    }
    if approval:
        update["$push"] = {"approvals": approval}
    try:
        await db.league_rosters.update_one({"season_id": ctx.season_id, "user_id": user_id}, update, upsert=True)
    except DuplicateKeyError:
        update.pop("$setOnInsert")
        await db.league_rosters.update_one({"season_id": ctx.season_id, "user_id": user_id}, update)


async def _add_empty(db, ctx: RosterContext, user_id: str, *, via: str, actor_id: str | None, late: bool) -> None:
    now = now_utc().isoformat()
    entry = {**_new_entry(ctx, user_id, via=via, actor_id=actor_id, now=now, late=late), "player_ids": {},
             "id_text": None, "locked_at": None, "updated_at": now}
    try:
        await db.league_rosters.update_one({"season_id": ctx.season_id, "user_id": user_id},
                                           {"$setOnInsert": entry}, upsert=True)
    except DuplicateKeyError:
        pass


async def record_members(db, ctx: RosterContext | None, user_ids, *, via: str, actor_id: str | None,
                         late: bool = False) -> dict[str, dict]:
    """Mitglieder eines Co-Teams in den Kader der Season aufnehmen (Zuteilen, Aufnahme ins Co-Team). Wer schon einen
    Eintrag hat, behält ihn; ein leerer bekommt die ID, sobald sie im Profil steht (nicht bei ``late``). Liefert den
    Stand danach je Person."""
    if not ctx:
        return {}
    if not ctx.fields:
        return statuses(ctx, user_ids)
    from routes.tournament_common import _profile_player_ids

    wanted = sorted({uid for uid in user_ids or [] if uid})
    for user_id in wanted:
        entry = ctx.entries.get(user_id)
        if complete(picked(ctx.fields, (entry or {}).get("player_ids"))):
            continue
        values = picked(ctx.fields, _profile_player_ids(ctx.people.get(user_id), ctx.game))
        if (entry or {}).get("late") or (not entry and late) or not complete(values):
            if not entry:
                await _add_empty(db, ctx, user_id, via=via, actor_id=actor_id, late=late)
            continue
        await _lock(db, ctx, user_id, values, via=via, actor_id=actor_id)
    ctx.entries.update({
        row["user_id"]: row
        for row in await db.league_rosters.find(
            {"season_id": ctx.season_id, "user_id": {"$in": wanted}}, {"_id": 0}
        ).to_list(len(wanted) + 10)
    })
    return statuses(ctx, wanted)


async def lock_lineup(db, ctx: RosterContext | None, user_ids, actor_id: str | None) -> None:
    """Beim Aufstellen: wer die ID erst nach dem Zuteilen eingetragen hat, bekommt sie jetzt festgehalten."""
    if not ctx or not ctx.fields:
        return
    from routes.tournament_common import _profile_player_ids

    for user_id in sorted({uid for uid in user_ids or [] if uid}):
        if status(ctx, user_id)["state"] != PENDING:
            continue
        values = picked(ctx.fields, _profile_player_ids(ctx.people.get(user_id), ctx.game))
        await _lock(db, ctx, user_id, values, via="lineup", actor_id=actor_id)
        ctx.entries[user_id] = {**(ctx.entries.get(user_id) or {}), "player_ids": values, "locked_at": now_utc().isoformat()}


async def after_assign(db, tournament: dict, registration: dict, squad: dict, actor_id: str | None) -> dict[str, dict]:
    """Nach dem Zuteilen eines Co-Teams: alle Mitglieder in den Kader der Season; wem die ID fehlt, der und die
    Verantwortlichen des Co-Teams bekommen einen Hinweis."""
    members = [uid for uid in squad.get("member_ids") or [] if uid]
    ctx = await context_for_tournament(db, tournament, members)
    found = await record_members(db, ctx, members, via="assign", actor_id=actor_id)
    missing = [row for row in found.values() if not row["ok"]]
    if missing and ctx:
        await _tell_missing(db, ctx, tournament, registration, missing)
    return found


async def _tell_missing(db, ctx: RosterContext, tournament: dict, registration: dict, missing: list[dict]) -> None:
    from services.match_audience import responsible_user_ids
    from services.user_notifications import create_user_notification

    title = tournament.get("title") or "Liga"
    what = labels(ctx.fields)
    for row in missing:
        await create_user_notification(
            row["id"],
            "Spiel-ID für die Liga fehlt",
            f"{title}: Trag deine {what} im Profil ein – ohne sie kannst du in der Liga nicht aufgestellt werden.",
            url="/profile?tab=gaming",
            kind="tournament_registration",
            meta={"tournament_id": tournament.get("id"), "reason": "league_id_missing",
                  "dedupe_key": f"league-id-missing:{ctx.season_id}:{row['id']}"},
        )
    names = ", ".join(row["name"] for row in missing)
    verb = "fehlt" if len(missing) == 1 else "fehlen"
    for user_id in await responsible_user_ids(db, [registration]):
        await create_user_notification(
            user_id,
            "Spiel-IDs im Co-Team fehlen",
            f"{registration.get('display_name') or title}: {names} {verb} die {what} – aufgestellt werden kann erst, "
            "wer sie im Profil eingetragen hat.",
            url=f"/tournaments/{tournament.get('slug') or tournament.get('id')}",
            kind="tournament_registration",
            meta={"tournament_id": tournament.get("id"), "reason": "league_id_missing_team",
                  "dedupe_key": f"league-id-missing-team:{registration.get('id')}:{user_id}"},
        )


async def on_squad_members_added(db, squad: dict, user_ids, actor_id: str | None) -> None:
    """Neue Mitglieder eines Co-Teams, das in einer laufenden Staffel spielt: in den Kader der Season - nach dem
    Stichtag der Season nur als „wartet auf Freigabe“."""
    added = [uid for uid in user_ids or [] if uid]
    if not added or not squad.get("id"):
        return
    regs = await db.tournament_registrations.find(
        {"squad_id": squad["id"], "status": {"$in": list(ACTIVE_REGISTRATION_STATUSES)}},
        {"_id": 0, "tournament_id": 1},
    ).to_list(50)
    tournament_ids = sorted({reg["tournament_id"] for reg in regs if reg.get("tournament_id")})
    if not tournament_ids:
        return
    seen: set[str] = set()
    for tournament in await db.tournaments.find(
        {"id": {"$in": tournament_ids}, "league_context": {"$type": "object"}}, {"_id": 0}
    ).to_list(len(tournament_ids) + 5):
        season_id = (tournament.get("league_context") or {}).get("season_id")
        if not season_id or season_id in seen or tournament.get("status") in FINISHED_TOURNAMENT_STATUSES:
            continue
        seen.add(season_id)
        ctx = await context_for_tournament(db, tournament, added)
        if not ctx or (ctx.season or {}).get("status") in CLOSED_SEASON_STATUSES:
            continue
        await record_members(db, ctx, added, via="squad_join", actor_id=actor_id, late=ctx.deadline_passed())


# ---------------------------------------------------------------- Liga-Leitung


async def approve(db, season: dict, user_id: str, reason: str | None, actor: dict) -> dict:
    """Die Liga-Leitung gibt die aktuelle ID aus dem Profil frei - mit Grund; danach gilt sie in der Season."""
    text = (reason or "").strip()
    if len(text) < REASON_MIN_LENGTH:
        raise LeagueRosterError(f"Bitte einen Grund angeben (mindestens {REASON_MIN_LENGTH} Zeichen).")
    if user_id not in await season_member_ids(db, season["id"]) and not await db.league_rosters.find_one(
        {"season_id": season["id"], "user_id": user_id}, {"_id": 0, "id": 1}
    ):
        raise LeagueRosterError("Diese Person spielt in keinem Co-Team dieser Season.", 404)
    ctx = await context_for_season(db, season, [user_id])
    if not ctx or not ctx.fields:
        raise LeagueRosterError("Für das Spiel dieser Liga gibt es keine Pflicht-ID.", 409)
    from routes.tournament_common import _profile_player_ids

    before = status(ctx, user_id)
    values = picked(ctx.fields, _profile_player_ids(ctx.people.get(user_id), ctx.game))
    if not complete(values):
        raise LeagueRosterError(f"Im Profil fehlt noch: {labels(ctx.fields)} – erst eintragen, dann freigeben.")
    if before["state"] == LOCKED and not before["changed"]:
        raise LeagueRosterError("Diese ID gilt in der Season schon.", 409)
    now = now_utc().isoformat()
    approval = {"at": now, "by": actor.get("id"), "reason": text, "old_text": before["text"] if before["state"] == LOCKED else None,
                "new_text": id_text(ctx.fields, values), "was": before["state"]}
    await _lock(db, ctx, user_id, values, via="approval", actor_id=actor.get("id"), approval=approval)
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "league.roster.approve",
        "target_id": season["id"],
        "actor_id": actor.get("id"),
        "data": {"season_id": season["id"], "user_id": user_id, "reason": text, "was": before["state"]},
        "created_at": now,
    })
    fresh = await context_for_season(db, season, [user_id])
    return status(fresh, user_id)


async def set_deadline(db, season: dict, value: str | None, actor: dict) -> dict:
    """Stichtag für neue Spieler (Wiener Kalendertag) setzen oder entfernen."""
    day = str(value or "").strip() or None
    if day and not DAY.match(day):
        raise LeagueRosterError("Bitte den Stichtag als Datum angeben.")
    if day == season.get("roster_deadline"):
        return {"roster_deadline": day, "changed": False}
    now = now_utc().isoformat()
    change = {"$set": {"roster_deadline": day, "updated_at": now}} if day else {
        "$unset": {"roster_deadline": ""}, "$set": {"updated_at": now}}
    await db.league_seasons.update_one({"id": season["id"]}, change)
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "league.season.roster_deadline",
        "target_id": season["id"],
        "actor_id": actor.get("id"),
        "data": {"season_id": season["id"], "roster_deadline": day, "before": season.get("roster_deadline")},
        "created_at": now,
    })
    return {"roster_deadline": day, "changed": True}


async def _season_registrations(db, season_id: str) -> tuple[list[dict], list[dict]]:
    tournaments = await db.tournaments.find(
        {"league_context.season_id": season_id},
        {"_id": 0, "id": 1, "title": 1, "slug": 1, "status": 1, "league_context": 1},
    ).to_list(200)
    ids = [row["id"] for row in tournaments if row.get("id")]
    regs = await db.tournament_registrations.find(
        {"tournament_id": {"$in": ids}, "squad_id": {"$exists": True},
         "status": {"$in": list(ACTIVE_REGISTRATION_STATUSES)}},
        {"_id": 0, "id": 1, "tournament_id": 1, "team_id": 1, "squad_id": 1, "display_name": 1, "status": 1},
    ).to_list(2000) if ids else []
    return tournaments, regs


async def season_member_ids(db, season_id: str) -> set[str]:
    _tournaments, regs = await _season_registrations(db, season_id)
    squad_ids = sorted({reg["squad_id"] for reg in regs if reg.get("squad_id")})
    if not squad_ids:
        return set()
    return {
        uid
        for squad in await db.team_squads.find({"id": {"$in": squad_ids}}, {"_id": 0, "member_ids": 1}).to_list(500)
        for uid in squad.get("member_ids") or []
        if uid
    }


def _approvals_view(entry: dict | None, names: dict[str, str]) -> list[dict]:
    return [
        {"at": row.get("at"), "by": names.get(row.get("by") or "", "Gelöschter User"), "reason": row.get("reason"),
         "old_text": row.get("old_text"), "new_text": row.get("new_text")}
        for row in (entry or {}).get("approvals") or []
    ]


async def season_overview(db, season: dict) -> dict:
    """Kaderübersicht je Co-Team mit ID-Stand - für die Season-Seite der Liga-Leitung."""
    tournaments, regs = await _season_registrations(db, season["id"])
    squads = {
        row["id"]: row
        for row in await db.team_squads.find(
            {"id": {"$in": sorted({reg["squad_id"] for reg in regs})}}, {"_id": 0, "id": 1, "member_ids": 1, "name": 1}
        ).to_list(500)
    } if regs else {}
    members = {uid for squad in squads.values() for uid in squad.get("member_ids") or [] if uid}
    ctx = await context_for_season(db, season, members)
    divisions = {
        row["id"]: row
        for row in await db.league_divisions.find(
            {"season_id": season["id"]}, {"_id": 0, "id": 1, "level": 1, "nickname": 1}
        ).to_list(100)
    }
    by_tournament = {row["id"]: row for row in tournaments}
    approver_ids = {row.get("by") for entry in (ctx.entries.values() if ctx else []) for row in entry.get("approvals") or []}
    names = {
        row["id"]: person_name(row)
        for row in await db.users.find({"id": {"$in": sorted(uid for uid in approver_ids if uid)}},
                                       {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(200)
    } if approver_ids else {}
    rows = []
    for reg in regs:
        tournament = by_tournament.get(reg.get("tournament_id")) or {}
        context = tournament.get("league_context") or {}
        division = divisions.get(context.get("division_id")) or {}
        level = division.get("level")
        label = " · ".join(part for part in (
            f"Liga {level}" if level else None, division.get("nickname"),
            f"Staffel {context.get('staffel')}" if context.get("staffel") else None) if part)
        squad = squads.get(reg.get("squad_id")) or {}
        players = [
            {**status(ctx, uid), "approvals": _approvals_view((ctx.entries if ctx else {}).get(uid), names)}
            for uid in squad.get("member_ids") or [] if uid
        ]
        players.sort(key=lambda row: row["name"].lower())
        rows.append({
            "registration_id": reg.get("id"),
            "tournament_id": reg.get("tournament_id"),
            "staffel_label": label or tournament.get("title"),
            "display_name": reg.get("display_name"),
            "players": players,
            "_sort": (level or 0, context.get("staffel") or "", str(reg.get("display_name") or "").lower()),
        })
    rows.sort(key=lambda row: row.pop("_sort"))
    counts = {state: 0 for state in (MISSING, LATE)}
    changed = 0
    for row in rows:
        for player in row["players"]:
            if player["state"] in counts:
                counts[player["state"]] += 1
            changed += 1 if player["changed"] else 0
    return {
        "season": {"id": season["id"], "name": season.get("name"), "status": season.get("status"),
                   "roster_deadline": (ctx.deadline if ctx else None) or season.get("roster_deadline")},
        "game": {"name": ((ctx.game if ctx else None) or {}).get("display_name")},
        "fields": [{"key": item["key"], "label": item.get("label") or item["key"]} for item in (ctx.fields if ctx else [])],
        "squads": rows,
        "counts": {**counts, "changed": changed},
    }


# ---------------------------------------------------------------- Profil


async def my_league_ids(db, user: dict) -> list[dict]:
    """Für das eigene Profil: je laufender Season die festgehaltene ID und ihr Stand - daraus der Hinweis „In der
    laufenden Liga gilt weiter …“."""
    entries = await db.league_rosters.find({"user_id": user["id"]}, {"_id": 0}).to_list(200)
    if not entries:
        return []
    seasons = {
        row["id"]: row
        for row in await db.league_seasons.find(
            {"id": {"$in": sorted({row["season_id"] for row in entries})},
             "status": {"$nin": sorted(CLOSED_SEASON_STATUSES)}},
            {"_id": 0},
        ).to_list(200)
    }
    leagues = {
        row["id"]: row
        for row in await db.leagues.find(
            {"id": {"$in": sorted({row.get("league_id") for row in seasons.values() if row.get("league_id")})}},
            {"_id": 0, "id": 1, "name": 1},
        ).to_list(200)
    } if seasons else {}
    out = []
    for entry in entries:
        season = seasons.get(entry["season_id"])
        if not season:
            continue
        ctx = await context_for_season(db, season, [user["id"]])
        if not ctx or not ctx.fields:
            continue
        row = status(ctx, user["id"])
        out.append({
            "season_id": season["id"],
            "title": " · ".join(part for part in ((leagues.get(season.get("league_id")) or {}).get("name"),
                                                  season.get("name")) if part),
            "state": row["state"],
            "ok": row["ok"],
            "text": row["text"],
            "changed": row["changed"],
            "reason": row["reason"],
            "locked": picked(ctx.fields, entry.get("player_ids")) if row["state"] == LOCKED else {},
            "fields": [{"key": item["key"], "label": item.get("label") or item["key"]} for item in ctx.fields],
            "identity_slug": (ctx.game or {}).get("identity_game_slug"),
            "game_slug": (ctx.game or {}).get("slug"),
        })
    return out
