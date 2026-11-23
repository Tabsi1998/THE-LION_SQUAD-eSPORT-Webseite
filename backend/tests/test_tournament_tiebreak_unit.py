"""Gleichstand in Turnier-Tabellen (#1559): direkter Vergleich für Gruppen und „Jeder gegen jeden“ mit derselben
Rechnung wie die Liga-Staffel, Median-Buchholz und einstellbare Reihenfolge im Schweizer System - als Tabelle von
Fällen. Ohne Einstellung bleibt jede Tabelle, wie sie war. Nur erfundene Namen.
"""
import copy
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services.competition_standings import (  # noqa: E402
    LEGACY_TABLE_TIEBREAKERS,
    TOURNAMENT_TABLE_TIEBREAKERS,
    group_standings,
    placements_for_structure,
    round_robin_standings,
    standings_for_structure,
    swiss_standings,
    table_rules,
    tournament_table_tiebreakers,
)
from services.scoring_rules import LEAGUE_TABLE_DEFAULTS  # noqa: E402
from test_league_tiebreak_unit import CASES, _circle_with_extra, _two_teams_direct, duel, regs  # noqa: E402

DIRECT = {"table_tiebreakers": ["head_to_head", "score_diff", "score_for"]}
# Die Liga-Regeln, die dasselbe ohne Liga-Besonderheiten rechnen: 3/1/0, kein Entscheid der Leitung, kampflos wie eingetragen.
LEAGUE_TWIN = table_rules({"scoring_rules": {
    **copy.deepcopy(LEAGUE_TABLE_DEFAULTS), "match_points": {"win": 3, "draw": 1, "loss": 0}, "allow_draws": True,
    "table_tiebreakers": ["head_to_head", "score_diff", "score_for"], "forfeit_score": "recorded", "exit_rule": "half"}})


def order(rows):
    return [row["registration_id"] for row in rows]


def by_id(rows):
    return {row["registration_id"]: row for row in rows}


def ranks(rows):
    return {row["registration_id"]: row["rank"] for row in rows}


def staged(matches):
    return {"matches": [{**match, "source": {"engine": "stage"}} for match in matches]}


# ---------------------------------------------------------------- Gruppen und Jeder gegen jeden

def test_without_the_setting_a_table_ranks_as_before():
    """Punkte, Siege, Differenz - und keine neuen Felder in der Zeile."""
    rows = round_robin_standings(_two_teams_direct(), regs("a", "b", "c", "d"), None, tournament={"format": "round_robin"})

    assert order(rows) == ["d", "a", "b", "c"]
    assert all("tiebreak" not in row for row in rows)
    assert tournament_table_tiebreakers({"format": "groups"}) is None
    assert tournament_table_tiebreakers({"table_tiebreakers": None}) is None


def test_the_old_order_can_be_chosen_explicitly():
    plain = round_robin_standings(_circle_with_extra(), regs("a", "b", "c", "d"), None)
    chosen = round_robin_standings(_circle_with_extra(), regs("a", "b", "c", "d"), None,
                                   tournament={"table_tiebreakers": list(LEGACY_TABLE_TIEBREAKERS)})

    assert order(chosen) == order(plain) and ranks(chosen) == ranks(plain)


def test_the_direct_match_decides_between_two():
    """a und b je 3 Punkte; b gewann das Spiel gegen a, a hat gesamt die bessere Differenz."""
    rows = round_robin_standings(_two_teams_direct(), regs("a", "b", "c", "d"), None, tournament=DIRECT)

    assert order(rows) == ["d", "b", "a", "c"]
    assert by_id(rows)["a"]["tiebreak"] == by_id(rows)["b"]["tiebreak"] == "head_to_head"


@pytest.mark.parametrize("label,build,names,expected,tiebreaks", CASES, ids=[case[0] for case in CASES])
def test_the_league_cases_give_the_same_table_in_a_tournament(label, build, names, expected, tiebreaks):
    """Dieselben Fälle wie in der Liga (Mini-Tabelle bei drei und mehr, Restgruppe neu gerechnet, unvollständiger
    Vergleich übersprungen) - mit der Turnier-Einstellung dieselbe Reihenfolge und derselbe Grund."""
    rows = round_robin_standings(build(), regs(*names), None, tournament=DIRECT)

    assert order(rows) == expected, label
    found = by_id(rows)
    for registration_id, criterion in tiebreaks.items():
        assert found[registration_id]["tiebreak"] == criterion, (label, registration_id)


def simulated(seed, teams=5):
    """Eine einfache Runde mit festen Zahlen (ohne Zufallsmodul): viele Punktgleiche, auch Unentschieden."""
    names = [chr(ord("a") + index) for index in range(teams)]
    state = seed * 7919 % 104729 or 1
    matches = []
    number = 0
    for left in range(teams):
        for right in range(left + 1, teams):
            state = state * 16807 % 2147483647
            score_a, score_b = state % 3, (state // 3) % 3
            number += 1
            matches.append(duel(names[left], names[right], score_a, score_b, round_number=number))
    return names, matches


@pytest.mark.parametrize("seed", range(1, 41))
def test_tournament_and_league_share_one_calculation(seed):
    """Eine gemeinsame Stelle: für beliebige Spielpläne rechnet die Turnier-Tabelle Platz und Grund wie die Liga-Staffel
    mit denselben Kriterien."""
    names, matches = simulated(seed)

    tournament_rows = round_robin_standings(matches, regs(*names), None, tournament=DIRECT)
    league_rows = round_robin_standings(matches, regs(*names), LEAGUE_TWIN)

    def shape(rows):
        return [(row["registration_id"], row["rank"], row["points"], row["tiebreak"]) for row in rows]

    assert shape(tournament_rows) == shape(league_rows)


def test_every_group_gets_its_own_direct_comparison():
    group_a = [{**match, "section": "group_A"} for match in _two_teams_direct()]
    group_b = [{**duel("e", "f", 2, 0), "section": "group_B"}]
    groups = [{"id": "ga", "group_key": "A", "participant_ids": ["a", "b", "c", "d"]},
              {"id": "gb", "group_key": "B", "participant_ids": ["e", "f"]}]
    everyone = regs("a", "b", "c", "d", "e", "f")

    before = group_standings(group_a + group_b, everyone, groups)
    after = group_standings(group_a + group_b, everyone, groups, tournament=DIRECT)

    assert order(before[0]["standings"]) == ["d", "a", "b", "c"]
    assert order(after[0]["standings"]) == ["d", "b", "a", "c"]
    assert order(after[1]["standings"]) == ["e", "f"]


@pytest.mark.parametrize("format_key", ["round_robin", "league"])
def test_the_structure_uses_the_setting_for_everyone_against_everyone(format_key):
    tournament = {"id": "t", "format": format_key, **DIRECT}

    rows = standings_for_structure(tournament, staged(_two_teams_direct()), regs("a", "b", "c", "d"))
    places = placements_for_structure(staged(_two_teams_direct()), regs("a", "b", "c", "d"), tournament=tournament)

    assert order(rows) == ["d", "b", "a", "c"]
    assert [places[rank][0]["registration_id"] for rank in (1, 2, 3, 4)] == ["d", "b", "a", "c"]


def test_the_structure_uses_the_setting_for_groups():
    matches = [{**match, "section": "group_A"} for match in _two_teams_direct()]
    groups = [{"id": "ga", "group_key": "A", "participant_ids": ["a", "b", "c", "d"]}]

    [group] = standings_for_structure({"id": "t", "format": "groups", **DIRECT}, staged(matches), regs("a", "b", "c", "d"),
                                      groups=groups)

    assert order(group["standings"]) == ["d", "b", "a", "c"]


def test_unknown_criteria_are_dropped_and_the_values_match_the_model():
    assert tournament_table_tiebreakers({"table_tiebreakers": ["head_to_head", "lead_decision", "wins", "wins"]}) == [
        "head_to_head", "wins"]
    assert tournament_table_tiebreakers({"table_tiebreakers": []}) == []

    from typing import get_args

    import models

    assert get_args(models.TableTiebreaker) == TOURNAMENT_TABLE_TIEBREAKERS


def test_a_league_staffel_ignores_the_tournament_setting():
    staffel = {"scoring_rules": copy.deepcopy(LEAGUE_TABLE_DEFAULTS), "table_tiebreakers": ["wins"]}

    assert tournament_table_tiebreakers(staffel) is None


# ---------------------------------------------------------------- Schweizer System

def bye(player, round_number):
    return {"id": f"bye-{player}-{round_number}", "round": round_number, "status": "completed",
            "slots": [{"position": 1, "registration_id": player}, {"position": 2, "registration_id": None}],
            "results": [{"registration_id": player, "rank": 1, "outcome": "winner"}]}


def swiss(**settings):
    return {"format": "swiss", "swiss_settings": settings}


def three_rounds():
    """Acht Teilnehmer, drei Runden, niemand trifft jemanden zweimal. Am Ende: a 3; b, c, e je 2; d, f, g je 1; h 0."""
    return [
        duel("a", "h", 1, 0, round_number=1), duel("b", "g", 1, 0, round_number=1),
        duel("c", "f", 1, 0, round_number=1), duel("e", "d", 1, 0, round_number=1),
        duel("a", "b", 1, 0, round_number=2), duel("c", "e", 1, 0, round_number=2),
        duel("d", "h", 1, 0, round_number=2), duel("f", "g", 1, 0, round_number=2),
        duel("a", "c", 1, 0, round_number=3), duel("b", "f", 1, 0, round_number=3),
        duel("e", "h", 1, 0, round_number=3), duel("g", "d", 1, 0, round_number=3),
    ]


EIGHT = ("a", "b", "c", "d", "e", "f", "g", "h")


def test_swiss_without_settings_is_unchanged():
    rows = swiss_standings(three_rounds(), regs(*EIGHT))

    assert rows[0]["registration_id"] == "a"
    assert all(set(row) >= {"points", "buchholz", "won"} for row in rows)
    assert all(key not in row for row in rows for key in ("median_buchholz", "tiebreak", "swiss_status"))
    # Punkte, Buchholz, Siege - wie vor #1559.
    keys = [(row["points"], row["buchholz"], row["won"]) for row in rows]
    assert keys == sorted(keys, reverse=True)


def test_buchholz_and_median_buchholz_of_one_row():
    """c spielte gegen f (1), e (2) und a (3): Buchholz 6, Median-Buchholz ohne den Besten und den Schlechtesten 2."""
    rows = by_id(swiss_standings(three_rounds(), regs(*EIGHT), swiss(tiebreakers=["median_buchholz", "buchholz"])))

    assert (rows["c"]["buchholz"], rows["c"]["median_buchholz"]) == (6, 2)
    assert (rows["b"]["buchholz"], rows["b"]["median_buchholz"]) == (5, 1)
    assert (rows["e"]["buchholz"], rows["e"]["median_buchholz"]) == (3, 1)


def test_fewer_than_three_opponents_keep_the_plain_sum():
    """Mit einem oder zwei Gegnern bliebe nach dem Streichen nichts übrig - dann zählt die einfache Summe."""
    matches = [duel("a", "b", 1, 0, round_number=1), duel("a", "c", 1, 0, round_number=2), bye("c", 1), bye("b", 2)]

    rows = by_id(swiss_standings(matches, regs("a", "b", "c"), swiss(tiebreakers=["median_buchholz"])))

    assert rows["a"]["median_buchholz"] == rows["a"]["buchholz"] == 2
    assert rows["b"]["median_buchholz"] == rows["b"]["buchholz"] == 2


def test_the_order_of_the_swiss_tiebreakers_is_the_chosen_one():
    """b, c, e stehen mit 2 Punkten gleich. Median-Buchholz zuerst: c (2) vor b und e (je 1), die das Buchholz trennt
    (5 zu 3)."""
    median_first = swiss_standings(three_rounds(), regs(*EIGHT), swiss(tiebreakers=["median_buchholz", "buchholz"]))
    assert order(median_first)[:4] == ["a", "c", "b", "e"]
    assert [by_id(median_first)[key]["tiebreak"] for key in "cbe"] == ["median_buchholz", "buchholz", "buchholz"]

    only_median = swiss_standings(three_rounds(), regs(*EIGHT), swiss(tiebreakers=["median_buchholz"]))
    assert ranks(only_median)["b"] == ranks(only_median)["e"] == 3, "ohne weiteres Kriterium teilen sich beide den Platz"

    points_only = swiss_standings(three_rounds(), regs(*EIGHT), swiss(tiebreakers=[]))
    assert [ranks(points_only)[key] for key in "bce"] == [2, 2, 2]


def test_the_direct_match_counts_in_swiss_only_when_all_tied_have_met():
    """c schlug e. Mit direktem Vergleich zuerst trennt das die beiden nicht von b, weil b gegen keinen von beiden
    gespielt hat - es bleibt bei Buchholz. Stehen nur c und e gleich, entscheidet ihr Spiel."""
    with_b = swiss_standings(three_rounds(), regs(*EIGHT), swiss(tiebreakers=["head_to_head", "buchholz"]))
    assert order(with_b)[1:4] == ["c", "b", "e"]
    assert by_id(with_b)["c"]["tiebreak"] == "buchholz"

    # Zwei Runden, vier Teilnehmer: a 2; c und e je 1 mit gleichem Buchholz; x 0. c schlug e nicht - sie trafen sich nie.
    never_met = [duel("a", "c", 1, 0, round_number=1), duel("e", "x", 1, 0, round_number=1),
                 duel("a", "e", 1, 0, round_number=2), duel("c", "x", 1, 0, round_number=2)]
    rows = swiss_standings(never_met, regs("a", "c", "e", "x"), swiss(tiebreakers=["head_to_head"]))
    assert ranks(rows)["c"] == ranks(rows)["e"] == 2

    met = [duel("c", "e", 1, 0, round_number=1), duel("a", "x", 1, 0, round_number=1),
           duel("a", "c", 1, 0, round_number=2), duel("e", "x", 1, 0, round_number=2)]
    rows = swiss_standings(met, regs("a", "c", "e", "x"), swiss(tiebreakers=["head_to_head"]))
    assert order(rows) == ["a", "c", "e", "x"]
    assert by_id(rows)["c"]["tiebreak"] == by_id(rows)["e"]["tiebreak"] == "head_to_head"


def test_a_bye_is_a_win_without_an_opponent_for_buchholz():
    matches = [duel("a", "b", 1, 0, round_number=1), bye("c", 1)]

    rows = by_id(swiss_standings(matches, regs("a", "b", "c"), swiss(tiebreakers=["median_buchholz", "buchholz"])))

    assert (rows["c"]["points"], rows["c"]["won"], rows["c"]["buchholz"], rows["c"]["median_buchholz"]) == (1, 1, 0, 0)


def test_wins_and_losses_mark_who_advanced_and_who_is_out():
    matches = [duel("a", "b", 1, 0, round_number=1), duel("c", "d", 1, 0, round_number=1),
               duel("a", "c", 1, 0, round_number=2), duel("d", "b", 1, 0, round_number=2)]

    rows = by_id(swiss_standings(matches, regs("a", "b", "c", "d"),
                                 swiss(end_rule="wins_losses", wins_to_advance=2, losses_to_exit=2)))

    assert rows["a"]["swiss_status"] == "advanced"
    assert rows["b"]["swiss_status"] == "eliminated"
    assert "swiss_status" not in rows["c"] and "swiss_status" not in rows["d"]


def test_the_top_n_advance_once_all_rounds_are_played():
    settings = swiss(end_rule="rounds", rounds=3, top_n=4, tiebreakers=["median_buchholz", "buchholz"])

    running = swiss_standings(three_rounds()[:8], regs(*EIGHT), settings)
    done = swiss_standings(three_rounds(), regs(*EIGHT), settings)

    assert all("swiss_status" not in row for row in running), "vor der letzten Runde ist noch niemand weiter"
    assert [row["registration_id"] for row in done if row.get("swiss_status") == "advanced"] == ["a", "c", "b", "e"]


def test_a_tie_at_the_last_advancing_place_is_named_instead_of_advancing_everyone():
    """Zwei kommen weiter, aber b, c und e teilen sich Platz 2 und nichts trennt sie. Sicher weiter ist nur a - die drei
    stehen am „Gleichstand an der Grenze“. Vorher galten alle vier als weiter."""
    settings = swiss(end_rule="rounds", rounds=3, top_n=2, tiebreakers=[])

    done = by_id(swiss_standings(three_rounds(), regs(*EIGHT), settings))

    assert done["a"]["swiss_status"] == "advanced"
    assert [done[key]["swiss_status"] for key in "bce"] == ["tied", "tied", "tied"]
    assert all("swiss_status" not in done[key] for key in "dfgh")


def test_a_tie_inside_the_advancing_places_changes_nothing():
    """Vier kommen weiter: a und die drei Punktgleichen auf Platz 2 - der Gleichstand liegt nicht an der Grenze."""
    settings = swiss(end_rule="rounds", rounds=3, top_n=4, tiebreakers=[])

    done = by_id(swiss_standings(three_rounds(), regs(*EIGHT), settings))

    assert sorted(key for key, row in done.items() if row.get("swiss_status") == "advanced") == ["a", "b", "c", "e"]
    assert not [key for key, row in done.items() if row.get("swiss_status") == "tied"]


def test_someone_who_left_is_never_marked_as_advanced():
    settings = swiss(end_rule="rounds", rounds=3, top_n=4)
    registrations = regs(*EIGHT, c="withdrawn")

    done = by_id(swiss_standings(three_rounds(), registrations, settings))

    assert "swiss_status" not in done["c"]


def test_the_structure_and_the_placements_use_the_swiss_settings():
    tournament = {"id": "t", **swiss(tiebreakers=["median_buchholz", "buchholz"])}

    rows = standings_for_structure(tournament, staged(three_rounds()), regs(*EIGHT))
    places = placements_for_structure(staged(three_rounds()), regs(*EIGHT), tournament=tournament)

    assert order(rows)[:4] == ["a", "c", "b", "e"]
    assert [places[rank][0]["registration_id"] for rank in (1, 2, 3, 4)] == ["a", "c", "b", "e"]
