from bracket_engine import compute_round_robin_standings
from bracket_extensions import compute_swiss_standings
from services.competition_snapshot import adapt_legacy_matches, adapt_stage_matches, build_structure_snapshot
from services.competition_standings import (
    elimination_standings,
    group_standings,
    round_robin_standings,
    registration_match_summary,
    stage_standings,
    standings_for_structure,
    swiss_standings,
)


REGISTRATIONS = [
    {"id": "r1", "display_name": "Alpha", "user_id": "u1"},
    {"id": "r2", "display_name": "Bravo", "user_id": "u2"},
    {"id": "r3", "display_name": "Charlie", "user_id": "u3"},
]


def _legacy_matches():
    return [
        {
            "id": "m1",
            "tournament_id": "t1",
            "round": 1,
            "bracket": "winner",
            "participant_a_id": "r1",
            "participant_b_id": "r2",
            "score_a": 2,
            "score_b": 1,
            "winner_id": "r1",
            "loser_id": "r2",
            "status": "completed",
        },
        {
            "id": "m2",
            "tournament_id": "t1",
            "round": 2,
            "bracket": "winner",
            "participant_a_id": "r1",
            "participant_b_id": "r3",
            "score_a": 3,
            "score_b": 3,
            "winner_id": None,
            "loser_id": None,
            "status": "completed",
        },
    ]


def test_round_robin_and_swiss_match_existing_legacy_calculators():
    raw = _legacy_matches()
    canonical = adapt_legacy_matches(raw)

    assert round_robin_standings(canonical, REGISTRATIONS) == compute_round_robin_standings(raw, REGISTRATIONS)
    assert swiss_standings(canonical, REGISTRATIONS) == compute_swiss_standings(REGISTRATIONS, raw)


def test_elimination_standings_uses_canonical_slots_and_results():
    rows = elimination_standings(adapt_legacy_matches(_legacy_matches()), REGISTRATIONS)

    assert [row["registration_id"] for row in rows] == ["r1", "r3", "r2"]
    assert rows[0]["wins"] == 1
    assert rows[0]["furthest_round"] == 2


def test_stage_standings_supports_rank_points_and_placement():
    canonical = adapt_stage_matches([{
        "id": "ffa-1",
        "tournament_id": "t1",
        "stage_id": "s1",
        "round": 1,
        "slots": [
            {"slot": 1, "registration_id": "r1", "status": "filled", "source": {"type": "seed", "seed": 1}},
            {"slot": 2, "registration_id": "r2", "status": "filled", "source": {"type": "seed", "seed": 2}},
            {"slot": 3, "registration_id": "r3", "status": "filled", "source": {"type": "seed", "seed": 3}},
        ],
        "results": [
            {"registration_id": "r1", "rank": 2, "points": 8},
            {"registration_id": "r2", "rank": 1, "points": 10},
            {"registration_id": "r3", "rank": 3, "points": 6},
        ],
        "advancement": [],
        "status": "completed",
    }])

    rows = stage_standings(canonical, REGISTRATIONS)

    assert [row["registration_id"] for row in rows] == ["r2", "r1", "r3"]
    assert rows[0]["points"] == 10
    assert rows[0]["best_rank"] == 1


def test_group_and_policy_selector_keep_public_shape():
    raw = [
        {**match, "bracket": "group_A", "group_id": "g1"}
        for match in _legacy_matches()
    ]
    canonical = adapt_legacy_matches(raw)
    groups = [{"id": "g1", "group_key": "A", "participant_ids": ["r1", "r2", "r3"]}]
    grouped = group_standings(canonical, REGISTRATIONS, groups)
    snapshot = build_structure_snapshot("t1", legacy_matches=raw)

    assert grouped[0]["group"]["id"] == "g1"
    assert standings_for_structure(
        {"format": "groups"},
        snapshot,
        REGISTRATIONS,
        groups=groups,
    ) == grouped


def test_registration_match_summary_counts_legacy_and_stage_wins_once():
    legacy = adapt_legacy_matches(_legacy_matches())
    stage = adapt_stage_matches([{
        "id": "stage-win",
        "tournament_id": "t1",
        "stage_id": "s1",
        "round": 3,
        "slots": [
            {"slot": 1, "registration_id": "r1", "status": "filled"},
            {"slot": 2, "registration_id": "r2", "status": "filled"},
        ],
        "results": [
            {"registration_id": "r2", "rank": 1},
            {"registration_id": "r1", "rank": 2},
        ],
        "advancement": [],
        "status": "completed",
    }])

    assert registration_match_summary([*legacy, *stage], {"r1"}) == {
        "matches_played": 3,
        "matches_won": 1,
    }
    assert registration_match_summary([*legacy, *stage], {"r2"}) == {
        "matches_played": 2,
        "matches_won": 1,
    }
