"""Swiss pairing and group distribution for the graph engine.

These two were the last formats that only existed classically. Swiss decides at
runtime who meets whom, so its rules have to be pinned: similar scores meet, a
rematch only when there is no alternative, and a new round only once the
current one is decided.
"""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.competition_standings import standings_for_structure
from services.competition_snapshot import build_structure_snapshot
from services.custom_bracket import (
    distribute_into_groups,
    groups_from_generated_matches,
    infer_rounds,
    parse_custom_bracket_schema,
)
from services.custom_bracket import _auto_groups_schema, _auto_league_schema
from services.graph_swiss import (
    bye_history,
    next_round_number,
    open_matches,
    round_is_complete,
    scores_and_history,
    swiss_pairings,
    swiss_round_documents,
)


def decided_match(round_number, winner, loser, status="completed"):
    return {
        "round": round_number,
        "status": status,
        "slots": [{"registration_id": winner}, {"registration_id": loser}],
        "results": [
            {"registration_id": winner, "rank": 1},
            {"registration_id": loser, "rank": 2},
        ],
    }


def bye_match(round_number, participant):
    return {
        "round": round_number,
        "status": "completed",
        "slots": [{"registration_id": participant}, {"registration_id": None}],
        "results": [{"registration_id": participant, "rank": 1}],
    }


def drawn_match(round_number, first, second):
    return {
        "round": round_number,
        "status": "completed",
        "slots": [{"registration_id": first}, {"registration_id": second}],
        "results": [
            {"registration_id": first, "rank": 1},
            {"registration_id": second, "rank": 1},
        ],
    }


# ---------------------------------------------------------------- Punkte

def test_a_win_counts_fully_and_a_draw_by_half():
    scores, _ = scores_and_history(["a", "b", "c", "d"], [decided_match(1, "a", "b"), drawn_match(1, "c", "d")])

    assert scores == {"a": 1.0, "b": 0.0, "c": 0.5, "d": 0.5}


def test_an_undecided_match_does_not_count_yet():
    """Eine halb eingetragene Runde darf die naechste Paarung nicht verzerren."""
    pending = {"round": 1, "status": "ready", "slots": [{"registration_id": "a"}, {"registration_id": "b"}], "results": []}
    scores, opponents = scores_and_history(["a", "b"], [pending])

    assert scores == {"a": 0.0, "b": 0.0}
    assert opponents["a"] == set()


def test_a_forfeit_counts_like_a_decided_match():
    scores, opponents = scores_and_history(["a", "b"], [decided_match(1, "a", "b", status="forfeit")])

    assert scores["a"] == 1.0
    assert opponents["a"] == {"b"}


def test_a_bye_is_worth_a_full_point_but_adds_no_opponent():
    """Wer aussetzt, darf dadurch nicht zurueckfallen - aber auch keinen Gegner erben."""
    scores, opponents = scores_and_history(["a", "b", "c"], [bye_match(1, "c")])

    assert scores["c"] == 1.0
    assert opponents["c"] == set()


# ---------------------------------------------------------------- Paarung

def test_everyone_is_paired_exactly_once():
    pairs, bye = swiss_pairings(["a", "b", "c", "d"], [], seed=1)

    assert bye is None
    assert len(pairs) == 2
    assert sorted(participant for pair in pairs for participant in pair) == ["a", "b", "c", "d"]


def test_an_odd_field_gives_exactly_one_bye():
    pairs, bye = swiss_pairings(["a", "b", "c", "d", "e"], [], seed=1)

    assert bye is not None
    assert len(pairs) == 2
    paired = [participant for pair in pairs for participant in pair]
    assert bye not in paired
    assert len(set(paired)) == 4


def test_a_rematch_is_avoided_while_an_alternative_exists():
    played = [decided_match(1, "a", "b"), decided_match(1, "c", "d")]

    pairs, _ = swiss_pairings(["a", "b", "c", "d"], played, seed=7)

    assert {"a", "b"} not in [set(pair) for pair in pairs]
    assert {"c", "d"} not in [set(pair) for pair in pairs]


def test_a_rematch_is_allowed_when_nothing_else_is_left():
    """Gar nicht zu paaren waere schlimmer als eine Wiederholung."""
    played = [decided_match(1, "a", "b")]

    pairs, bye = swiss_pairings(["a", "b"], played, seed=1)

    assert bye is None
    assert [set(pair) for pair in pairs] == [{"a", "b"}]


def test_players_with_similar_scores_meet():
    played = [decided_match(1, "a", "b"), decided_match(1, "c", "d")]

    pairs, _ = swiss_pairings(["a", "b", "c", "d"], played, seed=3)

    winners = {"a", "c"}
    assert any(set(pair) == winners for pair in pairs), "Die beiden Sieger sollten aufeinandertreffen"


def test_a_field_too_small_to_pair_yields_nothing():
    assert swiss_pairings([], [], seed=1) == ([], None)
    assert swiss_pairings(["allein"], [], seed=1) == ([], "allein")


def test_the_pairing_is_reproducible_with_the_same_seed():
    first, _ = swiss_pairings(["a", "b", "c", "d"], [], seed=42)
    second, _ = swiss_pairings(["a", "b", "c", "d"], [], seed=42)

    assert first == second


def test_nobody_sits_out_twice_while_someone_else_has_not():
    """Zweimal Freilos waere ein Vorteil, den niemand verdient hat."""
    played = [bye_match(1, "e"), decided_match(1, "a", "b"), decided_match(1, "c", "d")]

    _pairs, bye = swiss_pairings(["a", "b", "c", "d", "e"], played, seed=5)

    assert bye != "e"


def test_a_second_bye_is_allowed_once_everyone_has_had_one():
    played = [bye_match(1, "a"), bye_match(2, "b"), bye_match(3, "c")]

    _pairs, bye = swiss_pairings(["a", "b", "c"], played, seed=5)

    assert bye in {"a", "b", "c"}


def test_who_already_sat_out_is_remembered():
    assert bye_history([bye_match(1, "a"), decided_match(1, "b", "c")]) == {"a"}


# ---------------------------------------------------------------- Rundenwechsel

def test_the_next_round_follows_the_highest_one_played():
    assert next_round_number([]) == 1
    assert next_round_number([decided_match(1, "a", "b"), decided_match(2, "a", "c")]) == 3


def test_a_new_round_waits_for_the_current_one():
    pending = {"round": 2, "status": "ready", "slots": [], "results": []}

    assert round_is_complete([decided_match(1, "a", "b")], 1) is True
    assert round_is_complete([decided_match(2, "a", "b"), pending], 2) is False
    assert round_is_complete([], 1) is True


def test_an_abandoned_match_does_not_block_the_next_round():
    """Ein abgesagtes Match wird nie entschieden - es darf das Turnier nicht anhalten."""
    cancelled = {"round": 1, "status": "cancelled", "slots": [], "results": []}

    assert open_matches([decided_match(1, "a", "b"), cancelled], 1) == []
    assert round_is_complete([cancelled], 1) is True


# ---------------------------------------------------------------- Runde als Dokumente

TOURNAMENT = {"id": "t1", "format": "swiss", "match_duration_minutes": 20}
STAGE = {"id": "s1", "number": 1, "settings": {}}


def registrations(*ids):
    return [{"id": item, "user_id": f"user-{item}"} for item in ids]


def test_a_generated_round_is_ready_to_be_played():
    documents = swiss_round_documents(
        TOURNAMENT, STAGE, registrations("a", "b", "c", "d"), [], round_number=2)

    assert len(documents) == 2
    for document in documents:
        assert document["round"] == 2
        assert document["stage_id"] == "s1"
        assert document["tournament_id"] == "t1"
        assert document["status"] == "ready"
        assert len(document["slots"]) == 2
        assert all(slot["status"] == "filled" for slot in document["slots"])


def test_match_keys_within_a_round_stay_unique():
    documents = swiss_round_documents(
        TOURNAMENT, STAGE, registrations("a", "b", "c", "d", "e", "f"), [], round_number=1)

    keys = [document["match_key"] for document in documents]
    assert len(keys) == len(set(keys))


def test_a_bye_is_written_as_a_decided_match():
    """Nur so bekommt der Freilos-Punkt ueberhaupt einen Ort, an dem er steht."""
    documents = swiss_round_documents(
        TOURNAMENT, STAGE, registrations("a", "b", "c"), [], round_number=1)

    byes = [document for document in documents if document["status"] == "completed"]
    assert len(byes) == 1
    assert byes[0]["results"][0]["rank"] == 1
    assert byes[0]["results"][0]["note"]


def test_a_field_of_one_produces_no_playable_match():
    assert swiss_round_documents(TOURNAMENT, STAGE, registrations("a"), [], round_number=1) != []
    assert swiss_round_documents(TOURNAMENT, STAGE, [], [], round_number=1) == []


def test_the_generated_round_carries_the_users_along():
    """Ohne user_id kann das Match niemandem angezeigt oder gemeldet werden."""
    documents = swiss_round_documents(
        TOURNAMENT, STAGE, registrations("a", "b"), [], round_number=1)

    assert {slot["user_id"] for slot in documents[0]["slots"]} == {"user-a", "user-b"}


# ---------------------------------------------------------------- Gruppen

def test_the_strongest_seeds_land_in_different_groups():
    groups = distribute_into_groups(8, 2)

    assert len(groups) == 2
    assert 1 in groups[0] and 2 in groups[1]


def test_every_participant_is_in_exactly_one_group():
    groups = distribute_into_groups(12, 4)
    everyone = [seed for group in groups for seed in group]

    assert sorted(everyone) == list(range(1, 13))
    assert len(groups) == 4


def test_group_sizes_stay_balanced():
    sizes = {len(group) for group in distribute_into_groups(9, 3)}

    assert sizes == {3}


def test_a_group_schema_pairs_everyone_within_a_group():
    """Vier Teilnehmer in einer Gruppe ergeben sechs Begegnungen."""
    specs = parse_custom_bracket_schema(_auto_groups_schema(4, 1))

    assert len(specs) == 6


def test_two_groups_of_four_yield_twelve_matches():
    specs = parse_custom_bracket_schema(_auto_groups_schema(8, 2))

    assert len(specs) == 12
    assert len({spec.section for spec in specs}) == 2


@pytest.mark.parametrize("slot_count,group_count", [(4, 2), (8, 2), (9, 3), (16, 4), (6, 1)])
def test_generated_group_schemas_are_valid(slot_count, group_count):
    specs = parse_custom_bracket_schema(_auto_groups_schema(slot_count, group_count))

    assert specs
    for spec in specs:
        assert len(spec.sources) == 2


def test_nobody_plays_twice_on_the_same_matchday():
    """Sonst waere die Gruppenphase nicht ansetzbar."""
    specs = parse_custom_bracket_schema(_auto_groups_schema(8, 2))
    rounds = infer_rounds(specs)

    per_matchday: dict[int, list[int]] = {}
    for spec in specs:
        seeds = [source["seed"] for source in spec.sources]
        per_matchday.setdefault(rounds[spec.key], []).extend(seeds)

    for matchday, seeds in per_matchday.items():
        assert len(seeds) == len(set(seeds)), f"Setzplatz doppelt an Spieltag {matchday}"


def test_a_group_of_four_needs_three_matchdays():
    specs = parse_custom_bracket_schema(_auto_groups_schema(4, 1))

    assert max(infer_rounds(specs).values()) == 3


def test_the_group_sections_are_the_ones_the_standings_look_for():
    """Die klassische Engine schreibt group_A - die Tabelle sucht genau danach."""
    specs = parse_custom_bracket_schema(_auto_groups_schema(8, 2))

    assert {spec.section for spec in specs} == {"group_A", "group_B"}


# ---------------------------------------------------------------- Gruppen-Rueckgabe

def group_match(section, first, second):
    return {
        "section": section,
        "round": 1,
        "order": 1,
        "slots": [{"registration_id": first}, {"registration_id": second}],
    }


def test_the_roster_is_read_back_from_the_fixtures():
    """Die Setzung passiert im Match-Bau; eine zweite Zuteilung koennte abweichen."""
    groups = groups_from_generated_matches([
        group_match("group_A", "r1", "r2"),
        group_match("group_B", "r3", "r4"),
        group_match("group_A", "r1", "r5"),
    ])

    assert [group["group_key"] for group in groups] == ["A", "B"]
    assert groups[0]["participant_ids"] == ["r1", "r2", "r5"]
    assert groups[0]["name"] == "Gruppe A"


def test_matches_outside_a_group_are_ignored():
    assert groups_from_generated_matches([group_match("WB", "r1", "r2")]) == []


# ---------------------------------------------------------------- Tabelle bleibt Tabelle

def snapshot_of(stage_matches):
    return build_structure_snapshot("t1", stage_matches=stage_matches)


def played(section, first, second, *, winner=None, round_number=1):
    results = []
    if winner:
        loser = second if winner == first else first
        results = [
            {"registration_id": winner, "rank": 1},
            {"registration_id": loser, "rank": 2},
        ]
    else:
        results = [
            {"registration_id": first, "rank": 1},
            {"registration_id": second, "rank": 1},
        ]
    return {
        "id": f"{section}-{first}-{second}",
        "tournament_id": "t1",
        "stage_id": "s1",
        "section": section,
        "round": round_number,
        "status": "completed",
        "match_type": "duel",
        "slots": [
            {"slot": 1, "registration_id": first},
            {"slot": 2, "registration_id": second},
        ],
        "results": results,
    }


def test_a_swiss_tournament_in_the_graph_keeps_its_buchholz_table():
    """Die generische Stage-Tabelle waere hier ein Rueckschritt."""
    rows = standings_for_structure(
        {"format": "swiss"},
        snapshot_of([
            played("swiss", "a", "b", winner="a"),
            played("swiss", "c", "d", winner="c"),
            played("swiss", "a", "c", winner="a", round_number=2),
        ]),
        registrations("a", "b", "c", "d"),
    )

    assert [row["registration_id"] for row in rows][0] == "a"
    assert all("buchholz" in row for row in rows)


def test_a_draw_in_the_graph_stays_a_draw():
    """Im Graph teilen sich beide Rang 1 - das darf kein Sieg werden."""
    rows = standings_for_structure(
        {"format": "swiss"},
        snapshot_of([played("swiss", "a", "b")]),
        registrations("a", "b"),
    )

    assert {row["points"] for row in rows} == {0.5}
    assert all(row["drawn"] == 1 for row in rows)


def test_a_bye_shows_up_in_the_swiss_table():
    rows = standings_for_structure(
        {"format": "swiss"},
        snapshot_of([{
            "id": "m-bye", "tournament_id": "t1", "stage_id": "s1", "section": "swiss",
            "round": 1, "status": "completed", "match_type": "duel",
            "slots": [{"slot": 1, "registration_id": "a"}, {"slot": 2, "registration_id": None}],
            "results": [{"registration_id": "a", "rank": 1}],
        }]),
        registrations("a", "b"),
    )

    assert next(row for row in rows if row["registration_id"] == "a")["points"] == 1


def test_a_group_tournament_in_the_graph_keeps_one_table_per_group():
    rows = standings_for_structure(
        {"format": "groups"},
        snapshot_of([
            played("group_A", "a", "b", winner="a"),
            played("group_B", "c", "d", winner="c"),
        ]),
        registrations("a", "b", "c", "d"),
        groups=[
            {"id": "g1", "group_key": "A", "participant_ids": ["a", "b"]},
            {"id": "g2", "group_key": "B", "participant_ids": ["c", "d"]},
        ],
    )

    assert len(rows) == 2
    assert [entry["group"]["group_key"] for entry in rows] == ["A", "B"]
    assert rows[0]["standings"][0]["registration_id"] == "a"


# ---------------------------------------------------------------- Liga

def test_a_league_is_a_round_robin_played_twice():
    """Das ist der Unterschied zur Gruppe: Hin- und Rückrunde."""
    specs = parse_custom_bracket_schema(_auto_league_schema(4))

    assert len(specs) == 4 * 3  # jeder gegen jeden, zweimal


def test_the_return_leg_swaps_the_sides():
    """Wer zuerst steht, belegt Slot eins - das soll sich in der Rückrunde drehen."""
    specs = parse_custom_bracket_schema(_auto_league_schema(4))
    pairings = [tuple(source["seed"] for source in spec.sources) for spec in specs]

    first_half = pairings[: len(pairings) // 2]
    for home, away in first_half:
        assert (away, home) in pairings[len(pairings) // 2:], f"Rückspiel {away}-{home} fehlt"


def test_every_pairing_happens_exactly_twice():
    specs = parse_custom_bracket_schema(_auto_league_schema(6))
    seen: dict[frozenset, int] = {}
    for spec in specs:
        key = frozenset(source["seed"] for source in spec.sources)
        seen[key] = seen.get(key, 0) + 1

    assert set(seen.values()) == {2}
    assert len(seen) == 6 * 5 // 2


def test_nobody_plays_twice_on_the_same_league_matchday():
    specs = parse_custom_bracket_schema(_auto_league_schema(6))
    rounds = infer_rounds(specs)

    per_matchday: dict[int, list[int]] = {}
    for spec in specs:
        per_matchday.setdefault(rounds[spec.key], []).extend(
            source["seed"] for source in spec.sources)

    for matchday, seeds in per_matchday.items():
        assert len(seeds) == len(set(seeds)), f"Setzplatz doppelt an Spieltag {matchday}"


def test_an_odd_league_gives_everyone_a_rest_day():
    """Bei ungerader Teilnehmerzahl setzt pro Spieltag genau einer aus."""
    specs = parse_custom_bracket_schema(_auto_league_schema(5))
    rounds = infer_rounds(specs)
    matchdays = max(rounds.values())

    assert len(specs) == 5 * 4
    for matchday in range(1, matchdays + 1):
        playing = [
            source["seed"] for spec in specs if rounds[spec.key] == matchday
            for source in spec.sources
        ]
        assert len(playing) == 4, f"Spieltag {matchday} hat {len(playing)} Startplätze"


@pytest.mark.parametrize("size", [2, 3, 4, 5, 8, 11])
def test_generated_league_schemas_are_valid(size):
    specs = parse_custom_bracket_schema(_auto_league_schema(size))

    assert len(specs) == size * (size - 1)
    for spec in specs:
        assert len(spec.sources) == 2
