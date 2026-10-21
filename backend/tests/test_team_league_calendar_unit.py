"""Team-Liga im Kalender (#1931) ohne Datenbank: Gegner („vs“ heim, „@“ auswärts) und Spieltag-Zeitraum aus einer
eingefügten Terminzeile, Status eines Spieltags mit Zeitraum. Nur erfundene Teamnamen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.reference_calendar import parse_round_lines, round_status  # noqa: E402


def _parse(text, **kwargs):
    defaults = {"season": "2026", "today": "2026-04-01", "default_weekday": None, "default_time": None}
    return parse_round_lines(text, **{**defaults, **kwargs})


def _row(text, **kwargs):
    result = _parse(text, **kwargs)
    assert result["errors"] == [], result["errors"]
    return result["rows"][0]


def test_vs_means_a_home_match_and_at_an_away_match():
    home = _row("ST2 · 13.05.2026 20:30 · vs Probe Falken")
    assert (home["code"], home["day"], home["time"]) == ("ST2", "2026-05-13", "20:30")
    assert (home["opponent"], home["at_home"], home["venue"]) == ("Probe Falken", True, None)
    away = _row("ST3 | 20.05. | @ Probe Wölfe")
    assert (away["opponent"], away["at_home"], away["venue"]) == ("Probe Wölfe", False, None)


def test_gegen_names_the_opponent_without_a_side_and_a_place_stays_the_place():
    row = _row("ST4 · 27.05. · Online-Arena · gegen Probe Adler")
    assert (row["opponent"], row["at_home"], row["venue"]) == ("Probe Adler", None, "Online-Arena")
    plain = _row("ST5 03.06. vs. Probe Eulen")
    assert (plain["opponent"], plain["at_home"]) == ("Probe Eulen", True)


def test_a_line_without_opponent_has_none():
    row = _row("R1 · 05.11. · Probering")
    assert (row["opponent"], row["at_home"], row["day_end"]) == (None, None, None)


def test_a_matchday_window_keeps_the_first_day_and_the_end():
    row = _row("ST2 · 13.05.–17.05. · vs Probe Falken", default_time="20:00")
    assert (row["day"], row["day_end"], row["time"]) == ("2026-05-13", "2026-05-17", "20:00")
    spaced = _row("ST3 20.05.2026 - 24.05.2026 @ Probe Wölfe")
    assert (spaced["day"], spaced["day_end"], spaced["opponent"], spaced["at_home"]) == (
        "2026-05-20", "2026-05-24", "Probe Wölfe", False)
    short = _row("ST4 · 27.–31.05. · vs Probe Adler")
    assert (short["day"], short["day_end"]) == ("2026-05-27", "2026-05-31")


def test_a_window_across_new_year_rolls_the_end_into_the_next_year():
    row = _row("ST9 · 29.12.–02.01. · vs Probe Falken", season="2026/27")
    assert (row["day"], row["day_end"]) == ("2026-12-29", "2027-01-02")


def test_a_broken_window_is_named_with_its_line():
    result = _parse("ST1 · 13.05.–31.06. · vs Probe Falken")
    assert [(error["line"], error["message"]) for error in result["errors"]] == [(1, "Datum 31.06. gibt es nicht.")]


def test_an_opponent_that_is_too_long_is_refused():
    result = _parse("ST1 · 13.05. · vs " + "x" * 130)
    assert [error["message"] for error in result["errors"]] == ["Gegner ist zu lang (höchstens 120 Zeichen)."]


def test_many_spaces_and_separators_stay_fast():
    # CodeQL: kein Ausdruck, der bei vielen Leerzeichen hintereinander langsam wird.
    row = _row("ST1 · 13.05." + " " * 5000 + "–" + " " * 5000 + "17.05. · vs" + " " * 5000 + "Probe Falken")
    assert (row["day_end"], row["opponent"]) == ("2026-05-17", "Probe Falken")


# ---------------------------------------------------------------- Status mit Zeitraum
def _round(day, end=None, status="planned"):
    return {"id": "st1", "order": 1, "club_day": day, "club_day_end": end, "status": status}


def test_a_matchday_window_is_today_until_its_last_day_and_misses_only_after_it():
    window = _round("2026-05-13", "2026-05-17")
    assert round_status(window, False, "2026-05-12") == "planned"
    assert round_status(window, False, "2026-05-13") == "today"
    assert round_status(window, False, "2026-05-16") == "today"
    assert round_status(window, False, "2026-05-17") == "today"
    assert round_status(window, False, "2026-05-18") == "missing"
    assert round_status(window, True, "2026-05-15") == "scored"
