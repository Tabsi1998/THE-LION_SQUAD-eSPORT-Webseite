"""Das Event als Klammer (#1182): die kurzen Listen von Turnieren und Fast Laps sagen, zu welchem Event sie gehören und
wann sie enden - die Event-Liste im Web stellt sie damit unter ihr Event, statt sie ein zweites Mal zu zeigen."""
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


@pytest.mark.asyncio
async def test_compact_lists_name_their_event(flow):
    await flow.create_tournament(id="t-lan", slug="lan-cup", event_id="e-lan", start_date="2099-10-10T12:00:00+00:00",
                                 end_date="2099-10-10T18:00:00+00:00", team_mode="team")
    await flow.create_tournament(id="t-solo", slug="solo-cup")
    await flow.db.f1_challenges.insert_many([
        {"id": "f-lan", "slug": "lan-lap", "title": "LAN Fast Lap", "status": "live", "visibility": "public", "event_id": "e-lan",
         "start_date": "2099-10-10T10:00:00+00:00", "end_date": "2099-10-11T20:00:00+00:00"},
        {"id": "f-solo", "slug": "solo-lap", "title": "Fast Lap", "status": "live", "visibility": "public"},
    ])
    flow.act_as(None)

    tournaments = {row["id"]: row for row in (await flow.get("/api/tournaments", params={"compact": "true"})).json()}
    assert tournaments["t-lan"]["event_id"] == "e-lan" and tournaments["t-lan"]["end_date"] and tournaments["t-lan"]["team_mode"] == "team"
    assert tournaments["t-solo"]["event_id"] is None

    challenges = {row["id"]: row for row in (await flow.get("/api/f1/challenges", params={"compact": "true"})).json()}
    assert challenges["f-lan"]["event_id"] == "e-lan" and challenges["f-lan"]["end_date"].startswith("2099-10-11")
    assert challenges["f-solo"]["event_id"] is None
