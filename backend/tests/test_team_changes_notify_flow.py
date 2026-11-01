"""Wer kommt und geht (#2128, TM5, TM6): Entfernen, Verlassen und Beitritt stehen in der Glocke und im Protokoll, und der
Club-Admin übergibt ein verwaistes Team. Erfundene Daten, keine echten Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "team-changes-secret-with-at-least-32-characters")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def make_team(flow, leader, *members):
    team = {"id": new_id(), "name": "Rudel", "tag": "RDL", "leader_id": leader["id"], "co_leader_ids": [],
            "member_ids": [leader["id"], *[m["id"] for m in members]], "join_code": "Pr0beCode", "is_public": True}
    await flow.db.teams.insert_one(dict(team))
    return team


async def notes(flow, user, kind):
    return await flow.db.notifications.find({"user_id": user["id"], "kind": kind}, {"_id": 0}).to_list(10)


async def audit(flow, action, team):
    return await flow.db.audit_logs.find({"action": action, "target_id": team["id"]}, {"_id": 0}).to_list(10)


@pytest.mark.asyncio
async def test_kick_leave_and_join_tell_people_and_stay_in_the_log(flow):
    leader = await flow.add_user(role="player", name="leitung")
    mila = await flow.add_user(role="player", name="mila")
    tom = await flow.add_user(role="player", name="tom")
    ben = await flow.add_user(role="player", name="ben")
    team = await make_team(flow, leader, mila, tom)

    flow.act_as(leader)
    assert (await flow.delete(f"/api/teams/{team['id']}/members/{mila['id']}")).status_code == 200
    removed = await notes(flow, mila, "team_member_removed")
    assert len(removed) == 1 and "Rudel" in removed[0]["body"]
    assert (await audit(flow, "team.kick", team))[0]["data"] == {"kicked_user_id": mila["id"]}

    flow.act_as(tom)
    assert (await flow.post(f"/api/teams/{team['id']}/leave")).status_code == 200
    left = await notes(flow, leader, "team_member_left")
    assert len(left) == 1 and "tom" in left[0]["title"].lower()
    assert (await audit(flow, "team.leave", team))[0]["actor_id"] == tom["id"]

    flow.act_as(ben)
    wrong = await flow.post(f"/api/teams/{team['id']}/join", json={"join_code": "falsch"})
    assert wrong.status_code == 403 and wrong.json()["detail"] == "Dieser Beitrittscode stimmt nicht."
    assert (await flow.post(f"/api/teams/{team['id']}/join", json={"join_code": "Pr0beCode"})).status_code == 200
    joined = await notes(flow, leader, "team_invite_accepted")
    assert len(joined) == 1 and joined[0]["meta"]["via"] == "join_code"
    row = (await audit(flow, "team.join", team))[0]
    assert row["actor_id"] == ben["id"] and row["data"] == {"via": "join_code"}, "kein Code im Protokoll"
    stored = await flow.db.teams.find_one({"id": team["id"]})
    assert ben["id"] in stored["member_ids"] and await flow.db.team_members.find_one({"team_id": team["id"], "user_id": ben["id"]})


@pytest.mark.asyncio
async def test_joining_by_link_and_invite_stays_in_the_log(flow):
    leader = await flow.add_user(role="player", name="leitung")
    ida = await flow.add_user(role="player", name="ida")
    kai = await flow.add_user(role="player", name="kai")
    team = await make_team(flow, leader)
    flow.act_as(leader)
    token = (await flow.get(f"/api/teams/{team['id']}/invite-link")).json()["token"]
    invite = (await flow.post(f"/api/teams/{team['id']}/invites", json={"user_id": kai["id"]})).json()

    flow.act_as(ida)
    assert (await flow.post(f"/api/teams/{team['id']}/join-link", json={"token": token})).status_code == 200
    flow.act_as(kai)
    assert (await flow.post(f"/api/teams/invites/{invite['id']}/accept")).status_code == 200

    rows = await audit(flow, "team.join", team)
    assert {row["actor_id"]: row["data"]["via"] for row in rows} == {ida["id"]: "invite_link", kai["id"]: "invite"}
    assert token not in str(rows), "kein Schlüssel im Protokoll"


@pytest.mark.asyncio
async def test_rights_say_who_may_change_roles_and_the_admin_hands_over_an_orphaned_team(flow):
    gone = await flow.add_user(role="player", name="weg")
    mila = await flow.add_user(role="player", name="mila")
    admin = await flow.add_user(role="club_admin", name="vorstand")
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    team = await make_team(flow, gone, mila)
    await flow.db.users.update_one({"id": gone["id"]}, {"$set": {"is_active": False, "anonymized_at": "2026-01-01T00:00:00+00:00"}})

    flow.act_as(mila)
    assert (await flow.get(f"/api/teams/{team['id']}")).json()["can_change_roles"] is False
    flow.act_as(lead)
    assert (await flow.get(f"/api/teams/{team['id']}")).json()["can_change_roles"] is False
    flow.act_as(admin)
    assert (await flow.get(f"/api/teams/{team['id']}")).json()["can_change_roles"] is True

    done = await flow.post(f"/api/teams/{team['id']}/transfer-leader", json={"new_leader_id": mila["id"]})
    assert done.status_code == 200
    assert done.json()["leader_id"] == mila["id"]
    assert gone["id"] not in done.json()["co_leader_ids"], "ein gelöschtes Konto rückt nicht in die Co-Leitung"
    note = (await notes(flow, mila, "team_leader_transferred"))[0]
    assert "Teamleitung" in note["title"] and "Leader" not in note["title"]


@pytest.mark.asyncio
async def test_messages_use_plain_words(flow):
    leader = await flow.add_user(role="player", name="leitung")
    mila = await flow.add_user(role="player", name="mila")
    team = await make_team(flow, leader, mila)
    flow.act_as(leader)
    bad_role = await flow.post(f"/api/teams/{team['id']}/members/{mila['id']}/role", json={"role": "boss"})
    no_person = await flow.post(f"/api/teams/{team['id']}/transfer-leader", json={})
    kick_self = await flow.delete(f"/api/teams/{team['id']}/members/{leader['id']}")
    for response in (bad_role, no_person, kick_self):
        detail = response.json()["detail"]
        assert response.status_code == 400
        for word in ("co_leader", "new_leader_id", "Leader", "kick", "member,"):
            assert word not in detail, detail
