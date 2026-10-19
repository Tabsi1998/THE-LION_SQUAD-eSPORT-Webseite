"""„Antreten bis“ und „nicht erschienen ab“ (#1791): eine Regel an einer Stelle (``match_deadlines.appear_by``).

Wird ein Spiel vor seiner Planzeit aufgerufen, müssen die Spieler zur Planzeit da sein - „antreten bis“ (Aufruf-Tafel,
Matchseite, Warteschlange) und die Frist „nicht erschienen“ nennen dann dieselbe Zeit. Ohne Planzeit, oder wenn sie
schon vor dem Aufruf lag, zählen beide ab dem Aufruf: „Zeit zum Antreten“ (TV, Standard 2 Minuten) bzw. die Frist vor
Ort (Standard 10 Minuten, E6).
"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.match_calls import report_by  # noqa: E402
from services.match_deadlines import appear_by, no_show_deadline  # noqa: E402

T0 = datetime(2026, 10, 31, 10, 0, tzinfo=timezone.utc)
LOCAL = {"id": "t1", "event_mode": "local"}


def at(minutes: int) -> str:
    return (T0 + timedelta(minutes=minutes)).isoformat()


def called_match(called: int, scheduled: int | None = None, **extra) -> dict:
    return {
        "id": "m1", "status": "scheduled", "station_id": "st1", "called_at": at(called),
        "scheduled_at": at(scheduled) if scheduled is not None else None,
        "slots": [{"slot": 1, "registration_id": "r1"}, {"slot": 2, "registration_id": "r2"}],
        **extra,
    }


def test_called_before_the_planned_time_both_deadlines_are_the_planned_time():
    match = called_match(0, scheduled=15)
    assert report_by(match, match["called_at"], 2) == T0 + timedelta(minutes=15)
    no_show = no_show_deadline(match, LOCAL)
    assert no_show["due_at"] == report_by(match, match["called_at"], 2) == T0 + timedelta(minutes=15)
    assert no_show["rule"] == "on_site" and no_show["minutes"] == 10


def test_without_planned_time_both_count_from_the_call():
    match = called_match(0)
    assert report_by(match, match["called_at"], 2) == T0 + timedelta(minutes=2)
    assert no_show_deadline(match, LOCAL)["due_at"] == T0 + timedelta(minutes=10)


def test_called_after_the_planned_time_both_count_from_the_call():
    match = called_match(5, scheduled=0)
    assert report_by(match, match["called_at"], 2) == T0 + timedelta(minutes=7)
    assert no_show_deadline(match, {**LOCAL, "no_show_minutes_on_site": 7})["due_at"] == T0 + timedelta(minutes=12)


def test_an_extension_still_moves_the_no_show_deadline():
    match = called_match(0, scheduled=15, no_show_extended_until=at(30))
    assert no_show_deadline(match, LOCAL)["due_at"] == T0 + timedelta(minutes=30)


def test_one_rule_for_both():
    """Beide lesen ``appear_by`` - nur die Minuten unterscheiden sich."""
    match = called_match(0, scheduled=15)
    assert appear_by(match, match["called_at"], 2) == appear_by(match, match["called_at"], 10) == T0 + timedelta(minutes=15)
    assert appear_by({"scheduled_at": None}, None, 2) is None
    assert appear_by({"scheduled_at": at(15)}, None, 2) == T0 + timedelta(minutes=15), "ohne Aufruf: die Planzeit"
