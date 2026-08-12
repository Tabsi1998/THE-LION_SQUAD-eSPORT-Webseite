"""Regression tests for Package 4 tournament start and station safety."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

import routes.tournament_routes as tournament_routes
from routes.station_routes import (
    _assign_match_to_station,
    _match_has_minimum_participants,
)
from services.match_reminder import _uses_actual_start_notifications


def _legacy_match(**updates):
    return {
        "id": "m1",
        "status": "ready",
        "participant_a_id": "r1",
        "participant_b_id": "r2",
        **updates,
    }


def test_start_report_requires_configured_minimum_participants():
    report = tournament_routes._planning_report(
        [_legacy_match()],
        {"event_mode": "online", "min_participants": 4},
        participant_count=3,
        require_fixed_bracket=True,
    )

    assert report["ready_match_count"] == 1
    assert report["ok"] is False
    assert report["errors"][0]["type"] == "insufficient_participants"
    assert tournament_routes._live_start_blocker(report, force=False)["force_allowed"] is True
    assert tournament_routes._live_start_blocker(report, force=True) is None


def test_live_start_never_allows_only_preview_or_unfilled_matches():
    report = tournament_routes._planning_report(
        [
            _legacy_match(status="preview", is_preview=True),
            {"id": "future", "status": "pending", "participant_a_id": None, "participant_b_id": None},
        ],
        {"event_mode": "online", "min_participants": 2},
        participant_count=2,
        require_fixed_bracket=True,
    )

    blocker = tournament_routes._live_start_blocker(report, force=True)
    assert blocker["force_allowed"] is False
    assert any(error["type"] == "no_playable_matches" for error in report["errors"])
    assert report["checked_matches"] == 1


def test_planning_ignores_future_empty_matches_in_missing_station_noise():
    report = tournament_routes._planning_report(
        [{"id": "future", "status": "pending", "participant_a_id": None, "participant_b_id": None}],
        {"event_mode": "online"},
    )

    assert report["checked_matches"] == 0
    assert report["warning_count"] == 0


def test_station_start_requires_match_minimum_players():
    incomplete = {
        "id": "ffa-1",
        "tournament_id": "t1",
        "status": "ready",
        "settings": {"min_players": 3},
        "slots": [{"registration_id": "r1"}, {"registration_id": "r2"}, {"registration_id": None}],
    }
    assert _match_has_minimum_participants(incomplete) is False

    with pytest.raises(HTTPException, match="zu wenige Teilnehmer") as error:
        asyncio.run(_assign_match_to_station(
            None,
            {"id": "s1", "status": "free", "tournament_id": "t1"},
            incomplete,
            "matches_v2",
            start_now=True,
        ))
    assert error.value.status_code == 409


def test_local_staff_schedule_notifies_only_on_actual_station_start():
    assert _uses_actual_start_notifications({
        "event_mode": "local",
        "schedule_mode": "fixed_by_staff",
    }) is True
    assert _uses_actual_start_notifications({
        "event_mode": "online",
        "schedule_mode": "fixed_by_staff",
    }) is False
    assert _uses_actual_start_notifications({
        "location": "Vereinsheim",
        "stream_link": None,
    }) is True


def test_manual_live_start_does_not_change_status_before_hard_preflight(monkeypatch):
    tournaments = SimpleNamespace(
        find_one=AsyncMock(return_value={
            "id": "t1",
            "status": "check_in",
            "min_participants": 2,
            "event_mode": "online",
        }),
        update_one=AsyncMock(),
    )
    registrations = SimpleNamespace(count_documents=AsyncMock(return_value=2))
    db = SimpleNamespace(tournaments=tournaments, tournament_registrations=registrations)

    async def resolve(tournament_id):
        return tournament_id

    async def unlocked(db_arg, tournament_id):
        return {"id": tournament_id}

    async def permitted(user, tournament_id, roles, scope):
        return None

    async def finalize(db_arg, tournament, actor_id):
        return {"ok": True, "engine": "test"}

    async def collect(db_arg, tournament_id):
        return [], {"id": tournament_id, "min_participants": 2, "event_mode": "online"}

    monkeypatch.setattr(tournament_routes, "get_db", lambda: db)
    monkeypatch.setattr(tournament_routes, "_resolve_tid", resolve)
    monkeypatch.setattr(tournament_routes, "_ensure_tournament_unlocked", unlocked)
    monkeypatch.setattr(tournament_routes, "require_tournament_staff_permission", permitted)
    monkeypatch.setattr(tournament_routes, "_finalize_bracket_for_checkin", finalize)
    monkeypatch.setattr(tournament_routes, "_collect_plan_matches", collect)

    with pytest.raises(HTTPException) as error:
        asyncio.run(tournament_routes.set_status(
            "t1",
            {"status": "live", "force": True},
            {"id": "admin", "role": "tournament_admin"},
        ))

    assert error.value.status_code == 409
    assert error.value.detail["force_allowed"] is False
    tournaments.update_one.assert_not_awaited()
