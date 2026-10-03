"""Turnier nur mit Event-Anmeldung (#875): gehört ein Turnier zu einem Event und ist der Schalter an, meldet sich nur an,
wer beim Event bestätigt angemeldet ist - bei Teams mindestens so viele Mitglieder, wie ein Team Spieler hat (eine feste
Aufstellung gibt es bei der Anmeldung nicht). So lässt sich die Event-Anmeldung (Platz, Kostenbeitrag) nicht über das
Turnier umgehen.

- **Bestätigt** heißt angemeldet oder eingecheckt; Warteliste, abgemeldet und „nicht erschienen“ zählen nicht. Bezahlt
  muss nichts sein - die Rechnung läuft über das Event.
- **Die Turnierleitung** darf beim Eintragen von Hand übergehen (Hinweis und Audit). Zugangslinks sind keine Ausnahme.
- **Springt später jemand vom Event ab,** bleibt die Turnieranmeldung; die Teilnehmerliste zeigt es der Turnierleitung.
"""
from __future__ import annotations

ACTIVE_STATUSES = ("registered", "checked_in")
MAX_NAMES = 8


def required(tournament: dict | None) -> bool:
    """Gilt die Regel? Nur mit Schalter und Event."""
    return bool(tournament and tournament.get("requires_event_registration") and tournament.get("event_id"))


async def event_of(db, tournament: dict | None) -> dict | None:
    """Das Event des Turniers, wenn die Regel gilt - ein gelöschtes Event hebt sie auf."""
    if not required(tournament):
        return None
    return await db.events.find_one({"id": tournament["event_id"]}, {"_id": 0, "id": 1, "name": 1, "slug": 1})


async def registered_among(db, event_id: str, user_ids) -> set[str]:
    """Wer von diesen Konten beim Event bestätigt angemeldet ist."""
    ids = [user_id for user_id in user_ids or [] if user_id]
    if not ids:
        return set()
    rows = await db.event_registrations.find(
        {"event_id": event_id, "user_id": {"$in": ids}, "status": {"$in": list(ACTIVE_STATUSES)}},
        {"_id": 0, "user_id": 1},
    ).to_list(len(ids) + 10)
    return {row["user_id"] for row in rows if row.get("user_id")}


def team_need(tournament: dict) -> int:
    """So viele Teammitglieder müssen beim Event sein: so viele, wie ein Team Spieler hat."""
    try:
        return max(1, int(tournament.get("team_size") or 1))
    except (TypeError, ValueError):
        return 1


async def _names(db, user_ids: list[str]) -> list[str]:
    if not user_ids:
        return []
    rows = await db.users.find({"id": {"$in": user_ids[:MAX_NAMES]}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(MAX_NAMES)
    by_id = {row["id"]: row.get("display_name") or row.get("username") or "" for row in rows}
    return [by_id[user_id] for user_id in user_ids[:MAX_NAMES] if by_id.get(user_id)]


def _team_text(event_name: str, need: int, have: int, names: list[str]) -> str:
    text = (f"Für dieses Turnier müssen mindestens {need} Spieler des Teams beim Event „{event_name}“ angemeldet sein – "
            f"angemeldet {'ist' if have == 1 else 'sind'} {have}.")
    return text + (f" Noch nicht angemeldet: {', '.join(names)}." if names else "")


async def check(db, tournament: dict, *, user: dict | None = None, team: dict | None = None) -> dict | None:
    """Der Stand für eine Anmeldung: None, wenn die Regel nicht gilt; sonst ``ok``, ``need``, ``have``, ``missing``
    (Namen aus dem Team), ``text`` (die Erklärung, wenn es nicht reicht) und ``event``."""
    event = await event_of(db, tournament)
    if not event:
        return None
    name = event.get("name") or "Event"
    if team is not None:
        members = [member for member in team.get("member_ids") or [] if member]
        registered = await registered_among(db, event["id"], members)
        need, have = team_need(tournament), len(registered)
        missing = await _names(db, [member for member in members if member not in registered])
        ok = have >= need
        return {"ok": ok, "need": need, "have": have, "missing": missing, "event": event, "text": "" if ok else _team_text(name, need, have, missing)}
    if user is not None:
        ok = user.get("id") in await registered_among(db, event["id"], [user.get("id")])
        text = "" if ok else f"Für dieses Turnier musst du zuerst beim Event „{name}“ angemeldet sein."
        return {"ok": ok, "need": 1, "have": 1 if ok else 0, "missing": [], "event": event, "text": text}
    return None


async def viewer_state(db, tournament: dict, viewer: dict | None) -> dict | None:
    """Für die Turnierseite: gilt die Regel, zu welchem Event, und ist die ansehende Person dort angemeldet?"""
    event = await event_of(db, tournament)
    if not event:
        return None
    registered = bool(viewer) and viewer.get("id") in await registered_among(db, event["id"], [viewer.get("id")])
    return {"required": True, "event": event, "registered": registered, "team_need": team_need(tournament) if (tournament.get("team_mode") or "solo") != "solo" else 1}


async def staff_marks(db, tournament: dict, registrations: list[dict], teams: dict[str, dict]) -> dict[str, dict]:
    """Für die Turnierleitung: je Anmeldung, ob die Event-Anmeldung (noch) reicht - mit einer Abfrage für alle."""
    event = await event_of(db, tournament)
    if not event:
        return {}
    people = set()
    for row in registrations:
        if row.get("team_id"):
            people.update(member for member in (teams.get(row["team_id"]) or {}).get("member_ids") or [] if member)
        elif row.get("user_id"):
            people.add(row["user_id"])
    registered = await registered_among(db, event["id"], sorted(people))
    need = team_need(tournament)
    marks = {}
    for row in registrations:
        if row.get("team_id"):
            members = [member for member in (teams.get(row["team_id"]) or {}).get("member_ids") or [] if member]
            have = sum(1 for member in members if member in registered)
            marks[row["id"]] = {"ok": have >= need, "label": f"Event: {have} von {need} angemeldet"}
        elif row.get("user_id"):
            ok = row["user_id"] in registered
            marks[row["id"]] = {"ok": ok, "label": "beim Event angemeldet" if ok else "nicht beim Event angemeldet"}
    return marks
