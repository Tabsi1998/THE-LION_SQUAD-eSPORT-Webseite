import asyncio
from datetime import datetime, timedelta, timezone
import pathlib
import sys

import pytest
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.mutation_lock import MutationLockBusy, MutationLockLost, mutation_lock, tournament_write_resource


class _FakeMutationLocks:
    def __init__(self, document=None):
        self.document = document
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
    def __init__(self, document=None):
        self.mutation_locks = _FakeMutationLocks(document)


def test_tournament_write_resource_is_stable_and_scoped():
    assert tournament_write_resource("turnier-1") == "tournament:turnier-1:write"


def test_mutation_lock_rejects_parallel_owner_without_waiting():
    async def scenario():
        db = _FakeDb()
        async with mutation_lock(db, "resource-1", wait_seconds=0):
            with pytest.raises(MutationLockBusy):
                async with mutation_lock(db, "resource-1", wait_seconds=0):
                    pass
        assert db.mutation_locks.document is None

    asyncio.run(scenario())


def test_mutation_lock_waiter_acquires_after_release():
    async def scenario():
        db = _FakeDb()
        entered = asyncio.Event()
        release = asyncio.Event()
        order = []

        async def first_owner():
            async with mutation_lock(db, "resource-1", wait_seconds=0):
                order.append("first")
                entered.set()
                await release.wait()

        async def second_owner():
            await entered.wait()
            async with mutation_lock(db, "resource-1", wait_seconds=0.5, retry_seconds=0.001):
                order.append("second")

        first_task = asyncio.create_task(first_owner())
        second_task = asyncio.create_task(second_owner())
        await entered.wait()
        await asyncio.sleep(0.01)
        assert order == ["first"]
        release.set()
        await asyncio.gather(first_task, second_task)
        assert order == ["first", "second"]
        assert db.mutation_locks.document is None

    asyncio.run(scenario())


def test_mutation_lock_takes_over_expired_lease():
    async def scenario():
        db = _FakeDb({
            "resource": "resource-1",
            "owner": "dead-worker",
            "expires_at": datetime.now(timezone.utc) - timedelta(seconds=1),
        })
        async with mutation_lock(db, "resource-1", wait_seconds=0) as owner:
            assert owner != "dead-worker"
            assert db.mutation_locks.document["owner"] == owner
        assert db.mutation_locks.document is None

    asyncio.run(scenario())


def test_mutation_lock_renews_lease_while_work_is_running():
    async def scenario():
        db = _FakeDb()
        async with mutation_lock(
            db,
            "resource-1",
            wait_seconds=0,
            lease_seconds=0.15,
        ):
            first_expiry = db.mutation_locks.document["expires_at"]
            await asyncio.sleep(0.08)
            assert db.mutation_locks.document["expires_at"] > first_expiry
        assert db.mutation_locks.document is None

    asyncio.run(scenario())


def test_mutation_lock_validates_arguments():
    async def scenario():
        db = _FakeDb()
        with pytest.raises(ValueError, match="resource"):
            async with mutation_lock(db, ""):
                pass
        with pytest.raises(ValueError, match="lease_seconds"):
            async with mutation_lock(db, "resource-1", lease_seconds=0):
                pass

    asyncio.run(scenario())


class _FlakyMutationLocks(_FakeMutationLocks):
    """Die Erneuerung scheitert ``failures``-mal mit einem Datenbankfehler, danach klappt sie wieder."""

    def __init__(self, failures: int):
        super().__init__()
        self.failures = failures
        self.renew_calls = 0

    async def update_one(self, query, update):
        self.renew_calls += 1
        if self.failures > 0:
            self.failures -= 1
            raise ConnectionError("mongo kurz weg")
        return await super().update_one(query, update)


def test_mutation_lock_keeps_renewing_after_a_failed_renewal(caplog):
    async def scenario():
        db = _FakeDb()
        db.mutation_locks = _FlakyMutationLocks(failures=1)
        with caplog.at_level("WARNING", logger="tls.mutation_lock"):
            async with mutation_lock(db, "resource-1", wait_seconds=0, lease_seconds=0.3) as owner:
                await asyncio.sleep(0.45)
                document = db.mutation_locks.document
                assert document["owner"] == owner
                assert document["expires_at"] > datetime.now(timezone.utc), "die Sperre läuft nach einem Fehler nicht aus"
        assert db.mutation_locks.renew_calls >= 3
        assert db.mutation_locks.document is None
        assert any("nicht erneuert" in record.getMessage() for record in caplog.records)

    asyncio.run(scenario())


def test_mutation_lock_reports_a_lost_lease_and_stops_the_holder(caplog):
    async def scenario():
        db = _FakeDb()
        writes = []
        with caplog.at_level("WARNING", logger="tls.mutation_lock"):
            with pytest.raises(MutationLockLost):
                async with mutation_lock(db, "resource-1", wait_seconds=0, lease_seconds=0.03):
                    # Ein anderer Worker hat übernommen (etwa nach einer Pause dieses Workers).
                    db.mutation_locks.document["owner"] = "anderer-worker"
                    await asyncio.sleep(0.05)
                    writes.append("nach dem Verlust")
        assert writes == [], "nach dem Verlust schreibt der alte Halter nicht weiter"
        assert db.mutation_locks.document["owner"] == "anderer-worker", "die fremde Sperre bleibt unangetastet"
        assert any("verloren" in record.getMessage() for record in caplog.records)

    asyncio.run(scenario())


def test_lost_lease_counts_as_busy_for_existing_callers():
    # Aufrufer fangen MutationLockBusy und antworten "bitte erneut versuchen" - das gilt auch für den Verlust.
    assert issubclass(MutationLockLost, MutationLockBusy)


class _BrokenRenewals(_FakeMutationLocks):
    """Die Erneuerung scheitert dauerhaft mit einem Datenbankfehler (Verbindung dieses Workers ist weg)."""

    async def update_one(self, query, update):
        raise ConnectionError("mongo weg")


class _HangingRenewals(_FakeMutationLocks):
    """Die Erneuerung kommt nie zurück."""

    async def update_one(self, query, update):
        await asyncio.Event().wait()


async def _work_until_stopped(db, resource, lease_seconds, log, name):
    async with mutation_lock(db, resource, wait_seconds=0, lease_seconds=lease_seconds):
        # Bis wann die Sperre in der Datenbank gilt - danach darf ein anderer übernehmen.
        log.append(("expires_at", db.mutation_locks.document["expires_at"]))
        while True:
            await asyncio.sleep(0.005)
            log.append((name, datetime.now(timezone.utc)))


def test_mutation_lock_stops_the_holder_before_expiry_when_renewal_keeps_failing():
    async def scenario():
        db = _FakeDb()
        db.mutation_locks = _BrokenRenewals()
        log = []
        with pytest.raises(MutationLockLost):
            await asyncio.wait_for(_work_until_stopped(db, "resource-1", 0.2, log, "a"), timeout=2)
        expires_at = dict(log)["expires_at"]
        writes = [at for name, at in log if name == "a"]
        assert writes, "der Halter hat vor dem Verlust gearbeitet"
        assert all(at < expires_at for at in writes), "nach Ablauf der Sperre wird nicht mehr geschrieben"

    asyncio.run(scenario())


def test_mutation_lock_stops_the_holder_when_renewal_hangs():
    async def scenario():
        db = _FakeDb()
        db.mutation_locks = _HangingRenewals()
        log = []
        with pytest.raises(MutationLockLost):
            await asyncio.wait_for(_work_until_stopped(db, "resource-1", 0.2, log, "a"), timeout=2)
        expires_at = dict(log)["expires_at"]
        writes = [at for name, at in log if name == "a"]
        assert writes
        assert all(at < expires_at for at in writes)

    asyncio.run(scenario())


class _SharedStoreView:
    """Ein Prozess mit eigener Verbindung auf denselben Sperr-Datensatz."""

    def __init__(self, store, broken_renewals=False):
        self._store = store
        self._broken = broken_renewals

    @property
    def document(self):
        return self._store.document

    async def find_one_and_update(self, *args, **kwargs):
        return await self._store.find_one_and_update(*args, **kwargs)

    async def delete_one(self, query):
        return await self._store.delete_one(query)

    async def update_one(self, query, update):
        if self._broken:
            raise ConnectionError("verbindung dieses prozesses weg")
        return await self._store.update_one(query, update)


class _ProcessDb:
    def __init__(self, store, broken_renewals=False):
        self.mutation_locks = _SharedStoreView(store, broken_renewals)


def test_two_processes_never_write_at_the_same_time_after_a_failed_renewal():
    async def scenario():
        store = _FakeMutationLocks()
        process_a = _ProcessDb(store, broken_renewals=True)
        process_b = _ProcessDb(store)
        log = []

        async def first():
            with pytest.raises(MutationLockLost):
                await _work_until_stopped(process_a, "resource-1", 0.2, log, "a")

        async def second():
            await asyncio.sleep(0.01)
            async with mutation_lock(process_b, "resource-1", wait_seconds=1.0, lease_seconds=0.2, retry_seconds=0.005):
                for _ in range(5):
                    await asyncio.sleep(0.005)
                    log.append(("b", datetime.now(timezone.utc)))

        await asyncio.wait_for(asyncio.gather(first(), second()), timeout=3)
        last_a = max(at for name, at in log if name == "a")
        first_b = min(at for name, at in log if name == "b")
        assert last_a < first_b, "der zweite Prozess schreibt erst, wenn der erste aufgehört hat"
        assert store.document is None

    asyncio.run(scenario())


def test_external_cancellation_stays_a_cancellation():
    async def scenario():
        db = _FakeDb()
        entered = asyncio.Event()

        async def holder():
            async with mutation_lock(db, "resource-1", wait_seconds=0, lease_seconds=1.0):
                entered.set()
                await asyncio.sleep(10)

        task = asyncio.create_task(holder())
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert db.mutation_locks.document is None

    asyncio.run(scenario())


def test_nested_leases_report_the_loss_of_the_outer_one():
    async def scenario():
        db = _FakeDb()
        inner_db = _FakeDb()
        writes = []
        with pytest.raises(MutationLockLost):
            async with mutation_lock(db, "outer", wait_seconds=0, lease_seconds=0.03):
                async with mutation_lock(inner_db, "inner", wait_seconds=0, lease_seconds=1.0):
                    db.mutation_locks.document["owner"] = "anderer-worker"
                    await asyncio.sleep(0.1)
                    writes.append("nach dem Verlust")
        assert writes == []
        assert inner_db.mutation_locks.document is None, "die innere Sperre wird trotzdem freigegeben"

    asyncio.run(scenario())


def test_route_dependency_answers_busy_when_the_lease_is_lost():
    # So nutzen die Turnier- und Matchrouten die Sperre: als Abhängigkeit mit yield, Verlust wird zur 409.
    from fastapi import Depends, FastAPI, HTTPException
    from fastapi.testclient import TestClient

    db = _FakeDb()
    writes = []

    async def serialized():
        try:
            async with mutation_lock(db, "resource-1", wait_seconds=0, lease_seconds=0.15):
                yield
        except MutationLockBusy:
            raise HTTPException(status_code=409, detail="busy")

    app = FastAPI()

    @app.post("/write")
    async def write(_lock=Depends(serialized)):
        db.mutation_locks.document["owner"] = "anderer-worker"
        await asyncio.sleep(0.5)
        writes.append("nach dem Verlust")
        return {"ok": True}

    response = TestClient(app).post("/write")
    assert response.status_code == 409
    assert writes == []
