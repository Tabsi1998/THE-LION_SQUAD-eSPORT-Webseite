"""Wächter (#1662): Jede Meldungsart, die der Code erzeugt, hat ein Thema und eine Wichtigkeit.

Die Arten liest ``notification_kind_scan`` aus dem Quelltext (auch über Hilfsfunktionen, die ``kind`` weiterreichen). Eine
neue Art ohne Eintrag in ``NOTIFICATION_KIND_CATEGORY`` und ``NOTIFICATION_KIND_IMPORTANCE`` lässt diesen Test scheitern -
sonst ließe sie sich weder abschalten noch einordnen (Ruhezeit, Sammel-Mail, Glocke nach Themen)."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from notification_kind_scan import scan  # noqa: E402

from services.notification_preferences import (  # noqa: E402
    ACCOUNT_KINDS, ACCOUNT_TOPIC, IMPORTANCE_LEVELS, LEVEL_TOPICS, NOTIFICATION_KIND_CATEGORY, NOTIFICATION_KIND_IMPORTANCE,
    REQUIRED_NOTIFICATION_KINDS, TOPIC_LABELS, notification_importance, notification_topic,
)
from services.quiet_hours_rules import EXEMPT_KINDS  # noqa: E402

# Stellen, deren Art sich nicht aus dem Text lesen lässt - mit den Arten, die dort entstehen. Eine neue solche Stelle
# lässt den Test scheitern, bis sie hier mit ihren Arten steht.
DYNAMIC = {
    "services/event_changes.py:_inform:MESSAGE_KIND": {"event_message"},  # aus event_lead importiert
    "services/member_announcements.py:_notify:f\"{kind_base}_{KINDS.get(visibility, 'member')}\"": {
        "news_member", "news_board", "event_member", "event_board",
    },
}


def _created_kinds() -> set[str]:
    kinds, unresolved = scan()
    assert set(unresolved) == set(DYNAMIC), f"Neue Stelle ohne lesbare Art: {sorted(set(unresolved) - set(DYNAMIC))}"
    return set(kinds) | set().union(*DYNAMIC.values())


def test_the_scan_finds_kinds_behind_helpers():
    kinds = _created_kinds()
    # Über Hilfsfunktionen (league_checkin_sweep, team_dissolve._tell_members, league_rewards._send mit ``create``).
    assert {"match_call", "team_dissolved", "league_reward", "helper_call", "tournament_registration"} <= kinds


def test_every_created_kind_has_a_topic_and_an_importance():
    missing_topic = sorted(kind for kind in _created_kinds()
                           if kind not in NOTIFICATION_KIND_CATEGORY and kind not in ACCOUNT_KINDS)
    missing_importance = sorted(kind for kind in _created_kinds() if kind not in NOTIFICATION_KIND_IMPORTANCE)
    assert not missing_topic, f"Ohne Thema: {missing_topic}"
    assert not missing_importance, f"Ohne Wichtigkeit: {missing_importance}"


def test_topic_and_importance_lists_cover_the_same_kinds():
    assert set(NOTIFICATION_KIND_CATEGORY) | set(ACCOUNT_KINDS) == set(NOTIFICATION_KIND_IMPORTANCE)
    assert not set(NOTIFICATION_KIND_CATEGORY) & set(ACCOUNT_KINDS)


def test_every_topic_and_importance_is_known():
    assert set(NOTIFICATION_KIND_CATEGORY.values()) <= set(LEVEL_TOPICS)
    assert set(NOTIFICATION_KIND_IMPORTANCE.values()) <= set(IMPORTANCE_LEVELS)
    assert set(TOPIC_LABELS) == set(LEVEL_TOPICS) | {ACCOUNT_TOPIC}


def test_required_kinds_sit_under_account():
    assert set(REQUIRED_NOTIFICATION_KINDS) <= set(ACCOUNT_KINDS)
    assert all(notification_topic(kind) == ACCOUNT_TOPIC for kind in ACCOUNT_KINDS)


def test_topic_and_importance_of_a_single_notification():
    assert notification_topic("match_call") == "match_reminders"
    assert notification_topic("match_attention", {"category": "match_reminders"}) == "match_reminders"
    assert notification_topic("unbekannt") == ACCOUNT_TOPIC
    assert notification_importance("match_call") == "urgent"
    assert notification_importance("match_result") == "normal"
    # „Match startet jetzt“ in der Liga (match_schedule mit checkin_started) ist dringend - wie bei der Ruhezeit.
    assert notification_importance("match_schedule", {"reason": "checkin_started"}) == "urgent"
    assert notification_importance("match_schedule", {"reason": "proposed"}) == "important"
    # Eine Meldung darf ihre Wichtigkeit selbst nennen - nur mit einer bekannten Stufe.
    assert notification_importance("tournament_notice", {"importance": "urgent"}) == "urgent"
    assert notification_importance("tournament_notice", {"importance": "egal"}) == "important"
    assert notification_importance("unbekannt") == "normal"



# Prüfung 26.11. (Kann): Die Mengen stehen ausdrücklich hier - eine neue Art, die die Ruhezeit bricht oder nie gesammelt wird,
# muss hier eingetragen werden, sonst ist der Test rot.
EXPECTED_QUIET_BREAKERS = {"match_call", "match_station", "admin_push_test"}
EXPECTED_TIMELY_KINDS = {"tournament_cancelled"}
EXPECTED_NEVER_COLLECTED_TEMPLATES = {
    "match_lead_10m", "match_reminder", "checkin_closes_soon", "checkin_closes_soon_on_site", "score_reported", "dispute_opened",
    "tournament_cancelled", "event_cancelled",
}


def test_the_kinds_that_break_the_quiet_hours_are_exactly_these():
    urgent = {kind for kind, level in NOTIFICATION_KIND_IMPORTANCE.items() if level == "urgent"}
    assert urgent == EXPECTED_QUIET_BREAKERS
    assert set(EXEMPT_KINDS) == EXPECTED_QUIET_BREAKERS


def test_the_timely_kinds_and_never_collected_mails_are_exactly_these():
    from services.mail_digest_rules import NEVER_COLLECT_TEMPLATES
    from services.notification_preferences import TIMELY_KINDS

    assert set(TIMELY_KINDS) == EXPECTED_TIMELY_KINDS
    assert set(NEVER_COLLECT_TEMPLATES) == EXPECTED_NEVER_COLLECTED_TEMPLATES
    # Absagen brechen die Ruhezeit nicht von selbst (Fabian 26.11., E).
    assert notification_importance("tournament_cancelled") == "important"
