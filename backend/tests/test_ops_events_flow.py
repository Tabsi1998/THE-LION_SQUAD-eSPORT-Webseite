"""Ereignisse aller Quellen in einer Liste (#517 Teil 2): Serverfehler, Auto-Checks, Alarme, App-Logs, E-Mail,
Mail-Queue, Adminaktionen, Uploads, Dolibarr-Abgleich und Discord-Bot - mit Filtern nach Quelle, Schwere,
Zeitraum und Text, als JSON und als CSV; nur für den Bereich System."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_events_merge_all_sources_and_filters_work_as_json_and_csv(flow):
    now = now_utc()
    fresh = now.isoformat()
    old = (now - timedelta(days=20)).isoformat()
    db = flow.db
    await db.ops_errors.insert_one({"fingerprint": "f1", "error_type": "KeyError", "route": "/api/teams/{team_id}", "method": "GET", "status_code": 500,
                                    "count": 7, "message": "'team_id'", "actor": "angemeldet", "first_seen_at": old, "last_seen_at": fresh, "resolved_at": None})
    await db.ops_check_runs.insert_one({"id": "run1", "at": fresh, "status": "crit", "counts": {"ok": 5, "warn": 0, "crit": 1}, "failing": ["mail_queue"], "checks": []})
    await db.ops_alert_log.insert_one({"id": "a1", "kind": "server_error", "key": "k", "title": "Serverfehler: KeyError", "description": "", "channels": ["discord"], "at": fresh})
    await db.mobile_client_logs.insert_one({"id": "c1", "level": "error", "status": "open", "message": "App stürzt beim Öffnen des Chats ab", "source": "chat", "received_at": fresh, "priority_rank": 1})
    await db.email_logs.insert_many([
        {"id": "m1", "to": "x@lionsquad-test.at", "subject": "Passwort", "template_key": "password_reset", "status": "failed", "error": "550 mailbox unavailable", "created_at": fresh},
        {"id": "m0", "to": "y@lionsquad-test.at", "subject": "Alt", "template_key": "registration", "status": "sent", "created_at": old},
    ])
    await db.audit_logs.insert_one({"id": "au1", "action": "user.role.change", "actor_id": "admin", "target_id": "u-1", "data": {"changed_fields": ["role"]}, "created_at": fresh})
    await db.upload_events.insert_one({"id": "up1", "status": "success", "filename": "logo.png", "kind": "image", "created_at": fresh})
    await db.settings.replace_one({"id": "dolibarr_sync_state"}, {"id": "dolibarr_sync_state", "ok": False, "last_run_at": fresh, "last_error": {"kind": "unauthorized", "text": "401", "at": fresh}}, upsert=True)
    await db.settings.replace_one({"id": "discord_bot_state"}, {"id": "discord_bot_state", "status": "online", "guild_name": "LION SQUAD", "updated_at": fresh}, upsert=True)

    admin = await flow.add_user(role="superadmin")
    flow.act_as(admin)

    everything = (await flow.get("/api/admin/ops/events", params={"hours": 0, "limit": 100})).json()
    by_source = {}
    for item in everything["items"]:
        by_source.setdefault(item["source"], []).append(item)
    assert set(by_source) == {"server", "checks", "alerts", "client", "email", "audit", "uploads", "sync", "bot"}
    assert by_source["server"][0]["severity"] == "error" and "KeyError" in by_source["server"][0]["title"] and by_source["server"][0]["href"] == "/admin/ops?tab=errors"
    assert by_source["checks"][0]["title"] == "Auto-Checks rot" and by_source["checks"][0]["subtitle"] == "mail_queue"
    assert by_source["sync"][0]["severity"] == "error" and "401" in by_source["sync"][0]["detail"]
    assert by_source["bot"][0]["severity"] == "success" and "online" in by_source["bot"][0]["title"]
    assert len(by_source["email"]) == 2
    assert everything["items"][0]["time"] >= everything["items"][-1]["time"], "neueste zuerst"
    sources = {row["key"]: row for row in everything["sources"]}
    assert sources["server"]["problem_count"] == 1 and sources["email"]["problem_count"] == 1 and "items" not in sources["server"]

    # Zeitraum: die alte Mail fällt weg; Schwere: nur Probleme; Quelle: nur Adminaktionen; Text.
    week = (await flow.get("/api/admin/ops/events", params={"hours": 168, "limit": 100})).json()
    assert len([i for i in week["items"] if i["source"] == "email"]) == 1
    problems = (await flow.get("/api/admin/ops/events", params={"hours": 0, "severity": "problem"})).json()["items"]
    assert problems and all(i["severity"] in {"error", "warn"} for i in problems)
    assert {i["source"] for i in problems} >= {"server", "checks", "alerts", "client", "email", "sync"}
    audit = (await flow.get("/api/admin/ops/events", params={"hours": 0, "source": "audit"})).json()["items"]
    assert [i["source"] for i in audit] == ["audit"] and audit[0]["title"] == "user.role.change"
    searched = (await flow.get("/api/admin/ops/events", params={"hours": 0, "q": "mailbox"})).json()["items"]
    assert [i["source"] for i in searched] == ["email"]

    csv_response = await flow.get("/api/admin/ops/events", params={"hours": 0, "format": "csv", "severity": "problem"})
    assert csv_response.status_code == 200 and csv_response.headers["content-type"].startswith("text/csv")
    assert "ereignisse.csv" in csv_response.headers["content-disposition"]
    lines = csv_response.text.lstrip("﻿").splitlines()
    assert lines[0] == "Zeit;Schwere;Quelle;Status;Titel;Details;Weitere Angaben"
    assert any("KeyError" in line for line in lines[1:]) and not any("registration" in line for line in lines[1:])

    # Die alte Sammelsicht bleibt für bestehende Aufrufer, nur mit den neuen Quellen.
    legacy = (await flow.get("/api/admin/logs")).json()
    assert {row["key"] for row in legacy["sources"]} >= {"server", "checks", "audit", "email"}

    player = await flow.add_user(role="player")
    flow.act_as(player)
    assert (await flow.get("/api/admin/ops/events")).status_code in (401, 403)
