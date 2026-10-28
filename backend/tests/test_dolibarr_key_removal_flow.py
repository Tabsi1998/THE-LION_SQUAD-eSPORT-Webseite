"""Dolibarr-Schlüssel entfernen (#2112): Lese- und Schreib-Schlüssel je mit eigenem Weg, mit Protokoll ohne Schlüssel.

Ohne Lese-Schlüssel ist die Anbindung aus. Ohne Schreib-Schlüssel schreibt die Website mit dem Lese-Schlüssel weiter;
fehlt auch der, geht der Schreibzugriff aus. Die Werte hier sind Platzhalter, keine echten Schlüssel.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

READ_KEY = "platzhalter-lese-schluessel"
WRITE_KEY = "platzhalter-schreib-schluessel"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def admin_with_keys(flow, **keys):
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/admin/dolibarr/settings", json={**keys, "write_enabled": True})
    assert response.status_code == 200, response.text
    return admin


async def status(flow):
    return (await flow.get("/api/admin/dolibarr/status")).json()


async def audit_rows(flow, action):
    return await flow.db.audit_logs.find({"action": action}, {"_id": 0}).to_list(5)


@pytest.mark.asyncio
async def test_removing_the_write_key_keeps_writing_with_the_read_key(flow):
    await admin_with_keys(flow, api_key=READ_KEY, write_api_key=WRITE_KEY)
    assert (await status(flow))["write_api_key_configured"] is True
    response = await flow.client.delete("/api/admin/dolibarr/settings/write-api-key")
    assert response.status_code == 200, response.text
    now = await status(flow)
    assert now["write_api_key_configured"] is False and now["api_key_configured"] is True and now["write_enabled"] is True
    rows = await audit_rows(flow, "dolibarr.write_key_removed")
    assert len(rows) == 1 and READ_KEY not in str(rows) and WRITE_KEY not in str(rows)


@pytest.mark.asyncio
async def test_without_any_key_the_write_switch_goes_off(flow):
    await admin_with_keys(flow, write_api_key=WRITE_KEY)
    response = await flow.client.delete("/api/admin/dolibarr/settings/write-api-key")
    assert response.status_code == 200, response.text
    now = await status(flow)
    assert now["write_api_key_configured"] is False and now["write_enabled"] is False


@pytest.mark.asyncio
async def test_removing_the_read_key_turns_the_connection_off(flow):
    await admin_with_keys(flow, api_key=READ_KEY)
    response = await flow.client.delete("/api/admin/dolibarr/settings/api-key")
    assert response.status_code == 200, response.text
    now = await status(flow)
    assert now["api_key_configured"] is False and now["mode"] == "off"
    rows = await audit_rows(flow, "dolibarr.key_removed")
    assert len(rows) == 1 and READ_KEY not in str(rows)


@pytest.mark.asyncio
async def test_only_system_removes_keys(flow):
    await admin_with_keys(flow, api_key=READ_KEY, write_api_key=WRITE_KEY)
    flow.act_as(await flow.add_user(role="tournament_admin", name="turnier"))
    for path in ("/api/admin/dolibarr/settings/api-key", "/api/admin/dolibarr/settings/write-api-key"):
        assert (await flow.client.delete(path)).status_code == 403
    stored = await flow.db.settings.find_one({"id": "dolibarr"}, {"_id": 0})
    assert stored["api_key"] and stored["write_api_key"]
