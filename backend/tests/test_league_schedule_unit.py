"""Liga P2 (docs/LIGA.md, #1624): Spielplan nur mit Hinrunde und fairem Heimrecht (auch gemischt und neu ausgelost),
Runden-Prüfung beim Erzeugen. Ohne round_robin_legs bleibt die Liga Hin- und Rückrunde wie bisher.
"""
import pathlib
import random
import re
import sys
from collections import Counter

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import custom_bracket  # noqa: E402
from services.advancement_draw import league_home_swaps, shuffle_league_rounds  # noqa: E402
from services.custom_bracket import build_matches_v2_from_schema  # noqa: E402

# Season 1: Di 10.11.2026 00:00 Wien, 10 Wochen, Weihnachtspause 21.12.–3.1. → Wochen 7 und 8 gesperrt.
SEASON_ONE = {
    "id": "staffel-a", "format": "league", "event_mode": "online", "start_date": "2026-11-09T23:00:00+00:00",
    "matchday_days": 7, "default_match_weekday": 6, "default_match_time": "20:00",
    "matchday_blocked_weeks": [7, 8], "matchday_weeks_total": 10, "round_robin_legs": 1,
    "blocked_periods": [{"start_date": "2026-12-21", "end_date": "2027-01-03", "label": "Weihnachtspause"}],
}


def fixtures(schema: str) -> list[list[tuple[int, int]]]:
    days: list[list[tuple[int, int]]] = []
    for line in schema.splitlines():
        if line.startswith("# Spieltag"):
            days.append([])
            continue
        found = re.match(r"^\w+=\[(\d+),(\d+)\]$", line.strip())
        if found:
            days[-1].append((int(found.group(1)), int(found.group(2))))
    return days


def assert_single_round_robin(days, teams: int):
    pairs = [pair for day in days for pair in day]
    assert len(pairs) == teams * (teams - 1) // 2
    assert len({frozenset(pair) for pair in pairs}) == len(pairs)  # jeder gegen jeden genau einmal
    assert len(days) == (teams - 1 if teams % 2 == 0 else teams)
    for day in days:
        playing = [team for pair in day for team in pair]
        assert len(playing) == len(set(playing))  # niemand zweimal am selben Spieltag
    home = Counter(home for home, _away in pairs)
    away = Counter(away for _home, away in pairs)
    for team in range(1, teams + 1):
        assert abs(home[team] - away[team]) <= 1, (team, home[team], away[team])
    if teams % 2:
        byes = Counter(team for day in days for team in range(1, teams + 1)
                       if team not in {member for pair in day for member in pair})
        assert all(byes[team] == 1 for team in range(1, teams + 1))  # jedes Team einmal spielfrei


# ---------------------------------------------------------------- Hinrunde mit fairem Heimrecht

@pytest.mark.parametrize("teams", [2, 3, 4, 5, 6, 7, 8, 9, 10, 12])
def test_single_leg_plays_everyone_once_with_fair_home_right(teams):
    assert_single_round_robin(fixtures(custom_bracket._auto_league_schema(teams, legs=1)), teams)


@pytest.mark.parametrize("teams", [4, 5, 8])
def test_a_shuffled_single_leg_keeps_the_home_right_fair(teams):
    for seed in range(20):
        schema = custom_bracket._auto_league_schema(teams, random.Random(seed), legs=1)
        assert_single_round_robin(fixtures(schema), teams)


def test_home_and_away_stays_exactly_as_before():
    """Ohne round_robin_legs (oder mit 2): Hinrunde nach der Kreismethode, Rückrunde gespiegelt - wie bisher."""
    seeds = list(range(1, 7))
    first = custom_bracket._round_robin_rounds(seeds)
    expected = first + [[(away, home) for home, away in pairs] for pairs in first]
    assert fixtures(custom_bracket._auto_league_schema(6)) == expected
    assert fixtures(custom_bracket._auto_league_schema(6, legs=2)) == expected
    assert custom_bracket.league_legs({}) == 2
    assert custom_bracket.league_legs({"round_robin_legs": 1}) == 1
    assert custom_bracket.league_legs({"round_robin_legs": 2}, {"settings": {"round_robin_legs": 1}}) == 1


def test_the_draw_helpers_keep_a_single_leg_balanced():
    rounds = custom_bracket.balanced_home(custom_bracket._round_robin_rounds([1, 2, 3, 4]))
    for seed in range(10):
        swapped = shuffle_league_rounds(rounds, random.Random(seed), balanced=True)
        assert_single_round_robin(swapped, 4)
    pairs = {frozenset({"a", "b"}), frozenset({"a", "c"}), frozenset({"b", "c"})}
    for seed in range(10):
        assert len(set(league_home_swaps(pairs, mirrored=False, rng=random.Random(seed)).values())) == 1


def test_building_a_staffel_plays_only_the_first_leg():
    stage = {"id": "s1", "stage_type": "league", "settings": {}}
    registrations = [{"id": f"r{index}", "status": "approved", "seed": index} for index in range(1, 9)]
    matches = build_matches_v2_from_schema({**SEASON_ONE, "max_participants": 8}, stage, registrations)
    assert len(matches) == 28
    assert max(match["round"] for match in matches) == 7
    legacy = build_matches_v2_from_schema({"id": "t", "format": "league", "max_participants": 8}, stage, registrations)
    assert len(legacy) == 56  # ohne Feld: Hin- und Rückrunde wie bisher


def test_redrawing_a_single_leg_league_keeps_the_home_right_fair():
    from services.match_v2_results import build_league_redraw_application

    stage = {"id": "s1", "stage_type": "league", "settings": {}}
    registrations = [{"id": f"r{index}", "status": "approved", "seed": index} for index in range(1, 9)]
    for seed in range(10):
        matches = build_matches_v2_from_schema({**SEASON_ONE, "max_participants": 8}, stage, registrations)
        for match in matches:
            match["draw"] = {"kind": "league"}
            match["stage_id"] = "s1"
        build_league_redraw_application(matches, now_iso="2026-11-01T10:00:00+00:00", rng=random.Random(seed))
        home = Counter(match["slots"][0]["registration_id"] for match in matches)
        away = Counter(match["slots"][1]["registration_id"] for match in matches)
        assert all(abs(home[reg["id"]] - away[reg["id"]]) <= 1 for reg in registrations), seed
        assert sorted({match["round"] for match in matches}) == list(range(1, 8))
