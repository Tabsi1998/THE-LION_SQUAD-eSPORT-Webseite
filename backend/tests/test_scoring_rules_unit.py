"""Rechenregeln externer Serien (#1741): Punkte je Platz, Boni, Ausfall, beste N / Streichergebnisse, Sieg/Remis/
Niederlage und der Wettbewerbsrang mit geteilten Plätzen. Ohne Datenbank, nur feste Tabellen mit erfundenen Werten."""
import pytest

from services import competition_standings
from services.scoring_rules import (
    counted_results,
    league_table,
    match_points,
    normalize_rules,
    place_points,
    rank_with_ties,
    result_points,
    validate_sheet,
)

F1 = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]


def rules(**overrides):
    return normalize_rules({"points_by_place": F1, **overrides})


# ---------------------------------------------------------------- Punkte je Platz und Boni
def test_points_follow_the_scheme_and_places_beyond_it_score_nothing():
    assert [place_points(place, F1) for place in (1, 2, 10, 11, None)] == [25, 18, 1, 0, 0]


def test_fastest_lap_bonus_only_counts_up_to_the_configured_place():
    with_bonus = rules(bonuses={"fastest_lap": {"points": 1, "max_place": 10}})
    assert result_points({"place": 3, "marks": ["fastest_lap"]}, with_bonus)["points"] == 16
    assert result_points({"place": 12, "marks": ["fastest_lap"]}, with_bonus)["points"] == 0
    # Ohne Grenze zählt der Bonus auf jedem Platz.
    open_bonus = rules(bonuses={"fastest_lap": {"points": 2, "max_place": None}})
    assert result_points({"place": 12, "marks": ["fastest_lap"]}, open_bonus)["points"] == 2


def test_retirement_scores_fixed_points_or_the_place_when_configured():
    fixed = rules(dnf_points=1)
    assert result_points({"place": 4, "marks": ["dnf"]}, fixed)["points"] == 1
    by_place = rules(dnf_points=None)
    assert result_points({"place": 4, "marks": ["dnf"]}, by_place)["points"] == 12


def test_no_start_and_disqualification_get_their_own_points_and_no_bonus():
    configured = rules(dns_points=0, dsq_points=0, bonuses={"fastest_lap": {"points": 1, "max_place": None}})
    assert result_points({"place": 1, "marks": ["dns", "fastest_lap"]}, configured)["points"] == 0
    assert result_points({"place": 1, "marks": ["dsq", "fastest_lap"]}, configured)["points"] == 0
    assert result_points({"place": 1, "marks": ["dns"]}, configured)["participated"] is False
    assert result_points({"place": 1, "marks": ["dsq"]}, configured)["participated"] is True


def test_penalty_points_are_subtracted_and_the_source_is_named():
    scored = result_points({"place": 2, "penalty_points": 5}, rules())
    assert (scored["points"], scored["base"], scored["penalty"], scored["source"]) == (13, 18, 5, "scheme")


def test_negative_penalty_points_never_raise_the_score():
    scored = result_points({"place": 2, "penalty_points": -5}, rules())
    assert (scored["points"], scored["penalty"]) == (18, 0)


def test_a_sheet_with_negative_penalty_points_is_refused():
    with pytest.raises(ValueError, match="Strafpunkte"):
        validate_sheet({"rows": [{"participant_id": "anna", "place": 1, "penalty_points": -2}]}, "r1")
    validate_sheet({"rows": [{"participant_id": "anna", "place": 1, "penalty_points": 2}]}, "r1")


def test_a_sheet_naming_a_participant_twice_is_refused():
    twice = {"rows": [{"participant_id": "anna", "place": 1}, {"participant_id": "bert", "place": 2},
                      {"participant_id": "anna", "place": 3}]}
    with pytest.raises(ValueError, match="anna.*mehrfach"):
        validate_sheet(twice, "r1")


def test_organizer_points_and_manual_points_are_taken_as_entered():
    organizer = rules(points_mode="organizer")
    assert result_points({"place": 1, "points": 7.5}, organizer) == {
        "points": 7.5, "base": 7.5, "bonus": 0, "penalty": 0, "source": "organizer", "participated": True}
    manual = result_points({"place": 1, "points": 3, "points_source": "manual"}, rules())
    assert (manual["points"], manual["source"]) == (3, "manual")


# ---------------------------------------------------------------- Regeln normalisieren
def test_missing_rules_get_sensible_defaults():
    filled = normalize_rules({})
    assert filled["points_mode"] == "scheme" and filled["points_by_place"] == F1
    assert filled["count_mode"] == "all" and filled["match_points"] == {"win": 3, "draw": 1, "loss": 0}
    assert filled["team_scoring"]["guests_count"] is True


@pytest.mark.parametrize("broken", [
    {"points_mode": "lotterie"},
    {"count_mode": "best_n", "count_n": 0},
    {"count_mode": "drop_n", "count_n": -1},
    {"tiebreakers": ["zufall"]},
    {"points_by_place": [25, "viel"]},
    {"activity_points": {"points": 1, "from_round": 0}},
])
def test_invalid_rules_are_rejected(broken):
    with pytest.raises(ValueError):
        normalize_rules(broken)


# ---------------------------------------------------------------- Rang mit geteilten Plätzen
def test_equal_rows_share_a_rank_and_the_next_rank_is_skipped():
    rows = [{"id": "a", "points": 10}, {"id": "b", "points": 12}, {"id": "c", "points": 10}, {"id": "d", "points": 3}]
    rank_with_ties(rows, lambda row: row["points"])
    assert [(row["id"], row["rank"]) for row in rows] == [("b", 1), ("a", 2), ("c", 2), ("d", 4)]


def test_the_old_name_in_competition_standings_still_ranks():
    rows = [{"id": "a", "points": 1}, {"id": "b", "points": 1}]
    competition_standings._rank_with_ties(rows, lambda row: row["points"])
    assert [row["rank"] for row in rows] == [1, 1]


# ---------------------------------------------------------------- beste N und Streichergebnisse
RESULTS = [
    {"round_id": "r1", "seq": 1, "points": 25},
    {"round_id": "r2", "seq": 2, "points": 4},
    {"round_id": "r3", "seq": 3, "points": 18},
]


def test_best_n_counts_everything_while_fewer_results_than_n_exist():
    counted, dropped = counted_results(RESULTS, rules(count_mode="best_n", count_n=5), total_rounds=6)
    assert (counted, dropped) == (["r1", "r2", "r3"], [])


def test_best_n_keeps_the_best_and_names_the_dropped_rounds():
    counted, dropped = counted_results(RESULTS, rules(count_mode="best_n", count_n=2), total_rounds=3)
    assert (counted, dropped) == (["r1", "r3"], ["r2"])


def test_drop_n_counts_the_best_of_all_rounds_minus_n():
    # Vier Runden im Kalender, eine wird gestrichen: drei gefahrene Runden zählen alle.
    assert counted_results(RESULTS, rules(count_mode="drop_n", count_n=1), total_rounds=4) == (["r1", "r2", "r3"], [])
    # Drei Runden im Kalender: die schlechteste fällt.
    assert counted_results(RESULTS, rules(count_mode="drop_n", count_n=1), total_rounds=3) == (["r1", "r3"], ["r2"])


def test_equal_results_drop_the_later_round():
    equal = [{"round_id": "r1", "seq": 1, "points": 10}, {"round_id": "r2", "seq": 2, "points": 10}]
    assert counted_results(equal, rules(count_mode="best_n", count_n=1), total_rounds=2) == (["r1"], ["r2"])


# ---------------------------------------------------------------- Sieg, Unentschieden, Niederlage
def test_match_points_follow_the_configured_values():
    custom = rules(match_points={"win": 2, "draw": 1, "loss": 0})
    assert [match_points(a, b, custom) for a, b in ((3, 1), (2, 2), (0, 4))] == [("win", 2), ("draw", 1), ("loss", 0)]
    assert match_points(1, 0, rules()) == ("win", 3)


def test_league_table_counts_results_and_breaks_ties_by_the_list():
    matches = [
        {"home": "Adler", "away": "Bären", "home_score": 13, "away_score": 7},
        {"home": "Bären", "away": "Cobras", "home_score": 13, "away_score": 11},
        {"home": "Cobras", "away": "Adler", "home_score": 13, "away_score": 12},
    ]
    table = league_table(matches, rules(table_tiebreakers=["score_diff"]))
    # Je ein Sieg, alle 3 Punkte: Adler 25:20, Cobras 24:25, Bären 20:24.
    assert [(row["team"], row["rank"], row["points"], row["won"], row["lost"], row["score_diff"]) for row in table] == [
        ("Adler", 1, 3, 1, 1, 5), ("Cobras", 2, 3, 1, 1, -1), ("Bären", 3, 3, 1, 1, -4)]
    shared = league_table(matches, rules(table_tiebreakers=[]))
    assert [row["rank"] for row in shared] == [1, 1, 1]
