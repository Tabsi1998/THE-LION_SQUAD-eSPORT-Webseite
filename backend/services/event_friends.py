"""Freunde beim Event (#1188): welche deiner bestätigten Freunde bei einem Event angemeldet sind - nur für dich.

Datenschutz (Label „privacy“) - die Regeln stehen hier an einer Stelle:
- Nur bestätigte Freundschaften (``status: accepted``). Offene, abgelehnte, zurückgezogene oder beendete Anfragen
  zeigen nichts. Gäste bekommen nichts (die Route verlangt ein Konto); Fremde sehen über diesen Weg keine Namen.
- Blockiert eine der beiden Seiten die andere, fehlt die Person - in beide Richtungen.
- Gesperrte, deaktivierte und gelöschte Konten fehlen.
- Die Person entscheidet selbst: „Freunde sehen, wo ich angemeldet bin“ (``privacy_friends_see_registrations``).
  Standard an (Fabians Wahl B); mit hinterlegtem Geburtsdatum unter 14 Jahren Standard aus, bis die Person es selbst
  einschaltet. Ausschalten wirkt sofort, weil jede Abfrage neu rechnet.
- Gezeigt werden nur Event-Anmeldungen (angemeldet oder eingecheckt) und Anmeldungen bei Turnieren des Events, die die
  fragende Person selbst sehen darf (keine Entwürfe, nichts Nichtöffentliches, „Nur Mitglieder“ nur für Mitglieder),
  bei Team-Turnieren mit dem Teamnamen. Warteliste, Storno und „nicht erschienen“ zählen nicht.
- Aus dem Profil nur, was die Freundesliste ohnehin zeigt: Anzeigename, Bild, Nutzername - den Nutzernamen (für den
  Link aufs Profil) nur, wenn das Profil öffentlich ist; sonst führt der Link ins Leere.
- Der einmalige Hinweis „Deine Freunde sehen, zu welchen Events du angemeldet bist“ erscheint, sobald es für die Person
  selbst wirkt (sie ist beim Event dabei und teilt ihre Anmeldungen) - bis sie ihn bestätigt oder ausschaltet.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from services.visibility import lead_can_see

VIENNA = ZoneInfo("Europe/Vienna")
SETTING = "privacy_friends_see_registrations"
HINT_FIELD = "friends_registrations_hint_seen_at"
YOUTH_AGE = 14
EVENT_STATUSES = ("registered", "checked_in")
TOURNAMENT_STATUSES = ("approved", "checked_in")
HIDDEN_TOURNAMENT_STATUSES = ("draft", "cancelled")
MAX_FRIENDS = 200


def _today() -> date:
    return datetime.now(timezone.utc).astimezone(VIENNA).date()


def age_on(birth_date, today: date | None = None) -> int | None:
    """Alter in ganzen Jahren am Wiener Tag ``today`` - ohne lesbares Geburtsdatum ``None``."""
    if not birth_date:
        return None
    try:
        born = date.fromisoformat(str(birth_date)[:10])
    except ValueError:
        return None
    today = today or _today()
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def sharing_default(user: dict, today: date | None = None) -> bool:
    """Standard ohne eigene Wahl: an - außer mit Geburtsdatum unter 14 Jahren."""
    age = age_on(user.get("birth_date"), today)
    return not (age is not None and age < YOUTH_AGE)


def shares_registrations(user: dict, today: date | None = None) -> bool:
    """Ob Freunde die Anmeldungen der Person sehen: die eigene Wahl, sonst der Standard."""
    value = user.get(SETTING)
    if isinstance(value, bool):
        return value
    return sharing_default(user, today)


async def accepted_friend_ids(db, user_id: str) -> set[str]:
    ids: set[str] = set()
    async for row in db.friendships.find(
        {"status": "accepted", "$or": [{"requester_id": user_id}, {"recipient_id": user_id}]},
        {"_id": 0, "requester_id": 1, "recipient_id": 1},
    ):
        other = row.get("recipient_id") if row.get("requester_id") == user_id else row.get("requester_id")
        if other and other != user_id:
            ids.add(other)
    return ids


async def blocked_ids(db, user_id: str) -> set[str]:
    """Alle, die die Person blockiert hat oder von denen sie blockiert wurde."""
    ids: set[str] = set()
    async for row in db.user_blocks.find({"$or": [{"blocker_id": user_id}, {"blocked_id": user_id}]}, {"_id": 0, "blocker_id": 1, "blocked_id": 1}):
        ids.add(row.get("blocked_id") if row.get("blocker_id") == user_id else row.get("blocker_id"))
    ids.discard(None)
    return ids


async def visible_tournaments(db, event: dict, viewer: dict) -> list[dict]:
    rows = await db.tournaments.find(
        {"event_id": event["id"], "status": {"$nin": list(HIDDEN_TOURNAMENT_STATUSES)}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "team_mode": 1, "visibility": 1, "is_public": 1, "start_date": 1},
    ).sort("start_date", 1).to_list(200)
    out = []
    for row in rows:
        if row.get("is_public") is False:
            continue
        if await lead_can_see(viewer, row.get("visibility") or "public"):
            out.append(row)
    return out


async def _team_members(db, user_ids: set[str]) -> dict[str, set[str]]:
    """Team → die Freunde darin (aus der Mitgliederliste des Teams und aus ``team_members``)."""
    members: dict[str, set[str]] = {}
    async for team in db.teams.find({"member_ids": {"$in": list(user_ids)}}, {"_id": 0, "id": 1, "member_ids": 1}):
        members.setdefault(team["id"], set()).update(set(team.get("member_ids") or []) & user_ids)
    async for row in db.team_members.find({"user_id": {"$in": list(user_ids)}}, {"_id": 0, "team_id": 1, "user_id": 1}):
        if row.get("team_id"):
            members.setdefault(row["team_id"], set()).add(row["user_id"])
    return members


async def viewer_takes_part(db, event: dict, viewer: dict, tournaments: list[dict]) -> bool:
    """Ist die fragende Person selbst beim Event dabei (Event oder eines seiner Turniere, auch mit dem Team)?"""
    if await db.event_registrations.find_one({"event_id": event["id"], "user_id": viewer["id"], "status": {"$in": list(EVENT_STATUSES)}}, {"_id": 0, "id": 1}):
        return True
    if not tournaments:
        return False
    teams = list((await _team_members(db, {viewer["id"]})).keys())
    query = {"tournament_id": {"$in": [t["id"] for t in tournaments]}, "status": {"$in": list(TOURNAMENT_STATUSES)},
             "$or": [{"user_id": viewer["id"]}] + ([{"team_id": {"$in": teams}}] if teams else [])}
    return bool(await db.tournament_registrations.find_one(query, {"_id": 0, "id": 1}))


async def friends_at_event(db, event: dict, viewer: dict) -> dict:
    """Die Zeile „Von deinen Freunden dabei“ - nur Freunde, die es erlauben, mit Event bzw. Turnier und Teamname."""
    tournaments = await visible_tournaments(db, event, viewer)
    sharing = shares_registrations(viewer)
    hint = sharing and not viewer.get(HINT_FIELD) and await viewer_takes_part(db, event, viewer, tournaments)
    result = {"friends": [], "sharing": sharing, "hint": bool(hint)}

    candidates = await accepted_friend_ids(db, viewer["id"])
    candidates -= await blocked_ids(db, viewer["id"])
    if not candidates:
        return result
    users = await db.users.find(
        {"id": {"$in": list(candidates)}, "is_active": {"$ne": False}, "is_banned": {"$ne": True}, "anonymized_at": {"$exists": False}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "birth_date": 1, "privacy_public_profile": 1, SETTING: 1},
    ).to_list(MAX_FRIENDS * 5)
    allowed = {user["id"]: user for user in users if shares_registrations(user)}
    if not allowed:
        return result
    ids = set(allowed)

    where: dict[str, list[dict]] = {}
    async for reg in db.event_registrations.find({"event_id": event["id"], "user_id": {"$in": list(ids)}, "status": {"$in": list(EVENT_STATUSES)}},
                                                 {"_id": 0, "user_id": 1}):
        where.setdefault(reg["user_id"], []).append({"kind": "event"})

    if tournaments:
        by_id = {t["id"]: t for t in tournaments}
        team_members = await _team_members(db, ids)
        query = {"tournament_id": {"$in": list(by_id)}, "status": {"$in": list(TOURNAMENT_STATUSES)},
                 "$or": [{"user_id": {"$in": list(ids)}}] + ([{"team_id": {"$in": list(team_members)}}] if team_members else [])}
        regs = await db.tournament_registrations.find(query, {"_id": 0, "tournament_id": 1, "user_id": 1, "team_id": 1, "display_name": 1}).to_list(5000)
        team_ids = {reg["team_id"] for reg in regs if reg.get("team_id")}
        team_names = {}
        if team_ids:
            team_names = {team["id"]: team.get("name") for team in await db.teams.find({"id": {"$in": list(team_ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(team_ids) + 1)}
        for reg in regs:
            tournament = by_id[reg["tournament_id"]]
            if reg.get("team_id"):
                people = set(team_members.get(reg["team_id"], set()))
                if reg.get("user_id") in ids:
                    people.add(reg["user_id"])
                team_name = team_names.get(reg["team_id"]) or reg.get("display_name") or None
            else:
                people = {reg.get("user_id")} & ids
                team_name = None
            for person in people:
                entry = {"kind": "tournament", "id": tournament["id"], "slug": tournament.get("slug"), "title": tournament.get("title") or "Turnier", "team_name": team_name}
                if entry not in where.setdefault(person, []):
                    where[person].append(entry)

    friends = []
    for user_id, places in where.items():
        user = allowed[user_id]
        friends.append({
            "id": user_id,
            "display_name": user.get("display_name") or user.get("username") or "Freund",
            "avatar_url": user.get("avatar_url"),
            "username": user.get("username") if user.get("privacy_public_profile") else None,
            "where": places,
        })
    friends.sort(key=lambda friend: str(friend["display_name"]).casefold())
    result["friends"] = friends[:MAX_FRIENDS]
    return result
