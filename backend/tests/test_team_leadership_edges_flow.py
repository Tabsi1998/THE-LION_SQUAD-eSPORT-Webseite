"""Team anlegen, Leitung übergeben und Mitglieder entfernen - samt den Randfällen, die die Routen ablehnen (#932).

Ersetzt die alten Live-Tests
test_iter20_bug_hunt.py::TestTeamSystem::test_team_create_fields,
test_iter20_bugfixes.py::test_team_kick_role_transfer_full_flow,
test_iter20_bugfixes.py::test_team_kick_anon_blocked,
test_iter20_edge_cases.py::test_kick_self_rejected,
test_iter20_edge_cases.py::test_transfer_to_non_member_404 und
test_iter20_edge_cases.py::test_transfer_to_current_leader_rejected.
Erfundene Daten, keine echten Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def make_team(flow, leader, *members, co_leaders=()):
    team = {"id": new_id(), "name": "Probeteam", "tag": "PRB", "leader_id": leader["id"],
            "co_leader_ids": [c["id"] for c in co_leaders],
            "member_ids": [leader["id"], *[m["id"] for m in members]], "join_code": "Pr0beCode", "is_public": True}
    await flow.db.teams.insert_one(dict(team))
    return team


async def stored(flow, team):
    return await flow.db.teams.find_one({"id": team["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_creating_a_team_stores_the_description_and_makes_the_creator_leader(flow):
    creator = await flow.add_user(role="player", name="gruenderin")
    flow.act_as(creator)

    created = await flow.post("/api/teams", json={"name": "Nachtfalken", "tag": "NFK",
                                                  "description": "Ein erfundenes Probeteam"})
    assert created.status_code == 200, created.text
    team = created.json()
    assert team["description"] == "Ein erfundenes Probeteam"
    assert team["leader_id"] == creator["id"]
    assert team["member_ids"] == [creator["id"]]

    read = await flow.get(f"/api/teams/{team['id']}")
    assert read.status_code == 200
    body = read.json()
    assert body["description"] == "Ein erfundenes Probeteam"
    assert body["leader_id"] == creator["id"]
    assert len(body["members"]) >= 1
    assert creator["id"] in [m["id"] for m in body["members"]]


@pytest.mark.asyncio
async def test_promote_transfer_and_kick_the_former_leader(flow):
    alt = await flow.add_user(role="player", name="alte-leitung")
    neu = await flow.add_user(role="player", name="neue-leitung")
    team = await make_team(flow, alt, neu)

    flow.act_as(alt)
    promoted = await flow.post(f"/api/teams/{team['id']}/members/{neu['id']}/role", json={"role": "co_leader"})
    assert promoted.status_code == 200
    assert neu["id"] in (await stored(flow, team))["co_leader_ids"]

    handed = await flow.post(f"/api/teams/{team['id']}/transfer-leader", json={"new_leader_id": neu["id"]})
    assert handed.status_code == 200
    after = handed.json()
    assert after["leader_id"] == neu["id"]
    assert alt["id"] in after["co_leader_ids"], "die bisherige Leitung wird Co-Leitung"
    assert neu["id"] not in after["co_leader_ids"], "die neue Leitung ist nicht zugleich Co-Leitung"

    flow.act_as(neu)
    kicked = await flow.delete(f"/api/teams/{team['id']}/members/{alt['id']}")
    assert kicked.status_code == 200
    fresh = await stored(flow, team)
    assert alt["id"] not in fresh["member_ids"]
    assert alt["id"] not in fresh["co_leader_ids"]
    assert fresh["leader_id"] == neu["id"]


@pytest.mark.asyncio
async def test_kick_refuses_guests_and_people_removing_themselves(flow):
    leader = await flow.add_user(role="player", name="leitung")
    mitglied = await flow.add_user(role="player", name="mitglied")
    co = await flow.add_user(role="player", name="co-leitung")
    team = await make_team(flow, leader, mitglied, co, co_leaders=[co])

    flow.act_as(None)
    guest = await flow.delete(f"/api/teams/{team['id']}/members/{mitglied['id']}")
    assert guest.status_code == 401

    # Ein normales Mitglied darf niemanden entfernen - auch sich selbst nicht (dafür gibt es „Team verlassen“).
    flow.act_as(mitglied)
    member_self = await flow.delete(f"/api/teams/{team['id']}/members/{mitglied['id']}")
    assert member_self.status_code == 403

    # Die Co-Leitung darf entfernen, aber nicht sich selbst.
    flow.act_as(co)
    co_self = await flow.delete(f"/api/teams/{team['id']}/members/{co['id']}")
    assert co_self.status_code == 400
    assert "Team verlassen" in co_self.json()["detail"]

    fresh = await stored(flow, team)
    assert {mitglied["id"], co["id"]} <= set(fresh["member_ids"])
    assert fresh["co_leader_ids"] == [co["id"]]


@pytest.mark.asyncio
async def test_transfer_refuses_outsiders_and_the_current_leader(flow):
    leader = await flow.add_user(role="player", name="leitung")
    mitglied = await flow.add_user(role="player", name="mitglied")
    fremd = await flow.add_user(role="player", name="fremd")
    team = await make_team(flow, leader, mitglied)
    flow.act_as(leader)

    outsider = await flow.post(f"/api/teams/{team['id']}/transfer-leader", json={"new_leader_id": fremd["id"]})
    assert outsider.status_code == 404
    assert outsider.json()["detail"] == "Diese Person ist nicht im Team."

    same = await flow.post(f"/api/teams/{team['id']}/transfer-leader", json={"new_leader_id": leader["id"]})
    assert same.status_code == 400
    assert same.json()["detail"] == "Diese Person hat die Teamleitung schon."

    assert (await stored(flow, team))["leader_id"] == leader["id"]
