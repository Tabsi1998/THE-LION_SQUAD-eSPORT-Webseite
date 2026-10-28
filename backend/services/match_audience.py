"""Wer bei Turnier-Anmeldungen welche Nachricht bekommt und was tun darf (#1136) - eine Regel an einer Stelle.

Spieler einer Anmeldung bekommen die Spiel-Hinweise: Aufruf und Erinnerung vor dem Spiel, „Match startet jetzt“,
„Ergebnis bestätigt“, Dispute eröffnet oder entschieden, den Matchchat. Bei Teams sind das alle Mitglieder samt
Teamleitung und Co-Leitung, dazu die Person, die angemeldet hat.

Hat ein Team eine Aufstellung (Team am Spieltag, #1192), gehen Aufruf, Erinnerung, „Match startet jetzt“ und das
Ergebnis nur an die Aufgestellten (``playing_ids``) - Matchchat, Dispute und „Turnier beendet“ weiter ans ganze Team.

Verantwortliche einer Anmeldung erledigen die Aufgaben: einchecken, Ergebnis melden oder bestätigen, Dispute melden,
Termin vorschlagen. Das sind die Person, die angemeldet hat, die Teamleitung und die Co-Leitung. Genau sie bekommen
die Check-in-Erinnerungen, „Turnier Check-in offen“ auf der Startseite und die Bitte, ein Ergebnis zu bestätigen.

Ein Team, das die Turnierleitung ohne Person angemeldet hat, läuft über seine Teamleitung und Co-Leitung.

Co-Team einer Liga (``squad_id`` an der Anmeldung, docs/LIGA.md Abschnitt 4, #1649): Verantwortliche sind Captain und
Vertreter des Co-Teams; hat es keinen von beiden, handelt die Leitung und Co-Leitung des Hauptteams (niemand sperrt
sich aus). Spieler sind der Kader des Co-Teams, die Verantwortlichen und die Leitung des Hauptteams (Matchchat und
Spiel-Hinweise) - nicht die übrigen Mitglieder des Hauptteams. Anmeldungen ohne ``squad_id`` bleiben genau wie oben.

Gesperrte Konten bekommen keine Nachrichten (``users_for``).
"""
from __future__ import annotations

from typing import Iterable

from match_rules import participant_source_ids

TEAM_FIELDS = {"_id": 0, "id": 1, "leader_id": 1, "co_leader_ids": 1, "member_ids": 1}
SQUAD_FIELDS = {"_id": 0, "id": 1, "team_id": 1, "member_ids": 1, "captain_id": 1, "vice_captain_id": 1}
USER_FIELDS = {
    "_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1,
    "notification_preferences": 1, "newsletter_consent": 1,
}


async def teams_by_id(db, registrations: Iterable[dict]) -> dict[str, dict]:
    """Die Teams der Anmeldungen mit Leitung, Co-Leitung und Mitgliedern.

    Mitglieder stehen am Team (``member_ids``) und als eigene Zeilen in ``team_members`` - beide zählen, damit eine
    Nachricht niemanden verliert, nur weil eine der beiden Listen hinterherhinkt. Fehlt am Team die Leitung, gilt die
    Rolle aus ``team_members``.
    """
    registrations = [reg for reg in registrations if reg]
    team_ids = sorted({reg.get("team_id") for reg in registrations if reg.get("team_id")})
    if not team_ids:
        return {}
    rows = await db.teams.find({"id": {"$in": team_ids}}, TEAM_FIELDS).to_list(len(team_ids) + 10)
    teams = {
        row["id"]: {**row, "member_ids": list(row.get("member_ids") or []), "co_leader_ids": list(row.get("co_leader_ids") or [])}
        for row in rows if row.get("id")
    }
    memberships = await db.team_members.find(
        {"team_id": {"$in": team_ids}}, {"_id": 0, "team_id": 1, "user_id": 1, "role": 1},
    ).to_list(50 * len(team_ids) + 50)
    for row in memberships:
        user_id = row.get("user_id")
        if not user_id or not row.get("team_id"):
            continue
        team = teams.setdefault(row["team_id"], {"id": row["team_id"], "member_ids": [], "co_leader_ids": []})
        if user_id not in team["member_ids"]:
            team["member_ids"].append(user_id)
        if row.get("role") == "leader" and not team.get("leader_id"):
            team["leader_id"] = user_id
        if row.get("role") == "co_leader" and user_id not in team["co_leader_ids"]:
            team["co_leader_ids"].append(user_id)
    await _attach_squads(db, teams, registrations)
    return teams


async def _attach_squads(db, teams: dict[str, dict], registrations: Iterable[dict]) -> None:
    """Co-Teams der Anmeldungen (``squad_id``) hängen am Hauptteam unter ``squads`` - nur ihr Kader und ihre Rollen."""
    squad_ids = sorted({reg.get("squad_id") for reg in registrations if reg and reg.get("team_id") and reg.get("squad_id")})
    if not squad_ids:
        return
    for squad in await db.team_squads.find({"id": {"$in": squad_ids}}, SQUAD_FIELDS).to_list(len(squad_ids) + 10):
        team = teams.get(squad.get("team_id") or "")
        if team is not None and squad.get("id"):
            team.setdefault("squads", {})[squad["id"]] = squad


def _team_leads(team: dict) -> set[str]:
    return {team.get("leader_id"), *(team.get("co_leader_ids") or [])}


def _squad_of(registration: dict, team: dict | None) -> dict | None:
    return ((team or {}).get("squads") or {}).get(registration.get("squad_id") or "")


def _team_people(team: dict) -> set[str]:
    """Wer zum Hauptteam gehört (Mitglieder samt Leitung) - nur sie zählen in einem Co-Team."""
    return {user_id for user_id in (*(team.get("member_ids") or []), *_team_leads(team)) if user_id}


def _squad_roles(squad: dict | None, team: dict) -> set[str]:
    """Captain und Vertreter, soweit sie noch im Hauptteam sind - wer gegangen ist, gilt als fehlend (Altdaten, Rennen)."""
    roles = {(squad or {}).get("captain_id"), (squad or {}).get("vice_captain_id")}
    return {user_id for user_id in roles if user_id} & _team_people(team)


def _squad_members(squad: dict | None, team: dict) -> set[str]:
    return {user_id for user_id in (squad or {}).get("member_ids") or [] if user_id} & _team_people(team)


def roster_ids(registration: dict | None, team: dict | None = None) -> set[str]:
    """Wer für eine Anmeldung aufgestellt werden darf (Liga, #1650): bei einem Co-Team dessen Kader, soweit noch im
    Hauptteam; bei einem Team ohne Co-Team jedes Mitglied; einzeln die Person selbst."""
    if not registration:
        return set()
    if registration.get("team_id") and team:
        if registration.get("squad_id"):
            return _squad_members(_squad_of(registration, team), team)
        return {user_id for user_id in team.get("member_ids") or [] if user_id}
    return {registration["user_id"]} if registration.get("user_id") else set()


def responsible_ids(registration: dict | None, team: dict | None = None) -> set[str]:
    """Die Verantwortlichen einer Anmeldung: wer angemeldet hat, bei Teams dazu Teamleitung und Co-Leitung - bei einem
    Co-Team (``squad_id``) Captain und Vertreter, ohne beide (oder ohne Co-Team-Eintrag) die Leitung des Hauptteams."""
    if not registration:
        return set()
    ids = {registration.get("user_id")}
    if registration.get("team_id") and team:
        roles = _squad_roles(_squad_of(registration, team), team) if registration.get("squad_id") else set()
        ids.update(roles or _team_leads(team))
    return {user_id for user_id in ids if user_id}


def player_ids(registration: dict | None, team: dict | None = None) -> set[str]:
    """Alle Spieler einer Anmeldung: die Verantwortlichen und bei Teams jedes Mitglied - bei einem Co-Team dessen Kader
    (soweit noch im Hauptteam) und die Leitung des Hauptteams, nie die übrigen Mitglieder des Hauptteams; fehlt der
    Co-Team-Eintrag, nur die Leitung."""
    ids = responsible_ids(registration, team)
    if registration and registration.get("team_id") and team:
        if registration.get("squad_id"):
            ids.update(_squad_members(_squad_of(registration, team), team))
            ids.update(user_id for user_id in _team_leads(team) if user_id)
        else:
            ids.update(user_id for user_id in team.get("member_ids") or [] if user_id)
    return ids


def playing_ids(registration: dict | None, team: dict | None = None) -> set[str]:
    """Wer im Spiel antritt: bei Teams mit Aufstellung (#1192) die Aufgestellten, sonst alle Spieler der Anmeldung."""
    if registration and registration.get("team_id") and registration.get("lineup"):
        return {user_id for user_id in registration["lineup"] if user_id}
    return player_ids(registration, team)


def may_act(registration: dict | None, team: dict | None, user_id: str | None) -> bool:
    """Darf diese Person für die Anmeldung handeln (einchecken, melden, Dispute, Termin)?"""
    return bool(user_id and user_id in responsible_ids(registration, team))


async def responsible_user_ids(db, registrations: list[dict]) -> set[str]:
    teams = await teams_by_id(db, registrations)
    out: set[str] = set()
    for reg in registrations:
        out |= responsible_ids(reg, teams.get(reg.get("team_id") or ""))
    return out


async def player_user_ids(db, registrations: list[dict]) -> set[str]:
    teams = await teams_by_id(db, registrations)
    out: set[str] = set()
    for reg in registrations:
        out |= player_ids(reg, teams.get(reg.get("team_id") or ""))
    return out


async def playing_user_ids(db, registrations: list[dict]) -> set[str]:
    """Wer zu den Anmeldungen im Spiel antritt (``playing_ids``) - für Aufruf, Erinnerung, Start und Ergebnis."""
    teams = await teams_by_id(db, registrations)
    out: set[str] = set()
    for reg in registrations:
        out |= playing_ids(reg, teams.get(reg.get("team_id") or ""))
    return out


async def acting_registration(db, registrations: list[dict], user_id: str | None) -> dict | None:
    """Die Anmeldung, für die diese Person handeln darf - die eigene zuerst, dann die eines Teams, das sie leitet."""
    if not user_id:
        return None
    direct = next((reg for reg in registrations if reg.get("user_id") == user_id), None)
    if direct:
        return direct
    teams = await teams_by_id(db, registrations)
    return next((reg for reg in registrations if may_act(reg, teams.get(reg.get("team_id") or ""), user_id)), None)


async def acting_registration_ids(db, registrations: list[dict], user_id: str | None) -> set[str]:
    """Alle Anmeldungen aus der Liste, für die diese Person handeln darf."""
    if not user_id:
        return set()
    teams = await teams_by_id(db, registrations)
    return {reg["id"] for reg in registrations if reg.get("id") and may_act(reg, teams.get(reg.get("team_id") or ""), user_id)}


async def responsible_registration(db, tournament_id: str, user_id: str | None) -> dict | None:
    """Die Anmeldung zu einem Turnier, für die diese Person handeln darf: die eigene, sonst die eines Co-Teams, dessen
    Captain oder Vertreter sie ist, sonst die eines Teams, das sie als Teamleitung oder Co-Leitung führt - auch wenn die
    Turnierleitung das Team ohne Person angemeldet hat. Ein Co-Team mit Captain oder Vertreter führt die Leitung des
    Hauptteams nicht (``may_act``)."""
    if not user_id:
        return None
    own = await db.tournament_registrations.find_one({"tournament_id": tournament_id, "user_id": user_id}, {"_id": 0})
    if own:
        return own
    roles = await db.team_squads.find(
        {"$or": [{"captain_id": user_id}, {"vice_captain_id": user_id}]},
        {"_id": 0, "id": 1},
    ).to_list(100)
    squad_ids = [squad["id"] for squad in roles if squad.get("id")]
    if squad_ids:
        candidates = await db.tournament_registrations.find(
            {"tournament_id": tournament_id, "squad_id": {"$in": squad_ids}}, {"_id": 0},
        ).to_list(10)
        found = await _first_acting(db, candidates, user_id)
        if found:
            return found
    led = await db.teams.find(
        {"$or": [{"leader_id": user_id}, {"co_leader_ids": user_id}]},
        {"_id": 0, "id": 1},
    ).to_list(100)
    team_ids = [team["id"] for team in led if team.get("id")]
    if not team_ids:
        return None
    candidates = await db.tournament_registrations.find(
        {"tournament_id": tournament_id, "team_id": {"$in": team_ids}}, {"_id": 0},
    ).to_list(len(team_ids) + 10)
    return await _first_acting(db, candidates, user_id)


async def _first_acting(db, registrations: list[dict], user_id: str) -> dict | None:
    if not registrations:
        return None
    teams = await teams_by_id(db, registrations)
    return next((reg for reg in registrations if may_act(reg, teams.get(reg.get("team_id") or ""), user_id)), None)


async def registrations_for_match(db, match: dict) -> list[dict]:
    reg_ids = participant_source_ids(match)
    if not reg_ids:
        return []
    return await db.tournament_registrations.find({"id": {"$in": reg_ids}}, {"_id": 0}).to_list(len(reg_ids) + 10)


async def users_for(db, user_ids: Iterable[str], projection: dict | None = None) -> list[dict]:
    """Die Konten zu den Kennungen - ohne gesperrte."""
    ids = sorted({user_id for user_id in user_ids if user_id})
    if not ids:
        return []
    return await db.users.find(
        {"id": {"$in": ids}, "is_banned": {"$ne": True}},
        projection or USER_FIELDS,
    ).to_list(len(ids) + 10)


async def match_player_users(db, match: dict) -> list[dict]:
    """Wer im Spiel antritt, als Konten - für Aufruf, Erinnerung und „Match startet jetzt“; bei Teams mit Aufstellung
    die Aufgestellten.

    Ältere Spiele trugen statt einer Anmeldung manchmal direkt die Konto-Kennung; die zählt dann selbst als Spieler.
    """
    raw_ids = participant_source_ids(match)
    registrations = await registrations_for_match(db, match)
    known = {reg.get("id") for reg in registrations}
    ids = await playing_user_ids(db, registrations)
    ids.update(raw for raw in raw_ids if raw not in known)
    return await users_for(db, ids)
