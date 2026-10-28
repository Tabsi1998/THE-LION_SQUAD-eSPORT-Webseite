"""AMP-Zugang (#2112): die Oberfläche trägt Adresse, Benutzer und Passwort ein. Das Passwort liegt verschlüsselt und kommt
nie zurück; nur https; „Passwort entfernen“ schaltet die Abfrage ab. Der Wert hier ist ein Platzhalter."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

PASSWORD = "platzhalter-amp-passwort"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def system_admin(flow):
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    return admin


@pytest.mark.asyncio
async def test_access_is_stored_and_the_password_never_comes_back(flow):
    from services.amp_settings import load_amp_settings

    await system_admin(flow)
    response = await flow.put("/api/settings/amp", json={"base_url": " https://amp.example.test ", "username": "website", "password": PASSWORD, "enabled": True})
    assert response.status_code == 200, response.text
    shown = (await flow.get("/api/settings/amp")).json()
    assert shown["configured"] is True and shown["base_url"] == "https://amp.example.test" and "password" not in shown
    assert PASSWORD not in str(await flow.db.settings.find_one({"id": "amp"}, {"_id": 0}))
    assert (await load_amp_settings())["password"] == PASSWORD
    log = await flow.db.audit_logs.find_one({"action": "settings.amp.update"}, {"_id": 0})
    assert log and PASSWORD not in str(log)


@pytest.mark.asyncio
async def test_http_is_refused_and_clearing_the_password_stops_the_sync(flow):
    from services.amp_settings import load_amp_settings

    await system_admin(flow)
    refused = await flow.put("/api/settings/amp", json={"base_url": "http://amp.example.test", "username": "website", "password": PASSWORD})
    assert refused.status_code == 400
    await flow.put("/api/settings/amp", json={"base_url": "https://amp.example.test", "username": "website", "password": PASSWORD, "enabled": True})
    cleared = await flow.put("/api/settings/amp", json={"clear_password": True, "enabled": True})
    assert cleared.status_code == 200, cleared.text
    assert (await flow.get("/api/settings/amp")).json()["configured"] is False
    assert await load_amp_settings() is None


@pytest.mark.asyncio
async def test_only_system_sees_the_amp_access(flow):
    flow.act_as(await flow.add_user(role="tournament_admin", name="turnier"))
    assert (await flow.get("/api/settings/amp")).status_code == 403
    assert (await flow.put("/api/settings/amp", json={"username": "x"})).status_code == 403
