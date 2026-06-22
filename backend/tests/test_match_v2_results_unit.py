import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.match_v2_results import (
    MatchV2ResultError,
    build_v2_result_application,
    normalize_v2_results,
)


def _source_match():
    return {
        "id": "m-a",
        "tournament_id": "t1",
        "stage_id": "s1",
        "match_key": "A",
        "status": "ready",
        "slots": [
            {"slot": 1, "registration_id": "r1", "user_id": "u1", "status": "filled"},
            {"slot": 2, "registration_id": "r2", "user_id": "u2", "status": "filled"},
            {"slot": 3, "registration_id": "r3", "user_id": "u3", "status": "filled"},
            {"slot": 4, "registration_id": "r4", "user_id": "u4", "status": "filled"},
        ],
        "advancement": [
            {"flow": "W", "rank": 1, "to_match_id": "m-b", "to_match_key": "B", "to_slot": 1},
            {"flow": "W", "rank": 2, "to_match_id": "m-b", "to_match_key": "B", "to_slot": 2},
            {"flow": "L", "rank": 3, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 1},
            {"flow": "L", "rank": 4, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 2},
        ],
    }


def _target(match_id, key):
    return {
        "id": match_id,
        "stage_id": "s1",
        "match_key": key,
        "status": "pending",
        "settings": {"min_players": 2},
        "slots": [
            {"slot": 1, "registration_id": None, "status": "pending"},
            {"slot": 2, "registration_id": None, "status": "pending"},
        ],
    }


RESULTS = [
    {"registration_id": "r2", "rank": 1, "score": 40},
    {"registration_id": "r1", "rank": 2, "score": 35},
    {"registration_id": "r4", "rank": 3, "score": 20},
    {"registration_id": "r3", "rank": 4, "score": 12},
]


def test_normalize_v2_results_requires_all_filled_slots():
    with pytest.raises(MatchV2ResultError, match="alle belegten Teilnehmer"):
        normalize_v2_results(_source_match(), RESULTS[:3])


def test_normalize_v2_results_auto_ranks_fastest_time_when_configured():
    match = _source_match()
    match["settings"] = {"calculation": "time"}

    results = normalize_v2_results(match, [
        {"registration_id": "r1", "time_ms": 65500},
        {"registration_id": "r2", "time_ms": 61200},
        {"registration_id": "r3", "time_ms": 70000},
        {"registration_id": "r4", "time_ms": 64000},
    ])

    assert [row["registration_id"] for row in results] == ["r2", "r4", "r1", "r3"]
    assert [row["rank"] for row in results] == [1, 2, 3, 4]


def test_normalize_v2_results_auto_ranks_lower_score_when_configured():
    match = _source_match()
    match["settings"] = {"calculation": "lower_score"}

    results = normalize_v2_results(match, [
        {"registration_id": "r1", "score": 9},
        {"registration_id": "r2", "score": 4},
        {"registration_id": "r3", "score": 12},
        {"registration_id": "r4", "score": 6},
    ])

    assert [row["registration_id"] for row in results] == ["r2", "r4", "r1", "r3"]


def test_normalize_v2_results_recalculates_supplied_ranks_from_score():
    results = normalize_v2_results(_source_match(), [
        {"registration_id": "r1", "rank": 1, "score": 10},
        {"registration_id": "r2", "rank": 2, "score": 15},
        {"registration_id": "r3", "rank": 3, "score": 4},
        {"registration_id": "r4", "rank": 4, "score": 8},
    ])

    assert [row["registration_id"] for row in results] == ["r2", "r1", "r4", "r3"]
    assert [row["rank"] for row in results] == [1, 2, 3, 4]


def test_v2_result_application_fills_advancement_slots():
    source = _source_match()
    winner_target = _target("m-b", "B")
    loser_target = _target("m-l", "L")

    application = build_v2_result_application(
        source,
        [source, winner_target, loser_target],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
    )

    assert application["match_set"]["status"] == "completed"
    assert application["results"][0]["registration_id"] == "r2"
    assert application["target_sets"]["m-b"]["status"] == "ready"
    assert application["target_sets"]["m-b"]["slots"][0]["registration_id"] == "r2"
    assert application["target_sets"]["m-b"]["slots"][1]["registration_id"] == "r1"
    assert application["target_sets"]["m-l"]["slots"][0]["registration_id"] == "r4"
    assert application["target_sets"]["m-l"]["slots"][1]["registration_id"] == "r3"


def test_l_flow_rank_is_loser_index_after_qualifiers():
    source = {
        "id": "m-a",
        "tournament_id": "t1",
        "stage_id": "s1",
        "match_key": "A",
        "status": "ready",
        "settings": {"match_size": 2, "qualifiers_per_match": 1, "calculation": "points"},
        "slots": [
            {"slot": 1, "registration_id": "winner", "user_id": "u1", "status": "filled"},
            {"slot": 2, "registration_id": "loser", "user_id": "u2", "status": "filled"},
        ],
        "advancement": [
            {"flow": "W", "rank": 1, "to_match_id": "m-w", "to_match_key": "W", "to_slot": 1},
            {"flow": "L", "rank": 1, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 1},
        ],
    }
    winner_target = _target("m-w", "W")
    loser_target = _target("m-l", "L")

    application = build_v2_result_application(
        source,
        [source, winner_target, loser_target],
        [
            {"registration_id": "winner", "score": 2},
            {"registration_id": "loser", "score": 0},
        ],
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
    )

    assert application["target_sets"]["m-w"]["slots"][0]["registration_id"] == "winner"
    assert application["target_sets"]["m-l"]["slots"][0]["registration_id"] == "loser"


def test_result_application_rejects_same_participant_advanced_twice():
    source = {
        "id": "m-a",
        "tournament_id": "t1",
        "stage_id": "s1",
        "match_key": "A",
        "status": "ready",
        "settings": {"calculation": "points"},
        "slots": [
            {"slot": 1, "registration_id": "winner", "user_id": "u1", "status": "filled"},
            {"slot": 2, "registration_id": "loser", "user_id": "u2", "status": "filled"},
        ],
        "advancement": [
            {"flow": "W", "rank": 1, "to_match_id": "m-w", "to_match_key": "W", "to_slot": 1},
            {"flow": "L", "rank": 1, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 1},
        ],
    }

    with pytest.raises(MatchV2ResultError, match="nicht mehrfach weitergeleitet"):
        build_v2_result_application(
            source,
            [source, _target("m-w", "W"), _target("m-l", "L")],
            [
                {"registration_id": "winner", "score": 2},
                {"registration_id": "loser", "score": 0},
            ],
            actor_id="admin",
            now_iso="2026-05-08T12:00:00+00:00",
        )


def test_missing_loser_rank_from_bye_clears_loser_target_slot():
    source = {
        "id": "m-a",
        "tournament_id": "t1",
        "stage_id": "s1",
        "match_key": "A",
        "status": "ready",
        "settings": {"match_size": 2, "qualifiers_per_match": 1, "calculation": "points"},
        "slots": [
            {"slot": 1, "registration_id": "winner", "user_id": "u1", "status": "filled"},
            {"slot": 2, "registration_id": None, "user_id": None, "status": "bye"},
        ],
        "advancement": [
            {"flow": "W", "rank": 1, "to_match_id": "m-w", "to_match_key": "W", "to_slot": 1},
            {"flow": "L", "rank": 1, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 1},
        ],
    }

    application = build_v2_result_application(
        source,
        [source, _target("m-w", "W"), _target("m-l", "L")],
        [{"registration_id": "winner", "score": 1}],
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
    )

    assert application["target_sets"]["m-w"]["slots"][0]["registration_id"] == "winner"
    loser_slot = application["target_sets"]["m-l"]["slots"][0]
    assert loser_slot["registration_id"] is None
    assert loser_slot["status"] == "bye"
    assert loser_slot["source_result"]["reason"] == "bye"


def test_l_flow_can_address_multiple_non_qualifiers():
    source = _source_match()
    source["settings"] = {"match_size": 4, "qualifiers_per_match": 2, "calculation": "points"}
    source["advancement"] = [
        {"flow": "W", "rank": 1, "to_match_id": "m-b", "to_match_key": "B", "to_slot": 1},
        {"flow": "W", "rank": 2, "to_match_id": "m-b", "to_match_key": "B", "to_slot": 2},
        {"flow": "L", "rank": 1, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 1},
        {"flow": "L", "rank": 2, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 2},
    ]

    application = build_v2_result_application(
        source,
        [source, _target("m-b", "B"), _target("m-l", "L")],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
    )

    assert application["target_sets"]["m-b"]["slots"][0]["registration_id"] == "r2"
    assert application["target_sets"]["m-b"]["slots"][1]["registration_id"] == "r1"
    assert application["target_sets"]["m-l"]["slots"][0]["registration_id"] == "r4"
    assert application["target_sets"]["m-l"]["slots"][1]["registration_id"] == "r3"


def test_legacy_l_flow_absolute_rank_still_works_without_stage_settings():
    source = _source_match()
    source.pop("settings", None)

    application = build_v2_result_application(
        source,
        [source, _target("m-b", "B"), _target("m-l", "L")],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
    )

    assert application["target_sets"]["m-l"]["slots"][0]["registration_id"] == "r4"
    assert application["target_sets"]["m-l"]["slots"][1]["registration_id"] == "r3"


def test_v2_result_application_blocks_downstream_overwrite_without_force():
    source = _source_match()
    winner_target = _target("m-b", "B")
    winner_target["slots"][0]["registration_id"] = "old-reg"
    winner_target["slots"][0]["status"] = "filled"

    with pytest.raises(MatchV2ResultError, match="force=true"):
        build_v2_result_application(
            source,
            [source, winner_target, _target("m-l", "L")],
            RESULTS,
            actor_id="admin",
            now_iso="2026-05-08T12:00:00+00:00",
        )


def test_v2_result_application_allows_forced_downstream_correction():
    source = _source_match()
    winner_target = _target("m-b", "B")
    winner_target["status"] = "completed"
    winner_target["results"] = [{"registration_id": "old-reg", "rank": 1}]
    winner_target["slots"][0]["registration_id"] = "old-reg"
    winner_target["slots"][0]["status"] = "filled"

    application = build_v2_result_application(
        source,
        [source, winner_target, _target("m-l", "L")],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
        force=True,
    )

    assert application["target_sets"]["m-b"]["slots"][0]["registration_id"] == "r2"
    assert application["target_sets"]["m-b"]["results"] == []
    assert application["target_sets"]["m-b"]["status"] == "ready"
    assert application["match_set"]["result_meta"]["force"] is True


def test_v2_result_application_force_clears_dependent_downstream_slots():
    source = _source_match()
    winner_target = _target("m-b", "B")
    winner_target["status"] = "completed"
    winner_target["results"] = [{"registration_id": "old-reg", "rank": 1}]
    winner_target["slots"][0]["registration_id"] = "old-reg"
    winner_target["slots"][0]["status"] = "filled"

    downstream_target = _target("m-c", "C")
    downstream_target["status"] = "completed"
    downstream_target["results"] = [{"registration_id": "old-reg", "rank": 1}]
    downstream_target["slots"][0].update({
        "registration_id": "old-reg",
        "user_id": "old-user",
        "status": "filled",
        "source_result": {"from_match_id": "m-b", "rank": 1},
    })

    application = build_v2_result_application(
        source,
        [source, winner_target, _target("m-l", "L"), downstream_target],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
        force=True,
    )

    assert application["target_sets"]["m-b"]["slots"][0]["registration_id"] == "r2"
    assert application["target_sets"]["m-b"]["results"] == []
    assert application["target_sets"]["m-c"]["slots"][0]["registration_id"] is None
    assert application["target_sets"]["m-c"]["slots"][0]["source_result"] is None
    assert application["target_sets"]["m-c"]["results"] == []
    assert application["target_sets"]["m-c"]["status"] == "pending"


def test_v2_randomized_advancement_uses_any_free_target_slot(monkeypatch):
    source = _source_match()
    source["settings"] = {"randomize_advancement_rounds": True}
    winner_target = _target("m-b", "B")
    winner_target["settings"] = {"min_players": 2}
    winner_target["slots"] = [
        {"slot": 1, "registration_id": None, "status": "pending", "source": {"type": "rank", "flow": "W", "match_key": "A", "rank": 1}},
        {"slot": 2, "registration_id": None, "status": "pending", "source": {"type": "rank", "flow": "W", "match_key": "A", "rank": 2}},
        {"slot": 3, "registration_id": None, "status": "pending", "source": {"type": "rank", "flow": "W", "match_key": "B", "rank": 1}},
        {"slot": 4, "registration_id": None, "status": "pending", "source": {"type": "rank", "flow": "W", "match_key": "B", "rank": 2}},
    ]
    loser_target = _target("m-l", "L")
    monkeypatch.setattr("services.match_v2_results.random.choice", lambda candidates: candidates[-1])

    application = build_v2_result_application(
        source,
        [source, winner_target, loser_target],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
    )

    slots = application["target_sets"]["m-b"]["slots"]
    assert slots[3]["registration_id"] == "r2"
    assert slots[2]["registration_id"] == "r1"
