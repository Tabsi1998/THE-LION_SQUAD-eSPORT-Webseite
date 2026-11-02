"""Team öffentlich/privat (#2128, TM9): nur die Teamleitung schaltet um, Standard bleibt öffentlich, privat heißt: nicht in
Liste, Suche und Level-Übersicht, die Seite nur für Mitglieder. Erfundene Daten."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


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


async def _two_teams(flow, monkeypatch):
    from routes import team_level_routes

    leader = await flow.add_user(role="player", name="leitung")
    secret = {"id": "geheim", "name": "Geheim", "tag": "GHM", "leader_id": leader["id"], "member_ids": [leader["id"]], "is_public": False}
    open_team = {"id": "offen", "name": "Offen", "tag": "OFF", "leader_id": new_id(), "member_ids": [], "is_public": True}
    await flow.db.teams.insert_many([dict(secret), dict(open_team)])
    levels = {"geheim": {"team_id": "geheim", "points": 500, "level": 5, "progress": 0},
              "offen": {"team_id": "offen", "points": 100, "level": 2, "progress": 0}}

    async def cached():
        return levels

    monkeypatch.setattr(team_level_routes, "get_all_team_levels", cached)
    return leader, levels


@pytest.mark.asyncio
async def test_the_crown_is_the_same_in_list_and_detail(flow, monkeypatch):
    """Prüfer-Probe: Ein privates Team mit den meisten Punkten nimmt dem besten öffentlichen die Krone nirgends weg."""
    leader, _levels = await _two_teams(flow, monkeypatch)
    flow.act_as(None)
    assert (await flow.get("/api/teams/levels")).json()["crowns"] == {"offen": "gold"}
    assert (await flow.get("/api/teams/offen/level")).json()["crown"] == "gold"
    flow.act_as(leader)
    own = (await flow.get("/api/teams/geheim/level")).json()
    assert own["points"] == 500 and own["crown"] is None


@pytest.mark.asyncio
async def test_level_of_a_team_that_is_gone_is_404_even_from_the_cache(flow, monkeypatch):
    _leader, levels = await _two_teams(flow, monkeypatch)
    levels["weg"] = {"team_id": "weg", "points": 1, "level": 1, "progress": 0}
    flow.act_as(None)
    assert (await flow.get("/api/teams/weg/level")).status_code == 404


@pytest.mark.asyncio
async def test_dissolving_and_restoring_renew_the_level_cache(flow):
    from services import team_levels

    leader = await flow.add_user(role="player", name="leitung")
    team = {"id": new_id(), "name": "Rudel", "tag": "RDL", "leader_id": leader["id"], "co_leader_ids": [], "member_ids": [leader["id"]], "is_public": True}
    await flow.db.teams.insert_one(dict(team))
    flow.act_as(leader)
    team_levels.forget_cached_levels()
    assert team["id"] in (await flow.get("/api/teams/levels")).json()["levels"]

    gone = await flow.delete(f"/api/teams/{team['id']}", params={"confirm": "Rudel"})
    assert gone.status_code == 200
    assert team["id"] not in (await flow.get("/api/teams/levels")).json()["levels"]
    assert (await flow.get(f"/api/teams/{team['id']}/level")).status_code == 404

    assert (await flow.post(f"/api/teams/{team['id']}/restore")).status_code == 200
    assert team["id"] in (await flow.get("/api/teams/levels")).json()["levels"]
    assert (await flow.get(f"/api/teams/{team['id']}/level")).status_code == 200
    team_levels.forget_cached_levels()
