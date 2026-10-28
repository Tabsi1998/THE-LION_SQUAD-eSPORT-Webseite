"""Fast Lap löschen (#2112): Challenge nur als Entwurf ohne Zeiten, Gast nur ohne Zeiten - jeweils mit Protokoll.

Alles andere hängt an Ranglisten, Urkunden, Gewinnen oder Verknüpfungen und bleibt stehen.
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


async def challenge(flow, status="draft"):
    lead = await flow.add_staff()
    flow.act_as(lead)
    cid, tid = new_id(), new_id()
    await flow.db.f1_challenges.insert_one({"id": cid, "slug": f"fl-{cid[:8]}", "title": "Fast Lap", "status": status,
                                            "visibility": "public", "unlimited_attempts": True})
    await flow.db.f1_tracks.insert_one({"id": tid, "challenge_id": cid, "name": "Teststrecke"})
    return cid, tid, lead


async def add_guest(flow, cid, name="Anna"):
    response = await flow.post(f"/api/f1/challenges/{cid}/guests", json={"display_name": name})
    assert response.status_code == 200, response.text
    return response.json()


async def audit(flow, action):
    return await flow.db.audit_logs.find({"action": action}, {"_id": 0}).to_list(10)


@pytest.mark.asyncio
async def test_a_draft_without_times_is_deleted_with_a_log_entry(flow):
    cid, tid, lead = await challenge(flow)
    await add_guest(flow, cid)
    response = await flow.delete(f"/api/f1/challenges/{cid}")
    assert response.status_code == 200, response.text
    assert await flow.db.f1_challenges.count_documents({"id": cid}) == 0
    assert await flow.db.f1_tracks.count_documents({"challenge_id": cid}) == 0
    assert await flow.db.f1_guests.count_documents({"challenge_id": cid}) == 0
    rows = await audit(flow, "fastlap.challenge.delete")
    assert len(rows) == 1 and rows[0]["target_id"] == cid and rows[0]["actor_id"] == lead["id"]


@pytest.mark.asyncio
async def test_a_draft_with_times_is_not_deleted(flow):
    cid, tid, _lead = await challenge(flow)
    racer = await flow.add_user(name="fahrer")
    saved = await flow.post(f"/api/f1/challenges/{cid}/times", json={"user_id": racer["id"], "track_id": tid, "time_ms": 81000})
    assert saved.status_code == 200, saved.text
    response = await flow.delete(f"/api/f1/challenges/{cid}")
    assert response.status_code == 409, response.text
    assert await flow.db.f1_challenges.count_documents({"id": cid}) == 1
    assert await audit(flow, "fastlap.challenge.delete") == []


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["scheduled", "live", "completed", "cancelled"])
async def test_only_drafts_can_be_deleted(flow, status):
    cid, _tid, _lead = await challenge(flow, status)
    response = await flow.delete(f"/api/f1/challenges/{cid}")
    assert response.status_code == 409, response.text
    assert "Entwurf" in response.json()["detail"]
    assert await flow.db.f1_challenges.count_documents({"id": cid}) == 1


@pytest.mark.asyncio
async def test_deleting_a_challenge_needs_the_tournament_area(flow):
    cid, _tid, _lead = await challenge(flow)
    flow.act_as(await flow.add_user(name="niemand"))
    response = await flow.delete(f"/api/f1/challenges/{cid}")
    assert response.status_code == 403
    assert await flow.db.f1_challenges.count_documents({"id": cid}) == 1


@pytest.mark.asyncio
async def test_a_guest_without_times_is_deleted_and_leaves_the_queue(flow):
    cid, tid, lead = await challenge(flow, "live")
    guest = await add_guest(flow, cid)
    queued = await flow.post(f"/api/f1/challenges/{cid}/queue", json={"guest_id": guest["id"], "track_id": tid})
    assert queued.status_code == 200, queued.text
    listed = await flow.get(f"/api/f1/challenges/{cid}/guests")
    assert [row["has_times"] for row in listed.json()] == [False]
    response = await flow.delete(f"/api/f1/guests/{guest['id']}")
    assert response.status_code == 200, response.text
    assert await flow.db.f1_guests.count_documents({"id": guest["id"]}) == 0
    assert await flow.db.f1_queue.count_documents({"guest_id": guest["id"]}) == 0
    rows = await audit(flow, "fastlap.guest.delete")
    assert len(rows) == 1 and rows[0]["target_id"] == guest["id"] and rows[0]["data"] == {"challenge_id": cid, "reason": None, "after_publishing": False}


@pytest.mark.asyncio
async def test_a_guest_with_times_stays(flow):
    cid, tid, _lead = await challenge(flow, "live")
    guest = await add_guest(flow, cid)
    saved = await flow.post(f"/api/f1/challenges/{cid}/times", json={"guest_id": guest["id"], "track_id": tid, "time_ms": 81000})
    assert saved.status_code == 200, saved.text
    listed = await flow.get(f"/api/f1/challenges/{cid}/guests")
    assert [row["has_times"] for row in listed.json()] == [True]
    response = await flow.delete(f"/api/f1/guests/{guest['id']}")
    assert response.status_code == 409, response.text
    assert await flow.db.f1_guests.count_documents({"id": guest["id"]}) == 1
    assert await audit(flow, "fastlap.guest.delete") == []


@pytest.mark.asyncio
async def test_deleting_a_guest_needs_fast_lap_rights(flow):
    cid, _tid, _lead = await challenge(flow, "live")
    guest = await add_guest(flow, cid)
    flow.act_as(await flow.add_user(name="niemand"))
    response = await flow.delete(f"/api/f1/guests/{guest['id']}")
    assert response.status_code == 403
    assert await flow.db.f1_guests.count_documents({"id": guest["id"]}) == 1


@pytest.mark.asyncio
async def test_after_publishing_only_the_lead_deletes_a_guest_and_with_a_reason(flow):
    """#2112: dieselbe Regel wie beim Umbenennen - Helfer nicht, Leitung nur mit Begründung (im Protokoll)."""
    cid, _tid, lead = await challenge(flow, "live")
    guest = await add_guest(flow, cid)
    helper = await flow.add_user(name="zeitnehmer")
    await flow.db.f1_staff_assignments.insert_one({"id": new_id(), "challenge_id": cid, "user_id": helper["id"], "role": "scorekeeper", "is_active": True})
    await flow.db.f1_challenges.update_one({"id": cid}, {"$set": {"status": "results_published"}})
    flow.act_as(helper)
    refused = await flow.delete(f"/api/f1/guests/{guest['id']}")
    assert refused.status_code == 409
    flow.act_as(lead)
    without = await flow.delete(f"/api/f1/guests/{guest['id']}")
    assert without.status_code == 409
    assert await flow.db.f1_guests.count_documents({"id": guest["id"]}) == 1
    reason = "Doppelt angelegt, nie gefahren"
    response = await flow.client.request("DELETE", f"/api/f1/guests/{guest['id']}", json={"change_reason": reason})
    assert response.status_code == 200, response.text
    rows = await audit(flow, "fastlap.guest.delete")
    assert rows[0]["data"]["reason"] == reason and rows[0]["data"]["after_publishing"] is True