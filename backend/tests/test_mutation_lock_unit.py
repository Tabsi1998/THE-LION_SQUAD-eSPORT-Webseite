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


class _VirtualTimeLoop(asyncio.SelectorEventLoop):
    """Steuerbare Uhr: wartet die Schleife nur noch auf Zeitgeber, springt die Zeit sofort dorthin."""

    def __init__(self):
        super().__init__()
        self._virtual_now = 0.0
        real_select = self._selector.select

        def select(timeout=None):
            if timeout is not None and timeout > 0:
                self._virtual_now += timeout
            return real_select(0)

        self._selector.select = select

    def time(self):
        return self._virtual_now


_VIRTUAL_EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _vnow():
    return _VIRTUAL_EPOCH + timedelta(seconds=asyncio.get_running_loop().time())


class _VirtualDatetime:
    @staticmethod
    def now(tz=None):
        return _vnow()


def _run_virtual(monkeypatch, scenario):
    """Führt ein Szenario mit steuerbarer Uhr aus - Sperre, Datenbank-Zeitstempel und Wartezeiten laufen virtuell."""
    monkeypatch.setattr("services.mutation_lock.monotonic", lambda: asyncio.get_running_loop().time())
    monkeypatch.setattr("services.mutation_lock.datetime", _VirtualDatetime)
    with asyncio.Runner(loop_factory=_VirtualTimeLoop) as runner:
        return runner.run(scenario())


def test_mutation_lock_renews_lease_while_work_is_running(monkeypatch):
    async def scenario():
        db = _FakeDb()
        async with mutation_lock(db, "resource-1", wait_seconds=0, lease_seconds=30):
            first_expiry = db.mutation_locks.document["expires_at"]
            await asyncio.sleep(45)
            assert db.mutation_locks.document["expires_at"] > first_expiry
            assert db.mutation_locks.document["expires_at"] > _vnow()
        assert db.mutation_locks.document is None

    _run_virtual(monkeypatch, scenario)


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


def test_mutation_lock_keeps_renewing_after_a_failed_renewal(monkeypatch, caplog):
    async def scenario():
        db = _FakeDb()
        db.mutation_locks = _FlakyMutationLocks(failures=1)
        with caplog.at_level("WARNING", logger="tls.mutation_lock"):
            async with mutation_lock(db, "resource-1", wait_seconds=0, lease_seconds=30) as owner:
                await asyncio.sleep(45)
                document = db.mutation_locks.document
                assert document["owner"] == owner
                assert document["expires_at"] > _vnow(), "die Sperre läuft nach einem Fehler nicht aus"
        assert db.mutation_locks.renew_calls >= 3
        assert db.mutation_locks.document is None
        assert any("nicht erneuert" in record.getMessage() for record in caplog.records)

    _run_virtual(monkeypatch, scenario)


def test_mutation_lock_reports_a_lost_lease_and_stops_the_holder(monkeypatch, caplog):
    async def scenario():
        db = _FakeDb()
        writes = []
        with caplog.at_level("WARNING", logger="tls.mutation_lock"):
            with pytest.raises(MutationLockLost):
                async with mutation_lock(db, "resource-1", wait_seconds=0, lease_seconds=30):
                    # Ein anderer Worker hat übernommen (etwa nach einer Pause dieses Workers).
                    db.mutation_locks.document["owner"] = "anderer-worker"
                    await asyncio.Event().wait()
                    writes.append("nach dem Verlust")
        assert writes == [], "nach dem Verlust schreibt der alte Halter nicht weiter"
        assert db.mutation_locks.document["owner"] == "anderer-worker", "die fremde Sperre bleibt unangetastet"
        assert any("verloren" in record.getMessage() for record in caplog.records)

    _run_virtual(monkeypatch, scenario)


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


async def _work_until_stopped(db, resource, log, name, lease_seconds=30):
    async with mutation_lock(db, resource, wait_seconds=0, lease_seconds=lease_seconds):
        # Bis wann die Sperre in der Datenbank gilt - danach darf ein anderer übernehmen.
        log.append(("expires_at", db.mutation_locks.document["expires_at"]))
        while True:
            log.append((name, _vnow()))
            await asyncio.sleep(1)


@pytest.mark.parametrize("locks", [_BrokenRenewals, _HangingRenewals], ids=["fehler", "haenger"])
def test_mutation_lock_stops_the_holder_before_expiry_when_renewal_fails(monkeypatch, locks):
    async def scenario():
        db = _FakeDb()
        db.mutation_locks = locks()
        log = []
        with pytest.raises(MutationLockLost):
            await _work_until_stopped(db, "resource-1", log, "a")
        stopped_at = _vnow()
        expires_at = dict(log)["expires_at"]
        writes = [at for name, at in log if name == "a"]
        assert writes, "der Halter hat vor dem Verlust gearbeitet"
        assert all(at < expires_at for at in writes), "nach Ablauf der Sperre wird nicht mehr geschrieben"
        assert stopped_at < expires_at, "der Abbruch kommt vor dem Ablauf"

    _run_virtual(monkeypatch, scenario)


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


def test_two_processes_never_write_at_the_same_time_after_a_failed_renewal(monkeypatch):
    async def scenario():
        store = _FakeMutationLocks()
        process_a = _ProcessDb(store, broken_renewals=True)
        process_b = _ProcessDb(store)
        log = []
        a_started = asyncio.Event()

        async def first():
            with pytest.raises(MutationLockLost):
                async with mutation_lock(process_a, "resource-1", wait_seconds=0, lease_seconds=30):
                    a_started.set()
                    while True:
                        log.append("a")
                        await asyncio.sleep(1)

        async def second():
            await a_started.wait()
            async with mutation_lock(process_b, "resource-1", wait_seconds=120, lease_seconds=30, retry_seconds=0.5):
                log.append("b")

        await asyncio.gather(first(), second())
        assert "a" in log and "b" in log
        assert "a" not in log[log.index("b"):], "der zweite Prozess schreibt erst, wenn der erste aufgehört hat"
        assert store.document is None

    _run_virtual(monkeypatch, scenario)


def test_external_cancellation_stays_a_cancellation():
    async def scenario():
        db = _FakeDb()
        entered = asyncio.Event()

        async def holder():
            async with mutation_lock(db, "resource-1", wait_seconds=0, lease_seconds=30):
                entered.set()
                await asyncio.Event().wait()

        task = asyncio.create_task(holder())
        await entered.wait()
        task.cancel()
        await asyncio.wait([task])
        assert task.cancelled(), "die Aufgabe endet durch den Abbruch"
        assert db.mutation_locks.document is None

    asyncio.run(scenario())


def test_nested_leases_report_the_loss_of_the_outer_one(monkeypatch):
    async def scenario():
        db = _FakeDb()
        inner_db = _FakeDb()
        writes = []
        with pytest.raises(MutationLockLost):
            async with mutation_lock(db, "outer", wait_seconds=0, lease_seconds=30):
                async with mutation_lock(inner_db, "inner", wait_seconds=0, lease_seconds=300):
                    db.mutation_locks.document["owner"] = "anderer-worker"
                    await asyncio.Event().wait()
                    writes.append("nach dem Verlust")
        assert writes == []
        assert inner_db.mutation_locks.document is None, "die innere Sperre wird trotzdem freigegeben"

    _run_virtual(monkeypatch, scenario)


# --- Erwerb und Freigabe halten auch bei Abbruch und Datenbankfehlern -------------------------------------------


class _CommitThenStall(_FakeMutationLocks):
    """Der Server übernimmt die Sperre, die Antwort kommt aber nicht mehr an (Abbruch oder Netzfehler danach)."""

    def __init__(self, error=None):
        super().__init__()
        self.error = error
        self.committed = asyncio.Event()

    async def find_one_and_update(self, query, update, **kwargs):
        await super().find_one_and_update(query, update, **kwargs)
        self.committed.set()
        if self.error:
            raise self.error
        await asyncio.Event().wait()


def test_cancel_during_acquire_does_not_leave_the_lease_behind(monkeypatch):
    async def scenario():
        db = _FakeDb()
        db.mutation_locks = _CommitThenStall()

        async def holder():
            async with mutation_lock(db, "resource-1", wait_seconds=0, lease_seconds=30):
                pass

        task = asyncio.create_task(holder())
        await db.mutation_locks.committed.wait()
        assert db.mutation_locks.document is not None
        task.cancel()
        await asyncio.wait([task])
        assert task.cancelled(), "die Aufgabe endet durch den Abbruch"
        assert db.mutation_locks.document is None, "die gerade erworbene Sperre wird wieder freigegeben"

    _run_virtual(monkeypatch, scenario)


def test_error_after_the_upsert_does_not_leave_the_lease_behind(monkeypatch):
    async def scenario():
        db = _FakeDb()
        db.mutation_locks = _CommitThenStall(error=ConnectionError("antwort verloren"))
        with pytest.raises(ConnectionError):
            async with mutation_lock(db, "resource-1", wait_seconds=0, lease_seconds=30):
                pass
        assert db.mutation_locks.document is None

    _run_virtual(monkeypatch, scenario)


class _BrokenRelease(_FakeMutationLocks):
    def __init__(self, hang=False):
        super().__init__()
        self.hang = hang

    async def delete_one(self, query):
        if self.hang:
            await asyncio.Event().wait()
        raise ConnectionError("freigabe gescheitert")


@pytest.mark.parametrize("hang", [False, True], ids=["fehler", "haenger"])
def test_failed_release_after_a_loss_still_reports_the_loss(monkeypatch, caplog, hang):
    async def scenario():
        db = _FakeDb()
        db.mutation_locks = _BrokenRelease(hang=hang)
        with caplog.at_level("WARNING", logger="tls.mutation_lock"):
            with pytest.raises(MutationLockLost):
                async with mutation_lock(db, "resource-1", wait_seconds=0, lease_seconds=30):
                    db.mutation_locks.document["owner"] = "anderer-worker"
                    await asyncio.Event().wait()
        assert any("freigegeben" in record.getMessage() for record in caplog.records)

    _run_virtual(monkeypatch, scenario)


@pytest.mark.parametrize("hang", [False, True], ids=["fehler", "haenger"])
def test_failed_release_after_success_is_only_logged(monkeypatch, caplog, hang):
    async def scenario():
        db = _FakeDb()
        db.mutation_locks = _BrokenRelease(hang=hang)
        with caplog.at_level("WARNING", logger="tls.mutation_lock"):
            async with mutation_lock(db, "resource-1", wait_seconds=0, lease_seconds=30):
                pass
        assert any("freigegeben" in record.getMessage() for record in caplog.records)

    _run_virtual(monkeypatch, scenario)


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
        # Der Abbruch kommt beim Erneuern bzw. spätestens beim Abbruch-Zeitgeber - beide vor dem Ende dieser Wartezeit.
        await asyncio.sleep(5)
        writes.append("nach dem Verlust")
        return {"ok": True}

    response = TestClient(app).post("/write")
    assert response.status_code == 409
    assert writes == []
