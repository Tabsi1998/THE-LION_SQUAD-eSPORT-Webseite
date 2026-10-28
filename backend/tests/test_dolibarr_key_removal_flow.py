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
        refused = await flow.client.delete(path)
        assert refused.status_code == 403
    stored = await flow.db.settings.find_one({"id": "dolibarr"}, {"_id": 0})
    assert stored["api_key"] and stored["write_api_key"]


RESOLVED = {"erp.example.test": ["93.184.216.34"], "neu.example.test": ["93.184.216.35"], "heim.example.test": ["192.168.2.100"],
            "intern.example.test": ["127.0.0.1"]}


@pytest.fixture
def fake_dns(monkeypatch):
    from services import outbound_address

    def resolve(host):
        if host not in RESOLVED:
            raise OSError("unbekannt")
        return RESOLVED[host]

    monkeypatch.setattr(outbound_address, "_resolve", resolve)


@pytest.mark.asyncio
async def test_a_new_address_needs_the_key_again_and_drops_the_write_key(flow, fake_dns):
    """#2112: gespeicherte Schlüssel gehen nie an eine neue Adresse."""
    await admin_with_keys(flow, base_url="https://erp.example.test", api_key=READ_KEY, write_api_key=WRITE_KEY)
    refused = await flow.put("/api/admin/dolibarr/settings", json={"base_url": "https://neu.example.test"})
    assert refused.status_code == 400 and "API-Schlüssel neu" in refused.json()["detail"]
    assert (await status(flow))["base_url"] == "https://erp.example.test"
    same = await flow.put("/api/admin/dolibarr/settings", json={"base_url": "https://erp.example.test", "instance": "verein"})
    assert same.status_code == 200 and "write_api_key_removed" not in same.json()
    moved = await flow.put("/api/admin/dolibarr/settings", json={"base_url": "https://neu.example.test", "api_key": "platzhalter-neu"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["write_api_key_removed"] is True
    now = await status(flow)
    assert now["base_url"] == "https://neu.example.test" and now["api_key_configured"] is True and now["write_api_key_configured"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("address", ["https://127.0.0.1", "https://localhost", "https://169.254.169.254", "https://192.168.2.100",
                                     "https://intern.example.test"])
async def test_production_refuses_local_and_metadata_addresses(flow, fake_dns, address):
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    refused = await flow.put("/api/admin/dolibarr/settings", json={"base_url": address})
    assert refused.status_code == 400, refused.text
    assert await flow.db.settings.find_one({"id": "dolibarr"}) is None


@pytest.mark.asyncio
async def test_home_network_names_and_a_local_test_setup_stay_possible(flow, fake_dns):
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    home = await flow.put("/api/admin/dolibarr/settings", json={"base_url": "https://heim.example.test"})
    assert home.status_code == 200, home.text
    local = await flow.put("/api/admin/dolibarr/settings", json={"environment": "test", "base_url": "http://localhost:18080"})
    assert local.status_code == 200, local.text
    back = await flow.put("/api/admin/dolibarr/settings", json={"environment": "production"})
    assert back.status_code == 400
    metadata = await flow.put("/api/admin/dolibarr/settings", json={"environment": "test", "base_url": "http://169.254.169.254"})
    assert metadata.status_code == 400