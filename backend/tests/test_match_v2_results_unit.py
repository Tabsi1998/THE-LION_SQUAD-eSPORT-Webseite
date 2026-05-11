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
