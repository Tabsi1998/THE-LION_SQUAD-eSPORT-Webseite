"""Helfer-Einsatz für Phase, Gruppe, Station oder Spiel (#2111, TA25).

Die Bereich-ID war ein Freitext ohne Prüfung - ein Tippfehler ergab einen Helfer ohne Rechte. Jetzt nimmt der Server
nur Kennungen dieses Turniers an (leer heißt weiter „alle“), und der Helfer bekommt eine Nachricht mit dem Weg zu
„Mein Dienst“.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_the_scope_must_belong_to_the_tournament_and_the_helper_hears_of_it(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(title="Herbst-Cup")
    other = await flow.create_tournament(title="Anderes Turnier")
    tid = tournament["id"]
    await flow.db.tournament_stages.insert_many([{"id": "st-own", "tournament_id": tid}, {"id": "st-other", "tournament_id": other["id"]}])
    await flow.db.stations.insert_many([{"id": "sta-free", "name": "1", "tournament_id": None},
                                        {"id": "sta-other", "name": "2", "tournament_id": other["id"]}])
    helper = await flow.add_user(name="Hanna Helfer")
    url = f"/api/tournaments/{tid}/staff"

    for scope, scope_id in (("stage", "st-other"), ("stage", "tippfehler"), ("station", "sta-other"), ("match", "m-x"), ("group", "g-x")):
        refused = await flow.post(url, json={"user_id": helper["id"], "role": "scorekeeper", "scope": scope, "scope_id": scope_id})
        assert refused.status_code == 422, (scope, scope_id, refused.text)
        assert "gibt es" in refused.json()["detail"]
    assert await flow.db.tournament_staff_assignments.count_documents({"tournament_id": tid}) == 0

    created = await flow.post(url, json={"user_id": helper["id"], "role": "scorekeeper", "scope": "stage", "scope_id": "st-own"})
    assert created.status_code == 200, created.text
    station = await flow.post(url, json={"user_id": helper["id"], "role": "station_manager", "scope": "station", "scope_id": "sta-free"})
    assert station.status_code == 200, station.text
    every_stage = await flow.post(url, json={"user_id": helper["id"], "role": "referee", "scope": "stage", "scope_id": None})
    assert every_stage.status_code == 200, "leer heißt weiter: jede Phase"

    note = await flow.db.notifications.find_one({"user_id": helper["id"], "kind": "tournament_staff"}, {"_id": 0})
    assert note and "Herbst-Cup" in note["title"] and note["url"] == "/admin/dienst"
    assert "Ergebnisdienst" in note["body"]

    moved = await flow.patch(f"{url}/{created.json()['id']}", json={"scope_id": "st-other"})
    assert moved.status_code == 422
