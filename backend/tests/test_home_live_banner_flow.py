"""Das Live-Band der Startseite folgt der Phase der Detailseite: Nach dem Ende steht dort „Beendet“, also auch kein Band."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def stamps(hours_from_start: int, hours_to_end: int) -> dict:
    return {"start_date": (now_utc() - timedelta(hours=hours_from_start)).isoformat(),
            "end_date": (now_utc() + timedelta(hours=hours_to_end)).isoformat(),
            "created_at": now_utc().isoformat()}


async def live_slugs(flow, kind: str) -> list[str]:
    response = await flow.get("/api/home/state")
    assert response.status_code == 200, response.text
    return [row["slug"] for row in response.json()["live"][kind]]


@pytest.mark.asyncio
async def test_a_tournament_past_its_end_leaves_the_banner_although_the_status_is_still_live(flow):
    await flow.db.tournaments.insert_one({"id": "t-ended", "slug": "vorbei", "title": "Vorbei", "status": "live", "is_public": True,
                                          "visibility": "public", **stamps(30, -24)})
    await flow.db.tournaments.insert_one({"id": "t-running", "slug": "laeuft", "title": "Läuft", "status": "live", "is_public": True,
                                          "visibility": "public", **stamps(1, 3)})
    await flow.db.tournaments.insert_one({"id": "t-open", "slug": "ohne-ende", "title": "Ohne Ende", "status": "live", "is_public": True,
                                          "visibility": "public", "start_date": (now_utc() - timedelta(hours=1)).isoformat(),
                                          "created_at": now_utc().isoformat()})
    assert sorted(await live_slugs(flow, "tournaments")) == ["laeuft", "ohne-ende"]
    response = await flow.get("/api/home/state")
    assert response.json()["has_live"] is True


@pytest.mark.asyncio
async def test_a_fast_lap_past_its_end_leaves_the_banner_too(flow):
    await flow.db.f1_challenges.insert_one({"id": "c-ended", "slug": "vorbei", "title": "Vorbei", "status": "live", "visibility": "public", **stamps(30, -24)})
    await flow.db.f1_challenges.insert_one({"id": "c-running", "slug": "laeuft", "title": "Läuft", "status": "live", "visibility": "public", **stamps(1, 3)})
    assert await live_slugs(flow, "challenges") == ["laeuft"]


@pytest.mark.asyncio
async def test_only_ended_rows_mean_no_banner_at_all(flow):
    await flow.db.tournaments.insert_one({"id": "t-ended", "slug": "vorbei", "title": "Vorbei", "status": "live", "is_public": True,
                                          "visibility": "public", **stamps(30, -24)})
    response = await flow.get("/api/home/state")
    assert response.json()["has_live"] is False
