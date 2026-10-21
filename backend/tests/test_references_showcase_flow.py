"""Vitrine der Referenzen-Übersicht (#1878): welcher Erfolg die Hauptkarte bekommt, ist in der Verwaltung einstellbar.
Vorgabe „automatisch“ (die Seite wählt den höchsten Platz in der höchsten Stufe, bei Gleichstand den neuesten), sonst
eine fest gewählte Referenz. Die öffentliche Liste nennt die Einstellung mit - eine gewählte Referenz nur, wenn der
Besucher sie sehen darf. Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

SHOWCASE = "/api/references/admin/showcase"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _reference(flow, title, placement, **extra):
    response = await flow.post("/api/references", json={
        "title": title, "entries": [{"kind": "team", "team_name": "Probe Löwen", "placement": placement}], **extra})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_the_showcase_defaults_to_automatic(flow):
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    await _reference(flow, "Probe Cup", 1)
    response = await flow.get(SHOWCASE)
    assert response.status_code == 200, response.text
    assert response.json() == {"mode": "auto", "reference_id": None}
    flow.act_as(None)
    assert (await flow.get("/api/references")).json()["showcase"] == {"mode": "auto", "reference_id": None}


@pytest.mark.asyncio
async def test_the_board_pins_a_reference_and_the_public_list_names_it(flow):
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    await _reference(flow, "Probe Cup", 1)
    second = await _reference(flow, "Probe Liga", 2)
    saved = await flow.patch(SHOWCASE, json={"mode": "pinned", "reference_id": second["id"]})
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"mode": "pinned", "reference_id": second["id"]}
    assert (await flow.get(SHOWCASE)).json() == {"mode": "pinned", "reference_id": second["id"]}
    flow.act_as(None)
    assert (await flow.get("/api/references")).json()["showcase"] == {"mode": "pinned", "reference_id": second["id"]}

    # Zurück auf automatisch: die gewählte Referenz fällt weg.
    flow.act_as(admin)
    back = await flow.patch(SHOWCASE, json={"mode": "auto", "reference_id": second["id"]})
    assert back.json() == {"mode": "auto", "reference_id": None}


@pytest.mark.asyncio
async def test_a_pinned_reference_must_exist(flow):
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    missing = await flow.patch(SHOWCASE, json={"mode": "pinned", "reference_id": "gibt-es-nicht"})
    assert missing.status_code == 404
    empty = await flow.patch(SHOWCASE, json={"mode": "pinned"})
    assert empty.status_code == 422
    wrong = await flow.patch(SHOWCASE, json={"mode": "irgendwas"})
    assert wrong.status_code == 422
    assert (await flow.get(SHOWCASE)).json() == {"mode": "auto", "reference_id": None}


@pytest.mark.asyncio
async def test_a_hidden_pinned_reference_reads_as_automatic_for_visitors(flow):
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    await _reference(flow, "Probe Cup", 1)
    hidden = await _reference(flow, "Probe Intern", 1, visibility="members")
    assert (await flow.patch(SHOWCASE, json={"mode": "pinned", "reference_id": hidden["id"]})).status_code == 200
    flow.act_as(None)
    body = (await flow.get("/api/references")).json()
    assert body["showcase"] == {"mode": "auto", "reference_id": None}
    assert hidden["id"] not in str(body)


@pytest.mark.asyncio
async def test_every_change_of_the_showcase_lands_in_the_admin_log(flow):
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    first = await _reference(flow, "Probe Cup", 1)
    second = await _reference(flow, "Probe Liga", 2)
    assert (await flow.patch(SHOWCASE, json={"mode": "pinned", "reference_id": first["id"]})).status_code == 200
    assert (await flow.patch(SHOWCASE, json={"mode": "pinned", "reference_id": second["id"]})).status_code == 200
    # Dieselbe Auswahl noch einmal gespeichert ist keine Änderung.
    assert (await flow.patch(SHOWCASE, json={"mode": "pinned", "reference_id": second["id"]})).status_code == 200
    assert (await flow.patch(SHOWCASE, json={"mode": "auto"})).status_code == 200
    logs = await flow.db.audit_logs.find(
        {"action": "references.showcase_change"}, {"_id": 0}).sort("created_at", 1).to_list(None)
    auto = {"mode": "auto", "reference_id": None}
    pinned_first = {"mode": "pinned", "reference_id": first["id"]}
    pinned_second = {"mode": "pinned", "reference_id": second["id"]}
    assert [(log["actor_id"], log["data"]["previous"], log["data"]["showcase"]) for log in logs] == [
        (admin["id"], auto, pinned_first),
        (admin["id"], pinned_first, pinned_second),
        (admin["id"], pinned_second, auto),
    ]
    assert all(log.get("id") and log.get("created_at") for log in logs)


@pytest.mark.asyncio
async def test_only_the_content_area_changes_the_showcase(flow):
    player = await flow.add_user(role="user", name="spieler")
    flow.act_as(player)
    assert (await flow.get(SHOWCASE)).status_code in (401, 403)
    assert (await flow.patch(SHOWCASE, json={"mode": "auto"})).status_code in (401, 403)
    flow.act_as(None)
    assert (await flow.patch(SHOWCASE, json={"mode": "auto"})).status_code in (401, 403)
