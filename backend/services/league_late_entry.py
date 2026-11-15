"""Nachmeldung nach dem Season-Start: Spiele für ein Team, das in eine Staffel mit festem Spielplan kommt (docs/LIGA.md, B.4
„Nachmeldung nach dem Season-Start“, #2422, Entscheidungen Nr. 180, 183).

Nur die restlichen Runden (Nr. 183): Das neue Team bekommt Paarungen gegen alle Teams der Staffel, aber nur in Spielwochen, die noch
nicht begonnen haben. Gespielte Wochen, bestehende Spiele und Termine bleiben unverändert. Eine Paarung braucht eine Woche, in der
beide Seiten frei sind: das Freilos des Gegners (ungerade Teamzahl), eine Reservewoche nach dem letzten Spieltag oder eine Woche, in
der das Spiel des Gegners abgesagt ist. Was so nicht passt, entfällt („Gegen X kein Spiel mehr möglich.“).

Keine stillen Änderungen: Das Zuteilen markiert die Anmeldung nur (``late_entry.state = "open"``, ab welcher Woche). Die Leitung sieht
eine Vorschau (``plan``) und legt die Spiele mit einer Bestätigung an (``apply``) - unter der Turnier- und der Season-Sperre und nur,
wenn die Vorschau noch stimmt (``fingerprint``). Die Termine folgen den bestehenden Regeln: Standardtermin der Woche, Sperrzeiten,
danach Terminvorschläge wie bei jedem Spiel.

``plan`` ist reine Rechnung auf Listen von dicts, darum ohne Datenbank prüfbar.
"""
from __future__ import annotations

import copy
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone

from services.custom_bracket import league_legs
from services.league_late import GENERATION_MODE, GONE_STATUSES, registration_name
from services.matchday_schedule import (
    LOCAL_TZ,
    apply_schedule_writes,
    blocked_weeks_of,
    calendar_week_of,
    default_time_for,
    duel_sides,
    matchday_number_of,
    matchday_settings,
    schedule_writes,
    tournament_matchday_window,
)

logger = logging.getLogger("tls.league_late_entry")

OPEN, DONE = "open", "done"
ACTIVE_STATUSES = ("approved", "checked_in")
LEAGUE_STAGE_TYPES = frozenset({"league"})
FINISHED_STATUSES = frozenset({"completed", "results_published", "archived", "cancelled"})

BUSY = "An dieser Staffel wird gerade etwas geändert. Bitte gleich noch einmal versuchen."
GONE = "Diese Nachmeldung gibt es in dieser Staffel nicht."
NOT_OPEN = "Für dieses Team ist schon entschieden, welche Spiele es nachträglich bekommt."
CHANGED = "Der Spielplan hat sich seit der Vorschau geändert. Bitte die Vorschau neu laden und noch einmal bestätigen."
NO_PLAN = "Diese Staffel hat noch keinen festen Spielplan - das Team bekommt seine Spiele beim Start wie alle anderen."
FINISHED = "Diese Staffel ist beendet."


class LateEntryProblem(Exception):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.message = message
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _name(registration: dict | None) -> str:
    return registration_name(registration)


def is_active(registration: dict | None) -> bool:
    row = registration or {}
    return row.get("status") in ACTIVE_STATUSES and not row.get("removal")


def league_duels(matches) -> list[dict]:
    """Die festen Liga-Spiele mit zwei Seiten - ohne Vorschau."""
    out = []
    for match in matches or []:
        if match.get("is_preview") or (match.get("stage_type") or "league") not in LEAGUE_STAGE_TYPES:
            continue
        if len(match.get("slots") or []) != 2 or matchday_number_of(match) is None:
            continue
        out.append(match)
    return out


def has_fixed_plan(matches) -> bool:
    return bool(league_duels(matches))


def active_matchdays(tournament: dict, matches) -> int:
    """Wie viele Spieltage die Staffel hat: aktive Wochen der Season (ohne Sperrwochen), mindestens bis zum letzten Spieltag."""
    total = int((tournament or {}).get("matchday_weeks_total") or 0)
    blocked = len([week for week in blocked_weeks_of(tournament) if week <= total])
    last = max((matchday_number_of(match) or 0 for match in league_duels(matches)), default=0)
    return max(total - blocked, last)


def open_matchdays(tournament: dict, matches, now: datetime | None = None) -> list[int]:
    """Die Spieltage, deren Woche noch nicht begonnen hat (Nr. 183: nur die noch offenen Spielwochen)."""
    moment = now or _now()
    out = []
    for number in range(1, active_matchdays(tournament, matches) + 1):
        if tournament_matchday_window(tournament, number).start > moment:
            out.append(number)
    return out


def late_mark(tournament: dict, matches, now: datetime | None = None) -> dict | None:
    """Die Markierung beim Zuteilen: ``None`` ohne festen Spielplan (dann kommt das Team beim Start in den Plan)."""
    if not has_fixed_plan(matches):
        return None
    moment = now or _now()
    days = open_matchdays(tournament, matches, moment)
    first = days[0] if days else None
    return {"state": OPEN, "from_matchday": first, "from_week": calendar_week_of(tournament, first) if first else None,
            "marked_at": moment.isoformat()}


def held_cancel(match: dict, held: set[str] | frozenset = frozenset()) -> bool:
    """Nr. 188: Ein Spiel, das eine noch anfechtbare Disqualifikation abgesagt hat (Einspruch oder Widerruf noch möglich), gibt die
    Woche nicht frei - es kann wiederkommen."""
    meta = match.get("result_meta") or {}
    return (match.get("status") in GONE_STATUSES and meta.get("reason") == "disqualified"
            and meta.get("removed_registration_id") in held)


def occupies(match: dict, held: set[str] | frozenset = frozenset()) -> bool:
    """Belegt das Spiel seine Woche? Abgesagte nur, wenn sie wiederkommen können (Nr. 188)."""
    return match.get("status") not in GONE_STATUSES or held_cancel(match, held)


def _moment(value) -> datetime | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def played_in(tournament: dict | None, match: dict, last: int) -> int | None:
    """Die Spielwoche, in der das Spiel wirklich liegt: ein Termin in einer anderen Woche (verschoben) zählt dort (Review #2422)."""
    moment = _moment(match.get("scheduled_at"))
    if not tournament or moment is None:
        return None
    for number in range(1, last + 1):
        if tournament_matchday_window(tournament, number).contains(moment):
            return number
    return None


def _busy(matches, registration_id: str, *, tournament: dict | None = None, last: int = 0,
          held: set[str] | frozenset = frozenset()) -> set[int]:
    """Die Wochen, in denen das Team schon spielt: der Spieltag des Spiels und - ist es verschoben - die Woche seines Termins."""
    out = set()
    for match in matches:
        if not occupies(match, held) or registration_id not in duel_sides(match):
            continue
        out.add(matchday_number_of(match))
        moved = played_in(tournament, match, last)
        if moved:
            out.add(moved)
    return out


def _notes(tournament: dict, duels: list[dict], weeks: list[int], ids: set[str], names: dict, last: int,
           held: set[str] | frozenset) -> list[str]:
    """Hinweise in der Vorschau: was eine offene Woche belegt, ohne dass man es am Spieltag sieht."""
    out = []
    for match in sorted(duels, key=lambda row: (matchday_number_of(row) or 0, row.get("order") or 0)):
        sides = [side for side in duel_sides(match) if side]
        if not ids & set(sides):
            continue
        label = " gegen ".join(names.get(side, "Team") for side in sides)
        moved = played_in(tournament, match, last) if occupies(match, held) else None
        if moved and moved != matchday_number_of(match) and moved in weeks:
            out.append(f"{label} (Spieltag {matchday_number_of(match)}) ist in Woche {calendar_week_of(tournament, moved)} verschoben - "
                       "beide sind dort belegt.")
        if held_cancel(match, held) and matchday_number_of(match) in weeks:
            out.append(f"{label} in Woche {calendar_week_of(tournament, matchday_number_of(match))} ist wegen einer Disqualifikation "
                       "abgesagt, die noch angefochten oder widerrufen werden kann - die Woche bleibt belegt, bis sie endgültig ist.")
    return out


def _home_balance(matches, registration_id: str) -> int:
    """Heimspiele minus Auswärtsspiele (Platz eins ist die Heimseite)."""
    balance = 0
    for match in matches:
        if match.get("status") in GONE_STATUSES:
            continue
        home, away = duel_sides(match)
        balance += 1 if home == registration_id else -1 if away == registration_id else 0
    return balance


def _assign(demands: list[tuple[str, int]], weeks: list[int], free: dict[str, set[int]]) -> dict[int, tuple[str, int]]:
    """Größtmögliche Zuordnung Paarung → Woche (augmentierende Wege): je Woche höchstens ein Spiel des neuen Teams, nur in einer
    Woche, in der auch der Gegner frei ist. Frühe Wochen zuerst, gleiche Eingabe, gleiches Ergebnis."""
    owner: dict[int, int] = {}

    def place(index: int, seen: set[int]) -> bool:
        opponent = demands[index][0]
        for week in weeks:
            if week in seen or week not in free[opponent]:
                continue
            seen.add(week)
            if week not in owner or place(owner[week], seen):
                owner[week] = index
                return True
        return False

    for index in range(len(demands)):
        place(index, set())
    return {week: demands[index] for week, index in owner.items()}


def _reason(tournament: dict, matches, opponent_id: str, matchday: int, last_regular: int, names: dict,
            held: set[str] | frozenset = frozenset()) -> tuple[str, str]:
    opponent = names.get(opponent_id, "Team")
    if matchday > last_regular:
        return "reserve", "Reservewoche nach dem letzten Spieltag."
    if any(opponent_id in duel_sides(match) and matchday_number_of(match) == matchday and match.get("status") in GONE_STATUSES
           and not held_cancel(match, held) for match in matches):
        return "free", f"Das Spiel von {opponent} in dieser Woche ist abgesagt."
    return "bye", f"{opponent} hat in dieser Woche spielfrei."


def _local(moment: datetime | None) -> str | None:
    return moment.astimezone(LOCAL_TZ).isoformat() if moment else None


def plan(tournament: dict, registration: dict, registrations: list[dict], matches: list[dict], now: datetime | None = None,
         held: set[str] | frozenset = frozenset()) -> dict:
    """Die Vorschau: welche Paarungen das neue Team in welcher Woche bekommt und gegen wen kein Spiel mehr möglich ist. ``held``: Teams
    mit noch anfechtbarer Disqualifikation (Nr. 188, ``held_registrations``)."""
    moment = now or _now()
    duels = league_duels(matches)
    new_id = registration["id"]
    names = {row["id"]: _name(row) for row in registrations}
    names[new_id] = _name(registration)
    opponents = sorted((row for row in registrations if row["id"] != new_id and is_active(row)), key=lambda row: (_name(row).lower(), row["id"]))
    legs = league_legs(tournament)
    weeks = open_matchdays(tournament, duels, moment)
    last_regular = max((matchday_number_of(match) or 0 for match in duels), default=0)
    last = active_matchdays(tournament, duels)
    own_busy = _busy(duels, new_id, tournament=tournament, last=last, held=held)
    usable = [week for week in weeks if week not in own_busy]
    free = {row["id"]: {week for week in usable if week not in _busy(duels, row["id"], tournament=tournament, last=last, held=held)}
            for row in opponents}
    already = {row["id"]: sum(1 for match in duels if match.get("status") not in GONE_STATUSES
                              and set(duel_sides(match)) == {new_id, row["id"]}) for row in opponents}
    demands = [(row["id"], leg) for leg in range(1, legs + 1) for row in opponents if already[row["id"]] < leg]
    placed = _assign(demands, usable, free)
    settings = matchday_settings(tournament)
    balance = _home_balance(duels, new_id)
    per_opponent: dict[str, list[int]] = {}
    for week in sorted(placed):
        per_opponent.setdefault(placed[week][0], []).append(week)
    pairings = []
    # Hin- und Rückrunde: Steht schon ein Spiel der Paarung, bekommt das neue dessen getauschte Seiten (Review #2422).
    first_home: dict[str, bool] = {}
    for row in opponents:
        if already[row["id"]] == 1:
            existing = next(match for match in duels if match.get("status") not in GONE_STATUSES
                            and set(duel_sides(match)) == {new_id, row["id"]})
            first_home[row["id"]] = duel_sides(existing)[0] == new_id
    for week in sorted(placed):
        opponent_id = placed[week][0]
        if opponent_id in first_home:
            # Hin- und Rückspiel: das spätere mit getauschten Seiten.
            new_home = not first_home[opponent_id]
        else:
            # Heimrecht nach dem Ausgleich des Gegners, bei Gleichstand nach dem des neuen Teams.
            other = _home_balance(duels, opponent_id)
            new_home = other > 0 or (other == 0 and balance <= 0)
            first_home[opponent_id] = new_home
        balance += 1 if new_home else -1
        window = tournament_matchday_window(tournament, week)
        default = default_time_for(tournament, window, weekday=settings["weekday"], hour=settings["hour"], minute=settings["minute"])
        kind, text = _reason(tournament, matches, opponent_id, week, last_regular, names, held)
        home, away = (new_id, opponent_id) if new_home else (opponent_id, new_id)
        pairings.append({
            "opponent_id": opponent_id, "opponent_name": names[opponent_id], "matchday": week,
            "week": calendar_week_of(tournament, week), "starts_at": window.start.isoformat(), "ends_at": window.end.isoformat(),
            "default_at": default.isoformat() if default else None, "home_registration_id": home, "away_registration_id": away,
            "home_name": names[home], "away_name": names[away], "kind": kind, "reason": text})
    missing = []
    for row in opponents:
        wanted = legs - already[row["id"]]
        got = len(per_opponent.get(row["id"], []))
        if got >= wanted:
            continue
        text = (f"Gegen {names[row['id']]} kein Spiel mehr möglich." if got == 0
                else f"Gegen {names[row['id']]} kein zweites Spiel mehr möglich.")
        missing.append({"opponent_id": row["id"], "opponent_name": names[row["id"]], "games": wanted - got, "text": text})
    first = weeks[0] if weeks else None
    # Der Fingerabdruck deckt Ergebnis und Ausgangslage (wer wann frei ist): Ändert sich davon etwas, gilt die Vorschau nicht mehr.
    fingerprint = hashlib.sha256(json.dumps({
        "pairings": [[row["matchday"], row["home_registration_id"], row["away_registration_id"]] for row in pairings],
        "missing": [[row["opponent_id"], row["games"]] for row in missing], "weeks": usable,
        "free": {key: sorted(value) for key, value in free.items()}}, sort_keys=True).encode()).hexdigest()[:24]
    return {"registration_id": new_id, "name": names[new_id], "state": (registration.get("late_entry") or {}).get("state"),
            "legs": legs, "from_matchday": first, "from_week": calendar_week_of(tournament, first) if first else None,
            "open_weeks": [calendar_week_of(tournament, week) for week in weeks], "pairings": pairings, "missing": missing,
            "existing": len(own_busy), "fingerprint": fingerprint, "now": _local(moment),
            "notes": _notes(tournament, duels, weeks, {new_id, *(row["id"] for row in opponents)}, names, last, held)}


def _keys(matches) -> tuple[set[str], int]:
    keys = {str(match.get("match_key")) for match in matches if match.get("match_key")}
    return keys, max((int(match.get("order") or 0) for match in matches), default=0)


def _next_key(keys: set[str], start: int) -> tuple[str, int]:
    from services.custom_bracket import _match_key

    index = start
    while _match_key(index) in keys:
        index += 1
    keys.add(_match_key(index))
    return _match_key(index), index + 1


def match_docs(tournament: dict, preview: dict, matches: list[dict], registrations: list[dict], now: datetime | None = None) -> list[dict]:
    """Die neuen Spiele in derselben Form wie die beim Start erzeugten (``custom_bracket.build_matches_v2_from_schema``)."""
    duels = league_duels(matches)
    template = sorted(duels, key=lambda row: (row.get("round") or 0, row.get("order") or 0))[0]
    users = {row["id"]: row.get("user_id") for row in registrations}
    keys, order = _keys(matches)
    index = len(keys)
    stamp = (now or _now()).isoformat()
    docs = []
    for row in preview["pairings"]:
        key, index = _next_key(keys, index)
        order += 1
        slots = []
        for number, registration_id in enumerate((row["home_registration_id"], row["away_registration_id"]), start=1):
            slots.append({"slot": number, "source": {"type": "late_entry"}, "registration_id": registration_id,
                          "user_id": users.get(registration_id), "seed": None, "status": "filled"})
        docs.append({
            "id": str(uuid.uuid4()), "tournament_id": tournament["id"], "stage_id": template.get("stage_id"),
            "stage_number": template.get("stage_number"), "stage_type": template.get("stage_type") or "league",
            "match_type": template.get("match_type") or "duel", "match_key": key, "section": template.get("section") or "LIGA",
            "round": row["matchday"], "round_name": f"Spieltag {row['matchday']}", "order": order, "slots": slots,
            "results": [], "advancement": [], "settings": copy.deepcopy(template.get("settings") or {}), "status": "ready",
            "is_preview": False, "generation_mode": GENERATION_MODE, "late_entry": True, "scheduled_at": None,
            "station_id": None, "created_at": stamp, "updated_at": stamp})
    return docs


async def load(db, tournament_id: str) -> tuple[list[dict], list[dict]]:
    registrations = await db.tournament_registrations.find({"tournament_id": tournament_id}, {"_id": 0}).to_list(1000)
    matches = await db.matches_v2.find({"tournament_id": tournament_id, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(3000)
    return registrations, matches


async def held_registrations(db, tournament_id: str, now: datetime | None = None) -> set[str]:
    """Nr. 188: Teams, deren Disqualifikation noch nicht endgültig ist - vorläufig, ein Einspruch offen oder die Einspruchsfrist
    läuft. Ihre abgesagten Spiele geben die Woche nicht frei."""
    from services.league_sanction_bans import FINAL, OPEN as APPEAL_OPEN, appeal_refusal

    held = set()
    async for doc in db.competition_sanctions.find({"tournament_id": tournament_id, "kind": "disqualification", "revoked_at": None},
                                                   {"_id": 0}):
        if not doc.get("registration_id"):
            continue
        if doc.get("state") != FINAL or (doc.get("appeal") or {}).get("state") == APPEAL_OPEN or appeal_refusal(doc, now) is None:
            held.add(doc["registration_id"])
    return held


async def preview(db, tournament: dict, registration_id: str, now: datetime | None = None) -> dict:
    registrations, matches = await load(db, tournament["id"])
    registration = next((row for row in registrations if row["id"] == registration_id), None)
    if not registration or not registration.get("late_entry"):
        raise LateEntryProblem(GONE, 404)
    out = plan(tournament, registration, registrations, matches, now, await held_registrations(db, tournament["id"], now))
    out["late_entry"] = registration.get("late_entry")
    return out


async def write_schedule(db, tournament: dict, docs: list[dict]) -> int:
    """Der Standardtermin der neuen Spiele - nur sie, bestehende Termine bleiben, wie sie sind."""
    from services.matchday_schedule import _home_rule_managed

    stages = await db.tournament_stages.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(200)
    fresh = await db.matches_v2.find({"id": {"$in": [doc["id"] for doc in docs]}}, {"_id": 0}).to_list(len(docs) + 1)
    writes = schedule_writes(tournament, fresh, [], stages)
    if _home_rule_managed(tournament):
        # Termin-Historie (#2194) wie in persist_matchday_schedule: der Standardtermin als eigene Art.
        for write in writes:
            if write["update"].get("schedule_source") == "default":
                write["history"] = {"id": str(uuid.uuid4()), "at": _now().isoformat(), "kind": "default", "by": None,
                                    "registration_id": None, "from": None, "to": write["update"].get("scheduled_at"),
                                    "reason": None, "request_id": None}
    return await apply_schedule_writes(db, writes)


def done_mark(before: dict, preview_row: dict, docs: list[dict], actor_id: str | None, now: datetime) -> dict:
    return {**before, "state": DONE, "from_matchday": preview_row["from_matchday"], "from_week": preview_row["from_week"],
            "done_at": now.isoformat(), "done_by": actor_id, "created": len(docs), "match_ids": [doc["id"] for doc in docs],
            "missing": [{"opponent_id": row["opponent_id"], "games": row["games"]} for row in preview_row["missing"]]}


async def season_items(db, season_id: str) -> list[dict]:
    """Die Nachmeldungen aller Staffeln der Season für die Verwaltung: offene zuerst."""
    from services.league_scope import ONLY_LEAGUE

    staffeln = await db.tournaments.find({"league_context.season_id": season_id, **ONLY_LEAGUE},
                                         {"_id": 0, "id": 1, "title": 1, "league_context": 1}).to_list(200)
    by_id = {row["id"]: row for row in staffeln}
    if not by_id:
        return []
    rows = await db.tournament_registrations.find({"tournament_id": {"$in": list(by_id)}, "late_entry": {"$exists": True}},
                                                  {"_id": 0, "id": 1, "tournament_id": 1, "display_name": 1, "team_name": 1, "squad_name": 1,
                                                   "late_entry": 1, "status": 1, "removal": 1}).to_list(500)
    items = []
    for row in rows:
        late = row.get("late_entry") or {}
        staffel = by_id[row["tournament_id"]]
        items.append({"registration_id": row["id"], "tournament_id": row["tournament_id"], "name": _name(row),
                      "staffel": (staffel.get("league_context") or {}).get("staffel"), "staffel_title": staffel.get("title"),
                      "state": late.get("state"), "from_week": late.get("from_week"), "created": late.get("created"),
                      "missing": len(late.get("missing") or []), "active": is_active(row)})
    items.sort(key=lambda item: (item["state"] != OPEN, item["name"].lower()))
    return items


async def _notify(db, tournament: dict, registration: dict, docs: list[dict], registrations: list[dict]) -> None:
    """Die neuen Gegner und das neue Team erfahren ihre Spiele - keine stille Änderung am Spielplan eines Teams."""
    from services.match_audience import responsible_ids, teams_by_id
    from services.user_notifications import create_user_notification

    by_id = {row["id"]: row for row in registrations}
    sides = [by_id[side] for doc in docs for side in duel_sides(doc) if side in by_id]
    teams = await teams_by_id(db, sides)
    title = (tournament or {}).get("title") or "Liga"
    for doc in docs:
        home, away = duel_sides(doc)
        week = calendar_week_of(tournament, doc["round"])
        for side_id, other_id in ((home, away), (away, home)):
            side, other = by_id.get(side_id), by_id.get(other_id)
            if not side:
                continue
            for user_id in sorted(responsible_ids(side, teams.get(side.get("team_id") or ""))):
                await create_user_notification(
                    user_id, f"Neues Ligaspiel: {title}",
                    f"Woche {week}: gegen {_name(other)} (Nachmeldung). Der Termin folgt den Regeln der Staffel.",
                    url=f"/matches/{doc['id']}", kind="match_attention",
                    meta={"category": "tournament_updates", "dedupe_key": f"late-entry:{doc['id']}:{user_id}",
                          "match_id": doc["id"], "tournament_id": tournament.get("id")})


async def _insert(db, docs: list[dict]) -> None:
    await db.matches_v2.insert_many([dict(doc) for doc in docs])


async def _mark_done(db, tournament_id: str, registration_id: str, mark: dict, now: datetime) -> bool:
    written = await db.tournament_registrations.update_one(
        {"id": registration_id, "tournament_id": tournament_id, "late_entry.state": OPEN},
        {"$set": {"late_entry": mark, "updated_at": now.isoformat()}})
    return bool(written.modified_count)


async def conflict_view(db, user: dict, registration: dict) -> dict:
    """Für die Vorschau (Nr. 187): gehört die Person zum Team? Dann bestätigt eine andere, der Superadmin nur mit Grund."""
    from services.league_permissions import side_conflict

    conflict = await side_conflict(db, user, registration)
    return {"own_team": bool(conflict), "superadmin": bool(conflict and conflict.get("override"))}


async def apply(db, tournament_id: str, registration_id: str, fingerprint: str | None, actor: dict,
                conflict_reason: str | None = None) -> dict:
    """Die Spiele aus der Vorschau anlegen - unter der Turnier- und der Season-Sperre (wie beim Zuteilen) und nur, wenn die Vorschau
    noch dieselbe ist. Befangenheit wie beim Annehmen (Nr. 187): Über das eigene Team entscheidet eine andere Person, der Superadmin
    nur mit Grund. Erst die Spiele, dann die Markierung mit Bedingung; scheitert sie, fallen die Spiele wieder weg. Wirft
    ``LateEntryProblem`` bzw. 403."""
    from routes.tournament_common import TOURNAMENT_MUTATION_LOCKED_DETAIL, _is_tournament_locked
    from services.league_final_read import CLOSED_LOCK, is_closed
    from services.league_permissions import record_override, require_no_side_conflict
    from services.league_scope import ONLY_LEAGUE
    from services.mutation_lock import MutationLockBusy, league_season_resource, mutation_lock, tournament_write_resource

    tournament = await db.tournaments.find_one({"id": tournament_id, **ONLY_LEAGUE}, {"_id": 0})
    if not tournament:
        raise LateEntryProblem("Staffel nicht gefunden.", 404)
    first = await db.tournament_registrations.find_one({"id": registration_id, "tournament_id": tournament_id}, {"_id": 0})
    if not first or not first.get("late_entry"):
        raise LateEntryProblem(GONE, 404)
    # Vor allem anderen: Die befangene Person erfährt schnell „nicht du“ (wie im Eingang).
    await require_no_side_conflict(db, actor, first, conflict_reason=conflict_reason)
    season_id = (tournament.get("league_context") or {}).get("season_id")
    try:
        async with mutation_lock(db, tournament_write_resource(tournament_id)):
            async with mutation_lock(db, league_season_resource(season_id)):
                tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0})
                if _is_tournament_locked(tournament):
                    raise LateEntryProblem(TOURNAMENT_MUTATION_LOCKED_DETAIL, 423)
                if is_closed(tournament):
                    raise LateEntryProblem(CLOSED_LOCK, 409)
                if tournament.get("status") in FINISHED_STATUSES:
                    raise LateEntryProblem(FINISHED, 409)
                registrations, matches = await load(db, tournament_id)
                registration = next((row for row in registrations if row["id"] == registration_id), None)
                if not registration or not registration.get("late_entry"):
                    raise LateEntryProblem(GONE, 404)
                override = await require_no_side_conflict(db, actor, registration, conflict_reason=conflict_reason)
                if registration["late_entry"].get("state") != OPEN or not is_active(registration):
                    raise LateEntryProblem(NOT_OPEN, 409)
                if not has_fixed_plan(matches):
                    raise LateEntryProblem(NO_PLAN, 409)
                now = _now()
                row = plan(tournament, registration, registrations, matches, now, await held_registrations(db, tournament_id, now))
                if not fingerprint or fingerprint != row["fingerprint"]:
                    raise LateEntryProblem(CHANGED, 409)
                docs = match_docs(tournament, row, matches, registrations, now)
                mark = done_mark(registration["late_entry"], row, docs, actor.get("id"), now)
                if docs:
                    try:
                        await _insert(db, docs)
                    except Exception:
                        # Ein Teil kann schon stehen: ohne Markierung keine halben Spiele.
                        await db.matches_v2.delete_many({"id": {"$in": [doc["id"] for doc in docs]}})
                        raise
                try:
                    marked = await _mark_done(db, tournament_id, registration_id, mark, now)
                except Exception:
                    marked = None
                if not marked:
                    await db.matches_v2.delete_many({"id": {"$in": [doc["id"] for doc in docs]}})
                    if marked is None:
                        raise LateEntryProblem(BUSY, 409)
                    raise LateEntryProblem(NOT_OPEN, 409)
                if docs:
                    await write_schedule(db, tournament, docs)
    except MutationLockBusy:
        raise LateEntryProblem(BUSY, 409) from None
    if override:
        await record_override(db, actor, action="late_entry", target_id=tournament_id, reason=override, registration_id=registration_id)
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "action": "league.staffel.late_entry", "actor_id": actor.get("id"), "target_id": tournament_id,
        "data": {"tournament_id": tournament_id, "season_id": season_id, "registration_id": registration_id, "from_week": row["from_week"],
                 "match_ids": [doc["id"] for doc in docs], "missing": [item["opponent_id"] for item in row["missing"]],
                 **({"conflict_override": override} if override else {})},
        "created_at": now.isoformat()})
    try:
        await _notify(db, tournament, registration, docs, registrations)
    except Exception:  # noqa: BLE001 - die Spiele stehen, eine Nachricht hält sie nie auf
        from services.log_safe import log_safe

        logger.warning("[liga] Nachricht zur Nachmeldung nicht verschickt: %s", log_safe(registration_id), exc_info=True)
    return {**row, "state": DONE, "late_entry": mark, "match_ids": [doc["id"] for doc in docs]}
