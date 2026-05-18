import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from routes.tournament_routes import (
    _can_create_initial_legacy_preview,
    _estimate_legacy_preview_matches,
)


def test_initial_preview_uses_selected_tournament_format():
    assert _estimate_legacy_preview_matches({"format": "single_elim", "max_participants": 16}) == 15
    assert _estimate_legacy_preview_matches({"format": "double_elim", "max_participants": 8}) == 15
    assert _estimate_legacy_preview_matches({"format": "round_robin", "max_participants": 8}) == 28


def test_initial_preview_skips_unsupported_or_too_large_formats():
    assert _can_create_initial_legacy_preview({"format": "single_elim", "max_participants": 64}) is True
    assert _can_create_initial_legacy_preview({"format": "ffa", "max_participants": 16}) is False
    assert _can_create_initial_legacy_preview({"format": "league", "max_participants": 32}) is False
