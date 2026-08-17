from typing import get_args

import pytest

from models import StageMatchType, StageType, TournamentFormat
from services.competition_formats import (
    FORMAT_CAPABILITIES,
    find_format_capability,
    get_format_capability,
    list_format_capabilities,
)


def test_catalog_covers_every_public_tournament_format_exactly_once():
    assert set(FORMAT_CAPABILITIES) == set(get_args(TournamentFormat))
    assert len(list_format_capabilities()) == len(get_args(TournamentFormat))
    assert {entry.key for entry in list_format_capabilities()} == set(FORMAT_CAPABILITIES)


def test_catalog_only_targets_known_stage_and_match_types():
    stage_types = set(get_args(StageType))
    match_types = set(get_args(StageMatchType))

    for entry in list_format_capabilities():
        assert entry.canonical_stage_type in stage_types
        assert entry.canonical_match_type in match_types
        if entry.rebuild_engine == "stage":
            assert entry.stage_generator_available is True
        if entry.canonical_write_ready:
            assert entry.initial_preview_engine == "stage"
            assert entry.rebuild_engine == "stage"

    # Paket 1 only records and centralizes existing behavior. A format may be
    # marked ready after the canonical read adapter and consumer parity exist.
    assert not any(entry.canonical_write_ready for entry in list_format_capabilities())


@pytest.mark.parametrize(
    ("format_key", "write_model", "initial_engine", "rebuild_engine", "stage_type", "match_type"),
    [
        ("single_elim", "classic", "legacy", "stage", "single_elimination", "duel"),
        ("double_elim", "classic", "legacy", "stage", "double_elimination", "duel"),
        ("round_robin", "classic", "legacy", "legacy", "round_robin_groups", "duel"),
        ("swiss", "classic", "none", "none", "swiss", "duel"),
        ("groups", "classic", "none", "none", "round_robin_groups", "duel"),
        ("ffa", "graph", "stage", "stage", "simple", "ffa"),
        ("battle_royale", "graph", "stage", "stage", "simple", "ffa"),
        ("league", "classic", "legacy", "legacy", "league", "duel"),
        ("time_trial", "external", "none", "none", "simple", "ffa"),
        ("grand_prix", "external", "none", "none", "ffa_league", "ffa"),
        ("custom_bracket", "graph", "stage", "stage", "custom_bracket", "duel"),
        ("ffa_custom_bracket", "graph", "stage", "stage", "ffa_custom_bracket", "ffa"),
    ],
)
def test_catalog_records_current_routing_and_canonical_target(
    format_key,
    write_model,
    initial_engine,
    rebuild_engine,
    stage_type,
    match_type,
):
    entry = get_format_capability(format_key)

    assert entry.current_write_model == write_model
    assert entry.initial_preview_engine == initial_engine
    assert entry.rebuild_engine == rebuild_engine
    assert entry.canonical_stage_type == stage_type
    assert entry.canonical_match_type == match_type


def test_catalog_defaults_to_single_elimination_and_rejects_unknown_values():
    assert get_format_capability(None).key == "single_elim"
    assert find_format_capability("future_unknown_format") is None
    with pytest.raises(ValueError, match="Unknown tournament format"):
        get_format_capability("future_unknown_format")


def test_public_capability_payload_is_a_copy():
    entry = get_format_capability("single_elim")
    payload = entry.public_dict()

    payload["label"] = "changed"

    assert entry.label == "Single Elimination"
