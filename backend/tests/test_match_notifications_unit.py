from services.match_notifications import _canonical_match, _result_summary


REGISTRATIONS = {
    "r1": {"id": "r1", "display_name": "Alice"},
    "r2": {"id": "r2", "display_name": "Bob"},
}


def test_legacy_and_stage_duels_use_the_same_result_summary():
    legacy = _canonical_match({
        "id": "legacy-1",
        "tournament_id": "t1",
        "participant_a_id": "r1",
        "participant_b_id": "r2",
        "score_a": 3,
        "score_b": 1,
        "winner_id": "r1",
        "status": "completed",
    }, "matches")
    stage = _canonical_match({
        "id": "stage-1",
        "tournament_id": "t1",
        "match_type": "duel",
        "slots": [
            {"slot": 1, "registration_id": "r1", "status": "filled"},
            {"slot": 2, "registration_id": "r2", "status": "filled"},
        ],
        "results": [
            {"registration_id": "r1", "rank": 1, "score": 3},
            {"registration_id": "r2", "rank": 2, "score": 1},
        ],
        "status": "completed",
    }, "matches_v2")

    expected = "Alice gegen Bob ist bestätigt: 3:1. Gewinner: Alice."
    assert _result_summary(legacy, REGISTRATIONS) == expected
    assert _result_summary(stage, REGISTRATIONS) == expected


def test_stage_placement_match_keeps_ranked_result_summary():
    match = _canonical_match({
        "id": "stage-ffa",
        "tournament_id": "t1",
        "match_type": "placement",
        "slots": [
            {"slot": 1, "registration_id": "r1", "status": "filled"},
            {"slot": 2, "registration_id": "r2", "status": "filled"},
        ],
        "results": [
            {"registration_id": "r2", "rank": 2},
            {"registration_id": "r1", "rank": 1},
        ],
        "status": "completed",
    }, "matches_v2")

    assert _result_summary(match, REGISTRATIONS) == "Ergebnis bestätigt: 1. Alice, 2. Bob."


def test_stage_duel_with_shared_first_rank_is_reported_as_draw():
    match = _canonical_match({
        "id": "stage-draw",
        "tournament_id": "t1",
        "match_type": "duel",
        "slots": [
            {"slot": 1, "registration_id": "r1", "status": "filled"},
            {"slot": 2, "registration_id": "r2", "status": "filled"},
        ],
        "results": [
            {"registration_id": "r1", "rank": 1, "score": 2},
            {"registration_id": "r2", "rank": 1, "score": 2},
        ],
        "status": "completed",
    }, "matches_v2")

    assert _result_summary(match, REGISTRATIONS) == (
        "Alice gegen Bob ist bestätigt: 2:2. Gewinner: Unentschieden."
    )
