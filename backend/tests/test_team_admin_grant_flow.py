"""Die Freigabe „Turnierleitung“ zählt in der Teamverwaltung wie die Rolle (docs/ROLLEN.md, #2202 D-17) - und nur dort, wo die
Rolle etwas darf. Rechte-Matrix je Aktion und Konto. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

from services.permissions import MFA_MESSAGE  # noqa: E402

ALLOWED = 200
REFUSED = 403


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def team_world(flow) -> dict:
    leader = await flow.add_user(role="player", name="neonfalke")
    mate = await flow.add_user(role="player", name="lunabyte")
    other = await flow.add_user(role="player", name="pixelkatze")
    team = {
        "id": new_id(), "name": "Lions Rocket", "tag": "LRK", "leader_id": leader["id"], "co_leader_ids": [],
        "member_ids": [leader["id"], mate["id"], other["id"]], "join_code": "Kx7pQ2", "is_public": False,
        "created_at": "2026-01-10T10:00:00+00:00",
    }
    await flow.db.teams.insert_one(dict(team))
    for user in (leader, mate, other):
        await flow.db.team_members.insert_one({"team_id": team["id"], "user_id": user["id"], "role": "member"})
    squad = {"id": new_id(), "team_id": team["id"], "name": "Rocket A", "status": "active", "member_ids": [mate["id"]],
             "created_at": "2026-01-10T10:00:00+00:00"}
    await flow.db.team_squads.insert_one(dict(squad))
    return {"team": team, "squad": squad, "mate": mate, "other": other}


async def account(flow, kind: str) -> dict:
    """Die Konten der Matrix: Freigabe je Bereich, Rollen, Moderator mit und ohne Freigabe."""
    grants = {
        "freigabe_turniere": ("player", ["tournaments"]),
        "freigabe_redaktion": ("player", ["content"]),
        "freigabe_verein": ("player", ["club"]),
        "freigabe_finanzen": ("player", ["finance"]),
        "spieler": ("player", []),
        "moderator": ("moderator", []),
        "moderator_mit_freigabe": ("moderator", ["tournaments"]),
        "rolle_turnierleitung": ("tournament_admin", []),
        "club_admin": ("club_admin", []),
    }
    role, areas = grants[kind]
    user = await flow.add_user(role=role, name=f"konto-{kind}")
    if areas:
        await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": areas}})
        user = {**user, "areas": areas}
    return user


MANAGES = ["freigabe_turniere", "moderator_mit_freigabe", "rolle_turnierleitung", "club_admin"]
OUTSIDERS = ["freigabe_redaktion", "freigabe_verein", "freigabe_finanzen", "spieler", "moderator"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", MANAGES + OUTSIDERS)
async def test_editing_a_team_and_its_squads(flow, kind):
    w = await team_world(flow)
    flow.act_as(await account(flow, kind))
    expected = ALLOWED if kind in MANAGES else REFUSED
    team_id = w["team"]["id"]

    edit = await flow.patch(f"/api/teams/{team_id}", json={"description": "Neu"})
    squad_new = await flow.post(f"/api/teams/{team_id}/squads", json={"name": "Rocket B", "member_ids": []})
    squad_edit = await flow.patch(f"/api/teams/{team_id}/squads/{w['squad']['id']}", json={"description": "Neu"})
    roles = await flow.put(f"/api/teams/{team_id}/squads/{w['squad']['id']}/roles", json={"captain_id": w["mate"]["id"]})
    listed = await flow.get(f"/api/teams/{team_id}/squads")

    assert [edit.status_code, squad_new.status_code, squad_edit.status_code, roles.status_code, listed.status_code] == [expected] * 5


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", MANAGES + OUTSIDERS)
async def test_the_server_tells_web_and_app_the_same_right(flow, kind):
    w = await team_world(flow)
    flow.act_as(await account(flow, kind))

    response = await flow.get(f"/api/teams/{w['team']['id']}")

    if kind not in MANAGES:
        assert response.status_code in (403, 404), "ein privates Team bleibt zu"
        return
    assert response.json()["can_manage"] is True
    assert response.json()["admin_needs_second_factor"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,expected", [
    ("freigabe_turniere", REFUSED), ("moderator_mit_freigabe", REFUSED), ("rolle_turnierleitung", REFUSED),
    ("club_admin", ALLOWED), ("freigabe_verein", REFUSED), ("spieler", REFUSED),
])
async def test_removing_members_stays_with_the_leadership_and_admins(flow, kind, expected):
    """Laut ROLLEN.md gehört das nicht zur Turnierleitung - auch nicht über die Freigabe."""
    w = await team_world(flow)
    flow.act_as(await account(flow, kind))

    response = await flow.delete(f"/api/teams/{w['team']['id']}/members/{w['other']['id']}")

    assert response.status_code == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["freigabe_turniere", "rolle_turnierleitung"])
async def test_dissolving_and_changing_roles_stay_out_of_reach(flow, kind):
    w = await team_world(flow)
    flow.act_as(await account(flow, kind))
    team_id = w["team"]["id"]

    rights = (await flow.get(f"/api/teams/{team_id}")).json()
    assert rights["can_dissolve"] is False and rights["can_change_roles"] is False and rights["can_remove_members"] is False
    assert (await flow.delete(f"/api/teams/{team_id}?confirm=Lions Rocket")).status_code == REFUSED
    assert (await flow.post(f"/api/teams/{team_id}/members/{w['mate']['id']}/role", json={"role": "co_leader"})).status_code == REFUSED
    assert (await flow.post(f"/api/teams/{team_id}/transfer-leader", json={"new_leader_id": w["mate"]["id"]})).status_code == REFUSED


@pytest.mark.asyncio
async def test_a_grant_without_second_factor_gets_the_hint_not_the_rights(flow):
    w = await team_world(flow)
    user = await account(flow, "freigabe_turniere")
    flow.act_as({**user, "auth_mfa_verified": False})

    refused = await flow.patch(f"/api/teams/{w['team']['id']}", json={"description": "Neu"})

    assert refused.status_code == REFUSED and refused.json()["detail"] == MFA_MESSAGE
    await flow.db.teams.update_one({"id": w["team"]["id"]}, {"$set": {"is_public": True}})
    rights = (await flow.get(f"/api/teams/{w['team']['id']}")).json()
    assert rights["can_manage"] is False and rights["admin_needs_second_factor"] is True


@pytest.mark.asyncio
async def test_a_grant_may_upload_a_team_logo_like_the_role(flow):
    """Das Logo gehört zum Bearbeiten: sonst zeigte die Seite den Knopf, und der Server lehnte ab."""
    w = await team_world(flow)
    for kind, refused in (("freigabe_redaktion", True), ("freigabe_turniere", False)):
        flow.act_as(await account(flow, kind))
        response = await flow.post(f"/api/uploads/team-logo?team_id={w['team']['id']}",
                                   files={"file": ("logo.txt", b"kein Bild", "text/plain")})
        assert (response.status_code == REFUSED) is refused, response.text
