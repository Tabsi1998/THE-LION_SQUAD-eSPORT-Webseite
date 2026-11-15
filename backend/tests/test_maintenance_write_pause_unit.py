"""Schreibpause fürs Backup (#1009): an, aus, Ablauf der Lease, Absturz des Backups, Hintergrundjobs, Kommandozeile."""
import asyncio
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import maintenance, scheduler  # noqa: E402

T0 = datetime(2026, 11, 16, 2, 15, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def clean_cache():
    maintenance.reset_cache()
    yield
    maintenance.reset_cache()


def fresh_db():
    return AsyncMongoMockClient()["tls_maintenance_tests"]


def run(coro):
    return asyncio.run(coro)


def test_on_and_off():
    async def scenario():
        db = fresh_db()
        assert (await maintenance.status(db, now=T0))["active"] is False
        started = await maintenance.activate(db, ttl_seconds=120, reason="backup", now=T0)
        state = await maintenance.status(db, now=T0 + timedelta(seconds=10))
        assert state["active"] is True and state["reason"] == "backup" and state["remaining_seconds"] == 110
        assert "token" not in state
        assert await maintenance.release(db, started["token"], now=T0 + timedelta(seconds=20)) is True
        assert (await maintenance.status(db, now=T0 + timedelta(seconds=21)))["active"] is False

    run(scenario())


def test_the_lease_ends_on_its_own_when_the_backup_crashes():
    """Das Skript stirbt (kill -9, Stromausfall) und sagt nie „aus“ - nach der Lease schreibt die Website wieder."""
    async def scenario():
        db = fresh_db()
        await maintenance.activate(db, ttl_seconds=60, now=T0)
        assert (await maintenance.status(db, now=T0 + timedelta(seconds=59)))["active"] is True
        assert (await maintenance.status(db, now=T0 + timedelta(seconds=60)))["active"] is False
        # Das nächste Backup kann die abgelaufene Pause übernehmen, ohne dass jemand aufräumt.
        again = await maintenance.activate(db, ttl_seconds=60, now=T0 + timedelta(seconds=61))
        assert again["token"]

    run(scenario())


def test_a_second_pause_does_not_take_over_a_running_one():
    async def scenario():
        db = fresh_db()
        first = await maintenance.activate(db, ttl_seconds=120, now=T0)
        with pytest.raises(maintenance.WritePauseBusy):
            await maintenance.activate(db, ttl_seconds=120, now=T0 + timedelta(seconds=5))
        # Ein fremdes Token beendet die Pause nicht; force schon.
        assert await maintenance.release(db, "fremd", now=T0 + timedelta(seconds=6)) is False
        assert (await maintenance.status(db, now=T0 + timedelta(seconds=7)))["active"] is True
        assert await maintenance.release(db, force=True, now=T0 + timedelta(seconds=8)) is True
        assert (await maintenance.status(db, now=T0 + timedelta(seconds=9)))["active"] is False
        assert first["token"]

    run(scenario())


def test_renew_only_extends_a_living_own_lease():
    async def scenario():
        db = fresh_db()
        started = await maintenance.activate(db, ttl_seconds=30, now=T0)
        assert await maintenance.renew(db, started["token"], ttl_seconds=30, now=T0 + timedelta(seconds=20)) is True
        assert (await maintenance.status(db, now=T0 + timedelta(seconds=45)))["active"] is True
        assert await maintenance.renew(db, "fremd", ttl_seconds=30, now=T0 + timedelta(seconds=46)) is False
        # Abgelaufen: nicht wiederbeleben - das Backup soll merken, dass die Pause gerissen ist.
        assert await maintenance.renew(db, started["token"], ttl_seconds=30, now=T0 + timedelta(seconds=51)) is False

    run(scenario())


@pytest.mark.parametrize("ttl", [0, 4, 1801, -5])
def test_the_lease_length_is_bounded(ttl):
    with pytest.raises(ValueError):
        run(maintenance.activate(fresh_db(), ttl_seconds=ttl, now=T0))


def test_release_without_token_needs_force():
    with pytest.raises(ValueError):
        run(maintenance.release(fresh_db()))


def test_which_requests_the_pause_blocks(monkeypatch):
    monkeypatch.delenv("MAINTENANCE_EXEMPT_PATHS", raising=False)
    assert maintenance.blocks("POST", "/api/news") is True
    assert maintenance.blocks("delete", "/api/admin/users/x") is True
    assert maintenance.blocks("PATCH", "/api/tournaments/t1") is True
    assert maintenance.blocks("PUT", "/api/profile") is True
    for method in ("GET", "HEAD", "OPTIONS"):
        assert maintenance.blocks(method, "/api/news") is False
    assert maintenance.blocks("POST", "/health") is False
    for path in ("/api/auth/login", "/api/auth/refresh", "/api/auth/logout", "/api/auth/mobile/refresh", "/api/auth/login/"):
        assert maintenance.blocks("POST", path) is False
    assert maintenance.blocks("POST", "/api/auth/register") is True
    monkeypatch.setenv("MAINTENANCE_EXEMPT_PATHS", "/api/client-logs, /api/ops/vitals/")
    assert maintenance.blocks("POST", "/api/client-logs") is False
    assert maintenance.blocks("POST", "/api/ops/vitals") is False


def test_the_answer_says_come_back_soon(monkeypatch):
    monkeypatch.delenv("MAINTENANCE_RETRY_AFTER_SECONDS", raising=False)
    status, body, headers = maintenance.response_parts({"active": True, "remaining_seconds": 100})
    assert status == 503
    assert body["code"] == "write_pause" and "gleich wieder" in body["detail"]
    assert headers["Retry-After"] == "30" and body["retry_after"] == 30
    assert headers["Cache-Control"] == "no-store"
    # Kurz vor dem Ende: nie länger warten lassen als nötig.
    assert maintenance.response_parts({"active": True, "remaining_seconds": 7})[2]["Retry-After"] == "7"
    monkeypatch.setenv("MAINTENANCE_RETRY_AFTER_SECONDS", "10")
    assert maintenance.response_parts({"active": True, "remaining_seconds": 100})[2]["Retry-After"] == "10"


def test_a_broken_database_never_locks_the_site():
    class Broken:
        @property
        def ops_maintenance(self):
            raise RuntimeError("down")

    assert run(maintenance.active_state(Broken())) is None


def test_every_process_sees_the_pause_within_the_cache_time(monkeypatch):
    monkeypatch.setenv("MAINTENANCE_CACHE_SECONDS", "0")

    async def scenario():
        db = fresh_db()
        assert await maintenance.active_state(db) is None
        # Ein anderer Prozess (das Backup) schaltet ein - hier direkt in der Datenbank, ohne den Zwischenspeicher zu leeren.
        await db.ops_maintenance.insert_one({"_id": "write_pause", "active": True, "token": "x",
                                             "lease_until": datetime.now(timezone.utc) + timedelta(seconds=60)})
        assert (await maintenance.active_state(db))["active"] is True
        await db.ops_maintenance.update_one({"_id": "write_pause"}, {"$set": {"active": False}})
        assert await maintenance.active_state(db) is None

    run(scenario())


def test_the_cache_is_per_database(monkeypatch):
    monkeypatch.setenv("MAINTENANCE_CACHE_SECONDS", "10")

    async def scenario():
        paused, other = fresh_db(), AsyncMongoMockClient()["tls_maintenance_other"]
        await maintenance.activate(paused, ttl_seconds=60)
        assert await maintenance.active_state(paused)
        assert await maintenance.active_state(other) is None

    run(scenario())


def test_drain_waits_for_running_writes():
    async def scenario():
        db = fresh_db()
        future = datetime.now(timezone.utc) + timedelta(seconds=30)
        await db.mutation_locks.insert_one({"resource": "scheduler:mail_queue", "owner": "o", "expires_at": future})
        await db.mutation_locks.insert_one({"resource": "old", "owner": "o", "expires_at": datetime.now(timezone.utc) - timedelta(seconds=5)})
        assert await maintenance.busy_leases(db) == ["scheduler:mail_queue"]

        async def finish_soon():
            await asyncio.sleep(0.2)
            await db.mutation_locks.delete_one({"resource": "scheduler:mail_queue"})

        task = asyncio.create_task(finish_soon())
        busy = await maintenance.wait_for_drain(db, timeout_seconds=5, settle_seconds=0, poll_seconds=0.05)
        await task
        assert busy == []
        await db.mutation_locks.insert_one({"resource": "tournament:t1:write", "owner": "o", "expires_at": future})
        assert await maintenance.wait_for_drain(db, timeout_seconds=0.1, settle_seconds=0, poll_seconds=0.05) == ["tournament:t1:write"]

    run(scenario())


def test_scheduler_ticks_are_skipped_during_the_pause(monkeypatch):
    db = fresh_db()
    monkeypatch.setitem(sys.modules, "database", type("M", (), {"get_db": staticmethod(lambda: db)}))
    runs = []

    async def runner():
        runs.append("run")

    async def scenario():
        job = scheduler._single_replica("mail_queue", runner)
        started = await maintenance.activate(db, ttl_seconds=60)
        await job()
        assert runs == []
        # Auch keine Sperre: die wäre schon ein Schreibvorgang.
        assert await db.mutation_locks.count_documents({}) == 0
        await maintenance.release(db, started["token"])
        await job()
        assert runs == ["run"]

    run(scenario())


def test_command_line_on_status_renew_off():
    async def scenario():
        db = fresh_db()
        code, out = await maintenance.run_command(db, ["on", "--ttl", "90", "--settle", "0", "--drain-timeout", "0"])
        assert code == 0 and out["drained"] is True and out["busy"] == [] and out["token"]
        token = out["token"]
        code, busy = await maintenance.run_command(db, ["on", "--ttl", "90", "--settle", "0", "--drain-timeout", "0"])
        assert code == 3 and busy["active"] is True and "token" not in busy
        code, state = await maintenance.run_command(db, ["status"])
        assert code == 0 and state["active"] is True and "token" not in state
        code, renewed = await maintenance.run_command(db, ["renew", "--token", token, "--ttl", "60"])
        assert code == 0 and renewed["renewed"] is True
        code, wrong = await maintenance.run_command(db, ["renew", "--token", "fremd"])
        assert code == 4 and wrong["renewed"] is False
        code, missing = await maintenance.run_command(db, ["off"])
        assert code == 2
        code, off = await maintenance.run_command(db, ["off", "--token", token])
        assert code == 0 and off["released"] is True
        code, bad = await maintenance.run_command(db, ["on", "--ttl", "99999"])
        assert code == 2 and "Sekunden" in bad["error"]
        assert missing

    run(scenario())


def test_off_force_is_idempotent_without_a_pause_document():
    """Restore in ein frisches Ziel oder aus einem alten Backup: es gibt kein Pause-Dokument - "aus" ist trotzdem erreicht."""
    async def scenario():
        db = fresh_db()
        code, out = await maintenance.run_command(db, ["off", "--force"])
        assert code == 0 and out == {"released": False, "lease_held": False}
        assert await db.ops_maintenance.count_documents({}) == 0
        started = await maintenance.activate(db, ttl_seconds=60)
        await maintenance.release(db, started["token"])
        code, out = await maintenance.run_command(db, ["off", "--force"])
        assert code == 0 and out["lease_held"] is False
        # Ohne force und mit unbekanntem Token bleibt es ein Fehler.
        code, _out = await maintenance.run_command(fresh_db(), ["off", "--token", "fremd"])
        assert code == 5

    run(scenario())
