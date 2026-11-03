"""Ergebnisregeln je Map (docs/LIGA.md, C.3, #1617): Fall-Tabelle je Ergebnisart. Erfundene Werte, keine eines Titels.

``check_map`` prüft Endstand gegen Sieger und Regel - nur mit Regel bzw. Punktepflicht. Die Sätze sind die, die die Seite zeigt.
"""

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.league_result_rules import RuleProblem, check_map, clean_rules, rules_of_game  # noqa: E402

NAMES = {"a": "Rudel A", "h": "Horst"}
SCORE = {"kind": "score", "target": 250, "time_limit_seconds": 600}
SCORE_NO_TIME = {"kind": "score", "target": 250}
SCORE_OT = {"kind": "score", "target": 250, "time_limit_seconds": 600, "overtime": True}
ROUNDS = {"kind": "rounds", "target": 6, "round_limit": 11}
ROUNDS_OT = {"kind": "rounds", "target": 6, "round_limit": 11, "overtime": True}
ROUNDS_DRAW = {"kind": "rounds", "target": 7, "round_limit": 12, "draw_allowed": True}
HIGHEST = {"kind": "highest"}
HIGHEST_DRAW = {"kind": "highest", "draw_allowed": True}


def run(rule, winner_score, loser_score, *, required=False):
    """Rudel A ist Sieger der Map; ``None`` heißt: kein Wert für die Seite."""
    scores = {key: value for key, value in (("a", winner_score), ("h", loser_score)) if value is not None}
    check_map(rule, scores, "a", "h", label="Map 1", names=NAMES, required=required)


CASES = [
    # Punkte bis zum Ziel
    ("score ok", SCORE, 250, 180, None),
    ("score Sieger mit weniger Punkten", SCORE, 100, 250,
     "Map 1: Der Endstand 100:250 passt nicht zum Sieger – mehr Punkte hat Horst."),
    ("score über dem Ziel", SCORE, 251, 240, "Map 1: höchstens 250 Punkte – die Map endet beim Ziel (Endstand 251:240)."),
    ("score Zeitlimit unter dem Ziel", SCORE, 200, 180, None),
    ("score ohne Zeitlimit unter dem Ziel", SCORE_NO_TIME, 200, 180,
     "Map 1: Die Map endet erst bei 250 Punkten – der Sieger hat 200."),
    ("score Gleichstand ohne Remis", SCORE, 200, 200,
     "Map 1: Gleichstand (200:200) gibt es in diesem Modus nicht – bitte Endstand und Sieger prüfen."),
    ("score mit Verlängerung über dem Ziel", SCORE_OT, 262, 250, None),
    ("score Kommazahl", SCORE, 250.5, 180, "Map 1: Punkte bitte als ganze Zahl angeben."),
    # Runden gewinnen
    ("rounds 6:5", ROUNDS, 6, 5, None),
    ("rounds 6:0", ROUNDS, 6, 0, None),
    ("rounds 7:5 über dem Limit", ROUNDS, 7, 5, "Map 1: höchstens 11 Runden – 7:5 sind 12."),
    ("rounds 7:4 über dem Ziel", ROUNDS, 7, 4,
     "Map 1: höchstens 6 Rundensiege – die Map endet beim Ziel (Endstand 7:4)."),
    ("rounds 5:4 Ziel nicht erreicht", ROUNDS, 5, 4, "Map 1: Die Map endet erst bei 6 gewonnenen Runden – der Sieger hat 5."),
    ("rounds 6:6 ohne Remis", ROUNDS, 6, 6,
     "Map 1: Gleichstand (6:6) gibt es in diesem Modus nicht – bitte Endstand und Sieger prüfen."),
    ("rounds mit Verlängerung", ROUNDS_OT, 8, 6, None),
    ("rounds Remis erlaubt", ROUNDS_DRAW, 6, 6, None),
    ("rounds Remis über dem Limit", ROUNDS_DRAW, 7, 7, "Map 1: höchstens 12 Runden – 7:7 sind 14."),
    ("rounds Sieger mit weniger", ROUNDS, 4, 6, "Map 1: Der Endstand 4:6 passt nicht zum Sieger – mehr Punkte hat Horst."),
    # Höherer Endstand
    ("highest ok", HIGHEST, 31, 20, None),
    ("highest Kommazahl ok", HIGHEST, 31.5, 20, None),
    ("highest Sieger mit weniger", HIGHEST, 20, 31, "Map 1: Der Endstand 20:31 passt nicht zum Sieger – mehr Punkte hat Horst."),
    ("highest Gleichstand", HIGHEST, 25, 25,
     "Map 1: Gleichstand (25:25) gibt es in diesem Modus nicht – bitte Endstand und Sieger prüfen."),
    ("highest Remis erlaubt", HIGHEST_DRAW, 25, 25, None),
    # Ohne Regel: wie vorher, auch ein unpassender Stand
    ("ohne Regel", None, 100, 250, None),
    ("ohne Regel ohne Punkte", None, None, None, None),
    # Mit Regel: beide Seiten oder keine
    ("Regel ohne Punkte", SCORE, None, None, None),
    ("Regel mit halben Punkten", SCORE, 250, None, "Map 1: bitte die Punkte beider Seiten eintragen."),
]


@pytest.mark.parametrize("name,rule,winner_score,loser_score,expected", CASES, ids=[case[0] for case in CASES])
def test_result_rule_cases(name, rule, winner_score, loser_score, expected):
    if expected is None:
        run(rule, winner_score, loser_score)
        return
    with pytest.raises(RuleProblem) as problem:
        run(rule, winner_score, loser_score)
    assert problem.value.detail == expected


@pytest.mark.parametrize("winner_score,loser_score", [(None, None), (250, None), (None, 180)])
def test_scores_required_needs_both_sides(winner_score, loser_score):
    with pytest.raises(RuleProblem) as problem:
        run(None, winner_score, loser_score, required=True)
    assert problem.value.detail == "Map 1: bitte die Punkte beider Seiten eintragen – in dieser Liga sind sie Pflicht."


def test_scores_required_with_both_sides_and_no_rule_passes():
    run(None, 3, 7, required=True)


def test_rules_of_game_copies_modes_with_a_rule_only():
    game = {"match_modes": [
        {"mode": "stellung", "label": "Stellung", "result_rule": SCORE},
        {"mode": "suchen", "label": "Suchen", "status": "inactive", "result_rule": ROUNDS},
        {"mode": "frei", "label": "Frei"},
    ]}

    assert rules_of_game(game) == {"stellung": SCORE, "suchen": ROUNDS}
    assert rules_of_game(None) == {}


def test_clean_rules_checks_like_the_mode_and_knows_the_modes():
    game = {"match_modes": [{"mode": "stellung", "label": "Stellung"}]}

    assert clean_rules({"stellung": {"kind": "rounds", "target": 6, "round_limit": 11}}, game, {}) == {
        "stellung": {"kind": "rounds", "target": 6, "round_limit": 11, "draw_allowed": False, "overtime": False}}
    assert clean_rules({"stellung": None}, game, {}) == {}
    with pytest.raises(RuleProblem) as unknown:
        clean_rules({"fremd": SCORE}, game, {})
    assert unknown.value.detail == "Ergebnisregeln: Den Modus „fremd“ hat das Spiel nicht."
    # Ein Modus, den die Season schon hat, bleibt speicherbar - auch wenn ihn das Spiel nicht mehr kennt.
    assert "alt" in clean_rules({"alt": SCORE}, game, {"alt": SCORE})
    with pytest.raises(RuleProblem) as bad:
        clean_rules({"stellung": {"kind": "rounds", "target": 6, "round_limit": 4}}, game, {})
    assert bad.value.detail == "Modus „Stellung“: Ergebnisregel: Das Rundenlimit (4) ist kleiner als das Ziel (6)."
