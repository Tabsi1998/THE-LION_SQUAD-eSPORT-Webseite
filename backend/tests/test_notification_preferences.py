import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.notification_preferences import (
    email_allowed,
    notification_allowed,
    normalized_preferences,
    public_preferences_payload,
)


def test_newsletter_requires_explicit_consent():
    user = {
        "newsletter_consent": False,
        "notification_preferences": {"news_events": True},
    }
    prefs = normalized_preferences(user)
    assert prefs["news_events"] is False
    assert email_allowed(user, "newsletter_news", "news_events") is False


def test_default_operational_mails_are_enabled():
    user = {"newsletter_consent": False, "notification_preferences": {}}
    prefs = normalized_preferences(user)
    assert prefs["match_reminders"] is True
    assert prefs["tournament_updates"] is True
    assert prefs["prize_updates"] is True
    assert prefs["birthday_greetings"] is True
    assert email_allowed(user, "match_lead_10m") is True
    assert email_allowed(user, "match_lead_5m") is True
    assert email_allowed(user, "checkin_closes_soon") is True
    assert email_allowed(user, "birthday_greeting") is True


def test_user_can_disable_optional_match_mails():
    user = {"notification_preferences": {"match_reminders": False}}
    assert email_allowed(user, "match_lead_30m") is False
    assert email_allowed(user, "password_reset") is True


def test_in_app_notifications_use_the_same_profile_preferences():
    user = {"notification_preferences": {"match_reminders": False, "tournament_updates": False}}
    assert notification_allowed(user, "match_reminder") is False
    assert notification_allowed(user, "match_station") is False
    assert notification_allowed(user, "tournament_checkin") is False
    assert notification_allowed(user, "direct_message") is True


def test_direct_message_notifications_are_required():
    user = {"notification_preferences": {"community_messages": False}}
    assert notification_allowed(user, "direct_message") is True
    assert notification_allowed(user, "team_chat_message") is False


def test_public_preferences_payload_contains_channels():
    payload = public_preferences_payload({"newsletter_consent": True})
    assert payload["preferences"]["news_events"] is True
    keys = {channel["key"] for channel in payload["channels"]}
    assert {"match_reminders", "news_events", "membership_updates", "birthday_greetings"}.issubset(keys)
