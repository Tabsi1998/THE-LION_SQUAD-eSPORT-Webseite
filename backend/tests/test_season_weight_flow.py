"""Gewicht 0 = keine Jahreswertung (#2095): ``season_weight or 2.0`` machte aus 0 wieder 2."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def publish_tournament(flow, monkeypatch, **fields):
    """Zwei Teilnehmer, Ergebnisse veroeffentlicht - gibt die geschriebenen Jahrespunkte zurueck (seit #2123 gleicht
    ``sync_tournament_points`` sie an, statt ``award_points`` je Person aufzurufen)."""
    tournament = await flow.create_tournament(title="Herbst-Cup", slug="herbst-cup", status="completed", **fields)
    for index in (1, 2):
        await flow.register(tournament, await flow.add_user(name=f"Spieler {index}"))
    await flow.db.seasons.insert_one({"id": "s-1", "slug": "saison", "name": "Saison", "status": "active"})
    flow.act_as(await flow.add_staff())
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status",
                               json={"status": "results_published", "force": True})
    assert response.status_code == 200, response.text
    return await flow.db.season_points.find({"source_id": tournament["id"]}, {"_id": 0}).to_list(10)


@pytest.mark.asyncio
async def test_a_tournament_with_weight_zero_awards_no_season_points(flow, monkeypatch):
    assert await publish_tournament(flow, monkeypatch, season_weight=0) == []


@pytest.mark.asyncio
async def test_a_tournament_without_weight_uses_the_default(flow, monkeypatch):
    calls = await publish_tournament(flow, monkeypatch)
    assert calls and {call["weight"] for call in calls} == {2.0}


@pytest.mark.asyncio
async def test_a_tournament_keeps_its_own_weight(flow, monkeypatch):
    calls = await publish_tournament(flow, monkeypatch, season_weight=1.5)
    assert calls and {call["weight"] for call in calls} == {1.5}
    assert {call["source_type"] for call in calls} == {"tournament"}
