import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from match_rules import (
    loser_for_winner,
    match_allows_draw,
    participant_source_ids,
    validate_winner_id,
)


def test_match_winner_validation_rejects_non_participant():
    match = {"participant_a_id": "reg-a", "participant_b_id": "reg-b", "bracket": "winner"}
    validate_winner_id(match, "reg-a")
    assert loser_for_winner(match, "reg-a") == "reg-b"

    with pytest.raises(HTTPException) as exc:
        validate_winner_id(match, "reg-x")
    assert exc.value.status_code == 400


def test_draw_policy_only_allows_standing_formats():
    assert not match_allows_draw({"bracket": "winner"})
    assert match_allows_draw({"bracket": "round_robin"})
    assert match_allows_draw({"bracket": "swiss"})
    assert match_allows_draw({"bracket": "group_A"})


def test_participant_source_ids_include_current_and_legacy_without_duplicates():
    assert participant_source_ids({
        "participant_a_id": "reg-a",
        "participant_b_id": "reg-b",
        "player1_id": "reg-a",
        "p2_registration_id": "legacy-b",
    }) == ["reg-a", "reg-b", "legacy-b"]
