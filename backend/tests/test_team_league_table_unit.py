"""Prüfung #1931, Punkt 2: Tabelle laut Veranstalter plus übrige Spiele. Steht ein Team in den Spielen anders
geschrieben als in der Tabelle des Veranstalters, entsteht keine zweite Zeile, und die offiziellen Plätze bleiben -
unklare Fälle nennt die Prüfung des Blatts. Nur erfundene Teamnamen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.scoring_rules import normalize_rules  # noqa: E402
from services.series_results import check, resolve  # noqa: E402
from services.series_standings import compute_standings  # noqa: E402
from services.team_names import align_to_table  # noqa: E402

OWN = [{"name": "Lions Black", "aliases": []}]
ROUNDS = [{"id": "r1", "order": 1, "status": "scored", "counts": True}]
TABLE = [
    {"team": "Lions Black", "rank": 1, "played": 1, "won": 1, "drawn": 0, "lost": 0, "points": 3},
    {"team": "Gegner B", "rank": 2, "played": 1, "won": 0, "drawn": 1, "lost": 0, "points": 1},
    {"team": "Gegner C", "rank": 3, "played": 1, "won": 0, "drawn": 1, "lost": 0, "points": 1},
    {"team": "Gegner A", "rank": 4, "played": 1, "won": 0, "drawn": 0, "lost": 1, "points": 0},
]


def _table(matches, table=TABLE):
    snapshots = compute_standings(rules={}, rounds=ROUNDS, sheets={"r1": {"matches": matches, "official_table": table}},
                                  participants=[], own_teams=OWN)
    return [snap for snap in snapshots if snap["scope"] == "table"][-1]["rows"]


def test_another_spelling_in_the_matches_adds_no_row_and_keeps_the_official_ranks():
    rows = _table([
        {"home": "Lions Black", "away": "Gegner A", "home_score": 2, "away_score": 0},
        {"home": "Gegner B e.V.", "away": "Gegner C", "home_score": 1, "away_score": 1},
    ])
    assert [(row["rank"], row["team"], row["played"], row["points"]) for row in rows] == [
        (1, "Lions Black", 1, 3), (2, "Gegner B", 1, 1), (3, "Gegner C", 1, 1), (4, "Gegner A", 1, 0)]
    # Das Spiel von „Gegner B e.V.“ zählt in der gerechneten Spalte für „Gegner B“.
    assert next(row for row in rows if row["team"] == "Gegner B")["computed_points"] == 1


def test_a_team_that_fits_no_table_row_adds_no_row_either():
    rows = _table([
        {"home": "Lions Black", "away": "Gegner A", "home_score": 2, "away_score": 0},
        {"home": "Ganz Anders", "away": "Gegner C", "home_score": 1, "away_score": 1},
    ])
    assert [row["team"] for row in rows] == ["Lions Black", "Gegner B", "Gegner C", "Gegner A"]
    assert [row["rank"] for row in rows] == [1, 2, 3, 4]


def test_official_ranks_are_never_recomputed_rows_without_rank_follow_after():
    table = [{**TABLE[0], "rank": 2}, {**TABLE[1], "rank": 1}, {**TABLE[2], "rank": None}, {**TABLE[3], "rank": None}]
    rows = _table([{"home": "Lions Black", "away": "Gegner A", "home_score": 2, "away_score": 0}], table)
    assert [(row["rank"], row["team"]) for row in rows] == [(1, "Gegner B"), (2, "Lions Black"), (3, "Gegner C"),
                                                             (4, "Gegner A")]


def test_alignment_maps_only_clear_spellings():
    mapping, unclear = align_to_table(["Gegner B e.V.", "gegner-c", "Gegner", "Fremd Team"],
                                      ["Gegner B", "Gegner C", "Gegner A"])
    assert mapping == {"Gegner B e.V.": "Gegner B", "gegner-c": "Gegner C"}
    assert unclear == ["Gegner", "Fremd Team"]


def test_the_sheet_check_names_teams_that_fit_no_table_row():
    rules = normalize_rules({"points_mode": "organizer"})
    out = resolve({"matches": [
        {"home": "Lions Black", "away": "Gegner A", "home_score": 2, "away_score": 0},
        {"home": "Gegner B e.V.", "away": "Ganz Anders", "home_score": 1, "away_score": 1},
    ], "official_table": TABLE}, [], rules)
    check(out, rules, {"id": "r1", "status": "planned"}, "2026-11-01", OWN)
    unknown = [item for item in out.warnings if item["code"] == "table_team_unknown"]
    assert [item["message"] for item in unknown] == [
        "„Ganz Anders“ aus den Spielen passt zu keinem Team der Tabelle laut Veranstalter - es bekommt keine eigene "
        "Zeile. Bitte die Schreibweise angleichen."]
