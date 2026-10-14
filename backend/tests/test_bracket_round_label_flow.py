"""Runden mit Namen im Turnierbaum (#1259, #1561): die Baum-Antwort trägt je Spiel ``round_label``.

Eine Regel im Server (``services/round_labels``), damit Website, App und TV gleich heißen: „Viertelfinale“,
„Halbfinale“, „Finale“ statt „Runde 1“ bis „Runde 3“; Liga und Gruppen heißen „Spieltag“.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services.round_labels import attach_round_labels  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def test_attach_round_labels_names_rounds_from_the_end():
    matches = [
        {"id": "a", "stage_id": "s", "section": "MAIN", "round": 1, "round_name": "Runde 1"},
        {"id": "b", "stage_id": "s", "section": "MAIN", "round": 2, "round_name": "Runde 2"},
        {"id": "c", "stage_id": "s", "section": "MAIN", "round": 3, "round_name": "Runde 3"},
        {"id": "d", "stage_id": "s", "section": "BRONZE", "round": 3, "round_name": "Spiel um Platz 3"},
        {"id": "e", "stage_id": "g", "section": "group_A", "round": 2, "round_name": "Runde 2"},
    ]
    stages = [{"id": "s", "stage_type": "single_elimination"}, {"id": "g", "stage_type": "round_robin_groups"}]
    attach_round_labels(matches, stages, {"format": "single_elim"})
    assert [match["round_label"] for match in matches] == ["Viertelfinale", "Halbfinale", "Finale", "Spiel um Platz 3", "Spieltag 2"]


def test_attach_round_labels_keeps_double_elimination_words():
    matches = [
        {"id": "w1", "stage_id": "s", "section": "WB", "round": 1, "round_name": "Winner Runde 1"},
        {"id": "w2", "stage_id": "s", "section": "WB", "round": 2, "round_name": "Winner Runde 2"},
        {"id": "l1", "stage_id": "s", "section": "LB", "round": 1, "round_name": "Loser Runde 1"},
        {"id": "l2", "stage_id": "s", "section": "LB", "round": 2, "round_name": "Loser Runde 2"},
        {"id": "gf", "stage_id": "s", "section": "GF", "round": 4, "round_name": "Grand Final"},
        {"id": "gfr", "stage_id": "s", "section": "GF", "round": 5, "round_name": "Grand Final Reset"},
    ]
    attach_round_labels(matches, [{"id": "s", "stage_type": "double_elimination"}], {})
    labels = {match["id"]: match["round_label"] for match in matches}
    assert labels == {"w1": "Winner Runde 1", "w2": "Winner Final", "l1": "Loser Runde 1", "l2": "Loser Final",
                      "gf": "Grand Final", "gfr": "Grand Final Reset"}


@pytest.mark.asyncio
async def test_bracket_response_names_its_rounds(flow):
    staff = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(staff)
    tournament, _users, _registrations = await flow.with_participants(8)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    flow.act_as(None)
    bracket = await flow.get(f"/api/tournaments/{tournament['id']}/bracket")
    assert bracket.status_code == 200, bracket.text
    by_round = {}
    for match in bracket.json()["matches_v2"]:
        by_round.setdefault(match["round"], set()).add(match.get("round_label"))
    assert by_round == {1: {"Viertelfinale"}, 2: {"Halbfinale"}, 3: {"Finale"}}
