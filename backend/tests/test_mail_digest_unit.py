"""Sammel-Mail (#1662): die Regeln ohne Datenbank - Rhythmus, Zeitraum, was in die Sammlung darf."""
from datetime import datetime, timezone

import pytest

from services import mail_digest
from services.notification_preferences import REQUIRED_EMAIL_TEMPLATES


def _utc(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


CFG = mail_digest.normalized_settings({})


def test_the_defaults_change_nothing_until_someone_decides():
    assert CFG == {"default_rhythm": "instant", "daily_time": "07:00", "weekly_weekday": 0, "weekly_time": "07:00"}


def test_bad_settings_fall_back_to_the_defaults():
    cfg = mail_digest.normalized_settings({"default_rhythm": "hourly", "daily_time": "25:00", "weekly_weekday": 9, "weekly_time": "x"})
    assert cfg == CFG


def test_the_own_rhythm_wins_over_the_default():
    cfg = mail_digest.normalized_settings({"default_rhythm": "daily"})
    assert mail_digest.rhythm_of({}, cfg) == "daily"
    assert mail_digest.rhythm_of({"mail_digest": "weekly"}, cfg) == "weekly"
    assert mail_digest.rhythm_of({"mail_digest": "instant"}, cfg) == "instant"
    assert mail_digest.rhythm_of({"mail_digest": "kaputt"}, cfg) == "daily"


def test_urgent_and_required_mails_never_wait():
    for key in ("match_lead_10m", "checkin_closes_soon", "checkin_closes_soon_on_site", "match_reminder", "score_reported", "dispute_opened"):
        assert not mail_digest.collectable(key), key
    for key in REQUIRED_EMAIL_TEMPLATES:
        assert not mail_digest.collectable(key), key
    # Schon selbst ein Gruß bzw. eine Zusammenfassung - nie in eine zweite.
    assert not mail_digest.collectable("birthday_greeting") and not mail_digest.collectable("achievement_recap")
    assert not mail_digest.collectable(mail_digest.DIGEST_TEMPLATE)
    # Eine Mail darf sich selbst als dringend ausweisen.
    assert not mail_digest.collectable("league_notice", importance="urgent")


def test_ordinary_updates_go_into_the_collection():
    for key in ("registration_approved", "tournament_finished", "league_notice", "prize_ready", "invoice_ready", "direct_message", "event_message"):
        assert mail_digest.collectable(key), key


@pytest.mark.parametrize("now,expected", [
    # Wien im Winter: 07:00 MEZ = 06:00 UTC.
    ("2026-11-26T06:00:00", "2026-11-26T06:00:00+00:00"),
    ("2026-11-26T05:59:00", "2026-11-25T06:00:00+00:00"),
    ("2026-11-26T23:30:00", "2026-11-26T06:00:00+00:00"),
    # Sommerzeit: 07:00 MESZ = 05:00 UTC.
    ("2026-07-01T05:00:00", "2026-07-01T05:00:00+00:00"),
])
def test_the_daily_slot_is_the_last_one_that_has_begun(now, expected):
    assert mail_digest.last_slot("daily", CFG, _utc(now)).isoformat() == expected


def test_the_weekly_slot_is_the_last_monday_morning():
    # Donnerstag, 26.11.2026 → Montag, 23.11.2026 07:00 Wien.
    assert mail_digest.last_slot("weekly", CFG, _utc("2026-11-26T12:00:00")).isoformat() == "2026-11-23T06:00:00+00:00"
    # Montag vor 07:00 → der Montag davor.
    assert mail_digest.last_slot("weekly", CFG, _utc("2026-11-23T05:00:00")).isoformat() == "2026-11-16T06:00:00+00:00"
    sunday_evening = mail_digest.normalized_settings({"weekly_weekday": 6, "weekly_time": "18:30"})
    assert mail_digest.last_slot("weekly", sunday_evening, _utc("2026-11-26T12:00:00")).isoformat() == "2026-11-22T17:30:00+00:00"


def test_the_period_key_names_the_slot():
    assert mail_digest.period_key("daily", _utc("2026-11-26T06:00:00")) == "daily:2026-11-26"
    assert mail_digest.period_key("weekly", _utc("2026-11-23T06:00:00")) == "weekly:2026-11-23"


def test_the_schedule_text_for_the_settings():
    assert mail_digest.schedule_text("daily", CFG) == "Täglich um 07:00 Uhr"
    assert mail_digest.schedule_text("weekly", CFG) == "Montags um 07:00 Uhr"
    assert mail_digest.schedule_text("instant", CFG) == "Jede Mail sofort"


def test_the_preview_line_uses_the_first_text_value_and_is_short():
    assert mail_digest.preview_line({"text": "Du bist neu im Kader.", "url": "https://x"}) == "Du bist neu im Kader."
    assert mail_digest.preview_line({"summary": "  Neon   Kings gewinnt 2:1. "}) == "Neon Kings gewinnt 2:1."
    long = mail_digest.preview_line({"message": "a" * 400})
    assert len(long) <= 200 and long.endswith("…")
    assert mail_digest.preview_line({"url": "https://x"}) == ""


def test_cancellations_are_urgent_and_never_collected():
    """Fabian 26.11. (A): Absagen gelten als dringend."""
    for key in ("tournament_cancelled", "event_cancelled"):
        assert not mail_digest.collectable(key), key
