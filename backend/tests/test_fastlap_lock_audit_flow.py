"""Fast-Lap-Zeiten nach „Ergebnisse veröffentlicht“, Protokoll, Plausibilität und Export (#1584).

- Nach der Veröffentlichung (und im Archiv) sind Eintragen, Ändern und Löschen gesperrt. Nur die Turnierleitung darf
  noch ändern, und nur mit Begründung.
- Eintragen, Ändern, Löschen und Strafen stehen im Protokoll (``audit_logs``) - ohne Namen, nur mit Kennungen.
- Eine Korrektur trägt ``updated_by``; die Strafen-Liste nennt als Aussteller, wer die Strafe gesetzt hat.
- Eine unplausible Zeit (Standard: unter 20 s oder über 10 min, je Strecke einstellbar) braucht eine Bestätigung.
- Der Zeitplan setzt eine Fast Lap am Ende nicht mehr selbst auf „Beendet“ - das bestätigt die Leitung.
- Tabelle und Widget antworten nur für Strecken der eigenen Challenge; der Export gibt Namen als Text aus."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402

REASON = "Zeitnahme-Fehler laut Video korrigiert"
NOTE = "Track Limits in Kurve 4"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow, status="live", **track_extra):
    lead = await flow.add_staff()
    flow.act_as(lead)
    cid, tid = new_id(), new_id()
    await flow.db.f1_challenges.insert_one({"id": cid, "slug": f"fl-{cid[:8]}", "title": "Fast Lap", "status": status, "visibility": "public"})
    await flow.db.f1_tracks.insert_one({"id": tid, "challenge_id": cid, "name": "Teststrecke", **track_extra})
    driver = await flow.add_user(name="fahrerin")
    helper = await flow.add_user(name="zeitnehmer")
    await flow.db.f1_staff_assignments.insert_one({"id": new_id(), "challenge_id": cid, "user_id": helper["id"], "role": "scorekeeper", "is_active": True})
    return cid, tid, driver, lead, helper


async def enter(flow, cid, tid, driver, **fields):
    return await flow.post(f"/api/f1/challenges/{cid}/times", json={"user_id": driver["id"], "track_id": tid, "time_ms": 81234, **fields})


async def remove(flow, time_id, **body):
    return await flow.client.request("DELETE", f"/api/f1/times/{time_id}", json=body or None)


async def publish(flow, cid):
    await flow.db.f1_challenges.update_one({"id": cid}, {"$set": {"status": "results_published"}})


async def audit(flow, action):
    return await flow.db.audit_logs.find({"action": action}, {"_id": 0}).to_list(50)


# ------------------------------------------------------------------ Sperre nach Veröffentlichung

@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["results_published", "archived"])
async def test_after_publishing_helpers_can_change_nothing(flow, status):
    cid, tid, driver, _lead, helper = await setup(flow)
    lap = (await enter(flow, cid, tid, driver)).json()
    await flow.db.f1_challenges.update_one({"id": cid}, {"$set": {"status": status}})
    flow.act_as(helper)
    for response in (
        await enter(flow, cid, tid, driver, change_reason=REASON),
        await flow.patch(f"/api/f1/times/{lap['id']}", json={"time_ms": 80000, "change_reason": REASON}),
        await remove(flow, lap["id"], change_reason=REASON),
    ):
        assert response.status_code == 409, response.text
        assert "veröffentlicht" in response.json()["detail"]
    assert await flow.db.f1_lap_times.count_documents({"challenge_id": cid}) == 1
    assert (await flow.db.f1_lap_times.find_one({"id": lap["id"]}))["time_ms"] == 81234


@pytest.mark.asyncio
async def test_after_publishing_the_lead_needs_a_reason(flow):
    cid, tid, driver, _lead, _helper = await setup(flow)
    lap = (await enter(flow, cid, tid, driver)).json()
    await publish(flow, cid)
    response = await enter(flow, cid, tid, driver)
    assert response.status_code == 409
    response = await flow.patch(f"/api/f1/times/{lap['id']}", json={"time_ms": 80000})
    assert response.status_code == 409
    response = await flow.patch(f"/api/f1/times/{lap['id']}", json={"time_ms": 80000, "change_reason": "kurz"})
    assert response.status_code == 409
    response = await remove(flow, lap["id"])
    assert response.status_code == 409
    assert await flow.db.f1_lap_times.count_documents({"challenge_id": cid}) == 1


@pytest.mark.asyncio
async def test_after_publishing_the_lead_changes_with_a_reason_and_it_is_logged(flow):
    cid, tid, driver, lead, _helper = await setup(flow)
    lap = (await enter(flow, cid, tid, driver)).json()
    await publish(flow, cid)
    changed = await flow.patch(f"/api/f1/times/{lap['id']}", json={"time_ms": 80000, "change_reason": REASON})
    assert changed.status_code == 200, changed.text
    rows = await audit(flow, "fastlap.time.update")
    assert len(rows) == 1
    row = rows[0]
    assert row["actor_id"] == lead["id"] and row["target_id"] == lap["id"]
    assert row["data"]["reason"] == REASON and row["data"]["after_publishing"] is True
    assert row["data"]["before"]["time_ms"] == 81234 and row["data"]["after"]["time_ms"] == 80000
    added = await enter(flow, cid, tid, driver, time_ms=79000, change_reason=REASON)
    assert added.status_code == 200, added.text
    removed = await remove(flow, added.json()["id"], change_reason=REASON)
    assert removed.status_code == 200, removed.text
    assert [r["data"]["reason"] for r in await audit(flow, "fastlap.time.delete")] == [REASON]


# ------------------------------------------------------------------ Protokoll im laufenden Betrieb

@pytest.mark.asyncio
async def test_entering_correcting_penalising_and_deleting_are_logged_without_names(flow):
    cid, tid, driver, _lead, helper = await setup(flow)
    flow.act_as(helper)
    lap = (await enter(flow, cid, tid, driver)).json()
    response = await flow.patch(f"/api/f1/times/{lap['id']}", json={"penalty_seconds": 5, "admin_note": NOTE})
    assert response.status_code == 200
    response = await remove(flow, lap["id"])
    assert response.status_code == 200
    created, updated, penalty, deleted = [await audit(flow, a) for a in (
        "fastlap.time.create", "fastlap.time.update", "fastlap.time.penalty", "fastlap.time.delete")]
    assert [len(created), len(updated), len(penalty), len(deleted)] == [1, 1, 1, 1]
    for row in (*created, *updated, *penalty, *deleted):
        assert row["actor_id"] == helper["id"] and row["target_id"] == lap["id"]
        assert row["data"]["challenge_id"] == cid and row["data"]["user_id"] == driver["id"]
        assert "fahrerin" not in str(row) and "zeitnehmer" not in str(row)
    assert penalty[0]["data"]["after"]["penalty_seconds"] == 5
    assert deleted[0]["data"]["before"]["time_ms"] == 81234


@pytest.mark.asyncio
async def test_a_correction_records_who_and_the_penalty_list_names_who_set_the_penalty(flow):
    cid, tid, driver, lead, helper = await setup(flow)
    lap = (await enter(flow, cid, tid, driver)).json()  # eingetragen von der Leitung
    flow.act_as(helper)
    response = await flow.patch(f"/api/f1/times/{lap['id']}", json={"penalty_seconds": 5, "admin_note": NOTE})
    assert response.status_code == 200
    saved = await flow.db.f1_lap_times.find_one({"id": lap["id"]}, {"_id": 0})
    assert saved["updated_by"] == helper["id"] and saved["created_by"] == lead["id"]
    flow.act_as(driver)
    items = (await flow.get("/api/penalties/me")).json()["items"]
    assert [(i["issued_by"], i["issued_by_name"]) for i in items] == [(helper["id"], "zeitnehmer")]


# ------------------------------------------------------------------ Plausibilität

@pytest.mark.asyncio
@pytest.mark.parametrize("time_ms", [19999, 600001])
async def test_an_implausible_time_needs_a_confirmation(flow, time_ms):
    cid, tid, driver, _lead, _helper = await setup(flow)
    refused = await enter(flow, cid, tid, driver, time_ms=time_ms)
    assert refused.status_code == 422, refused.text
    assert "bestätig" in refused.json()["detail"]
    assert await flow.db.f1_lap_times.count_documents({}) == 0
    confirmed = await enter(flow, cid, tid, driver, time_ms=time_ms, confirm_implausible=True)
    assert confirmed.status_code == 200, confirmed.text


@pytest.mark.asyncio
async def test_plausibility_limits_per_track(flow):
    cid, tid, driver, _lead, _helper = await setup(flow, min_plausible_ms=10000, max_plausible_ms=None)
    response = await enter(flow, cid, tid, driver, time_ms=15000)
    assert response.status_code == 200
    lap = (await enter(flow, cid, tid, driver, time_ms=81234)).json()
    # Eine Korrektur ohne neue Zeit fragt nicht noch einmal; eine neue unplausible Zeit schon.
    response = await flow.patch(f"/api/f1/times/{lap['id']}", json={"penalty_seconds": 1, "admin_note": NOTE})
    assert response.status_code == 200
    response = await flow.patch(f"/api/f1/times/{lap['id']}", json={"time_ms": 9000})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_the_lead_sets_plausibility_limits_on_the_track(flow):
    cid, tid, _driver, _lead, _helper = await setup(flow)
    saved = await flow.patch(f"/api/f1/tracks/{tid}", json={"min_plausible_ms": 30000, "max_plausible_ms": 120000})
    assert saved.status_code == 200, saved.text
    assert (saved.json()["min_plausible_ms"], saved.json()["max_plausible_ms"]) == (30000, 120000)
    cleared = await flow.patch(f"/api/f1/tracks/{tid}", json={"min_plausible_ms": None})
    assert cleared.json()["min_plausible_ms"] is None


# ------------------------------------------------------------------ Ende nicht automatisch

def test_the_schedule_does_not_end_a_fast_lap_by_itself():
    from services.scheduler import _next_status
    now = datetime(2026, 10, 31, 23, 0, tzinfo=timezone.utc)
    past = (now - timedelta(hours=1)).isoformat()
    started = (now - timedelta(hours=10)).isoformat()
    assert _next_status({"status": "live", "start_date": started, "end_date": past}, now, "f1") is None
    assert _next_status({"status": "scheduled", "start_date": started, "end_date": past}, now, "f1") is None
    # Events beenden sich weiter selbst, eine laufende Fast Lap startet weiter zur Zeit.
    assert _next_status({"status": "live", "start_date": started, "end_date": past}, now, "event") == "completed"
    future = (now + timedelta(hours=2)).isoformat()
    assert _next_status({"status": "scheduled", "start_date": started, "end_date": future}, now, "f1") == "live"


# ------------------------------------------------------------------ Fremde Strecke, Export

@pytest.mark.asyncio
async def test_a_track_of_another_challenge_is_not_answered(flow):
    cid, _tid, _driver, _lead, _helper = await setup(flow)
    other_cid, other_tid = new_id(), new_id()
    await flow.db.f1_challenges.insert_one({"id": other_cid, "slug": "geheim", "title": "Entwurf", "status": "draft", "visibility": "public"})
    await flow.db.f1_tracks.insert_one({"id": other_tid, "challenge_id": other_cid, "name": "Geheime Strecke", "image_url": "/x.png"})
    flow.act_as(None)
    board = await flow.get(f"/api/f1/challenges/{cid}/leaderboard?track_id={other_tid}")
    assert board.status_code == 404
    assert "Geheime Strecke" not in board.text
    widget = await flow.get(f"/api/widgets/f1/{cid}/leaderboard?track_id={other_tid}")
    assert widget.status_code == 404
    assert "Geheime Strecke" not in widget.text


@pytest.mark.asyncio
async def test_the_export_writes_names_as_text(flow):
    cid, tid, _driver, _lead, _helper = await setup(flow)
    tricky = await flow.add_user(name="=HYPERLINK(1)")
    response = await enter(flow, cid, tid, tricky)
    assert response.status_code == 200
    csv_text = (await flow.get(f"/api/f1/challenges/{cid}/export.csv")).text
    assert ";'=HYPERLINK(1);" in csv_text
    assert ";=HYPERLINK" not in csv_text


@pytest.mark.asyncio
async def test_track_limits_must_fit_together(flow):
    cid, tid, _driver, _lead, _helper = await setup(flow)
    refused = await flow.patch(f"/api/f1/tracks/{tid}", json={"min_plausible_ms": 120000, "max_plausible_ms": 30000})
    assert refused.status_code == 400, refused.text
    await flow.patch(f"/api/f1/tracks/{tid}", json={"max_plausible_ms": 60000})
    response = await flow.patch(f"/api/f1/tracks/{tid}", json={"min_plausible_ms": 90000})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_after_publishing_a_track_with_times_cannot_be_deleted(flow):
    cid, tid, driver, _lead, _helper = await setup(flow)
    response = await enter(flow, cid, tid, driver)
    assert response.status_code == 200
    await publish(flow, cid)
    refused = await flow.delete(f"/api/f1/tracks/{tid}")
    assert refused.status_code == 409, refused.text
    assert await flow.db.f1_lap_times.count_documents({"track_id": tid}) == 1


@pytest.mark.asyncio
async def test_taking_back_the_publication_is_logged(flow):
    cid, _tid, _driver, lead, _helper = await setup(flow, status="live")
    await publish(flow, cid)
    response = await flow.patch(f"/api/f1/challenges/{cid}", json={"status": "live"})
    assert response.status_code == 200
    rows = await audit(flow, "fastlap.challenge.unpublish")
    assert [(r["actor_id"], r["target_id"], r["data"]["from"], r["data"]["to"]) for r in rows] == [(lead["id"], cid, "results_published", "live")]
