"""Ergebnistabelle je Runde (#1950) ohne Datenbank: Schlüssel der Läufe für die Adresse, Farben, Hauptrennen,
Reihenfolge der Zeilen und welche Kennzahlen der Statistik erscheinen."""
from services.round_page import best_club, clean_hex, main_session, session_key, team_color_map
from services.season_statistics import present_metrics


def test_session_keys_are_readable_and_ascii():
    assert session_key("Qualifying") == "qualifying"
    assert session_key(" Lauf  1 ") == "lauf-1"
    assert session_key("Blitz-Qualifying") == "blitz-qualifying"
    assert session_key("Hauptrennen") == "hauptrennen"
    assert session_key("Läufe & Übungen") == "laeufe-uebungen"
    assert session_key(None) == "rennen"
    assert session_key("***") == "rennen"


def test_colors_are_six_digit_hex_only():
    assert clean_hex("#FACC15") == "#facc15"
    assert clean_hex(" #29b6e8 ") == "#29b6e8"
    for bad in ("facc15", "#fff", "#12345g", "", None, "#1234567"):
        assert clean_hex(bad) is None
    assert team_color_map({"team_colors": {"Probe  Löwen": "#FACC15", "Kaputt": "rot", "": "#000000"}}) == {
        "probe löwen": "#facc15"}


def _session(kind, state="scored", key=None):
    return {"kind": kind, "state": state, "key": key or kind}


def test_the_main_race_is_the_last_race_of_the_round():
    sessions = [_session("qualifying"), _session("sprint"), _session("race", key="hauptrennen")]
    assert main_session(sessions)["key"] == "hauptrennen"
    heats = [_session("race", key="lauf-1"), _session("race", key="lauf-2")]
    assert main_session(heats)["key"] == "lauf-2"
    assert main_session([_session("qualifying"), _session("sprint")])["key"] == "sprint"
    assert main_session([_session("qualifying")])["key"] == "qualifying"
    assert main_session([_session("qualifying"), _session("race", state="cancelled")])["key"] == "qualifying"
    assert main_session([]) is None


def test_the_best_club_driver_finished_before_a_retirement_and_never_a_non_starter():
    rows = [{"key": "a", "status": "dns", "place": None}, {"key": "b", "status": "dnf", "place": None},
            {"key": "c", "status": "finished", "place": 7}, {"key": "d", "status": "finished", "place": 2}]
    assert best_club(rows, {"a", "b", "c"}) == "c"
    assert best_club(rows, {"a", "b"}) == "b"
    assert best_club(rows, {"a"}) is None


def test_metrics_without_a_value_stay_out():
    rows = [{"wins": 0, "podiums": 2, "poles": 0, "avg_grid": None, "avg_finish": 4.5, "gained": 0},
            {"wins": 1, "podiums": 0, "poles": 0, "avg_grid": None, "avg_finish": None, "gained": None}]
    assert present_metrics(rows) == ["wins", "podiums", "avg_finish"]
    assert present_metrics([]) == []
