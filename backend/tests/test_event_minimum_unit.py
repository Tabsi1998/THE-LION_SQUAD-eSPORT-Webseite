"""Mindestanzahl (#2614): die Wörter des Servers - Datum wie auf der Website, Vorschlag für den Grund der Absage.

Das Datum folgt derselben Schreibweise wie die Website (docs/date-cases.json, „Fr 18. Dezember · 18:00“) - ohne „heute“ und
„morgen“, denn ein Grund bleibt stehen und wird später gelesen.
"""
import json
import pathlib
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import event_minimum  # noqa: E402

CASES = json.loads((pathlib.Path(__file__).resolve().parents[2] / "docs" / "date-cases.json").read_text(encoding="utf-8"))
NOW = datetime.fromisoformat(CASES["now"].replace("Z", "+00:00"))


@pytest.mark.parametrize("case", [case for case in CASES["when"]
                                  if case.get("time", True) and not case["expected"].startswith(("heute", "morgen"))],
                         ids=lambda case: case["note"])
def test_deadline_text_writes_dates_like_the_website(case):
    now = datetime.fromisoformat(case.get("now", CASES["now"]).replace("Z", "+00:00"))
    assert event_minimum.deadline_text(case["value"], now=now) == case["expected"]


def test_deadline_text_never_says_today_or_tomorrow():
    assert event_minimum.deadline_text("2026-05-20T16:00:00Z", now=NOW) == "Mi 20. Mai · 18:00"
    assert event_minimum.deadline_text("2026-05-21T16:00:00Z", now=NOW) == "Do 21. Mai · 18:00"


def test_proposal_names_the_numbers_and_the_deadline():
    state = {"count": 8, "have": 5, "deadline": "2026-12-18T17:00:00+00:00", "count_companions": True, "public": True}
    now = datetime(2026, 12, 18, 18, tzinfo=timezone.utc)
    assert event_minimum.proposal(state, now=now) == \
        "Zu wenige Anmeldungen: Bis Fr 18. Dezember · 18:00 waren 5 von mindestens 8 Personen dabei."
    assert event_minimum.proposal({**state, "count_companions": False}, now=now).endswith("5 von mindestens 8 Anmeldungen dabei.")


def test_proposal_without_numbers_when_the_minimum_is_hidden():
    state = {"count": 8, "have": 5, "deadline": "2026-12-18T17:00:00+00:00", "count_companions": True, "public": False}
    assert event_minimum.proposal(state) == event_minimum.PROPOSAL_HIDDEN == "Zu wenige Anmeldungen bis zur Frist."


def test_deadline_must_be_an_hour_before_the_start():
    base = {"has_registration": True, "start_date": "2026-12-31T17:00:00+00:00",
            "min_registrations": {"count": 4, "deadline": "2026-12-31T16:00:00+00:00"}}
    event_minimum.validate(base)
    with pytest.raises(event_minimum.MinimumError) as problem:
        event_minimum.validate({**base, "min_registrations": {"count": 4, "deadline": "2026-12-31T16:00:01+00:00"}})
    assert problem.value.detail == event_minimum.DEADLINE_TOO_LATE


def test_companions_only_count_where_they_are_allowed():
    event = {"allow_companions": False, "min_registrations": {"count": 4, "deadline": "2026-12-18T17:00:00Z", "count_companions": True}}
    assert event_minimum.settings(event)["count_companions"] is False
    assert event_minimum.settings({**event, "allow_companions": True})["count_companions"] is True
