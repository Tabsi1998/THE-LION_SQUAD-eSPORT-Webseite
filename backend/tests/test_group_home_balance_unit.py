"""Heimrecht in Gruppen (#1559): in der Gruppenphase und bei „Jeder gegen jeden – einfach“ stand der beste Setzplatz
einer Gruppe in jedem Spiel zuerst (Heim). Jetzt ist das Heimrecht je Gruppe fair verteilt - höchstens ein Heimspiel
mehr oder weniger als Auswärtsspiele -, über dieselbe Rechnung wie die Liga mit einfacher Runde (``balanced_home``).
"""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.custom_bracket import (  # noqa: E402
    _auto_groups_schema,
    _round_robin_rounds,
    build_matches_v2_from_schema,
    distribute_into_groups,
    infer_rounds,
    parse_custom_bracket_schema,
)

SHAPES = [(3, 1), (4, 1), (5, 1), (6, 1), (7, 1), (8, 1), (8, 2), (9, 3), (10, 2), (12, 3), (16, 4), (13, 3), (32, 8)]


def fixtures(slot_count, group_count):
    """Je Spiel: Gruppe, Spieltag, Heim-Setzplatz, Auswärts-Setzplatz."""
    specs = parse_custom_bracket_schema(_auto_groups_schema(slot_count, group_count))
    rounds = infer_rounds(specs)
    return [(spec.section, rounds[spec.key], spec.sources[0]["seed"], spec.sources[1]["seed"]) for spec in specs]


@pytest.mark.parametrize("slot_count,group_count", SHAPES)
def test_everyone_has_at_most_one_home_game_more_or_less(slot_count, group_count):
    home: dict[int, int] = {}
    away: dict[int, int] = {}
    for _section, _matchday, first, second in fixtures(slot_count, group_count):
        home[first] = home.get(first, 0) + 1
        away[second] = away.get(second, 0) + 1

    for seed in range(1, slot_count + 1):
        assert abs(home.get(seed, 0) - away.get(seed, 0)) <= 1, f"Setzplatz {seed}: {home.get(seed, 0)} Heim, {away.get(seed, 0)} Auswärts"


def test_the_top_seed_no_longer_hosts_every_match():
    """Vorher: Setzplatz 1 einer Vierergruppe dreimal Heim. Jetzt höchstens zweimal."""
    hosted = [first for _section, _matchday, first, _second in fixtures(4, 1)]

    assert hosted.count(1) <= 2


@pytest.mark.parametrize("slot_count,group_count", SHAPES)
def test_pairings_and_matchdays_stay_exactly_as_they_were(slot_count, group_count):
    """Nur die Seiten werden gedreht - wer wann gegen wen spielt, bleibt."""
    expected = set()
    for seeds in distribute_into_groups(slot_count, group_count):
        for matchday, pairs in enumerate(_round_robin_rounds(seeds), start=1):
            expected.update((matchday, frozenset(pair)) for pair in pairs)

    found = [(matchday, frozenset((first, second))) for _section, matchday, first, second in fixtures(slot_count, group_count)]

    assert len(found) == len(set(found)) == len(expected)
    assert set(found) == expected


def test_the_same_field_always_gives_the_same_schedule():
    assert _auto_groups_schema(13, 3) == _auto_groups_schema(13, 3)


def test_the_generated_matches_carry_the_balanced_sides():
    """Bis ins Spiel: Platz 1 ist die Heimseite - über alle Spiele einer Gruppe fair verteilt."""
    tournament = {"id": "t1", "format": "groups", "seeding_mode": "manual"}
    stage = {"id": "s1", "number": 1, "stage_type": "round_robin_groups", "match_type": "duel",
             "settings": {"group_count": 2, "min_players": 2, "match_size": 2}}
    registrations = [{"id": f"reg{index}", "user_id": f"user{index}", "seed": index, "status": "approved"}
                     for index in range(1, 9)]

    matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=False)

    balance: dict[str, int] = {}
    for match in matches:
        slots = sorted(match["slots"], key=lambda slot: slot["slot"])
        balance[slots[0]["registration_id"]] = balance.get(slots[0]["registration_id"], 0) + 1
        balance[slots[1]["registration_id"]] = balance.get(slots[1]["registration_id"], 0) - 1
    assert len(matches) == 12
    assert set(balance) == {f"reg{index}" for index in range(1, 9)}
    assert all(abs(value) <= 1 for value in balance.values()), balance
