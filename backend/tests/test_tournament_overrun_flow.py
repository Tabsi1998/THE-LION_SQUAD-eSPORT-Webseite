"""Turnier nach dem Ende noch „Live“ (#2194): länger laufende Turniere zeigen weiter „Läuft“, fertige melden sich bei der
Leitung - umgestellt wird nie automatisch. Erfundene Namen."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services import tournament_overrun  # noqa: E402
from services.public_phase import derive_public_phase  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def cup(flow, *, status: str = "live", match_status: str = "scheduled", ended_hours: float = 2) -> dict:
    tournament = await flow.create_tournament(
        title="Herbst-Cup", status=status, start_date=(now_utc() - timedelta(hours=6)).isoformat(),
        end_date=(now_utc() - timedelta(hours=ended_hours)).isoformat())
    await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": tournament["id"], "status": match_status,
                                         "slots": [], "round": 1})
    return tournament


async def stored(flow, tournament: dict) -> dict:
    return await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})


def test_phase_without_the_flag_is_completed_after_the_end():
    end = now_utc() - timedelta(hours=1)
    doc = {"status": "live", "start_date": (end - timedelta(hours=3)).isoformat(), "end_date": end.isoformat()}
    assert derive_public_phase(doc, "tournament")["state"] == "completed"
    running = derive_public_phase({**doc, "running_past_end": True}, "tournament")
    assert running["state"] == "live" and running["label"] == "Läuft" and running["countdown_kind"] is None
    # Nur mit Stand „live“: ein pausiertes oder fertiges Turnier bleibt, wie es ist.
    assert derive_public_phase({**doc, "status": "paused", "running_past_end": True}, "tournament")["state"] == "paused"
    assert derive_public_phase({**doc, "status": "registration_closed", "running_past_end": True}, "tournament")["state"] == "completed"


@pytest.mark.asyncio
async def test_open_matches_keep_it_running_and_the_lead_sees_it(flow):
    tournament = await cup(flow)
    counts = await tournament_overrun.refresh(flow.db)
    assert counts["set"] == 1
    doc = await stored(flow, tournament)
    assert doc["running_past_end"] is True and derive_public_phase(doc, "tournament")["state"] == "live"
    assert (await tournament_overrun.refresh(flow.db))["set"] == 0, "nur Änderungen werden geschrieben"

    flow.act_as(await flow.add_staff())
    duty = (await flow.get("/api/users/me/duty")).json()
    row = next(row for row in duty["ended_live"] if row["id"] == tournament["id"])
    assert row["open_matches"] == 1 and row["admin_url"] == f"/admin/tournaments/{tournament['id']}"
    flow.act_as(await flow.add_user(name="Spielerin"))
    assert (await flow.get("/api/users/me/duty")).json()["ended_live"] == []


@pytest.mark.asyncio
async def test_all_done_shows_completed_but_never_switches_the_status(flow):
    tournament = await cup(flow)
    await tournament_overrun.refresh(flow.db)
    await flow.db.matches_v2.update_many({"tournament_id": tournament["id"]}, {"$set": {"status": "completed"}})
    counts = await tournament_overrun.refresh(flow.db)
    assert counts["cleared"] == 1
    doc = await stored(flow, tournament)
    assert "running_past_end" not in doc and doc["status"] == "live"
    assert derive_public_phase(doc, "tournament")["state"] == "completed"
    flow.act_as(await flow.add_staff())
    row = next(row for row in (await flow.get("/api/users/me/duty")).json()["ended_live"] if row["id"] == tournament["id"])
    assert row["open_matches"] == 0


@pytest.mark.asyncio
async def test_not_live_or_not_ended_is_left_alone(flow):
    paused = await cup(flow, status="paused")
    running = await cup(flow, ended_hours=-3)
    await tournament_overrun.refresh(flow.db)
    assert "running_past_end" not in await stored(flow, paused)
    assert "running_past_end" not in await stored(flow, running)
    await flow.db.tournaments.update_one({"id": paused["id"]}, {"$set": {"running_past_end": True}})
    assert (await tournament_overrun.refresh(flow.db))["cleared"] == 1


@pytest.mark.asyncio
async def test_the_deadline_job_keeps_the_flag(flow):
    from services import match_deadline_sweep

    tournament = await cup(flow)
    result = await match_deadline_sweep.sweep(flow.db)
    assert result["overrun"]["set"] == 1
    assert (await stored(flow, tournament))["running_past_end"] is True


# ---------------------------------------------------------------- Codex-Prüfung (#2194)

@pytest.mark.asyncio
async def test_a_completion_during_the_check_does_not_leave_a_stale_flag(flow, monkeypatch):
    """Der Lauf sieht noch ein offenes Spiel, währenddessen endet das letzte - am Ende darf das Merkmal nicht stehen bleiben."""
    from services import v2_result_submission

    tournament = await cup(flow)
    match = await flow.db.matches_v2.find_one({"tournament_id": tournament["id"]}, {"_id": 0})
    real = tournament_overrun._has_open
    calls = {"n": 0}

    async def overlapping(db, tournament_id):
        calls["n"] += 1
        if calls["n"] == 1:
            seen = await real(db, tournament_id)
            await db.matches_v2.update_one({"id": match["id"]}, {"$set": {"status": "completed"}})
            await v2_result_submission._finish_result_side_effects(db, {**match, "status": "completed"}, False)
            return seen
        return await real(db, tournament_id)

    monkeypatch.setattr(tournament_overrun, "_has_open", overlapping)
    await tournament_overrun.refresh(flow.db)
    assert "running_past_end" not in await stored(flow, tournament)


@pytest.mark.asyncio
async def test_the_last_result_and_the_status_change_clear_the_flag_at_once(flow):
    from services import v2_result_submission

    tournament = await cup(flow)
    await tournament_overrun.refresh(flow.db)
    match = await flow.db.matches_v2.find_one({"tournament_id": tournament["id"]}, {"_id": 0})
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"status": "completed"}})
    await v2_result_submission._finish_result_side_effects(flow.db, {**match, "status": "completed"}, False)
    assert "running_past_end" not in await stored(flow, tournament), "ohne auf den nächsten Lauf zu warten"

    other = await cup(flow)
    await tournament_overrun.refresh(flow.db)
    flow.act_as(await flow.add_staff())
    answer = await flow.post(f"/api/tournaments/{other['id']}/status", json={"status": "completed"})
    assert answer.status_code == 200, answer.text
    assert "running_past_end" not in await stored(flow, other)
