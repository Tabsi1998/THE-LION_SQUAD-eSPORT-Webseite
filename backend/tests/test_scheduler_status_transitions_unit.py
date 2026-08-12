import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import routes.tournament_routes as tournament_routes
from services.scheduler import _next_status, _prepare_tournament_transition


def test_tournament_does_not_auto_start_without_explicit_flag():
    now = datetime.now(timezone.utc)
    doc = {
        "status": "check_in",
        "start_date": (now - timedelta(minutes=5)).isoformat(),
        "auto_start_enabled": False,
    }

    assert _next_status(doc, now, "tournament") is None


def test_tournament_can_auto_start_when_enabled():
    now = datetime.now(timezone.utc)
    doc = {
        "status": "check_in",
        "start_date": (now - timedelta(minutes=5)).isoformat(),
        "auto_start_enabled": True,
    }

    assert _next_status(doc, now, "tournament") == "live"


def test_events_keep_time_based_live_transition():
    now = datetime.now(timezone.utc)
    doc = {
        "status": "scheduled",
        "start_date": (now - timedelta(minutes=5)).isoformat(),
    }

    assert _next_status(doc, now, "event") == "live"


def test_automatic_live_transition_stays_blocked_without_playable_match(monkeypatch):
    async def finalize(db, tournament, actor_id):
        return None

    async def collect(db, tournament_id):
        return [], {"id": tournament_id, "min_participants": 2, "event_mode": "online"}

    monkeypatch.setattr(tournament_routes, "_finalize_bracket_for_checkin", finalize)
    monkeypatch.setattr(tournament_routes, "_collect_plan_matches", collect)
    db = SimpleNamespace(
        tournament_registrations=SimpleNamespace(
            count_documents=lambda query: asyncio.sleep(0, result=2),
        ),
    )

    allowed = asyncio.run(_prepare_tournament_transition(
        db,
        {"id": "t1", "status": "check_in", "min_participants": 2},
        "live",
    ))

    assert allowed is False
