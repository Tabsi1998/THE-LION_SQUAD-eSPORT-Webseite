"""Name und Kürzel eines Teams (#2128, TM11): Grenzen beim Anlegen und beim Ändern, ältere Werte bleiben bearbeitbar.
Erfundene Daten."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import TEAM_NAME_MAX_LENGTH, TEAM_TAG_MAX_LENGTH  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_limits_when_creating(flow):
    flow.act_as(await flow.add_user(role="player", name="leitung"))
    long_name = await flow.post("/api/teams", json={"name": "N" * (TEAM_NAME_MAX_LENGTH + 1), "tag": "NN"})
    assert long_name.status_code == 422 and "Name" in long_name.json()["detail"][0]["msg"]
    assert (await flow.post("/api/teams", json={"name": "X", "tag": "XY"})).status_code == 422
    assert (await flow.post("/api/teams", json={"name": "Rudel", "tag": "R"})).status_code == 422
    short = await flow.post("/api/teams", json={"name": "Rudel", "tag": " " })
    assert short.status_code == 422
    too_long = await flow.post("/api/teams", json={"name": "Rudel", "tag": "T" * (TEAM_TAG_MAX_LENGTH + 1)})
    assert too_long.status_code == 422 and "Kürzel" in too_long.json()["detail"][0]["msg"]
    good = await flow.post("/api/teams", json={"name": "  Rudel  ", "tag": " RDL "})
    assert good.status_code == 200 and good.json()["name"] == "Rudel" and good.json()["tag"] == "RDL"


@pytest.mark.asyncio
async def test_limits_when_changing_and_old_values_stay_editable(flow):
    leader = await flow.add_user(role="player", name="leitung")
    old_name = "Sehr langer alter Teamname " * 5
    team = {"id": new_id(), "name": old_name, "tag": "LANGESKUERZEL", "leader_id": leader["id"], "co_leader_ids": [],
            "member_ids": [leader["id"]], "is_public": True}
    await flow.db.teams.insert_one(dict(team))
    await flow.db.teams.insert_one({"id": new_id(), "name": "Andere", "tag": "AND", "leader_id": new_id(), "member_ids": []})
    flow.act_as(leader)
    url = f"/api/teams/{team['id']}"

    same = await flow.patch(url, json={"name": old_name, "tag": "LANGESKUERZEL", "description": "Neu"})
    assert same.status_code == 200 and same.json()["description"] == "Neu", "das Formular schickt Name und Kürzel immer mit"

    too_long = await flow.patch(url, json={"tag": "NOCHLAENGERALSVORHER"})
    assert too_long.status_code == 400 and "Kürzel" in too_long.json()["detail"]
    one = await flow.patch(url, json={"tag": "A"})
    assert one.status_code == 400, "die App erlaubte ein Zeichen"
    assert (await flow.patch(url, json={"name": "A"})).status_code == 400
    assert (await flow.patch(url, json={"name": "N" * (TEAM_NAME_MAX_LENGTH + 1)})).status_code == 400
    taken = await flow.patch(url, json={"tag": "AND"})
    assert taken.status_code == 409 and taken.json()["detail"] == "Dieses Kürzel ist schon vergeben."
    done = await flow.patch(url, json={"name": " Rudel ", "tag": " RDL "})
    assert done.status_code == 200 and done.json()["name"] == "Rudel" and done.json()["tag"] == "RDL"
