from services.competition_snapshot import adapt_legacy_matches, adapt_stage_matches, build_structure_snapshot
from services.competition_standings import (
    elimination_standings,
    group_standings,
    placement_rows_for_structure,
    placements_for_structure,
    registration_badge_match_progress,
    registration_match_summary,
    registration_tournament_achievement_progress,
    stage_standings,
    standings_for_structure,
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


def test_placements_keep_explicit_legacy_final_positions_authoritative():
    legacy = [
        {
            "id": "legacy-first",
            "tournament_id": "t1",
            "round": 2,
            "bracket": "winner",
            "participant_a_id": "r1",
            "participant_b_id": "r2",
            "winner_id": "r1",
            "loser_id": "r2",
            "final_position": 1,
            "status": "completed",
        },
        {
            "id": "legacy-second",
            "tournament_id": "t1",
            "round": 2,
            "bracket": "winner",
            "participant_a_id": "r2",
            "participant_b_id": "r3",
            "winner_id": "r2",
            "loser_id": "r3",
            "final_position": 2,
            "status": "completed",
        },
    ]
    stage = [{
        "id": "stage-conflict",
        "tournament_id": "t1",
        "stage_id": "s1",
        "round": 3,
        "slots": [
            {"slot": 1, "registration_id": "r3", "status": "filled"},
            {"slot": 2, "registration_id": "r1", "status": "filled"},
        ],
        "results": [
            {"registration_id": "r3", "rank": 1},
            {"registration_id": "r1", "rank": 2},
        ],
        "status": "completed",
    }]
    snapshot = build_structure_snapshot("t1", legacy_matches=legacy, stage_matches=stage)

    placements = placements_for_structure(snapshot, REGISTRATIONS)

    assert [entry["registration_id"] for entry in placements[1]] == ["r1"]
    assert placements[1][0]["user_id"] == "u1"
    assert [entry["registration_id"] for entry in placements[2]] == ["r2"]
    assert placement_rows_for_structure(snapshot, REGISTRATIONS) == [
        {"registration_id": "r1", "user_id": "u1", "team_id": None, "rank": 1},
        {"registration_id": "r2", "user_id": "u2", "team_id": None, "rank": 2},
    ]


def test_placements_filter_stage_bracket_sections_through_canonical_fields():
    stage = [
        {
            "id": "winner-bracket",
            "tournament_id": "t1",
            "stage_id": "s1",
            "round": 2,
            "section": "WB",
            "slots": [
                {"slot": 1, "registration_id": "r1", "status": "filled"},
                {"slot": 2, "registration_id": "r2", "status": "filled"},
            ],
            "results": [
                {"registration_id": "r1", "rank": 1},
                {"registration_id": "r2", "rank": 2},
            ],
            "status": "completed",
        },
        {
            "id": "loser-bracket",
            "tournament_id": "t1",
            "stage_id": "s1",
            "round": 1,
            "section": "LB",
            "slots": [
                {"slot": 1, "registration_id": "r3", "status": "filled"},
                {"slot": 2, "registration_id": "r2", "status": "filled"},
            ],
            "results": [
                {"registration_id": "r3", "rank": 1},
                {"registration_id": "r2", "rank": 2},
            ],
            "status": "completed",
        },
    ]
    snapshot = build_structure_snapshot("t1", stage_matches=stage)

    winner = placements_for_structure(snapshot, REGISTRATIONS, sections={"winner", "wb"})
    loser = placements_for_structure(snapshot, REGISTRATIONS, sections={"loser", "lb"})

    assert [entry["registration_id"] for entry in winner[1]] == ["r1"]
    assert [entry["registration_id"] for entry in loser[1]] == ["r3"]


def test_badge_match_progress_combines_engines_and_keeps_chronological_streak():
    legacy = adapt_legacy_matches([{
        "id": "legacy-win",
        "tournament_id": "t1",
        "round": 1,
        "participant_a_id": "r1",
        "participant_b_id": "r2",
        "winner_id": "r1",
        "loser_id": "r2",
        "status": "completed",
        "updated_at": "2026-08-17T10:00:00+00:00",
    }])
    stage = adapt_stage_matches([
        {
            "id": "stage-win",
            "tournament_id": "t1",
            "stage_id": "s1",
            "round": 2,
            "slots": [
                {"slot": 1, "registration_id": "r1", "status": "filled"},
                {"slot": 2, "registration_id": "r3", "status": "filled"},
            ],
            "results": [
                {"registration_id": "r1", "rank": 1},
                {"registration_id": "r3", "rank": 2},
            ],
            "status": "completed",
            "updated_at": "2026-08-17T11:00:00+00:00",
        },
        {
            "id": "stage-loss",
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
            "status": "completed",
            "updated_at": "2026-08-17T12:00:00+00:00",
        },
    ])

    assert registration_badge_match_progress([*legacy, *stage], {"r1"}) == {
        "matches_played": 3,
        "matches_won": 2,
        "match_streak_max": 2,
    }


def test_tournament_achievement_progress_keeps_legacy_fourth_place_semantics():
    snapshot = build_structure_snapshot("t1", legacy_matches=[
        {
            "id": "final",
            "tournament_id": "t1",
            "participant_a_id": "r1",
            "participant_b_id": "r2",
            "winner_id": "r1",
            "loser_id": "r2",
            "final_position": 1,
            "status": "completed",
        },
        {
            "id": "fourth-place",
            "tournament_id": "t1",
            "participant_a_id": "r3",
            "participant_b_id": "r2",
            "winner_id": "r3",
            "loser_id": "r2",
            "final_position": 4,
            "status": "completed",
        },
    ])

    assert registration_tournament_achievement_progress(snapshot, REGISTRATIONS, {"r1"}) == {
        "tournaments_won": 1,
        "podium_finishes": 1,
        "rank_4_count": 0,
    }
    assert registration_tournament_achievement_progress(snapshot, REGISTRATIONS, {"r2"}) == {
        "tournaments_won": 0,
        "podium_finishes": 0,
        "rank_4_count": 1,
    }


def test_tournament_achievement_progress_counts_stage_champion():
    snapshot = build_structure_snapshot("t1", stage_matches=[{
        "id": "stage-final",
        "tournament_id": "t1",
        "stage_id": "s1",
        "round": 3,
        "slots": [
            {"slot": 1, "registration_id": "r1", "status": "filled"},
            {"slot": 2, "registration_id": "r2", "status": "filled"},
            {"slot": 3, "registration_id": "r3", "status": "filled"},
        ],
        "results": [
            {"registration_id": "r1", "rank": 1},
            {"registration_id": "r2", "rank": 2},
            {"registration_id": "r3", "rank": 3},
        ],
        "status": "completed",
    }])

    assert registration_tournament_achievement_progress(snapshot, REGISTRATIONS, {"r1"}) == {
        "tournaments_won": 1,
        "podium_finishes": 1,
        "rank_4_count": 0,
    }


def test_decided_places_only_look_at_the_last_stage():
    """Mehrphasig (#1549): ein Loser Bracket in Phase 1 ändert nichts daran, dass das FFA-Finale der Phase 2 alle
    seine Plätze vergibt."""
    stage_one_loser = {
        "id": "lb-final", "tournament_id": "t1", "stage_id": "s1", "stage_number": 1, "round": 3, "section": "LB",
        "slots": [{"slot": 1, "registration_id": "r3", "status": "filled"}, {"slot": 2, "registration_id": "r2", "status": "filled"}],
        "results": [{"registration_id": "r3", "rank": 1}, {"registration_id": "r2", "rank": 2}],
        "status": "completed",
    }
    stage_two_final = {
        "id": "ffa-final", "tournament_id": "t1", "stage_id": "s2", "stage_number": 2, "round": 1, "section": "MAIN",
        "slots": [{"slot": index, "registration_id": reg, "status": "filled"} for index, reg in enumerate(["r1", "r2", "r3"], start=1)],
        "results": [{"registration_id": "r2", "rank": 1}, {"registration_id": "r1", "rank": 2}, {"registration_id": "r3", "rank": 3}],
        "status": "completed",
    }

    rows = stage_standings([stage_one_loser, stage_two_final], REGISTRATIONS)

    assert [row["registration_id"] for row in rows] == ["r2", "r1", "r3"]


def _shared_first_stage_match(match_id="stage-draw", **extra):
    return {
        "id": match_id,
        "tournament_id": "t1",
        "stage_id": "s1",
        "round": 1,
        "slots": [
            {"slot": 1, "registration_id": "r1", "status": "filled"},
            {"slot": 2, "registration_id": "r2", "status": "filled"},
        ],
        "results": [
            {"registration_id": "r1", "rank": 1},
            {"registration_id": "r2", "rank": 1},
        ],
        "advancement": [],
        "status": "completed",
        **extra,
    }


def test_shared_first_place_is_a_draw_in_the_snapshot():
    """#1806: zwei Mal Platz 1 ist ein Unentschieden, nicht zwei Sieger."""
    [match] = adapt_stage_matches([_shared_first_stage_match()])
    assert {row["registration_id"]: row["outcome"] for row in match["results"]} == {"r1": "draw", "r2": "draw"}


def test_sole_first_place_stays_the_winner_in_the_snapshot():
    [match] = adapt_stage_matches([{
        **_shared_first_stage_match(),
        "results": [{"registration_id": "r1", "rank": 1}, {"registration_id": "r2", "rank": 2}],
    }])
    assert {row["registration_id"]: row["outcome"] for row in match["results"]} == {"r1": "winner", "r2": "placed"}


def test_registration_match_summary_does_not_count_shared_first_place_as_win():
    """#1806: matches_won (Profil, Awards) folgt derselben Regel wie die Sieg-Erfolge (match_winner)."""
    stage = adapt_stage_matches([_shared_first_stage_match()])
    for registration in ("r1", "r2"):
        assert registration_match_summary(stage, {registration}) == {"matches_played": 1, "matches_won": 0}


def test_registration_match_summary_ignores_raw_winner_outcome_for_shared_first():
    """Auch ein älterer Stand mit zwei „winner“ ist ein Unentschieden."""
    [match] = adapt_stage_matches([_shared_first_stage_match()])
    for row in match["results"]:
        row["outcome"] = "winner"
    assert registration_match_summary([match], {"r1"}) == {"matches_played": 1, "matches_won": 0}


def test_registration_match_summary_still_counts_sole_winner():
    stage = adapt_stage_matches([{
        **_shared_first_stage_match(),
        "results": [{"registration_id": "r1", "rank": 1}, {"registration_id": "r2", "rank": 2}],
    }])
    assert registration_match_summary(stage, {"r1"}) == {"matches_played": 1, "matches_won": 1}
    assert registration_match_summary(stage, {"r2"}) == {"matches_played": 1, "matches_won": 0}


def test_badge_streak_orders_matches_by_completion_not_by_later_correction():
    """#1806 (zweiter Punkt): eine spätere Korrektur (updated_at) schiebt ein altes Spiel nicht ans Ende der Serie."""
    def duel(match_id, winner, completed_at, updated_at):
        loser = "r2" if winner == "r1" else "r1"
        return {
            **_shared_first_stage_match(match_id),
            "results": [{"registration_id": winner, "rank": 1}, {"registration_id": loser, "rank": 2}],
            "completed_at": completed_at,
            "updated_at": updated_at,
        }

    stage = adapt_stage_matches([
        # Nach Abschluss: Sieg, Niederlage, Sieg, Sieg -> längste Serie 2.
        duel("a", "r1", "2026-10-01T10:00:00+00:00", "2026-10-09T10:00:00+00:00"),  # später korrigiert
        duel("b", "r2", "2026-10-02T10:00:00+00:00", "2026-10-02T10:00:00+00:00"),
        duel("c", "r1", "2026-10-03T10:00:00+00:00", "2026-10-03T10:00:00+00:00"),
        duel("d", "r1", "2026-10-04T10:00:00+00:00", "2026-10-04T10:00:00+00:00"),
    ])
    assert all(match.get("completed_at") for match in stage)
    assert registration_badge_match_progress(stage, {"r1"}) == {
        "matches_played": 4,
        "matches_won": 3,
        "match_streak_max": 2,
    }
