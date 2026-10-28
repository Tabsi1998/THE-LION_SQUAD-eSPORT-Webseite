"""Liga P2 (docs/LIGA.md, #1624): Sperrwochen - Spieltag N liegt in der N-ten aktiven Woche; Standardtermin, Fristen
und Sperrzeiten richten sich danach. Ohne die Liga-Felder bleibt alles wie bisher.
"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import match_deadlines, matchday_schedule  # noqa: E402

VIENNA = ZoneInfo("Europe/Vienna")
# Season 1: Di 10.11.2026 00:00 Wien, 10 Wochen, Weihnachtspause 21.12.–3.1. → Wochen 7 und 8 gesperrt.
SEASON_ONE = {
    "id": "staffel-a", "format": "league", "event_mode": "online", "start_date": "2026-11-09T23:00:00+00:00",
    "matchday_days": 7, "default_match_weekday": 6, "default_match_time": "20:00",
    "matchday_blocked_weeks": [7, 8], "matchday_weeks_total": 10, "round_robin_legs": 1,
    "blocked_periods": [{"start_date": "2026-12-21", "end_date": "2027-01-03", "label": "Weihnachtspause"}],
}


# ---------------------------------------------------------------- Sperrwochen

def local(value: str) -> str:
    return datetime.fromisoformat(value).astimezone(VIENNA).strftime("%d.%m.%Y %H:%M")


def test_season_one_puts_matchday_seven_into_week_nine():
    assert [matchday_schedule.calendar_week_of(SEASON_ONE, day) for day in range(1, 9)] == [1, 2, 3, 4, 5, 6, 9, 10]
    six = matchday_schedule.tournament_matchday_window(SEASON_ONE, 6)
    seven = matchday_schedule.tournament_matchday_window(SEASON_ONE, 7)
    assert (local(six.start.isoformat()), local(six.end.isoformat())) == ("15.12.2026 00:00", "22.12.2026 00:00")
    assert (local(seven.start.isoformat()), local(seven.end.isoformat())) == ("05.01.2027 00:00", "12.01.2027 00:00")
    assert seven.number == 7
    # Ohne Sperrwochen: Spieltag N ist Woche N wie bisher.
    plain = {key: value for key, value in SEASON_ONE.items()
             if key not in ("matchday_blocked_weeks", "blocked_periods")}
    assert local(matchday_schedule.tournament_matchday_window(plain, 7).start.isoformat()) == "22.12.2026 00:00"


def test_plan_default_time_and_deadlines_follow_the_active_week():
    match = {"id": "m7", "round": 7, "status": "pending", "slots": [{"registration_id": "a"}, {"registration_id": "b"}]}
    plan = matchday_schedule.build_matchday_plan(SEASON_ONE, [match])
    day = plan["matchdays"][0]
    assert (day["number"], day["calendar_week"]) == (7, 9)
    assert local(day["starts_at"]) == "05.01.2027 00:00"
    assert local(day["matches"][0]["scheduled_at"]) == "10.01.2027 20:00"  # Standardtermin Sonntag 20:00
    assert local(match_deadlines.matchday_end(match, SEASON_ONE).isoformat()) == "12.01.2027 00:00"


def test_blocked_period_at_names_the_break():
    def at(text):
        return matchday_schedule.blocked_period_at(SEASON_ONE, datetime.fromisoformat(text))

    assert at("2026-12-24T18:00:00+01:00")["label"] == "Weihnachtspause"
    assert at("2026-12-21T00:30:00+01:00")["label"] == "Weihnachtspause"
    assert at("2026-12-20T23:30:00+01:00") is None
    assert at("2027-01-04T19:00:00+01:00")["label"] == "Sperrwoche 8"  # nach der Pause, aber noch in Woche 8
    assert at("2027-01-05T00:00:00+01:00") is None
    assert matchday_schedule.blocked_period_at({"start_date": SEASON_ONE["start_date"]},
                                               datetime(2026, 12, 24, tzinfo=timezone.utc)) is None


def test_response_deadline_pauses_over_the_break():
    start = datetime.fromisoformat("2026-12-19T20:00:00+01:00")
    due = matchday_schedule.response_deadline(SEASON_ONE, start, 72)
    assert local(due.isoformat()) == "06.01.2027 20:00"
    plain = matchday_schedule.response_deadline({}, start, 72)
    assert local(plain.isoformat()) == "22.12.2026 20:00"


def test_a_started_step_before_the_break_counts_only_its_free_part():
    """20.12. 23:30: eine halbe Stunde frei, dann Pause bis 5.1. 00:00 - der Rest (71,5 h) läuft danach."""
    start = datetime.fromisoformat("2026-12-20T23:30:00+01:00")
    due = matchday_schedule.response_deadline(SEASON_ONE, start, 72)
    assert local(due.isoformat()) == "07.01.2027 23:30"
    inside = matchday_schedule.response_deadline(SEASON_ONE, datetime.fromisoformat("2026-12-24T12:00:00+01:00"), 2)
    assert local(inside.isoformat()) == "05.01.2027 02:00"
    # Ein Start nicht um Mitternacht (Sperrwochen beginnen mit dem Start der Season): die Grenzen gelten trotzdem genau.
    shifted = {**SEASON_ONE, "start_date": "2026-11-10T11:00:00+00:00", "blocked_periods": []}
    week_seven = matchday_schedule.tournament_matchday_window({**shifted, "matchday_blocked_weeks": []}, 7)
    due = matchday_schedule.response_deadline(shifted, week_seven.start.replace(minute=0) - timedelta(minutes=30), 1)
    after_break = matchday_schedule.tournament_matchday_window({**shifted, "matchday_blocked_weeks": []}, 9).start
    assert due == after_break + timedelta(minutes=30)
