"""Laufbanner in der App (#245): je Banner die Kanäle Website/App; ``?channel=app`` liefert nur
App-Banner, automatische Banner laufen überall, bestehende Banner bleiben Website-only."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes.settings_routes import banner_channels  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def test_channels_default_to_web_and_auto_banners_to_both():
    assert banner_channels({}) == ["web"]
    assert banner_channels({"channels": ["app"]}) == ["app"]
    assert banner_channels({"channels": ["app", "web", "app", "tv"]}) == ["web", "app"]
    assert banner_channels({"source": "auto"}) == ["web", "app"]
    assert banner_channels({"source": "auto", "channels": ["web"]}) == ["web"]


@pytest.mark.asyncio
async def test_app_channel_lists_only_app_banners_and_web_stays_as_before(flow):
    redaktion = await flow.add_user(role="club_admin", name="redaktion")
    flow.act_as(redaktion)
    web_only = await flow.post("/api/settings/site-banners/admin", json={"text": "Nur Website", "priority": 10})
    both = await flow.post("/api/settings/site-banners/admin", json={"text": "Überall", "priority": 20, "channels": ["web", "app"]})
    app_only = await flow.post("/api/settings/site-banners/admin", json={"text": "Nur App", "priority": 30, "channels": ["app"]})
    assert web_only.status_code == 200 and both.status_code == 200 and app_only.status_code == 200, app_only.text
    assert web_only.json()["channels"] == ["web"] and app_only.json()["channels"] == ["app"]
    # Alte Banner ohne Feld: Website, wie bisher.
    await flow.db.site_banners.insert_one({"id": "alt", "text": "Altbestand", "enabled": True, "priority": 5, "source": "manual"})

    flow.act_as(None)
    web = [row["text"] for row in (await flow.get("/api/settings/site-banners")).json()["items"]]
    app = [row["text"] for row in (await flow.get("/api/settings/site-banners?channel=app")).json()["items"]]
    assert web == ["Überall", "Nur Website", "Altbestand"]
    assert app == ["Nur App", "Überall"]
    listed = (await flow.get("/api/settings/site-banners?channel=app")).json()["items"][0]
    assert listed["channels"] == ["app"] and listed["mode"] == "ticker" and listed["speed_seconds"] == 22

    # Umschalten: der App-Banner wird Website-only - und ist in der App weg.
    flow.act_as(redaktion)
    changed = await flow.patch(f"/api/settings/site-banners/admin/{app_only.json()['id']}", json={"channels": ["web"]})
    assert changed.status_code == 200
    flow.act_as(None)
    assert [row["text"] for row in (await flow.get("/api/settings/site-banners?channel=app")).json()["items"]] == ["Überall"]
    admin_rows = None
    flow.act_as(redaktion)
    admin_rows = (await flow.get("/api/settings/site-banners/admin")).json()
    assert {row["text"]: row["channels"] for row in admin_rows}["Nur App"] == ["web"]


@pytest.mark.asyncio
async def test_auto_banners_reach_both_channels(flow):
    await flow.db.game_servers.insert_one({"id": "srv", "name": "Minecraft", "status": "maintenance", "site_banner_enabled": True, "is_active": True, "visibility": "public", "sort_order": 1})
    flow.act_as(None)
    app = (await flow.get("/api/settings/site-banners?channel=app")).json()["items"]
    web = (await flow.get("/api/settings/site-banners")).json()["items"]
    assert any(row["source"] == "auto" and "Minecraft" in row["text"] and row["channels"] == ["web", "app"] for row in app)
    assert any(row["source"] == "auto" and "Minecraft" in row["text"] for row in web)
