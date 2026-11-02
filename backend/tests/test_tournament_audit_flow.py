"""Protokoll für Anlegen, Speichern und Anmeldestatus (#2111, TA19).

Vorher stand im Protokoll weder, wer ein Turnier angelegt oder geändert hatte, noch wer einen Anmeldestatus gesetzt
hat. Beim Speichern stehen nur die Namen der geänderten Felder drin - keine Inhalte.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def entries(flow, action):
    return await flow.db.audit_logs.find({"action": action}, {"_id": 0}).to_list(20)


@pytest.mark.asyncio
async def test_create_save_and_registration_status_are_logged(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    game_id = new_id()
    await flow.db.games.insert_one({"id": game_id, "name": "Probe-Spiel", "slug": f"probe-{game_id[:6]}"})

    created = await flow.post("/api/tournaments", json={"title": "Protokoll-Cup", "game_id": game_id})
    assert created.status_code == 200, created.text
    tid = created.json()["id"]
    [create] = await entries(flow, "tournament.create")
    assert create["target_id"] == tid and create["actor_id"] == staff["id"]
    assert create["data"]["title"] == "Protokoll-Cup"

    saved = await flow.patch(f"/api/tournaments/{tid}", json={"rules": "Geheim: nur fair spielen", "best_of": 3})
    assert saved.status_code == 200, saved.text
    [update] = await entries(flow, "tournament.update")
    assert update["data"]["fields"] == ["best_of", "rules"]
    assert "Geheim" not in str(update["data"]), "nur Feldnamen, keine Inhalte"
    same = await flow.patch(f"/api/tournaments/{tid}", json={"best_of": 3})
    assert same.status_code == 200
    assert len(await entries(flow, "tournament.update")) == 1, "ohne Änderung kein Eintrag"

    registration = await flow.register({"id": tid}, await flow.add_user(name="Paula"), status="pending")
    changed = await flow.patch(f"/api/tournaments/{tid}/registrations/{registration['id']}", json={"status": "approved"})
    assert changed.status_code == 200, changed.text
    [status] = await entries(flow, "tournament.registration.status")
    assert status["data"] == {"registration_id": registration["id"], "from_status": "pending", "to_status": "approved"}
