"""Betrieb: Probleme quittieren, Erledigtes verschwindet von selbst (#2447).

Quittiert heißt: aus „Neueste Probleme“ (``state=open``) und aus den Zählern „auffällig“ weg, im Verlauf mit
„Quittierte zeigen“ (``state=all``) noch da - mit wer und wann, und im Adminprotokoll. Dasselbe Problem (Quelle + Art +
Schlüssel) erscheint wieder, sobald es neu auftritt. Ein Auto-Check, der wieder grün ist, und ein Alarm mit Gegenstück
gelten von selbst als behoben."""
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


def _counts(payload: dict) -> dict:
    return {row["key"]: row["problem_count"] for row in payload["sources"]}


async def _open(flow, **params) -> dict:
    response = await flow.get("/api/admin/ops/events", params={"hours": 0, "limit": 100, "state": "open", **params})
    assert response.status_code == 200, response.text
    return response.json()


async def _seed(db, at: str) -> None:
    await db.email_logs.insert_many([
        {"id": "m1", "to": "a@lionsquad-test.at", "channel": "email", "template_key": "password_reset", "status": "failed", "error": "550", "created_at": at},
        {"id": "m2", "to": "b@lionsquad-test.at", "channel": "email", "template_key": "password_reset", "status": "failed", "error": "550", "created_at": at},
        {"id": "m3", "to": "c@lionsquad-test.at", "channel": "email", "template_key": "registration", "status": "failed", "error": "550", "created_at": at},
    ])
    await db.mobile_client_logs.insert_one({"id": "c1", "level": "error", "status": "open", "fingerprint": "fp-chat", "message": "Chat stürzt ab",
                                            "received_at": at, "priority_rank": 1})
    await db.upload_events.insert_one({"id": "up1", "status": "failed", "filename": "logo.png", "kind": "image", "created_at": at})


@pytest.mark.asyncio
async def test_acknowledge_one_hides_it_and_the_same_problem_but_not_others(flow):
    at = now_utc().isoformat()
    await _seed(flow.db, at)
    admin = await flow.add_user(role="superadmin", name="Obmann")
    flow.act_as(admin)

    before = await _open(flow)
    assert _counts(before)["email"] == 3 and _counts(before)["client"] == 1 and _counts(before)["uploads"] == 1
    email = {item["id"]: item for item in before["items"] if item["source"] == "email"}
    assert email["m1"]["open"] and email["m1"]["ackable"] and email["m1"]["ack_id"] == "m1"

    response = await flow.post("/api/admin/ops/events/ack", json={"source": "email", "id": "m1"})
    assert response.status_code == 200, response.text
    assert response.json()["count"] == 2, "dieselbe Vorlage mit demselben Stand ist dasselbe Problem"

    after = await _open(flow)
    assert [item["id"] for item in after["items"] if item["source"] == "email"] == ["m3"]
    assert _counts(after)["email"] == 1

    # Standard im Verlauf: Quittiertes ausgeblendet; „Quittierte zeigen“ zeigt es mit wer und wann.
    default = (await flow.get("/api/admin/ops/events", params={"hours": 0, "source": "email"})).json()["items"]
    assert [item["id"] for item in default] == ["m3"]
    shown = (await flow.get("/api/admin/ops/events", params={"hours": 0, "source": "email", "state": "all"})).json()["items"]
    acked = {item["id"]: item for item in shown}
    assert acked["m1"]["acknowledged_by"] == "Obmann" and acked["m1"]["acknowledged_at"]
    assert not acked["m1"]["open"] and not acked["m1"]["ackable"]

    audit = await flow.db.audit_logs.find({"action": "ops.event.ack"}, {"_id": 0}).to_list(5)
    assert len(audit) == 1 and audit[0]["actor_id"] == admin["id"] and audit[0]["data"]["source"] == "email"
    assert audit[0]["data"]["count"] == 2


@pytest.mark.asyncio
async def test_acknowledge_all_empties_the_list_and_every_counter(flow):
    at = now_utc().isoformat()
    await _seed(flow.db, at)
    await flow.db.ops_errors.insert_one({"id": "e1", "fingerprint": "f1", "error_type": "KeyError", "route": "/api/x", "method": "GET",
                                         "status_code": 500, "count": 2, "first_seen_at": at, "last_seen_at": at, "resolved_at": None})
    await flow.db.ops_check_episodes.insert_one({"id": "ep1", "since": at, "last_at": at, "runs": 3, "status": "warn", "open": True,
                                                 "signature": "warn:disk", "failing": ["disk"], "counts": {}})
    await flow.db.ops_alert_log.insert_one({"id": "a1", "kind": "job_failed", "key": "job:sync", "title": "Job abgebrochen", "channels": [], "at": at})
    await flow.db.settings.replace_one({"id": "dolibarr_sync_state"}, {"id": "dolibarr_sync_state", "ok": False, "last_run_at": at,
                                                                       "last_error": {"kind": "unauthorized", "text": "401", "at": at}}, upsert=True)
    admin = await flow.add_user(role="superadmin")
    flow.act_as(admin)

    before = await _open(flow)
    assert sum(_counts(before).values()) == 3 + 1 + 1 + 1 + 1 + 1 + 1

    response = await flow.post("/api/admin/ops/events/ack-all", json={})
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 9
    after = await _open(flow)
    assert after["items"] == [] and sum(_counts(after).values()) == 0
    assert (await flow.db.ops_errors.find_one({"fingerprint": "f1"}))["resolved_by"] == admin["id"]

    everything = (await flow.get("/api/admin/ops/events", params={"hours": 0, "limit": 100, "state": "all"})).json()["items"]
    sources = {item["source"] for item in everything if item.get("acknowledged_at")}
    assert sources >= {"email", "client", "uploads", "server", "checks", "alerts", "sync"}
    audit = await flow.db.audit_logs.find({"action": "ops.event.ack_all"}, {"_id": 0}).to_list(5)
    assert len(audit) == 1 and audit[0]["data"]["count"] == 9


@pytest.mark.asyncio
async def test_acknowledge_all_of_one_source_leaves_the_others(flow):
    await _seed(flow.db, now_utc().isoformat())
    flow.act_as(await flow.add_user(role="superadmin"))
    response = await flow.post("/api/admin/ops/events/ack-all", json={"sources": ["email"]})
    assert response.json() == {"acknowledged": {"email": 3}, "total": 3}
    counts = _counts(await _open(flow))
    assert counts["email"] == 0 and counts["client"] == 1 and counts["uploads"] == 1


@pytest.mark.asyncio
async def test_the_same_problem_occurring_again_opens_it_again(flow):
    """App-Log wiederholt sich (gleiche Zeile, neuer Zeitpunkt), neue Zeile mit demselben Schlüssel, Fehlergruppe tritt
    wieder auf: offen. Was vor der Quittierung lag, bleibt quittiert."""
    db = flow.db
    earlier = (now_utc() - timedelta(minutes=10)).isoformat()
    await _seed(db, earlier)
    await db.ops_errors.insert_one({"id": "e1", "fingerprint": "f1", "error_type": "KeyError", "route": "/api/x", "method": "GET",
                                    "status_code": 500, "count": 1, "first_seen_at": earlier, "last_seen_at": earlier, "resolved_at": None})
    flow.act_as(await flow.add_user(role="superadmin"))
    await flow.post("/api/admin/ops/events/ack-all", json={})
    assert sum(_counts(await _open(flow)).values()) == 0

    later = (now_utc() + timedelta(seconds=5)).isoformat()
    await db.mobile_client_logs.update_one({"id": "c1"}, {"$set": {"received_at": later, "status": "open"}})
    await db.email_logs.insert_one({"id": "m4", "to": "d@lionsquad-test.at", "channel": "email", "template_key": "password_reset", "status": "failed",
                                    "created_at": later})
    await db.ops_errors.update_one({"fingerprint": "f1"}, {"$set": {"resolved_at": None, "resolved_by": None, "last_seen_at": later}})

    again = await _open(flow)
    assert {(item["source"], item["id"] if item["source"] != "server" else item["ack_id"]) for item in again["items"]} == {
        ("client", "c1"), ("email", "m4"), ("server", "f1")}
    counts = _counts(again)
    assert counts["client"] == 1 and counts["email"] == 1 and counts["server"] == 1 and counts["uploads"] == 0


@pytest.mark.asyncio
async def test_a_check_back_to_green_resolves_its_warning_and_its_alert(flow):
    """Auto-Check wieder grün: der gelbe Zustand ist „behoben um …“, nicht mehr offen, nicht mehr gezählt - der rote Alarm
    dazu ebenso. Ein späterer neuer Zustand ist wieder offen."""
    from services import ops_alerts, ops_checks

    def checks_with(status_by_key):
        def make(key, status):
            async def runner():
                return ops_checks.result(key, key, status, "1")
            return runner
        return [(key, key, make(key, status)) for key, status in status_by_key.items()]

    async def run(statuses):
        result = await ops_checks.run_checks(flow.db, checks=checks_with(statuses))
        await ops_alerts.alert_red_checks(flow.db, result)
        return result

    await run({"disk": "crit", "database": "ok"})
    assert await flow.db.ops_alert_log.count_documents({"key": "check:disk"}) == 1, "der rote Alarm ist im Log, auch ohne Weg"
    flow.act_as(await flow.add_user(role="superadmin"))
    red = await _open(flow)
    assert _counts(red)["checks"] == 1 and _counts(red)["alerts"] == 1

    green = await run({"disk": "ok", "database": "ok"})
    after = await _open(flow)
    assert _counts(after)["checks"] == 0 and _counts(after)["alerts"] == 0
    assert [item for item in after["items"] if item["source"] in {"checks", "alerts"}] == []
    history = (await flow.get("/api/admin/ops/events", params={"hours": 0, "source": "checks,alerts"})).json()["items"]
    episode = next(item for item in history if item["source"] == "checks")
    alert = next(item for item in history if item["source"] == "alerts")
    assert episode["resolved_label"] == "behoben" and episode["resolved_at"] == green["at"] and not episode["open"]
    assert alert["resolved_label"] == "behoben" and alert["resolved_at"] == green["at"] and not alert["open"]

    await run({"disk": "warn", "database": "ok"})
    assert _counts(await _open(flow))["checks"] == 1


@pytest.mark.asyncio
async def test_alerts_with_a_counterpart_resolve_themselves(flow):
    """Alte Alarme ohne gespeichertes „behoben“: Fehlergruppe gelöst, Dolibarr wieder grün, Bot wieder verbunden, Prüfung im
    letzten Lauf nicht mehr rot. Ein Alarm ohne Gegenstück (Hintergrundjob) bleibt offen."""
    db = flow.db
    old = (now_utc() - timedelta(hours=2)).isoformat()
    now = now_utc().isoformat()
    await db.ops_alert_log.insert_many([
        {"id": "a-err", "kind": "error_group", "key": "error:f1", "title": "Serverfehler", "channels": ["discord"], "at": old},
        {"id": "a-sync", "kind": "dolibarr_sync_failed", "key": "dolibarr:sync", "title": "Dolibarr rot", "channels": [], "at": old},
        {"id": "a-bot", "kind": "discord_bot_offline", "key": "discord:bot", "title": "Bot offline", "channels": [], "at": old},
        {"id": "a-check", "kind": "check_red", "key": "check:mail_queue", "title": "Mail-Queue rot", "channels": [], "at": old},
        {"id": "a-job", "kind": "job_failed", "key": "job:sync", "title": "Job abgebrochen", "channels": [], "at": old},
    ])
    await db.ops_errors.insert_one({"id": "e1", "fingerprint": "f1", "error_type": "KeyError", "status_code": 500, "count": 1,
                                    "first_seen_at": old, "last_seen_at": old, "resolved_at": now})
    await db.settings.replace_one({"id": "dolibarr_sync_state"}, {"id": "dolibarr_sync_state", "ok": True, "last_ok_at": now, "last_error": None}, upsert=True)
    await db.settings.replace_one({"id": "discord_bot_state"}, {"id": "discord_bot_state", "connected": True, "status": "online", "updated_at": now}, upsert=True)
    await db.ops_check_runs.insert_one({"id": "r1", "at": now, "status": "ok", "checks": [{"key": "mail_queue", "status": "ok"}]})
    flow.act_as(await flow.add_user(role="superadmin"))

    payload = await _open(flow, source="alerts")
    assert [item["id"] for item in payload["items"]] == ["a-job"] and _counts(payload)["alerts"] == 1
    history = {item["id"]: item for item in (await flow.get("/api/admin/ops/events", params={"hours": 0, "source": "alerts"})).json()["items"]}
    assert history["a-err"]["resolved_at"] == now and history["a-sync"]["resolved_at"] == now
    assert {key for key, item in history.items() if item["resolved_label"] == "behoben"} == {"a-err", "a-sync", "a-bot", "a-check"}


@pytest.mark.asyncio
async def test_sync_and_bot_errors_can_be_acknowledged_until_they_come_back(flow):
    db = flow.db
    at = now_utc().isoformat()
    await db.settings.replace_one({"id": "dolibarr_sync_state"}, {"id": "dolibarr_sync_state", "ok": False, "last_run_at": at,
                                                                  "last_error": {"kind": "unauthorized", "text": "401", "at": at}}, upsert=True)
    await db.settings.replace_one({"id": "discord_bot_state"}, {"id": "discord_bot_state", "status": "offline", "last_error": "Token ungültig",
                                                                "updated_at": at}, upsert=True)
    flow.act_as(await flow.add_user(role="superadmin"))
    for source in ("sync", "bot"):
        response = await flow.post("/api/admin/ops/events/ack", json={"source": source, "id": "current"})
        assert response.status_code == 200, response.text
    counts = _counts(await _open(flow))
    assert counts["sync"] == 0 and counts["bot"] == 0

    # Derselbe Fehler nach einem grünen Abgleich ist neu; der Bot verliert die Quittierung, sobald er wieder ohne Fehler ist.
    from services.discord_runtime import record_state

    later = (now_utc() + timedelta(seconds=5)).isoformat()
    await db.settings.update_one({"id": "dolibarr_sync_state"}, {"$set": {"last_ok_at": later}})
    await record_state(db, connected=True, last_error=None)
    await record_state(db, connected=False, last_error="Token ungültig")
    counts = _counts(await _open(flow))
    assert counts["sync"] == 1 and counts["bot"] == 1


@pytest.mark.asyncio
async def test_only_who_may_edit_operations_may_acknowledge(flow):
    """Rechte am Server: Bereich System mit Zwei-Faktor. Turnierleitung, Spieler, ohne Anmeldung und ohne bestätigte
    Zwei-Faktor-Anmeldung: abgelehnt, nichts quittiert."""
    await _seed(flow.db, now_utc().isoformat())
    await flow.db.ops_errors.insert_one({"id": "e1", "fingerprint": "f1", "error_type": "KeyError", "status_code": 500, "count": 1,
                                         "first_seen_at": now_utc().isoformat(), "last_seen_at": now_utc().isoformat(), "resolved_at": None})
    lead = await flow.add_user(role="tournament_admin")
    player = await flow.add_user(role="player")
    no_mfa = await flow.add_user(role="superadmin")
    await flow.db.users.update_one({"id": no_mfa["id"]}, {"$set": {"mfa_enabled": False}})
    requests = [
        ("/api/admin/ops/events/ack", {"source": "email", "id": "m1"}),
        ("/api/admin/ops/events/ack-all", {}),
        ("/api/admin/ops/errors/resolve", {"fingerprints": ["f1"]}),
        ("/api/admin/ops/errors/f1/resolve", None),
        ("/api/admin/ops/checks/run", None),
    ]
    for user in (lead, player, {**no_mfa, "mfa_enabled": False}, None):
        flow.act_as(user)
        for url, body in requests:
            response = await flow.post(url, json=body) if body is not None else await flow.post(url)
            assert response.status_code in (401, 403), (url, user and user.get("role"), response.status_code)
    assert await flow.db.email_logs.count_documents({"acknowledged_at": {"$ne": None}}) == 0
    assert (await flow.db.ops_errors.find_one({"fingerprint": "f1"}))["resolved_at"] is None
    assert await flow.db.audit_logs.count_documents({}) == 0

    flow.act_as(await flow.add_user(role="superadmin"))
    assert (await flow.post("/api/admin/ops/events/ack", json={"source": "audit", "id": "x"})).status_code == 400
    assert (await flow.post("/api/admin/ops/events/ack", json={"source": "email", "id": "gibt-es-nicht"})).status_code == 404


@pytest.mark.asyncio
async def test_error_groups_can_be_resolved_several_at_once(flow):
    at = now_utc().isoformat()
    await flow.db.ops_errors.insert_many([
        {"id": f"e{n}", "fingerprint": f"f{n}", "error_type": "KeyError", "status_code": 500, "count": 1, "first_seen_at": at, "last_seen_at": at, "resolved_at": None}
        for n in range(3)
    ])
    admin = await flow.add_user(role="superadmin")
    flow.act_as(admin)
    response = await flow.post("/api/admin/ops/errors/resolve", json={"fingerprints": ["f0", "f1", "fehlt"]})
    assert response.status_code == 200 and response.json()["resolved"] == 2
    assert await flow.db.ops_errors.count_documents({"resolved_at": None}) == 1
    assert (await flow.db.ops_errors.find_one({"fingerprint": "f0"}))["resolved_by"] == admin["id"]
    audit = await flow.db.audit_logs.find_one({"action": "ops.errors.resolve"})
    assert audit["data"]["count"] == 2
    assert (await flow.post("/api/admin/ops/errors/resolve", json={"fingerprints": []})).status_code == 422


@pytest.mark.asyncio
async def test_run_checks_now_is_rate_limited(flow, monkeypatch):
    """„Jetzt neu prüfen“: sofort, aber höchstens drei Läufe je Minute und Person - der vierte bekommt 429."""
    from services import ops_checks

    async def quick(db):
        return await ops_checks.run_checks(db, checks=[("database", "Datenbank", _ok_database)])

    import routes.admin_routes as admin_routes

    monkeypatch.setattr(admin_routes, "run_checks", quick)
    flow.act_as(await flow.add_user(role="superadmin"))
    statuses = []
    for _ in range(ops_checks.RUN_NOW_LIMIT_PER_MINUTE + 1):
        response = await flow.post("/api/admin/ops/checks/run")
        statuses.append(response.status_code)
    assert statuses[:-1] == [200] * ops_checks.RUN_NOW_LIMIT_PER_MINUTE
    assert statuses[-1] == 429 and "warte" in response.json()["detail"]
    assert await flow.db.ops_check_runs.count_documents({}) == ops_checks.RUN_NOW_LIMIT_PER_MINUTE
    # Der Status oben stimmt gleich: die Übersicht hat den neuen Lauf.
    summary = (await flow.get("/api/admin/ops/summary")).json()
    assert summary["checks"]["status"] == "ok"


async def _ok_database():
    from services import ops_checks

    return ops_checks.result("database", "Datenbank", "ok", "3 ms")


@pytest.mark.asyncio
async def test_file_uploads_are_not_slow_routes(flow):
    """Datei-Uploads (App-Release, Shop-Druckdateien) zählen nicht als langsam und sind nie „Langsamste Route“ - selbst
    erkannt (``upload``) oder über die einstellbare Liste unter Betrieb → Alarme."""
    at = now_utc().isoformat()
    await flow.db.ops_slow_requests.insert_many([
        {"id": "s1", "route": "/api/admin/app-releases", "method": "POST", "status_code": 200, "duration_ms": 47000, "at": at},
        {"id": "s2", "route": "/api/admin/custom-upload", "method": "POST", "status_code": 200, "duration_ms": 30000, "upload": True, "at": at},
        {"id": "s3", "route": "/api/teams", "method": "GET", "status_code": 200, "duration_ms": 1500, "at": at},
    ])
    flow.act_as(await flow.add_user(role="superadmin"))
    summary = (await flow.get("/api/admin/ops/summary")).json()
    assert summary["slow_requests_24h"] == 1 and summary["slow_uploads_24h"] == 2
    assert summary["slowest_route_24h"]["route"] == "/api/teams"
    slow = (await flow.get("/api/admin/ops/slow")).json()
    flags = {row["route"]: row["upload"] for row in slow["routes"]}
    assert flags == {"/api/teams": False, "/api/admin/app-releases": True, "/api/admin/custom-upload": True}
    assert slow["routes"][0]["route"] == "/api/teams" and slow["total"] == 1 and slow["upload_count"] == 2

    # Die Liste ist einstellbar: ohne App-Releases ist der APK-Upload wieder eine langsame Route.
    saved = await flow.put("/api/admin/ops/alerts", json={"upload_routes": "/api/uploads/*\n"})
    assert saved.status_code == 200 and saved.json()["upload_routes"] == ["/api/uploads/*"]
    assert (await flow.get("/api/admin/ops/summary")).json()["slowest_route_24h"]["route"] == "/api/admin/app-releases"
    bad = await flow.put("/api/admin/ops/alerts", json={"upload_routes": ["keine route"]})
    assert bad.status_code == 400


# ---------------------------------------------------------------- Review-Runde 1 (#2447)

@pytest.mark.asyncio
async def test_acknowledging_again_keeps_who_and_when_and_counts_only_new_rows(flow):
    """M3: Eine gültige Quittierung bleibt mit ihrem Namen und Zeitpunkt stehen; die Antwort zählt nur, was neu
    geschrieben wurde."""
    db = flow.db
    at = (now_utc() - timedelta(minutes=5)).isoformat()
    await db.email_logs.insert_one({"id": "m1", "to": "a@x.test", "channel": "email", "template_key": "custom", "status": "failed", "created_at": at})
    first = await flow.add_user(role="superadmin", name="Erster")
    second = await flow.add_user(role="superadmin", name="Zweiter")
    flow.act_as(first)
    assert (await flow.post("/api/admin/ops/events/ack", json={"source": "email", "id": "m1"})).json()["count"] == 1
    before = await db.email_logs.find_one({"id": "m1"})
    await db.email_logs.insert_one({"id": "m2", "to": "b@x.test", "channel": "email", "template_key": "other", "status": "failed", "created_at": now_utc().isoformat()})

    flow.act_as(second)
    response = await flow.post("/api/admin/ops/events/ack-all", json={"sources": ["email"]})
    assert response.json() == {"acknowledged": {"email": 1}, "total": 1}
    after = await db.email_logs.find_one({"id": "m1"})
    assert after["acknowledged_by"] == first["id"] and after["acknowledged_at"] == before["acknowledged_at"]
    assert (await db.email_logs.find_one({"id": "m2"}))["acknowledged_by"] == second["id"]

    again = await flow.post("/api/admin/ops/events/ack", json={"source": "email", "id": "m1"})
    assert again.status_code == 409
    assert await db.audit_logs.count_documents({"action": "ops.event.ack"}) == 1, "kein Protokoll für nichts"


@pytest.mark.asyncio
async def test_acknowledge_all_with_a_filter_takes_exactly_the_shown_rows_up_to_the_load(flow):
    """M2: Mit Filter quittiert „Alle quittieren“ genau die gezeigten Einträge - nichts außerhalb des Filters, nichts,
    was nach dem Laden kam (``until`` = ``as_of`` der Liste)."""
    db = flow.db
    at = (now_utc() - timedelta(minutes=5)).isoformat()
    await db.email_logs.insert_many([
        {"id": "a1", "to": "a@x.test", "channel": "email", "template_key": "password_reset", "status": "failed", "error": "550", "created_at": at},
        {"id": "a2", "to": "b@x.test", "channel": "email", "template_key": "password_reset", "status": "failed", "error": "550", "created_at": at},
        {"id": "b1", "to": "c@x.test", "channel": "email", "template_key": "newsletter", "status": "skipped", "created_at": at},
    ])
    flow.act_as(await flow.add_user(role="superadmin"))
    shown = (await flow.get("/api/admin/ops/events", params={"hours": 0, "source": "email", "state": "open", "q": "password"})).json()
    assert sorted(item["id"] for item in shown["items"]) == ["a1", "a2"]
    assert shown["as_of"]
    # Danach tritt a2 erneut auf (neuerer Zeitpunkt) und eine neue Zeile kommt dazu - beides bleibt offen.
    later = (now_utc() + timedelta(seconds=5)).isoformat()
    await db.email_logs.update_one({"id": "a2"}, {"$set": {"created_at": later}})
    await db.email_logs.insert_one({"id": "a3", "to": "d@x.test", "channel": "email", "template_key": "password_reset", "status": "failed", "error": "550", "created_at": later})
    items = [{"source": item["source"], "id": item["ack_id"]} for item in shown["items"]]
    response = await flow.post("/api/admin/ops/events/ack-all", json={"items": items, "until": shown["as_of"]})
    assert response.json() == {"acknowledged": {"email": 1}, "total": 1}
    open_ids = sorted(item["id"] for item in (await _open(flow, source="email"))["items"])
    assert open_ids == ["a2", "a3", "b1"]
    audit = await db.audit_logs.find_one({"action": "ops.event.ack_all"})
    assert audit["data"]["count"] == 1 and audit["data"]["until"]


@pytest.mark.asyncio
async def test_acknowledge_all_without_filter_stops_at_the_load(flow):
    db = flow.db
    await _seed(db, (now_utc() - timedelta(minutes=5)).isoformat())
    flow.act_as(await flow.add_user(role="superadmin"))
    as_of = (await _open(flow))["as_of"]
    await db.upload_events.insert_one({"id": "up2", "status": "failed", "filename": "neu.png", "created_at": (now_utc() + timedelta(seconds=5)).isoformat()})
    response = await flow.post("/api/admin/ops/events/ack-all", json={"until": as_of})
    assert response.json()["total"] == 5
    assert [item["id"] for item in (await _open(flow))["items"]] == ["up2"]
    assert (await flow.post("/api/admin/ops/events/ack-all", json={"until": "kein Datum"})).status_code == 400


@pytest.mark.asyncio
async def test_free_mails_and_discord_targets_are_acknowledged_narrowly(flow):
    """M4: Eine freie Mail (``custom``) ist nur sie selbst; Discord-Meldungen gehören je Server und Grund zusammen,
    Mails derselben Vorlage nur bei gleichem Fehlertext."""
    db = flow.db
    at = now_utc().isoformat()
    await db.email_logs.insert_many([
        {"id": "e1", "to": "a@x.test", "subject": "Rechnung", "template_key": "custom", "status": "failed", "error": "550 mailbox", "created_at": at},
        {"id": "e2", "to": "b@x.test", "subject": "Newsletter", "template_key": "custom", "status": "failed", "error": "550 mailbox", "created_at": at},
        {"id": "t1", "to": "c@x.test", "channel": "email", "template_key": "password_reset", "status": "failed", "error": "550 mailbox", "created_at": at},
        {"id": "t2", "to": "d@x.test", "channel": "email", "template_key": "password_reset", "status": "failed", "error": "401 API key invalid", "created_at": at},
        {"id": "d1", "channel": "discord", "event_key": "news", "guild_id": "111", "status": "failed", "reason": "forbidden", "created_at": at},
        {"id": "d2", "channel": "discord", "event_key": "news", "guild_id": "222", "status": "failed", "reason": "not_found", "created_at": at},
        {"id": "d3", "channel": "discord", "event_key": "news", "guild_id": "111", "status": "failed", "reason": "not_found", "created_at": at},
        {"id": "d4", "channel": "discord", "event_key": "news", "guild_id": "111", "status": "failed", "reason": "forbidden", "created_at": at},
    ])
    flow.act_as(await flow.add_user(role="superadmin"))
    counts = {}
    for row_id in ("e1", "t1", "d1"):
        counts[row_id] = (await flow.post("/api/admin/ops/events/ack", json={"source": "email", "id": row_id})).json()["count"]
    assert counts == {"e1": 1, "t1": 1, "d1": 2}
    open_ids = sorted(item["id"] for item in (await _open(flow, source="email"))["items"])
    assert open_ids == ["d2", "d3", "e2", "t2"]


@pytest.mark.asyncio
async def test_only_open_problems_can_be_acknowledged(flow):
    """N2: Eine gesendete Mail, ein laufender Upload, eine gelöste Fehlergruppe: 409, nichts geschrieben, kein Protokoll.
    Ein Upload mit unbekanntem Stand zählt nicht als offen."""
    db = flow.db
    at = now_utc().isoformat()
    await db.email_logs.insert_one({"id": "s1", "to": "a@x.test", "template_key": "x", "status": "sent", "created_at": at})
    await db.upload_events.insert_one({"id": "u1", "status": "started", "filename": "x.png", "created_at": at})
    await db.ops_errors.insert_one({"id": "e1", "fingerprint": "f1", "error_type": "KeyError", "status_code": 500, "count": 1,
                                    "first_seen_at": at, "last_seen_at": at, "resolved_at": at})
    flow.act_as(await flow.add_user(role="superadmin"))
    for source, row_id in (("email", "s1"), ("uploads", "u1"), ("server", "f1")):
        response = await flow.post("/api/admin/ops/events/ack", json={"source": source, "id": row_id})
        assert response.status_code == 409, (source, response.status_code)
    assert await db.email_logs.count_documents({"acknowledged_at": {"$ne": None}}) == 0
    assert await db.upload_events.count_documents({"acknowledged_at": {"$ne": None}}) == 0
    assert await db.audit_logs.count_documents({}) == 0
    payload = await _open(flow, source="uploads")
    assert _counts(payload)["uploads"] == 0 and payload["items"] == []


@pytest.mark.asyncio
async def test_the_data_export_leaves_out_who_acknowledged(flow):
    """N3: Die Auskunft der Person zeigt ihre Mail- und App-Log-Zeilen, aber nicht, wer im Betrieb quittiert hat."""
    db = flow.db
    person = await flow.add_user(role="player")
    admin = await flow.add_user(role="superadmin")
    at = now_utc().isoformat()
    await db.users.update_one({"id": person["id"]}, {"$set": {"email": "person@x.test"}})
    await db.email_logs.insert_one({"id": "m1", "to": "person@x.test", "template_key": "x", "status": "failed", "created_at": at,
                                    "acknowledged_at": at, "acknowledged_by": admin["id"]})
    await db.mobile_client_logs.insert_one({"id": "c1", "user_id": person["id"], "level": "error", "status": "resolved", "message": "x",
                                            "received_at": at, "acknowledged_at": at, "acknowledged_by": admin["id"], "resolved_by": admin["id"]})
    flow.act_as({**person, "email": "person@x.test"})
    response = await flow.get("/api/dsgvo/export-my-data")
    assert response.status_code == 200, response.text
    text = response.text
    assert "m1" in text and "c1" in text
    assert admin["id"] not in text and "acknowledged_by" not in text and "resolved_by" not in text
