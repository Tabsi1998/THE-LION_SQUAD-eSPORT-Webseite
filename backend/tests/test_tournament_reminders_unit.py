import pathlib
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.tournament_reminders import due_checkin_reminders


def test_due_checkin_reminders_cover_opening_and_closing_windows():
    tournament = {
        "id": "t1",
        "status": "registration_closed",
        "registration_enabled": True,
        "check_in_from": "2026-05-08T18:00:00+00:00",
        "check_in_until": "2026-05-08T18:30:00+00:00",
    }

    due_before_open = due_checkin_reminders(tournament, datetime(2026, 5, 8, 17, 50, tzinfo=timezone.utc))
    due_at_open = due_checkin_reminders(tournament, datetime(2026, 5, 8, 18, 0, tzinfo=timezone.utc))
    due_before_close = due_checkin_reminders(tournament, datetime(2026, 5, 8, 18, 20, tzinfo=timezone.utc))

    assert [spec.label for spec, _ in due_before_open] == ["opens_10m"]
    assert [spec.label for spec, _ in due_at_open] == ["open_now"]
    assert [spec.label for spec, _ in due_before_close] == ["closes_10m"]


def test_due_checkin_reminders_skip_drafts_and_invite_only():
    tournament = {
        "id": "t1",
        "status": "draft",
        "is_invite_only": False,
        "check_in_from": "2026-05-08T18:00:00+00:00",
    }
    assert due_checkin_reminders(tournament, datetime(2026, 5, 8, 17, 50, tzinfo=timezone.utc)) == []

    tournament["status"] = "registration_closed"
    tournament["is_invite_only"] = True
    assert due_checkin_reminders(tournament, datetime(2026, 5, 8, 17, 50, tzinfo=timezone.utc)) == []
