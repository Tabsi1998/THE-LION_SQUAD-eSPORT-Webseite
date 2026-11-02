"""Einspruchsfenster nach einer Pause (#2201, D-3). Erfundene Namen.

Eine Meldung, die nach der Frist gilt, lässt den Einspruch bis zum Ende der Spielwoche offen. Das Fenster las das Turnier
ohne Sperrwochen: Ein Spieltag nach der Winterpause endete dadurch Wochen zu früh.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services.match_disputes import dispute_window  # noqa: E402
from services.matchday_schedule import tournament_matchday_window  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def decided_match(flow, tournament: dict, matchday: int, decided) -> dict:
    match = {"id": new_id(), "tournament_id": tournament["id"], "stage_id": new_id(), "match_type": "duel", "status": "completed",
             "round": matchday, "matchday_number": matchday, "completed_at": decided.isoformat(),
             "result_meta": {"auto_confirmed": True},
             "results": [{"registration_id": "a", "rank": 1, "score": 2}, {"registration_id": "b", "rank": 2, "score": 0}],
             "slots": [{"slot": 1, "registration_id": "a"}, {"slot": 2, "registration_id": "b"}]}
    await flow.db.matches_v2.insert_one(dict(match))
    return match


@pytest.mark.asyncio
async def test_matchday_after_the_winter_break_keeps_its_week(flow):
    start = now_utc() - timedelta(weeks=8)
    tournament = await flow.create_tournament(
        format="league", event_mode="online", status="live", start_date=start.isoformat(), matchday_days=7,
        matchday_blocked_weeks=[3, 4], blocked_periods=[], league_context={"league_id": "l", "season_id": "s", "division_id": "d", "staffel": "A"})
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    # Spieltag 5 liegt mit zwei Sperrwochen in Kalenderwoche 7.
    week = tournament_matchday_window(stored, 5)
    decided = week.start + timedelta(days=1)
    match = await decided_match(flow, tournament, 5, decided)
    moment = decided + timedelta(hours=2)
    window = await dispute_window(flow.db, match, now=moment)
    assert window["open"] is True, "der Einspruch bleibt bis zum Ende der Spielwoche offen"
    assert window["until"] == week.end.isoformat()


@pytest.mark.asyncio
async def test_without_blocked_weeks_the_window_is_unchanged(flow):
    """Regression: Liga-Format ohne Sperrzeiten rechnet weiter Woche N, ein Pokal 30 Minuten."""
    start = now_utc() - timedelta(weeks=8)
    league = await flow.create_tournament(format="league", event_mode="online", status="live", start_date=start.isoformat())
    stored = await flow.db.tournaments.find_one({"id": league["id"]}, {"_id": 0})
    week = tournament_matchday_window(stored, 5)
    decided = week.start + timedelta(days=1)
    match = await decided_match(flow, league, 5, decided)
    window = await dispute_window(flow.db, match, now=decided + timedelta(hours=2))
    assert window["until"] == week.end.isoformat()

    cup = await flow.create_tournament(format="single_elim", event_mode="online", status="live", start_date=start.isoformat())
    decided = now_utc() - timedelta(minutes=5)
    match = await decided_match(flow, cup, 1, decided)
    window = await dispute_window(flow.db, match, now=decided + timedelta(minutes=1))
    assert window["until"] == (decided + timedelta(minutes=30)).isoformat()
