from datetime import datetime, timedelta, timezone

from services.scheduler import _next_status


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
