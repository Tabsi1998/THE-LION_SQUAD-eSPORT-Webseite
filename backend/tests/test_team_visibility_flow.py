"""Team öffentlich/privat (#2128, TM9): nur die Teamleitung schaltet um, Standard bleibt öffentlich, privat heißt: nicht in
Liste, Suche und Level-Übersicht, die Seite nur für Mitglieder. Erfundene Daten."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "team-visibility-secret-with-at-least-32-chars")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_only_the_lead_switches_and_private_means_hidden(flow):
    leader = await flow.add_user(role="player", name="leitung")
    co = await flow.add_user(role="player", name="co")
    outsider = await flow.add_user(role="player", name="fremd")
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    flow.act_as(leader)
    created = await flow.post("/api/teams", json={"name": "Geheimrudel", "tag": "GHR"})
    assert created.json()["is_public"] is True, "Standard unverändert öffentlich"
    team = created.json()
    url = f"/api/teams/{team['id']}"
    await flow.db.teams.update_one({"id": team["id"]}, {"$set": {"co_leader_ids": [co["id"]], "member_ids": [leader["id"], co["id"]]}})

    flow.act_as(co)
    refused = await flow.patch(url, json={"is_public": False})
    assert refused.status_code == 403 and "Teamleitung" in refused.json()["detail"]
    assert (await flow.patch(url, json={"is_public": True, "description": "Co-Leitung pflegt"})).status_code == 200, "unverändert stört nicht"
    flow.act_as(lead)
    assert (await flow.patch(url, json={"is_public": False})).status_code == 403

    flow.act_as(leader)
    done = await flow.patch(url, json={"is_public": False})
    assert done.status_code == 200 and done.json()["is_public"] is False
    row = await flow.db.audit_logs.find_one({"action": "team.visibility", "target_id": team["id"]})
    assert row and row["data"] == {"is_public": False} and row["actor_id"] == leader["id"]

    assert (await flow.get(f"{url}/level")).status_code == 200, "Mitglieder sehen ihr Level"
    flow.act_as(outsider)
    assert (await flow.get(url)).status_code == 404
    assert (await flow.get(f"{url}/overview")).status_code == 404
    assert (await flow.get(f"{url}/level")).status_code == 404
    assert team["id"] not in [row["id"] for row in (await flow.get("/api/teams")).json()]
    assert team["id"] not in [row["id"] for row in (await flow.get("/api/teams", params={"q": "Geheim"})).json()]
    assert team["id"] not in (await flow.get("/api/teams/levels")).json()["levels"]

    flow.act_as(leader)
    assert (await flow.patch(url, json={"is_public": True})).status_code == 200
    flow.act_as(outsider)
    assert (await flow.get(url)).status_code == 200
