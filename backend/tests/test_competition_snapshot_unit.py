from services.competition_snapshot import (
    STRUCTURE_SNAPSHOT_VERSION,
    adapt_legacy_matches,
    adapt_stage_matches,
    build_structure_snapshot,
    semantic_match_projection,
    structure_snapshot_issues,
)


def _legacy_fixture():
    return [
        {
            "id": "m1",
            "tournament_id": "t1",
            "round": 1,
            "match_index": 0,
            "bracket": "winner",
            "participant_a_id": "r1",
            "participant_b_id": "r2",
            "score_a": 2,
            "score_b": 1,
            "winner_id": "r1",
            "loser_id": "r2",
            "status": "completed",
            "scheduled_at": "2026-08-17T18:00:00+00:00",
            "station_id": "station-1",
            "next_match_id": "m3",
            "next_match_slot": "a",
        },
        {
            "id": "m2",
            "tournament_id": "t1",
            "round": 1,
            "match_index": 1,
            "bracket": "winner",
            "participant_a_id": "r3",
            "participant_b_id": "r4",
            "score_a": 0,
            "score_b": 0,
            "status": "ready",
            "next_match_id": "m3",
            "next_match_slot": "b",
        },
        {
            "id": "m3",
            "tournament_id": "t1",
            "round": 2,
            "match_index": 0,
            "bracket": "winner",
            "participant_a_id": "r1",
            "participant_b_id": None,
            "score_a": 0,
            "score_b": 0,
            "status": "pending",
        },
    ]


def _stage_fixture():
    return [
        {
            "id": "m1",
            "tournament_id": "t1",
            "stage_id": "s1",
            "stage_number": 1,
            "round": 1,
            "order": 0,
            "match_key": "A",
            "section": "WB",
            "match_type": "duel",
            "slots": [
                {"slot": 1, "source": {"type": "seed", "seed": 1}, "registration_id": "r1", "status": "filled"},
                {"slot": 2, "source": {"type": "seed", "seed": 2}, "registration_id": "r2", "status": "filled"},
            ],
            "results": [
                {"registration_id": "r1", "rank": 1, "score": 2},
                {"registration_id": "r2", "rank": 2, "score": 1},
            ],
            "advancement": [
                {"flow": "W", "rank": 1, "to_match_id": "m3", "to_match_key": "C", "to_slot": 1},
            ],
            "status": "completed",
            "scheduled_at": "2026-08-17T18:00:00+00:00",
            "station_id": "station-1",
        },
        {
            "id": "m2",
            "tournament_id": "t1",
            "stage_id": "s1",
            "stage_number": 1,
            "round": 1,
            "order": 1,
            "match_key": "B",
            "section": "WB",
            "match_type": "duel",
            "slots": [
                {"slot": 1, "source": {"type": "seed", "seed": 3}, "registration_id": "r3", "status": "filled"},
                {"slot": 2, "source": {"type": "seed", "seed": 4}, "registration_id": "r4", "status": "filled"},
            ],
            "results": [],
            "advancement": [
                {"flow": "W", "rank": 1, "to_match_id": "m3", "to_match_key": "C", "to_slot": 2},
            ],
            "status": "ready",
        },
        {
            "id": "m3",
            "tournament_id": "t1",
            "stage_id": "s1",
            "stage_number": 1,
            "round": 2,
            "order": 0,
            "match_key": "C",
            "section": "WB",
            "match_type": "duel",
            "slots": [
                {"slot": 1, "source": {"type": "rank", "flow": "W", "match_key": "A", "rank": 1}, "registration_id": "r1", "status": "filled"},
                {"slot": 2, "source": {"type": "rank", "flow": "W", "match_key": "B", "rank": 1}, "registration_id": None, "status": "pending"},
            ],
            "results": [],
            "advancement": [],
            "status": "pending",
        },
    ]


def test_legacy_adapter_builds_slots_results_and_graph_sources_without_mutation():
    source = _legacy_fixture()
    adapted = adapt_legacy_matches(source)
    first = adapted[0]
    final = adapted[2]

    assert first["schema_version"] == STRUCTURE_SNAPSHOT_VERSION
    assert first["source"] == {"engine": "legacy", "collection": "matches"}
    assert [slot["registration_id"] for slot in first["slots"]] == ["r1", "r2"]
    assert [(result["registration_id"], result["rank"], result["score"]) for result in first["results"]] == [
        ("r1", 1, 2),
        ("r2", 2, 1),
    ]
    assert first["advancement"] == [{
        "outcome": "winner",
        "rank": 1,
        "to_match_id": "m3",
        "to_match_key": None,
        "to_position": 1,
    }]
    assert final["slots"][0]["source"] == {
        "type": "match_result",
        "match_id": "m1",
        "match_key": None,
        "outcome": "winner",
        "rank": 1,
    }
    assert "slots" not in source[0]


def test_stage_adapter_resolves_match_key_sources_to_stable_match_ids():
    adapted = adapt_stage_matches(_stage_fixture())
    final = adapted[2]

    assert adapted[0]["source"] == {"engine": "stage", "collection": "matches_v2"}
    assert final["slots"][0]["source"]["match_id"] == "m1"
    assert final["slots"][1]["source"]["match_id"] == "m2"
    assert final["slots"][0]["source"]["outcome"] == "winner"


def test_adapter_tolerates_unset_scores_and_non_numeric_sort_fields():
    legacy = adapt_legacy_matches([{
        "id": "m-void",
        "tournament_id": "t1",
        "round": "Finale",
        "match_index": "unbekannt",
        "participant_a_id": "r1",
        "participant_b_id": "r2",
        "score_a": None,
        "score_b": None,
        "status": "completed",
    }])

    assert [result["outcome"] for result in legacy[0]["results"]] == [None, None]


def test_legacy_and_stage_fixtures_have_equal_engine_independent_semantics():
    legacy = adapt_legacy_matches(_legacy_fixture())
    stage = adapt_stage_matches(_stage_fixture())

    assert [semantic_match_projection(match) for match in legacy] == [
        semantic_match_projection(match) for match in stage
    ]


def test_structure_snapshot_marks_mixed_sources_and_keeps_stage_metadata():
    snapshot = build_structure_snapshot(
        "t1",
        legacy_matches=_legacy_fixture(),
        stage_matches=_stage_fixture(),
        stages=[{"id": "s1", "number": 1, "name": "Finals", "stage_type": "single_elimination", "match_type": "duel"}],
    )

    assert snapshot["schema_version"] == STRUCTURE_SNAPSHOT_VERSION
    assert snapshot["source_engines"] == ["legacy", "stage"]
    assert snapshot["mixed_source"] is True
    assert len(snapshot["matches"]) == 6
    assert snapshot["stages"][0]["name"] == "Finals"


def test_structure_snapshot_validator_reports_broken_duplicate_and_cyclic_edges():
    snapshot = {
        "matches": [
            {
                "id": "a",
                "slots": [{"position": 1}, {"position": 2}],
                "advancement": [
                    {"to_match_id": "b", "to_position": 1},
                    {"to_match_id": "missing", "to_position": 1},
                ],
            },
            {
                "id": "b",
                "slots": [{"position": 1}, {"position": 2}],
                "advancement": [{"to_match_id": "a", "to_position": 1}],
            },
            {"id": "b", "slots": [], "advancement": []},
        ],
    }

    codes = {issue["code"] for issue in structure_snapshot_issues(snapshot)}

    assert {"duplicate_match_id", "missing_advancement_target", "advancement_cycle"} <= codes
