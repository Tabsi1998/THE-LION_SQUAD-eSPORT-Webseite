"""Alarme (#517): Regeln je Ereignisart (Discord/E-Mail), Sperrfrist, Testalarm, neue Anlässe, Aufbewahrung."""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import ops_alerts, scheduler  # noqa: E402


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


async def mail_jobs(flow):
    return await flow.db.mail_jobs.find({"template_key": "ops_alert"}, {"_id": 0}).to_list(50)


@pytest.mark.asyncio
async def test_rules_have_defaults_and_are_saved_with_checks(flow):
    """Vorgabe: Discord an, E-Mail aus. Der Admin setzt Empfänger, Sperrfrist, Regeln und Aufbewahrung;
    „Mail nicht zustellbar“ geht nie per Mail; Unsinn wird abgelehnt."""
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    view = (await flow.get("/api/admin/ops/alerts")).json()
    assert view["settings"]["rules"]["error_group"] == {"discord": True, "email": False} and view["settings"]["cooldown_minutes"] == 60
    assert view["settings"]["retention_days"] == {"email_logs": 90, "audit_logs": 730}
    assert [k["key"] for k in view["kinds"]] == list(ops_alerts.ALERT_KINDS) and next(k for k in view["kinds"] if k["key"] == "mail_failed")["email_allowed"] is False
    staff = await flow.add_user(role="tournament_admin", name="turnierleitung")
    flow.act_as(staff)
    assert (await flow.put("/api/admin/ops/alerts", json={"cooldown_minutes": 30})).status_code == 403, "nur der Bereich System darf ändern"

    flow.act_as(admin)
    saved = (await flow.put("/api/admin/ops/alerts", json={
        "emails": "Vorstand@Example.test, kassier@example.test", "cooldown_minutes": 30,
        "rules": {"error_group": {"email": True}, "mail_failed": {"email": True}}, "retention_days": {"email_logs": 30},
    })).json()
    assert saved["emails"] == ["vorstand@example.test", "kassier@example.test"] and saved["cooldown_minutes"] == 30
    assert saved["rules"]["error_group"] == {"discord": True, "email": True}
    assert saved["rules"]["mail_failed"]["email"] is False, "eine Mail über kaputten Mailversand käme nicht an"
    assert saved["retention_days"] == {"email_logs": 30, "audit_logs": 730}
    assert (await flow.put("/api/admin/ops/alerts", json={"emails": ["kein-mail"]})).status_code == 400
    assert (await flow.put("/api/admin/ops/alerts", json={"cooldown_minutes": 2})).status_code == 400
    assert (await flow.put("/api/admin/ops/alerts", json={"retention_days": {"email_logs": 3}})).status_code == 400
    assert (await flow.put("/api/admin/ops/alerts", json={"rules": {"unbekannt": {"discord": True}}})).status_code == 400


@pytest.mark.asyncio
async def test_notify_goes_the_configured_ways_and_respects_the_cooldown(flow, discord_recorder):
    await ops_alerts.save_alert_settings(flow.db, {"emails": ["vorstand@example.test", "kassier@example.test"], "rules": {"error_group": {"email": True}}, "cooldown_minutes": 10})
    outcome = await ops_alerts.notify(flow.db, "error_group", "Serverfehler: X", "Details", [{"name": "HTTP", "value": "500", "inline": True}], key="error:abc")
    assert outcome == {"sent": True, "channels": ["discord", "email"]}
    assert len(discord_recorder) == 1 and discord_recorder[0]["event_key"] == "ops_error_group" and discord_recorder[0]["url"] == "/admin/ops"
    jobs = await mail_jobs(flow)
    assert sorted(j["to"] for j in jobs) == ["kassier@example.test", "vorstand@example.test"] and jobs[0]["subject"] == "[Betrieb] Serverfehler: X"
    assert "Serverfehler: X" in jobs[0]["html"] and "HTTP" in jobs[0]["html"]

    # Sperrfrist: derselbe Schlüssel schweigt, ein anderer meldet.
    assert (await ops_alerts.notify(flow.db, "error_group", "Serverfehler: X", key="error:abc"))["reason"] == "cooldown"
    assert (await ops_alerts.notify(flow.db, "error_group", "Serverfehler: Y", key="error:def"))["sent"] is True
    assert len(discord_recorder) == 2
    # Nach der Frist wieder.
    await flow.db.ops_alert_state.update_one({"key": "error:abc"}, {"$set": {"last_sent_at": (now_utc() - timedelta(minutes=11)).isoformat()}})
    assert (await ops_alerts.notify(flow.db, "error_group", "Serverfehler: X", key="error:abc"))["sent"] is True

    # Regel aus: nichts geht raus, aber die Meldung steht im Verlauf.
    await ops_alerts.save_alert_settings(flow.db, {"rules": {"check_red": {"discord": False, "email": False}}})
    assert (await ops_alerts.notify(flow.db, "check_red", "Check rot", key="check:db")) == {"sent": False, "channels": []}
    recent = await ops_alerts.recent_alerts(flow.db)
    assert [row["kind"] for row in recent][:2] == ["check_red", "error_group"] and recent[0]["channels"] == []

    # „Mail nicht zustellbar“ nie per Mail, auch wenn Empfänger da sind.
    before = len(await mail_jobs(flow))
    assert (await ops_alerts.notify(flow.db, "mail_failed", "Mail nicht zustellbar: Test", key="mail:custom"))["channels"] == ["discord"]
    assert len(await mail_jobs(flow)) == before


@pytest.mark.asyncio
async def test_existing_triggers_use_the_rules(flow, discord_recorder):
    """Rote Checks und 5xx-Gruppen laufen über dieselben Regeln - Discord wie bisher, E-Mail nach Regel."""
    await ops_alerts.save_alert_settings(flow.db, {"emails": ["vorstand@example.test"], "rules": {"check_red": {"email": True}}})
    run = {"at": now_utc().isoformat(), "checks": [{"key": "database", "label": "Datenbank", "status": "crit", "value": "keine Antwort", "detail": ""}, {"key": "disk", "label": "Speicher", "status": "ok"}]}
    assert await ops_alerts.alert_red_checks(flow.db, run) == ["check:database"]
    assert discord_recorder[-1]["title"] == "Betrieb: Datenbank ist rot" and len(await mail_jobs(flow)) == 1
    assert await ops_alerts.alert_error_group(flow.db, {"fingerprint": "f1", "status_code": 500, "error_type": "ValueError", "method": "GET", "route": "/x", "message": "kaputt", "count": 1}) is True
    assert await ops_alerts.alert_error_group(flow.db, {"fingerprint": "f2", "status_code": 404}) is False
    assert len(await mail_jobs(flow)) == 1, "5xx-Gruppen nur per Discord (Vorgabe)"


@pytest.mark.asyncio
async def test_test_alert_and_new_triggers(flow, discord_recorder, monkeypatch):
    superadmin = await flow.add_user(role="superadmin", name="super")
    flow.act_as(superadmin)
    await ops_alerts.save_alert_settings(flow.db, {"emails": ["vorstand@example.test"], "rules": {"job_failed": {"email": True}}})
    test = (await flow.post("/api/admin/ops/alerts/test")).json()
    assert test["sent"] is True and test["channels"] == ["discord", "email"] and test["emails"] == ["vorstand@example.test"]
    assert discord_recorder[-1]["title"].startswith("Testalarm")

    # Abgebrochener Job → Alarm (angestoßen, nicht gewartet).
    scheduler._log_task_failure("mail_queue", RuntimeError("weg"))
    await asyncio.sleep(0.05)
    rows = await ops_alerts.recent_alerts(flow.db)
    assert rows[0]["kind"] == "job_failed" and "mail_queue" in rows[0]["title"] and rows[0]["channels"] == ["discord", "email"]

    # Roter Dolibarr-Abgleich → Alarm mit dem Text des Fehlers.
    import services.dolibarr_sync as dolibarr_sync
    import services.dolibarr_applications as dolibarr_applications

    async def failing_sync():
        return {"ok": False, "error": "unauthorized", "text": "API-Schlüssel abgelehnt (401)"}

    async def quiet_refresh():
        return {"ok": True}

    monkeypatch.setattr(dolibarr_sync, "run_sync", failing_sync)
    monkeypatch.setattr(dolibarr_applications, "refresh_due", quiet_refresh)
    await scheduler._safe_dolibarr_sync()
    rows = await ops_alerts.recent_alerts(flow.db)
    assert rows[0]["kind"] == "dolibarr_sync_failed" and "401" in rows[0]["description"]

    # Kritischer App-Fehler → Alarm ohne Nutzdaten, mit Plattform und Version.
    paula = await flow.add_user(role="player", name="paula")
    flow.act_as(paula)
    assert (await flow.post("/api/mobile/client-logs", json={"level": "fatal", "message": "Absturz beim Start", "platform": "android", "app_version": "1.0.0", "context": {"screen": "Login"}})).status_code == 200
    await asyncio.sleep(0.05)
    rows = await ops_alerts.recent_alerts(flow.db)
    assert rows[0]["kind"] == "client_log_critical" and "Absturz" in rows[0]["description"]


@pytest.mark.asyncio
async def test_retention_purges_old_mail_and_audit_rows(flow):
    old = (now_utc() - timedelta(days=100)).isoformat()
    fresh = (now_utc() - timedelta(days=10)).isoformat()
    await flow.db.email_logs.insert_many([{"id": "e-old", "created_at": old}, {"id": "e-new", "created_at": fresh}])
    await flow.db.audit_logs.insert_many([{"id": "a-old", "created_at": (now_utc() - timedelta(days=800)).isoformat()}, {"id": "a-new", "created_at": old}])
    removed = await ops_alerts.purge_old_logs(flow.db)
    assert removed == {"email_logs": 1, "audit_logs": 1}
    assert [r["id"] for r in await flow.db.email_logs.find({}, {"_id": 0}).to_list(10)] == ["e-new"]
    assert [r["id"] for r in await flow.db.audit_logs.find({}, {"_id": 0}).to_list(10)] == ["a-new"]
    await ops_alerts.save_alert_settings(flow.db, {"retention_days": {"email_logs": 7}})
    assert (await ops_alerts.purge_old_logs(flow.db)) == {"email_logs": 1, "audit_logs": 0}
