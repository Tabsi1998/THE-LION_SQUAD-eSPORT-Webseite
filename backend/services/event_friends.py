"""Freunde beim Event, Turnier und Fast Lap (#1188): welche deiner bestätigten Freunde dabei sind - nur für dich.

Drei Bereiche, ein Regelwerk: ``friends_at_event`` (Event-Seite), ``friends_at_tournament`` (Turnierseite) und
``friends_at_challenge`` (Fast-Lap-Seite). Bei Fast Laps gibt es keine eigene Anmeldung (Fabians Entscheidung): dort
gilt als „angemeldet“, wer eine gültige Zeit hat (nicht ungültig, keine Vereins-Referenzzeit).

Datenschutz (Label „privacy“) - die Regeln stehen hier an einer Stelle:
- Nur bestätigte Freundschaften (``status: accepted``). Offene, abgelehnte, zurückgezogene oder beendete Anfragen
  zeigen nichts. Gäste bekommen nichts (die Route verlangt ein Konto); Fremde sehen über diesen Weg keine Namen.
- Blockiert eine der beiden Seiten die andere, fehlt die Person - in beide Richtungen.
- Gesperrte, deaktivierte und gelöschte Konten fehlen.
- Die Person entscheidet selbst: „Freunde sehen, wo ich angemeldet bin“ (``privacy_friends_see_registrations``).
  Standard an (Fabians Wahl B); mit hinterlegtem Geburtsdatum unter 14 Jahren Standard aus, bis die Person es selbst
  einschaltet. Ausschalten wirkt sofort, weil jede Abfrage neu rechnet.
- Gezeigt werden nur Event-Anmeldungen (angemeldet oder eingecheckt), Anmeldungen bei Turnieren und gültige Zeiten bei
  Fast Laps des Events, die die fragende Person selbst sehen darf (keine Entwürfe, nichts Abgesagtes, nichts
  Nichtöffentliches, „Nur Mitglieder“ nur für Mitglieder), bei Team-Turnieren mit dem Teamnamen. Warteliste, Storno und „nicht erschienen“ zählen nicht. Zu einem Team zählt,
  wer in der gespeicherten Aufstellung steht bzw. vor dem Turnier beigetreten ist - nie das heutige Team
  (``services/event_roster.py``).
- Aus dem Profil nur, was die Freundesliste ohnehin zeigt: Anzeigename, Bild, Nutzername - den Nutzernamen (für den
  Link aufs Profil) nur, wenn das Profil öffentlich ist; sonst führt der Link ins Leere.
- Der einmalige Hinweis „Deine Freunde sehen, zu welchen Events du angemeldet bist“ erscheint, sobald es für die Person
  selbst wirkt: direkt nach der ersten Anmeldung (``hint_due``, Event oder Turnier) und auf jeder Seite, auf der sie
  selbst dabei ist - bis sie ihn bestätigt oder ausschaltet.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from services.event_roster import registration_players
from services.fastlap_standings import official_query
from services.visibility import lead_can_see

VIENNA = ZoneInfo("Europe/Vienna")
SETTING = "privacy_friends_see_registrations"
HINT_FIELD = "friends_registrations_hint_seen_at"
YOUTH_AGE = 14
EVENT_STATUSES = ("registered", "checked_in")
TOURNAMENT_STATUSES = ("approved", "checked_in")
HIDDEN_TOURNAMENT_STATUSES = ("draft", "cancelled")
HIDDEN_CHALLENGE_STATUSES = ("draft", "cancelled")
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
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "team_mode": 1, "visibility": 1, "is_public": 1, "start_date": 1, "end_date": 1},
    ).sort("start_date", 1).to_list(200)
    out = []
    for row in rows:
        if row.get("is_public") is False:
            continue
        if await lead_can_see(viewer, row.get("visibility") or "public"):
            out.append(row)
    return out


async def tournament_players(db, tournaments: list[dict]) -> list[tuple[dict, set[str]]]:
    """Gültige Anmeldungen der sichtbaren Turniere mit den Personen, die dazu gehören - Teams nach gespeicherter
    Aufstellung bzw. Beitrittsdatum (``services/event_roster.py``), nie nach dem heutigen Team."""
    if not tournaments:
        return []
    regs = await db.tournament_registrations.find(
        {"tournament_id": {"$in": [t["id"] for t in tournaments]}, "status": {"$in": list(TOURNAMENT_STATUSES)}},
        {"_id": 0, "id": 1, "tournament_id": 1, "user_id": 1, "team_id": 1, "display_name": 1, "lineup": 1, "substitutes": 1},
    ).to_list(50000)
    players = await registration_players(db, regs, {t["id"]: t for t in tournaments})
    return [(reg, players.get(reg["id"], set())) for reg in regs]


async def visible_challenges(db, event: dict, viewer: dict) -> list[dict]:
    """Die Fast Laps des Events, die die Person auf der Event-Seite sähe - keine Entwürfe, nichts Abgesagtes."""
    rows = await db.f1_challenges.find(
        {"event_id": event["id"], "status": {"$nin": list(HIDDEN_CHALLENGE_STATUSES)}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "status": 1, "visibility": 1, "start_date": 1},
    ).sort("start_date", 1).to_list(200)
    return [row for row in rows if await lead_can_see(viewer, row.get("visibility") or "public")]


async def fastlap_drivers(db, challenges: list[dict], user_ids: set[str]) -> dict[str, set[str]]:
    """Fast Lap → wer von ``user_ids`` dort eine gültige Zeit hat. Das ist bei Fast Laps die „Anmeldung“."""
    if not challenges or not user_ids:
        return {}
    out: dict[str, set[str]] = {}
    query = official_query({"challenge_id": {"$in": [c["id"] for c in challenges]}, "user_id": {"$in": list(user_ids)}})
    async for row in db.f1_lap_times.find(query, {"_id": 0, "challenge_id": 1, "user_id": 1}):
        if row.get("user_id"):
            out.setdefault(row["challenge_id"], set()).add(row["user_id"])
    return out


async def viewer_takes_part(db, event: dict, viewer: dict, entries: list[tuple[dict, set[str]]]) -> bool:
    """Ist die fragende Person selbst beim Event dabei (Event oder eines seiner Turniere, auch im Team)?"""
    if await db.event_registrations.find_one({"event_id": event["id"], "user_id": viewer["id"], "status": {"$in": list(EVENT_STATUSES)}}, {"_id": 0, "id": 1}):
        return True
    return any(viewer["id"] in people for _reg, people in entries)


def _hint_open(viewer: dict) -> bool:
    return shares_registrations(viewer) and not viewer.get(HINT_FIELD)


async def hint_due(db, viewer: dict) -> bool:
    """Der einmalige Hinweis direkt nach der ersten Anmeldung: die Person teilt ihre Anmeldungen, hat den Hinweis noch
    nicht beantwortet und ist irgendwo verbindlich angemeldet - bei einem Event oder selbst bei einem Turnier (als
    anmeldende Person oder in der gespeicherten Aufstellung). Warteliste, offene und stornierte Anmeldungen zählen nicht,
    weil Freunde sie auch nicht sehen."""
    if not _hint_open(viewer):
        return False
    user_id = viewer["id"]
    if await db.event_registrations.find_one({"user_id": user_id, "status": {"$in": list(EVENT_STATUSES)}}, {"_id": 0, "id": 1}):
        return True
    return bool(await db.tournament_registrations.find_one(
        {"status": {"$in": list(TOURNAMENT_STATUSES)}, "$or": [{"user_id": user_id}, {"lineup": user_id}, {"substitutes": user_id}]}, {"_id": 0, "id": 1}))


async def allowed_friends(db, viewer: dict) -> dict[str, dict]:
    """Bestätigte Freunde ohne Blockierung, mit aktivem Konto, die ihre Anmeldungen teilen - nach Kennung."""
    candidates = await accepted_friend_ids(db, viewer["id"])
    candidates -= await blocked_ids(db, viewer["id"])
    if not candidates:
        return {}
    users = await db.users.find(
        {"id": {"$in": list(candidates)}, "is_active": {"$ne": False}, "is_banned": {"$ne": True}, "anonymized_at": {"$exists": False}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "birth_date": 1, "privacy_public_profile": 1, SETTING: 1},
    ).to_list(MAX_FRIENDS * 5)
    return {user["id"]: user for user in users if shares_registrations(user)}


def _add(where: dict[str, list[dict]], person: str, entry: dict) -> None:
    if entry not in where.setdefault(person, []):
        where[person].append(entry)


async def _add_tournament_places(db, where: dict, tournaments: list[dict], entries: list[tuple[dict, set[str]]], ids: set[str]) -> None:
    by_id = {t["id"]: t for t in tournaments}
    team_ids = {reg["team_id"] for reg, people in entries if reg.get("team_id") and people & ids}
    team_names = {}
    if team_ids:
        team_names = {team["id"]: team.get("name") for team in await db.teams.find({"id": {"$in": list(team_ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(team_ids) + 1)}
    for reg, people in entries:
        tournament = by_id[reg["tournament_id"]]
        team_name = (team_names.get(reg["team_id"]) or reg.get("display_name") or None) if reg.get("team_id") else None
        for person in people & ids:
            _add(where, person, {"kind": "tournament", "id": tournament["id"], "slug": tournament.get("slug"), "title": tournament.get("title") or "Turnier",
                                 "team_name": team_name})


def _add_fastlap_places(where: dict, challenges: list[dict], drivers: dict[str, set[str]], ids: set[str]) -> None:
    for challenge in challenges:
        for person in drivers.get(challenge["id"], set()) & ids:
            _add(where, person, {"kind": "fastlap", "id": challenge["id"], "slug": challenge.get("slug"), "title": challenge.get("title") or "Fast Lap"})


def _friend_rows(where: dict[str, list[dict]], allowed: dict[str, dict]) -> list[dict]:
    """Aus dem Profil nur, was die Freundesliste ohnehin zeigt - den Nutzernamen nur bei öffentlichem Profil."""
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
    return friends[:MAX_FRIENDS]


def _result(viewer: dict, hint: bool, where: dict[str, list[dict]], allowed: dict[str, dict]) -> dict:
    return {"friends": _friend_rows(where, allowed), "sharing": shares_registrations(viewer), "hint": bool(hint)}


async def friends_at_event(db, event: dict, viewer: dict) -> dict:
    """Die Zeile „Von deinen Freunden dabei“ auf der Event-Seite - nur Freunde, die es erlauben, mit Event, Turnier
    (samt Teamname) und Fast Lap."""
    tournaments = await visible_tournaments(db, event, viewer)
    entries = await tournament_players(db, tournaments)
    challenges = await visible_challenges(db, event, viewer)
    allowed = await allowed_friends(db, viewer)
    ids = set(allowed)
    drivers = await fastlap_drivers(db, challenges, ids | {viewer["id"]})
    hint = _hint_open(viewer) and (await viewer_takes_part(db, event, viewer, entries) or any(viewer["id"] in people for people in drivers.values()))
    where: dict[str, list[dict]] = {}
    if ids:
        async for reg in db.event_registrations.find({"event_id": event["id"], "user_id": {"$in": list(ids)}, "status": {"$in": list(EVENT_STATUSES)}},
                                                     {"_id": 0, "user_id": 1}):
            _add(where, reg["user_id"], {"kind": "event"})
        await _add_tournament_places(db, where, tournaments, entries, ids)
        _add_fastlap_places(where, challenges, drivers, ids)
    return _result(viewer, hint, where, allowed)


async def friends_at_tournament(db, tournament: dict, viewer: dict) -> dict:
    """Dieselbe Zeile auf der Turnierseite: Freunde mit gültiger Anmeldung bei diesem Turnier, Teams nach gespeicherter
    Aufstellung bzw. Beitritt vor dem Turnier. Ob die Person das Turnier sehen darf, prüft die Route wie die
    Turnierseite; Entwürfe und abgesagte Turniere zeigen keine Freunde."""
    tournaments = [] if tournament.get("status") in HIDDEN_TOURNAMENT_STATUSES else [tournament]
    entries = await tournament_players(db, tournaments)
    allowed = await allowed_friends(db, viewer)
    hint = _hint_open(viewer) and any(viewer["id"] in people for _reg, people in entries)
    where: dict[str, list[dict]] = {}
    if allowed:
        await _add_tournament_places(db, where, tournaments, entries, set(allowed))
    return _result(viewer, hint, where, allowed)


async def friends_at_challenge(db, challenge: dict, viewer: dict) -> dict:
    """Dieselbe Zeile auf der Fast-Lap-Seite: Freunde mit gültiger Zeit. Ob die Person die Fast Lap sehen darf, prüft
    die Route wie die Fast-Lap-Seite; Entwürfe und abgesagte Fast Laps zeigen keine Freunde."""
    challenges = [] if challenge.get("status") in HIDDEN_CHALLENGE_STATUSES else [challenge]
    allowed = await allowed_friends(db, viewer)
    drivers = await fastlap_drivers(db, challenges, set(allowed) | {viewer["id"]})
    hint = _hint_open(viewer) and viewer["id"] in drivers.get(challenge["id"], set())
    where: dict[str, list[dict]] = {}
    _add_fastlap_places(where, challenges, drivers, set(allowed))
    return _result(viewer, hint, where, allowed)
