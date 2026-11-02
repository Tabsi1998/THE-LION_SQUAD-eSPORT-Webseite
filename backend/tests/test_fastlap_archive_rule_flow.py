"""Fast Lap archivieren (#2130, F1-2): Jahrespunkte gibt es nur bei „Ergebnisse veröffentlicht“. „Beendet → Archiviert“
hätte sie still übersprungen - archiviert wird deshalb erst danach. Was schon im Archiv liegt, bleibt, wie es ist.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow, status, *, with_time=True, **time_extra):
    lead = await flow.add_staff()
    flow.act_as(lead)
    cid, tid = new_id(), new_id()
    await flow.db.seasons.insert_one({"id": "s-1", "name": "Wertung", "status": "active"})
    await flow.db.f1_challenges.insert_one({"id": cid, "slug": f"fl-{cid[:8]}", "title": "Fast Lap", "status": "live",
                                            "visibility": "public", "unlimited_attempts": True})
    await flow.db.f1_tracks.insert_one({"id": tid, "challenge_id": cid, "name": "Teststrecke"})
    if with_time:
        racer = await flow.add_user(name="fahrer")
        saved = await flow.post(f"/api/f1/challenges/{cid}/times",
                                json={"user_id": racer["id"], "track_id": tid, "time_ms": 81000, **time_extra})
        assert saved.status_code == 200, saved.text
    await flow.db.f1_challenges.update_one({"id": cid}, {"$set": {"status": status}})
    return cid


async def set_status(flow, cid, status):
    return await flow.patch(f"/api/f1/challenges/{cid}", json={"status": status})


async def points(flow):
    return await flow.db.season_points.count_documents({"source_type": "fastlap"})


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["live", "paused", "completed"])
async def test_with_times_archiving_needs_published_results_first(flow, status):
    cid = await setup(flow, status)
    response = await set_status(flow, cid, "archived")
    assert response.status_code == 409, response.text
    assert "Ergebnisse veröffentlicht" in response.json()["detail"]
    assert (await flow.db.f1_challenges.find_one({"id": cid}))["status"] == status


@pytest.mark.asyncio
async def test_after_publishing_archiving_keeps_the_points(flow):
    cid = await setup(flow, "completed")
    assert (await set_status(flow, cid, "results_published")).status_code == 200
    assert await points(flow) == 1
    response = await set_status(flow, cid, "archived")
    assert response.status_code == 200, response.text
    assert await points(flow) == 1


@pytest.mark.asyncio
async def test_a_cancelled_challenge_can_be_archived_with_times(flow):
    cid = await setup(flow, "cancelled")
    assert (await set_status(flow, cid, "archived")).status_code == 200
    assert await points(flow) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("extra", [{"score_scope": "club_reference"}, {"is_invalid": True, "admin_note": "Strecke verlassen"}])
async def test_without_scoring_times_there_is_nothing_to_lose(flow, extra):
    cid = await setup(flow, "completed", **extra)
    assert (await set_status(flow, cid, "archived")).status_code == 200


@pytest.mark.asyncio
async def test_without_times_archiving_stays_open(flow):
    cid = await setup(flow, "draft", with_time=False)
    assert (await set_status(flow, cid, "archived")).status_code == 200


@pytest.mark.asyncio
async def test_what_is_already_archived_stays_editable_and_gets_no_points_by_itself(flow):
    """Altbestand: Beendet → Archiviert von früher. Speichern geht weiter, Punkte kommen nur mit bewusstem Veröffentlichen."""
    cid = await setup(flow, "archived")
    saved = await flow.patch(f"/api/f1/challenges/{cid}", json={"description": "Rückblick", "status": "archived"})
    assert saved.status_code == 200, saved.text
    assert await points(flow) == 0
    assert (await set_status(flow, cid, "results_published")).status_code == 200
    assert await points(flow) == 1
