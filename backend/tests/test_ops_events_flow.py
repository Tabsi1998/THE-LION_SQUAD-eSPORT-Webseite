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
    await db.ops_check_episodes.insert_one({"id": "ep1", "since": fresh, "last_at": fresh, "runs": 1, "status": "crit", "counts": {"ok": 5, "warn": 0, "crit": 1}, "failing": ["mail_queue"]})
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
async def test_equal_check_runs_become_one_event_per_state_change(flow):
    """#2080: Zehn gleiche Läufe (gelb: image_variants) sind ein Eintrag mit Zähler - „seit … · 10× geprüft · zuletzt …“.
    Erst ein anderer Stand (dazu disk) ergibt einen neuen Eintrag; grün dazwischen trennt auch, erscheint aber nicht."""
    from services import ops_checks

    def checks_with(*warn_keys):
        def make(key):
            async def runner():
                return ops_checks.result(key, key, "warn" if key in warn_keys else "ok", "1")
            return runner
        return [(key, key, make(key)) for key in ("database", "image_variants", "disk")]

    for _ in range(10):
        await ops_checks.run_checks(flow.db, checks=checks_with("image_variants"))
    assert await flow.db.ops_check_runs.count_documents({}) == 10, "die Läufe selbst bleiben für den Verlauf"
    episodes = await flow.db.ops_check_episodes.find({}, {"_id": 0}).to_list(10)
    assert len(episodes) == 1 and episodes[0]["runs"] == 10 and episodes[0]["failing"] == ["image_variants"]

    admin = await flow.add_user(role="superadmin")
    flow.act_as(admin)
    checks = (await flow.get("/api/admin/ops/events", params={"hours": 0, "source": "checks"})).json()
    assert len(checks["items"]) == 1
    item = checks["items"][0]
    assert item["title"] == "Auto-Checks gelb" and item["subtitle"] == "image_variants"
    assert "seit " in item["detail"] and "10× geprüft" in item["detail"] and "zuletzt " in item["detail"]
    assert {row["key"]: row for row in checks["sources"]}["checks"]["problem_count"] == 1

    await ops_checks.run_checks(flow.db, checks=checks_with("image_variants", "disk"))
    await ops_checks.run_checks(flow.db, checks=checks_with())
    await ops_checks.run_checks(flow.db, checks=checks_with("image_variants", "disk"))
    items = (await flow.get("/api/admin/ops/events", params={"hours": 0, "source": "checks"})).json()["items"]
    assert [item["subtitle"] for item in items] == ["image_variants, disk", "image_variants, disk", "image_variants"]
    assert "1× geprüft" in items[0]["detail"]


class _BothSeeTheOldState:
    """Zwei Läufe zugleich nach einem Wechsel (#2080, Codex): beide lesen den alten Stand, bevor einer schreibt -
    so wie zwei Worker auf echtem MongoDB. mongomock antwortet sonst sofort und alles liefe nacheinander."""

    def __init__(self, db):
        import asyncio

        self._db = db
        self.barrier = asyncio.Barrier(2)
        self.gated = 0

    def __getattr__(self, name):
        target = getattr(self._db, name)
        return _GatedEpisodes(target, self) if name == "ops_check_episodes" else target


class _GatedEpisodes:
    def __init__(self, collection, gate):
        self._collection = collection
        self._gate = gate

    def __getattr__(self, name):
        return getattr(self._collection, name)

    async def find_one_and_update(self, *args, **kwargs):
        import asyncio

        found = await self._collection.find_one_and_update(*args, **kwargs)
        if self._gate.gated < 2:
            self._gate.gated += 1
            await asyncio.wait_for(self._gate.barrier.wait(), 1)
        return found

    async def find_one(self, *args, **kwargs):
        import asyncio

        found = await self._collection.find_one(*args, **kwargs)
        if self._gate.gated < 2:
            self._gate.gated += 1
            await asyncio.wait_for(self._gate.barrier.wait(), 1)
        return found


@pytest.mark.asyncio
async def test_two_runs_at_once_after_a_change_share_one_open_episode(flow):
    """#2080 (Codex): Zusammenfassen ist atomar - zwei gleichzeitige gelbe Läufe nach Grün ergeben genau einen offenen
    Abschnitt mit zwei Läufen, kein Duplikat."""
    import asyncio

    import database
    from services import ops_checks

    await database.ensure_ops_check_indexes(flow.db)
    now = now_utc()
    await ops_checks.record_episode(flow.db, {"at": (now - timedelta(minutes=5)).isoformat(), "status": "ok", "failing": [], "counts": {"ok": 3}})
    yellow = {"status": "warn", "failing": ["image_variants"], "counts": {"ok": 2, "warn": 1}}
    gate = _BothSeeTheOldState(flow.db)
    await asyncio.gather(
        ops_checks.record_episode(gate, {**yellow, "at": now.isoformat()}),
        ops_checks.record_episode(gate, {**yellow, "at": (now + timedelta(seconds=1)).isoformat()}),
    )
    open_episodes = await flow.db.ops_check_episodes.find({"open": True}, {"_id": 0}).to_list(5)
    assert len(open_episodes) == 1
    assert open_episodes[0]["runs"] == 2 and open_episodes[0]["failing"] == ["image_variants"]
    assert await flow.db.ops_check_episodes.count_documents({}) == 2, "der grüne ist zu, der gelbe offen"


@pytest.mark.asyncio
async def test_the_first_start_fills_the_episodes_from_the_stored_runs(flow):
    """#2080 (Codex): Beim ersten Start nach dem Update baut ein einmaliger Nachtrag die Abschnitte aus den gespeicherten
    Läufen (bis 7 Tage) - die Ereignisliste verliert nichts. Ein Merker sorgt dafür, dass er nur einmal läuft."""
    from services import ops_checks

    start = now_utc() - timedelta(hours=3)

    def run(minutes, status, failing):
        return {"id": f"r{minutes}", "at": (start + timedelta(minutes=minutes)).isoformat(), "status": status, "failing": failing,
                "counts": {"ok": 2, "warn": int(status == "warn"), "crit": int(status == "crit")}, "checks": []}

    await flow.db.ops_check_runs.insert_many([
        run(0, "warn", ["image_variants"]), run(5, "warn", ["image_variants"]), run(10, "warn", ["image_variants"]),
        run(15, "ok", []), run(20, "crit", ["mail_queue"]), run(25, "crit", ["mail_queue"]),
    ])
    assert await ops_checks.backfill_check_episodes(flow.db) == 3
    episodes = await flow.db.ops_check_episodes.find({}, {"_id": 0}).sort("since", 1).to_list(10)
    assert [(e["status"], e["runs"], bool(e.get("open"))) for e in episodes] == [("warn", 3, False), ("ok", 1, False), ("crit", 2, True)]
    assert episodes[0]["since"] == run(0, "warn", [])["at"] and episodes[0]["last_at"] == run(10, "warn", [])["at"]

    assert await ops_checks.backfill_check_episodes(flow.db) == 0, "nur einmal"
    await ops_checks.run_checks(flow.db, checks=[("mail_queue", "Mail-Queue", lambda: _crit_mail()), ("disk", "Speicher", lambda: _ok_disk())])
    assert await flow.db.ops_check_episodes.count_documents({}) == 3
    assert (await flow.db.ops_check_episodes.find_one({"open": True}))["runs"] == 3

    admin = await flow.add_user(role="superadmin")
    flow.act_as(admin)
    items = (await flow.get("/api/admin/ops/events", params={"hours": 0, "source": "checks"})).json()["items"]
    assert [item["subtitle"] for item in items] == ["mail_queue", "image_variants"]


@pytest.mark.asyncio
async def test_only_one_episode_can_be_open_and_an_old_sparse_index_is_replaced(flow):
    """#2080 (Codex): Der eindeutige Index gilt nur für ``open: true`` (partiell) - beliebig viele geschlossene Abschnitte,
    auch mit ``open: false``, stören nicht. Ein früher angelegter lückenhafter Index wird beim Start ersetzt."""
    import database
    from pymongo.errors import DuplicateKeyError

    await flow.db.ops_check_episodes.create_index("open", unique=True, sparse=True)
    await database.ensure_ops_check_indexes(flow.db)
    await database.ensure_ops_check_indexes(flow.db)  # zweiter Start: nichts doppelt, nichts kaputt
    info = await flow.db.ops_check_episodes.index_information()
    on_open = {name: spec for name, spec in info.items() if spec.get("key") == [("open", 1)]}
    assert list(on_open) == [database.OPS_EPISODE_OPEN_INDEX]
    spec = on_open[database.OPS_EPISODE_OPEN_INDEX]
    assert spec.get("unique") and spec.get("partialFilterExpression") == {"open": True}
    await flow.db.ops_check_episodes.insert_many([{"id": "a", "open": False}, {"id": "b", "open": False}, {"id": "c"}, {"id": "d", "open": True}])
    with pytest.raises(DuplicateKeyError):
        await flow.db.ops_check_episodes.insert_one({"id": "e", "open": True})


@pytest.mark.asyncio
async def test_the_index_start_tidies_up_two_open_episodes_and_never_crashes(flow, monkeypatch):
    """#2080 (Codex): Stehen schon zwei offene Abschnitte da, schließt der Start alle bis auf den jüngsten, bevor er den
    eindeutigen Index anlegt. Scheitert Löschen oder Anlegen eines Index (etwa parallel schon weg), gibt es eine Warnung,
    keinen Absturz. Die Kennung ``id`` ist eindeutig."""
    import database
    from pymongo.errors import DuplicateKeyError, OperationFailure

    await flow.db.ops_check_episodes.insert_many([
        {"id": "alt", "open": True, "since": "2026-10-27T07:00:00+00:00", "last_at": "2026-10-27T08:00:00+00:00"},
        {"id": "neu", "open": True, "since": "2026-10-27T08:05:00+00:00", "last_at": "2026-10-27T09:00:00+00:00"},
    ])
    await database.ensure_ops_check_indexes(flow.db)
    assert [row["id"] for row in await flow.db.ops_check_episodes.find({"open": True}).to_list(5)] == ["neu"]
    assert "open" not in (await flow.db.ops_check_episodes.find_one({"id": "alt"}))
    with pytest.raises(DuplicateKeyError):
        await flow.db.ops_check_episodes.insert_one({"id": "neu"})

    collection = flow.db.ops_check_episodes
    await collection.create_index("open", unique=True, sparse=True, name="open_alt")

    async def gone(name):
        raise OperationFailure("index not found", code=27)

    monkeypatch.setattr(type(collection), "drop_index", lambda self, name: gone(name))
    await database.ensure_ops_check_indexes(flow.db)  # Doppelter Start, Löschen scheitert: kein Absturz
    await database.ensure_ops_check_indexes(flow.db)


@pytest.mark.asyncio
async def test_the_backfill_counts_an_episode_written_meanwhile_as_there(flow, monkeypatch):
    """#2080 (Codex): Schreibt ein zweiter Anlauf denselben nachgetragenen Abschnitt zugleich, scheitert sein Upsert am
    eindeutigen ``id`` - das heißt „schon da“, kein Abbruch."""
    from pymongo.errors import DuplicateKeyError

    from services import ops_checks

    now = now_utc()
    await flow.db.ops_check_runs.insert_many([
        {"id": "r1", "at": (now - timedelta(hours=2)).isoformat(), "status": "warn", "failing": ["disk"], "counts": {}, "checks": []},
        {"id": "r2", "at": (now - timedelta(hours=1)).isoformat(), "status": "ok", "failing": [], "counts": {}, "checks": []},
    ])
    collection = flow.db.ops_check_episodes
    original = type(collection).update_one
    raced = []

    async def racing(self, query, *args, **kwargs):
        if not raced and str(query.get("id", "")).startswith("bf-"):
            raced.append(query["id"])
            raise DuplicateKeyError("E11000 duplicate key")
        return await original(self, query, *args, **kwargs)

    monkeypatch.setattr(type(collection), "update_one", racing)
    assert await ops_checks.backfill_check_episodes(flow.db) == 1, "einer neu, einer schon da"
    assert (await flow.db.settings.find_one({"id": ops_checks.BACKFILL_MARKER}))["state"] == "done"


@pytest.mark.asyncio
async def test_an_orphaned_backfill_marker_is_taken_over_a_fresh_one_is_not(flow):
    """#2080 (Codex): Bricht der Nachtrag ab, bleibt der Merker auf „running“. Nach zehn Minuten gilt er als verwaist und
    wird atomar übernommen; ein frischer bleibt beim anderen Worker."""
    from services import ops_checks

    now = now_utc()
    await flow.db.ops_check_runs.insert_one({"id": "r1", "at": (now - timedelta(hours=1)).isoformat(), "status": "warn",
                                             "failing": ["disk"], "counts": {"warn": 1}, "checks": []})
    marker = ops_checks.BACKFILL_MARKER
    await flow.db.settings.insert_one({"id": marker, "state": "running", "started_at": (now - timedelta(minutes=1)).isoformat()})
    assert await ops_checks.backfill_check_episodes(flow.db) == 0, "ein anderer Worker ist dran"
    await flow.db.settings.update_one({"id": marker}, {"$set": {"started_at": (now - timedelta(minutes=20)).isoformat()}})
    assert await ops_checks.backfill_check_episodes(flow.db) == 1
    assert (await flow.db.settings.find_one({"id": marker}))["state"] == "done"
    assert await ops_checks.backfill_check_episodes(flow.db) == 0


async def _crit_mail():
    from services import ops_checks

    return ops_checks.result("mail_queue", "Mail-Queue", "crit", "2 hängen")


async def _ok_disk():
    from services import ops_checks

    return ops_checks.result("disk", "Speicher", "ok", "50 %")


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
