"""Kalender externer Serien (#1742) ohne Datenbank: Status je Termin aus dem Wiener Tag, Hinweise auf Lücken und der
Parser für eingefügte Terminlisten. Nur erfundene Orte und Namen."""
import os
import pathlib
import sys
import time
from datetime import datetime, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import dolibarr_policy  # noqa: E402
from services.reference_calendar import (  # noqa: E402
    ClockError, calendar_view, club_day_of, parse_round_lines, round_status, vienna_start,
)


def _round(rid="r1", day=None, status="planned", order=1, **fields):
    return {"id": rid, "order": order, "club_day": day, "status": status, **fields}


# ---------------------------------------------------------------- Status
def test_status_follows_the_vienna_day():
    today = "2026-11-05"
    assert round_status(_round(day="2026-11-06"), False, today) == "planned"
    assert round_status(_round(day="2026-11-05"), False, today) == "today"
    assert round_status(_round(day="2026-11-04"), False, today) == "missing"
    assert round_status(_round(day="2026-11-04"), True, today) == "scored"
    assert round_status(_round(day="2026-11-05", status="scored"), False, today) == "scored"
    assert round_status(_round(day=None), False, today) == "planned"


def test_a_cancelled_round_never_counts_as_missing():
    assert round_status(_round(day="2026-10-01", status="cancelled"), False, "2026-11-05") == "cancelled"
    assert round_status(_round(day="2026-12-01", status="cancelled"), False, "2026-11-05") == "cancelled"


def test_a_postponed_round_waits_for_its_new_day_and_then_misses_like_any_other():
    moved = _round(day="2026-11-12", status="postponed", original_club_day="2026-11-05")
    assert round_status(moved, False, "2026-11-05") == "postponed"
    assert round_status(moved, False, "2026-11-12") == "today"
    assert round_status(moved, False, "2026-11-13") == "missing"
    assert round_status(moved, True, "2026-11-13") == "scored"


@pytest.fixture
def server_in_utc(monkeypatch):
    """Der Server läuft in UTC - der Wiener Tag darf davon nicht abhängen."""
    monkeypatch.setenv("TZ", "UTC")
    if hasattr(time, "tzset"):
        time.tzset()
    yield
    monkeypatch.delenv("TZ", raising=False)
    if hasattr(time, "tzset"):
        time.tzset()


def test_the_status_turns_at_vienna_midnight_not_at_utc_midnight(server_in_utc, monkeypatch):
    # 05.11. 23:30 in Wien ist 22:30 UTC - der Termin gehört zum 05.11.
    starts = vienna_start("2026-11-05", "23:30")
    assert starts == "2026-11-05T22:30:00+00:00"
    assert club_day_of(starts) == "2026-11-05"
    race = _round(day=club_day_of(starts), starts_at=starts)

    monkeypatch.setattr(dolibarr_policy, "now_utc", lambda: datetime(2026, 11, 5, 22, 59, tzinfo=timezone.utc))
    assert dolibarr_policy.club_today() == "2026-11-05"
    assert round_status(race, False, dolibarr_policy.club_today()) == "today"

    # 23:30 UTC ist in Wien schon der 06.11. - in UTC wäre es noch „heute“.
    monkeypatch.setattr(dolibarr_policy, "now_utc", lambda: datetime(2026, 11, 5, 23, 30, tzinfo=timezone.utc))
    assert dolibarr_policy.club_today() == "2026-11-06"
    assert round_status(race, False, dolibarr_policy.club_today()) == "missing"
    assert os.environ.get("TZ") == "UTC"


def test_summer_time_is_two_hours_ahead():
    assert vienna_start("2026-07-01", "20:30") == "2026-07-01T18:30:00+00:00"
    assert vienna_start("2026-07-01", None) is None
    assert club_day_of("2026-06-30T22:30:00+00:00") == "2026-07-01"
    assert club_day_of(None) is None


# ---------------------------------------------------------------- Ansicht und Hinweise
def test_the_view_numbers_rounds_counts_states_and_flags_a_gap_between_scored_rounds():
    rounds = [
        _round("r3", "2026-10-15", order=3, code="R3"),
        _round("r1", "2026-10-01", order=1, code="R1", status="scored"),
        _round("r2", "2026-10-08", order=2, code="R2"),
        _round("r4", "2026-10-22", order=4, code="R4", status="scored"),
        _round("r5", "2026-10-29", order=5, code="R5", status="cancelled"),
        _round("r6", "2026-11-05", order=6, code="R6"),
        _round("r7", "2026-11-12", order=7, code="R7"),
        _round("rx", "2026-10-02", order=8, archived_at="2026-10-03T10:00:00+00:00"),
    ]
    view = calendar_view(rounds, {"r1", "r4"}, "2026-11-05")
    assert [(item["id"], item["position"], item["state"]) for item in view["rounds"]] == [
        ("r1", 1, "scored"), ("r2", 2, "missing"), ("r3", 3, "missing"), ("r4", 4, "scored"),
        ("r5", 5, "cancelled"), ("r6", 6, "today"), ("r7", 7, "planned")]
    assert view["counts"] == {"planned": 1, "today": 1, "missing": 2, "cancelled": 1, "postponed": 0, "scored": 2}
    # Nur Lücken vor einer gewerteten Runde - die abgesagte R5 nicht.
    assert [hint["round_id"] for hint in view["hints"]] == ["r2", "r3"]
    assert "R2" in view["hints"][0]["text"] and "R4" in view["hints"][0]["text"]


def test_a_missing_result_after_the_last_scored_round_is_no_gap_hint():
    view = calendar_view([_round("a", "2026-10-01", status="scored"), _round("b", "2026-10-08", order=2)], {"a"},
                         "2026-11-05")
    assert [item["state"] for item in view["rounds"]] == ["scored", "missing"]
    assert view["hints"] == []


# ---------------------------------------------------------------- Einfügen
def _parse(text, **kwargs):
    defaults = {"season": "2026", "today": "2026-10-19", "default_weekday": None, "default_time": None}
    return parse_round_lines(text, **{**defaults, **kwargs})


def test_lines_with_code_date_and_place_in_several_spellings():
    result = _parse("R1 · 05.11. · Probering\nR2 | 12.11.2026 | Teststadt 20:00\nR3 Beispielpark 19.11.\n\n# Kommentar\n"
                    "ST4; 26.11.26; Musterkurs", default_time="20:30")
    assert result["errors"] == []
    assert [(row["code"], row["day"], row["time"], row["venue"]) for row in result["rows"]] == [
        ("R1", "2026-11-05", "20:30", "Probering"),
        ("R2", "2026-11-12", "20:00", "Teststadt"),
        ("R3", "2026-11-19", "20:30", "Beispielpark"),
        ("ST4", "2026-11-26", "20:30", "Musterkurs"),
    ]
    assert result["rows"][0]["starts_at"] == "2026-11-05T19:30:00+00:00"
    assert [row["line"] for row in result["rows"]] == [1, 2, 3, 6]


def test_a_season_across_new_year_rolls_the_year_forward():
    result = _parse("R1 05.11. Nord\nR2 17.12. Süd\nR3 14.01. West", season="2025/26")
    assert [row["day"] for row in result["rows"]] == ["2025-11-05", "2025-12-17", "2026-01-14"]


def test_a_line_without_date_takes_the_next_standard_weekday():
    # 05.11.2026 ist ein Donnerstag (3); ohne Standard-Wochentag eine Woche später.
    result = _parse("R1 05.11. Nord\nR2 Süd\nR3 West", default_weekday=1)
    assert [row["day"] for row in result["rows"]] == ["2026-11-05", "2026-11-10", "2026-11-17"]
    assert result["rows"][0]["warning"] and not result["rows"][1]["warning"]
    weekly = _parse("R1 05.11. Nord\nR2 Süd")
    assert [row["day"] for row in weekly["rows"]] == ["2026-11-05", "2026-11-12"]
    assert weekly["rows"][1]["warning"] is None


def test_without_time_and_without_standard_time_the_round_has_only_a_day():
    row = _parse("R1 05.11. Nord")["rows"][0]
    assert (row["day"], row["time"], row["starts_at"]) == ("2026-11-05", None, None)


def test_broken_lines_are_named_with_their_number():
    result = _parse("R1 31.02. Nord\nNur ein Ort\nR3 05.11. " + "x" * 200 + "\nR4 07.11. 25:61 Süd")
    assert [(error["line"], error["message"]) for error in result["errors"]] == [
        (1, "Datum 31.02. gibt es nicht."),
        (2, "Datum fehlt (TT.MM.)."),
        (3, "Ort ist zu lang (höchstens 160 Zeichen)."),
        (4, "Uhrzeit 25:61 gibt es nicht."),
    ]
    assert result["rows"] == []


def test_too_many_lines_are_refused_as_a_whole():
    result = _parse("\n".join(f"R{index} 05.11. Ort" for index in range(1, 202)))
    assert result["rows"] == [] and result["errors"][0]["line"] is None
    assert "200" in result["errors"][0]["message"]


def test_iso_dates_and_plain_numbers_work_too():
    result = _parse("1. 2026-11-05 Nord\n2 2026-11-12 Süd")
    assert [(row["code"], row["day"]) for row in result["rows"]] == [("1", "2026-11-05"), ("2", "2026-11-12")]


# ---------------------------------------------------------------- Zeitumstellung
def test_a_clock_that_does_not_exist_in_vienna_is_refused():
    # Letzter Sonntag im März: 02:00 springt auf 03:00.
    with pytest.raises(ClockError, match="02:30 Uhr gibt es am 29.03.2026 in Wien nicht"):
        vienna_start("2026-03-29", "02:30")
    assert vienna_start("2026-03-29", "03:00") == "2026-03-29T01:00:00+00:00"


def test_a_clock_that_exists_twice_means_the_first_one_in_summer_time():
    # Letzter Sonntag im Oktober: 02:00–02:59 gibt es zweimal - gemeint ist die erste (noch Sommerzeit, UTC+2).
    assert vienna_start("2026-10-25", "02:30") == "2026-10-25T00:30:00+00:00"
    assert vienna_start("2026-10-25", "03:30") == "2026-10-25T02:30:00+00:00"


def test_a_pasted_line_with_a_missing_clock_is_named():
    result = _parse("R1 29.03. 02:30 Nord\nR2 25.10. 02:30 Süd")
    assert [(error["line"], error["message"]) for error in result["errors"]] == [
        (1, "02:30 Uhr gibt es am 29.03.2026 in Wien nicht (Umstellung auf Sommerzeit).")]
