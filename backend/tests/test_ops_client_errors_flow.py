"""Fehler-Sammler (#1657) durch die echte Anwendung: Website und App melden ohne Anmeldung an ``/api/ops/client-errors``,
der Server sammelt ohne Personendaten in denselben Gruppen wie seine eigenen Fehler; Häufung warnt genau einmal, die
Aufbewahrung ist einstellbar."""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from flow_harness import load_application, make_flow  # noqa: E402

from models import now_utc  # noqa: E402
from services import ops_alerts  # noqa: E402

NAME = "Max Mustermann"
MAIL = "max.mustermann@example.test"
TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl"
IP = "203.0.113.42"
SECRETS = (NAME, "Mustermann", MAIL, TOKEN, IP)


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


def web_error(**extra):
    return {
        "source": "web",
        "error_type": "TypeError",
        "message": f"Kein Zugriff für {NAME} ({MAIL}), Token {TOKEN}, von {IP}",
        "stack": (f"TypeError: {NAME} {MAIL}\n"
                  f"    at renderTeam (https://lionsquad.at/assets/TeamPage-AbC12_x9.js?token={TOKEN}:12:345)\n"
                  "    at https://lionsquad.at/assets/index-Zz99yy88.js:1:20"),
        "route": f"/u/maxmustermann?email={MAIL}",
        "version": "2.3",
        **extra,
    }


def leaks(doc) -> list[str]:
    text = str(doc)
    return [secret for secret in SECRETS if secret in text]


@pytest.mark.asyncio
async def test_a_web_error_without_login_becomes_a_group_without_personal_data(flow):
    first = await flow.client.post("/api/ops/client-errors", json=web_error())
    second = await flow.client.post("/api/ops/client-errors", json=web_error())
    assert first.status_code == 202 and second.status_code == 202
    assert first.json()["id"] == second.json()["id"], "dieselbe Kennung - derselbe Eintrag in der Liste"

    groups = await flow.db.ops_errors.find({}, {"_id": 0}).to_list(10)
    assert len(groups) == 1
    group = groups[0]
    assert group["source"] == "web" and group["error_type"] == "TypeError"
    assert group["route"] == "/u/:slug" and group["version"] == "2.3" and group["count"] == 2
    assert group["stack"].splitlines() == ["renderTeam (TeamPage.js:12:345)", "index.js:1:20"]
    assert group["first_seen_at"] <= group["last_seen_at"] and group["resolved_at"] is None
    assert "message" not in group, "der Meldungstext wird nie gespeichert"
    assert leaks(group) == []


@pytest.mark.asyncio
async def test_the_app_can_report_too(flow):
    sent = await flow.client.post("/api/ops/client-errors", json={"source": "app", "error_type": "Error", "stack": "at boot (index.android.bundle:1:99)",
                                                                  "route": "/teams/8f3a2b1c9d0e", "version": "1.9.4"})
    assert sent.status_code == 202
    group = await flow.db.ops_errors.find_one({}, {"_id": 0})
    assert group["source"] == "app" and group["route"] == "/teams/:slug" and group["stack"] == "boot (index.android.bundle:1:99)"


@pytest.mark.asyncio
async def test_unknown_sources_too_large_bodies_and_floods_are_refused(flow, still_rate_limit_clock):
    wrong = await flow.client.post("/api/ops/client-errors", json=web_error(source="server"))
    assert wrong.status_code == 422, "nur web und app - der Server meldet sich selbst"
    huge = await flow.client.post("/api/ops/client-errors", content=b'{"stack": "' + b"x" * 40000 + b'"}', headers={"Content-Type": "application/json"})
    assert huge.status_code == 413
    broken = await flow.client.post("/api/ops/client-errors", content=b"{kaputt", headers={"Content-Type": "application/json"})
    assert broken.status_code == 400
    codes = []
    for _ in range(25):
        response = await flow.client.post("/api/ops/client-errors", json=web_error())
        codes.append(response.status_code)
    # Auch abgelehnte Meldungen zählen für die Bremse: 3 abgelehnt + 17 angenommen = 20 je Minute.
    assert codes.count(202) == 17 and codes[17:] == [429] * 8
    assert await flow.db.ops_errors.count_documents({}) == 1


@pytest.mark.asyncio
async def test_the_admin_filters_by_source_and_text(flow):
    await flow.client.post("/api/ops/client-errors", json=web_error())
    await flow.client.post("/api/ops/client-errors", json={"source": "app", "error_type": "RangeError", "stack": "", "route": "/"})
    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    web = (await flow.get("/api/admin/ops/errors?source=web")).json()
    assert [row["source"] for row in web] == ["web"]
    found = (await flow.get("/api/admin/ops/errors?source=all&q=rangeerror")).json()
    assert [row["error_type"] for row in found] == ["RangeError"]
    by_id = (await flow.get(f"/api/admin/ops/errors?q={web[0]['fingerprint'][:8]}")).json()
    assert [row["fingerprint"] for row in by_id] == [web[0]["fingerprint"]], "die Kennung von der Fehlerseite findet die Gruppe"


@pytest_asyncio.fixture
async def boom_route():
    _database, server, *_rest = load_application()

    async def boom(item_id: str):
        raise RuntimeError(f"Absichtlich kaputt für {NAME} <{MAIL}> mit {TOKEN} von {IP}")

    server.app.add_api_route("/api/_test/boom1657/{item_id}", boom, methods=["GET"])
    route = server.app.router.routes[-1]
    try:
        yield server.app
    finally:
        server.app.router.routes.remove(route)


@pytest.mark.asyncio
async def test_a_server_error_keeps_type_place_and_version_only(flow, boom_route, monkeypatch):
    from services import ops_monitor

    monkeypatch.setattr(ops_monitor, "APP_VERSION", "2.3.9")
    async with AsyncClient(transport=ASGITransport(app=boom_route, raise_app_exceptions=False), base_url="http://testserver") as client:
        response = await client.get(f"/api/_test/boom1657/{IP}")
    assert response.status_code == 500
    group = await flow.db.ops_errors.find_one({}, {"_id": 0})
    assert group["source"] == "server" and group["error_type"] == "RuntimeError" and group["version"] == "2.3.9"
    assert group["route"] == "/api/_test/boom1657/{item_id}"
    assert "in boom" in group["stack"]
    assert "message" not in group
    assert leaks(group) == []


@pytest.mark.asyncio
async def test_a_burst_warns_exactly_once(flow, discord_recorder):
    await ops_alerts.save_alert_settings(flow.db, {"spike_threshold": 5, "spike_window_minutes": 10, "rules": {"error_group": {"discord": False}}})
    for _ in range(12):
        await flow.client.post("/api/ops/client-errors", json=web_error())
    await asyncio.sleep(0.1)
    spikes = [call for call in discord_recorder if call.get("event_key") == "ops_error_spike"]
    assert len(spikes) == 1, discord_recorder
    assert spikes[0]["title"].startswith("Häufung") and "/u/:slug" in spikes[0]["title"]
    assert leaks(spikes[0]) == []
    rows = [row for row in await ops_alerts.recent_alerts(flow.db) if row["kind"] == "error_spike"]
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_the_retention_is_a_setting_with_a_default_of_30_days(flow):
    settings = await ops_alerts.load_alert_settings(flow.db)
    assert settings["retention_days"]["ops_errors"] == 30
    await ops_alerts.save_alert_settings(flow.db, {"retention_days": {"ops_errors": 7}})
    await flow.client.post("/api/ops/client-errors", json=web_error())
    group = await flow.db.ops_errors.find_one({}, {"_id": 0})
    expires = group["expires_at"]
    if expires.tzinfo is None:
        from datetime import timezone

        expires = expires.replace(tzinfo=timezone.utc)
    assert timedelta(days=6) < expires - now_utc() <= timedelta(days=7)

    old = (now_utc() - timedelta(days=8)).isoformat()
    await flow.db.ops_errors.insert_one({"fingerprint": "alt", "source": "server", "last_seen_at": old, "first_seen_at": old, "count": 1})
    removed = await ops_alerts.purge_old_logs(flow.db)
    assert removed["ops_errors"] == 1
    assert await flow.db.ops_errors.count_documents({}) == 1


@pytest.mark.asyncio
async def test_browser_errors_do_not_turn_the_server_check_yellow(flow):
    from services.ops_checks import check_error_groups

    await flow.client.post("/api/ops/client-errors", json=web_error())
    check = await check_error_groups(flow.db)
    assert check["status"] == "ok", "Website und App haben eigene Gruppen - die Ampel zählt die des Servers"


@pytest.mark.asyncio
async def test_the_thresholds_are_saved_in_the_admin_and_checked(flow):
    flow.act_as(await flow.add_user(role="superadmin", name="super"))
    view = (await flow.get("/api/admin/ops/alerts")).json()
    assert {view["settings"][key] for key in ("spike_threshold", "spike_window_minutes", "daily_summary_hour", "reach_fail_threshold")} >= {20, 10, 8, 2}
    assert {"error_spike", "daily_summary", "reachability"} <= {kind["key"] for kind in view["kinds"]}
    saved = await flow.put("/api/admin/ops/alerts", json={"spike_threshold": 50, "spike_window_minutes": 5, "daily_summary_hour": 7, "reach_fail_threshold": 3})
    assert saved.status_code == 200
    body = saved.json()
    assert (body["spike_threshold"], body["spike_window_minutes"], body["daily_summary_hour"], body["reach_fail_threshold"]) == (50, 5, 7, 3)
    refused = await flow.put("/api/admin/ops/alerts", json={"spike_threshold": 1})
    assert refused.status_code == 400 and "zwischen 2 und 10000" in refused.json()["detail"]
    assert (await flow.put("/api/admin/ops/alerts", json={"daily_summary_hour": 24})).status_code == 400


@pytest.mark.asyncio
async def test_the_ops_summary_shows_reachability(flow):
    from services import ops_reachability

    ops_reachability._memory.clear()

    async def fine():
        return True

    await ops_reachability.run_reachability(flow.db, {"web": fine, "api": None, "database": fine})
    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    summary = (await flow.get("/api/admin/ops/summary")).json()
    assert summary["reachability"]["overall"] == "ok"
    assert summary["reachability"]["targets"]["web"]["state"] == "up"
    assert summary["reachability"]["targets"]["api"]["state"] == "unchecked"


@pytest.mark.asyncio
async def test_the_event_list_names_the_source(flow):
    await flow.client.post("/api/ops/client-errors", json=web_error())
    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    events = (await flow.get("/api/admin/ops/events?source=server")).json()
    titles = [item["title"] for item in events["items"]]
    assert titles == ["Website · TypeError · /u/:slug"]
