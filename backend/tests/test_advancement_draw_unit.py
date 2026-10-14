"""Gegner der nächsten Runde mischen (#1548): echtes Los nach jeder Runde.

Alle Weiterkommer einer Runde kommen in einen Topf, werden gemischt und gleichmäßig auf die Folgespiele verteilt -
erst wenn die ganze Runde fertig ist. Laufen nur zwei Spiele in eines zusammen, ändert Mischen nichts. Die Zufallsquelle
ist ``secrets``: die statistischen Tests hier laufen ohne festen Startwert.
"""
import pathlib
import sys
from collections import Counter

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.advancement_draw import (  # noqa: E402
    advancement_shuffle_enabled,
    assign_balanced,
    group_sources,
    group_targets,
    prerequisite_ids,
)
from services.custom_bracket import build_matches_v2_from_schema  # noqa: E402
from services.match_v2_results import (  # noqa: E402
    MatchV2ResultError,
    build_redraw_application,
    build_v2_result_application,
)

NOW = "2026-10-14T10:00:00+00:00"
SHUFFLE = {"randomize_advancement_rounds": True}


def registrations(count: int) -> list[dict]:
    return [{"id": f"r{i}", "user_id": f"u{i}", "status": "approved", "seed": i} for i in range(1, count + 1)]


def build(count: int, stage_type: str, match_type: str = "duel", settings: dict | None = None,
          tournament: dict | None = None) -> list[dict]:
    base = {"id": "t", "seeding_mode": "manual", "max_participants": count, **(tournament or {})}
    stage = {"id": "s", "number": 1, "stage_type": stage_type, "match_type": match_type, "settings": settings or {}}
    return build_matches_v2_from_schema(base, stage, registrations(count))


def by_key(matches: list[dict]) -> dict[str, dict]:
    return {m["match_key"]: m for m in matches}


def filled_ids(match: dict) -> list[str]:
    return [s["registration_id"] for s in match["slots"] if s.get("status") == "filled" and s.get("registration_id")]


def apply(matches: list[dict], match: dict, ranking: list[str], *, force: bool = False) -> dict:
    raw = [{"registration_id": reg, "rank": index + 1} for index, reg in enumerate(ranking)]
    application = build_v2_result_application(match, matches, raw, actor_id="staff", now_iso=NOW, force=force)
    match.update(application["match_set"])
    rows = {row["id"]: row for row in matches}
    for target_id, update in application["target_sets"].items():
        rows[target_id].update(update)
    return application


def apply_sets(matches: list[dict], application: dict) -> None:
    rows = {row["id"]: row for row in matches}
    for target_id, update in application["target_sets"].items():
        rows[target_id].update(update)


def lower_seed_wins(match: dict) -> list[str]:
    return sorted(filled_ids(match), key=lambda reg: int(reg[1:]))


# ---------------------------------------------------------------------------------------------- Einstellung

def test_setting_stage_overrides_tournament_both_ways():
    assert advancement_shuffle_enabled({}, {}) is False
    assert advancement_shuffle_enabled(SHUFFLE, {}) is True
    assert advancement_shuffle_enabled(SHUFFLE, {"randomize_advancement_rounds": False}) is False
    assert advancement_shuffle_enabled({}, {"randomize_advancement_rounds": True}) is True
    # Leer in der Phase heißt: vom Turnier erben.
    assert advancement_shuffle_enabled(SHUFFLE, {"randomize_advancement_rounds": None}) is True


def test_fixed_tree_has_no_draw_groups():
    matches = build(8, "single_elimination")
    assert not any((m.get("settings") or {}).get("draw_group") for m in matches)


def test_shuffle_marks_following_rounds_as_draw_groups():
    matches = build(8, "single_elimination", tournament=SHUFFLE)
    keys = by_key(matches)
    # Runde 2 (E, F) ist eine Gruppe; das Finale G bekommt nur zwei Spiele - Mischen ändert dort nichts.
    assert keys["E"]["settings"]["draw_group"] == keys["F"]["settings"]["draw_group"]
    assert not keys["G"]["settings"].get("draw_group")
    assert all(not (m["settings"].get("draw_group")) for m in matches if m["round"] == 1)
    # Die Plätze zeigen vor der Auslosung „Platz aus Runde 1“.
    source = keys["E"]["slots"][0]["source"]
    assert source["draw"]["label"] == "Runde 1"
    assert source["draw"]["group"] == keys["E"]["settings"]["draw_group"]


# ---------------------------------------------------------------------------------------------- Auslosung

def test_next_round_waits_for_the_whole_round():
    matches = build(8, "single_elimination", tournament=SHUFFLE)
    keys = by_key(matches)
    application = apply(matches, keys["A"], lower_seed_wins(keys["A"]))
    assert application["draws"] == []
    assert keys["E"]["status"] == "pending" and keys["F"]["status"] == "pending"
    assert not filled_ids(keys["E"]) and not filled_ids(keys["F"])
    for key in ("B", "C"):
        apply(matches, keys[key], lower_seed_wins(keys[key]))
    assert not filled_ids(keys["E"]) and not filled_ids(keys["F"])
    last = apply(matches, keys["D"], lower_seed_wins(keys["D"]))
    assert len(last["draws"]) == 1
    winners = {keys[k]["results"][0]["registration_id"] for k in "ABCD"}
    assert set(filled_ids(keys["E"])) | set(filled_ids(keys["F"])) == winners
    assert len(filled_ids(keys["E"])) == 2 and len(filled_ids(keys["F"])) == 2
    assert keys["E"]["status"] == "ready" and keys["F"]["status"] == "ready"
    assert keys["E"]["draw"]["id"] == keys["F"]["draw"]["id"] == last["draws"][0]["id"]
    draw = last["draws"][0]
    assert draw["drawn_at"] == NOW
    assert {row["registration_id"] for row in draw["assignments"]} == winners


def test_two_matches_into_one_place_immediately_like_the_fixed_tree():
    matches = build(4, "single_elimination", tournament=SHUFFLE)
    keys = by_key(matches)
    apply(matches, keys["A"], ["r1", "r4"])
    assert filled_ids(keys["C"]) == ["r1"]


def test_draw_is_really_random_over_many_runs():
    """Ohne festen Startwert: 200 Auslosungen, Platz 1 aus A landet in beiden Spielen der Runde 2 und auf beiden
    Plätzen; die beiden aus Runde 1 treffen sich mal, mal nicht."""
    landed: Counter = Counter()
    met = 0
    for _ in range(200):
        matches = build(8, "single_elimination", tournament=SHUFFLE)
        keys = by_key(matches)
        for key in "ABCD":
            apply(matches, keys[key], lower_seed_wins(keys[key]))
        for key in "EF":
            for slot in keys[key]["slots"]:
                if slot["registration_id"] == "r1":
                    landed[(key, slot["slot"])] += 1
        if {"r1", "r2"} <= set(filled_ids(keys["E"])) or {"r1", "r2"} <= set(filled_ids(keys["F"])):
            met += 1
    assert set(landed) == {("E", 1), ("E", 2), ("F", 1), ("F", 2)}, landed
    assert 0 < met < 200


def test_ffa_heats_spread_evenly_and_randomly():
    """10 Fahrer, Läufe zu 4, 2 kommen weiter: Runde 1 hat drei Läufe (4, 3, 3), Runde 2 zwei Läufe zu je 3."""
    seen_together = Counter()
    for _ in range(200):
        matches = build(10, "ffa_custom_bracket", "ffa", settings={"match_size": 4, "qualifiers_per_match": 2},
                        tournament=SHUFFLE)
        first = sorted((m for m in matches if m["round"] == 1), key=lambda m: m["order"])
        second = [m for m in matches if m["round"] == 2]
        assert len(first) == 3 and len(second) == 2
        for heat in first:
            apply(matches, heat, sorted(filled_ids(heat), key=lambda reg: int(reg[1:])))
        sizes = sorted(len(filled_ids(m)) for m in second)
        assert sizes == [3, 3]
        assert all(m["status"] == "ready" for m in second)
        winner_a = first[0]["results"][0]["registration_id"]
        second_a = first[0]["results"][1]["registration_id"]
        seen_together[any({winner_a, second_a} <= set(filled_ids(m)) for m in second)] += 1
    assert seen_together[True] and seen_together[False]


def test_byes_in_the_pot_are_spread_evenly():
    """Eigenes Schema: D ist leer (zwei Freilose), C kampflos - Runde 2 bekommt drei Spieler und ein Freilos. Verteilt
    wird gleichmäßig: ein Spiel mit zweien, eines mit einem, das kampflos weitergeht."""
    schema = "\n".join([
        "[WB]", "# Runde 1", "A=[1,2]", "B=[3,4]", "C=[5,bye]", "D=[bye,bye]",
        "# Runde 2", "E=[W:A:1,W:B:1]", "F=[W:C:1,W:D:1]",
        "# Finale", "G=[W:E:1,W:F:1]",
    ])
    for _ in range(30):
        matches = build(5, "custom_bracket", settings={"schema": schema}, tournament=SHUFFLE)
        keys = by_key(matches)
        assert keys["C"]["status"] == "completed" and keys["D"]["status"] == "cancelled"
        assert not filled_ids(keys["E"]) and not filled_ids(keys["F"]), "C und D sind fertig, A und B noch nicht"
        apply(matches, keys["A"], ["r1", "r2"])
        apply(matches, keys["B"], ["r3", "r4"])
        counts = sorted(len(filled_ids(keys[k])) for k in "EF")
        assert counts == [1, 2]
        walkover = next(keys[k] for k in "EF" if len(filled_ids(keys[k])) == 1)
        assert walkover["status"] == "completed"
        assert walkover["results"][0]["registration_id"] in filled_ids(keys["G"])


def test_double_elimination_mixes_only_within_the_same_bracket_round():
    matches = build(8, "double_elimination", tournament=SHUFFLE)
    keys = by_key(matches)
    wb_first = [m for m in matches if m["section"] == "WB" and m["round"] == 1]
    for match in wb_first:
        apply(matches, match, lower_seed_wins(match))
    winners = {m["results"][0]["registration_id"] for m in wb_first}
    losers = {m["results"][1]["registration_id"] for m in wb_first}
    wb_second = [m for m in matches if m["section"] == "WB" and m["round"] == 2]
    lb_first = [m for m in matches if m["section"] == "LB" and m["round"] == 2]
    assert {reg for m in wb_second for reg in filled_ids(m)} == winners
    assert {reg for m in lb_first for reg in filled_ids(m)} == losers
    assert all(m["settings"].get("draw_group") for m in wb_second + lb_first)
    assert {m["settings"]["draw_group"] for m in wb_second}.isdisjoint({m["settings"]["draw_group"] for m in lb_first})
    assert not keys["GF"]["settings"].get("draw_group") and not keys["GFR"]["settings"].get("draw_group")


def test_correction_keeps_the_draw_and_swaps_the_person():
    matches = build(8, "single_elimination", tournament=SHUFFLE)
    keys = by_key(matches)
    for key in "ABCD":
        apply(matches, keys[key], lower_seed_wins(keys[key]))
    old_winner = keys["A"]["results"][0]["registration_id"]
    target = next(keys[k] for k in "EF" if old_winner in filled_ids(keys[k]))
    position = next(s["slot"] for s in target["slots"] if s["registration_id"] == old_winner)
    before = {k: filled_ids(keys[k]) for k in "EF"}
    loser = keys["A"]["results"][1]["registration_id"]
    apply(matches, keys["A"], [loser, old_winner], force=True)
    slot = next(s for s in target["slots"] if s["slot"] == position)
    assert slot["registration_id"] == loser
    other = "F" if target["match_key"] == "E" else "E"
    assert filled_ids(keys[other]) == before[other]


def test_assign_balanced_spreads_players_before_byes():
    targets = [("m1", [1, 2, 3]), ("m2", [1, 2, 3])]
    entries = [{"registration_id": f"r{i}"} for i in range(4)] + [None, None]
    for _ in range(50):
        placed = assign_balanced(entries, targets)
        assert len(placed) == 6
        real = Counter(match_id for match_id, _slot, entry in placed if entry)
        assert sorted(real.values()) == [2, 2]


def test_assign_balanced_with_uneven_heats():
    targets = [("m1", [1, 2, 3]), ("m2", [1, 2])]
    entries = [{"registration_id": f"r{i}"} for i in range(3)] + [None, None]
    for _ in range(50):
        real = Counter(match_id for match_id, _slot, entry in assign_balanced(entries, targets) if entry)
        assert sorted(real.values()) in ([1, 2],)


# ---------------------------------------------------------------------------------------------- Neu auslosen

def _drawn_round_two():
    matches = build(8, "single_elimination", tournament=SHUFFLE)
    keys = by_key(matches)
    for key in "ABCD":
        apply(matches, keys[key], lower_seed_wins(keys[key]))
    return matches, keys


def test_redraw_before_start_reshuffles_the_same_players():
    changed = False
    for _ in range(40):
        matches, keys = _drawn_round_two()
        group = keys["E"]["settings"]["draw_group"]
        before = {k: set(filled_ids(keys[k])) for k in "EF"}
        application = build_redraw_application(matches, group, now_iso=NOW)
        apply_sets(matches, application)
        after = {k: set(filled_ids(keys[k])) for k in "EF"}
        assert after["E"] | after["F"] == before["E"] | before["F"]
        assert len(after["E"]) == len(after["F"]) == 2
        assert keys["E"]["draw"]["id"] == application["draw"]["id"] != None  # noqa: E711
        assert application["draw"]["trigger"] == "redraw"
        changed = changed or after != before
    assert changed


@pytest.mark.parametrize("state", [
    {"status": "in_progress"},
    {"status": "completed", "results": [{"registration_id": "x", "rank": 1}]},
    {"called_at": NOW},
    {"started_at": NOW},
    {"pending_result": {"id": "h"}},
])
def test_redraw_refused_once_a_match_of_the_group_started(state):
    matches, keys = _drawn_round_two()
    keys["F"].update(state)
    with pytest.raises(MatchV2ResultError) as raised:
        build_redraw_application(matches, keys["E"]["settings"]["draw_group"], now_iso=NOW)
    assert raised.value.status_code == 409


def test_redraw_refused_before_the_draw():
    matches = build(8, "single_elimination", tournament=SHUFFLE)
    keys = by_key(matches)
    with pytest.raises(MatchV2ResultError) as raised:
        build_redraw_application(matches, keys["E"]["settings"]["draw_group"], now_iso=NOW)
    assert raised.value.status_code == 409


def test_redraw_unknown_group_is_not_found():
    matches, _keys = _drawn_round_two()
    with pytest.raises(MatchV2ResultError) as raised:
        build_redraw_application(matches, "XX:9", now_iso=NOW)
    assert raised.value.status_code == 404


# ---------------------------------------------------------------------------------------------- Planer

def test_prerequisites_of_a_drawn_round_are_all_matches_of_the_previous_round():
    matches = build(8, "single_elimination", tournament=SHUFFLE)
    keys = by_key(matches)
    expected = {keys[k]["id"] for k in "ABCD"}
    assert prerequisite_ids(keys["E"], matches) == expected
    assert prerequisite_ids(keys["F"], matches) == expected
    assert prerequisite_ids(keys["G"], matches) == {keys["E"]["id"], keys["F"]["id"]}
    assert prerequisite_ids(keys["A"], matches) == set()
    fixed = by_key(build(8, "single_elimination"))
    assert prerequisite_ids(fixed["E"], list(fixed.values())) == {fixed["A"]["id"], fixed["B"]["id"]}


def test_group_helpers_find_targets_and_sources():
    matches = build(8, "single_elimination", tournament=SHUFFLE)
    keys = by_key(matches)
    group = keys["E"]["settings"]["draw_group"]
    assert {m["match_key"] for m in group_targets(matches, group)} == {"E", "F"}
    assert {m["match_key"] for m in group_sources(matches, group)} == {"A", "B", "C", "D"}


# ---------------------------------------------------------------------------------------------- Liga

def _pairs_by_day(matches: list[dict]) -> dict[int, list[tuple[str, str]]]:
    days: dict[int, list[tuple[str, str]]] = {}
    for match in matches:
        home, away = (slot["registration_id"] for slot in match["slots"])
        days.setdefault(match["round"], []).append((home, away))
    return days


@pytest.mark.parametrize("count", [3, 4, 5, 6, 7, 8])
def test_league_draw_keeps_everyone_against_everyone_once_per_leg(count):
    matches = build(count, "league", settings={"randomize_advancement_rounds": True})
    days = _pairs_by_day(matches)
    total_days = len(days)
    half = total_days // 2
    first_leg = [frozenset(p) for d in range(1, half + 1) for p in days[d]]
    second_leg = [frozenset(p) for d in range(half + 1, total_days + 1) for p in days[d]]
    every_pair = {frozenset((f"r{a}", f"r{b}")) for a in range(1, count + 1) for b in range(a + 1, count + 1)}
    assert sorted(first_leg, key=sorted) == sorted(every_pair, key=sorted) and len(first_leg) == len(every_pair)
    assert sorted(second_leg, key=sorted) == sorted(every_pair, key=sorted) and len(second_leg) == len(every_pair)
    for day in days.values():
        players = [reg for pair in day for reg in pair]
        assert len(players) == len(set(players)), "niemand spielt zweimal am selben Spieltag"
    # Rückrunde spiegelt die Hinrunde: dieselbe Paarung mit getauschtem Heimrecht.
    for offset in range(1, half + 1):
        assert sorted(days[offset + half]) == sorted((away, home) for home, away in days[offset])
    assert all(m.get("draw", {}).get("group") for m in matches)


def test_league_draw_order_and_home_side_vary():
    first_day_opponent = Counter()
    home_of_pair = Counter()
    for _ in range(200):
        matches = build(6, "league", settings={"randomize_advancement_rounds": True})
        days = _pairs_by_day(matches)
        for home, away in days[1]:
            if "r1" in (home, away):
                first_day_opponent[away if home == "r1" else home] += 1
        for day in range(1, 6):
            for home, away in days[day]:
                if {home, away} == {"r1", "r2"}:
                    home_of_pair[home] += 1
    assert len(first_day_opponent) == 5
    assert set(home_of_pair) == {"r1", "r2"}


def test_league_without_shuffle_stays_as_before():
    one = _pairs_by_day(build(6, "league"))
    two = _pairs_by_day(build(6, "league"))
    assert one == two
    assert not any(m.get("draw") for m in build(6, "league"))


def test_league_redraw_before_matchday_one_keeps_matches_and_pairs():
    from services.match_v2_results import build_league_redraw_application

    moved = False
    for _ in range(30):
        matches = build(6, "league", settings={"randomize_advancement_rounds": True})
        ids = {m["id"] for m in matches}
        before = _pairs_by_day(matches)
        application = build_league_redraw_application(matches, now_iso=NOW)
        apply_sets(matches, application)
        assert {m["id"] for m in matches} == ids
        after = _pairs_by_day(matches)
        assert sorted(frozenset(p) for d in after.values() for p in d) == sorted(frozenset(p) for d in before.values() for p in d)
        for offset in range(1, 6):
            assert sorted(after[offset + 5]) == sorted((away, home) for home, away in after[offset])
        assert application["draw"]["trigger"] == "redraw" and application["draw"]["kind"] == "league"
        assert all(m["draw"]["id"] == application["draw"]["id"] for m in matches)
        assert all(m["round_name"] == f"Spieltag {m['round']}" for m in matches)
        moved = moved or after != before
    assert moved


def test_league_redraw_refused_once_matchday_one_started():
    from services.match_v2_results import build_league_redraw_application

    matches = build(4, "league", settings={"randomize_advancement_rounds": True})
    next(m for m in matches if m["round"] == 1)["status"] = "in_progress"
    with pytest.raises(MatchV2ResultError) as raised:
        build_league_redraw_application(matches, now_iso=NOW)
    assert raised.value.status_code == 409
