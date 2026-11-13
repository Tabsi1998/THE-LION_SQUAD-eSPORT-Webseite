"""Saisonabschluss (F.1, #1645, docs/LIGA.md „F.1 Saisonabschluss“; Entscheidungen Nr. 154 bis 157).

Abgeschlossen wird je Staffel; die Season ist abgeschlossen, wenn alle ihre Staffeln abgeschlossen sind. Der Abschluss friert die
Tabelle in ``league_final_tables`` ein - Plätze, Punkte, Maps, Kennzeichen, Entscheide, Meister, Regelstand und Zeitpunkt. Ab dann
lesen Website, TV, PDF und App diesen Endstand (``league_final_read.frozen_rows`` in ``tournament_view_routes._standing_rows``): Eine spätere Regel-,
Punkt- oder Tabellenänderung ändert ihn nicht mehr.

- **Sperrgründe** (Nr. 154, ``blockers``): offenes Spiel, offener Vorfall, offenes Verfahren, vorläufige Strafe oder offener Einspruch,
  laufende Protest- oder Einspruchsfrist, Gleichstand auf dem Meisterplatz ohne Entscheid (Nr. 156). Gerechnet aus denselben
  Bausteinen wie Spiel, Verfahren und Strafen - hier steht keine zweite Regel.
- **Wieder öffnen** (Nr. 155, ``reopen``): mit Pflichtgrund, durch eine zweite Person. Die Fassung bleibt im Verlauf, die nächste
  bekommt die nächste Nummer.
- **Meister** (``champion_of``): Platz 1 jeder Staffel der obersten Liga N. Ein Eintrag in ``tournament_awards`` an Team und
  eingesetzten Spielern - beim Wiederöffnen ausgesetzt, beim neuen Abschluss nachgezogen, nie doppelt.
- **Auf- und Abstieg** (Nr. 157): nur vorgemerkt - ``zones`` bleibt leer, bis F.2 sie füllt.
"""
from __future__ import annotations

import logging
from datetime import datetime

from pymongo.errors import DuplicateKeyError

from models import REGISTRATION_LIMIT, new_id, now_utc
from services import league_incident_rules as incident_rules
from services import league_procedures as procedures
from services import league_protest_settings as protest_settings
from services.league_final_read import CLOSED_LOCK, active_final, frozen_rows, is_closed  # noqa: F401 - CLOSED_LOCK für Routen
from services.league_scope import ONLY_LEAGUE, is_league_staffel
from services.log_safe import log_safe
from services.match_disputes import decided_at, league_window_of
from services.matchday_schedule import response_deadline

logger = logging.getLogger("tls.league_final")

# Wer abschließt und wieder öffnet (B.1): die Zuständigkeit „Season konfigurieren“ - der Bereich „Ligen“ hat sie immer.
CLOSE_CAPABILITY = "season"
REASON_MIN, REASON_MAX = 5, 500
# Ab dem Start abschließbar; „beendet“ auch, falls jemand den Stand schon von Hand gesetzt hat.
CLOSABLE_STATUSES = frozenset({"live", "paused", "completed", "results_published"})
# Kein Spiel mehr offen: gespielt, kampflos, abgesagt, Freilos, archiviert.
SETTLED_MATCH_STATUSES = frozenset({"completed", "forfeit", "cancelled", "archived", "bye"})
# Staffeln, die für den Abschluss der Season nicht zählen.
IGNORED_STAFFEL_STATUSES = frozenset({"cancelled", "archived", "draft"})
METHODS = {"playoff": "Entscheidungsspiel", "lot": "Los", "lead": "Entscheid der Leitung"}
ITEM_LIMIT = 50
HISTORY_LIMIT = 50
KIND = "tournament_registration"

ALREADY_CLOSED = "Diese Staffel ist schon abgeschlossen."
NOT_CLOSED = "Diese Staffel ist nicht abgeschlossen."
SECOND_PERSON = "Wieder öffnen muss eine zweite Person: nicht die, die abgeschlossen hat."
SECOND_PERSON_SUPERADMIN = ("Du hast diese Staffel selbst abgeschlossen. Als Superadmin geht das Wiederöffnen nur als "
                            "Notausnahme, mit einem Grund von mindestens fünf Zeichen.")
BUSY = "Der Abschluss wird gerade bearbeitet. Bitte gleich noch einmal."


class FinalProblem(Exception):
    """Eine Anfrage, die nicht passt - mit deutscher Meldung und HTTP-Status."""

    def __init__(self, message: str, status: int = 422, *, blockers: list[dict] | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.blockers = blockers or []


def reason_text(value, what: str = "einen Grund") -> str:
    text = " ".join(str(value or "").split())
    if len(text) < REASON_MIN:
        raise FinalProblem(f"Bitte {what} mit mindestens {REASON_MIN} Zeichen angeben.")
    return text[:REASON_MAX]


def public_final(final: dict | None) -> dict | None:
    """Was die Ligaseite über den Endstand sagt: Fassung, Zeitpunkt, Meister und Entscheide - nie, wer abgeschlossen hat."""
    if not final:
        return None
    champion = final.get("champion") or None
    return {
        "version": final.get("version"), "closed_at": final.get("closed_at"),
        "champion": ({"registration_id": champion.get("registration_id"), "display_name": champion.get("display_name"),
                      "team_id": champion.get("team_id")} if champion else None),
        "decisions": [{"names": list(row.get("names") or []), "reason": row.get("reason"), "method": row.get("method"),
                       "method_label": METHODS.get(row.get("method") or "")} for row in final.get("decisions") or []],
        "rules_label": ((final.get("rules") or {}).get("version") or {}).get("label"),
    }


async def public_final_of(db, tournament: dict | None) -> dict | None:
    if not is_league_staffel(tournament):
        return None
    return public_final(await active_final(db, tournament["id"]))


# ---------------------------------------------------------------- Sperrgründe (Nr. 154)

def _label(match: dict, names: dict[str, str]) -> str:
    day = match.get("matchday_label") or match.get("round_name") or (
        f"Spieltag {match.get('matchday_number') or match.get('round')}" if match.get("matchday_number") or match.get("round") else "Spiel")
    sides = [names.get(side) or "Team" for side in procedures.side_ids(match)]
    return f"{day}: {' – '.join(sides)}" if len(sides) == 2 else day


def _running(until: datetime | None, now: datetime) -> bool:
    return bool(until and now < until)


def running_deadlines(match: dict, tournament: dict, settings: dict, now: datetime) -> list[dict]:
    """Fristen, die an diesem Spiel noch laufen: Protestfrist nach der Bestätigung, Einspruchsfrist gegen Kampflos-Wertung,
    Korrektur oder Protestentscheid - dieselbe Rechnung wie beim Einlegen (``league_procedures``)."""
    out: list[dict] = []
    status = str(match.get("status") or "")
    rows = procedures.rows(match)

    def appealed(kind: str, ref_id: str) -> bool:
        return any(row["kind"] == procedures.APPEAL and (row.get("against") or {}).get("type") == kind
                   and (row.get("against") or {}).get("ref_id") == ref_id for row in rows)

    if status in ("completed", "forfeit"):
        window = league_window_of(match, tournament, settings["protest_hours"], now)
        if window.get("open") and window.get("kind") == "protest" and window.get("until"):
            out.append({"kind": "protest", "until": window["until"]})
        decided = decided_at(match)
        meta = match.get("result_meta") or {}
        for kind, fits in (("forfeit", status == "forfeit"), ("correction", bool(meta.get("correction_reason")))):
            until = response_deadline(tournament, decided, settings["appeal_hours"]) if fits and decided else None
            if _running(until, now) and not appealed(kind, match["id"]):
                out.append({"kind": "appeal", "until": until.isoformat()})
    for row in rows:
        if row["kind"] == procedures.APPEAL or procedures.state_of(row) != procedures.DECIDED:
            continue
        until = procedures.refs.parse(row.get("appeal_until"))
        if _running(until, now) and not appealed("protest_decision", row["id"]):
            out.append({"kind": "appeal", "until": until.isoformat()})
    return out


def champion_ties(rows: list[dict]) -> list[dict]:
    """Echter Gleichstand auf Platz 1 (Nr. 156) - unter den Teams, die noch in der Wertung stehen."""
    first = [row for row in rows if int(row.get("rank") or 0) == 1 and not row.get("exit")]
    if len(first) < 2:
        return []
    return [{"rank": 1, "registration_ids": [row["registration_id"] for row in first],
             "names": [row.get("display_name") or "Team" for row in first], "points": first[0].get("points")}]


def _blocker(code: str, label: str, text: str, items: list[dict]) -> dict:
    return {"code": code, "label": label, "text": text, "count": len(items), "items": items[:ITEM_LIMIT]}


async def blockers(db, tournament: dict, season: dict | None, *, rows: list[dict] | None = None, decisive: bool = False,
                   now: datetime | None = None) -> list[dict]:
    """Was dem Abschluss dieser Staffel entgegensteht - leer heißt: Es kann abgeschlossen werden. ``rows``: die Tabelle wie
    öffentlich; ``decisive``: Platz 1 ist ein entscheidender Platz (oberste Liga N)."""
    from services import league_sanctions as sanctions

    now = now or now_utc()
    tid = tournament["id"]
    season_id = (tournament.get("league_context") or {}).get("season_id")
    settings = protest_settings.effective(tournament, season)
    out: list[dict] = []
    if tournament.get("status") not in CLOSABLE_STATUSES:
        return [_blocker("not_started", "Staffel läuft nicht", "Abschließen geht erst, wenn die Staffel gestartet ist.", [])]
    matches = await db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(2000)
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tid}, {"_id": 0, "id": 1, "display_name": 1, "team_name": 1, "squad_name": 1}).to_list(REGISTRATION_LIMIT)
    names = {row["id"]: row.get("display_name") or row.get("team_name") or row.get("squad_name") or "Team" for row in registrations}
    duels = [match for match in matches if len(procedures.side_ids(match)) == 2]
    if not any(str(match.get("status") or "") in ("completed", "forfeit") for match in duels):
        out.append(_blocker("no_matches", "Kein gewertetes Spiel", "In dieser Staffel ist noch kein Spiel gewertet.", []))

    open_matches = [match for match in duels if str(match.get("status") or "pending") not in SETTLED_MATCH_STATUSES]
    if open_matches:
        out.append(_blocker(
            "open_matches", "Offene Spiele",
            "Jedes Spiel braucht ein Ergebnis oder eine Entscheidung der Leitung (Ergebnis eintragen, kampflos werten, absagen).",
            [{"text": _label(match, names), "url": f"/matches/{match['id']}"}
             for match in sorted(open_matches, key=lambda match: (match.get("round") or 0, match.get("order") or 0))]))

    incident_items = []
    for match in matches:
        if incident_rules.open_incidents(match) or incident_rules.lead_task(match):
            incident_items.append({"text": _label(match, names), "url": f"/matches/{match['id']}"})
    if incident_items:
        out.append(_blocker("incidents", "Offene Vorfälle", "Ein Vorfall wartet auf Antwort, Entscheidung oder die Feststellung der Serie.",
                            incident_items))

    procedure_items = [
        {"text": f"{procedures.KIND_LABELS[row['kind']]} · {_label(match, names)}", "url": f"/matches/{match['id']}#verfahren-{row['id']}"}
        for match in matches for row in procedures.open_rows(match)]
    if procedure_items:
        out.append(_blocker("procedures", "Offene Verfahren", "Beanstandung, Protest oder Einspruch sind noch nicht entschieden.",
                            procedure_items))

    sanction_url = f"/admin/leagues/seasons/{season_id}#strafen"
    docs = await db.competition_sanctions.find({"tournament_id": tid, "revoked_at": None}, {"_id": 0}).to_list(2000)
    sanction_items = []
    deadline_items = []
    for doc in docs:
        if (doc.get("appeal") or {}).get("state") == sanctions.OPEN:
            sanction_items.append({"text": "Einspruch gegen eine Strafe ist offen.", "url": sanction_url})
        elif doc.get("state") == sanctions.PROVISIONAL:
            sanction_items.append({"text": "Eine vorläufige Sperre wartet auf Bestätigung oder Widerruf.", "url": sanction_url})
        elif sanctions.appeal_refusal(doc, now) is None:
            deadline_items.append({"text": "Einspruchsfrist gegen eine Strafe", "url": sanction_url, "until": doc.get("appeal_until")})
    if sanction_items:
        out.append(_blocker("sanctions", "Strafen und Einsprüche", "Vorläufige Sperren und Einsprüche gegen Strafen müssen entschieden sein.",
                            sanction_items))

    for match in matches:
        for entry in running_deadlines(match, tournament, settings, now):
            what = "Protestfrist" if entry["kind"] == "protest" else "Einspruchsfrist"
            deadline_items.append({"text": f"{what} · {_label(match, names)}", "url": f"/matches/{match['id']}", "until": entry["until"]})
    if deadline_items:
        deadline_items.sort(key=lambda item: str(item.get("until") or ""))
        out.append(_blocker("deadlines", "Laufende Fristen",
                            "Solange eine Protest- oder Einspruchsfrist läuft, kann sich das Ergebnis noch ändern.", deadline_items))

    # Ohne gewertetes Spiel stehen alle gleich - das ist kein Gleichstand, den jemand entscheiden soll.
    if decisive and rows is not None and not any(row["code"] == "no_matches" for row in out):
        ties = champion_ties(rows)
        if ties:
            out.append(_blocker(
                "champion_tie", "Gleichstand auf Platz 1",
                "Der Meister steht nicht fest: Vor dem Abschluss braucht es einen begründeten Entscheid (Entscheidungsspiel, Los oder Leitung).",
                [{"text": " – ".join(tie["names"]), "url": f"/admin/leagues/seasons/{season_id}#abschluss"} for tie in ties]))
    return out


# ---------------------------------------------------------------- Tabelle und Meister

async def live_rows(db, tournament: dict) -> list[dict]:
    """Die gerechnete Tabelle, wie sie öffentlich steht - auch bei einer abgeschlossenen Staffel (für die Vorschau nach dem Öffnen)."""
    from routes.tournament_view_routes import _standing_rows

    return await _standing_rows(db, tournament, None, False, live=True)


async def top_division_id(db, season_id: str | None) -> str | None:
    """Die oberste Liga N der Season (kleinste Stufe) - nur dort ist Platz 1 der Meister."""
    rows = await db.league_divisions.find({"season_id": season_id}, {"_id": 0, "id": 1, "level": 1, "status": 1}).to_list(50)
    rows = [row for row in rows if (row.get("status") or "active") == "active"] or rows
    return min(rows, key=lambda row: (row.get("level") if isinstance(row.get("level"), int) else 99, row["id"]))["id"] if rows else None


def champion_of(rows: list[dict]) -> dict | None:
    """Der Meister aus der Tabelle: das eine Team auf Platz 1, das noch in der Wertung steht."""
    first = [row for row in rows if int(row.get("rank") or 0) == 1 and not row.get("exit")]
    if len(first) != 1:
        return None
    row = first[0]
    return {"registration_id": row["registration_id"], "display_name": row.get("display_name") or "Team", "team_id": row.get("team_id")}


def applied_decisions(tournament: dict, rows: list[dict]) -> list[dict]:
    """Die Entscheide der Leitung, die in dieser Tabelle gelten - mit Grund und Art, ohne die Person."""
    applied = {(row.get("lead_decision") or {}).get("id") for row in rows if row.get("lead_decision")}
    names = {row["registration_id"]: row.get("display_name") or "Team" for row in rows}
    return [{"id": decision.get("id"), "registration_ids": list(decision.get("registration_ids") or []),
             "names": [names.get(item) or "Team" for item in decision.get("registration_ids") or []],
             "reason": decision.get("reason"), "method": decision.get("method"), "decided_at": decision.get("decided_at")}
            for decision in tournament.get("table_decisions") or []
            if isinstance(decision, dict) and decision.get("id") in applied]


async def _frame(db, tournament: dict) -> dict:
    context = tournament.get("league_context") or {}
    league = await db.leagues.find_one({"id": context.get("league_id")}, {"_id": 0}) or {}
    season = await db.league_seasons.find_one({"id": context.get("season_id")}, {"_id": 0}) or {}
    division = await db.league_divisions.find_one({"id": context.get("division_id")}, {"_id": 0}) or {}
    from services.league_service import division_label

    return {"league": league, "season": season, "division": division,
            "division_label": division_label(division) if division.get("level") is not None else None,
            "decisive": bool(division.get("id")) and division.get("id") == await top_division_id(db, season.get("id"))}


async def _rules_snapshot(db, tournament: dict, frame: dict) -> dict:
    from services.league_table import public_rules

    version = None
    try:
        from services.league_rules import _label as version_label, current_version

        current = await current_version(db, frame["league"], frame["season"]) if frame["league"] and frame["season"] else None
        if current:
            version = {"id": current.get("id"), "version": current.get("version"), "label": version_label(current)}
    except Exception:  # noqa: BLE001 - der Abschluss hängt nicht am Regelwerk
        logger.warning("[league_final] Regelstand für Staffel %s nicht gelesen", log_safe(tournament.get("id")), exc_info=True)
    return {"table": public_rules(tournament), "version": version}


# ---------------------------------------------------------------- Befangenheit und zweite Person

async def own_registration_ids(db, user: dict | None, tournament_id: str) -> set[str]:
    """Die Anmeldungen dieser Staffel, zu denen die Person gehört (Befangenheit wie im Spiel, B.1)."""
    from services import league_permissions

    registrations = await db.tournament_registrations.find({"tournament_id": tournament_id}, {"_id": 0}).to_list(REGISTRATION_LIMIT)
    teams = await league_permissions.teams_by_id(db, registrations)
    return {row["id"] for row in registrations
            if row.get("id") and league_permissions.belongs_to_side(user, row, teams.get(row.get("team_id") or ""))}


async def own_team_in(db, user: dict | None, tournament_id: str) -> bool:
    """Gehört die Person zu einem Team dieser Staffel? Dann schließt und öffnet eine andere Person."""
    return bool(await own_registration_ids(db, user, tournament_id))


async def _conflict_override(db, user: dict, tournament_id: str, conflict_reason) -> str | None:
    """403, wenn die Person zu einem Team der Staffel gehört - der Superadmin nur als Notausnahme mit Grund (wird zurückgegeben)."""
    from services import league_permissions

    conflict = ({"kind": league_permissions.CONFLICT_INVOLVED, "override": league_permissions.is_superadmin(user)}
                if await own_team_in(db, user, tournament_id) else None)
    return league_permissions.override_reason(conflict, conflict_reason, detail=league_permissions.SIDE_CONFLICT_DETAIL,
                                              superadmin_detail=league_permissions.SIDE_CONFLICT_SUPERADMIN_DETAIL)


# ---------------------------------------------------------------- Meister-Eintrag

def _fielded(matches: list[dict], registration_id: str) -> set[str]:
    people: set[str] = set()
    for match in matches:
        for game in match.get("games") or []:
            people.update(((game or {}).get("lineups") or {}).get(registration_id) or [])
        people.update((match.get("lineups") or {}).get(registration_id) or [])
    return {person for person in people if person}


async def champion_players(db, tournament_id: str, registration: dict) -> list[str]:
    """Die Spieler des Meisters: wer in der Staffel mindestens einmal aufgestellt war - ohne Aufstellungen der Kader."""
    from services.match_audience import teams_by_id

    matches = await db.matches_v2.find({"tournament_id": tournament_id, "is_preview": {"$ne": True}},
                                       {"_id": 0, "games.lineups": 1, "lineups": 1}).to_list(2000)
    fielded = _fielded(matches, registration["id"])
    if fielded:
        return sorted(fielded)
    team = (await teams_by_id(db, [registration])).get(registration.get("team_id") or "") or {}
    if registration.get("squad_id"):
        squad = (team.get("squads") or {}).get(registration["squad_id"]) or {}
        return sorted({person for person in squad.get("member_ids") or [] if person})
    return sorted({person for person in [registration.get("user_id"), *(team.get("member_ids") or [])] if person})


async def record_champion(db, tournament: dict, final: dict, frame: dict) -> int:
    """Der Meister-Eintrag in ``tournament_awards``: genau einer je Staffel, am Team und an den Spielern. Ein Eintrag für ein anderes
    Team (frühere Fassung) verschwindet - nie zwei Meister."""
    from services.awards import forget_outcome
    from services.competition_standings import registration_match_summary

    tid = tournament["id"]
    forget_outcome(db, tid)
    champion = final.get("champion")
    if not champion:
        await db.tournament_awards.delete_many({"tournament_id": tid})
        return 0
    registration = await db.tournament_registrations.find_one({"id": champion["registration_id"], "tournament_id": tid}, {"_id": 0})
    if not registration:
        await db.tournament_awards.delete_many({"tournament_id": tid})
        return 0
    matches = await db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(2000)
    summary = registration_match_summary(matches, {registration["id"]})
    team = await db.teams.find_one({"id": registration.get("team_id")}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "logo_url": 1}) \
        if registration.get("team_id") else None
    game = await db.games.find_one({"id": tournament.get("game_id")}, {"_id": 0, "id": 1, "name": 1, "logo_url": 1, "cover_url": 1}) \
        if tournament.get("game_id") else None
    league, season = frame["league"], frame["season"]
    title = " · ".join(part for part in (league.get("name"), season.get("name")) if part) or tournament.get("title")
    now = now_utc().isoformat()
    doc = {
        "tournament_id": tid, "registration_id": registration["id"], "user_id": registration.get("user_id"),
        "team_id": registration.get("team_id"), "rank": 1, "kind": "trophy", "participants": int(final.get("participants") or 0),
        "finalist": False, "final_match_id": None,
        "matches": {"played": summary["matches_played"], "won": summary["matches_won"]},
        "tournament": {**{key: tournament.get(key) for key in ("id", "slug", "start_date", "visibility", "is_public")},
                       "title": title, "status": "completed"},
        "game": game, "season": {"id": season.get("id"), "name": season.get("name") or "Season"} if season.get("id") else None,
        "team": {"id": team["id"], "name": team.get("name"), "tag": team.get("tag"), "logo_url": team.get("logo_url")} if team else None,
        # Liga-Titel: Meister der Staffel, an den eingesetzten Spielern - kein Turnier-Pokal, keine Jahreswertung.
        "league": {"title": "Meister", "league_id": league.get("id"), "season_id": season.get("id"),
                   "division_label": frame.get("division_label"), "staffel": (tournament.get("league_context") or {}).get("staffel"),
                   "display_name": champion.get("display_name"), "final_table_id": final["id"], "version": final["version"]},
        "player_ids": await champion_players(db, tid, registration),
        "suspended": False, "updated_at": now,
    }
    existing = await db.tournament_awards.find_one({"tournament_id": tid, "registration_id": registration["id"]}, {"_id": 0, "id": 1})
    award_id = existing["id"] if existing else new_id()
    await db.tournament_awards.update_one({"tournament_id": tid, "registration_id": registration["id"]},
                                          {"$set": doc, "$setOnInsert": {"id": award_id, "created_at": now}}, upsert=True)
    await db.tournament_awards.delete_many({"tournament_id": tid, "id": {"$ne": award_id}})
    return 1


async def suspend_champion(db, tournament_id: str) -> None:
    """Wieder geöffnet: Der Meister-Eintrag ruht (unsichtbar), bis neu abgeschlossen ist - bleibt es dasselbe Team, bleibt der Eintrag."""
    from services.awards import forget_outcome

    forget_outcome(db, tournament_id)
    await db.tournament_awards.update_many({"tournament_id": tournament_id}, {"$set": {"suspended": True, "updated_at": now_utc().isoformat()}})


# ---------------------------------------------------------------- Season folgt den Staffeln

async def season_staffeln(db, season_id: str) -> list[dict]:
    return await db.tournaments.find({"league_context.season_id": season_id, **ONLY_LEAGUE},
                                     {"_id": 0, "id": 1, "status": 1, "final_table": 1}).to_list(500)


def all_closed(staffeln: list[dict]) -> bool:
    counted = [row for row in staffeln if is_closed(row) or row.get("status") not in IGNORED_STAFFEL_STATUSES]
    return bool(counted) and all(is_closed(row) for row in counted)


async def _season_follows(db, season_id: str | None, actor_id: str | None, tournament_id: str) -> str | None:
    """Sind alle Staffeln abgeschlossen, ist die Season „beendet“ (mit Protokoll); wird eine wieder geöffnet, läuft sie wieder -
    aber nur, wenn der Abschluss sie beendet hat (``final_closed_at``), nie gegen eine Schaltung von Hand."""
    if not season_id:
        return None
    now = now_utc().isoformat()
    closed = all_closed(await season_staffeln(db, season_id))
    if closed:
        changed = await db.league_seasons.update_one({"id": season_id, "status": "active"},
                                                     {"$set": {"status": "completed", "final_closed_at": now, "updated_at": now}})
        change = ("active", "completed")
    else:
        changed = await db.league_seasons.update_one({"id": season_id, "status": "completed", "final_closed_at": {"$nin": [None, ""]}},
                                                     {"$set": {"status": "active", "final_closed_at": None, "updated_at": now}})
        change = ("completed", "active")
    if not changed.modified_count:
        return None
    await db.audit_logs.insert_one({"id": new_id(), "action": "league.season.status", "target_id": season_id, "actor_id": actor_id,
                                    "data": {"from": change[0], "to": change[1], "trigger": "final_table", "tournament_id": tournament_id},
                                    "created_at": now})
    return change[1]


# ---------------------------------------------------------------- Nachrichten an die Captains

async def notify_captains(db, tournament: dict, final: dict, frame: dict, event: str) -> int:
    """Captains und Vertreter jeder Seite der Staffel: „abgeschlossen“ bzw. „wieder geöffnet“ - je Fassung und Person einmal."""
    from services.match_audience import responsible_ids, teams_by_id
    from services.user_notifications import create_user_notification

    try:
        registrations = await db.tournament_registrations.find(
            {"tournament_id": tournament["id"], "status": {"$in": ["approved", "checked_in"]}}, {"_id": 0}).to_list(REGISTRATION_LIMIT)
        teams = await teams_by_id(db, registrations)
        people: set[str] = set()
        for registration in registrations:
            people |= responsible_ids(registration, teams.get(registration.get("team_id") or ""))
        league, season = frame["league"], frame["season"]
        url = (f"/liga/{league.get('slug')}/{season.get('slug')}" if league.get("slug") and season.get("slug")
               else f"/tournaments/{tournament.get('slug') or tournament['id']}")
        name = tournament.get("title") or "Die Staffel"
        if event == "closed":
            champion = (final.get("champion") or {}).get("display_name")
            title = "Staffel abgeschlossen"
            text = f"{name}: Der Endstand steht fest." + (f" Meister: {champion}." if champion else "")
        else:
            title = "Staffel wieder geöffnet"
            text = f"{name}: Die Liga-Leitung hat den Abschluss wieder geöffnet. Der Endstand wird geprüft und danach neu festgestellt."
        sent = 0
        for user_id in sorted(people):
            if await create_user_notification(user_id, title, text, url=url, kind=KIND,
                                              meta={"reason": "league_final", "dedupe_key": f"league-final:{final['id']}:{event}:{user_id}"}):
                sent += 1
        return sent
    except Exception:  # noqa: BLE001 - der Abschluss steht, die Nachricht hält ihn nicht auf
        logger.warning("[league_final] Nachricht zu Staffel %s nicht verschickt", log_safe(tournament.get("id")), exc_info=True)
        return 0


# ---------------------------------------------------------------- Abschließen

async def close(db, tournament: dict, actor: dict, *, conflict_reason: str | None = None, now: datetime | None = None) -> dict:
    """Schließt die Staffel ab. Der Aufrufer hält die Schreibsperre des Turniers und hat das Recht geprüft. Atomar: Den Abschluss
    gewinnt, wer das Turnier zuerst markiert - jeder zweite bekommt 409."""
    if not is_league_staffel(tournament):
        raise FinalProblem("Das gibt es nur in einer Liga-Staffel.", 404)
    if is_closed(tournament):
        raise FinalProblem(ALREADY_CLOSED, 409)
    now = now or now_utc()
    tid = tournament["id"]
    override = await _conflict_override(db, actor, tid, conflict_reason)
    frame = await _frame(db, tournament)
    rows = await live_rows(db, tournament)
    found = await blockers(db, tournament, frame["season"], rows=rows, decisive=frame["decisive"], now=now)
    if found:
        raise FinalProblem("Abschließen geht noch nicht: " + ", ".join(row["label"] for row in found) + ".", 409, blockers=found)
    last = await db.league_final_tables.find({"tournament_id": tid}, {"_id": 0, "version": 1}).sort("version", -1).to_list(1)
    context = tournament.get("league_context") or {}
    final = {
        "id": new_id(), "tournament_id": tid, "league_id": context.get("league_id"), "season_id": context.get("season_id"),
        "division_id": context.get("division_id"), "staffel": context.get("staffel"),
        "version": int((last[0] if last else {}).get("version") or 0) + 1, "active": True,
        "closed_at": now.isoformat(), "closed_by": actor.get("id"),
        "title": {"league": frame["league"].get("name"), "season": frame["season"].get("name"),
                  "division": frame.get("division_label"), "tournament": tournament.get("title")},
        "rows": rows, "participants": len([row for row in rows if not row.get("exit")]),
        "champion_place": frame["decisive"], "champion": champion_of(rows) if frame["decisive"] else None,
        "decisions": applied_decisions(tournament, rows), "rules": await _rules_snapshot(db, tournament, frame),
        # Auf- und Abstieg (Nr. 157): vorgemerkt - F.2 füllt Zonen und Vorschlag.
        "zones": [], "promotion": None,
        "status_before": tournament.get("status"),
        "reopened_at": None, "reopened_by": None, "reopen_reason": None, "created_at": now.isoformat(),
    }
    mark = {"id": final["id"], "version": final["version"], "closed_at": final["closed_at"]}
    claimed = await db.tournaments.update_one(
        {"id": tid, "final_table": None},
        {"$set": {"final_table": mark, "status": "completed", "status_before_final": tournament.get("status"), "updated_at": final["closed_at"]}})
    if not claimed.modified_count:
        raise FinalProblem(ALREADY_CLOSED, 409)
    try:
        await db.league_final_tables.insert_one(dict(final))
    except DuplicateKeyError:
        await db.tournaments.update_one({"id": tid, "final_table.id": final["id"]},
                                        {"$set": {"final_table": None, "status": tournament.get("status")}, "$unset": {"status_before_final": ""}})
        raise FinalProblem(ALREADY_CLOSED, 409) from None
    if override:
        from services import league_permissions

        await league_permissions.record_override(db, actor, action="final_close", target_id=tid, reason=override, final_table_id=final["id"])
    await record_champion(db, {**tournament, "status": "completed"}, final, frame)
    season_status = await _season_follows(db, context.get("season_id"), actor.get("id"), tid)
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "league.final.close", "actor_id": actor.get("id"), "target_id": tid,
        "data": {"final_table_id": final["id"], "version": final["version"], "season_id": context.get("season_id"),
                 "champion_registration_id": (final["champion"] or {}).get("registration_id"), "teams": final["participants"]},
        "created_at": final["closed_at"]})
    await notify_captains(db, tournament, final, frame, "closed")
    return {"final": final, "season_status": season_status}


# ---------------------------------------------------------------- Wieder öffnen (Nr. 155)

def second_person_override(final: dict, actor: dict, emergency_reason) -> str | None:
    """Wieder öffnet eine zweite Person. ``None``: Sie ist es. Der Superadmin, der selbst abgeschlossen hat, nur als Notausnahme
    mit Grund (wird zurückgegeben)."""
    from services.league_permissions import is_superadmin

    if final.get("closed_by") != actor.get("id"):
        return None
    if not is_superadmin(actor):
        raise FinalProblem(SECOND_PERSON, 403)
    reason = " ".join(str(emergency_reason or "").split())
    if len(reason) < REASON_MIN:
        raise FinalProblem(SECOND_PERSON_SUPERADMIN, 403)
    return reason[:REASON_MAX]


async def reopen(db, tournament: dict, actor: dict, reason, *, conflict_reason: str | None = None, emergency_reason: str | None = None,
                 now: datetime | None = None) -> dict:
    """Öffnet die abgeschlossene Staffel wieder: Die Fassung bleibt im Verlauf, die Tabelle wird wieder gerechnet, der Meister-Eintrag
    ruht. Der Aufrufer hält die Schreibsperre und hat das Recht geprüft."""
    from services import league_permissions

    if not is_league_staffel(tournament):
        raise FinalProblem("Das gibt es nur in einer Liga-Staffel.", 404)
    tid = tournament["id"]
    final = await active_final(db, tid)
    if not is_closed(tournament) or not final:
        raise FinalProblem(NOT_CLOSED, 409)
    text = reason_text(reason, "einen Grund für das Wiederöffnen")
    emergency = second_person_override(final, actor, emergency_reason)
    override = await _conflict_override(db, actor, tid, conflict_reason)
    now = now or now_utc()
    claimed = await db.league_final_tables.update_one(
        {"id": final["id"], "active": True},
        {"$set": {"active": False, "reopened_at": now.isoformat(), "reopened_by": actor.get("id"), "reopen_reason": text}})
    if not claimed.modified_count:
        raise FinalProblem(NOT_CLOSED, 409)
    status = tournament.get("status_before_final") or final.get("status_before") or "live"
    await db.tournaments.update_one({"id": tid}, {"$set": {"final_table": None, "status": status, "updated_at": now.isoformat()},
                                                  "$unset": {"status_before_final": ""}})
    for kind, why in (("final_reopen_own", emergency), ("final_reopen", override)):
        if why:
            await league_permissions.record_override(db, actor, action=kind, target_id=tid, reason=why, final_table_id=final["id"])
    await suspend_champion(db, tid)
    context = tournament.get("league_context") or {}
    season_status = await _season_follows(db, context.get("season_id"), actor.get("id"), tid)
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "league.final.reopen", "actor_id": actor.get("id"), "target_id": tid,
        "data": {"final_table_id": final["id"], "version": final["version"], "season_id": context.get("season_id"), "reason": text},
        "created_at": now.isoformat()})
    frame = await _frame(db, tournament)
    await notify_captains(db, tournament, final, frame, "reopened")
    return {"final": {**final, "active": False, "reopened_at": now.isoformat(), "reopened_by": actor.get("id"), "reopen_reason": text},
            "season_status": season_status}


# ---------------------------------------------------------------- Cockpit

def _history_row(final: dict, names: dict[str, str]) -> dict:
    return {"id": final["id"], "version": final.get("version"), "active": bool(final.get("active")),
            "closed_at": final.get("closed_at"), "closed_by_name": names.get(final.get("closed_by") or "") or "Liga-Leitung",
            "reopened_at": final.get("reopened_at"),
            "reopened_by_name": (names.get(final.get("reopened_by") or "") or "Liga-Leitung") if final.get("reopened_at") else None,
            "reopen_reason": final.get("reopen_reason"),
            "champion": (final.get("champion") or {}).get("display_name"), "teams": final.get("participants"),
            "rules_label": ((final.get("rules") or {}).get("version") or {}).get("label")}


async def _names(db, user_ids: set[str]) -> dict[str, str]:
    ids = sorted(user_id for user_id in user_ids if user_id)
    if not ids:
        return {}
    rows = await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(ids) + 1)
    return {row["id"]: row.get("display_name") or row.get("username") or "Liga-Leitung" for row in rows}


async def staffel_overview(db, tournament: dict, season: dict, user: dict, *, decisive: bool, division_label: str | None,
                           can_act: bool, now: datetime | None = None) -> dict:
    """Eine Staffel im Cockpit: Stand, Sperrgründe mit Link, Vorschau bzw. Endstand, Gleichstand auf Platz 1, Verlauf."""
    from services import league_permissions
    from services.league_table import can_decide, public_rules

    tid = tournament["id"]
    history = await db.league_final_tables.find({"tournament_id": tid}, {"_id": 0, "rows": 0}).sort("version", -1).to_list(HISTORY_LIMIT)
    active = next((row for row in history if row.get("active")), None) if is_closed(tournament) else None
    names = await _names(db, {value for row in history for value in (row.get("closed_by"), row.get("reopened_by"))})
    own_ids = await own_registration_ids(db, user, tid)
    own_team = bool(own_ids)
    superadmin = league_permissions.is_superadmin(user)
    base = {
        "tournament_id": tid, "title": tournament.get("title"), "slug": tournament.get("slug"),
        "staffel": (tournament.get("league_context") or {}).get("staffel"), "division_label": division_label,
        "status": tournament.get("status"), "champion_place": decisive, "own_team": own_team,
        "history": [_history_row(row, names) for row in history],
    }
    if active:
        rows = (await frozen_rows(db, tournament)) or []
        closed_by_me = active.get("closed_by") == user.get("id")
        return {**base, "closed": True, "final": {**public_final(active), "id": active["id"],
                                                  "closed_by_name": names.get(active.get("closed_by") or "") or "Liga-Leitung"},
                "standings": rows, "table_rules": (active.get("rules") or {}).get("table"),
                "blockers": [], "ties": [], "can_decide": False, "can_close": False,
                "closed_by_me": closed_by_me,
                # Wieder öffnen: zweite Person; wer selbst abgeschlossen hat, nur als Superadmin mit Notausnahme.
                "can_reopen": can_act and (not closed_by_me or superadmin) and (not own_team or superadmin)}
    rows = await live_rows(db, tournament)
    found = await blockers(db, tournament, season, rows=rows, decisive=decisive, now=now)
    # Je Gleichstand: Gehört die Person zu einer der Seiten? Dann entscheidet eine andere (wie im Reiter „Tabelle“).
    ties = [{**tie, "own_team": bool(own_ids & set(tie["registration_ids"]))} for tie in champion_ties(rows)] if decisive else []
    return {**base, "closed": False, "final": None, "standings": rows, "table_rules": public_rules(tournament), "blockers": found,
            "ties": ties, "can_decide": can_decide(tournament),
            "champion": champion_of(rows) if decisive else None,
            "can_close": can_act and not found and (not own_team or superadmin), "closed_by_me": False, "can_reopen": False}


async def season_overview(db, season: dict, user: dict, *, now: datetime | None = None) -> dict:
    """Das Cockpit der Season: je Staffel der Stand, dazu ob die Season abgeschlossen ist."""
    from services import league_permissions
    from services.league_service import division_label

    capabilities = await league_permissions.capabilities_of(db, user, season.get("league_id"))
    can_act = CLOSE_CAPABILITY in capabilities
    divisions = {row["id"]: row for row in await db.league_divisions.find({"season_id": season["id"]}, {"_id": 0}).to_list(50)}
    top = await top_division_id(db, season["id"])
    tournaments = await db.tournaments.find({"league_context.season_id": season["id"], **ONLY_LEAGUE},
                                            {"_id": 0, "creation_key": 0, "billing": 0}).to_list(500)
    tournaments = [row for row in tournaments if is_closed(row) or row.get("status") not in IGNORED_STAFFEL_STATUSES]
    tournaments.sort(key=lambda row: ((divisions.get(row["league_context"].get("division_id")) or {}).get("level") or 99,
                                      str(row["league_context"].get("staffel") or "")))
    staffeln = []
    for tournament in tournaments:
        division = divisions.get(tournament["league_context"].get("division_id")) or {}
        staffeln.append(await staffel_overview(
            db, tournament, season, user, decisive=bool(division) and division.get("id") == top,
            division_label=division_label(division) if division.get("level") is not None else None, can_act=can_act, now=now))
    return {
        "season": {"id": season["id"], "name": season.get("name"), "status": season.get("status"),
                   "closed": bool(staffeln) and all(row["closed"] for row in staffeln)},
        "can_act": can_act, "superadmin": league_permissions.is_superadmin(user), "methods": METHODS,
        "responsible": f"„{league_permissions.CAPABILITY_LABELS[CLOSE_CAPABILITY]}“",
        "staffeln": staffeln,
    }


async def version_view(db, tournament_id: str, version: int) -> dict:
    """Eine Fassung aus dem Verlauf mit ihrer Tabelle - für die Leitung."""
    final = await db.league_final_tables.find_one({"tournament_id": tournament_id, "version": version}, {"_id": 0})
    if not final:
        raise FinalProblem("Diese Fassung gibt es nicht.", 404)
    names = await _names(db, {final.get("closed_by"), final.get("reopened_by")})
    return {**_history_row(final, names), "standings": final.get("rows") or [], "decisions": public_final(final)["decisions"],
            "table_rules": (final.get("rules") or {}).get("table")}
