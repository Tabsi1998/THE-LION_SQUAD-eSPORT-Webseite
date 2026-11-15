"""Benachrichtigungen in drei Stufen (#1204, Fabians Wahl A): „Alles“, „Wichtiges“, „Wenig“ - darunter je Thema Push, nur in
der App oder aus. Die Stufen sind eine Sicht auf die bestehenden Schalter: bestehende Konten behalten ihre Schalter (ohne
Migration) und sehen „Eigene Auswahl“, wenn keine Stufe genau passt; neue Konten starten mit „Alles“."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.notification_preferences import (
    LEVEL_TOPICS,
    NOTIFICATION_KIND_CATEGORY,
    OPTIONAL_EMAIL_PREFERENCES,
    browser_allowed,
    discord_allowed,
    email_allowed,
    level_modes,
    level_preferences,
    mode_preferences,
    new_account_preferences,
    normalized_preferences,
    notification_allowed,
    notification_level,
    public_preferences_payload,
    push_allowed,
    topic_modes,
)


def _user(prefs, newsletter=False):
    return {"newsletter_consent": newsletter, "notification_preferences": dict(prefs)}


def test_every_level_sets_every_topic_of_the_list():
    for level in ("all", "important", "few"):
        prefs = level_preferences(level)
        user = _user(prefs)
        assert notification_level(user) == level
        assert set(topic_modes(user)) == set(LEVEL_TOPICS)
        assert set(topic_modes(user).values()) <= {"push", "app"}, "eine Stufe schaltet kein Thema ganz aus"


def test_the_levels_are_as_in_the_issue():
    assert set(level_modes("all").values()) == {"push"}
    important = {topic for topic, mode in level_modes("important").items() if mode == "push"}
    assert important == {"match_reminders", "tournament_updates", "billing_updates", "membership_updates",
                         "community_messages", "helper_shifts"}
    few = {topic for topic, mode in level_modes("few").items() if mode == "push"}
    assert few == {"match_reminders", "billing_updates"}
    assert level_modes("few")["achievements"] == "app" and level_modes("important")["news_events"] == "app"


def test_a_level_reaches_push_browser_and_the_bell():
    user = _user(level_preferences("few"))
    # Spiele & Aufrufe per Push: App, Browser und Glocke.
    assert push_allowed(user, "match_call") and browser_allowed(user, "match_call") and notification_allowed(user, "match_call")
    # Erfolge nur in der App: Glocke ja, Push und Browser nein.
    assert notification_allowed(user, "achievement")
    assert not push_allowed(user, "achievement") and not browser_allowed(user, "achievement")


def test_a_level_leaves_email_discord_and_the_main_switches_alone():
    prefs = {"email": False, "discord": True, "push": False, "email:match_reminders": False, "discord:achievements": False}
    prefs.update(level_preferences("all"))
    user = _user(prefs)
    assert normalized_preferences(user)["email"] is False and normalized_preferences(user)["push"] is False
    assert email_allowed(user, "match_lead_10m") is False
    assert discord_allowed(user, "achievement") is False and discord_allowed(user, "match_call") is True
    assert notification_level(user) == "all", "die Stufe hängt nur an den Themen"


def test_an_own_change_shows_custom_and_the_three_modes_are_exact():
    prefs = level_preferences("important")
    prefs.update(mode_preferences("achievements", "off"))
    user = _user(prefs)
    assert topic_modes(user)["achievements"] == "off"
    assert not notification_allowed(user, "achievement") and not push_allowed(user, "achievement")
    assert notification_level(user) == "custom"
    # Zurück auf „Nur in der App“ - dann passt „Wichtiges“ wieder genau.
    prefs.update(mode_preferences("achievements", "app"))
    assert notification_level(_user(prefs)) == "important"


def test_new_accounts_start_with_all():
    user = _user(new_account_preferences())
    assert notification_level(user) == "all"
    # News per Push ja, per Mail nur mit Newsletter-Zustimmung - wie bisher.
    assert push_allowed(user, "news_mention", "news_events") is True
    assert email_allowed(user, "newsletter_news", "news_events") is False


def test_old_accounts_keep_their_switches_and_see_custom():
    """Kein Umschreiben: die alten Schalter wirken weiter genau wie vorher, nur die Sicht kommt dazu."""
    # Konto ohne gespeicherte Schalter und ohne Newsletter: News & Events sind aus - keine Stufe passt.
    untouched = _user({})
    before = {kind: (notification_allowed(untouched, kind), push_allowed(untouched, kind)) for kind in NOTIFICATION_KIND_CATEGORY}
    assert notification_level(untouched) == "custom"
    assert topic_modes(untouched)["news_events"] == "off" and topic_modes(untouched)["match_reminders"] == "push"
    assert {kind: (notification_allowed(untouched, kind), push_allowed(untouched, kind)) for kind in NOTIFICATION_KIND_CATEGORY} == before
    # Mit Newsletter und ohne eigene Schalter passt „Alles“ genau.
    assert notification_level(_user({}, newsletter=True)) == "all"
    # Alter Themen-Schalter (ohne Kanal) „Turnier-Updates aus“: auf der Liste „Aus“.
    legacy = _user({"tournament_updates": False}, newsletter=True)
    assert topic_modes(legacy)["tournament_updates"] == "off" and notification_level(legacy) == "custom"
    # Alter Mischstand: Push an, Glocke aus - zeigt „Push“, ist aber keine der drei Stellungen.
    mixed = _user({"in_app:prize_updates": False}, newsletter=True)
    assert topic_modes(mixed)["prize_updates"] == "push" and notification_level(mixed) == "custom"
    # Browser folgt beim alten Konto dem Push (#1163): Push aus heißt hier „Nur in der App“.
    app_only = _user({"push:achievements": False}, newsletter=True)
    assert topic_modes(app_only)["achievements"] == "app"


def test_payload_carries_level_modes_and_level_definitions():
    payload = public_preferences_payload(_user(level_preferences("few")))
    assert payload["level"] == "few"
    assert payload["topics"] == list(LEVEL_TOPICS)
    assert payload["topic_modes"]["billing_updates"] == "push" and payload["topic_modes"]["prize_updates"] == "app"
    levels = {row["key"]: row for row in payload["levels"]}
    assert [row["key"] for row in payload["levels"]] == ["all", "important", "few"]
    assert levels["all"]["label"] == "Alles" and levels["important"]["label"] == "Wichtiges" and levels["few"]["label"] == "Wenig"
    assert levels["few"]["modes"] == level_modes("few")
    assert payload["quiet_hours"] == {"enabled": False, "start": "22:00", "end": "07:00"}
    assert payload["quiet_hours_suggestion"] == {"start": "22:00", "end": "07:00"}


def test_every_topic_of_the_list_has_the_app_channels():
    for topic in LEVEL_TOPICS:
        channels = OPTIONAL_EMAIL_PREFERENCES[topic].get("channels") or ["in_app", "push", "browser"]
        assert {"in_app", "push", "browser"} <= set(channels), topic
    # Die reinen Mails stehen nicht in der Liste, sondern unter „Weitere Wege“.
    assert "achievement_recap" not in LEVEL_TOPICS and "birthday_greetings" not in LEVEL_TOPICS


def test_later_topics_are_sorted_in():
    """Liga-Meldungen und Belohnungen der Liga unter Turnier-Updates, Helferdienste als eigenes Thema."""
    assert NOTIFICATION_KIND_CATEGORY["league_broadcast"] == "tournament_updates"
    assert NOTIFICATION_KIND_CATEGORY["league_reward"] == "tournament_updates"
    assert NOTIFICATION_KIND_CATEGORY["helper_call"] == "helper_shifts" and "helper_shifts" in LEVEL_TOPICS
    assert set(NOTIFICATION_KIND_CATEGORY.values()) <= set(LEVEL_TOPICS)
