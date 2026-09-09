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
            # Schreibfertig heisst: schreibt in den Graph-Speicher. Ob es dazu
            # einen Generator aus dem Format gibt, ist eine andere Frage - das
            # Schweizer System hat bewusst keinen.
            assert entry.current_write_model == "graph"
            if entry.stage_generator_available:
                assert entry.rebuild_engine == "stage"


@pytest.mark.parametrize(
    ("format_key", "write_model", "initial_engine", "rebuild_engine", "stage_type", "match_type"),
    [
        ("single_elim", "graph", "stage", "stage", "single_elimination", "duel"),
        ("double_elim", "graph", "stage", "stage", "double_elimination", "duel"),
        ("round_robin", "graph", "stage", "stage", "round_robin_groups", "duel"),
        # Schweizer System: keine Vorschau moeglich, die Struktur waechst Runde fuer Runde.
        ("swiss", "graph", "none", "none", "swiss", "duel"),
        ("groups", "graph", "stage", "stage", "round_robin_groups", "duel"),
        ("ffa", "graph", "stage", "stage", "simple", "ffa"),
        ("battle_royale", "graph", "stage", "stage", "simple", "ffa"),
        ("league", "graph", "stage", "stage", "league", "duel"),
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


def test_only_the_formats_outside_the_engines_are_still_not_write_ready():
    """Der klassische Speicher ist leer; alles, was ueber die Engines laeuft, ist fertig.

    Zeitfahren und Grand Prix haben gar keinen Turnierbaum - die laufen ueber
    Rundenzeiten und bleiben deshalb aussen vor.
    """
    not_ready = sorted(
        entry.key for entry in list_format_capabilities() if not entry.canonical_write_ready)

    assert not_ready == ["grand_prix", "time_trial"]
    for entry in list_format_capabilities():
        if entry.canonical_write_ready:
            assert entry.current_write_model == "graph", entry.key


def test_no_format_starts_in_the_classic_store_any_more():
    """Solange ein Format dort startet, kann der alte Speicher nicht weg."""
    starts_classic = sorted(
        entry.key for entry in list_format_capabilities()
        if entry.initial_preview_engine == "legacy" or entry.rebuild_engine == "legacy")

    assert starts_classic == []
