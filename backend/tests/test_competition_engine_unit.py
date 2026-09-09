"""Which store a rebuild writes into.

A single-elimination tournament used to start in the classic store, and the
first rebuild deleted those matches and recreated them as graph matches. Every
match id changed with them - and the reports, links and chat that pointed at
those ids pointed at nothing afterwards. Nobody asked for that; it followed from
the format table alone.

These tests pin the rule that replaces it: the tournament decides, not the
format. A move is still possible, but it has to be asked for.
"""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.competition_engine import (
    CLASSIC,
    GRAPH,
    EngineSwitchRequired,
    classic_can_rebuild,
    decide_rebuild_engine,
    engine_of_record,
    preferred_engine,
)


def played(**overrides):
    return {"id": "m1", "is_preview": False, **overrides}


def draft(**overrides):
    return {"id": "m1", "is_preview": True, **overrides}


# ---------------------------------------------------------------- Wo liegt es

def test_a_tournament_without_matches_belongs_nowhere_yet():
    assert engine_of_record([], []) is None


def test_real_matches_decide_where_a_tournament_lives():
    assert engine_of_record([played()], []) == CLASSIC
    assert engine_of_record([], [played()]) == GRAPH


def test_a_draft_bracket_does_not_pin_anything():
    """Ein Entwurf hat keine Ergebnisse - ihn neu zu zeichnen kostet nichts."""
    assert engine_of_record([draft()], []) is None
    assert engine_of_record([], [draft()]) is None


def test_the_classic_store_wins_when_both_hold_matches():
    """Ein Mischzustand ist ein Altlastfall; der aeltere Speicher bleibt maßgeblich."""
    assert engine_of_record([played()], [played()]) == CLASSIC


# ---------------------------------------------------------------- Enginewahl

def test_an_empty_tournament_follows_its_format():
    decision = decide_rebuild_engine("ffa", preferred=GRAPH)

    assert decision.engine == GRAPH
    assert decision.switched is False
    assert decision.pinned is None


def test_a_played_tournament_keeps_its_store_even_if_the_format_prefers_the_other():
    """Der Kern von Block 4: Einzelausscheidung wandert nicht mehr beim Neuaufbau."""
    decision = decide_rebuild_engine(
        "single_elim", preferred=GRAPH, legacy_matches=[played()])

    assert decision.engine == CLASSIC
    assert decision.switched is False
    assert decision.pinned == CLASSIC


@pytest.mark.parametrize("format_key", ["single_elim", "double_elim", "round_robin", "league"])
def test_every_format_the_classic_generator_knows_stays_put(format_key):
    decision = decide_rebuild_engine(
        format_key, preferred=GRAPH, legacy_matches=[played()])

    assert decision.engine == CLASSIC


def test_a_draft_bracket_may_still_move_to_the_preferred_store():
    decision = decide_rebuild_engine(
        "single_elim", preferred=GRAPH, legacy_matches=[draft()])

    assert decision.engine == GRAPH
    assert decision.switched is False


def test_a_move_that_cannot_be_avoided_is_refused_instead_of_done_quietly():
    """Gruppen kann der klassische Generator nicht neu bauen - hier waere der
    Neuaufbau ein Umzug, und der wird nicht nebenbei erledigt."""
    with pytest.raises(EngineSwitchRequired) as error:
        decide_rebuild_engine("groups", preferred=GRAPH, legacy_matches=[played()])

    assert error.value.from_engine == CLASSIC
    assert error.value.to_engine == GRAPH
    assert "Migration" in error.value.reason


def test_a_confirmed_move_is_carried_out_and_reported_as_one():
    decision = decide_rebuild_engine(
        "groups", preferred=GRAPH, legacy_matches=[played()], allow_switch=True)

    assert decision.engine == GRAPH
    assert decision.switched is True
    assert decision.pinned == CLASSIC


def test_a_graph_tournament_is_never_pushed_back_into_the_classic_store():
    with pytest.raises(EngineSwitchRequired):
        decide_rebuild_engine("single_elim", preferred=CLASSIC, stage_matches=[played()])


def test_the_store_it_already_lives_in_needs_no_confirmation():
    decision = decide_rebuild_engine(
        "ffa", preferred=GRAPH, stage_matches=[played()])

    assert decision.engine == GRAPH
    assert decision.switched is False


# ---------------------------------------------------------------- Randfragen

def test_the_format_preference_follows_the_catalog():
    """Jedes Format zeigt inzwischen auf den Graph-Speicher."""
    for key in ("ffa", "league", "groups", "single_elim", "round_robin"):
        assert preferred_engine(key) == GRAPH, key


def test_an_unknown_format_does_not_crash_the_decision():
    assert preferred_engine("historisch_unbekannt") == CLASSIC
    assert classic_can_rebuild("historisch_unbekannt") is False


def test_only_the_four_formats_the_legacy_generator_builds_count_as_rebuildable():
    assert classic_can_rebuild("single_elim") is True
    assert classic_can_rebuild("swiss") is False
    assert classic_can_rebuild("groups") is False
    assert classic_can_rebuild(None) is True
