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


@pytest.mark.asyncio
async def test_events_never_carry_a_full_address_in_json_csv_or_search(flow):
    """#1505: wie die Mail-Warteschlange (#1418) - keine ganze Adresse in Liste, CSV und Suche, auch nicht in Betreff,
    Fehlertext, verschachtelten Zusatzdaten oder dem Freitext anderer Quellen."""
    import json

    fresh = now_utc().isoformat()
    full = ("paula.beispiel@gmail.com", "max@lionsquad.example", "tom@club.example", "eva@club.example", "ina@club.example")
    db = flow.db
    await db.email_logs.insert_one({"id": "m1", "to": full[0], "subject": f"Hallo {full[0]}", "status": "failed", "template_key": "", "channel": "email",
                                    "error": f"550 <{full[0]}> unknown", "created_at": fresh})
    await db.mail_jobs.insert_one({"id": "j1", "to": full[1], "subject": f"Für {full[1]}", "html": f"<p>{full[1]}</p>", "status": "failed", "attempts": 5,
                                   "last_error": f"550 5.1.1 <{full[1]}> user unknown", "meta": {"reply_to": full[1], "nested": [{"cc": full[2]}]},
                                   "created_at": fresh, "updated_at": fresh})
    await db.audit_logs.insert_one({"id": "au1", "action": "user.email.change", "actor_id": "admin", "target_id": full[3],
                                    "data": {"old": full[3], "deep": {"new": [full[4]]}}, "created_at": fresh})
    await db.ops_errors.insert_one({"fingerprint": "f1", "error_type": "SMTPError", "route": "/api/x", "method": "POST", "status_code": 500, "count": 1,
                                    "message": f"Zustellung an {full[0]} fehlgeschlagen", "first_seen_at": fresh, "last_seen_at": fresh, "resolved_at": None})
    await db.mobile_client_logs.insert_one({"id": "c1", "level": "error", "status": "open", "message": f"Login mit {full[2]} schlug fehl",
                                            "received_at": fresh, "priority_rank": 1})
    admin = await flow.add_user(role="superadmin")
    flow.act_as(admin)

    response = await flow.get("/api/admin/ops/events", params={"hours": 0, "limit": 100})
    assert response.status_code == 200
    body = response.text
    csv_text = (await flow.get("/api/admin/ops/events", params={"hours": 0, "format": "csv", "limit": 100})).text
    logs_text = (await flow.get("/api/admin/logs")).text
    for address in full:
        assert address not in body and address not in csv_text and address not in logs_text, address
        assert address not in json.dumps(response.json(), ensure_ascii=True)
    items = {item["id"]: item for item in response.json()["items"]}
    assert items["j1"]["subtitle"].startswith("m***@lionsquad.example")
    assert "m***@lionsquad.example" in items["j1"]["title"]
    assert "p***@gmail.com" in items["m1"]["detail"]

    # Die Suche trifft nur, was angezeigt wird: die ganze Adresse findet nichts, die gekürzte schon.
    assert (await flow.get("/api/admin/ops/events", params={"hours": 0, "q": full[0]})).json()["items"] == []
    masked_hits = (await flow.get("/api/admin/ops/events", params={"hours": 0, "q": "p***@gmail.com"})).json()["items"]
    assert any(item["id"] == "m1" for item in masked_hits)
    assert full[0] not in (await flow.get("/api/admin/ops/events", params={"hours": 0, "q": full[0]})).text


@pytest.mark.asyncio
async def test_events_mask_several_recipients_display_names_and_dict_keys(flow):
    """#1505: mehrere Empfänger, Anzeigenamen und Adressen als Dict-Schlüssel - in JSON und CSV nur gekürzt."""
    fresh = now_utc().isoformat()
    raw = ("bob@x.example", "carla.k@y.example", "dora@z.example", "erik@w.example")
    await flow.db.email_logs.insert_one({"id": "m1", "to": f'"Bob Beispiel" <{raw[0]}>, {raw[1]}', "subject": f"Gruß an {raw[2]}", "status": "failed",
                                         "channel": "email", "error": f"550 {raw[0]};{raw[1]} unknown", "created_at": fresh})
    await flow.db.mail_jobs.insert_one({"id": "j1", "to": f"{raw[2]}, {raw[3]}", "subject": f"Für {raw[2]}", "status": "failed", "attempts": 1,
                                        "last_error": f'rejected "Dora" <{raw[2]}>', "created_at": fresh, "updated_at": fresh})
    await flow.db.audit_logs.insert_one({"id": "au1", "action": "x", "actor_id": "a", "target_id": "t", "data": {raw[3]: "offen", "mailto": f"mailto:{raw[0]}"},
                                         "created_at": fresh})
    flow.act_as(await flow.add_user(role="superadmin"))
    texts = [(await flow.get("/api/admin/ops/events", params={"hours": 0, "limit": 100})).text,
             (await flow.get("/api/admin/ops/events", params={"hours": 0, "limit": 100, "format": "csv"})).text,
             (await flow.get("/api/admin/logs")).text]
    for text in texts:
        for address in raw:
            assert address not in text, address
    items = {i["id"]: i for i in (await flow.get("/api/admin/ops/events", params={"hours": 0})).json()["items"]}
    assert "b***@x.example" in items["m1"]["subtitle"] and "c***@y.example" in items["m1"]["subtitle"]
    assert "d***@z.example" in items["j1"]["subtitle"] and "e***@w.example" in items["j1"]["subtitle"]
    assert "e***@w.example" in items["au1"]["detail"]


@pytest.mark.asyncio
async def test_events_mask_url_encoded_addresses_and_guild_names(flow):
    """#1505 (Codex): ``paula%40example.test`` (auch mehrfach kodiert) und Discord-Servernamen mit Adresse - nicht in
    JSON, CSV, Suche und ``guilds``."""
    fresh = now_utc().isoformat()
    await flow.db.email_logs.insert_one({"id": "m1", "to": "paula%40example.test", "subject": "s", "status": "failed", "channel": "email",
                                         "error": "GET /confirm?mail=paula%2540example.test&b=max%2540x.example", "created_at": fresh})
    await flow.db.discord_guilds.insert_many([{"guild_id": "1", "name": "Club kontakt@verein.example", "role": "main"}, {"guild_id": "2", "name": "Zweit"}])
    flow.act_as(await flow.add_user(role="superadmin"))
    response = await flow.get("/api/admin/ops/events", params={"hours": 0})
    csv_text = (await flow.get("/api/admin/ops/events", params={"hours": 0, "format": "csv"})).text
    for text in (response.text, csv_text):
        assert "paula" not in text and "max%" not in text and "kontakt@" not in text
    assert any("k***@verein.example" in g["name"] for g in response.json()["guilds"])
    assert (await flow.get("/api/admin/ops/events", params={"hours": 0, "q": "paula%40example.test"})).json()["items"] == []
    assert "paula" not in (await flow.get("/api/admin/ops/events", params={"hours": 0, "q": "paula%40example.test"})).text
    hit = (await flow.get("/api/admin/ops/events", params={"hours": 0, "q": "p***@example.test"})).json()["items"]
    assert any(i["id"] == "m1" for i in hit)
