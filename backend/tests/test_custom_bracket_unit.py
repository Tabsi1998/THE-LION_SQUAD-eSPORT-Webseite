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
    with pytest.raises(BracketSchemaError, match="unbekanntes Match"):
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
    assert {entry["to_match_key"] for entry in by_key["A"]["advancement"]} == {"C", "LA"}
    assert {entry["flow"] for entry in by_key["A"]["advancement"]} == {"W", "L"}
