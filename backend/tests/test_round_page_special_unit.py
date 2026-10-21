"""Rundenseite und Statistik (#1950) mit umgekehrter Startaufstellung (#1960) - ohne Datenbank, nur erfundene Namen.

Auch wenn der gespeicherte Stand fehlt (etwa ein Lauf, der nicht zählt), hat ein Lauf mit umgekehrter Aufstellung keine
Pole: weder in der Tabelle noch in der Zusammenfassung noch in der Statistik."""
from services.round_page import _Context, round_view
from services.season_statistics import tally

WEEKEND = {"formats": [{"from_round": 1, "sessions": [
    {"label": "Qualifying", "offset": 0, "counts": False, "points": "none", "dnf": "series", "fastest_lap": None,
     "grid": "manual"},
    {"label": "Sprint", "offset": 30, "counts": True, "points": "series", "dnf": "series", "fastest_lap": None,
     "grid": "reverse_qualifying", "reverse_top": 8}]}]}
SERIES = {"id": "serie-1", "weekend": WEEKEND}
ROUNDS = [
    {"id": "q", "code": "R1", "session": "Qualifying", "session_kind": "qualifying", "weekend": 1, "order": 1,
     "state": "planned", "counts": False},
    {"id": "s", "code": "R1", "session": "Sprint", "session_kind": "sprint", "weekend": 1, "order": 2,
     "state": "scored", "counts": True},
]
SHEETS = {"s": {"rows": [{"participant_id": "p1", "place": 1, "marks": ["pole"], "grid": 1},
                         {"participant_id": "p2", "place": 2, "marks": []}]}}
PEOPLE = {pid: {"name": f"Probe {pid}", "name_hidden": False, "club_member": False, "profile_slug": None}
          for pid in ("p1", "p2")}


def test_a_reversed_session_never_shows_or_counts_a_pole():
    view = round_view(ROUNDS, 1, SHEETS, _Context(SERIES, PEOPLE, {}, {}), PEOPLE)
    sprint = next(item for item in view["sessions"] if item["key"] == "sprint")
    assert (sprint["grid_source"], sprint["reverse_top"]) == ("reverse_qualifying", 8)
    assert sprint["rows"][0]["marks"] == [] and sprint["rows"][0]["grid"] == 1
    assert view["summary"]["pole"] is None

    drivers, _teams, _own = tally(ROUNDS, SHEETS, {}, SERIES)
    assert drivers["p1"]["poles"] == 0 and drivers["p1"]["wins"] == 1


def test_a_race_without_qualifying_result_keeps_its_pole_mark_as_before():
    plain = {"id": "serie-2", "weekend": None}
    rounds = [{"id": "r", "code": "R1", "session": None, "session_kind": "race", "weekend": 1, "order": 1,
               "state": "scored", "counts": True}]
    sheets = {"r": {"rows": [{"participant_id": "p1", "place": 1, "marks": ["pole"]}]}}
    view = round_view(rounds, 1, sheets, _Context(plain, PEOPLE, {}, {}), PEOPLE)
    assert view["summary"]["pole"] == {"key": "p1", "session": "rennen", "time": None}
    drivers, _teams, _own = tally(rounds, sheets, {}, plain)
    assert drivers["p1"]["poles"] == 1
