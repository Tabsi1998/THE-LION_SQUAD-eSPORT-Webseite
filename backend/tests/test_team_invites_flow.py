"""Team-Einladungen (#2113, L-A1): die Teamleitung sieht offene Einladungen, zieht sie zurück, und eine Ablehnung wird
gemeldet. Erfundene Konten, keine echten Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "team-invites-flow-secret-with-at-least-32-chars")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _team(flow) -> dict:
    leader = await flow.add_user(name=f"kapitaen-{new_id()[:6]}")
    co_leader = await flow.add_user(name=f"co-{new_id()[:6]}")
    member = await flow.add_user(name=f"spieler-{new_id()[:6]}")
    guest = await flow.add_user(name=f"gast-{new_id()[:6]}")
    team_id = new_id()
    await flow.db.teams.insert_one({
        "id": team_id, "name": "Rudel", "tag": "RDL", "leader_id": leader["id"], "co_leader_ids": [co_leader["id"]],
        "member_ids": [leader["id"], co_leader["id"], member["id"]], "is_public": True,
        "created_at": "2026-10-01T10:00:00+00:00",
    })
    return {"leader": leader, "co_leader": co_leader, "member": member, "guest": guest, "team_id": team_id}


@pytest.mark.asyncio
async def test_leadership_lists_and_withdraws_open_invites(flow):
    world = await _team(flow)
    flow.act_as(world["co_leader"])
    sent = await flow.post(f"/api/teams/{world['team_id']}/invites", json={"user_id": world["guest"]["id"]})
    assert sent.status_code == 200, sent.text
    invite_id = sent.json()["id"]
    assert await flow.db.notifications.count_documents({"user_id": world["guest"]["id"], "meta.invite_id": invite_id}) == 1

    flow.act_as(world["leader"])
    listed = await flow.get(f"/api/teams/{world['team_id']}/invites")
    assert listed.status_code == 200, listed.text
    rows = listed.json()
    assert [row["id"] for row in rows] == [invite_id]
    assert rows[0]["user"]["id"] == world["guest"]["id"]
    assert rows[0]["inviter"]["id"] == world["co_leader"]["id"]
    assert "email" not in rows[0]["user"]

    withdrawn = await flow.delete(f"/api/teams/{world['team_id']}/invites/{invite_id}")
    assert withdrawn.status_code == 200, withdrawn.text
    stored = await flow.db.team_invites.find_one({"id": invite_id})
    assert stored["status"] == "withdrawn"
    assert stored["withdrawn_by"] == world["leader"]["id"]
    # Aus der Glocke der eingeladenen Person verschwunden, und annehmen geht nicht mehr.
    assert await flow.db.notifications.count_documents({"user_id": world["guest"]["id"], "meta.invite_id": invite_id}) == 0
    assert (await flow.get(f"/api/teams/{world['team_id']}/invites")).json() == []
    flow.act_as(world["guest"])
    assert (await flow.get("/api/teams/invites/my")).json() == []
    assert (await flow.post(f"/api/teams/invites/{invite_id}/accept")).status_code == 404

    # Noch einmal zurückziehen: nicht mehr offen.
    flow.act_as(world["leader"])
    again = await flow.delete(f"/api/teams/{world['team_id']}/invites/{invite_id}")
    assert again.status_code == 404
    assert "nicht mehr offen" in again.json()["detail"]


@pytest.mark.asyncio
async def test_plain_members_neither_see_nor_withdraw_invites(flow):
    world = await _team(flow)
    flow.act_as(world["leader"])
    invite_id = (await flow.post(f"/api/teams/{world['team_id']}/invites", json={"user_id": world["guest"]["id"]})).json()["id"]

    flow.act_as(world["member"])
    assert (await flow.get(f"/api/teams/{world['team_id']}/invites")).status_code == 403
    assert (await flow.delete(f"/api/teams/{world['team_id']}/invites/{invite_id}")).status_code == 403
    assert (await flow.db.team_invites.find_one({"id": invite_id}))["status"] == "pending"


@pytest.mark.asyncio
async def test_invite_of_another_team_cannot_be_withdrawn_here(flow):
    world = await _team(flow)
    other = await _team(flow)
    flow.act_as(other["leader"])
    foreign = (await flow.post(f"/api/teams/{other['team_id']}/invites", json={"user_id": world["guest"]["id"]})).json()["id"]

    flow.act_as(world["leader"])
    response = await flow.delete(f"/api/teams/{world['team_id']}/invites/{foreign}")
    assert response.status_code == 404
    assert (await flow.db.team_invites.find_one({"id": foreign}))["status"] == "pending"


@pytest.mark.asyncio
async def test_declined_invite_is_reported_to_the_inviter(flow):
    world = await _team(flow)
    flow.act_as(world["co_leader"])
    invite_id = (await flow.post(f"/api/teams/{world['team_id']}/invites", json={"user_id": world["guest"]["id"]})).json()["id"]

    flow.act_as(world["guest"])
    declined = await flow.post(f"/api/teams/invites/{invite_id}/decline")
    assert declined.status_code == 200, declined.text

    note = await flow.db.notifications.find_one({"user_id": world["co_leader"]["id"], "kind": "team_invite_declined"})
    assert note is not None
    assert "abgelehnt" in note["title"]
    assert note["url"] == f"/teams/{world['team_id']}"
    assert note["meta"]["invite_id"] == invite_id


@pytest.mark.asyncio
async def test_captain_who_wants_to_leave_is_told_the_way(flow):
    """Kein stummes Nein (#2113, L-C6): die Meldung nennt „Leitung übergeben“ und „Team auflösen“ - auch für die App."""
    world = await _team(flow)
    flow.act_as(world["leader"])
    response = await flow.post(f"/api/teams/{world['team_id']}/leave")
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "Zum Kapitän machen" in detail and "löse das Team" in detail