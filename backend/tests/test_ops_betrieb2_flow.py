"""Betrieb II (#265) durch die echte Anwendung: Web Vitals kommen anonym an und
werden je Route ausgewertet; die Auto-Checks laufen, werden gespeichert und nur
dem Vereinsadmin gezeigt; ein roter Check und eine neue 5xx-Gruppe melden sich
genau einmal pro Stunde."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import ops_alerts, ops_checks  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    (uploads / "public").mkdir(parents=True)
    monkeypatch.setattr(ops_checks, "UPLOAD_DIR", uploads)
    monkeypatch.setattr(ops_checks, "PUBLIC_UPLOAD_DIR", uploads / "public")
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

    monkeypatch.setattr(discord_service, "send_discord", fake_send)
    return calls


# ---------------------------------------------------------------- Web Vitals

@pytest.mark.asyncio
async def test_vitals_arrive_anonymously_and_are_aggregated_per_route(flow):
    flow.act_as(None)
    response = await flow.post("/api/ops/vitals", json={"entries": [
        {"name": "LCP", "value": 3200, "route": "/news/0123456789abcdef?x=1", "device": "mobile"},
        {"name": "LCP", "value": 1000, "route": "/news/0123456789abcdef", "device": "mobile"},
        {"name": "CLS", "value": 0.02, "route": "/news/0123456789abcdef", "device": "mobile"},
        {"name": "TTI", "value": 1},
        "junk",
    ]})
    assert response.status_code == 202, response.text
    assert response.json()["stored"] == 3

    rows = await flow.db.ops_vitals.find({}, {"_id": 0}).to_list(10)
    assert len(rows) == 3
    assert {row["route"] for row in rows} == {"/news/:id"}
    assert all(set(row) <= {"name", "value", "rating", "route", "device", "at", "expires_at"} for row in rows), "nichts Persönliches"

    admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(admin)
    overview = await flow.get("/api/admin/ops/vitals?days=7")
    assert overview.status_code == 200, overview.text
    data = overview.json()
    assert data["samples"] == 3
    route = data["routes"][0]
    assert route["route"] == "/news/:id"
    assert route["metrics"]["LCP"]["p75"] == 2650, "linear zwischen 1000 und 3200"
    assert route["metrics"]["LCP"]["rating"] == "needs-improvement"
    assert route["metrics"]["CLS"]["rating"] == "good"
    assert data["mobile_overall"]["LCP"]["count"] == 2


@pytest.mark.asyncio
async def test_vitals_refuse_junk_and_stay_admin_only(flow):
    flow.act_as(None)
    bad = await flow.post("/api/ops/vitals", content=b"nicht json", headers={"Content-Type": "application/json"})
    assert bad.status_code == 400
    empty = await flow.post("/api/ops/vitals", json={"entries": "x"})
    assert empty.status_code == 202 and empty.json()["stored"] == 0

    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    assert (await flow.get("/api/admin/ops/vitals")).status_code == 403


# ---------------------------------------------------------------- Auto-Checks

@pytest.mark.asyncio
async def test_checks_run_and_the_club_admin_sees_the_traffic_light(flow):
    run = await ops_checks.run_checks(flow.db)
    assert {check["key"] for check in run["checks"]} == {
        "database", "disk", "uploads", "mail_queue", "change_stream", "image_variants", "error_groups", "scheduler",
    }
    assert run["status"] in {"ok", "warn", "crit"}
    assert run["counts"]["ok"] + run["counts"]["warn"] + run["counts"]["crit"] == 8
    by_key = {check["key"]: check for check in run["checks"]}
    assert by_key["database"]["status"] == "ok"
    assert by_key["uploads"]["status"] == "ok"
    assert by_key["image_variants"]["value"].startswith("0 von 0")
    assert by_key["error_groups"]["status"] == "ok"

    admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(admin)
    overview = await flow.get("/api/admin/ops/checks")
    assert overview.status_code == 200, overview.text
    data = overview.json()
    assert len(data["latest"]["checks"]) == 8
    assert data["history"][0]["runs"] == 1
    assert data["interval_minutes"] == 5

    again = await flow.post("/api/admin/ops/checks/run")
    assert again.status_code == 200, again.text
    assert len(again.json()["checks"]) == 8
    assert await flow.db.ops_check_runs.count_documents({}) == 2

    summary = await flow.get("/api/admin/ops/summary")
    assert summary.json()["checks"]["status"] == again.json()["status"]

    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    assert (await flow.get("/api/admin/ops/checks")).status_code == 403
    assert (await flow.post("/api/admin/ops/checks/run")).status_code == 403


@pytest.mark.asyncio
async def test_a_broken_check_does_not_stop_the_run(flow):
    async def boom():
        raise RuntimeError("kaputt")

    async def fine():
        return ops_checks.result("fine", "Gut", "ok", "1")

    run = await ops_checks.run_checks(flow.db, checks=[("boom", "Kaputt", boom), ("fine", "Gut", fine)])
    assert [c["status"] for c in run["checks"]] == ["crit", "ok"]
    assert run["checks"][0]["value"] == "Prüfung fehlgeschlagen"
    assert run["status"] == "crit"


# ---------------------------------------------------------------- Alarme

@pytest.mark.asyncio
async def test_a_red_check_alerts_once_per_hour(flow, discord_recorder):
    run = {"at": now_utc().isoformat(), "checks": [
        ops_checks.result("mail_queue", "Mail-Queue", "crit", "0 wartend", "2 hängen im Versand"),
        ops_checks.result("disk", "Freier Speicher", "warn", "10 GB frei (12 %)"),
    ]}
    assert await ops_alerts.alert_red_checks(flow.db, run) == ["check:mail_queue"]
    assert len(discord_recorder) == 1
    assert "Mail-Queue ist rot" in discord_recorder[0]["title"]
    assert discord_recorder[0]["event_key"] == "ops_check"

    assert await ops_alerts.alert_red_checks(flow.db, run) == []
    assert len(discord_recorder) == 1, "innerhalb der Stunde keine zweite Meldung"

    await flow.db.ops_alert_state.update_one(
        {"key": "check:mail_queue"}, {"$set": {"last_sent_at": (now_utc() - timedelta(hours=2)).isoformat()}}
    )
    assert await ops_alerts.alert_red_checks(flow.db, run) == ["check:mail_queue"]
    assert len(discord_recorder) == 2


@pytest.mark.asyncio
async def test_a_new_5xx_group_alerts_once_and_4xx_never(flow, discord_recorder):
    group = {"fingerprint": "abc123", "status_code": 500, "error_type": "KeyError", "method": "GET", "route": "/api/teams/{team_id}", "message": "'team_id'", "count": 1}
    assert await ops_alerts.alert_error_group(flow.db, group) is True
    assert await ops_alerts.alert_error_group(flow.db, group) is False
    assert len(discord_recorder) == 1
    assert "KeyError" in discord_recorder[0]["title"]
    assert discord_recorder[0]["color"] == ops_alerts.RED

    assert await ops_alerts.alert_error_group(flow.db, {**group, "fingerprint": "def456", "status_code": 404}) is False
    assert len(discord_recorder) == 1
