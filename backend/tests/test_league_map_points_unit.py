"""Punkte nach gewonnenen Maps (#2312, docs/LIGA.md E.1): 3:2 ergibt 3 und 2, kampflos wie 3:0, Gleichstand nach mehr
Siegen, direktem Vergleich (mit Map-Punkten), Map-Differenz und Leitung. Andere Punkteart und andere Formate bleiben,
wie sie sind. Nur erfundene Namen.
"""
import copy
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.competition_standings import round_robin_standings, table_rules  # noqa: E402
from services.scoring_rules import (  # noqa: E402
    LEAGUE_TABLE_DEFAULTS,
    MAPS_TABLE_TIEBREAKERS,
    league_default_rules,
    league_table,
    match_points,
    normalize_rules,
)


def duel(a, b, score_a, score_b, *, round_number=1, status="completed", forfeit=None, best_of=5):
    winner = a if score_a > score_b else b if score_b > score_a else None
    results = []
    for side, score in ((a, score_a), (b, score_b)):
        row = {"registration_id": side, "score": score, "rank": 1 if side == winner or winner is None else 2,
               "outcome": "winner" if side == winner else ("draw" if winner is None else "placed")}
        if forfeit == side or forfeit == "both":
            row.update({"forfeit": True, "outcome": "forfeit", "rank": 2, "score": None})
        results.append(row)
    return {"id": f"{a}-{b}-{round_number}", "round": round_number, "status": status, "best_of": best_of,
            "slots": [{"position": 1, "registration_id": a}, {"position": 2, "registration_id": b}],
            "results": results}


def regs(*names, **status):
    return [{"id": name, "display_name": name.upper(), "status": status.get(name, "approved")} for name in names]


def maps_rules(**extra):
    return table_rules({"scoring_rules": {**copy.deepcopy(LEAGUE_TABLE_DEFAULTS), "match_points_mode": "maps",
                                          "table_tiebreakers": list(MAPS_TABLE_TIEBREAKERS), **extra}})


MAPS = maps_rules()
RESULT = table_rules({"scoring_rules": copy.deepcopy(LEAGUE_TABLE_DEFAULTS)})


def by_id(rows):
    return {row["registration_id"]: row for row in rows}


def order(rows):
    return [row["registration_id"] for row in rows]


def standings(matches, registrations, rules=MAPS, **tournament):
    return round_robin_standings(matches, registrations, rules, tournament={"best_of": 5, **tournament})


# ---------------------------------------------------------------- Regeln

def test_mode_defaults_to_result_and_is_validated():
    assert normalize_rules({})["match_points_mode"] == "result"
    assert league_default_rules()["match_points_mode"] == "result", "neue Seasons bleiben wie heute"
    assert normalize_rules({"match_points_mode": "maps"})["match_points_mode"] == "maps"
    with pytest.raises(ValueError, match="match_points_mode"):
        normalize_rules({"match_points_mode": "sets"})
    assert MAPS_TABLE_TIEBREAKERS == ("wins", "head_to_head", "score_diff", "lead_decision")


def test_match_points_counts_maps():
    rules = normalize_rules({"match_points_mode": "maps", "match_points": {"win": 3, "draw": 1, "loss": 0}})
    assert match_points(3, 2, rules) == ("win", 3)
    assert match_points(2, 3, rules) == ("loss", 2)
    assert match_points(2, 2, rules) == ("draw", 2)
    assert match_points(2, 3, normalize_rules({})) == ("loss", 0), "Sieg/Remis/Niederlage wie bisher"


# ---------------------------------------------------------------- Punkte je Spiel

@pytest.mark.parametrize("score_a,score_b,points_a,points_b", [(3, 2, 3, 2), (3, 0, 3, 0), (1, 3, 1, 3)])
def test_points_are_won_maps(score_a, score_b, points_a, points_b):
    rows = by_id(standings([duel("a", "b", score_a, score_b)], regs("a", "b")))
    assert (rows["a"]["points"], rows["b"]["points"]) == (points_a, points_b)
    winner, loser = ("a", "b") if score_a > score_b else ("b", "a")
    assert (rows[winner]["won"], rows[loser]["lost"]) == (1, 1)


@pytest.mark.parametrize("forfeit_score", ["best_of", "recorded"])
def test_forfeit_counts_like_three_nil(forfeit_score):
    match = {**duel("a", "b", 0, 0, forfeit="b"), "status": "forfeit"}
    match["results"][0].update({"rank": 1, "outcome": "winner"})
    rows = by_id(standings([match], regs("a", "b"), maps_rules(forfeit_score=forfeit_score)))
    assert (rows["a"]["points"], rows["b"]["points"]) == (3, 0)
    assert (rows["a"]["score_for"], rows["b"]["score_against"]) == (3, 3)
    assert (rows["a"]["forfeit_won"], rows["b"]["forfeit_lost"]) == (1, 1)


def test_forfeit_maps_follow_best_of_of_match():
    match = {**duel("a", "b", 0, 0, forfeit="b", best_of=3), "status": "forfeit"}
    match["results"][0].update({"rank": 1, "outcome": "winner"})
    assert by_id(standings([match], regs("a", "b")))["a"]["points"] == 2


def test_double_no_show_gives_nothing():
    match = {**duel("a", "b", 0, 0, forfeit="both"), "status": "forfeit", "double_forfeit": True}
    rows = by_id(standings([match], regs("a", "b")))
    assert (rows["a"]["points"], rows["b"]["points"]) == (0, 0)
    assert (rows["a"]["lost"], rows["b"]["lost"]) == (1, 1)


@pytest.mark.parametrize("forfeit_score", ["best_of", "recorded"])
def test_exit_for_opponents_counts_like_forfeit(forfeit_score):
    """x tritt aus: das gespielte 3:2 gegen a zählt für a wie ein Default-Win (3:0)."""
    rows = by_id(standings([duel("x", "a", 3, 2), duel("x", "b", 0, 3, round_number=2)],
                           regs("a", "b", "x", x="withdrawn"), maps_rules(forfeit_score=forfeit_score)))
    assert (rows["a"]["points"], rows["x"]["points"]) == (3, 0)
    assert rows["b"]["points"] == 3


def test_even_series_draw_counts_maps():
    rules = maps_rules(allow_draws=True)
    rows = by_id(standings([duel("a", "b", 2, 2, best_of=4)], regs("a", "b"), rules))
    assert (rows["a"]["points"], rows["b"]["points"], rows["a"]["drawn"]) == (2, 2, 1)


def test_point_deduction_still_applies():
    rows = by_id(standings([duel("a", "b", 3, 2)], regs("a", "b"),
                           point_deductions=[{"registration_id": "a", "points": 1}]))
    assert rows["a"]["points"] == 2 and rows["a"]["deducted_points"] == 1


# ---------------------------------------------------------------- Gleichstand

def test_tie_on_points_resolved_by_wins():
    """a: 3:0 und 2:3 = 5 Punkte, 1 Sieg. b: 2:3, 2:3, 1:3 = 5 Punkte, kein Sieg."""
    matches = [duel("a", "c", 3, 0), duel("a", "d", 2, 3, round_number=2),
               duel("b", "c", 2, 3, round_number=3), duel("b", "d", 2, 3, round_number=4), duel("b", "e", 1, 3, round_number=5)]
    rows = standings(matches, regs("a", "b", "c", "d", "e"))
    found = by_id(rows)
    assert found["a"]["points"] == found["b"]["points"] == 5
    assert order(rows).index("a") < order(rows).index("b")
    assert found["a"]["tiebreak"] == "wins"


def test_tie_on_points_and_wins_resolved_by_head_to_head_before_map_difference():
    """a schlägt b 3:2 und verliert 2:3 gegen c; b schlägt c 3:1. Je 5 Punkte, 1 Sieg. Map-Differenz spräche für b (+1 zu
    0) - der direkte Vergleich kommt vorher und gibt a den Platz."""
    matches = [duel("a", "b", 3, 2), duel("a", "c", 2, 3, round_number=2), duel("b", "c", 3, 1, round_number=3)]
    rows = standings(matches, regs("a", "b", "c"))
    found = by_id(rows)
    assert (found["a"]["points"], found["b"]["points"], found["a"]["won"], found["b"]["won"]) == (5, 5, 1, 1)
    assert found["b"]["score_diff"] > found["a"]["score_diff"]
    assert order(rows)[:2] == ["a", "b"]
    assert found["a"]["tiebreak"] == "head_to_head"


def test_then_map_difference():
    """Hin- und Rückspiel 3:2 und 2:3: direkter Vergleich gleich. a schlägt c 3:0, b schlägt c 3:1 - Differenz +3 zu +2."""
    matches = [duel("a", "b", 3, 2), duel("b", "a", 3, 2, round_number=2),
               duel("a", "c", 3, 0, round_number=3), duel("b", "c", 3, 1, round_number=4)]
    rows = standings(matches, regs("a", "b", "c"))
    found = by_id(rows)
    assert found["a"]["points"] == found["b"]["points"] == 8 and found["a"]["won"] == found["b"]["won"] == 2
    assert order(rows)[:2] == ["a", "b"] and found["a"]["tiebreak"] == "score_diff"


def _full_tie():
    return [duel("a", "b", 3, 2), duel("b", "a", 3, 2, round_number=2),
            duel("a", "c", 3, 1, round_number=3), duel("b", "c", 3, 1, round_number=4)]


def test_then_lead_decision():
    rows = standings(_full_tie(), regs("a", "b", "c"))
    assert [row["rank"] for row in rows] == [1, 1, 3], "ohne Entscheid teilen sie sich den Platz"
    decision = {"id": "d1", "registration_ids": ["b", "a"], "reason": "Losentscheid", "decided_at": "2026-11-20"}
    rows = standings(_full_tie(), regs("a", "b", "c"), table_decisions=[decision])
    assert order(rows) == ["b", "a", "c"] and [row["rank"] for row in rows] == [1, 2, 3]
    assert by_id(rows)["a"]["tiebreak"] == "lead_decision"


def _three_way():
    """a, b, c je 5 Punkte und 1 Sieg. Im Kreis: a-b 3:0, b-c 3:2, c-a 3:1 - Map-Punkte untereinander c 5, a 4, b 3. Gegen
    d verliert jeder (1:3, 2:3, 0:3)."""
    return [duel("a", "b", 3, 0), duel("b", "c", 3, 2, round_number=2), duel("c", "a", 3, 1, round_number=3),
            duel("a", "d", 1, 3, round_number=4), duel("b", "d", 2, 3, round_number=5), duel("c", "d", 0, 3, round_number=6)]


def test_three_teams_tied_mini_table_uses_map_points():
    rules = maps_rules(head_to_head_criteria=["points"])
    rows = standings(_three_way(), regs("a", "b", "c", "d"), rules)
    found = by_id(rows)
    assert found["a"]["points"] == found["b"]["points"] == found["c"]["points"] == 5
    assert order(rows) == ["d", "c", "a", "b"] and [row["rank"] for row in rows] == [1, 2, 3, 4]
    assert {found[name]["tiebreak"] for name in "cab"} == {"head_to_head"}
    # Gegenprobe: mit Sieg/Remis/Niederlage im direkten Vergleich hätte jeder 3 Punkte - kein Unterschied.
    result_mini = table_rules({"scoring_rules": {**copy.deepcopy(LEAGUE_TABLE_DEFAULTS), "table_tiebreakers": ["head_to_head"],
                                                 "head_to_head_criteria": ["points"]}})
    assert [row["rank"] for row in standings(_three_way(), regs("a", "b", "c", "d"), result_mini)] == [1, 2, 2, 2]


# ---------------------------------------------------------------- Regression: andere Punkteart und Formate

def test_result_mode_unchanged():
    matches = [duel("a", "b", 3, 2), duel("a", "c", 2, 3, round_number=2), duel("b", "c", 3, 1, round_number=3)]
    explicit = table_rules({"scoring_rules": {**copy.deepcopy(LEAGUE_TABLE_DEFAULTS), "match_points_mode": "result"}})
    before = standings(matches, regs("a", "b", "c"), RESULT)
    assert before == standings(matches, regs("a", "b", "c"), explicit)
    assert [row["points"] for row in before] == [3, 3, 3]


def test_other_tournaments_unchanged():
    """Ohne ``scoring_rules`` (Turniere, Gruppen) rechnet die Tabelle wie bisher 3/1/0."""
    rows = by_id(round_robin_standings([duel("a", "b", 3, 2)], regs("a", "b"), None))
    assert (rows["a"]["points"], rows["b"]["points"]) == (3, 0)


def test_reference_team_league_table():
    games = [{"home": "A", "away": "B", "home_score": 3, "away_score": 2}]
    rows = {row["team"]: row for row in league_table(games, normalize_rules({}))}
    assert (rows["A"]["points"], rows["B"]["points"]) == (3, 0)
    rows = {row["team"]: row for row in league_table(games, normalize_rules({"match_points_mode": "maps"}))}
    assert (rows["A"]["points"], rows["B"]["points"]) == (3, 2)
