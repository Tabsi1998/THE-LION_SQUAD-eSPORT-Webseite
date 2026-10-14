"""Station löschen, solange Spiele daran hängen (Praxis 14.10.) - durch die echten Routen.

Die alte Matchplanung hing an einer Station, die danach gelöscht wurde: die Spiele behielten die Kennung einer Station,
die es nicht mehr gab, und der Plan war nicht mehr zu lesen. Jetzt lehnt das Löschen ab, solange ein Spiel, das nicht
vorbei ist, an der Station hängt - es nennt die Spiele und den Weg (umlegen oder Termine lösen). Was vorbei ist, hält
die Station nicht fest.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id, now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def on_site_cup(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    start = (now_utc() + timedelta(hours=1)).replace(microsecond=0)
    tournament, _users, _registrations = await flow.with_participants(
        4, event_mode="local", schedule_mode="fixed_by_staff", result_entry_mode=None, start_date=start.isoformat())
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    station = {"id": new_id(), "name": "Switch 1", "device_type": "switch2", "tournament_id": tournament["id"],
               "status": "free", "current_match_id": None, "notes": None}
    await flow.db.stations.insert_one(dict(station))
    matches = [match for match in await flow.matches(tournament) if not match.get("is_preview")]
    return tournament, station, matches


async def put_on(flow, match, station, **fields):
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
        "station_id": station["id"], "scheduled_at": (now_utc() + timedelta(hours=2)).isoformat(),
        "schedule_source": "manual", **fields}})


@pytest.mark.asyncio
async def test_a_station_with_an_unstarted_match_is_not_deleted(flow):
    _tournament, station, matches = await on_site_cup(flow)
    await put_on(flow, matches[0], station)
    response = await flow.delete(f"/api/stations/{station['id']}")
    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert "Switch 1" in detail and "1 Spiel" in detail and "Matchplan" in detail
    assert (matches[0].get("match_key") or "") in detail
    assert await flow.db.stations.find_one({"id": station["id"]}) is not None
    kept = await flow.db.matches_v2.find_one({"id": matches[0]["id"]}, {"_id": 0})
    assert kept["station_id"] == station["id"] and kept["scheduled_at"] and kept["schedule_source"] == "manual"


@pytest.mark.asyncio
async def test_a_running_match_also_keeps_its_station(flow):
    _tournament, station, matches = await on_site_cup(flow)
    await put_on(flow, matches[0], station, status="in_progress", started_at=now_utc().isoformat())
    response = await flow.delete(f"/api/stations/{station['id']}")
    assert response.status_code == 409, response.text
    assert await flow.db.stations.find_one({"id": station["id"]}) is not None


@pytest.mark.asyncio
async def test_finished_matches_do_not_hold_the_station(flow):
    _tournament, station, matches = await on_site_cup(flow)
    await put_on(flow, matches[0], station, status="completed")
    response = await flow.delete(f"/api/stations/{station['id']}")
    assert response.status_code == 200, response.text
    assert await flow.db.stations.find_one({"id": station["id"]}) is None
    # Die Geschichte bleibt: das gespielte Spiel behält, wo es gespielt wurde.
    assert (await flow.db.matches_v2.find_one({"id": matches[0]["id"]}))["station_id"] == station["id"]


@pytest.mark.asyncio
async def test_a_station_without_matches_is_deleted(flow):
    _tournament, station, _matches = await on_site_cup(flow)
    response = await flow.delete(f"/api/stations/{station['id']}")
    assert response.status_code == 200, response.text
    assert await flow.db.stations.find_one({"id": station["id"]}) is None
