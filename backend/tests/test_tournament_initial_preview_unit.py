import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from routes.tournament_routes import (
    _can_create_initial_legacy_preview,
    _estimate_legacy_preview_matches,
    _mixed_preview_registrations_for_tournament,
)
from bracket_engine import generate_bracket


def test_initial_preview_uses_selected_tournament_format():
    assert _estimate_legacy_preview_matches({"format": "single_elim", "max_participants": 16}) == 15
    assert _estimate_legacy_preview_matches({"format": "double_elim", "max_participants": 8}) == 15
    assert _estimate_legacy_preview_matches({"format": "round_robin", "max_participants": 8}) == 28


def test_initial_preview_skips_unsupported_or_too_large_formats():
    assert _can_create_initial_legacy_preview({"format": "single_elim", "max_participants": 64}) is True
    assert _can_create_initial_legacy_preview({"format": "ffa", "max_participants": 16}) is False
    assert _can_create_initial_legacy_preview({"format": "league", "max_participants": 32}) is False


def test_mixed_preview_fills_free_slots_with_preview_seeds():
    tournament = {"id": "t1", "format": "single_elim", "max_participants": 4}
    registrations = [
        {"id": "r1", "status": "approved", "display_name": "One"},
        {"id": "r-wait", "status": "waitlist", "display_name": "Wait"},
        {"id": "r2", "status": "checked_in", "display_name": "Two"},
    ]

    mixed = _mixed_preview_registrations_for_tournament(tournament, registrations)

    assert [reg["id"] for reg in mixed] == ["r1", "r2", "preview-seed-3", "preview-seed-4"]
    assert all(reg["status"] in {"approved", "checked_in"} for reg in mixed)
    assert [reg.get("is_preview", False) for reg in mixed] == [False, False, True, True]


def test_mixed_preview_can_generate_bracket_with_real_and_free_slots():
    tournament = {"id": "t1", "format": "single_elim", "max_participants": 4, "seeding_mode": "manual"}
    registrations = [
        {"id": "r1", "status": "approved", "display_name": "One", "seed": 1},
        {"id": "r2", "status": "approved", "display_name": "Two", "seed": 2},
    ]

    mixed = _mixed_preview_registrations_for_tournament(tournament, registrations)
    matches = generate_bracket(tournament, mixed, preview=True)
    participant_ids = {
        pid
        for match in matches
        for pid in (match.get("participant_a_id"), match.get("participant_b_id"))
        if pid
    }

    assert len(matches) == 3
    assert {"r1", "r2", "preview-seed-3", "preview-seed-4"} <= participant_ids
    assert all(match["is_preview"] for match in matches)
