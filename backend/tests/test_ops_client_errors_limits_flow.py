"""Fehler-Sammler (#1657), Grenzen: Schalter ab Werk aus, nur Bezeichner als Fehlerart, Obergrenze für neue Gruppen aus
Website und App je Tag mit Sammelgruppe, Häufungen aus Website und App nur in der Tageszusammenfassung, Bremse je
Ereignisart für Alarme, Einstellungen nur einmal gelesen, Annahme auch in der Schreibpause."""
import asyncio
import pathlib
import sys
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from flow_harness import load_application, make_flow  # noqa: E402

from services import ops_alerts, ops_monitor  # noqa: E402

NAME_TEXT = "Max Mustermann wohnt in Wien 1010"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest_asyncio.fixture
async def discord_recorder(monkeypatch):
    import discord_service

    calls = []

    async def fake_send(title, description="", **kwargs):
        calls.append({"title": title, "description": description, **kwargs})
        return {"ok": True, "status_code": 204}

    monkeypatch.setattr(discord_service, "send_ops_discord", fake_send)
    return calls


def client_from(address: str) -> AsyncClient:
    """Ein Absender mit eigener Adresse - die Bremse je Adresse greift dann je Absender."""
    _database, server, *_rest = load_application()
    return AsyncClient(transport=ASGITransport(app=server.app, client=(address, 4711)), base_url="http://testserver")


def random_error(**extra):
    name = "f" + uuid.uuid4().hex[:12]
    return {"source": "web", "error_type": "TypeError", "stack": f"at {name} (https://lionsquad.at/assets/x-{name[:8]}.js:1:2)",
            "route": "/teams", "version": "2.3", **extra}


async def enable(flow, **settings):
    await ops_alerts.save_alert_settings(flow.db, {"client_errors_enabled": True, **settings})


@pytest.mark.asyncio
async def test_the_collector_is_off_by_default_and_stores_nothing(flow):
    settings = await ops_alerts.load_alert_settings(flow.db)
    assert settings["client_errors_enabled"] is False
    response = await flow.client.post("/api/ops/client-errors", json=random_error())
    assert response.status_code == 204
    assert await flow.db.ops_errors.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_free_text_error_type_is_stored_as_error(flow):
    await enable(flow)
    await flow.client.post("/api/ops/client-errors", json=random_error(error_type=NAME_TEXT))
    await flow.client.post("/api/ops/client-errors", json=random_error(error_type={"name": "Max Mustermann"}))
    rows = await flow.db.ops_errors.find({}, {"_id": 0}).to_list(10)
    assert rows and {row["error_type"] for row in rows} == {"Error"}
    assert "Mustermann" not in str(rows)


@pytest.mark.asyncio
async def test_a_flood_of_random_stacks_stops_at_the_daily_cap(flow, still_rate_limit_clock):
    await enable(flow)
    sent = 0
    for index in range(13):
        async with client_from(f"198.51.100.{index + 1}") as client:
            for _ in range(20):
                response = await client.post("/api/ops/client-errors", json=random_error())
                assert response.status_code == 202
                sent += 1
    assert sent == 260
    groups = await flow.db.ops_errors.count_documents({"error_type": {"$ne": ops_monitor.OVERFLOW_TYPE}})
    assert groups == 200
    overflow = await flow.db.ops_errors.find_one({"fingerprint": "client-overflow:web"}, {"_id": 0})
    assert overflow["error_type"] == "Weitere Fehler (Obergrenze)" and overflow["count"] == 60 and overflow["source"] == "web"
    # Eine bekannte Gruppe zählt auch über der Obergrenze weiter.
    known = await flow.db.ops_errors.find_one({"error_type": {"$ne": ops_monitor.OVERFLOW_TYPE}}, {"_id": 0})
    async with client_from("198.51.100.99") as client:
        again = {"source": "web", "error_type": known["error_type"], "stack": "", "route": known["route"], "version": "2.3"}
        again["stack"] = "\n".join(f"at {line.split(' (')[0]} (https://lionsquad.at/assets/{line.split('(')[1].split(':')[0]}:1:2)" for line in known["stack"].splitlines())
        await client.post("/api/ops/client-errors", json=again)
    assert (await flow.db.ops_errors.find_one({"fingerprint": known["fingerprint"]}))["count"] == 2


@pytest.mark.asyncio
async def test_the_cap_is_a_setting(flow):
    await enable(flow, client_group_cap=10)
    for _ in range(15):
        await flow.client.post("/api/ops/client-errors", json=random_error())
    assert await flow.db.ops_errors.count_documents({"error_type": {"$ne": ops_monitor.OVERFLOW_TYPE}}) == 10


@pytest.mark.asyncio
async def test_a_flood_from_outside_raises_no_alert_at_all(flow, discord_recorder, still_rate_limit_clock):
    await enable(flow, emails=["vorstand@example.test"], spike_threshold=3, spike_window_minutes=10,
                 rules={kind: {"discord": True, "email": True} for kind in ("error_spike", "error_group", "client_log_critical")})
    same = random_error()
    for index in range(8):
        async with client_from(f"203.0.113.{index + 1}") as client:
            for _ in range(10):
                await client.post("/api/ops/client-errors", json=same)
            for _ in range(10):
                await client.post("/api/ops/client-errors", json=random_error(source="app"))
    await asyncio.sleep(0.1)
    assert discord_recorder == []
    assert await flow.db.mail_jobs.count_documents({}) == 0
    assert await flow.db.ops_alert_log.count_documents({}) == 0
    group = await flow.db.ops_errors.find_one({"count": 80}, {"_id": 0})
    assert group and group.get("spike_window"), "die Häufung ist vermerkt - für die Tageszusammenfassung"


@pytest.mark.asyncio
async def test_server_bursts_are_braked_per_kind_with_one_summary(flow, discord_recorder):
    await ops_alerts.save_alert_settings(flow.db, {"alert_hourly_cap": 2})
    for index in range(6):
        group = {"fingerprint": f"g{index}", "source": "server", "error_type": "KeyError", "method": "GET", "route": f"/api/x{index}", "count": 30}
        await ops_alerts.alert_error_spike(flow.db, group, 30, 10)
    titles = [call["title"] for call in discord_recorder]
    assert len(titles) == 3
    assert titles[2].startswith("Betrieb: weitere Meldungen „Häufung von Fehlern“")


@pytest.mark.asyncio
async def test_the_settings_are_read_once_not_per_error(flow, monkeypatch):
    await enable(flow)
    ops_monitor.forget_settings()
    calls = {"n": 0}
    real = ops_alerts.load_alert_settings

    async def counting(db):
        calls["n"] += 1
        return await real(db)

    monkeypatch.setattr(ops_alerts, "load_alert_settings", counting)
    for _ in range(5):
        await flow.client.post("/api/ops/client-errors", json=random_error())
    assert calls["n"] == 1


def test_the_collector_accepts_reports_during_the_backup_write_pause():
    from services import maintenance

    assert maintenance.blocks("POST", "/api/ops/client-errors") is False


@pytest.mark.asyncio
async def test_switch_cap_brake_and_recovery_are_saved_in_the_admin(flow):
    flow.act_as(await flow.add_user(role="superadmin", name="super"))
    view = (await flow.get("/api/admin/ops/alerts")).json()["settings"]
    assert (view["client_errors_enabled"], view["client_group_cap"], view["alert_hourly_cap"], view["reach_recover_threshold"]) == (False, 200, 10, 2)
    saved = await flow.put("/api/admin/ops/alerts", json={"client_errors_enabled": True, "client_group_cap": 300, "alert_hourly_cap": 5, "reach_recover_threshold": 3})
    assert saved.status_code == 200
    body = saved.json()
    assert (body["client_errors_enabled"], body["client_group_cap"], body["alert_hourly_cap"], body["reach_recover_threshold"]) == (True, 300, 5, 3)
    assert (await flow.put("/api/admin/ops/alerts", json={"client_group_cap": 5})).status_code == 400
    ops_monitor.forget_settings()
    response = await flow.client.post("/api/ops/client-errors", json=random_error())
    assert response.status_code == 202, "eingeschaltet nimmt der Sammler wieder an"


@pytest.mark.asyncio
async def test_the_daily_cap_counts_new_groups_not_requests(flow, still_rate_limit_clock):
    """40 gleichzeitige Meldungen desselben neuen Fehlers sind eine neue Gruppe - der Tageszähler steht auf 1."""
    await enable(flow)
    same = random_error()

    async def burst(address):
        async with client_from(address) as client:
            return await asyncio.gather(*(client.post("/api/ops/client-errors", json=same) for _ in range(20)))

    replies = await asyncio.gather(burst("192.0.2.1"), burst("192.0.2.2"))
    assert all(reply.status_code == 202 for group in replies for reply in group)
    assert await flow.db.ops_errors.count_documents({}) == 1
    counter = await flow.db.ops_alert_state.find_one({"key": {"$regex": "^client_groups:"}}, {"_id": 0, "count": 1})
    assert counter["count"] == 1


@pytest.mark.asyncio
async def test_each_source_has_its_own_overflow_group(flow):
    await enable(flow, client_group_cap=10)
    for _ in range(12):
        await flow.client.post("/api/ops/client-errors", json=random_error())
    for _ in range(3):
        await flow.client.post("/api/ops/client-errors", json=random_error(source="app"))
    web = await flow.db.ops_errors.find_one({"fingerprint": "client-overflow:web"}, {"_id": 0})
    app = await flow.db.ops_errors.find_one({"fingerprint": "client-overflow:app"}, {"_id": 0})
    assert (web["source"], web["count"]) == ("web", 2)
    assert (app["source"], app["count"]) == ("app", 3)
