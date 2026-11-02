"""Der Spielplan einer laufenden Staffel ist nicht über die Phasen-Routen löschbar (#2201, D-14). Erfundene Namen.

``DELETE /stages/{id}?force=true`` und ``POST /stages/{id}/generate?force=true`` nahmen Spiele samt Ergebnissen mit. Sperre
wie beim Neuaufbau (``staffel_rebuild_problem``). Vor dem Start und für andere Turniere bleibt alles, wie es ist.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import world as league_world  # noqa: E402
from services.staffel_guard import STAFFEL_REBUILD_REFUSED  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def with_stage(flow, world) -> str:
    stage_id = world["match"]["stage_id"]
    await flow.db.tournament_stages.insert_one({
        "id": stage_id, "tournament_id": world["tournament"]["id"], "number": 1, "name": "Liga", "stage_type": "league",
        "match_type": "duel", "settings": {}})
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {
        "status": "completed", "results": [{"registration_id": world["reg_a"]["id"], "rank": 1, "score": 2},
                                           {"registration_id": world["reg_h"]["id"], "rank": 2, "score": 0}]}})
    return stage_id


async def still_there(flow, world, stage_id: str) -> None:
    assert await flow.db.tournament_stages.count_documents({"id": stage_id}) == 1
    stored = await flow.reload(world["match"])
    assert stored["status"] == "completed" and stored["results"], "das Ergebnis bleibt"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["live", "paused", "completed"])
async def test_deleting_the_stage_of_a_started_staffel_is_refused_even_with_force(flow, status):
    world = await league_world(flow)
    stage_id = await with_stage(flow, world)
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"status": status}})
    flow.act_as(world["staff"])
    for query in ("", "?force=true"):
        answer = await flow.delete(f"/api/tournaments/{world['tournament']['id']}/stages/{stage_id}{query}")
        assert answer.status_code == 409, answer.text
    await still_there(flow, world, stage_id)


@pytest.mark.asyncio
async def test_regenerating_the_stage_of_a_started_staffel_is_refused_even_with_force(flow):
    world = await league_world(flow)
    stage_id = await with_stage(flow, world)
    flow.act_as(world["staff"])
    answer = await flow.post(f"/api/tournaments/{world['tournament']['id']}/stages/{stage_id}/generate?force=true")
    assert answer.status_code == 409, answer.text
    assert answer.json()["detail"] == STAFFEL_REBUILD_REFUSED
    await still_there(flow, world, stage_id)


@pytest.mark.asyncio
async def test_a_draft_staffel_with_only_a_preview_can_still_change_its_stage(flow):
    """Vor dem Start gibt es nur Vorschau-Spiele - nichts geht verloren."""
    world = await league_world(flow)
    tid = world["tournament"]["id"]
    await flow.db.tournaments.update_one({"id": tid}, {"$set": {"status": "draft"}})
    stage_id = new_id()
    await flow.db.matches_v2.delete_many({"tournament_id": tid})
    await flow.db.tournament_stages.insert_one({"id": stage_id, "tournament_id": tid, "number": 1, "name": "Liga",
                                                "stage_type": "league", "match_type": "duel", "settings": {}})
    await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": tid, "stage_id": stage_id, "is_preview": True,
                                         "status": "preview", "match_type": "duel", "slots": []})
    flow.act_as(world["staff"])
    answer = await flow.delete(f"/api/tournaments/{tid}/stages/{stage_id}?force=true")
    assert answer.status_code == 200, answer.text
    assert not await flow.db.tournament_stages.count_documents({"id": stage_id})


@pytest.mark.asyncio
async def test_other_tournaments_keep_force(flow):
    """Regression: außerhalb der Liga fragt der Server weiter nach und löscht mit ``force``."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _registrations = await flow.with_participants(4, format="single_elim", event_mode="online")
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    await flow.start(tournament)
    stage_id = (await flow.matches(tournament))[0]["stage_id"]
    asked = await flow.delete(f"/api/tournaments/{tournament['id']}/stages/{stage_id}")
    assert asked.status_code == 409 and asked.json()["detail"]["code"] == "confirm_destruction"
    regenerated = await flow.post(f"/api/tournaments/{tournament['id']}/stages/{stage_id}/generate?force=true")
    assert regenerated.status_code == 200, regenerated.text
    new_stage = (await flow.matches(tournament))[0]["stage_id"]
    deleted = await flow.delete(f"/api/tournaments/{tournament['id']}/stages/{new_stage}?force=true")
    assert deleted.status_code == 200, deleted.text
