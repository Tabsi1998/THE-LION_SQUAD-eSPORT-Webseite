"""Beitrittscode erneuern (#2128, TM10): Teamleitung und Co-Leitung, der alte Code gilt danach nicht mehr, im Protokoll steht
kein Code. Erfundene Daten."""
import logging
import pathlib
import sys

import pytest
import pytest_asyncio
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "team-join-code-secret-with-at-least-32-chars")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def make_team(flow, leader, *members, co=()):
    team = {"id": new_id(), "name": "Rudel", "tag": "RDL", "leader_id": leader["id"], "co_leader_ids": [c["id"] for c in co],
            "member_ids": [leader["id"], *[m["id"] for m in members]], "join_code": "Alt-Code1", "is_public": True}
    await flow.db.teams.insert_one(dict(team))
    return team


@pytest.mark.asyncio
async def test_renew_join_code(flow, caplog):
    leader = await flow.add_user(role="player", name="leitung")
    co = await flow.add_user(role="player", name="co")
    member = await flow.add_user(role="player", name="mila")
    outsider = await flow.add_user(role="player", name="fremd")
    team = await make_team(flow, leader, co, member, co=(co,))
    url = f"/api/teams/{team['id']}/join-code"

    flow.act_as(member)
    assert (await flow.post(url)).status_code == 403
    flow.act_as(outsider)
    assert (await flow.post(url)).status_code == 403

    caplog.set_level(logging.INFO)
    flow.act_as(leader)
    first = await flow.post(url)
    assert first.status_code == 200
    code = first.json()["join_code"]
    assert code and code != "Alt-Code1"
    flow.act_as(co)
    second = (await flow.post(url)).json()["join_code"]
    assert second != code

    flow.act_as(outsider)
    assert (await flow.post(f"/api/teams/{team['id']}/join", json={"join_code": "Alt-Code1"})).status_code == 403, "alter Code"
    assert (await flow.post(f"/api/teams/{team['id']}/join", json={"join_code": code})).status_code == 403
    assert (await flow.post(f"/api/teams/{team['id']}/join", json={"join_code": second})).status_code == 200

    rows = await flow.db.audit_logs.find({"action": "team.join_code.renew", "target_id": team["id"]}, {"_id": 0}).to_list(5)
    assert [row["actor_id"] for row in rows] == [leader["id"], co["id"]]
    everything = str(await flow.db.audit_logs.find({}, {"_id": 0}).to_list(50)) + caplog.text
    for value in (code, second, "Alt-Code1"):
        assert value not in everything, "keine Codes in Protokoll und Log"


@pytest.mark.asyncio
async def test_a_collision_just_draws_again():
    from services import team_page

    class Teams:
        calls = 0

        async def update_one(self, *_args, **_kwargs):
            self.calls += 1
            if self.calls == 1:
                raise DuplicateKeyError("join_code")

    class Db:
        teams = Teams()

    assert await team_page.renew_join_code(Db(), "team-1")
    assert Db.teams.calls == 2
