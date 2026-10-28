"""Captain und Vertreter je Co-Team (docs/LIGA.md, Abschnitte 2, 4 und 5; #1649).

- Vergeben dürfen Leitung und Co-Leitung des Hauptteams und Admins - mit Protokoll ``team.squad.roles``.
- Beide stehen im Kader des Co-Teams und sind verschiedene Personen.
- Wer eine Rolle hat, verlässt den Kader (und das Team) erst, wenn die Rolle neu vergeben ist.
- Ein Co-Team mit aktiver Liga-Anmeldung lässt sich nicht löschen.
"""

import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import InterleavedReads, make_flow  # noqa: E402
from squad_world import ids, league_world, squad_registration  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def roles_url(world: dict, squad: str = "squad_a") -> str:
    return f"/api/teams/{world['lions']['id']}/squads/{world[squad]['id']}/roles"


async def audit(flow, action: str) -> list[dict]:
    return await flow.db.audit_logs.find({"action": action}, {"_id": 0}).to_list(50)


@pytest.mark.asyncio
async def test_team_leadership_sets_captain_and_vice_with_a_protocol(flow):
    world = await league_world(flow)
    users = world["users"]
    flow.act_as(users["CoLeitung"])

    response = await flow.put(
        roles_url(world), json={"captain_id": users["Spieler1"]["id"], "vice_captain_id": users["Spieler2"]["id"]}
    )

    assert response.status_code == 200, response.text
    squad = response.json()
    assert squad["captain_id"] == users["Spieler1"]["id"]
    assert squad["vice_captain_id"] == users["Spieler2"]["id"]
    logged = await audit(flow, "team.squad.roles")
    assert len(logged) == 1
    entry = logged[0]
    assert entry["actor_id"] == users["CoLeitung"]["id"]
    assert entry["target_id"] == world["lions"]["id"]
    assert entry["data"]["squad_id"] == world["squad_a"]["id"]
    assert entry["data"]["before"] == {"captain_id": None, "vice_captain_id": None}
    assert entry["data"]["after"] == {"captain_id": users["Spieler1"]["id"], "vice_captain_id": users["Spieler2"]["id"]}
    told = {
        row["user_id"]
        for row in await flow.db.notifications.find({"kind": "team_role_changed"}, {"_id": 0}).to_list(10)
    }
    assert told == ids(users, "Spieler1", "Spieler2"), "wer eine Rolle neu bekommt, erfährt es"

    # Dasselbe noch einmal ändert nichts - kein zweiter Eintrag im Protokoll.
    again = await flow.put(roles_url(world), json={"captain_id": users["Spieler1"]["id"]})
    assert again.status_code == 200, again.text
    assert len(await audit(flow, "team.squad.roles")) == 1


@pytest.mark.asyncio
async def test_only_team_leadership_or_admins_set_roles(flow):
    world = await league_world(flow)
    users = world["users"]
    body = {"captain_id": users["Spieler1"]["id"]}

    for name in ("Spieler1", "Spieler3", "Fremd", "FalkenLeitung"):
        flow.act_as(users[name])
        refused = await flow.put(roles_url(world), json=body)
        assert refused.status_code == 403, (name, refused.text)
    assert await flow.db.team_squads.find_one({"id": world["squad_a"]["id"], "captain_id": {"$exists": True}}) is None

    flow.act_as(world["staff"])
    allowed = await flow.put(roles_url(world), json=body)
    assert allowed.status_code == 200, allowed.text

    # Admin-Rolle ohne bestätigte Zwei-Faktor-Anmeldung reicht nicht (#1469).
    no_mfa = await flow.add_user(role="tournament_admin", name="OhneZweiFaktor")
    await flow.db.users.update_one({"id": no_mfa["id"]}, {"$set": {"auth_mfa_verified": False}})
    flow.act_as({**no_mfa, "auth_mfa_verified": False})
    refused = await flow.put(roles_url(world), json={"captain_id": None})
    assert refused.status_code == 403


@pytest.mark.asyncio
async def test_roles_must_be_squad_members_and_different_people(flow):
    world = await league_world(flow)
    users = world["users"]
    flow.act_as(users["Leitung"])

    outside = await flow.put(roles_url(world), json={"captain_id": users["Spieler5"]["id"]})
    assert outside.status_code == 400
    assert "Kader" in outside.json()["detail"]
    stranger = await flow.put(roles_url(world), json={"vice_captain_id": users["Fremd"]["id"]})
    assert stranger.status_code == 400
    same = await flow.put(
        roles_url(world), json={"captain_id": users["Spieler1"]["id"], "vice_captain_id": users["Spieler1"]["id"]}
    )
    assert same.status_code == 400
    assert "verschiedene" in same.json()["detail"]
    assert await audit(flow, "team.squad.roles") == []

    # Beim Anlegen gilt dieselbe Regel.
    created = await flow.post(
        f"/api/teams/{world['lions']['id']}/squads",
        json={
            "name": "Rudel C",
            "member_ids": [users["Spieler5"]["id"], users["Spieler6"]["id"]],
            "captain_id": users["Spieler5"]["id"],
            "vice_captain_id": users["Spieler6"]["id"],
        },
    )
    assert created.status_code == 200, created.text
    assert created.json()["captain_id"] == users["Spieler5"]["id"]
    refused = await flow.post(
        f"/api/teams/{world['lions']['id']}/squads",
        json={
            "name": "Rudel D",
            "member_ids": [users["Spieler5"]["id"]],
            "captain_id": users["Spieler6"]["id"],
        },
    )
    assert refused.status_code == 400
    assert len(await audit(flow, "team.squad.roles")) == 1


@pytest.mark.asyncio
async def test_a_role_holder_leaves_the_roster_only_after_reassignment(flow):
    world = await league_world(flow)
    users = world["users"]
    flow.act_as(users["Leitung"])
    await flow.put(
        roles_url(world), json={"captain_id": users["Spieler1"]["id"], "vice_captain_id": users["Spieler2"]["id"]}
    )
    squad_url = f"/api/teams/{world['lions']['id']}/squads/{world['squad_a']['id']}"
    without_captain = [users[name]["id"] for name in ("Spieler2", "Spieler3", "Spieler4", "Spieler5")]

    refused = await flow.patch(squad_url, json={"member_ids": without_captain})
    assert refused.status_code == 409
    assert "neu" in refused.json()["detail"]
    stored = await flow.db.team_squads.find_one({"id": world["squad_a"]["id"]}, {"_id": 0})
    assert users["Spieler1"]["id"] in stored["member_ids"], "nichts geändert"

    # In derselben Änderung neu vergeben geht.
    moved = await flow.patch(squad_url, json={"member_ids": without_captain, "captain_id": users["Spieler5"]["id"]})
    assert moved.status_code == 200, moved.text
    assert moved.json()["captain_id"] == users["Spieler5"]["id"]
    assert users["Spieler1"]["id"] not in moved.json()["member_ids"]

    # Bewusst wegnehmen (null) zählt auch als Neuvergabe; das Feld verschwindet.
    cleared = await flow.patch(squad_url, json={"member_ids": without_captain[1:], "vice_captain_id": None})
    assert cleared.status_code == 200, cleared.text
    stored = await flow.db.team_squads.find_one({"id": world["squad_a"]["id"]}, {"_id": 0})
    assert "vice_captain_id" not in stored
    assert stored["captain_id"] == users["Spieler5"]["id"]

    # Ein Captain verlässt das Team nicht und wird nicht entfernt, solange er die Rolle hat.
    flow.act_as(users["Spieler5"])
    leave = await flow.post(f"/api/teams/{world['lions']['id']}/leave")
    assert leave.status_code == 409
    flow.act_as(users["Leitung"])
    kick = await flow.delete(f"/api/teams/{world['lions']['id']}/members/{users['Spieler5']['id']}")
    assert kick.status_code == 409
    team = await flow.db.teams.find_one({"id": world["lions"]["id"]}, {"_id": 0})
    assert users["Spieler5"]["id"] in team["member_ids"]


@pytest.mark.asyncio
async def test_a_squad_in_a_running_league_cannot_be_deleted(flow):
    world = await league_world(flow)
    users = world["users"]
    reg = await squad_registration(flow, world["tournament"], world["lions"], world["squad_a"])
    flow.act_as(users["Leitung"])
    url = f"/api/teams/{world['lions']['id']}/squads/{world['squad_a']['id']}"

    refused = await flow.delete(url)
    assert refused.status_code == 409
    assert "Testturnier" in refused.json()["detail"]
    assert await flow.db.team_squads.find_one({"id": world["squad_a"]["id"]}) is not None

    # Ein Co-Team ohne Liga-Anmeldung geht weg wie bisher.
    other = await flow.delete(f"/api/teams/{world['lions']['id']}/squads/{world['squad_b']['id']}")
    assert other.status_code == 200, other.text

    # Ist die Staffel beendet, ist das Co-Team wieder frei.
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"status": "completed"}})
    done = await flow.delete(url)
    assert done.status_code == 200, done.text
    assert (
        await flow.db.tournament_registrations.find_one({"id": reg["id"]}) is not None
    ), "die Anmeldung bleibt erhalten"


@pytest.mark.asyncio
async def test_squads_without_roles_keep_working_as_before(flow):
    """Regression: ein Squad ohne Rollen lässt sich wie bisher anlegen, ändern und löschen - ohne Protokoll."""
    world = await league_world(flow)
    users = world["users"]
    flow.act_as(users["Leitung"])
    created = await flow.post(
        f"/api/teams/{world['lions']['id']}/squads",
        json={
            "name": "Herbst",
            "member_ids": [users["Spieler1"]["id"], users["Spieler2"]["id"]],
        },
    )
    assert created.status_code == 200, created.text
    squad = created.json()
    assert "captain_id" not in squad and "vice_captain_id" not in squad
    changed = await flow.patch(
        f"/api/teams/{world['lions']['id']}/squads/{squad['id']}",
        json={"name": "Herbst 2", "member_ids": [users["Spieler1"]["id"]]},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["member_ids"] == [users["Spieler1"]["id"]]
    deleted = await flow.delete(f"/api/teams/{world['lions']['id']}/squads/{squad['id']}")
    assert deleted.status_code == 200
    assert await audit(flow, "team.squad.roles") == []


@pytest.mark.asyncio
async def test_two_changes_at_once_never_leave_a_captain_outside_the_roster(flow, monkeypatch):
    """Rolle vergeben und Kader ändern gleichzeitig: beide lesen den alten Stand - nur eine Änderung schreibt."""
    import routes.team_routes as team_routes

    world = await league_world(flow)
    users = world["users"]
    flow.act_as(users["Leitung"])
    gate = InterleavedReads(flow.db, "team_squads")
    monkeypatch.setattr(team_routes, "get_db", lambda: gate)
    squad_url = f"/api/teams/{world['lions']['id']}/squads/{world['squad_a']['id']}"
    without_spieler3 = [users[name]["id"] for name in ("Spieler1", "Spieler2", "Spieler4")]

    roles, roster = await asyncio.gather(
        flow.put(roles_url(world), json={"captain_id": users["Spieler3"]["id"]}),
        flow.patch(squad_url, json={"member_ids": without_spieler3}),
    )

    assert sorted([roles.status_code, roster.status_code]) == [200, 409]
    stored = await flow.db.team_squads.find_one({"id": world["squad_a"]["id"]}, {"_id": 0})
    if stored.get("captain_id"):
        assert stored["captain_id"] in stored["member_ids"]
