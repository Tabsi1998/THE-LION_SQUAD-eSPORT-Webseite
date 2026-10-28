"""Gemeinsamer Aufbau für die Co-Team-Tests der Liga (docs/LIGA.md, #1649). Erfundene Namen, keine echten Personen.

Löwen (Hauptteam) mit Leitung, Co-Leitung und sechs Mitgliedern; zwei Co-Teams „Rudel A“ und „Rudel B“ mit je vier
Spielern. Falken (Gegner) mit einem Co-Team „Horst“. Eine Liga-Staffel (Team-Turnier, Format league, Teamgröße 4).
"""

from __future__ import annotations

from flow_harness import new_id


async def make_team(flow, name: str, *, leader: dict, co_leaders: list[dict] = (), members: list[dict] = ()) -> dict:
    people = [leader, *co_leaders, *members]
    doc = {
        "id": new_id(),
        "name": name,
        "tag": name[:3].upper(),
        "leader_id": leader["id"],
        "co_leader_ids": [user["id"] for user in co_leaders],
        "member_ids": [user["id"] for user in people],
    }
    await flow.db.teams.insert_one(dict(doc))
    for user in people:
        role = "leader" if user is leader else "co_leader" if user in co_leaders else "member"
        await flow.db.team_members.insert_one({"team_id": doc["id"], "user_id": user["id"], "role": role})
    return doc


async def make_squad(
    flow,
    team: dict,
    name: str,
    members: list[dict],
    *,
    captain: dict | None = None,
    vice: dict | None = None,
    game_id: str | None = None,
    status: str = "active",
) -> dict:
    doc = {
        "id": new_id(),
        "team_id": team["id"],
        "name": name,
        "status": status,
        "member_ids": [user["id"] for user in members],
        "created_at": "2026-10-20T10:00:00+00:00",
    }
    if captain:
        doc["captain_id"] = captain["id"]
    if vice:
        doc["vice_captain_id"] = vice["id"]
    if game_id:
        doc["game_id"] = game_id
    await flow.db.team_squads.insert_one(dict(doc))
    return doc


async def league_world(flow, *, game_id: str = "cod", max_participants: int = 8, **tournament_fields) -> dict:
    names = [
        "Leitung",
        "CoLeitung",
        "Spieler1",
        "Spieler2",
        "Spieler3",
        "Spieler4",
        "Spieler5",
        "Spieler6",
        "FalkenLeitung",
        "Falke1",
        "Falke2",
        "Falke3",
        "Falke4",
        "Fremd",
    ]
    users = {name: await flow.add_user(name=name) for name in names}
    lions = await make_team(
        flow,
        "Loewen",
        leader=users["Leitung"],
        co_leaders=[users["CoLeitung"]],
        members=[users[f"Spieler{i}"] for i in range(1, 7)],
    )
    falcons = await make_team(
        flow, "Falken", leader=users["FalkenLeitung"], members=[users[f"Falke{i}"] for i in range(1, 5)]
    )
    squad_a = await make_squad(flow, lions, "Rudel A", [users[f"Spieler{i}"] for i in (1, 2, 3, 4)], game_id=game_id)
    squad_b = await make_squad(flow, lions, "Rudel B", [users[f"Spieler{i}"] for i in (3, 4, 5, 6)], game_id=game_id)
    horst = await make_squad(flow, falcons, "Horst", [users[f"Falke{i}"] for i in (1, 2, 3, 4)], game_id=game_id)
    tournament = await flow.create_tournament(
        team_mode="team",
        team_size=4,
        format="league",
        game_id=game_id,
        status="registration_closed",
        max_participants=max_participants,
        event_mode="online",
        **tournament_fields,
    )
    staff = await flow.add_staff()
    return {
        "users": users,
        "lions": lions,
        "falcons": falcons,
        "squad_a": squad_a,
        "squad_b": squad_b,
        "horst": horst,
        "tournament": tournament,
        "staff": staff,
    }


async def squad_registration(flow, tournament: dict, team: dict, squad: dict) -> dict:
    """Eine Co-Team-Anmeldung, wie das Zuteilen sie schreibt - direkt, für Tests, die das Zuteilen nicht prüfen."""
    reg = {
        "id": new_id(),
        "tournament_id": tournament["id"],
        "team_id": team["id"],
        "squad_id": squad["id"],
        "squad_name": squad["name"],
        "user_id": None,
        "display_name": f"{team['name']} · {squad['name']}",
        "status": "approved",
        "registration_type": "team",
        "registered_via": "league_assign",
        "identity_key": f"{tournament['id']}:team:{team['id']}",
    }
    await flow.db.tournament_registrations.insert_one(dict(reg))
    return reg


def ids(users: dict, *names: str) -> set[str]:
    return {users[name]["id"] for name in names}
