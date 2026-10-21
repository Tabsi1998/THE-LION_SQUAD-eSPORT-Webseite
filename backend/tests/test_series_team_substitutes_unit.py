"""Ersatzfahrer und aktuelle Besetzung in der Teamwertung (#1960, Abgleich mit einer echten Rennliga) - ohne Datenbank,
nur erfundene Namen.

- Ein Ersatz-Einsatz (``team_scoring.no_team_names``, Vorgabe „Ersatzfahrer“) zählt für kein Team, auch nicht fürs
  Stammteam, und steht nicht als eigene Zeile in der Teamwertung. Was im Feld steht, zählt: ein leeres Team heißt kein
  Team (das Stammteam wird beim Eintragen sichtbar vorbelegt, Altdaten füllt Migration 10).
- ``current_lineup``: die Zellen je Rennen bleiben beim gefahrenen Team; Gesamt und Platz sind die Saisonpunkte der
  Fahrer, deren aktuelles Team es ist (Team der letzten Fahrt, die kein Ersatz war) - samt ihrer Ersatz-Einsätze.
"""
import pytest

from services.scoring_rules import normalize_rules
from services.series_standings import compute_standings

SCHEME = [10, 6, 4, 3, 2, 1]


def _rules(**team):
    return normalize_rules({"points_by_place": SCHEME, "tiebreakers": ["countback"], "dnf_points": 0,
                            "team_scoring": {"enabled": True, **team}})


def _round(number):
    return {"id": f"r{number}", "order": number, "status": "scored", "counts": True,
            "club_day": f"2026-03-{number:02d}"}


def _sheet(*rows):
    """``("anna", "Team")`` oder ``("anna", None)`` (ohne Team der Zeile), dazu optional Marken."""
    return {"rows": [{"participant_id": pid, "place": place, "team": team, "marks": list(marks)}
                     for place, (pid, team, *marks) in enumerate(rows, start=1)]}


def _teams(snapshots, round_id=None):
    chosen = [snap for snap in snapshots if snap["scope"] == "teams" and (round_id is None or snap["round_id"] == round_id)]
    return chosen[-1]["rows"]


def _cells(row):
    return {item["round_id"]: item["points"] for item in row["round_points"]}


# ---------------------------------------------------------------- Ersatzfahrer
SINGAPUR = [
    {"id": "chris", "name": "Chris Probe", "default_team": "Turbo Probe"},
    {"id": "matti", "name": "Matti Probe", "default_team": "Turbo Probe"},
    {"id": "lina", "name": "Lina Probe", "default_team": "Löwen Probe"},
    {"id": "emil", "name": "Emil Probe", "default_team": "Eisbrecher Probe"},
]


def test_a_regular_driver_as_substitute_counts_for_no_team():
    """Wie Singapur: der Stammfahrer fährt als Ersatzfahrer, sein Teamkollege fällt aus - das Team bekommt 0, und eine
    Zeile „Ersatzfahrer“ gibt es nicht. Die Fahrerwertung bleibt, wie sie war."""
    sheets = {"r1": _sheet(("lina", "Löwen Probe"), ("emil", "Eisbrecher Probe"), ("chris", "Ersatzfahrer"),
                           ("matti", "Turbo Probe", "dnf"))}
    snaps = compute_standings(rules=_rules(), rounds=[_round(1)], sheets=sheets, participants=SINGAPUR)
    teams = _teams(snaps)
    assert [(row["team"], row["points"]) for row in teams] == [
        ("Löwen Probe", 10), ("Eisbrecher Probe", 6), ("Turbo Probe", 0)]
    drivers = {row["participant_id"]: row for row in [snap for snap in snaps if snap["scope"] == "drivers"][-1]["rows"]}
    assert drivers["chris"]["points"] == 4 and drivers["chris"]["results"][0]["team"] == "Ersatzfahrer"
    # Groß/klein egal, und die Liste ist je Saison einstellbar.
    sheets["r1"]["rows"][2]["team"] = "ERSATZFAHRER"
    assert "ERSATZFAHRER" not in {row["team"] for row in _teams(compute_standings(
        rules=_rules(), rounds=[_round(1)], sheets=sheets, participants=SINGAPUR))}
    reserve = compute_standings(rules=_rules(no_team_names=["Reserve"]), rounds=[_round(1)], sheets=sheets,
                                participants=SINGAPUR)
    assert {row["team"]: row["points"] for row in _teams(reserve)}["ERSATZFAHRER"] == 4


def test_an_empty_team_field_counts_for_no_team_not_the_regular_team():
    """Entscheidung zu #1960: was im Feld steht, zählt. Ein leeres Team heißt kein Team - auch mit Stammteam; die
    Fahrerwertung bleibt."""
    sheets = {"r1": _sheet(("chris", None), ("matti", "Turbo Probe"), ("lina", ""))}
    snaps = compute_standings(rules=_rules(), rounds=[_round(1)], sheets=sheets, participants=SINGAPUR)
    assert [(row["team"], row["points"], row["driver_ids"]) for row in _teams(snaps)] == [("Turbo Probe", 6, ["matti"])]
    drivers = {row["participant_id"]: row["points"] for row in
               [snap for snap in snaps if snap["scope"] == "drivers"][-1]["rows"]}
    assert drivers == {"chris": 10, "matti": 6, "lina": 4}
    # Aktuelle Besetzung: die Fahrt ohne Team zählt in keiner Zelle.
    lineup = _teams(compute_standings(rules=_rules(mode="current_lineup"), rounds=[_round(1)], sheets=sheets,
                                      participants=SINGAPUR))
    assert {row["team"]: row["round_points"][0]["driver_ids"] for row in lineup if row["round_points"]} == {
        "Turbo Probe": ["matti"]}


def test_no_team_names_are_a_season_setting():
    assert normalize_rules({})["team_scoring"]["no_team_names"] == ["Ersatzfahrer"]
    assert normalize_rules({"team_scoring": {"no_team_names": [" Reserve ", "reserve", "Ersatz"]}})[
        "team_scoring"]["no_team_names"] == ["Reserve", "Ersatz"]
    assert normalize_rules({"team_scoring": {"no_team_names": []}})["team_scoring"]["no_team_names"] == []
    with pytest.raises(ValueError):
        normalize_rules({"team_scoring": {"no_team_names": "Ersatzfahrer"}})


# ---------------------------------------------------------------- aktuelle Besetzung wie beim Veranstalter
LINEUP = [
    {"id": "a1", "name": "Alt Eins", "default_team": "Alt Racing"},
    {"id": "a2", "name": "Alt Zwei", "default_team": "Alt Racing"},
    {"id": "s1", "name": "Stamm Eins", "default_team": "Stamm GP"},
    {"id": "s2", "name": "Stamm Zwei", "default_team": "Stamm GP"},
    {"id": "n1", "name": "Neu Eins", "default_team": None},
]


def test_the_current_lineup_totals_like_the_organizer_while_cells_stay_per_race():
    """Ein Team löst sich auf (Alt Racing behält nur a2), ein neues übernimmt a1 samt Saisonpunkten (Neu Racing), s1
    fährt R2 als Ersatz - seine Punkte zählen zum Gesamt seines Teams, in keiner Zelle - und Neu Racing hat −5."""
    rounds = [_round(1), _round(2), _round(3)]
    sheets = {
        "r1": _sheet(("a1", "Alt Racing"), ("a2", "Alt Racing"), ("s1", "Stamm GP"), ("s2", "Stamm GP")),
        "r2": _sheet(("a1", "Neu Racing"), ("a2", "Alt Racing"), ("s1", "Ersatzfahrer"), ("s2", "Stamm GP")),
        "r3": _sheet(("a1", "Neu Racing"), ("n1", "Neu Racing"), ("s2", "Stamm GP")),
    }
    adjustments = [{"id": "t1", "kind": "team", "team": "Neu Racing", "points": -5, "reason": "Regelverstoß",
                    "day": "2026-03-03", "round_id": None}]
    snaps = compute_standings(rules=_rules(mode="current_lineup"), rounds=rounds, sheets=sheets, participants=LINEUP,
                              adjustments=adjustments)
    teams = {row["team"]: row for row in _teams(snaps)}
    # Gesamt: Neu = a1 30 + n1 6 − 5; Stamm = s1 8 (samt Ersatz) + s2 10; Alt = a2 12 (a1 ist weg).
    assert [(row["team"], row["rank"], row["points"]) for row in _teams(snaps)] == [
        ("Neu Racing", 1, 31), ("Stamm GP", 2, 18), ("Alt Racing", 3, 12)]
    # Die Zellen: je Rennen das gefahrene Team; Ersatz für niemanden; ohne Fahrt keine Zelle („–“).
    assert _cells(teams["Alt Racing"]) == {"r1": 16, "r2": 6}
    assert _cells(teams["Neu Racing"]) == {"r2": 10, "r3": 16}
    assert _cells(teams["Stamm GP"]) == {"r1": 7, "r2": 3, "r3": 4}
    assert teams["Stamm GP"]["driver_ids"] == ["s2", "s1"] and "Ersatzfahrer" not in teams
    assert teams["Neu Racing"]["adjustment_points"] == -5


def test_the_current_team_is_the_last_team_ride_never_a_substitute_ride():
    """R1 Ersatz, R2 Team A, R3 Ersatz, R4 Team B: nach R3 zählt der Fahrer (samt Ersatz-Rennen) für A, nach R4 für B;
    die Zellen nur R2 für A und R4 für B."""
    people = [{"id": "x", "name": "Wechsel Probe", "default_team": "Team C"},
              {"id": "y", "name": "Treu Probe", "default_team": "Team A"}]
    sheets = {
        "r1": _sheet(("x", "Ersatzfahrer"), ("y", "Team A")),
        "r2": _sheet(("x", "Team A"), ("y", "Team A")),
        "r3": _sheet(("x", "Ersatzfahrer"), ("y", "Team A")),
        "r4": _sheet(("x", "Team B"), ("y", "Team A")),
    }
    snaps = compute_standings(rules=_rules(mode="current_lineup"), rounds=[_round(n) for n in range(1, 5)],
                              sheets=sheets, participants=people)
    first = {row["team"]: row for row in _teams(snaps, "r1")}
    # Nur Ersatz gefahren: das Stammteam gilt.
    assert (first["Team C"]["points"], first["Team C"]["round_points"]) == (10, [])
    third = {row["team"]: row for row in _teams(snaps, "r3")}
    assert (third["Team A"]["points"], _cells(third["Team A"])) == (48, {"r1": 6, "r2": 16, "r3": 6})
    assert "Team C" not in third
    fourth = {row["team"]: row for row in _teams(snaps, "r4")}
    assert (fourth["Team B"]["points"], _cells(fourth["Team B"])) == (40, {"r4": 10})
    assert (fourth["Team A"]["points"], _cells(fourth["Team A"])) == (24, {"r1": 6, "r2": 16, "r3": 6, "r4": 6})
