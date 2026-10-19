"""Runden mit Namen im Turnierbaum (#1259, #1561): die Baum-Antwort trägt je Spiel ``round_label``.

Eine Regel im Server (``services/round_labels``), damit Website, App und TV gleich heißen: „Viertelfinale“,
„Halbfinale“, „Finale“ statt „Runde 1“ bis „Runde 3“; Liga und Gruppen heißen „Spieltag“.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
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


# Läufe im Doppel-K.-o., so wie die Turnierleitung sie schreibt (#1591): die Loser-Runden tragen die Nummer ihrer Zeit.
FFA_DOUBLE = """[WB]
# Runde 1
A=[1,2,3,4]
B=[5,6,7,8]
# Finale
C=[W:A:1,W:A:2,W:B:1,W:B:2]

[LB]
# Runde 2
LA=[L:A:1,L:A:2,L:B:1,L:B:2]
# Runde 3
LB=[W:LA:1,W:LA:2,L:C:1,L:C:2]

[GF]
# Grand Final
FINAL=[W:C:1,W:C:2,W:LB:1,W:LB:2]"""


@pytest.mark.asyncio
async def test_loser_rounds_have_the_tree_number_in_bracket_and_live_queue(flow):
    """#1792: Baum, TV und Warteschlange der Leitung nennen dieselbe Loser-Runde - „Loser Runde 1“, nicht „2“."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    start = (now_utc() - timedelta(minutes=5)).replace(microsecond=0)
    tournament, _users, _registrations = await flow.with_participants(
        8, format="ffa_custom_bracket", event_mode="local", schedule_mode="fixed_by_staff", result_entry_mode="staff_only",
        start_date=start.isoformat())
    await flow.db.tournament_stages.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "number": 1, "status": "pending", "name": "Läufe",
        "stage_type": "ffa_custom_bracket", "match_type": "ffa",
        "settings": {"schema": FFA_DOUBLE, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2},
    })
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    await flow.start(tournament)
    for name in ("1", "2"):
        await flow.db.stations.insert_one({"id": new_id(), "name": name, "device_type": "switch2", "tournament_id": tournament["id"],
                                           "status": "free", "current_match_id": None})
    planned = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    applied = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply",
                              json={"fingerprint": planned["fingerprint"], "planned_at": planned["planned_at"]})
    assert applied.status_code == 200, applied.text

    flow.act_as(None)
    bracket = await flow.get(f"/api/tournaments/{tournament['id']}/bracket")
    assert bracket.status_code == 200, bracket.text
    by_key = {match["match_key"]: match for match in bracket.json()["matches_v2"]}
    assert (by_key["LA"]["round"], by_key["LB"]["round"]) == (2, 3), "das Loser Bracket beginnt zur Zeit der zweiten Runde"
    assert {key: by_key[key]["round_label"] for key in ("A", "C", "LA", "LB", "FINAL")} == {
        "A": "Runde 1", "C": "Finale", "LA": "Loser Runde 1", "LB": "Loser Runde 2", "FINAL": "Grand Final"}

    queue = await flow.get(f"/api/tournaments/{tournament['id']}/live-queue")
    assert queue.status_code == 200, queue.text
    labels = {entry["match_key"]: entry["label"] for entry in queue.json()["matches"].values()}
    assert labels["LA"] == "Loser Runde 1" and labels["LB"] == "Loser Runde 2"
