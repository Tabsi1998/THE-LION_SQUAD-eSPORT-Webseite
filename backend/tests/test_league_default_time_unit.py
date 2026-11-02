"""Der Standardtermin liegt nie in einer Sperrzeit (#2201, D-19) - reine Rechnung mit festen Tagen, ohne Datenbank.

Fällt der Standardtag in eine Sperrzeit, gilt der nächste zulässige Tag derselben Woche zur selben Uhrzeit, sonst der
letzte davor. Hat die Woche keinen freien Tag, gibt es keinen Termin und einen Hinweis für die Leitung.
"""
import pathlib
import sys
from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_games, matchday_schedule  # noqa: E402

VIENNA = ZoneInfo("Europe/Vienna")
# Start Donnerstag 12.11.2026 00:00 Wien, Wochen Do bis Mi, Standardtermin Sonntag 20:00.
BASE = {"id": "s", "format": "league", "event_mode": "online", "start_date": "2026-11-11T23:00:00+00:00", "matchday_days": 7,
        "default_match_weekday": 6, "default_match_time": "20:00", "round_robin_legs": 1, "league_context": {"season_id": "x"}}
MATCH = {"id": "m", "status": "pending", "slots": [{"registration_id": "a"}, {"registration_id": "b"}]}


def season(*periods, **extra) -> dict:
    return {**BASE, "blocked_periods": [{"start_date": first, "end_date": last, "label": "Pause"} for first, last in periods], **extra}


def local(value) -> str:
    moment = datetime.fromisoformat(value) if isinstance(value, str) else value
    return moment.astimezone(VIENNA).strftime("%a %d.%m.%Y %H:%M")


def entry_of(tournament: dict, number: int, **match) -> dict:
    plan = matchday_schedule.build_matchday_plan(tournament, [{**MATCH, "round": number, **match}])
    return plan["matchdays"][0]["matches"][0]


def test_without_a_break_the_default_stays_on_its_day():
    entry = entry_of(BASE, 1)
    assert local(entry["scheduled_at"]) == "Sun 15.11.2026 20:00" and entry["schedule_source"] == "default"
    assert "schedule_hint" not in entry


def test_a_blocked_default_day_moves_to_the_next_free_day_of_the_week():
    # Woche 31.12. bis 6.1.: Der Sonntag 3.1. liegt noch in der Pause, Montag 4.1. ist frei.
    entry = entry_of(season(("2026-12-21", "2027-01-03")), 8)
    assert local(entry["scheduled_at"]) == "Mon 04.01.2027 20:00" and entry["schedule_source"] == "default"
    assert "schedule_hint" not in entry


def test_blocked_until_the_end_of_the_week_takes_the_last_free_day_before():
    # Woche 17.12. bis 23.12.: Sonntag 20.12. bis Mittwoch 23.12. gesperrt - Samstag 19.12. ist der nächstgelegene Tag.
    entry = entry_of(season(("2026-12-20", "2026-12-23")), 6)
    assert local(entry["scheduled_at"]) == "Sat 19.12.2026 20:00"


def test_a_fully_blocked_week_has_no_time_and_a_hint():
    entry = entry_of(season(("2026-12-17", "2026-12-23")), 6)
    assert entry["scheduled_at"] is None and entry["schedule_source"] is None
    assert "Sperrzeit" in entry["schedule_hint"]


def test_a_blocked_week_of_the_season_is_skipped_as_before():
    """Regression: Eine Sperrwoche überspringt den Spieltag; das hier ist die nächste aktive Woche."""
    entry = entry_of({**BASE, "matchday_blocked_weeks": [2]}, 2)
    assert local(entry["scheduled_at"]) == "Sun 29.11.2026 20:00"


def test_a_short_week_without_the_default_day_stays_without_a_hint():
    """Regression: Eine Woche ohne den Standardtag hat wie bisher keinen Termin - das ist keine Sperrzeit."""
    entry = entry_of({**BASE, "matchday_days": 1, "default_match_weekday": 2}, 1)
    assert entry["scheduled_at"] is None and "schedule_hint" not in entry


def test_agreed_and_home_times_are_not_moved():
    tournament = season(("2026-11-15", "2026-11-15"))
    plan = matchday_schedule.build_matchday_plan(tournament, [{**MATCH, "round": 1}], [
        {"match_id": "m", "status": "accepted", "scheduled_at": "2026-11-15T19:00:00+00:00", "actor_registration_id": "b"}])
    entry = plan["matchdays"][0]["matches"][0]
    assert local(entry["scheduled_at"]) == "Sun 15.11.2026 20:00" and entry["schedule_source"] == "accepted"


def test_the_job_moves_a_written_default_out_of_the_break():
    tournament = season(("2026-11-15", "2026-11-15"))
    stored = {**MATCH, "round": 1, "status": "scheduled", "scheduled_at": "2026-11-15T19:00:00+00:00", "schedule_source": "default"}
    writes = matchday_schedule.schedule_writes(tournament, [stored])
    assert local(writes[0]["update"]["scheduled_at"]) == "Mon 16.11.2026 20:00"


def test_the_job_clears_a_written_default_in_a_fully_blocked_week():
    tournament = season(("2026-11-12", "2026-11-18"))
    stored = {**MATCH, "round": 1, "status": "scheduled", "scheduled_at": "2026-11-15T19:00:00+00:00", "schedule_source": "default"}
    writes = matchday_schedule.schedule_writes(tournament, [stored])
    assert writes[0]["update"]["scheduled_at"] is None and writes[0]["update"]["schedule_source"] is None


def test_the_job_keeps_a_manual_time_in_a_break():
    tournament = season(("2026-11-15", "2026-11-15"))
    stored = {**MATCH, "round": 1, "status": "scheduled", "scheduled_at": "2026-11-15T19:00:00+00:00", "schedule_source": "manual"}
    assert matchday_schedule.schedule_writes(tournament, [stored]) == []


def test_the_match_page_shows_the_same_default():
    tournament = season(("2026-12-21", "2027-01-03"))
    setup = SimpleNamespace(match={**MATCH, "round": 8}, tournament=tournament)
    assert local(league_games.default_time(setup)) == "Mon 04.01.2027 20:00"
