from services.competition_structure_plan import (
    STRUCTURE_PLAN_VERSION,
    deterministic_structure_id,
    ordered_plan_registrations,
    stabilize_legacy_plan_matches,
    stabilize_stage_plan_matches,
    stable_structure_digest,
    structure_plan_hash,
    structure_plan_seed,
)


def test_stable_digest_ignores_generated_timestamps_but_not_structure_changes():
    first = {
        "updated_at": "2026-08-17T10:00:00Z",
        "matches": [{"id": "m1", "status": "ready", "created_at": "old"}],
    }
    same = {
        "matches": [{"status": "ready", "created_at": "new", "id": "m1"}],
        "updated_at": "2026-08-17T11:00:00Z",
    }
    changed = {"matches": [{"id": "m1", "status": "completed"}]}

    assert stable_structure_digest(first) == stable_structure_digest(same)
    assert stable_structure_digest(first) != stable_structure_digest(changed)


def test_plan_seed_is_order_independent_and_bound_to_base_state():
    tournament = {"id": "t1", "format": "single_elim", "seeding_mode": "random"}
    registrations = [
        {"id": "r2", "status": "approved", "seed": 2},
        {"id": "r1", "status": "approved", "seed": 1},
        {"id": "bad-seed", "status": "approved", "seed": "unknown"},
    ]
    base = {"schema_version": "competition.structure.v1", "matches": []}

    first = structure_plan_seed(tournament, {"preview": False}, registrations, base)
    reordered = structure_plan_seed(
        tournament,
        {"preview": False},
        list(reversed(registrations)),
        base,
    )
    changed = structure_plan_seed(
        tournament,
        {"preview": False},
        registrations,
        {**base, "matches": [{"id": "existing"}]},
    )

    assert first == reordered
    assert first["seed"] != changed["seed"]
    assert [row["id"] for row in ordered_plan_registrations(registrations)] == [
        "r1", "r2", "bad-seed",
    ]


def test_stage_plan_ids_and_edges_are_deterministic():
    matches = [
        {
            "id": "random-a",
            "match_key": "A",
            "slots": [],
            "advancement": [{"to_match_id": "random-b"}],
        },
        {
            "id": "random-b",
            "match_key": "B",
            "slots": [{
                "source": {"match_id": "random-a"},
                "source_result": {"from_match_id": "random-a"},
            }],
            "advancement": [],
        },
    ]
    stage_id = deterministic_structure_id("seed", "stage", "1")

    stabilized = stabilize_stage_plan_matches(matches, seed="seed", stage_id=stage_id)

    assert stabilized[0]["id"] == deterministic_structure_id("seed", "match", "A")
    assert stabilized[0]["advancement"][0]["to_match_id"] == stabilized[1]["id"]
    assert stabilized[1]["slots"][0]["source"]["match_id"] == stabilized[0]["id"]
    assert stabilized[1]["slots"][0]["source_result"]["from_match_id"] == stabilized[0]["id"]
    assert {match["stage_id"] for match in stabilized} == {stage_id}


def test_legacy_plan_ids_preserve_next_match_references():
    matches = [
        {
            "id": "random-a",
            "bracket": "winner",
            "round": 1,
            "match_index": 0,
            "next_match_id": "random-b",
        },
        {
            "id": "random-b",
            "bracket": "winner",
            "round": 2,
            "match_index": 0,
        },
    ]

    stabilized = stabilize_legacy_plan_matches(matches, seed="seed")

    assert stabilized[0]["next_match_id"] == stabilized[1]["id"]
    assert stabilized[0]["id"] != "random-a"


def test_plan_hash_is_bound_to_validation_input_and_version():
    structure = {"matches": [{"id": "m1"}]}
    first = structure_plan_hash(
        engine="graph",
        base_structure_hash="base",
        input_hash="input",
        planned_structure=structure,
    )
    changed = structure_plan_hash(
        engine="graph",
        base_structure_hash="other-base",
        input_hash="input",
        planned_structure=structure,
    )

    assert STRUCTURE_PLAN_VERSION == "competition.structure-plan.v1"
    assert first != changed
