"""Umgekehrte Startaufstellung je Lauf (#1960, Ergänzung des Obmanns) - ohne Datenbank, nur erfundene Namen.

- ``reverse_qualifying``: Startaufstellung in umgekehrter Reihenfolge des Haupt-Qualifyings derselben Runde,
  ``reverse_previous_session``: umgekehrtes Ergebnis des Laufs davor; beide mit ``reverse_top`` (nur die ersten N).
- Ohne gültigen Platz (DNS, DSQ, ohne Platz) hinten; ein Startplatz von Hand bleibt.
- Pole: bleibt beim Schnellsten des Qualifyings; ein umgekehrter Lauf hat keine Pole. Der Bonus zählt am ersten
  Rennen mit Startplatz aus dem Qualifying, ohne ein solches am Qualifying selbst.
- Alte Vorgaben ohne das neue Feld bleiben unverändert.
"""
import pytest

from services import race_weekend

PEOPLE = [{"id": f"p{number}", "name": f"Probe Fahrer {number}"} for number in range(1, 11)]


def _format(*sessions):
    return race_weekend.normalize_weekend({"formats": [{"sessions": list(sessions)}]})


def _rounds(*items):
    return [{"id": rid, "code": "R1", "session": session, "order": index, "status": "scored", "counts": counts}
            for index, (rid, session, counts) in enumerate(items, start=1)]


def _sheet(order, **extra_by_pid):
    """``order``: Kennungen in Platz-Reihenfolge; ``extra_by_pid``: Felder je Zeile (etwa Marken oder Startplatz)."""
    return {"rows": [{"participant_id": pid, "place": place, "marks": [], **extra_by_pid.get(pid, {})}
                     for place, pid in enumerate(order, start=1)]}


def _grid(snapshots, round_id):
    drivers = [snap for snap in snapshots if snap["scope"] == "drivers"][-1]
    return {row["participant_id"]: item.get("grid") for row in drivers["rows"] for item in row["results"]
            if item["round_id"] == round_id}


def _marks(snapshots, round_id):
    drivers = [snap for snap in snapshots if snap["scope"] == "drivers"][-1]
    return {row["participant_id"]: item["marks"] for row in drivers["rows"] for item in row["results"]
            if item["round_id"] == round_id and item["marks"]}


def _points(snapshots):
    drivers = [snap for snap in snapshots if snap["scope"] == "drivers"][-1]
    return {row["participant_id"]: row["points"] for row in drivers["rows"]}


QUALI = [f"p{number}" for number in range(1, 11)]  # Quali: p1 auf P1 … p10 auf P10


def test_the_whole_qualifying_reversed():
    weekend = _format({"label": "Qualifying"}, {"label": "Sprint", "grid": "reverse_qualifying"})
    rounds = _rounds(("q", "Qualifying", False), ("s", "Sprint", True))
    sheets = {"q": _sheet(QUALI[:4]), "s": _sheet(["p2", "p1", "p4", "p3"])}
    snaps = race_weekend.standings(rules={"points_by_place": [10, 6, 4, 3]}, rounds=rounds, sheets=sheets,
                                   participants=PEOPLE, weekend=weekend)
    assert _grid(snaps, "s") == {"p4": 1, "p3": 2, "p2": 3, "p1": 4}


def test_only_the_top_eight_are_reversed():
    weekend = _format({"label": "Qualifying"}, {"label": "Sprint", "grid": "reverse_qualifying", "reverse_top": 8})
    rounds = _rounds(("q", "Qualifying", False), ("s", "Sprint", True))
    sheets = {"q": _sheet(QUALI), "s": _sheet(QUALI)}
    snaps = race_weekend.standings(rules={"points_by_place": [10, 6, 4]}, rounds=rounds, sheets=sheets,
                                   participants=PEOPLE, weekend=weekend)
    # Quali-P8 startet von 1 … Quali-P1 von 8, ab P9 wie im Qualifying.
    assert _grid(snaps, "s") == {"p8": 1, "p7": 2, "p6": 3, "p5": 4, "p4": 5, "p3": 6, "p2": 7, "p1": 8, "p9": 9,
                                 "p10": 10}


def test_without_a_valid_qualifying_place_at_the_back_and_a_grid_by_hand_stays():
    weekend = _format({"label": "Qualifying"}, {"label": "Sprint", "grid": "reverse_qualifying"})
    rounds = _rounds(("q", "Qualifying", False), ("s", "Sprint", True))
    sheets = {
        # p2 disqualifiziert, p5 nicht gestartet (ohne Platz).
        "q": {"rows": [{"participant_id": "p1", "place": 1, "marks": []},
                       {"participant_id": "p2", "place": 2, "marks": ["dsq"]},
                       {"participant_id": "p3", "place": 3, "marks": []},
                       {"participant_id": "p4", "place": 4, "marks": []},
                       {"participant_id": "p5", "place": None, "marks": ["dns"]}]},
        # p3 startet nach einer Strafe von 5 - eingetragen, das bleibt.
        "s": _sheet(["p1", "p2", "p3", "p4", "p5"], p3={"grid": 5}),
    }
    snaps = race_weekend.standings(rules={"points_by_place": [10, 6, 4]}, rounds=rounds, sheets=sheets,
                                   participants=PEOPLE, weekend=weekend)
    assert _grid(snaps, "s") == {"p4": 1, "p3": 5, "p1": 3, "p2": 4, "p5": 5}


def test_the_previous_session_reversed_with_top_n():
    weekend = _format({"label": "Hauptrennen", "grid": "manual"},
                      {"label": "Sprint", "offset": 60, "grid": "reverse_previous_session", "reverse_top": 2})
    rounds = _rounds(("f", "Hauptrennen", True), ("s", "Sprint", True))
    sheets = {"f": _sheet(["p3", "p1", "p2"]), "s": _sheet(["p1", "p2", "p3"])}
    snaps = race_weekend.standings(rules={"points_by_place": [10, 6, 4]}, rounds=rounds, sheets=sheets,
                                   participants=PEOPLE, weekend=weekend)
    assert _grid(snaps, "s") == {"p1": 1, "p3": 2, "p2": 3}


def test_a_reversed_session_has_no_pole_and_the_bonus_stays_at_the_race_from_qualifying():
    weekend = _format({"label": "Qualifying"}, {"label": "Sprint", "offset": 30, "grid": "reverse_qualifying"},
                      {"label": "Hauptrennen", "offset": 60, "grid": "qualifying"})
    rounds = _rounds(("q", "Qualifying", False), ("s", "Sprint", True), ("f", "Hauptrennen", True))
    sheets = {"q": _sheet(["p1", "p2", "p3"], p1={"marks": ["pole"]}),
              # Eine Pole-Marke von Hand im umgekehrten Sprint zählt nicht.
              "s": _sheet(["p3", "p2", "p1"], p3={"marks": ["pole"]}),
              "f": _sheet(["p2", "p1", "p3"])}
    snaps = race_weekend.standings(rules={"points_by_place": [10, 6, 4], "bonuses": {"pole": {"points": 2}}},
                                   rounds=rounds, sheets=sheets, participants=PEOPLE, weekend=weekend)
    assert _grid(snaps, "s") == {"p3": 1, "p2": 2, "p1": 3}
    assert _marks(snaps, "s") == {}
    assert _marks(snaps, "f") == {"p1": ["pole"]}
    assert _points(snaps) == {"p2": 16, "p1": 12, "p3": 14}


def test_without_a_race_from_qualifying_the_pole_bonus_stays_at_the_qualifying():
    weekend = _format({"label": "Qualifying"}, {"label": "Sprint", "offset": 30, "grid": "reverse_qualifying"},
                      {"label": "Hauptrennen", "offset": 60, "grid": "reverse_previous_session"})
    rounds = _rounds(("q", "Qualifying", False), ("s", "Sprint", True), ("f", "Hauptrennen", True))
    sheets = {"q": _sheet(["p1", "p2", "p3"]), "s": _sheet(["p3", "p2", "p1"]), "f": _sheet(["p2", "p1", "p3"])}
    rules = {"points_by_place": [10, 6, 4], "bonuses": {"pole": {"points": 2}}}
    snaps = race_weekend.standings(rules=rules, rounds=rounds, sheets=sheets, participants=PEOPLE, weekend=weekend)
    # Hauptrennen aus dem umgekehrten Sprint: p1 (Sprint-P3) startet vorn.
    assert _grid(snaps, "f") == {"p1": 1, "p2": 2, "p3": 3}
    assert _marks(snaps, "s") == {} and _marks(snaps, "f") == {}
    assert _marks(snaps, "q") == {"p1": ["pole"]}
    # p1: 4 + 6 + 2 (Pole am Qualifying); kein Platz aus dem Qualifying zählt mit.
    assert _points(snaps) == {"p1": 12, "p2": 16, "p3": 14}
    drivers = [snap for snap in snaps if snap["scope"] == "drivers"][-1]
    assert next(row for row in drivers["rows"] if row["participant_id"] == "p1")["wins"] == 0
    # Ohne Pole-Bonus der Saison bleibt das Qualifying draußen.
    plain = race_weekend.standings(rules={"points_by_place": [10, 6, 4]}, rounds=rounds, sheets=sheets,
                                   participants=PEOPLE, weekend=weekend)
    assert "q" not in {snap["round_id"] for snap in plain}
    assert _points(plain) == {"p1": 10, "p2": 16, "p3": 14}


def test_old_formats_without_the_new_field_stay_unchanged_and_the_field_is_checked():
    old = {"formats": [{"from_round": 1, "sessions": [{"label": "Rennen", "grid": "reverse_standings"}]}]}
    session = race_weekend.normalize_weekend(old)["formats"][0]["sessions"][0]
    assert "reverse_top" not in session and session["grid"] == "reverse_standings_before_round"
    top = race_weekend.normalize_weekend({"formats": [{"sessions": [
        {"label": "Sprint", "grid": "reverse_qualifying", "reverse_top": "8"}]}]})
    assert top["formats"][0]["sessions"][0]["reverse_top"] == 8
    for broken in ({"grid": "reverse_qualifying", "reverse_top": 0}, {"grid": "manual", "reverse_top": 8},
                   {"grid": "reverse_previous_session", "reverse_top": 2.5}):
        with pytest.raises(ValueError):
            race_weekend.normalize_weekend({"formats": [{"sessions": [{"label": "Sprint", **broken}]}]})


def test_a_reversed_session_clears_a_pole_mark_while_entering():
    rows = [{"participant_id": "p3", "place": 1, "marks": ["pole"], "index": 0},
            {"participant_id": "p1", "place": 2, "marks": [], "index": 1}]
    warnings = race_weekend.clear_reverse_pole(rows)
    assert rows[0]["marks"] == [] and warnings[0]["code"] == "pole_moved" and warnings[0]["rows"] == [0]
    weekend = _format({"label": "Qualifying"}, {"label": "Sprint", "offset": 30, "grid": "reverse_qualifying"},
                      {"label": "Hauptrennen", "offset": 60})
    rounds = _rounds(("q", "Qualifying", False), ("s", "Sprint", True), ("f", "Hauptrennen", True))
    series = {"weekend": weekend}
    assert race_weekend.reversed_grid(series, rounds, rounds[1]) is True
    assert race_weekend.reversed_grid(series, rounds, rounds[2]) is False
