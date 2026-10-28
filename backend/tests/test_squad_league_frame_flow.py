"""Co-Teams in einer Staffel, die der Liga-Rahmen (P1) anlegt (#1649 mit #1622): der Mindestkader kommt aus dem Feld
``min_squad_size`` am Staffel-Turnier, der Season-Schlüssel aus ``league_context``. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from squad_world import make_squad, make_team  # noqa: E402
from test_league_admin_flow import ADMIN, setup_league  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_a_staffel_of_the_league_frame_takes_squads_with_its_own_minimum(flow):
    admin, game, _league, season, division, _maps = await setup_league(flow, season={"min_squad_size": 5})
    created = await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})
    assert created.status_code == 200, created.text
    staffel = await flow.db.tournaments.find_one({"id": created.json()["tournament_id"]}, {"_id": 0})
    assert staffel["min_squad_size"] == 5, "der Rahmen schreibt den Mindestkader ans Turnier"

    people = [await flow.add_user(name=f"Rahmen{i}") for i in range(7)]
    team = await make_team(flow, "Rahmenteam", leader=people[0], members=people[1:])
    small = await make_squad(flow, team, "Vier", people[:4], game_id=game["id"])
    full = await make_squad(flow, team, "Fünf", people[:5], game_id=game["id"])
    flow.act_as(admin)
    url = f"/api/tournaments/{staffel['id']}/squad-registrations"

    refused = await flow.post(url, json={"team_id": team["id"], "squad_id": small["id"]})
    assert refused.status_code == 400
    assert "mindestens 5" in refused.json()["detail"]
    placed = await flow.post(url, json={"team_id": team["id"], "squad_id": full["id"]})
    assert placed.status_code == 200, placed.text
    stored = await flow.db.tournament_registrations.find_one({"id": placed.json()["registration"]["id"]}, {"_id": 0})
    assert stored["league_squad_key"] == f"{season['id']}:{full['id']}"
    assert stored["display_name"] == "Rahmenteam · Fünf"
