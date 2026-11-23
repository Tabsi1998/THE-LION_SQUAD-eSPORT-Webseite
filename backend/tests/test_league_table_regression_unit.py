"""Liga-Tabellen bleiben, wie sie sind (#1559): Turnier-Gruppen und „Jeder gegen jeden“ rechnen den direkten Vergleich
jetzt an derselben Stelle wie die Liga-Staffel. Diese Datei hält fest, was die Liga-Staffel vor dem Umbau rechnete -
als feste Werte, erzeugt mit dem Stand von main vor #1559. Ändert sich hier etwas, hat der Umbau die Liga berührt.

Die Spiele entstehen aus einer kleinen Zahlenfolge ohne Zufallsmodul, damit sie auf jedem Rechner dieselben sind.
Nur erfundene Namen.
"""
import copy
import itertools
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.competition_standings import round_robin_standings, standings_for_structure, table_rules  # noqa: E402
from services.scoring_rules import LEAGUE_TABLE_DEFAULTS  # noqa: E402

TEAMS = ("adler", "biber", "dachs", "elster", "falke", "gams")


def sequence(seed):
    """Eine feste Zahlenfolge (linearer Kongruenzgenerator) - auf jedem Rechner und in jeder Python-Version gleich."""
    state = seed * 2654435761 % 2147483647 or 1
    while True:
        state = state * 48271 % 2147483647
        yield state


def season(seed):
    """Sechs Teams, einfache Runde, Best of 3. Dazu, was eine Staffel kennt: ein kampfloses Spiel, einmal „beide nicht
    erschienen“, ein offenes Spiel, ein ausgetretenes Team und ein Punktabzug."""
    numbers = sequence(seed)
    matches = []
    for index, (home, away) in enumerate(itertools.combinations(TEAMS, 2)):
        roll = next(numbers) % 100
        loser_maps = next(numbers) % 2
        home_wins = roll % 2 == 0
        match = {"id": f"s{seed}-{index}", "round": index // 3 + 1, "order": index % 3 + 1, "status": "completed", "best_of": 3,
                 "slots": [{"position": 1, "registration_id": home}, {"position": 2, "registration_id": away}]}
        winner, loser = (home, away) if home_wins else (away, home)
        if roll >= 97:
            match.update({"status": "scheduled", "results": []})
        elif roll >= 92:
            match.update({"status": "forfeit", "results": [
                {"registration_id": home, "rank": 2, "outcome": "forfeit", "forfeit": True, "score": None},
                {"registration_id": away, "rank": 2, "outcome": "forfeit", "forfeit": True, "score": None}]})
        elif roll >= 84:
            match.update({"status": "forfeit", "results": [
                {"registration_id": winner, "rank": 1, "outcome": "winner", "score": 1},
                {"registration_id": loser, "rank": 2, "outcome": "forfeit", "forfeit": True, "score": None}]})
        else:
            match["results"] = [
                {"registration_id": winner, "rank": 1, "outcome": "winner", "score": 2},
                {"registration_id": loser, "rank": 2, "outcome": "placed", "score": loser_maps}]
        matches.append(match)
    gone = TEAMS[next(numbers) % len(TEAMS)] if seed % 2 else None
    registrations = [{"id": team, "display_name": team.title(), "status": "withdrawn" if team == gone else "approved",
                      **({"removal_at": "2026-10-01T10:00:00+00:00"} if team == gone else {})} for team in TEAMS]
    deductions = [{"registration_id": TEAMS[next(numbers) % len(TEAMS)], "points": 1 + seed % 2}] if seed % 3 == 0 else []
    return matches, registrations, deductions


RULES = {
    "vorgabe": copy.deepcopy(LEAGUE_TABLE_DEFAULTS),
    "maps": {**copy.deepcopy(LEAGUE_TABLE_DEFAULTS), "match_points_mode": "maps",
             "table_tiebreakers": ["wins", "head_to_head", "score_diff", "lead_decision"]},
    "alt": {"match_points": {"win": 3, "draw": 1, "loss": 0}, "table_tiebreakers": ["score_diff", "score_for"]},
}
SEEDS = (1, 2, 3, 4, 5, 6)
FIELDS = ("registration_id", "rank", "points", "played", "won", "lost", "drawn", "score_for", "score_against",
          "forfeit_won", "forfeit_lost", "deducted_points", "tiebreak", "previous_rank")


def table(seed, rules_key, **extra):
    matches, registrations, deductions = season(seed)
    tournament = {"id": f"staffel-{seed}", "format": "league", "best_of": 3, "scoring_rules": copy.deepcopy(RULES[rules_key]),
                  "point_deductions": deductions, **extra}
    rows = round_robin_standings(matches, registrations, table_rules(tournament), tournament=tournament)
    return [[row.get(field) for field in FIELDS] for row in rows]


# Erzeugt mit dem Stand von main vor #1559 (python backend/tests/test_league_table_regression_unit.py).
EXPECTED: dict = {"alt-1": [["gams", 1, 12, 5, 4, 1, 0, 9, 5, 0, 0, 0, None, 2],
           ["adler", 2, 9, 5, 3, 2, 0, 7, 6, 0, 1, 0, "score_for", 1],
           ["elster", 3, 9, 5, 3, 2, 0, 5, 4, 2, 0, 0, "score_for", 3],
           ["dachs", 4, 6, 5, 2, 3, 0, 5, 6, 0, 1, 0, "score_diff", 4],
           ["biber", 5, 6, 5, 2, 3, 0, 5, 7, 0, 0, 0, "score_diff", 5],
           ["falke", 6, 3, 5, 1, 4, 0, 5, 8, 0, 0, 0, None, 6]],
 "alt-2": [["gams", 1, 12, 5, 4, 1, 0, 8, 4, 0, 0, 0, None, 3],
           ["adler", 2, 9, 5, 3, 2, 0, 8, 6, 0, 0, 0, "score_diff", 2],
           ["falke", 3, 9, 5, 3, 2, 0, 6, 6, 1, 0, 0, "score_diff", 1],
           ["biber", 4, 6, 5, 2, 3, 0, 5, 6, 0, 1, 0, "score_diff", 4],
           ["elster", 5, 6, 5, 2, 3, 0, 5, 7, 0, 0, 0, "score_diff", 5],
           ["dachs", 6, 3, 5, 1, 4, 0, 6, 9, 0, 0, 0, None, 6]],
 "alt-3": [["dachs", 1, 12, 5, 4, 1, 0, 9, 4, 0, 0, 0, None, 1],
           ["elster", 2, 9, 5, 3, 2, 0, 5, 6, 1, 0, 0, None, 6],
           ["adler", 3, 6, 4, 2, 2, 0, 5, 4, 0, 1, 0, "score_diff", 2],
           ["falke", 4, 6, 5, 2, 3, 0, 7, 8, 0, 0, 0, "score_diff", 4],
           ["biber", 5, 4, 5, 2, 3, 0, 5, 6, 1, 0, 2, None, 3],
           ["gams", 6, 3, 4, 1, 3, 0, 3, 6, 0, 1, 0, None, 5]],
 "alt-4": [["falke", 1, 12, 5, 4, 1, 0, 9, 5, 0, 0, 0, "score_diff", 4],
           ["elster", 2, 12, 5, 4, 1, 0, 9, 6, 0, 0, 0, "score_diff", 1],
           ["adler", 3, 9, 5, 3, 2, 0, 7, 7, 0, 0, 0, None, 2],
           ["gams", 4, 6, 5, 2, 3, 0, 7, 6, 0, 0, 0, None, 3],
           ["biber", 5, 3, 5, 1, 4, 0, 5, 9, 0, 0, 0, None, 5],
           ["dachs", 5, 3, 5, 1, 4, 0, 5, 9, 0, 0, 0, None, 5]],
 "alt-5": [["gams", 1, 12, 5, 4, 1, 0, 7, 2, 1, 1, 0, None, 1],
           ["falke", 2, 9, 5, 3, 2, 0, 6, 4, 0, 1, 0, "score_diff", 4],
           ["dachs", 3, 9, 5, 3, 2, 0, 5, 5, 1, 0, 0, "score_diff", 2],
           ["adler", 4, 6, 4, 2, 2, 0, 5, 4, 0, 0, 0, None, 3],
           ["elster", 5, 3, 5, 1, 4, 0, 4, 8, 0, 1, 0, None, 5],
           ["biber", 6, 0, 4, 0, 4, 0, 3, 7, 0, 1, 0, None, 6]],
 "alt-6": [["gams", 1, 12, 4, 4, 0, 0, 8, 4, 0, 0, 0, None, 3],
           ["biber", 2, 9, 5, 3, 2, 0, 8, 5, 0, 0, 0, "score_diff", 1],
           ["dachs", 3, 9, 5, 3, 2, 0, 7, 5, 0, 0, 0, "score_diff", 2],
           ["adler", 4, 6, 4, 2, 2, 0, 5, 4, 0, 0, 0, None, 4],
           ["elster", 5, 3, 5, 1, 4, 0, 4, 9, 0, 0, 0, None, 5],
           ["falke", 6, 2, 5, 1, 4, 0, 3, 8, 0, 0, 1, None, 6]],
 "maps-1": [["gams", 1, 9, 5, 4, 1, 0, 9, 5, 1, 0, 0, None, 4],
            ["biber", 2, 7, 5, 3, 2, 0, 7, 5, 1, 0, 0, "head_to_head", 1],
            ["elster", 3, 7, 5, 3, 2, 0, 7, 4, 2, 0, 0, "head_to_head", 5],
            ["adler", 4, 7, 5, 3, 2, 0, 7, 6, 1, 1, 0, "head_to_head", 2],
            ["falke", 5, 6, 5, 2, 3, 0, 6, 6, 1, 0, 0, None, 3],
            ["dachs", 6, 0, 5, 0, 5, 0, 0, 10, 0, 5, 0, None, 6]],
 "maps-2": [["gams", 1, 8, 5, 4, 1, 0, 8, 4, 0, 0, 0, "wins", 5],
            ["adler", 2, 8, 5, 3, 2, 0, 8, 6, 0, 0, 0, "wins", 1],
            ["falke", 3, 7, 5, 3, 2, 0, 7, 6, 1, 0, 0, None, 2],
            ["dachs", 4, 6, 5, 1, 4, 0, 6, 9, 0, 0, 0, None, 3],
            ["biber", 5, 5, 5, 2, 3, 0, 5, 7, 0, 1, 0, "head_to_head", 4],
            ["elster", 6, 5, 5, 2, 3, 0, 5, 7, 0, 0, 0, "head_to_head", 6]],
 "maps-3": [["dachs", 1, 9, 5, 4, 1, 0, 9, 4, 1, 0, 0, None, 1],
            ["falke", 2, 7, 5, 2, 3, 0, 7, 7, 1, 0, 0, None, 4],
            ["elster", 3, 6, 5, 3, 2, 0, 6, 6, 1, 0, 0, None, 5],
            ["biber", 4, 5, 5, 3, 2, 0, 7, 4, 2, 0, 2, "wins", 2],
            ["adler", 5, 5, 4, 2, 2, 0, 5, 5, 0, 1, 0, "wins", 3],
            ["gams", 6, 0, 4, 0, 4, 0, 0, 8, 0, 4, 0, None, 6]],
 "maps-4": [["falke", 1, 9, 5, 4, 1, 0, 9, 5, 0, 0, 0, "head_to_head", 4],
            ["elster", 2, 9, 5, 4, 1, 0, 9, 6, 0, 0, 0, "head_to_head", 2],
            ["adler", 3, 7, 5, 3, 2, 0, 7, 7, 0, 0, 0, "wins", 1],
            ["gams", 4, 7, 5, 2, 3, 0, 7, 6, 0, 0, 0, "wins", 3],
            ["biber", 5, 5, 5, 1, 4, 0, 5, 9, 0, 0, 0, "head_to_head", 5],
            ["dachs", 6, 5, 5, 1, 4, 0, 5, 9, 0, 0, 0, "head_to_head", 6]],
 "maps-5": [["falke", 1, 8, 5, 4, 1, 0, 8, 2, 1, 1, 0, None, 1],
            ["gams", 1, 8, 5, 4, 1, 0, 8, 2, 2, 1, 0, None, 2],
            ["adler", 3, 5, 4, 2, 2, 0, 5, 4, 1, 0, 0, "head_to_head", 3],
            ["elster", 4, 5, 5, 2, 3, 0, 5, 7, 1, 1, 0, "head_to_head", 5],
            ["biber", 5, 5, 4, 1, 3, 0, 5, 6, 1, 0, 0, "wins", 4],
            ["dachs", 6, 0, 5, 0, 5, 0, 0, 10, 0, 5, 0, None, 6]],
 "maps-6": [["gams", 1, 8, 4, 4, 0, 0, 8, 4, 0, 0, 0, "wins", 4],
            ["biber", 2, 8, 5, 3, 2, 0, 8, 5, 0, 0, 0, "wins", 1],
            ["dachs", 3, 7, 5, 3, 2, 0, 7, 5, 0, 0, 0, None, 2],
            ["adler", 4, 5, 4, 2, 2, 0, 5, 4, 0, 0, 0, None, 3],
            ["elster", 5, 4, 5, 1, 4, 0, 4, 9, 0, 0, 0, None, 5],
            ["falke", 6, 2, 5, 1, 4, 0, 3, 8, 0, 0, 1, None, 6]],
 "vorgabe-1": [["gams", 1, 12, 5, 4, 1, 0, 9, 5, 1, 0, 0, None, 4],
               ["biber", 2, 9, 5, 3, 2, 0, 7, 5, 1, 0, 0, "head_to_head", 1],
               ["elster", 3, 9, 5, 3, 2, 0, 7, 4, 2, 0, 0, "head_to_head", 5],
               ["adler", 4, 9, 5, 3, 2, 0, 7, 6, 1, 1, 0, "head_to_head", 2],
               ["falke", 5, 6, 5, 2, 3, 0, 6, 6, 1, 0, 0, None, 3],
               ["dachs", 6, 0, 5, 0, 5, 0, 0, 10, 0, 5, 0, None, 6]],
 "vorgabe-2": [["gams", 1, 12, 5, 4, 1, 0, 8, 4, 0, 0, 0, None, 3],
               ["falke", 2, 9, 5, 3, 2, 0, 7, 6, 1, 0, 0, "head_to_head", 1],
               ["adler", 3, 9, 5, 3, 2, 0, 8, 6, 0, 0, 0, "head_to_head", 2],
               ["biber", 4, 6, 5, 2, 3, 0, 5, 7, 0, 1, 0, "head_to_head", 4],
               ["elster", 5, 6, 5, 2, 3, 0, 5, 7, 0, 0, 0, "head_to_head", 5],
               ["dachs", 6, 3, 5, 1, 4, 0, 6, 9, 0, 0, 0, None, 6]],
 "vorgabe-3": [["dachs", 1, 12, 5, 4, 1, 0, 9, 4, 1, 0, 0, None, 1],
               ["elster", 2, 9, 5, 3, 2, 0, 6, 6, 1, 0, 0, None, 5],
               ["biber", 3, 7, 5, 3, 2, 0, 7, 4, 2, 0, 2, None, 2],
               ["adler", 4, 6, 4, 2, 2, 0, 5, 5, 0, 1, 0, "head_to_head", 3],
               ["falke", 5, 6, 5, 2, 3, 0, 7, 7, 1, 0, 0, "head_to_head", 4],
               ["gams", 6, 0, 4, 0, 4, 0, 0, 8, 0, 4, 0, None, 6]],
 "vorgabe-4": [["falke", 1, 12, 5, 4, 1, 0, 9, 5, 0, 0, 0, "head_to_head", 4],
               ["elster", 2, 12, 5, 4, 1, 0, 9, 6, 0, 0, 0, "head_to_head", 1],
               ["adler", 3, 9, 5, 3, 2, 0, 7, 7, 0, 0, 0, None, 2],
               ["gams", 4, 6, 5, 2, 3, 0, 7, 6, 0, 0, 0, None, 3],
               ["biber", 5, 3, 5, 1, 4, 0, 5, 9, 0, 0, 0, "head_to_head", 5],
               ["dachs", 6, 3, 5, 1, 4, 0, 5, 9, 0, 0, 0, "head_to_head", 6]],
 "vorgabe-5": [["falke", 1, 12, 5, 4, 1, 0, 8, 2, 1, 1, 0, None, 1],
               ["gams", 1, 12, 5, 4, 1, 0, 8, 2, 2, 1, 0, None, 2],
               ["adler", 3, 6, 4, 2, 2, 0, 5, 4, 1, 0, 0, "head_to_head", 3],
               ["elster", 4, 6, 5, 2, 3, 0, 5, 7, 1, 1, 0, "head_to_head", 4],
               ["biber", 5, 3, 4, 1, 3, 0, 5, 6, 1, 0, 0, None, 5],
               ["dachs", 6, 0, 5, 0, 5, 0, 0, 10, 0, 5, 0, None, 6]],
 "vorgabe-6": [["gams", 1, 12, 4, 4, 0, 0, 8, 4, 0, 0, 0, None, 3],
               ["biber", 2, 9, 5, 3, 2, 0, 8, 5, 0, 0, 0, "head_to_head", 1],
               ["dachs", 3, 9, 5, 3, 2, 0, 7, 5, 0, 0, 0, "head_to_head", 2],
               ["adler", 4, 6, 4, 2, 2, 0, 5, 4, 0, 0, 0, None, 4],
               ["elster", 5, 3, 5, 1, 4, 0, 4, 9, 0, 0, 0, None, 5],
               ["falke", 6, 2, 5, 1, 4, 0, 3, 8, 0, 0, 1, None, 6]]}


@pytest.mark.parametrize("rules_key", sorted(RULES))
@pytest.mark.parametrize("seed", SEEDS)
def test_league_tables_are_what_they_were_before(seed, rules_key):
    assert table(seed, rules_key) == EXPECTED[f"{rules_key}-{seed}"]


@pytest.mark.parametrize("seed", SEEDS)
def test_the_tournament_settings_of_1559_do_not_reach_a_league_staffel(seed):
    """Eine Staffel rechnet nach den Regeln ihrer Season (``scoring_rules``) - die neuen Turnier-Felder ändern daran nichts."""
    plain = table(seed, "vorgabe")

    with_new_fields = table(seed, "vorgabe", table_tiebreakers=["wins", "score_for"],
                            swiss_settings={"end_rule": "rounds", "rounds": 2, "tiebreakers": ["median_buchholz"]})

    assert with_new_fields == plain


def test_the_league_format_goes_through_the_same_table_from_the_structure():
    matches, registrations, deductions = season(2)
    tournament = {"id": "staffel", "format": "league", "best_of": 3, "scoring_rules": copy.deepcopy(RULES["vorgabe"]),
                  "point_deductions": deductions, "table_tiebreakers": ["wins"]}
    snapshot = {"matches": [{**match, "source": {"engine": "stage"}} for match in matches]}

    rows = standings_for_structure(tournament, snapshot, registrations)

    assert [[row.get(field) for field in FIELDS] for row in rows] == EXPECTED["vorgabe-2"]


if __name__ == "__main__":
    import pprint

    pprint.pprint({f"{rules_key}-{seed}": table(seed, rules_key) for rules_key in sorted(RULES) for seed in SEEDS}, width=160)
