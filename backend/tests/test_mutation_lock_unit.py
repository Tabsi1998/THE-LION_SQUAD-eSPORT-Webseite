import asyncio
from datetime import datetime, timedelta, timezone
import pathlib
import sys

import pytest
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource


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
            lease_seconds=0.03,
        ):
            first_expiry = db.mutation_locks.document["expires_at"]
            await asyncio.sleep(0.02)
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
