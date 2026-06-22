import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.custom_bracket import (
    BracketSchemaError,
    build_matches_v2_from_schema,
    infer_rounds,
    parse_custom_bracket_schema,
)


SCHEMA = """
[WB]
# Round 1 (8 -> 4)
A=[1,2,3,4]
B=[5,6,7,8]

# Round 2 (4 -> 2)
C=[W:A:1,W:A:2,W:B:1,W:B:2]

[LB]
# Round 1 (4 -> 2)
LA=[L:A:3,L:A:4,L:B:3,L:B:4]
"""


def test_custom_schema_parser_accepts_seed_and_rank_sources():
    specs = parse_custom_bracket_schema(SCHEMA)
    by_key = {spec.key: spec for spec in specs}

    assert list(by_key) == ["A", "B", "C", "LA"]
    assert by_key["A"].sources[0] == {"type": "seed", "seed": 1, "raw": "1"}
    assert by_key["C"].sources[0]["flow"] == "W"
    assert by_key["C"].sources[1]["rank"] == 2
    rounds = infer_rounds(specs)
    assert rounds["A"] == 1
    assert rounds["C"] == 2
    assert rounds["LA"] == 2


def test_custom_schema_rejects_unknown_references():
    with pytest.raises(BracketSchemaError, match="unbekanntes Spiel"):
        parse_custom_bracket_schema("[WB]\nA=[W:Z:1,1]\n")


def test_custom_schema_rejects_cycles():
    with pytest.raises(BracketSchemaError, match="Zyklische Referenz"):
        parse_custom_bracket_schema("[WB]\nA=[W:B:1,1]\nB=[W:A:1,2]\n")


def test_v2_generator_builds_slots_and_advancement():
    registrations = [
        {"id": f"r{i}", "user_id": f"u{i}", "status": "approved", "seed": i}
        for i in range(1, 9)
    ]
    tournament = {"id": "t1", "seeding_mode": "manual"}
    stage = {
        "id": "s1",
        "number": 1,
        "stage_type": "ffa_custom_bracket",
        "match_type": "ffa",
        "settings": {"schema": SCHEMA, "qualifiers_per_match": 2},
    }

    matches = build_matches_v2_from_schema(tournament, stage, registrations)
    by_key = {match["match_key"]: match for match in matches}

    assert len(matches) == 4
    assert by_key["A"]["status"] == "ready"
    assert by_key["C"]["status"] == "pending"
    assert by_key["A"]["slots"][0]["registration_id"] == "r1"
    assert by_key["A"]["slots"][3]["registration_id"] == "r4"
    assert by_key["A"]["settings"]["match_size"] == 4
    assert by_key["A"]["settings"]["min_players"] == 2
    assert {entry["to_match_key"] for entry in by_key["A"]["advancement"]} == {"C", "LA"}
    assert {entry["flow"] for entry in by_key["A"]["advancement"]} == {"W", "L"}


def test_single_elimination_rejects_loser_bracket_flow():
    tournament = {"id": "t1", "format": "single_elim", "seeding_mode": "manual"}
    stage = {
        "id": "s1",
        "stage_type": "single_elimination",
        "match_type": "duel",
        "settings": {"schema": "[WB]\nA=[1,2]\n\n[LB]\nLA=[L:A:2,3]"},
    }

    with pytest.raises(BracketSchemaError, match="Loser-Bracket|Verlierer"):
        build_matches_v2_from_schema(tournament, stage, [], preview=True)


def test_v2_generator_compacts_first_round_ffa_seed_slots():
    schema = "\n".join([
        "[WB]",
        "A=[1,2,3,4]",
        "B=[5,6,7,8]",
        "C=[9,10,11,12]",
        "D=[13,14,15,16]",
        "E=[17,18,19,20]",
        "F=[21,22,23,24]",
        "G=[25,26,27,28]",
        "H=[29,30,31,32]",
    ])
    tournament = {"id": "t1", "seeding_mode": "manual"}
    stage = {
        "id": "s1",
        "number": 1,
        "stage_type": "ffa_custom_bracket",
        "match_type": "ffa",
        "settings": {"schema": schema, "min_players": 2, "qualifiers_per_match": 2},
    }
    registrations = [
        {"id": f"r{i}", "user_id": f"u{i}", "status": "approved", "seed": i}
        for i in range(1, 29)
    ]

    matches = build_matches_v2_from_schema(tournament, stage, registrations)
    counts = [
        sum(1 for slot in match["slots"] if slot.get("registration_id"))
        for match in matches
    ]
    by_key = {match["match_key"]: match for match in matches}

    assert counts == [4, 4, 4, 4, 3, 3, 3, 3]
    assert {match["status"] for match in matches} == {"ready"}
    assert [slot["registration_id"] for slot in by_key["H"]["slots"] if slot.get("registration_id")] == ["r8", "r16", "r24"]


def test_v2_generator_can_build_preview_without_registrations():
    tournament = {"id": "t1", "seeding_mode": "manual"}
    stage = {
        "id": "s1",
        "number": 1,
        "stage_type": "ffa_custom_bracket",
        "match_type": "ffa",
        "settings": {"schema": "[WB]\nA=[1,2,3,4]", "qualifiers_per_match": 2},
    }

    matches = build_matches_v2_from_schema(tournament, stage, [], preview=True)

    assert len(matches) == 1
    assert matches[0]["is_preview"] is True
    assert matches[0]["generation_mode"] == "preview"
    assert matches[0]["status"] == "preview"
    assert {slot["status"] for slot in matches[0]["slots"]} == {"preview"}


def test_v2_custom_duel_uses_default_schema_without_saved_schema():
    tournament = {"id": "t1", "seeding_mode": "manual", "max_participants": 4}
    stage = {
        "id": "s1",
        "number": 1,
        "stage_type": "custom_bracket",
        "match_type": "duel",
        "settings": {},
    }

    matches = build_matches_v2_from_schema(tournament, stage, [], preview=True)

    assert len(matches) == 3
    assert all(match["is_preview"] for match in matches)
    assert [match["match_key"] for match in matches] == ["A", "B", "C"]


def test_v2_ffa_custom_uses_default_schema_without_saved_schema():
    tournament = {"id": "t1", "seeding_mode": "manual", "max_participants": 8}
    stage = {
        "id": "s1",
        "number": 1,
        "stage_type": "ffa_custom_bracket",
        "match_type": "ffa",
        "settings": {"match_size": 4, "qualifiers_per_match": 2},
    }

    matches = build_matches_v2_from_schema(tournament, stage, [], preview=True)
    by_key = {match["match_key"]: match for match in matches}

    assert len(matches) == 3
    assert [slot["source"]["seed"] for slot in by_key["A"]["slots"]] == [1, 2, 3, 4]
    assert [slot["source"]["seed"] for slot in by_key["B"]["slots"]] == [5, 6, 7, 8]
    assert [slot["source"]["match_key"] for slot in by_key["C"]["slots"]] == ["A", "A", "B", "B"]


def test_v2_simple_ffa_uses_default_single_heat_schema():
    tournament = {"id": "t1", "seeding_mode": "manual", "max_participants": 6}
    stage = {
        "id": "s1",
        "number": 1,
        "stage_type": "simple",
        "match_type": "ffa",
        "settings": {"min_players": 2, "qualifiers_per_match": 1},
    }
    registrations = [
        {"id": f"r{i}", "user_id": f"u{i}", "status": "approved", "seed": i}
        for i in range(1, 5)
    ]

    matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=True)

    assert len(matches) == 1
    assert matches[0]["section"] == "MAIN"
    assert matches[0]["match_type"] == "ffa"
    assert [slot.get("registration_id") for slot in matches[0]["slots"][:4]] == ["r1", "r2", "r3", "r4"]
    assert {slot["status"] for slot in matches[0]["slots"][4:]} == {"preview"}


def test_v2_preview_fills_registered_players_and_keeps_free_slots():
    tournament = {"id": "t1", "seeding_mode": "manual", "max_participants": 4}
    stage = {
        "id": "s1",
        "number": 1,
        "stage_type": "single_elimination",
        "match_type": "duel",
        "settings": {},
    }
    registrations = [
        {"id": "r1", "user_id": "u1", "status": "approved", "seed": 1},
        {"id": "r2", "user_id": "u2", "status": "checked_in", "seed": 2},
        {"id": "r-wait", "user_id": "u-wait", "status": "waitlist", "seed": 3},
    ]

    matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=True)
    slots = [slot for match in matches for slot in match["slots"]]

    assert len(matches) == 3
    assert all(match["is_preview"] for match in matches)
    assert {"r1", "r2"} <= {slot.get("registration_id") for slot in slots}
    assert "r-wait" not in {slot.get("registration_id") for slot in slots}
    assert any(slot["status"] == "preview" for slot in slots)


def test_v2_generator_builds_auto_single_elim_schema_and_byes():
    tournament = {"id": "t1", "seeding_mode": "manual", "max_participants": 4, "match_duration_minutes": 9}
    stage = {
        "id": "s1",
        "number": 1,
        "stage_type": "single_elimination",
        "match_type": "duel",
        "settings": {},
    }
    registrations = [
        {"id": "r1", "user_id": "u1", "status": "approved", "seed": 1},
        {"id": "r2", "user_id": "u2", "status": "approved", "seed": 2},
        {"id": "r3", "user_id": "u3", "status": "approved", "seed": 3},
    ]

    matches = build_matches_v2_from_schema(tournament, stage, registrations)
    by_key = {match["match_key"]: match for match in matches}

    assert len(matches) == 3
    assert by_key["A"]["status"] == "completed"
    assert by_key["A"]["results"][0]["registration_id"] == "r1"
    assert by_key["C"]["slots"][0]["registration_id"] == "r1"
    assert all(match["duration_minutes"] == 9 for match in matches)


def test_v2_auto_single_elim_adds_bronze_match_from_semifinal_losers():
    tournament = {
        "id": "t1",
        "seeding_mode": "manual",
        "max_participants": 4,
        "bronze_match": True,
    }
    stage = {
        "id": "s1",
        "number": 1,
        "stage_type": "single_elimination",
        "match_type": "duel",
        "settings": {},
    }
    registrations = [
        {"id": f"r{i}", "user_id": f"u{i}", "status": "approved", "seed": i}
        for i in range(1, 5)
    ]

    matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=True)
    bronze = next(match for match in matches if match["section"] == "BRONZE")
    semifinal_keys = {match["match_key"] for match in matches if match["round"] == 1}
    bronze_sources = [slot["source"] for slot in bronze["slots"]]

    assert len(matches) == 4
    assert bronze["round_name"] == "Spiel um Platz 3"
    assert {source["match_key"] for source in bronze_sources} == semifinal_keys
    assert {source["flow"] for source in bronze_sources} == {"L"}
    assert {source["rank"] for source in bronze_sources} == {2}


def test_v2_custom_duel_schema_adds_bronze_match_when_final_is_clear():
    tournament = {
        "id": "t1",
        "seeding_mode": "manual",
        "max_participants": 4,
        "bronze_match": True,
    }
    stage = {
        "id": "s1",
        "number": 1,
        "stage_type": "custom_bracket",
        "match_type": "duel",
        "settings": {"schema": "[WB]\n# Halbfinale\nA=[1,2]\nB=[3,4]\n# Finale\nC=[W:A:1,W:B:1]"},
    }
    registrations = [
        {"id": f"r{i}", "user_id": f"u{i}", "status": "approved", "seed": i}
        for i in range(1, 5)
    ]

    matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=True)
    bronze = next(match for match in matches if match["section"] == "BRONZE")
    bronze_sources = [slot["source"] for slot in bronze["slots"]]

    assert len(matches) == 4
    assert bronze["round_name"] == "Spiel um Platz 3"
    assert [source["match_key"] for source in bronze_sources] == ["A", "B"]
    assert {source["flow"] for source in bronze_sources} == {"L"}
    assert {source["rank"] for source in bronze_sources} == {2}


def test_v2_generator_builds_auto_double_elim_schema():
    tournament = {"id": "t1", "seeding_mode": "manual", "max_participants": 8, "match_duration_minutes": 12}
    stage = {
        "id": "s1",
        "number": 1,
        "stage_type": "double_elimination",
        "match_type": "duel",
        "settings": {},
    }
    registrations = [
        {"id": f"r{i}", "user_id": f"u{i}", "status": "approved", "seed": i}
        for i in range(1, 9)
    ]

    matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=True)
    sections = {match["section"] for match in matches}

    assert {"WB", "LB", "GF"} <= sections
    assert any(match["match_key"] == "GF" for match in matches)
    assert all(match["match_type"] == "duel" for match in matches)
