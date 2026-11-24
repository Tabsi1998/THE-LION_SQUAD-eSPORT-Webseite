"""Einmal gestartet bleibt gestartet (#2404, Nr. 253; docs/LIGA.md „F.6 … Sperre ab dem Season-Start“): der gemerkte Start
``started_at`` einer Season - reine Rechnung in ``league_calendar``, ohne Datenbank.

Ohne das Feld gilt, was das Startdatum sagt (keine Migration). Ist der Start einmal gemerkt, gilt er - auch wenn das Datum danach in
die Zukunft rückt oder die Season wieder Entwurf wird.
"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_calendar  # noqa: E402

NOW = datetime(2031, 3, 10, 12, 0, tzinfo=timezone.utc)
PAST = (NOW - timedelta(days=3)).isoformat()
FUTURE = (NOW + timedelta(days=30)).isoformat()


def test_without_a_remembered_start_the_start_date_decides():
    assert league_calendar.season_started({"status": "active", "start_date": PAST}, NOW) is True
    assert league_calendar.season_started({"status": "active", "start_date": FUTURE}, NOW) is False
    assert league_calendar.season_started({"status": "active"}, NOW) is False
    assert league_calendar.season_started(None, NOW) is False


def test_a_draft_has_never_started():
    assert league_calendar.season_started({"status": "draft", "start_date": PAST}, NOW) is False
    assert league_calendar.season_started({"start_date": PAST}, NOW) is False


def test_a_remembered_start_stays_whatever_the_date_or_status_says():
    for season in ({"status": "active", "start_date": FUTURE, "started_at": PAST},
                   {"status": "draft", "start_date": FUTURE, "started_at": PAST},
                   {"status": "active", "started_at": PAST}):
        assert league_calendar.season_started(season, NOW) is True
        assert league_calendar.start_moment(season) == league_calendar.aware(PAST)


def test_the_start_is_remembered_once_and_only_after_it_was_reached():
    # Erreicht und noch nicht gemerkt: der Beginn, wie er bisher eingestellt war.
    assert league_calendar.start_stamp({"status": "active", "start_date": PAST}, NOW) == league_calendar.aware(PAST).isoformat()
    # Schon gemerkt, noch nicht erreicht, Entwurf: nichts zu merken.
    assert league_calendar.start_stamp({"status": "active", "start_date": FUTURE, "started_at": PAST}, NOW) is None
    assert league_calendar.start_stamp({"status": "active", "start_date": FUTURE}, NOW) is None
    assert league_calendar.start_stamp({"status": "draft", "start_date": PAST}, NOW) is None


def test_deadlines_count_from_the_remembered_start():
    assert league_calendar.start_moment({"start_date": FUTURE}) == league_calendar.aware(FUTURE)
    assert league_calendar.start_moment({"start_date": FUTURE, "started_at": PAST}) == league_calendar.aware(PAST)
    assert league_calendar.start_moment({}) is None
