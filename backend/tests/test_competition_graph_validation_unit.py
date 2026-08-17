from services.competition_graph_validation import (
    GRAPH_VALIDATION_VERSION,
    validate_competition_graph,
)
from services.competition_snapshot import adapt_stage_matches
from services.custom_bracket import build_matches_v2_from_schema


def _direct_match(match_id: str, registrations: tuple[str, str]) -> dict:
    return {
        "id": match_id,
        "slots": [
            {
                "position": position,
                "registration_id": registration_id,
                "source": {"type": "direct"},
            }
            for position, registration_id in enumerate(registrations, start=1)
        ],
        "results": [],
        "advancement": [],
    }


def _result_slot(position: int, source_id: str, outcome: str = "winner", rank=1) -> dict:
    return {
        "position": position,
        "registration_id": None,
        "source": {
            "type": "match_result",
            "match_id": source_id,
            "outcome": outcome,
            "rank": rank,
        },
    }


def _edge(target_id: str, position: int, outcome: str = "winner", rank=1) -> dict:
    return {
        "outcome": outcome,
        "rank": rank,
        "to_match_id": target_id,
        "to_position": position,
    }


def _codes(report: dict) -> set[str]:
    return {issue["code"] for issue in report["issues"]}


def test_validator_accepts_multiple_roots_and_independent_matches():
    first = _direct_match("a", ("r1", "r2"))
    second = _direct_match("b", ("r3", "r4"))
    final = {
        "id": "final",
        "slots": [_result_slot(1, "a"), _result_slot(2, "b")],
        "results": [],
        "advancement": [],
    }
    first["advancement"] = [_edge("final", 1)]
    second["advancement"] = [_edge("final", 2)]
    independent = _direct_match("round-robin-game", ("r1", "r3"))

    report = validate_competition_graph({"matches": [first, second, final, independent]})

    assert report == {
        "validation_version": GRAPH_VALIDATION_VERSION,
        "valid": True,
        "match_count": 4,
        "validated_match_count": 4,
        "issue_count": 0,
        "error_count": 0,
        "warning_count": 0,
        "issue_counts": {},
        "issues": [],
    }


def test_validator_reports_missing_source_and_unreachable_match():
    target = {
        "id": "target",
        "slots": [_result_slot(1, "missing"), {"position": 2, "source": {"type": "bye"}}],
        "results": [],
        "advancement": [],
    }

    report = validate_competition_graph({"matches": [target]})

    assert report["valid"] is False
    assert {"missing_slot_source_match", "unreachable_match"} <= _codes(report)


def test_validator_checks_both_sides_of_slot_advancement_contract():
    source = _direct_match("source", ("r1", "r2"))
    target = {
        "id": "target",
        "slots": [_result_slot(1, "source", outcome="winner", rank=2)],
        "results": [],
        "advancement": [],
    }
    source["advancement"] = [_edge("target", 1, outcome="winner", rank=1)]

    report = validate_competition_graph({"matches": [source, target]})

    assert "target_slot_contract_mismatch" in _codes(report)

    source["advancement"] = []
    report_without_edge = validate_competition_graph({"matches": [source, target]})
    assert "missing_source_advancement" in _codes(report_without_edge)


def test_validator_reports_cycles_and_unreachable_cycle_members():
    first = {
        "id": "a",
        "slots": [_result_slot(1, "b")],
        "results": [],
        "advancement": [_edge("b", 1)],
    }
    second = {
        "id": "b",
        "slots": [_result_slot(1, "a")],
        "results": [],
        "advancement": [_edge("a", 1)],
    }

    report = validate_competition_graph({"matches": [first, second]})

    assert "advancement_cycle" in _codes(report)
    unreachable = {
        issue["match_id"]
        for issue in report["issues"]
        if issue["code"] == "unreachable_match"
    }
    assert unreachable == {"a", "b"}


def test_validator_reports_duplicate_slots_participants_results_and_incoming_edges():
    first = _direct_match("a", ("same", "same"))
    first["results"] = [
        {"registration_id": "same", "rank": 1},
        {"registration_id": "same", "rank": 2},
    ]
    second = _direct_match("b", ("r3", "r4"))
    target = {
        "id": "target",
        "slots": [
            _result_slot(1, "a"),
            {"position": 1, "source": {"type": "bye"}},
        ],
        "results": [],
        "advancement": [],
    }
    first["advancement"] = [_edge("target", 1)]
    second["advancement"] = [_edge("target", 1)]

    report = validate_competition_graph({"matches": [first, second, target]})

    assert {
        "duplicate_slot_position",
        "duplicate_match_participant",
        "duplicate_result_participant",
        "duplicate_target_slot_source",
    } <= _codes(report)


def test_validator_reports_invalid_result_advancement_and_source_ranks():
    source = _direct_match("source", ("r1", "r2"))
    source["results"] = [{"registration_id": "r1", "rank": 3}]
    source["advancement"] = [_edge("target", 1, rank=3)]
    target = {
        "id": "target",
        "slots": [_result_slot(1, "source", rank=3)],
        "results": [],
        "advancement": [],
    }

    report = validate_competition_graph({"matches": [source, target]})

    assert {
        "invalid_result_rank",
        "invalid_advancement_rank",
        "invalid_slot_source_rank",
    } <= _codes(report)


def test_validator_reports_edge_without_matching_target_slot_source():
    source = _direct_match("source", ("r1", "r2"))
    source["advancement"] = [_edge("target", 1)]
    target = {
        "id": "target",
        "slots": [{"position": 1, "source": {"type": "unassigned"}}],
        "results": [],
        "advancement": [],
    }

    report = validate_competition_graph({"matches": [source, target]})

    assert "missing_target_slot_source" in _codes(report)


def test_validator_handles_large_graph_without_recursive_traversal():
    match_count = 1500
    matches = []
    for index in range(match_count):
        match_id = f"m-{index}"
        match = {
            "id": match_id,
            "slots": (
                [{"position": 1, "source": {"type": "direct"}}]
                if index == 0
                else [_result_slot(1, f"m-{index - 1}")]
            ),
            "results": [],
            "advancement": [],
        }
        if index:
            matches[index - 1]["advancement"] = [_edge(match_id, 1)]
        matches.append(match)

    report = validate_competition_graph({"matches": matches})

    assert report["valid"] is True
    assert report["validated_match_count"] == match_count


def test_validator_accepts_current_single_double_and_ffa_generators():
    registrations = [
        {"id": f"r{index}", "user_id": f"u{index}", "status": "approved", "seed": index}
        for index in range(1, 9)
    ]
    cases = [
        (
            {"id": "single", "format": "single_elim", "seeding_mode": "manual", "max_participants": 8},
            {"id": "single-stage", "number": 1, "stage_type": "single_elimination", "match_type": "duel", "settings": {}},
        ),
        (
            {"id": "double", "format": "double_elim", "seeding_mode": "manual", "max_participants": 8},
            {"id": "double-stage", "number": 1, "stage_type": "double_elimination", "match_type": "duel", "settings": {}},
        ),
        (
            {"id": "ffa", "format": "ffa_custom_bracket", "seeding_mode": "manual", "max_participants": 8},
            {
                "id": "ffa-stage",
                "number": 1,
                "stage_type": "ffa_custom_bracket",
                "match_type": "ffa",
                "settings": {"match_size": 4, "qualifiers_per_match": 2},
            },
        ),
    ]

    for tournament, stage in cases:
        generated = build_matches_v2_from_schema(
            tournament,
            stage,
            registrations,
            preview=True,
        )
        report = validate_competition_graph({"matches": adapt_stage_matches(generated)})

        assert report["valid"] is True, (stage["stage_type"], report)
