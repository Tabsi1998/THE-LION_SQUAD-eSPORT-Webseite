"""E.1 Tabelle (#1625, docs/LIGA.md): direkter Vergleich mit Mini-Tabelle, Default-Win, beide nicht erschienen,
Ausscheiden, Punktabzug und Entscheid der Leitung - als Tabelle von Fällen. Nur erfundene Namen.
"""
import copy
import pathlib
import random
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.competition_standings import (  # noqa: E402
    _round_robin_rows,
    round_robin_standings,
    standings_for_structure,
    table_rules,
)
from services.scoring_rules import LEAGUE_TABLE_DEFAULTS, league_default_rules, normalize_rules  # noqa: E402


def duel(a, b, score_a, score_b, *, round_number=1, status="completed", forfeit=None, best_of=None):
    """Ein Spiel wie aus dem Lesestand: Sieger mit ``outcome: winner``, kampflos mit ``forfeit`` an der Seite."""
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


LEAGUE = table_rules({"scoring_rules": copy.deepcopy(LEAGUE_TABLE_DEFAULTS)})


def order(rows):
    return [row["registration_id"] for row in rows]


def by_id(rows):
    return {row["registration_id"]: row for row in rows}


# ---------------------------------------------------------------- Gleichstand als Tabelle von Fällen

def _circle_with_extra():
    """a, b, c schlagen sich im Kreis und alle d - je 6 Punkte. Mini-Tabelle: a +1, c 0, b -1. Gesamt: a +2, b +1, c +1."""
    return [duel("a", "b", 2, 0), duel("b", "c", 2, 1), duel("c", "a", 2, 1),
            duel("a", "d", 2, 1), duel("b", "d", 2, 0), duel("c", "d", 2, 1)]


def _rest_group_recomputed():
    """Vier mit 9 Punkten: a schlägt b, c, d; b, c, d im Kreis; alle drei schlagen e und f, a verliert gegen e und f.
    Mini-Tabelle der vier trennt a ab; b und c stehen dort gleich (-1, 3 Maps) - neu gerechnet nur unter b und c
    gewinnt b (Nr. 42)."""
    return [duel("a", "b", 2, 0), duel("a", "c", 2, 1), duel("a", "d", 2, 0),
            duel("b", "c", 2, 0), duel("c", "d", 2, 0), duel("d", "b", 2, 1),
            duel("e", "a", 2, 0), duel("f", "a", 2, 0),
            *[duel(team, loser, 2, 0) for team in ("b", "c", "d") for loser in ("e", "f")]]


def _no_head_to_head_split():
    """a und b 1:1 im Direktvergleich (Hin- und Rückspiel, gleiche Maps), dann gewinnt die Map-Differenz gesamt."""
    return [duel("a", "b", 2, 1, round_number=1), duel("b", "a", 2, 1, round_number=2),
            duel("a", "c", 2, 0, round_number=3), duel("b", "c", 2, 1, round_number=3)]


def _full_tie():
    """a und b stehen in allem gleich: Kreis über c ohne Unterschied."""
    return [duel("a", "b", 2, 1, round_number=1), duel("b", "a", 2, 1, round_number=2),
            duel("a", "c", 2, 1, round_number=3), duel("b", "c", 2, 1, round_number=4)]


def _two_teams_direct():
    """a und b je 3 Punkte; b gewann den Direktvergleich knapp, a hat gesamt die bessere Differenz (+1 zu 0)."""
    return [duel("b", "a", 2, 1), duel("a", "c", 2, 0), duel("d", "b", 2, 1), duel("d", "c", 2, 0)]


def _incomplete_head_to_head():
    """a, b, c je 3 Punkte, gespielt ist unter ihnen nur a-b (b gewinnt 2:1): die Mini-Tabelle rechnet nur damit -
    b 3 Punkte, c ohne Spiel 0 Punkte und Differenz 0, a 0 Punkte und Differenz -1. Gesamt hätte c (+2) ebenfalls vor
    a (+1) gelegen; entschieden hat aber schon der direkte Vergleich."""
    return [duel("b", "a", 2, 1), duel("a", "d", 2, 0), duel("c", "d", 2, 0),
            duel("e", "b", 2, 0), duel("e", "d", 2, 0)]


CASES = [
    ("Kreis: Mini-Tabelle nach Map-Differenz vor Gesamt", _circle_with_extra, "abcd", ["a", "c", "b", "d"],
     {"a": "head_to_head", "b": "head_to_head", "c": "head_to_head", "d": None}),
    ("Restgruppe neu gerechnet (Nr. 42)", _rest_group_recomputed, "abcdef", ["a", "b", "c", "d", "e", "f"],
     {"a": "head_to_head", "b": "head_to_head", "c": "head_to_head", "d": "head_to_head"}),
    ("Direktvergleich gleich: Gesamt-Differenz", _no_head_to_head_split, "abc", ["a", "b", "c"],
     {"a": "score_diff", "b": "score_diff", "c": None}),
    ("Echter Gleichstand ohne Entscheid: geteilter Platz", _full_tie, "abc", ["a", "b", "c"],
     {"a": None, "b": None, "c": None}),
    ("Zwei Teams: direkter Vergleich vor Differenz", _two_teams_direct, "abcd", ["d", "b", "a", "c"],
     {"a": "head_to_head", "b": "head_to_head", "c": None, "d": None}),
    ("Unvollständiger Direktvergleich", _incomplete_head_to_head, "abcde", ["e", "b", "c", "a", "d"],
     {"b": "head_to_head", "c": "head_to_head", "a": "head_to_head", "e": None}),
]


@pytest.mark.parametrize("label,build,names,expected,tiebreaks", CASES, ids=[case[0] for case in CASES])
def test_tiebreak_cases(label, build, names, expected, tiebreaks):
    rows = round_robin_standings(build(), regs(*names), LEAGUE)
    assert order(rows) == expected, label
    found = by_id(rows)
    for registration_id, criterion in tiebreaks.items():
        assert found[registration_id]["tiebreak"] == criterion, (label, registration_id)


def test_a_real_tie_shares_the_place_and_the_lead_decides_it():
    rows = round_robin_standings(_full_tie(), regs("a", "b", "c"), LEAGUE)
    assert [row["rank"] for row in rows] == [1, 1, 3]
    decision = {"id": "d1", "registration_ids": ["b", "a"], "reason": "Losentscheid vor Zeugen", "decided_at": "2026-11-20"}
    rows = round_robin_standings(_full_tie(), regs("a", "b", "c"), LEAGUE, tournament={"table_decisions": [decision]})
    assert order(rows) == ["b", "a", "c"] and [row["rank"] for row in rows] == [1, 2, 3]
    assert by_id(rows)["a"]["tiebreak"] == "lead_decision"
    assert by_id(rows)["b"]["lead_decision"] == {"id": "d1", "reason": "Losentscheid vor Zeugen", "decided_at": "2026-11-20"}
    # Gilt nur für genau diese Gruppe - ein Entscheid über andere Teams ändert nichts.
    stale = {**decision, "registration_ids": ["a", "c"]}
    rows = round_robin_standings(_full_tie(), regs("a", "b", "c"), LEAGUE, tournament={"table_decisions": [stale]})
    assert [row["rank"] for row in rows] == [1, 1, 3]
    # Ohne „Entscheid der Leitung“ in den Regeln bleibt der Platz geteilt.
    without = table_rules({"scoring_rules": {**LEAGUE_TABLE_DEFAULTS, "table_tiebreakers": ["head_to_head", "score_diff"]}})
    rows = round_robin_standings(_full_tie(), regs("a", "b", "c"), without, tournament={"table_decisions": [decision]})
    assert [row["rank"] for row in rows] == [1, 1, 3]


def test_without_head_to_head_the_overall_values_decide():
    overall = table_rules({"scoring_rules": {**LEAGUE_TABLE_DEFAULTS, "table_tiebreakers": ["score_diff", "score_for"]}})
    rows = round_robin_standings(_two_teams_direct(), regs("a", "b", "c"), overall)
    assert order(rows) == ["a", "b", "c"]


def test_head_to_head_criteria_can_be_reduced_to_points():
    only_points = table_rules({"scoring_rules": {**LEAGUE_TABLE_DEFAULTS, "head_to_head_criteria": ["points"]}})
    rows = round_robin_standings(_circle_with_extra(), regs("a", "b", "c", "d"), only_points)
    # Im Kreis gleiche Punkte - dann entscheidet die Differenz gesamt (a +2), zwischen b und c (beide +1) die Maps (5 zu 4).
    assert order(rows) == ["a", "c", "b", "d"]
    assert [by_id(rows)[key]["tiebreak"] for key in "acb"] == ["score_diff", "score_for", "score_for"]


# ---------------------------------------------------------------- Kampflos, beide nicht erschienen, Abzug

def test_a_default_win_counts_the_maps_of_the_best_of():
    matches = [duel("a", "b", 1, 0, status="forfeit", forfeit="b", best_of=5), duel("c", "a", 2, 1)]
    rows = by_id(round_robin_standings(matches, regs("a", "b", "c"), LEAGUE))
    assert (rows["a"]["score_for"], rows["a"]["score_against"]) == (3 + 1, 0 + 2)
    assert (rows["b"]["score_for"], rows["b"]["score_against"]) == (0, 3)
    assert rows["a"]["forfeit_won"] == 1 and rows["b"]["forfeit_lost"] == 1
    # Ohne Best of am Spiel gilt das der Staffel.
    plain = [duel("a", "b", 1, 0, status="forfeit", forfeit="b")]
    rows = by_id(round_robin_standings(plain, regs("a", "b"), LEAGUE, tournament={"best_of": 3}))
    assert rows["a"]["score_for"] == 2
    # Mit „wie eingetragen“ bleibt der eingetragene Stand (hier 1), markiert ist es trotzdem.
    recorded = table_rules({"scoring_rules": {**LEAGUE_TABLE_DEFAULTS, "forfeit_score": "recorded"}})
    rows = by_id(round_robin_standings(plain, regs("a", "b"), recorded, tournament={"best_of": 3}))
    assert rows["a"]["score_for"] == 1 and rows["a"]["forfeit_won"] == 1 and rows["a"]["points"] == 3


def test_both_no_show_lose_without_points_and_maps():
    matches = [duel("a", "b", 0, 0, status="forfeit", forfeit="both")]
    loss_point = table_rules({"scoring_rules": {**LEAGUE_TABLE_DEFAULTS, "match_points": {"win": 3, "draw": 1, "loss": 1}}})
    rows = by_id(round_robin_standings(matches, regs("a", "b"), loss_point))
    for side in ("a", "b"):
        assert (rows[side]["played"], rows[side]["lost"], rows[side]["drawn"]) == (1, 1, 0)
        assert (rows[side]["points"], rows[side]["score_for"], rows[side]["forfeit_lost"]) == (1, 0, 1)
        assert rows[side]["form"] == ["L"]
    rows = by_id(round_robin_standings(matches, regs("a", "b"), LEAGUE))
    assert rows["a"]["points"] == rows["b"]["points"] == 0


def test_point_deductions_come_off_the_total_not_the_mini_table():
    matches = [duel("a", "b", 2, 0), duel("b", "c", 2, 0), duel("c", "a", 2, 0)]
    deduction = {"point_deductions": [{"registration_id": "a", "points": 3, "reason": "intern"},
                                      {"registration_id": "b", "points": -2}, {"registration_id": "b", "points": True}]}
    rows = by_id(round_robin_standings(matches, regs("a", "b", "c"), LEAGUE, tournament=deduction))
    assert (rows["a"]["points"], rows["a"]["deducted_points"]) == (0, 3)
    assert rows["b"]["deducted_points"] == 0 and rows["a"]["rank"] == 3


# ---------------------------------------------------------------- Ausscheiden (Kommentar 02.11., Nr. 43, Nr. 48)

def test_every_game_of_a_team_that_left_counts_for_the_opponent():
    matches = [duel("x", "a", 2, 0, round_number=1), duel("x", "b", 2, 1, round_number=2), duel("a", "b", 2, 0, round_number=3)]
    registrations = regs("a", "b", "x", x="withdrawn")
    registrations[2]["removal"] = {"at": "2026-11-20T10:00:00+00:00", "mode": "opponents"}
    rows = round_robin_standings(matches, registrations, LEAGUE, tournament={"best_of": 3})
    found = by_id(rows)
    assert order(rows) == ["a", "b", "x"]
    assert found["a"]["points"] == 6 and found["b"]["points"] == 3 and found["x"]["points"] == 0
    assert (found["a"]["score_for"], found["a"]["score_against"]) == (4, 0)  # 2:0 kampflos statt 0:2, dazu 2:0 gegen b
    assert found["x"]["exit"] == {"kind": "withdrawn", "at": "2026-11-20T10:00:00+00:00"}
    assert found["a"]["forfeit_won"] == 1 and found["x"]["forfeit_lost"] == 2
    # Das echte Ergebnis bleibt am Spiel.
    assert matches[0]["results"][0]["score"] == 2


def test_the_table_end_orders_by_exit_and_puts_disqualified_last():
    matches = [duel("a", "b", 2, 0, round_number=1), duel("c", "d", 2, 0, round_number=1),
               duel("w1", "a", 2, 0, round_number=2), duel("w2", "b", 2, 0, round_number=2),
               duel("dq", "c", 2, 0, round_number=2), duel("w1", "w2", 2, 0, round_number=3)]
    registrations = regs("a", "b", "c", "d", "w1", "w2", "dq", w1="withdrawn", w2="withdrawn", dq="disqualified")
    exits = {"w1": "2026-11-20T10:00:00+00:00", "w2": "2026-11-27T10:00:00+00:00", "dq": "2026-12-01T10:00:00+00:00"}
    for registration in registrations:
        if registration["id"] in exits:
            registration["removal_at"] = exits[registration["id"]]
    rows = round_robin_standings(matches, registrations, LEAGUE)
    assert order(rows)[-3:] == ["w2", "w1", "dq"]
    assert [row["rank"] for row in rows][-3:] == [5, 6, 7]
    found = by_id(rows)
    # Nr. 48: w1 gegen w2 zählt für keinen, auch nicht als gespielt.
    assert found["w1"]["played"] == 1 and found["w2"]["played"] == 1
    # Mit der 50-%-Regel bleibt der Platz nach Punkten (wie bisher).
    half = table_rules({"scoring_rules": {**LEAGUE_TABLE_DEFAULTS, "exit_rule": "half"}})
    rows = by_id(round_robin_standings(matches, registrations, half))
    assert rows["w1"]["points"] == 6 and rows["w1"]["rank"] == 1


def test_the_result_pdf_names_who_left():
    from pdf_service import _pdf_standings_tables

    rows = [{"rank": 1, "display_name": "Nordlicht", "score_diff": 2}, {"rank": 2, "display_name": "Steinbock",
                                                                     "score_diff": 0, "exit": {"kind": "withdrawn"}},
            {"rank": 3, "display_name": "Eisfuchs", "score_diff": 0, "exit": {"kind": "disqualified"}}]
    names = [row[1] for row in _pdf_standings_tables({"format": "league"}, rows)[0]["rows"]]
    assert names == ["Nordlicht", "Steinbock (ausgetreten)", "Eisfuchs (disqualifiziert)"]


# ---------------------------------------------------------------- Weiche und Vorgaben

def _random_season(seed: int) -> tuple[list[dict], list[dict]]:
    rng = random.Random(seed)
    names = [f"t{index}" for index in range(rng.randint(3, 8))]
    matches = []
    for round_number, (a, b) in enumerate((a, b) for index, a in enumerate(names) for b in names[index + 1:]):
        if rng.random() < 0.8:
            matches.append(duel(a, b, rng.randint(0, 3), rng.randint(0, 3), round_number=round_number % 5 + 1))
    return matches, regs(*names)


@pytest.mark.parametrize("seed", range(40))
def test_old_seasons_without_the_new_fields_rank_exactly_as_before(seed):
    """Weiche: ``scoring_rules`` ohne E.1-Felder (alte Season) - dieselbe Reihenfolge und dieselben Plätze wie die alte
    Rechnung, nur mit zusätzlichen Feldern."""
    matches, registrations = _random_season(seed)
    old_rules = normalize_rules({"match_points": {"win": 3, "draw": 1, "loss": 0}})
    before = _round_robin_rows(copy.deepcopy(matches), registrations, old_rules)
    after = round_robin_standings(copy.deepcopy(matches), registrations, old_rules)
    assert [(row["registration_id"], row["rank"], row["points"]) for row in after] == \
        [(row["registration_id"], row["rank"], row["points"]) for row in before]


def test_other_formats_ignore_the_league_rules():
    snapshot = {"matches": [{**duel("a", "b", 2, 0), "source": {"engine": "stage"}, "group_id": "g1"}]}
    groups = [{"id": "g1", "group_key": "A", "participant_ids": ["a", "b"]}]
    tournament = {"format": "groups", "scoring_rules": copy.deepcopy(LEAGUE_TABLE_DEFAULTS)}
    rows = standings_for_structure(tournament, snapshot, regs("a", "b"), groups=groups)[0]["standings"]
    assert "tiebreak" not in rows[0] and rows[0]["points"] == 3
    swiss = standings_for_structure({**tournament, "format": "swiss"}, snapshot, regs("a", "b"))
    assert "tiebreak" not in swiss[0]


def test_new_league_seasons_get_the_decided_defaults():
    rules = league_default_rules()
    assert rules["table_tiebreakers"] == ["head_to_head", "score_diff", "score_for", "lead_decision"]
    assert rules["head_to_head_criteria"] == ["points", "score_diff", "score_for"]
    assert (rules["allow_draws"], rules["forfeit_score"], rules["exit_rule"]) == (False, "best_of", "all_for_opponents")
    assert rules["match_points"] == {"win": 3, "draw": 0, "loss": 0}
    old = normalize_rules({})
    assert (old["allow_draws"], old["forfeit_score"], old["exit_rule"]) == (True, "recorded", "half")
    with pytest.raises(ValueError):
        normalize_rules({"head_to_head_criteria": []})
    with pytest.raises(ValueError):
        normalize_rules({"exit_rule": "irgendwas"})
    with pytest.raises(ValueError):
        normalize_rules({"table_tiebreakers": ["los"]})
