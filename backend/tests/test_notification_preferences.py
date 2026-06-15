import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.notification_preferences import (
    email_allowed,
    notification_allowed,
    normalized_preferences,
    push_allowed,
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


def test_user_can_disable_email_channel_without_blocking_required_mail():
    user = {"notification_preferences": {"email": False, "match_reminders": True}}
    assert email_allowed(user, "match_lead_10m") is False
    assert email_allowed(user, "password_reset") is True


def test_push_and_in_app_channels_are_independent():
    user = {"notification_preferences": {"push": False, "in_app": True, "match_reminders": True}}
    assert push_allowed(user, "match_reminder") is False
    assert notification_allowed(user, "match_reminder") is True
    user["notification_preferences"]["push"] = True
    user["notification_preferences"]["in_app"] = False
    assert push_allowed(user, "match_reminder") is True
    assert notification_allowed(user, "match_reminder") is False


def test_each_topic_can_be_disabled_per_channel():
    user = {
        "newsletter_consent": True,
        "notification_preferences": {
            "email": True,
            "push": True,
            "in_app": True,
            "email:match_reminders": False,
            "push:match_reminders": True,
            "in_app:match_reminders": False,
            "email:news_events": False,
            "push:news_events": True,
            "in_app:news_events": True,
        },
    }
    assert email_allowed(user, "match_lead_30m") is False
    assert push_allowed(user, "match_reminder") is True
    assert notification_allowed(user, "match_reminder") is False
    assert email_allowed(user, "newsletter_news", "news_events") is False
    assert push_allowed(user, "news_mention", "news_events") is True
    assert notification_allowed(user, "news_mention", "news_events") is True


def test_news_email_requires_newsletter_even_if_topic_enabled():
    user = {
        "newsletter_consent": False,
        "notification_preferences": {"email:news_events": True, "push:news_events": True},
    }
    assert email_allowed(user, "newsletter_news", "news_events") is False
    assert push_allowed(user, "news_mention", "news_events") is True


def test_in_app_notifications_use_the_same_profile_preferences():
    user = {"notification_preferences": {"match_reminders": False, "tournament_updates": False}}
    assert notification_allowed(user, "match_reminder") is False
    assert notification_allowed(user, "match_station") is False
    assert notification_allowed(user, "tournament_checkin") is False
    assert notification_allowed(user, "match_chat_message") is True
    assert notification_allowed(user, "match_chat_mention") is True
    assert notification_allowed(user, "direct_message") is True


def test_direct_message_notifications_follow_community_preferences():
    user = {"notification_preferences": {"community_messages": False}}
    assert notification_allowed(user, "direct_message") is False
    assert notification_allowed(user, "team_chat_message") is False
    assert notification_allowed(user, "match_chat_message") is False
    assert notification_allowed(user, "match_chat_mention") is False


def test_public_preferences_payload_contains_channels():
    payload = public_preferences_payload({"newsletter_consent": True})
    assert payload["preferences"]["news_events"] is True
    channel_keys = {channel["key"] for channel in payload["channels"]}
    category_keys = {category["key"] for category in payload["categories"]}
    assert {"email", "push", "in_app"}.issubset(channel_keys)
    assert {"match_reminders", "news_events", "membership_updates", "birthday_greetings"}.issubset(category_keys)
    assert "email:match_reminders" in payload["preferences"]
    assert "push:community_messages" in payload["preferences"]
