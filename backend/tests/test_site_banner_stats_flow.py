"""Zähler der Banner (#931): ohne Anmeldung erreichbar, deshalb gebremst je Adresse - und gezählt wird nur ein
Banner, den es gibt (von Hand angelegt oder automatisch)."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import settings_routes  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def banner(flow) -> str:
    redaktion = await flow.add_user(role="club_admin", name="redaktion")
    flow.act_as(redaktion)
    made = await flow.post("/api/settings/site-banners/admin", json={"text": "Vereinsabend am Freitag", "priority": 10})
    assert made.status_code == 200, made.text
    flow.act_as(None)
    return made.json()["id"]


@pytest.mark.asyncio
async def test_a_known_banner_counts_impressions_and_clicks_without_login(flow):
    banner_id = await banner(flow)
    for _ in range(2):
        assert (await flow.post("/api/settings/site-banners/impression", json={"banner_id": banner_id})).status_code == 200
    assert (await flow.post("/api/settings/site-banners/click", json={"banner_id": banner_id})).json() == {"ok": True}
    row = await flow.db.site_banner_stats.find_one({"id": banner_id}, {"_id": 0})
    assert row["impressions"] == 2 and row["clicks"] == 1
    assert row["last_impression_at"] and row["last_click_at"]
    listed = (await flow.get("/api/settings/site-banners")).json()["items"][0]
    assert listed["id"] == banner_id and listed["stats"] == {"impressions": 2, "clicks": 1}


@pytest.mark.asyncio
async def test_an_invented_id_gets_the_same_answer_but_no_row(flow):
    await banner(flow)
    for path in ("impression", "click"):
        for invented in ("gibt-es-nicht", "auto-server-maintenance-erfunden"):
            answer = await flow.post(f"/api/settings/site-banners/{path}", json={"banner_id": invented})
            assert answer.status_code == 200 and answer.json() == {"ok": True}
    assert await flow.db.site_banner_stats.count_documents({}) == 0, "erfundene Kennungen füllen die Sammlung nicht"
    assert (await flow.post("/api/settings/site-banners/impression", json={"banner_id": "x" * 161})).status_code == 422
    assert (await flow.post("/api/settings/site-banners/impression", json={"banner_id": ""})).status_code == 422


@pytest.mark.asyncio
async def test_an_automatic_banner_counts_too(flow):
    await flow.db.game_servers.insert_one({"id": "srv", "name": "Minecraft", "status": "maintenance", "site_banner_enabled": True,
                                           "is_active": True, "visibility": "public", "sort_order": 1})
    shown = (await flow.get("/api/settings/site-banners")).json()["items"]
    assert "auto-server-maintenance-srv" in [row["id"] for row in shown]
    assert (await flow.post("/api/settings/site-banners/impression", json={"banner_id": "auto-server-maintenance-srv"})).status_code == 200
    row = await flow.db.site_banner_stats.find_one({"id": "auto-server-maintenance-srv"}, {"_id": 0})
    assert row["impressions"] == 1


@pytest.mark.asyncio
async def test_the_brake_stops_counting_per_address_and_kind(flow, monkeypatch):
    monkeypatch.setattr(settings_routes, "BANNER_IMPRESSION_LIMIT", 3)
    monkeypatch.setattr(settings_routes, "BANNER_CLICK_LIMIT", 1)
    banner_id = await banner(flow)
    codes = [(await flow.post("/api/settings/site-banners/impression", json={"banner_id": banner_id})).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    # Klicks haben ihre eigene Grenze - eine ausgereizte Einblendung sperrt sie nicht.
    clicks = [(await flow.post("/api/settings/site-banners/click", json={"banner_id": banner_id})).status_code for _ in range(2)]
    assert clicks == [200, 429]
    row = await flow.db.site_banner_stats.find_one({"id": banner_id}, {"_id": 0})
    assert row["impressions"] == 3 and row["clicks"] == 1, "über der Grenze wird nichts mehr gezählt"
