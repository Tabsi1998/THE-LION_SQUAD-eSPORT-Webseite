"""Zwischenstände externer Serien (#1741): je gewerteter Runde ein Stand für Fahrer bzw. Spieler, Teams und die
Tabelle einer Team-Liga - Gleichstand mit Vorrang, weniger Runden als N, Gast im Team, Aktivitätspunkte, offizieller
Wert gegen die Summe, abgesagte Runde und eine Regeländerung, die genau dasselbe wieder ergibt. Nur erfundene Namen."""
import copy
import random

import pytest

from services.scoring_rules import normalize_rules
from services.series_standings import compute_standings

SCHEME = [10, 6, 4, 3, 2, 1]
PARTICIPANTS = [
    {"id": "anna", "name": "Anna Probe", "link": "member", "default_team": "Löwen"},
    {"id": "bert", "name": "Bert Beispiel", "link": "external", "default_team": "Falken"},
    {"id": "gast", "name": "Gina Gast", "link": "guest", "default_team": "Löwen"},
    {"id": "dora", "name": "Dora Dummy", "link": "external", "default_team": "Falken"},
]


def _round(round_id, order, status="scored", counts=True):
    return {"id": round_id, "order": order, "status": status, "counts": counts}


def _rows(*places):
    """``("anna", 1), ("bert", 2, ["dnf"])`` → Ergebnisblatt-Zeilen."""
    return [{"participant_id": item[0], "place": item[1], "marks": list(item[2]) if len(item) > 2 else []} for item in places]


def _rules(**overrides):
    return normalize_rules({"points_by_place": SCHEME, "tiebreakers": ["countback"], **overrides})


def _scope(snapshots, scope, round_id=None):
    chosen = [snap for snap in snapshots if snap["scope"] == scope and (round_id is None or snap["round_id"] == round_id)]
    return chosen[-1]["rows"]


def _table(rows, *fields):
    return [tuple(row[field] for field in fields) for row in rows]


# ---------------------------------------------------------------- Gleichstand und Vorrang
def test_equal_points_are_separated_by_the_tiebreaker_list_and_the_reason_is_kept():
    rounds = [_round("r1", 1), _round("r2", 2)]
    sheets = {"r1": {"rows": _rows(("anna", 1), ("bert", 2))}, "r2": {"rows": _rows(("bert", 1), ("anna", 2))}}
    # Beide 16 Punkte, beide ein Sieg: Vorrang hat das bessere letzte Ergebnis.
    rows = _scope(compute_standings(rules=_rules(tiebreakers=["wins", "latest_result"]), rounds=rounds, sheets=sheets,
                                    participants=PARTICIPANTS), "drivers")
    assert _table(rows, "participant_id", "rank", "points", "tiebreak") == [("bert", 1, 16, None), ("anna", 2, 16, "latest_result")]


def test_without_a_deciding_criterion_the_place_is_shared():
    rounds = [_round("r1", 1), _round("r2", 2)]
    sheets = {"r1": {"rows": _rows(("anna", 1), ("bert", 2))}, "r2": {"rows": _rows(("bert", 1), ("anna", 2))}}
    rows = _scope(compute_standings(rules=_rules(tiebreakers=["countback"]), rounds=rounds, sheets=sheets,
                                    participants=PARTICIPANTS), "drivers")
    assert _table(rows, "participant_id", "rank", "points", "tiebreak") == [("anna", 1, 16, None), ("bert", 1, 16, None)]


# ---------------------------------------------------------------- beste N und Streichergebnisse
def test_fewer_rounds_than_n_count_completely():
    rounds = [_round("r1", 1), _round("r2", 2), _round("r3", 3, status="planned"), _round("r4", 4, status="planned")]
    sheets = {"r1": {"rows": _rows(("anna", 3))}, "r2": {"rows": _rows(("anna", 1))}}
    rows = _scope(compute_standings(rules=_rules(count_mode="best_n", count_n=3), rounds=rounds, sheets=sheets,
                                    participants=PARTICIPANTS), "drivers")
    assert _table(rows, "points", "counted_round_ids", "dropped_round_ids") == [(14, ["r1", "r2"], [])]


def test_drop_n_strikes_the_worst_round_once_the_season_has_more_rounds_than_count():
    rounds = [_round("r1", 1), _round("r2", 2), _round("r3", 3)]
    sheets = {"r1": {"rows": _rows(("anna", 1))}, "r2": {"rows": _rows(("anna", 6))}, "r3": {"rows": _rows(("anna", 2))}}
    rows = _scope(compute_standings(rules=_rules(count_mode="drop_n", count_n=1), rounds=rounds, sheets=sheets,
                                    participants=PARTICIPANTS), "drivers")
    assert _table(rows, "points", "computed_points", "counted_round_ids", "dropped_round_ids") == [(16, 16, ["r1", "r3"], ["r2"])]


# ---------------------------------------------------------------- abgesagte Runde
def test_a_cancelled_round_has_no_standing_scores_nothing_and_does_not_count_as_a_round():
    rounds = [_round("r1", 1), _round("r2", 2, status="cancelled"), _round("r3", 3)]
    sheets = {
        "r1": {"rows": _rows(("anna", 1), ("bert", 2))},
        "r2": {"rows": _rows(("bert", 1), ("anna", 6))},  # vergessenes Blatt einer abgesagten Runde
        "r3": {"rows": _rows(("anna", 6), ("bert", 1))},
    }
    snapshots = compute_standings(rules=_rules(count_mode="drop_n", count_n=1), rounds=rounds, sheets=sheets,
                                  participants=PARTICIPANTS)
    assert [(snap["round_id"], snap["round_seq"]) for snap in snapshots if snap["scope"] == "drivers"] == [("r1", 1), ("r3", 3)]
    # Zwei Runden im Kalender, eine gestrichen: je das bessere Ergebnis zählt. Gleichstand - Bert war einmal Zweiter,
    # Anna nur Sechste.
    assert _table(_scope(snapshots, "drivers"), "participant_id", "rank", "points", "dropped_round_ids") == [
        ("bert", 1, 10, ["r1"]), ("anna", 2, 10, ["r3"])]


def test_a_sheet_with_negative_penalty_points_is_not_scored():
    sheets = {"r1": {"rows": [{"participant_id": "anna", "place": 2, "penalty_points": -4}]}}
    with pytest.raises(ValueError, match="r1"):
        compute_standings(rules=_rules(), rounds=[_round("r1", 1)], sheets=sheets, participants=PARTICIPANTS)


def test_a_sheet_naming_a_participant_twice_is_not_scored():
    # Welche der beiden Zeilen zählt, hinge sonst an der Reihenfolge im Blatt.
    sheets = {"r1": {"rows": _rows(("anna", 1), ("bert", 2), ("anna", 6))}}
    with pytest.raises(ValueError, match="mehrfach"):
        compute_standings(rules=_rules(), rounds=[_round("r1", 1)], sheets=sheets, participants=PARTICIPANTS)


def test_rounds_that_do_not_count_are_left_out():
    rounds = [_round("r1", 1), _round("finale", 2, counts=False)]
    sheets = {"r1": {"rows": _rows(("anna", 2))}, "finale": {"rows": _rows(("anna", 1))}}
    snapshots = compute_standings(rules=_rules(), rounds=rounds, sheets=sheets, participants=PARTICIPANTS)
    assert [snap["round_id"] for snap in snapshots] == ["r1"]


# ---------------------------------------------------------------- Aktivitätspunkte
def test_activity_points_reward_each_round_taken_part_in_from_the_configured_round():
    rounds = [_round("r1", 1), _round("r2", 2), _round("r3", 3)]
    sheets = {"r1": {"rows": _rows(("anna", 6))}, "r2": {"rows": _rows(("anna", 6), ("bert", 1, ["dns"]))},
              "r3": {"rows": _rows(("anna", 6))}}
    rows = _scope(compute_standings(rules=_rules(activity_points={"points": 2, "from_round": 2}), rounds=rounds,
                                    sheets=sheets, participants=PARTICIPANTS), "drivers")
    # Anna: 3 × 1 Punkt + 2 × 2 Aktivität (Runde 2 und 3); Bert trat nicht an.
    assert _table(rows, "participant_id", "points", "activity_points") == [("anna", 7, 4), ("bert", 0, 0)]


# ---------------------------------------------------------------- offizieller Wert gegen Summe
def test_the_official_value_is_taken_over_and_the_deviation_is_marked():
    rounds = [_round("r1", 1)]
    sheets = {"r1": {"rows": _rows(("anna", 1), ("bert", 2)), "official_totals": {"anna": 12}}}
    rows = _scope(compute_standings(rules=_rules(), rounds=rounds, sheets=sheets, participants=PARTICIPANTS), "drivers")
    assert _table(rows, "participant_id", "points", "computed_points", "official_points", "deviation") == [
        ("anna", 12, 10, 12, 2), ("bert", 6, 6, None, None)]


# ---------------------------------------------------------------- Zwischenstand je Runde und Trend
def test_each_scored_round_keeps_its_own_standing_with_the_movement_since_the_last():
    rounds = [_round("r1", 1), _round("r2", 2)]
    sheets = {"r1": {"rows": _rows(("anna", 1), ("bert", 2), ("dora", 3))},
              "r2": {"rows": _rows(("dora", 1), ("bert", 2), ("anna", 6))}}
    snapshots = compute_standings(rules=_rules(), rounds=rounds, sheets=sheets, participants=PARTICIPANTS)
    assert _table(_scope(snapshots, "drivers", "r1"), "participant_id", "rank", "rank_change") == [
        ("anna", 1, None), ("bert", 2, None), ("dora", 3, None)]
    # Dora 14, Bert 12, Anna 11.
    assert _table(_scope(snapshots, "drivers", "r2"), "participant_id", "rank", "points", "rank_change") == [
        ("dora", 1, 14, 2), ("bert", 2, 12, 0), ("anna", 3, 11, -2)]


# ---------------------------------------------------------------- Teamwertung
TEAM_ROUND = {"rows": [
    {"participant_id": "anna", "place": 1, "marks": []},
    {"participant_id": "bert", "place": 2, "marks": []},
    {"participant_id": "gast", "place": 3, "marks": []},
    {"participant_id": "dora", "place": 4, "marks": [], "team": "Löwen"},  # fährt dieses Rennen für die Löwen
]}


def test_the_guest_counts_for_the_team_and_only_the_best_drivers_count():
    rules = _rules(team_scoring={"enabled": True, "counting_drivers": 2, "guests_count": True})
    rows = _scope(compute_standings(rules=rules, rounds=[_round("r1", 1)], sheets={"r1": TEAM_ROUND},
                                    participants=PARTICIPANTS), "teams")
    # Löwen: Anna 10 + Gast 4 (Dora 3 zählt nicht mehr), Falken: Bert 6.
    assert _table(rows, "team", "rank", "points", "driver_ids") == [("Löwen", 1, 14, ["anna", "gast"]), ("Falken", 2, 6, ["bert"])]


def test_without_guests_the_next_driver_of_the_team_counts():
    rules = _rules(team_scoring={"enabled": True, "counting_drivers": 2, "guests_count": False})
    rows = _scope(compute_standings(rules=rules, rounds=[_round("r1", 1)], sheets={"r1": TEAM_ROUND},
                                    participants=PARTICIPANTS), "teams")
    assert _table(rows, "team", "points", "driver_ids") == [("Löwen", 13, ["anna", "dora"]), ("Falken", 6, ["bert"])]


def test_team_scoring_without_any_team_produces_no_empty_team_standing():
    rules = _rules(team_scoring={"enabled": True})
    loners = [{"id": "anna", "name": "Anna Probe", "link": "member"}]
    snapshots = compute_standings(rules=rules, rounds=[_round("r1", 1)], sheets={"r1": {"rows": _rows(("anna", 1))}},
                                  participants=loners)
    assert {snap["scope"] for snap in snapshots} == {"drivers"}


def test_team_scoring_off_produces_no_team_standing():
    snapshots = compute_standings(rules=_rules(), rounds=[_round("r1", 1)], sheets={"r1": TEAM_ROUND}, participants=PARTICIPANTS)
    assert {snap["scope"] for snap in snapshots} == {"drivers"}


# ---------------------------------------------------------------- Team-Liga
def test_team_league_table_uses_win_draw_loss_points_and_the_official_table():
    rounds = [_round("s1", 1), _round("s2", 2)]
    sheets = {
        "s1": {"matches": [{"home": "Löwen", "away": "Adler", "home_score": 13, "away_score": 9}]},
        "s2": {"matches": [{"home": "Bären", "away": "Löwen", "home_score": 6, "away_score": 6}],
               "official_table": [{"team": "Löwen", "points": 5}, {"team": "Bären", "points": 4}, {"team": "Adler", "points": 0}]},
    }
    snapshots = compute_standings(rules=_rules(match_points={"win": 3, "draw": 1, "loss": 0}), rounds=rounds, sheets=sheets,
                                  participants=[], own_teams=["Löwen"])
    assert _table(_scope(snapshots, "table", "s1"), "team", "rank", "points") == [("Löwen", 1, 3), ("Adler", 2, 0)]
    # Nach Spieltag 2 gilt die Tabelle des Veranstalters; abgeglichen wird das eigene Team (4 gerechnet, 5 offiziell).
    assert _table(_scope(snapshots, "table", "s2"), "team", "rank", "points", "computed_points", "deviation") == [
        ("Löwen", 1, 5, 4, 1), ("Bären", 2, 4, 1, None), ("Adler", 3, 0, 0, None)]


# ---------------------------------------------------------------- Regeländerung
SEASON_ROUNDS = [_round("r1", 1), _round("r2", 2), _round("r3", 3), _round("r4", 4, status="postponed")]
SEASON_SHEETS = {
    "r1": {"rows": _rows(("anna", 1, ["fastest_lap"]), ("bert", 2), ("gast", 3), ("dora", 4, ["dnf"]))},
    "r2": {"rows": _rows(("bert", 1), ("dora", 2), ("anna", 3, ["dnf"]), ("gast", 4, ["dns"]))},
    "r3": {"rows": _rows(("dora", 1), ("anna", 2), ("gast", 3, ["fastest_lap"]), ("bert", 5))},
}
RULES_A = {"points_by_place": [25, 18, 15, 12, 10], "bonuses": {"fastest_lap": {"points": 1, "max_place": 3}},
           "count_mode": "best_n", "count_n": 2, "tiebreakers": ["countback", "latest_result"],
           "team_scoring": {"enabled": True, "counting_drivers": 2, "guests_count": True}}
RULES_B = {**RULES_A, "points_by_place": [10, 8, 6, 5, 4], "count_mode": "all", "dnf_points": 0}


def _season(rules, participants=PARTICIPANTS, sheets=SEASON_SHEETS, rounds=SEASON_ROUNDS):
    return compute_standings(rules=normalize_rules(rules), rounds=rounds, sheets=sheets, participants=participants)


def test_a_rule_change_recalculates_and_changing_back_reproduces_the_first_result_exactly():
    first = _season(RULES_A)
    changed = _season(RULES_B)
    assert changed != first
    assert _season(RULES_A) == first
    # Von Hand nachgerechnet, beste zwei: Anna 26 (Sieg + Bonus) + 18, Bert 25 + 18, Dora 25 + 18, Gina 16 (Bonus) + 15.
    # Bert und Dora: je ein Sieg und ein zweiter Platz - Dora hat dazu einen vierten, Bert nur einen fünften.
    assert _table(_scope(first, "drivers"), "participant_id", "rank", "points", "tiebreak") == [
        ("anna", 1, 44, None), ("dora", 2, 43, None), ("bert", 3, 43, "countback"), ("gast", 4, 31, None)]
    # Teams (zwei beste je Rennen, Gast zählt): Löwen 41 + 0 + 34, Falken 18 + 43 + 35.
    assert _table(_scope(first, "teams"), "team", "rank", "points") == [("Falken", 1, 96), ("Löwen", 2, 75)]
    # Regel B: alle Rennen zählen, 10-8-6-5-4, Bonus 1 bis Platz 3.
    # Anna 11 + 0 + 8, Bert 8 + 10 + 4, Dora 0 + 8 + 10, Gina 6 + 0 + 7.
    assert _table(_scope(changed, "drivers"), "participant_id", "rank", "points") == [
        ("bert", 1, 22), ("anna", 2, 19), ("dora", 3, 18), ("gast", 4, 13)]


def test_the_result_does_not_depend_on_the_order_of_the_input():
    shuffled_sheets = copy.deepcopy(SEASON_SHEETS)
    generator = random.Random(1741)
    for sheet in shuffled_sheets.values():
        generator.shuffle(sheet["rows"])
    participants = list(reversed(PARTICIPANTS))
    rounds = list(reversed(SEASON_ROUNDS))
    assert _season(RULES_A, participants=participants, sheets=shuffled_sheets, rounds=rounds) == _season(RULES_A)
