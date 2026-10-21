"""Zwei Rennligen mit Punkten je Lauf (#1930, Zusatz des Obmanns): die F1-Liga mit Shootout, Sprint (12-9-7 …),
Qualifying und Rennen (35-30-26 …), keine Punkte trotz DNF und kein Bonus für die schnellste Runde; die F2-Liga mit
Qualifying (P1 = 2 Punkte, zählt), Sprint wie das Rennen und Rennen. Die gemeinsamen Fälle stehen in
``frontend/src/lib/raceWeekendLeagues.json`` - das Web rechnet daraus die Tabellen je Lauf nach. Nur erfundene Namen."""
import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import race_weekend  # noqa: E402

CASES = json.loads((pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib"
                    / "raceWeekendLeagues.json").read_text(encoding="utf-8"))
PEOPLE = CASES["people"]


def _league(league: dict):
    weekend = race_weekend.normalize_weekend(league["weekend"])
    rounds = [{**item, "order": index, "status": "scored"} for index, item in enumerate(league["rounds"], start=1)]
    # Die Wertung jedes Termins kommt aus der Vorgabe - so wie die Terminliste sie anlegt.
    plan = race_weekend.round_plan(rounds, weekend)
    for item in rounds:
        assert item["counts"] == plan[item["id"]]["config"]["counts"], item["id"]
    sheets = {rid: {"rows": [{"participant_id": pid, "place": place, "marks": marks} for pid, place, marks in rows]}
              for rid, rows in league["sheets"].items()}
    snapshots = race_weekend.standings(rules=league["rules"], rounds=rounds, sheets=sheets, participants=PEOPLE,
                                       weekend=weekend)
    return [snap for snap in snapshots if snap["scope"] == "drivers"][-1]


@pytest.mark.parametrize("league", CASES["leagues"], ids=[item["name"] for item in CASES["leagues"]])
def test_points_per_session_and_totals_match_the_organizer(league):
    standing = _league(league)
    expected = league["expected"]
    results = {row["participant_id"]: {item["round_id"]: item for item in row["results"]} for row in standing["rows"]}
    for round_id, points in expected["points"].items():
        assert {pid: results[pid][round_id]["points"] for pid in points} == points, round_id
    for round_id, grid in expected["grid"].items():
        assert {pid: results[pid][round_id].get("grid") for pid in grid} == grid, round_id
    # Die Pole gibt es nur aus dem Qualifying fürs Rennen - ein Shootout setzt nur den Startplatz des Sprints.
    for round_id in expected["points"]:
        holders = [other for other in results if "pole" in results[other].get(round_id, {}).get("marks", [])]
        assert holders == ([expected["poles"][round_id]] if round_id in expected["poles"] else []), round_id
    assert [[row["participant_id"], row["points"]] for row in standing["rows"]] == expected["totals"]


def test_a_qualifying_with_its_own_list_counts_and_one_without_does_not():
    weekend = race_weekend.normalize_weekend({"formats": [{"sessions": [
        {"label": "Qualifying", "points": [2]}, {"label": "Shootout"}, {"label": "Sprint", "points": "series"}]}]})
    sessions = {item["label"]: item for item in weekend["formats"][0]["sessions"]}
    assert (sessions["Qualifying"]["counts"], sessions["Shootout"]["counts"], sessions["Sprint"]["counts"]) == (
        True, False, True)
    assert race_weekend.session_kind("Shootout") == "qualifying"
    assert not race_weekend.is_main_qualifying("Shootout") and race_weekend.is_main_qualifying("Blitz-Qualifying")


def test_dnf_points_and_the_fastest_lap_bonus_can_differ_per_session():
    from services.scoring_rules import normalize_rules, result_points

    rules = normalize_rules({"points_by_place": [25, 18, 15], "dnf_points": 0,
                             "bonuses": {"fastest_lap": {"points": 1}}})
    sprint = race_weekend.round_rules(rules, {"points": "series", "dnf": "place", "fastest_lap": 0})
    race = race_weekend.round_rules(rules, {"points": "series", "dnf": "series", "fastest_lap": None})
    row = {"participant_id": "anna", "place": 2, "marks": ["dnf", "fastest_lap"]}
    assert result_points(row, sprint)["points"] == 18
    assert result_points(row, race)["points"] == 1
    assert race is rules
    with pytest.raises(ValueError):
        race_weekend.normalize_weekend({"formats": [{"sessions": [{"label": "Sprint", "dnf": "maybe"}]}]})
    with pytest.raises(ValueError):
        race_weekend.normalize_weekend({"formats": [{"sessions": [{"label": "Sprint", "fastest_lap": -1}]}]})
