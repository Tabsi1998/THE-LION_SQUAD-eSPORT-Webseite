from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.public_phase import derive_public_phase


def test_f1_without_online_registration_does_not_show_registration_open():
    phase = derive_public_phase(
        {
            "status": "registration_open",
            "registration_enabled": False,
            "start_date": "2030-06-20T10:00:00+00:00",
        },
        "f1",
        now=datetime(2030, 6, 1, tzinfo=timezone.utc),
    )

    assert phase["state"] == "announced"
    assert phase["label"] == "Angekündigt"
    assert phase["countdown_kind"] == "starts"


def test_f1_registration_enabled_without_window_is_still_announced():
    phase = derive_public_phase(
        {
            "status": "registration_open",
            "registration_enabled": True,
            "start_date": "2030-06-20T10:00:00+00:00",
        },
        "f1",
        now=datetime(2030, 6, 1, tzinfo=timezone.utc),
    )

    assert phase["state"] == "announced"
    assert phase["label"] == "Angekündigt"


def test_f1_legacy_registration_dates_without_online_flag_are_announced():
    phase = derive_public_phase(
        {
            "status": "registration_open",
            "registration_enabled": True,
            "registration_open_from": "2030-06-01T00:00:00+00:00",
            "registration_open_until": "2030-06-10T00:00:00+00:00",
            "start_date": "2030-06-20T10:00:00+00:00",
        },
        "f1",
        now=datetime(2030, 6, 5, tzinfo=timezone.utc),
    )

    assert phase["state"] == "announced"
    assert phase["label"] == "Angekündigt"


def test_f1_with_online_registration_keeps_registration_open():
    phase = derive_public_phase(
        {
            "status": "registration_open",
            "registration_enabled": True,
            "online_registration_enabled": True,
            "registration_open_from": "2030-06-01T00:00:00+00:00",
            "registration_open_until": "2030-06-10T00:00:00+00:00",
            "start_date": "2030-06-20T10:00:00+00:00",
        },
        "f1",
        now=datetime(2030, 6, 5, tzinfo=timezone.utc),
    )

    assert phase["state"] == "registration_open"
    assert phase["label"] == "Anmeldung offen"
    assert phase["countdown_kind"] == "registration_closes"


NOW = datetime(2030, 6, 10, 12, 0, tzinfo=timezone.utc)


def test_manual_live_without_dates_shows_running():
    phase = derive_public_phase({"status": "live"}, "f1", now=NOW)

    assert phase["state"] == "live"
    assert phase["label"] == "Läuft"
    assert phase["countdown_kind"] == "ends"


def test_manual_live_with_future_start_shows_running():
    phase = derive_public_phase({"status": "live", "start_date": "2030-06-20T10:00:00+00:00"}, "tournament", now=NOW)

    assert phase["state"] == "live"
    assert phase["label"] == "Läuft"


def test_manual_live_with_past_end_is_completed():
    phase = derive_public_phase(
        {"status": "live", "start_date": "2030-06-01T10:00:00+00:00", "end_date": "2030-06-02T10:00:00+00:00"},
        "event",
        now=NOW,
    )

    assert phase["state"] == "completed"


def test_paused_and_cancelled_are_not_overridden_by_live_logic():
    assert derive_public_phase({"status": "paused"}, "f1", now=NOW)["state"] == "paused"
    cancelled = derive_public_phase({"status": "cancelled", "start_date": "2030-06-01T10:00:00+00:00"}, "f1", now=NOW)
    assert cancelled["state"] == "cancelled"


def test_manual_live_event_keeps_day_break_between_days():
    event = {
        "status": "live",
        "start_date": "2030-06-09T08:00:00+00:00",
        "end_date": "2030-06-12T20:00:00+00:00",
        "days": [
            {"date": "2030-06-09", "start_at": "2030-06-09T08:00:00+00:00", "end_at": "2030-06-09T18:00:00+00:00"},
            {"date": "2030-06-11", "start_at": "2030-06-11T08:00:00+00:00", "end_at": "2030-06-11T18:00:00+00:00"},
        ],
    }
    phase = derive_public_phase(event, "event", now=NOW)

    assert phase["state"] == "day_break"
