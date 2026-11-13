"""Turnierpause und Spielzeit-Uhr (#1167) durch die echten Routen.

- ``POST /api/tournaments/{tid}/status`` mit ``paused``: das Turnier merkt sich ``paused_at``; Leitung, Warteschlange und
  Baum geben es an jedes laufende Spiel weiter - die Uhr steht.
- Weiterspielen (``live``): die Pausendauer kommt auf ``paused_seconds`` jedes Spiels, das in der Pause lief, und
  ``paused_at`` fällt weg; eine zweite Pause summiert sich. „läuft N Min.“ und „Ergebnis fehlt“ zählen die Pause nicht.
- ``PUT …/pause`` („Pause bis“) setzt ``paused_at`` nach, wenn es fehlt (Pause von vor #1167).
"""

import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from test_live_queue_flow import first_round, on_site, queue  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def set_status(flow, tournament, status, **body):
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": status, **body})
    assert response.status_code == 200, response.text
    return response


async def backdate_pause(flow, tournament, minutes):
    """Die Pause läuft schon so lange - wie nach echten Minuten Wartezeit."""
    since = (now_utc() - timedelta(minutes=minutes)).isoformat()
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"paused_at": since}})
    return since


async def running_match(flow, tournament, minutes_ago):
    match = (await first_round(flow, tournament))[0]
    await flow.db.matches_v2.update_one(
        {"id": match["id"]},
        {"$set": {"status": "in_progress", "started_at": (now_utc() - timedelta(minutes=minutes_ago)).isoformat()}},
    )
    return match


async def lead_item(flow, tournament, match_id):
    lead = (await flow.get(f"/api/tournaments/{tournament['id']}/lead")).json()
    return lead, next(item for item in lead["matches"] if item["id"] == match_id)


@pytest.mark.asyncio
async def test_a_five_minute_pause_stops_the_clock_and_resuming_leaves_it_out(flow):
    _staff, tournament, _stations, _players = await on_site(flow)
    match = await running_match(flow, tournament, minutes_ago=20)

    await set_status(flow, tournament, "paused")
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert stored["status"] == "paused" and stored["paused_at"]
    since = await backdate_pause(flow, tournament, minutes=5)

    # Während der Pause: jede Antwort sagt der Uhr, seit wann sie steht - und „läuft“ zählt die Pause nicht.
    lead, item = await lead_item(flow, tournament, match["id"])
    assert lead["tournament"]["paused_at"] == since
    assert item["paused_at"] == since and item["paused_seconds"] == 0
    assert item["timing"]["running_minutes"] == 15
    bracket = (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).json()
    in_tree = next(row for row in bracket["matches_v2"] if row["id"] == match["id"])
    assert in_tree["paused_at"] == since and in_tree["paused_seconds"] == 0
    # Nicht gestartete Spiele tragen keine Pause.
    assert all("paused_at" not in row for row in bracket["matches_v2"] if not row.get("started_at"))

    await set_status(flow, tournament, "live")
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert "paused_at" not in stored
    seconds = (await flow.reload(match)).get("paused_seconds")
    assert 299 <= seconds <= 330, seconds
    _lead, item = await lead_item(flow, tournament, match["id"])
    assert item["paused_at"] is None and item["paused_seconds"] == seconds
    assert item["timing"]["running_minutes"] == 15

    # Eine zweite Pause (3 Minuten) summiert sich dazu.
    await set_status(flow, tournament, "paused")
    await backdate_pause(flow, tournament, minutes=3)
    await set_status(flow, tournament, "live")
    total = (await flow.reload(match)).get("paused_seconds")
    assert seconds + 179 <= total <= seconds + 210, (seconds, total)


@pytest.mark.asyncio
async def test_the_station_queue_hands_the_pause_to_the_running_match(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    match = (await first_round(flow, tournament))[0]
    started = await flow.post(
        f"/api/tournaments/{tournament['id']}/live-queue/start",
        json={"station_id": stations[0]["id"], "match_id": match["id"]},
    )
    assert started.status_code == 200, started.text
    await set_status(flow, tournament, "paused")
    since = (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0}))["paused_at"]
    flow.act_as(None)
    view = await queue(flow, tournament)
    running = next(row["running"] for row in view["stations"] if row["running"])
    assert running["match_id"] == match["id"]
    assert running["paused_at"] == since and running["paused_seconds"] == 0
    assert all(row["next"]["paused_at"] is None for row in view["stations"] if row.get("next"))


@pytest.mark.asyncio
async def test_a_match_started_during_the_pause_only_loses_the_time_since_its_start(flow):
    _staff, tournament, _stations, _players = await on_site(flow)
    await set_status(flow, tournament, "paused")
    await backdate_pause(flow, tournament, minutes=10)
    match = await running_match(flow, tournament, minutes_ago=2)
    await set_status(flow, tournament, "live")
    seconds = (await flow.reload(match)).get("paused_seconds")
    assert 119 <= seconds <= 150, seconds


@pytest.mark.asyncio
async def test_pause_until_fills_in_a_missing_pause_start(flow):
    _staff, tournament, _stations, _players = await on_site(flow)
    await set_status(flow, tournament, "paused")
    # Eine Pause von vor #1167: ohne ``paused_at``.
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$unset": {"paused_at": ""}})
    response = await flow.put(f"/api/tournaments/{tournament['id']}/pause", json={"paused_until": None})
    assert response.status_code == 200, response.text
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert stored["paused_at"] and stored["status"] == "paused"


@pytest.mark.asyncio
async def test_resuming_without_a_pause_start_changes_no_match(flow):
    """Ohne ``paused_at`` (alte Pause) bleibt jedes Spiel, wie es ist - keine Migration nötig."""
    _staff, tournament, _stations, _players = await on_site(flow)
    match = await running_match(flow, tournament, minutes_ago=5)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "paused"}, "$unset": {"paused_at": ""}})
    await set_status(flow, tournament, "live")
    assert "paused_seconds" not in await flow.reload(match)


@pytest.mark.asyncio
async def test_a_pairing_reset_and_a_new_start_count_from_zero_without_the_old_pause(flow):
    """Pause, Paarungs-Reset (_pairing_reset_fields), Neustart an der Station: die Uhr zählt ab 0 - ohne Abzug."""
    from services.match_v2_results import _pairing_reset_fields

    _staff, tournament, stations, _players = await on_site(flow)
    match = (await first_round(flow, tournament))[0]
    path = f"/api/tournaments/{tournament['id']}/live-queue/start"
    started = await flow.post(path, json={"station_id": stations[0]["id"], "match_id": match["id"]})
    assert started.status_code == 200, started.text
    earlier = (now_utc() - timedelta(minutes=20)).isoformat()
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"started_at": earlier}})
    await set_status(flow, tournament, "paused")
    await backdate_pause(flow, tournament, minutes=5)
    await set_status(flow, tournament, "live")
    assert (await flow.reload(match)).get("paused_seconds", 0) >= 299

    # Die Paarung ändert sich: alles vom alten Start fällt weg; die Station wird frei.
    reset = _pairing_reset_fields(await flow.reload(match), now_utc().isoformat())
    assert reset["paused_seconds"] == 0 and reset["started_at"] is None
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {**reset, "status": "ready"}})
    await flow.db.stations.update_one({"id": stations[0]["id"]}, {"$set": {"current_match_id": None, "status": "free"}})

    # Neustart - und eine stehen gebliebene Pause würde die Uhr ins Minus ziehen.
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"paused_seconds": 300}})
    again = await flow.post(path, json={"station_id": stations[0]["id"], "match_id": match["id"]})
    assert again.status_code == 200, again.text
    stored = await flow.reload(match)
    assert stored["started_at"] and stored["paused_seconds"] == 0
    _lead, item = await lead_item(flow, tournament, match["id"])
    assert item["paused_seconds"] == 0 and item["timing"]["running_minutes"] == 0


@pytest.mark.asyncio
async def test_settling_the_same_pause_twice_counts_it_once(flow):
    """Bricht „Weiterspielen“ nach der Abrechnung ab und wird wiederholt, zählt die Pause nicht doppelt."""
    from services.match_pause import settle_pause

    _staff, tournament, _stations, _players = await on_site(flow)
    match = await running_match(flow, tournament, minutes_ago=20)
    await set_status(flow, tournament, "paused")
    await backdate_pause(flow, tournament, minutes=5)
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert await settle_pause(flow.db, stored) == 1
    assert await settle_pause(flow.db, stored) == 0
    seconds = (await flow.reload(match))["paused_seconds"]
    assert 299 <= seconds <= 330, seconds
    # Das Weiterspielen über die Route rechnet dieselbe Pause nicht noch einmal ab.
    await set_status(flow, tournament, "live")
    assert (await flow.reload(match))["paused_seconds"] == seconds, "dieselbe Pause nicht noch einmal"


@pytest.mark.asyncio
async def test_a_result_during_the_pause_that_is_taken_back_leaves_the_pause_out(flow):
    """Ergebnis in der Pause, dann Rückgängig: das Spiel bekommt die Pause trotzdem abgerechnet."""
    _staff, tournament, _stations, _players = await on_site(flow, count=8)
    match = await running_match(flow, tournament, minutes_ago=20)
    other = (await first_round(flow, tournament))[1]
    await flow.db.matches_v2.update_one(
        {"id": other["id"]},
        {"$set": {"status": "completed", "started_at": (now_utc() - timedelta(minutes=30)).isoformat(),
                  "completed_at": (now_utc() - timedelta(minutes=10)).isoformat()}},
    )
    await set_status(flow, tournament, "paused")
    since = await backdate_pause(flow, tournament, minutes=5)
    # In der Pause bekommt das Spiel ein Ergebnis.
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"status": "completed", "completed_at": now_utc().isoformat()}})
    await set_status(flow, tournament, "live")
    seconds = (await flow.reload(match)).get("paused_seconds", 0)
    assert 299 <= seconds <= 330, seconds
    assert (await flow.reload(match))["pause_settled_for"] == since
    # Vor der Pause entschieden: bleibt unberührt.
    assert "paused_seconds" not in await flow.reload(other)
