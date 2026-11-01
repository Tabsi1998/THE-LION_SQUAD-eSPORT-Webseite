"""Station bearbeiten (#2112): Name, Gerät, Hinweis und Spiel lassen sich nach dem Anlegen ändern - durch die echte Route.

Mit denselben Rechten wie Anlegen und Löschen und mit Protokoll. Was am Betrieb hängt (Status, aktuelles Spiel), bleibt beim
alten Weg und steht nicht im Protokoll der Bearbeitungen.
"""
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


async def station(flow, **fields) -> dict:
    row = {"id": "st-1", "name": "Switch 1", "device_type": "switch2", "status": "free", "current_match_id": None, "notes": None, "game_id": None, **fields}
    await flow.db.stations.insert_one(dict(row))
    return row


@pytest.mark.asyncio
async def test_details_can_be_changed_and_are_logged(flow):
    lead = await flow.add_user(role="superadmin", name="leitung")
    flow.act_as(lead)
    await station(flow)
    await flow.db.games.insert_one({"id": "g-1", "name": "Mario Kart"})

    response = await flow.patch("/api/stations/st-1", json={"name": "  Tisch 3  ", "device_type": "pc", "notes": " Hinten links ", "game_id": "g-1"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["name"], body["device_type"], body["notes"], body["game_id"]) == ("Tisch 3", "pc", "Hinten links", "g-1")
    assert body["status"] == "free", "der Betrieb bleibt, wie er ist"
    log = await flow.db.audit_logs.find_one({"action": "station.update", "target_id": "st-1"})
    assert log["actor_id"] == lead["id"]
    assert log["data"]["changes"]["name"] == {"from": "Switch 1", "to": "Tisch 3"}
    assert log["data"]["changes"]["game_id"] == {"from": None, "to": "g-1"}


@pytest.mark.asyncio
async def test_a_note_and_game_can_be_cleared_and_nothing_changed_logs_nothing(flow):
    flow.act_as(await flow.add_user(role="superadmin", name="leitung"))
    await station(flow, notes="Alt", game_id="g-1")
    await flow.db.games.insert_one({"id": "g-1", "name": "Mario Kart"})

    same = await flow.patch("/api/stations/st-1", json={"name": "Switch 1", "notes": "Alt", "game_id": "g-1"})
    assert same.status_code == 200
    assert await flow.db.audit_logs.count_documents({"action": "station.update"}) == 0

    cleared = await flow.patch("/api/stations/st-1", json={"notes": "  ", "game_id": None})
    assert cleared.json()["notes"] is None and cleared.json()["game_id"] is None
    assert await flow.db.audit_logs.count_documents({"action": "station.update"}) == 1


@pytest.mark.asyncio
async def test_the_running_status_is_not_part_of_the_edit_log(flow):
    flow.act_as(await flow.add_user(role="superadmin", name="leitung"))
    await station(flow)

    assert (await flow.patch("/api/stations/st-1", json={"status": "broken"})).status_code == 200

    assert await flow.db.audit_logs.count_documents({"action": "station.update"}) == 0


@pytest.mark.asyncio
async def test_empty_name_unknown_game_and_unknown_station_are_refused(flow):
    flow.act_as(await flow.add_user(role="superadmin", name="leitung"))
    await station(flow)

    blank = await flow.patch("/api/stations/st-1", json={"name": "   "})
    assert blank.status_code == 422
    assert "Namen" in blank.json()["detail"]
    assert (await flow.patch("/api/stations/st-1", json={"game_id": "gibt-es-nicht"})).status_code == 404
    assert (await flow.patch("/api/stations/weg", json={"name": "Neu"})).status_code == 404
    assert (await flow.db.stations.find_one({"id": "st-1"}))["name"] == "Switch 1"


@pytest.mark.asyncio
async def test_only_the_tournament_lead_may_edit(flow):
    await station(flow)
    flow.act_as(await flow.add_user(role="user", name="mitglied"))
    assert (await flow.patch("/api/stations/st-1", json={"name": "Meins"})).status_code in (401, 403)
    flow.act_as(await flow.add_user(role="moderator", name="moni"))
    assert (await flow.patch("/api/stations/st-1", json={"name": "Meins"})).status_code in (401, 403)
    assert (await flow.db.stations.find_one({"id": "st-1"}))["name"] == "Switch 1"
