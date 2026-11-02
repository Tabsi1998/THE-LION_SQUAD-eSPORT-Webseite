"""Die Freigabe „Turnierleitung“ zählt bei der Team-Pflege wie die Rolle (docs/ROLLEN.md, #2202 D-17): Team bearbeiten, Co-Teams,
Logo. Sie öffnet keine Inhalte: Team-Chat, private Teams, Beitrittscode und Einladungen bleiben bei der Rolle. Rechte-Matrix je
Aktion und Konto, auch negativ. Erfundene Namen."""

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


async def team_world(flow, *, is_public: bool = True) -> dict:
    leader = await flow.add_user(role="player", name="neonfalke")
    mate = await flow.add_user(role="player", name="lunabyte")
    other = await flow.add_user(role="player", name="pixelkatze")
    team = {
        "id": new_id(), "name": "Lions Rocket", "tag": "LRK", "leader_id": leader["id"], "co_leader_ids": [],
        "member_ids": [leader["id"], mate["id"], other["id"]], "join_code": "Kx7pQ2", "is_public": is_public,
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
@pytest.mark.parametrize("kind,manage,edit", [
    ("freigabe_turniere", False, True), ("moderator_mit_freigabe", False, True), ("rolle_turnierleitung", True, True),
    ("club_admin", True, True), ("freigabe_redaktion", False, False), ("spieler", False, False), ("moderator", False, False),
])
async def test_the_server_tells_web_and_app_the_right(flow, kind, manage, edit):
    """``can_manage`` bleibt die volle Verwaltung samt Inhalten, ``can_edit_team`` die Pflege - danach richtet das Web die Knöpfe."""
    w = await team_world(flow)
    flow.act_as(await account(flow, kind))

    rights = (await flow.get(f"/api/teams/{w['team']['id']}")).json()

    assert (rights["can_manage"], rights["can_edit_team"]) == (manage, edit)
    assert rights["admin_needs_second_factor"] is False


# ---------------------------------------------------------------- Inhalte bleiben zu


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["freigabe_turniere", "moderator_mit_freigabe"])
async def test_a_grant_does_not_open_chat_code_or_invitations(flow, kind):
    w = await team_world(flow)
    await flow.db.team_chat_messages.insert_one({"id": new_id(), "team_id": w["team"]["id"], "user_id": w["mate"]["id"], "message": "Nur fürs Team"})
    flow.act_as(await account(flow, kind))
    team_id = w["team"]["id"]

    seen = await flow.get(f"/api/teams/{team_id}")
    read = await flow.get(f"/api/teams/{team_id}/chat")
    write = await flow.post(f"/api/teams/{team_id}/chat", json={"message": "Hallo"})
    link = await flow.get(f"/api/teams/{team_id}/invite-link")
    new_link = await flow.post(f"/api/teams/{team_id}/invite-link")
    code = await flow.post(f"/api/teams/{team_id}/join-code")
    invite = await flow.post(f"/api/teams/{team_id}/invites", json={"user_id": new_id()})
    edited = await flow.patch(f"/api/teams/{team_id}", json={"description": "Neu"})

    assert "join_code" not in seen.json(), "weder beim Lesen …"
    assert edited.status_code == 200 and "join_code" not in edited.json(), "… noch in der Antwort aufs Speichern"
    assert "Nur fürs Team" not in read.text
    assert [read.status_code, write.status_code, link.status_code, new_link.status_code, code.status_code, invite.status_code] == [REFUSED] * 6


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["freigabe_turniere", "moderator_mit_freigabe"])
async def test_a_grant_does_not_open_a_private_team(flow, kind):
    w = await team_world(flow, is_public=False)
    user = await account(flow, kind)
    flow.act_as(user)
    team_id = w["team"]["id"]

    seen = await flow.get(f"/api/teams/{team_id}")
    overview = await flow.get(f"/api/teams/{team_id}/overview")
    squads = await flow.get(f"/api/teams/{team_id}/squads")
    edited = await flow.patch(f"/api/teams/{team_id}", json={"description": "Neu"})
    squad_new = await flow.post(f"/api/teams/{team_id}/squads", json={"name": "Rocket B", "member_ids": []})
    logo = await flow.post(f"/api/uploads/team-logo?team_id={team_id}", files={"file": ("logo.txt", b"kein Bild", "text/plain")})

    assert [seen.status_code, overview.status_code] == [404, 404]
    assert [squads.status_code, edited.status_code, squad_new.status_code, logo.status_code] == [REFUSED] * 4


@pytest.mark.asyncio
async def test_the_role_keeps_what_it_had(flow):
    """Regression: die Rolle sieht weiter Code, Chat und private Teams - nichts davon hängt an der Freigabe."""
    w = await team_world(flow, is_public=False)
    flow.act_as(await account(flow, "rolle_turnierleitung"))
    team_id = w["team"]["id"]

    seen = await flow.get(f"/api/teams/{team_id}")
    chat = await flow.get(f"/api/teams/{team_id}/chat")
    link = await flow.get(f"/api/teams/{team_id}/invite-link")

    assert seen.status_code == 200 and seen.json()["join_code"] == "Kx7pQ2"
    assert [chat.status_code, link.status_code] == [ALLOWED, ALLOWED]


@pytest.mark.asyncio
async def test_a_member_with_a_grant_only_sees_what_a_member_sees(flow):
    w = await team_world(flow)
    user = await account(flow, "freigabe_turniere")
    await flow.db.teams.update_one({"id": w["team"]["id"]}, {"$addToSet": {"member_ids": user["id"]}})
    await flow.db.team_members.insert_one({"team_id": w["team"]["id"], "user_id": user["id"], "role": "member"})
    flow.act_as(user)

    mine = (await flow.get("/api/teams/my")).json()

    assert mine[0]["can_manage"] is False and mine[0]["can_edit_team"] is True
    assert "join_code" not in mine[0]


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
    dissolve = await flow.delete(f"/api/teams/{team_id}?confirm=Lions Rocket")
    role = await flow.post(f"/api/teams/{team_id}/members/{w['mate']['id']}/role", json={"role": "co_leader"})
    transfer = await flow.post(f"/api/teams/{team_id}/transfer-leader", json={"new_leader_id": w["mate"]["id"]})
    public = await flow.patch(f"/api/teams/{team_id}", json={"is_public": False})
    assert [dissolve.status_code, role.status_code, transfer.status_code, public.status_code] == [REFUSED] * 4


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
