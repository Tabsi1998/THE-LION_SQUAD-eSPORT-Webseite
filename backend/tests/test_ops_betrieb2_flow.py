"""Betrieb II (#265) durch die echte Anwendung: Web Vitals kommen anonym an und
werden je Route ausgewertet; die Auto-Checks laufen, werden gespeichert und nur
dem Vereinsadmin gezeigt; ein Check meldet sich beim Wechsel auf Rot (#2080), eine
neue 5xx-Gruppe genau einmal pro Stunde."""
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

    monkeypatch.setattr(discord_service, "send_ops_discord", fake_send)
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
        "twitch_poll", "dolibarr_sync", "dolibarr_webhook", "client_ip", "unique_indexes", "file_cleanups",
        "image_reading", "shop", "spam_guard",
    }
    assert run["status"] in {"ok", "warn", "crit"}
    assert run["counts"]["ok"] + run["counts"]["warn"] + run["counts"]["crit"] == 17
    assert {check["key"]: check for check in run["checks"]}["twitch_poll"]["value"] == "noch kein Lauf"
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
    assert len(data["latest"]["checks"]) == 17
    assert data["history"][0]["runs"] == 1
    assert data["interval_minutes"] == 5

    again = await flow.post("/api/admin/ops/checks/run")
    assert again.status_code == 200, again.text
    assert len(again.json()["checks"]) == 17
    assert await flow.db.ops_check_runs.count_documents({}) == 2

    summary = await flow.get("/api/admin/ops/summary")
    assert summary.json()["checks"]["status"] == again.json()["status"]

    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    assert (await flow.get("/api/admin/ops/checks")).status_code == 403
    assert (await flow.post("/api/admin/ops/checks/run")).status_code == 403


@pytest.mark.asyncio
async def test_the_image_reading_check_warns_without_the_second_reader(monkeypatch):
    """#2018: Fehlt der zweite Leser der Bild-Erkennung (Modell oder Paket), warnt der Betrieb - geprüft wird, ohne das
    Modell zu laden. Abgeschaltet ist gewollt; ohne Tesseract liest der Server gar keine Bilder."""
    from services import result_image_ocr, result_image_second

    monkeypatch.setattr(result_image_ocr, "available", lambda: True)
    states = {"ok": ("ok", "Tesseract und zweiter Leser"), "off": ("ok", "zweiter Leser abgeschaltet"),
              "missing": ("warn", "zweiter Leser fehlt (Modelldatei fehlt)")}
    for status, (light, value) in states.items():
        monkeypatch.setattr(result_image_second, "presence", lambda status=status: {
            "status": status, "reason": "Modelldatei fehlt" if status == "missing" else "", "model": "PP-OCRv6 small"})
        check = await ops_checks.check_image_reading()
        assert (check["key"], check["status"]) == ("image_reading", light), status
        assert check["value"].startswith(value), status
    monkeypatch.setattr(result_image_ocr, "available", lambda: False)
    assert (await ops_checks.check_image_reading())["value"] == "Tesseract fehlt"
    # Ohne Modelldatei: kein Laden, kein Fehler.
    monkeypatch.undo()
    monkeypatch.setattr(result_image_second, "MODE", "on")
    monkeypatch.setattr(result_image_second, "MODEL_PATH", str(pathlib.Path(__file__).parent / "fehlt.onnx"))
    result_image_second.reset()
    try:
        assert result_image_second.presence()["status"] == "missing"
        assert result_image_second._engine is None
    finally:
        result_image_second.reset()


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


@pytest.mark.asyncio
async def test_the_variant_check_counts_only_pictures_that_get_a_small_copy(tmp_path, monkeypatch):
    """#2080: Ein Bild bis 400 Pixel Breite bekommt nie eine 400er-Fassung - es fehlt ihm nichts. Gezählt werden nur
    breitere Bilder ohne Fassung; gelb sagt dazu, was zu tun ist."""
    from PIL import Image

    public = tmp_path / "public"
    public.mkdir()
    monkeypatch.setattr(ops_checks, "PUBLIC_UPLOAD_DIR", public)
    for index in range(60):
        Image.new("RGB", (120, 80)).save(public / f"klein-{index}.png")
    check = await ops_checks.check_image_variants()
    assert check["status"] == "ok" and check["value"].startswith("0 von 60")

    for index in range(55):
        Image.new("RGB", (600, 300)).save(public / f"gross-{index}.png")
    check = await ops_checks.check_image_variants()
    assert check["status"] == "warn" and check["value"].startswith("55 von 115")
    assert "beim ersten Aufruf" in check["detail"] and "Upload-Volume" in check["detail"] and "media-report.py" in check["detail"]


@pytest.mark.asyncio
async def test_the_disk_check_says_what_to_do_when_space_runs_low(monkeypatch):
    """#2080: gelb und rot nennen, was Platz schafft - alte Docker-Images, Build-Cache, verwaiste Uploads."""
    for free, light in ((50, "ok"), (10, "warn"), (3, "crit")):
        monkeypatch.setattr(ops_checks, "_disk_usage", lambda _path, free=free: (100 * 10**9, free * 10**9))
        check = await ops_checks.check_disk()
        assert check["status"] == light, free
        if light == "ok":
            assert "docker" not in check["detail"]
        else:
            assert "docker image prune" in check["detail"] and "docker builder prune" in check["detail"]
            assert "uploads-inventory.py" in check["detail"]
    assert check["detail"].startswith("Sofort handeln"), "rot drängt"


# ---------------------------------------------------------------- Alarme

@pytest.mark.asyncio
async def test_a_red_check_alerts_only_when_it_turns_red(flow, discord_recorder):
    """#2080: Ein Alarm nur beim Wechsel auf Rot - ein Dauer-Rot meldet sich nicht jede Stunde neu; ein Flackern
    (rot, grün, rot) bremst die Sperrfrist."""
    def run_with(mail_status):
        return {"at": now_utc().isoformat(), "checks": [
            ops_checks.result("mail_queue", "Mail-Queue", mail_status, "0 wartend", "2 hängen im Versand"),
            ops_checks.result("disk", "Freier Speicher", "warn", "10 GB frei (12 %)"),
        ]}

    async def cooldown_over():
        await flow.db.ops_alert_state.update_one(
            {"key": "check:mail_queue"}, {"$set": {"last_sent_at": (now_utc() - timedelta(hours=2)).isoformat()}}
        )

    assert await ops_alerts.alert_red_checks(flow.db, run_with("crit")) == ["check:mail_queue"]
    assert len(discord_recorder) == 1
    assert "Mail-Queue ist rot" in discord_recorder[0]["title"]
    assert discord_recorder[0]["event_key"] == "ops_check"

    assert await ops_alerts.alert_red_checks(flow.db, run_with("crit")) == []
    await cooldown_over()
    for _ in range(5):
        assert await ops_alerts.alert_red_checks(flow.db, run_with("crit")) == []
    assert len(discord_recorder) == 1, "Dauer-Rot ist kein neuer Wechsel - auch nach der Sperrfrist nicht"

    assert await ops_alerts.alert_red_checks(flow.db, run_with("ok")) == []
    assert await ops_alerts.alert_red_checks(flow.db, run_with("crit")) == ["check:mail_queue"], "Wechsel auf Rot nach der Sperrfrist"
    assert len(discord_recorder) == 2

    assert await ops_alerts.alert_red_checks(flow.db, run_with("warn")) == []
    assert await ops_alerts.alert_red_checks(flow.db, run_with("crit")) == [], "Flackern innerhalb der Sperrfrist"
    assert len(discord_recorder) == 2


def _mail_queue_run(status):
    return {"at": now_utc().isoformat(), "checks": [ops_checks.result("mail_queue", "Mail-Queue", status, "0 wartend", "2 hängen im Versand")]}


async def _shift_alert_state(db, hours, *fields):
    past = (now_utc() - timedelta(hours=hours)).isoformat()
    await db.ops_alert_state.update_one({"key": "check:mail_queue"}, {"$set": {field: past for field in fields}})


@pytest.mark.asyncio
async def test_a_red_alert_that_could_not_be_sent_is_tried_again(flow, monkeypatch):
    """#2080 (Codex): Scheitert der Versand, gilt Rot nicht als gemeldet - der Claim der Sperrfrist wird zurückgegeben,
    ein neuer Versuch kommt nach dem Mindestabstand (``retry_after``, 5 Minuten)."""
    import discord_service

    calls = []

    async def flaky(title, description="", **kwargs):
        calls.append(title)
        if len(calls) == 1:
            raise RuntimeError("Discord nicht erreichbar")
        return {"ok": True, "status_code": 204}

    monkeypatch.setattr(discord_service, "send_ops_discord", flaky)
    assert await ops_alerts.alert_red_checks(flow.db, _mail_queue_run("crit")) == []
    state = await flow.db.ops_alert_state.find_one({"key": "check:mail_queue"})
    assert state.get("check_status") != "crit", "nicht als gemeldet vermerkt"
    assert not state.get("last_sent_at"), "der Claim ist zurückgegeben"
    assert state.get("retry_after"), "aber erst nach dem Mindestabstand wieder"
    assert await ops_alerts.alert_red_checks(flow.db, _mail_queue_run("crit")) == []
    await _shift_alert_state(flow.db, 1, "retry_after")
    assert await ops_alerts.alert_red_checks(flow.db, _mail_queue_run("crit")) == ["check:mail_queue"]
    assert len(calls) == 2 and "Mail-Queue ist rot" in calls[1]
    state = await flow.db.ops_alert_state.find_one({"key": "check:mail_queue"})
    assert not state.get("retry_after") and not state.get("failures"), "nach Erfolg beginnt der Abstand von vorn"


@pytest.mark.asyncio
async def test_without_any_way_a_red_check_logs_once_and_sends_once_a_way_exists(flow, monkeypatch):
    """#2080 (Codex): Ist kein Weg eingerichtet (Discord aus, keine Mail), gilt der Alarm als nicht zustellbar - ein
    Eintrag im Alarm-Log je Rot-Episode, danach still. Ist ein Weg da, geht der Alarm normal raus."""
    for _ in range(5):
        assert await ops_alerts.alert_red_checks(flow.db, _mail_queue_run("crit")) == []
        await _shift_alert_state(flow.db, 2, "last_sent_at")
    assert await flow.db.ops_alert_log.count_documents({"kind": "check_red"}) == 1

    import discord_service

    sent = []

    async def ok(title, description="", **kwargs):
        sent.append(title)
        return {"ok": True, "status_code": 204}

    monkeypatch.setattr(discord_service, "send_ops_discord", ok)
    assert await ops_alerts.alert_red_checks(flow.db, _mail_queue_run("crit")) == ["check:mail_queue"]
    assert len(sent) == 1

    # Nach einem Wechsel ist es eine neue Rot-Episode: wieder höchstens ein Eintrag, falls kein Weg da ist.
    monkeypatch.undo()
    assert await ops_alerts.alert_red_checks(flow.db, _mail_queue_run("ok")) == []
    await _shift_alert_state(flow.db, 2, "last_sent_at")
    for _ in range(3):
        await ops_alerts.alert_red_checks(flow.db, _mail_queue_run("crit"))
        await _shift_alert_state(flow.db, 2, "last_sent_at")
    assert await flow.db.ops_alert_log.count_documents({"kind": "check_red"}) == 3


class _ClaimRace:
    """Zwei Läufe zugleich (#2080, Codex): die ersten Lesezugriffe auf ``ops_alert_state`` warten paarweise aufeinander,
    so wie zwei Worker auf echtem MongoDB. Wer atomar bedingt schreibt, merkt davon nichts."""

    def __init__(self, db, gated=4):
        import asyncio

        self._db = db
        self.barrier = asyncio.Barrier(2)
        self.left = gated

    def __getattr__(self, name):
        target = getattr(self._db, name)
        return _RacingState(target, self) if name == "ops_alert_state" else target


class _RacingState:
    def __init__(self, collection, race):
        self._collection = collection
        self._race = race

    def __getattr__(self, name):
        return getattr(self._collection, name)

    async def find_one(self, *args, **kwargs):
        import asyncio
        import contextlib

        found = await self._collection.find_one(*args, **kwargs)
        if self._race.left > 0:
            self._race.left -= 1
            with contextlib.suppress(asyncio.TimeoutError, asyncio.BrokenBarrierError):
                await asyncio.wait_for(self._race.barrier.wait(), 1)
        return found


@pytest.mark.asyncio
async def test_two_runs_at_once_send_a_red_alert_only_once(flow, discord_recorder):
    """#2080 (Codex): Der Claim der Sperrfrist ist atomar - zwei Läufe zugleich ergeben genau einen Versand, auch bei
    der Erinnerung nach 24 h."""
    import asyncio

    await flow.db.ops_alert_state.create_index("key", unique=True)
    race = _ClaimRace(flow.db)
    results = await asyncio.gather(ops_alerts.alert_red_checks(race, _mail_queue_run("crit")),
                                   ops_alerts.alert_red_checks(race, _mail_queue_run("crit")))
    assert sorted(len(result) for result in results) == [0, 1]
    assert len(discord_recorder) == 1

    await _shift_alert_state(flow.db, 25, "last_sent_at", "red_alerted_at")
    race = _ClaimRace(flow.db)
    await asyncio.gather(ops_alerts.alert_red_checks(race, _mail_queue_run("crit")),
                         ops_alerts.alert_red_checks(race, _mail_queue_run("crit")))
    assert len(discord_recorder) == 2, "eine Erinnerung, nicht zwei"


@pytest.mark.asyncio
async def test_a_broken_last_sent_value_does_not_block_the_claim(flow):
    """#2080 (Codex): Ein kaputter oder anders getippter ``last_sent_at`` (Text, Zahl) sperrt den Schlüssel nicht für
    immer - er gilt als „nie gesendet“."""
    for junk in ("kaputt", 12345, {"am": "gestern"}):
        await flow.db.ops_alert_state.delete_many({})
        await flow.db.ops_alert_state.insert_one({"key": "error:x", "last_sent_at": junk})
        claim = await ops_alerts.claim_alert(flow.db, "error:x")
        assert claim is not None, junk
        assert await ops_alerts.claim_alert(flow.db, "error:x") is None, "danach gilt die Sperrfrist wieder"


@pytest.mark.asyncio
async def test_a_failing_way_backs_off_instead_of_retrying_every_tick(flow, monkeypatch):
    """#2080 (Codex): Scheitert ein eingerichteter Weg, kommt der nächste Versuch frühestens nach 5 Minuten, dann nach
    10, 20 … bis zur Sperrfrist - für jede Alarmart. Drei Takte in zwei Minuten sind ein Versuch und ein Log-Eintrag."""
    import discord_service

    calls = []

    async def broken(title, description="", **kwargs):
        calls.append(title)
        raise RuntimeError("Discord nicht erreichbar")

    monkeypatch.setattr(discord_service, "send_ops_discord", broken)
    for _ in range(3):
        await ops_alerts.notify(flow.db, "job_failed", "Job X abgebrochen", key="job:x")
    assert len(calls) == 1
    assert await flow.db.ops_alert_log.count_documents({"key": "job:x"}) == 1

    def minutes_until_retry(state):
        from datetime import datetime

        return (datetime.fromisoformat(state["retry_after"]) - now_utc()).total_seconds() / 60

    state = await flow.db.ops_alert_state.find_one({"key": "job:x"})
    assert 4 < minutes_until_retry(state) <= 5
    await flow.db.ops_alert_state.update_one({"key": "job:x"}, {"$set": {"retry_after": (now_utc() - timedelta(seconds=1)).isoformat()}})
    await ops_alerts.notify(flow.db, "job_failed", "Job X abgebrochen", key="job:x")
    assert len(calls) == 2
    state = await flow.db.ops_alert_state.find_one({"key": "job:x"})
    assert 9 < minutes_until_retry(state) <= 10, "der Abstand wächst"
    for _ in range(5):
        await flow.db.ops_alert_state.update_one({"key": "job:x"}, {"$set": {"retry_after": (now_utc() - timedelta(seconds=1)).isoformat()}})
        await ops_alerts.notify(flow.db, "job_failed", "Job X abgebrochen", key="job:x")
    state = await flow.db.ops_alert_state.find_one({"key": "job:x"})
    assert minutes_until_retry(state) <= 60, "höchstens die Sperrfrist"


@pytest.mark.asyncio
async def test_two_failed_attempts_at_once_log_only_once(flow, monkeypatch):
    """#2080 (Codex): Der Merker „Fehlversuch schon im Log“ wird atomar vor dem Eintrag geholt - zwei Versuche zugleich,
    die beide scheitern, schreiben einen Eintrag."""
    import asyncio

    import discord_service

    barrier = asyncio.Barrier(2)

    async def not_set_up(title, description="", **kwargs):
        await asyncio.wait_for(barrier.wait(), 1)
        return {"ok": False, "reason": "disabled"}

    monkeypatch.setattr(discord_service, "send_ops_discord", not_set_up)

    def gate():
        return ops_alerts.claim_failure_log(flow.db, "check:db")

    results = await asyncio.gather(*(ops_alerts.notify(flow.db, "check_red", "Datenbank ist rot", key="check:db", force=True, log_gate=gate)
                                     for _ in range(2)))
    assert [result["reason"] for result in results] == ["undeliverable", "undeliverable"]
    assert await flow.db.ops_alert_log.count_documents({"key": "check:db"}) == 1


@pytest.mark.asyncio
async def test_a_check_that_stays_red_reminds_once_a_day(flow, discord_recorder):
    """#2080 (Codex): Ein dauerhaft roter Check erinnert alle 24 h („weiterhin rot seit …“); einstellbar unter
    Betrieb → Alarme, 0 schaltet die Erinnerung ab."""
    settings = await ops_alerts.load_alert_settings(flow.db)
    assert settings["red_reminder_hours"] == 24

    assert await ops_alerts.alert_red_checks(flow.db, _mail_queue_run("crit")) == ["check:mail_queue"]
    await _shift_alert_state(flow.db, 23, "last_sent_at", "red_alerted_at")
    assert await ops_alerts.alert_red_checks(flow.db, _mail_queue_run("crit")) == [], "noch keine 24 h"
    await _shift_alert_state(flow.db, 25, "last_sent_at", "red_alerted_at", "red_since")
    assert await ops_alerts.alert_red_checks(flow.db, _mail_queue_run("crit")) == ["check:mail_queue"]
    assert "weiterhin rot" in discord_recorder[-1]["title"] and "seit" in discord_recorder[-1]["description"]
    assert await ops_alerts.alert_red_checks(flow.db, _mail_queue_run("crit")) == [], "gerade erinnert"
    assert len(discord_recorder) == 2

    await ops_alerts.save_alert_settings(flow.db, {"red_reminder_hours": 0})
    await _shift_alert_state(flow.db, 50, "last_sent_at", "red_alerted_at")
    assert await ops_alerts.alert_red_checks(flow.db, _mail_queue_run("crit")) == [], "0 = aus"
    with pytest.raises(ValueError):
        await ops_alerts.save_alert_settings(flow.db, {"red_reminder_hours": -1})
    with pytest.raises(ValueError):
        await ops_alerts.save_alert_settings(flow.db, {"red_reminder_hours": 24 * 31})
    assert (await ops_alerts.save_alert_settings(flow.db, {"red_reminder_hours": 12}))["red_reminder_hours"] == 12


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


@pytest.mark.asyncio
async def test_alerts_use_only_the_ops_channel_never_the_community_channel(flow, monkeypatch):
    """Discord III (#566): der Bot schickt in den Betriebskanal - nie in die Community, und ohne Kanal gar nicht."""
    import discord_service
    from services import discord_bot

    posted = []

    async def fake_send(channel_id, embed, buttons=None):
        posted.append({"channel_id": channel_id, "title": embed.get("title")})
        return {"ok": True, "message_id": "m1", "channel_id": channel_id}

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "send_embed", fake_send)
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)

    admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(admin)
    token = "test" * 6 + ".fake." + "token" * 8
    saved = await flow.put("/api/settings/discord", json={"channels": {"community": "100000000000000001"}, "enabled": True, "bot_token": token, "bot_enabled": True})
    assert saved.status_code == 200, saved.text

    # Nur der Community-Kanal ist gewählt: kein Alarm, und schon gar nicht dorthin.
    outcome = await discord_service.send_ops_discord("Betrieb: Test", "rot")
    assert outcome["ok"] is False and outcome["reason"] == "ops_channel_missing" and outcome["target"] == "ops"
    assert "Kein Kanal" in outcome["error"] and posted == []
    skipped = await flow.db.email_logs.find_one({"target": "ops"}, {"_id": 0})
    assert skipped and skipped["status"] == "skipped" and skipped["reason"] == "ops_channel_missing"

    saved = await flow.put("/api/settings/discord", json={"channels": {"ops": "100000000000000004"}})
    assert saved.status_code == 200, saved.text
    shown = (await flow.get("/api/settings/discord")).json()
    assert shown["channels"]["ops"] == "100000000000000004" and "bot_token" not in shown

    outcome = await discord_service.send_ops_discord("Betrieb: Test", "rot")
    assert outcome["ok"] is True
    assert posted == [{"channel_id": "100000000000000004", "title": "Betrieb: Test"}]

    # Der Community-Weg bleibt beim Community-Kanal.
    await discord_service.send_discord("News", "öffentlich")
    assert posted[-1]["channel_id"] == "100000000000000001"

    test_message = await flow.post("/api/settings/discord/test?target=ops")
    assert test_message.status_code == 200 and test_message.json()["ok"] is True
    assert posted[-1]["channel_id"] == "100000000000000004"


@pytest.mark.asyncio
async def test_the_client_address_check_reads_the_sessions_of_the_last_day(flow):
    """#941: tragen alle Sitzungen die Adresse des Proxys, steht die Prüfung auf Gelb und nennt den Klickweg."""
    from datetime import timedelta

    from models import now_utc

    quiet = await ops_checks.check_client_ip(flow.db)
    assert quiet["status"] == "ok" and quiet["value"] == "keine Sitzung in 24 h"
    for number in range(6):
        await flow.db.auth_sessions.insert_one({"id": f"s{number}", "family_id": f"f{number}", "ip": "192.168.2.100", "last_active": now_utc()})
    await flow.db.auth_sessions.insert_one({"id": "alt", "family_id": "alt", "ip": "88.117.10.20", "last_active": now_utc() - timedelta(days=3)})
    proxied = await ops_checks.check_client_ip(flow.db)
    assert proxied["status"] == "warn" and proxied["value"] == "6 Sitzungen in 24 h von 1 Adressen"
    assert "TRUSTED_PROXY_CIDRS" in proxied["detail"] and "docs/BETRIEB.md" in proxied["detail"]
    for number in range(6):
        await flow.db.auth_sessions.update_one({"id": f"s{number}"}, {"$set": {"ip": f"88.117.10.{number + 1}"}})
    real = await ops_checks.check_client_ip(flow.db)
    assert real["status"] == "ok" and real["value"] == "6 Sitzungen in 24 h von 6 Adressen"
