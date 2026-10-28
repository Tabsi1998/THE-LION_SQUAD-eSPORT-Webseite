"""Gewinne von Hand anlegen und bearbeiten (#2112): Preis, Wert und Frist; jede Änderung steht im Protokoll."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow):
    tournament = await flow.create_tournament(title="Winter-Cup", status="completed")
    flow.act_as(await flow.add_staff())
    winner = await flow.add_user(name="anna")
    return tournament, winner


@pytest.mark.asyncio
async def test_a_prize_is_added_by_hand_with_its_own_deadline(flow):
    tournament, winner = await setup(flow)
    response = await flow.post("/api/prizes", json={
        "tournament_id": tournament["id"], "user_id": winner["id"], "place": 1,
        "prize_label": "  Sonderpreis   Fair Play ", "prize_value": "Kappe", "pickup_deadline": "2026-12-31T22:59:00.000Z",
    })
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["prize_label"] == "Sonderpreis Fair Play" and data["tournament_title"] == "Winter-Cup"
    assert data["pickup_deadline"] == "2026-12-31T22:59:00+00:00" and data["pickup_deadline_custom"] is True
    assert await flow.db.audit_logs.count_documents({"action": "prizes.create", "entity_id": data["id"]}) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("change, status", [
    ({"tournament_id": "gibt-es-nicht"}, 404),
    ({"prize_label": "   "}, 400),
    ({"place": 0}, 422),
    ({"pickup_deadline": "morgen"}, 400),
])
async def test_a_prize_by_hand_needs_a_real_tournament_label_place_and_date(flow, change, status):
    tournament, winner = await setup(flow)
    body = {"tournament_id": tournament["id"], "user_id": winner["id"], "place": 2, "prize_label": "Gutschein", **change}
    response = await flow.post("/api/prizes", json=body)
    assert response.status_code == status, response.text
    assert await flow.db.prize_pickups.count_documents({}) == 0


@pytest.mark.asyncio
async def test_label_value_and_deadline_can_be_changed_and_are_logged(flow):
    tournament, winner = await setup(flow)
    created = (await flow.post("/api/prizes", json={"tournament_id": tournament["id"], "user_id": winner["id"], "place": 1,
                                                     "prize_label": "Gutschein", "prize_value": "20 €"})).json()
    response = await flow.patch(f"/api/prizes/{created['id']}", json={
        "prize_label": "Gutschein Gaming-Shop", "prize_value": "", "pickup_deadline": "2027-01-15T22:59:00Z",
    })
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["prize_label"] == "Gutschein Gaming-Shop" and data["prize_value"] == ""
    assert data["pickup_deadline"] == "2027-01-15T22:59:00+00:00" and data["pickup_deadline_custom"] is True
    assert data["status"] == "pending"
    log = await flow.db.audit_logs.find_one({"action": "prizes.update", "target_id": created["id"]}, {"_id": 0})
    assert log["data"]["changes"]["prize_label"] == "Gutschein Gaming-Shop"


@pytest.mark.asyncio
async def test_an_empty_label_is_refused_when_editing(flow):
    tournament, winner = await setup(flow)
    created = (await flow.post("/api/prizes", json={"tournament_id": tournament["id"], "user_id": winner["id"], "place": 1,
                                                     "prize_label": "Gutschein"})).json()
    response = await flow.patch(f"/api/prizes/{created['id']}", json={"prize_label": " "})
    assert response.status_code == 400
    assert (await flow.db.prize_pickups.find_one({"id": created["id"]}))["prize_label"] == "Gutschein"


@pytest.mark.asyncio
async def test_only_prize_managers_add_prizes(flow):
    tournament, winner = await setup(flow)
    flow.act_as(winner)
    response = await flow.post("/api/prizes", json={"tournament_id": tournament["id"], "user_id": winner["id"], "place": 1,
                                                    "prize_label": "Alles für mich"})
    assert response.status_code == 403
    assert await flow.db.prize_pickups.count_documents({}) == 0
