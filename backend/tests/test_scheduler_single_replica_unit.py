"""Scheduler ticks must not run twice when several API replicas are active."""
import asyncio
from datetime import datetime, timedelta, timezone
import pathlib
import sys

from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import scheduler


class _FakeMutationLocks:
    def __init__(self):
        self.document = None
        self._atomic = asyncio.Lock()

    async def find_one_and_update(self, query, update, **_kwargs):
        async with self._atomic:
            current = self.document
            now = query["$or"][0]["expires_at"]["$lte"]
            owner = query["$or"][1]["owner"]
            can_take = (
                current is None
                or current.get("expires_at") <= now
                or current.get("owner") == owner
            )
            if not can_take:
                raise DuplicateKeyError("resource already leased")
            self.document = dict(update["$set"])
            return dict(self.document)

    async def delete_one(self, query):
        async with self._atomic:
            if self.document and all(self.document.get(key) == value for key, value in query.items()):
                self.document = None

    async def update_one(self, query, update):
        async with self._atomic:
            matched = bool(
                self.document
                and all(self.document.get(key) == value for key, value in query.items())
            )
            if matched:
                self.document.update(update["$set"])
            return type("Result", (), {"matched_count": int(matched)})()


class _FakeDb:
    def __init__(self):
        self.mutation_locks = _FakeMutationLocks()


def _patch_db(monkeypatch, db):
    monkeypatch.setitem(sys.modules, "database", type("M", (), {"get_db": staticmethod(lambda: db)}))


def test_resource_name_is_scoped_per_job():
    assert scheduler.scheduler_lock_resource("mail_queue") == "scheduler:mail_queue"
    assert scheduler.scheduler_lock_resource("status_transitions") != scheduler.scheduler_lock_resource("mail_queue")


def test_second_replica_skips_the_tick_instead_of_duplicating_it(monkeypatch):
    db = _FakeDb()
    _patch_db(monkeypatch, db)
    started = asyncio.Event()
    release = asyncio.Event()
    runs = []

    async def slow_runner():
        runs.append("run")
        started.set()
        await release.wait()

    async def scenario():
        job = scheduler._single_replica("mail_queue", slow_runner)
        first = asyncio.create_task(job())
        await started.wait()
        # A second replica hits the same tick while the first one still holds the lease.
        await job()
        release.set()
        await first

    asyncio.run(scenario())
    assert runs == ["run"]
    assert db.mutation_locks.document is None


def test_lease_is_released_so_the_next_tick_runs(monkeypatch):
    db = _FakeDb()
    _patch_db(monkeypatch, db)
    runs = []

    async def runner():
        runs.append("run")

    async def scenario():
        job = scheduler._single_replica("status_transitions", runner)
        await job()
        await job()

    asyncio.run(scenario())
    assert runs == ["run", "run"]


def test_expired_lease_from_a_dead_replica_is_taken_over(monkeypatch):
    db = _FakeDb()
    db.mutation_locks.document = {
        "resource": scheduler.scheduler_lock_resource("game_server_sync"),
        "owner": "worker-that-died",
        "acquired_at": datetime.now(timezone.utc) - timedelta(minutes=5),
        "expires_at": datetime.now(timezone.utc) - timedelta(minutes=4),
    }
    _patch_db(monkeypatch, db)
    runs = []

    async def runner():
        runs.append("run")

    asyncio.run(scheduler._single_replica("game_server_sync", runner)())
    assert runs == ["run"]


def test_job_failure_does_not_leak_the_lease(monkeypatch):
    db = _FakeDb()
    _patch_db(monkeypatch, db)

    async def failing_runner():
        raise RuntimeError("job exploded")

    asyncio.run(scheduler._single_replica("prize_expiry", failing_runner)())
    assert db.mutation_locks.document is None


def test_run_stops_when_the_lease_is_lost(monkeypatch, caplog):
    db = _FakeDb()
    _patch_db(monkeypatch, db)
    writes = []

    async def runner():
        # Ein anderes Replikat hält die Sperre inzwischen.
        db.mutation_locks.document["owner"] = "anderes-replikat"
        await asyncio.sleep(0.5)
        writes.append("nach dem Verlust")

    with caplog.at_level("WARNING", logger="tls.scheduler"):
        asyncio.run(scheduler._single_replica("mail_queue", runner, lease_seconds=0.15)())
    assert writes == []
    assert db.mutation_locks.document["owner"] == "anderes-replikat"
    assert any("lease lost" in record.getMessage() for record in caplog.records)
