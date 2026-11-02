"""Läuft die Harness wirklich auf echtem MongoDB? (#2200). Ohne ``FLOW_MONGO_URL`` gibt es hier nichts zu prüfen.

Deshalb der Skip: Diese Datei sagt etwas über den Server aus, den mongomock nicht hat - Indizes und ihre Wirkung.
``scripts/flow_mongo_tests.py`` startet ohne die Variable gar nicht erst, im CI-Job läuft sie also immer.
"""
from __future__ import annotations

import asyncio
import pathlib
import re
import sys

import pytest
import pytest_asyncio
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import flow_mongo  # noqa: E402
from flow_harness import make_flow  # noqa: E402

pytestmark = pytest.mark.skipif(not flow_mongo.configured_url(), reason="prüft nur den Lauf gegen echtes MongoDB (FLOW_MONGO_URL)")


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_the_database_has_a_test_name_and_the_real_indexes(flow):
    assert flow.db.name.startswith(flow_mongo.DB_PREFIX)
    compose = (pathlib.Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(encoding="utf-8")
    assert (await flow.db.command("buildInfo"))["version"] == re.search(r"image: mongo:([\d.]+)", compose).group(1)

    users = await flow.db.users.index_information()
    assert any(spec.get("unique") and spec["key"] == [("email", 1)] for spec in users.values())
    pools = await flow.db.map_pools.index_information()
    assert any(spec.get("unique") and spec["key"] == [("scope", 1), ("scope_id", 1), ("version", -1)] for spec in pools.values())


@pytest.mark.asyncio
async def test_unique_indexes_bite(flow):
    user = await flow.add_user()
    with pytest.raises(DuplicateKeyError):
        await flow.db.users.insert_one({"id": "zweiter", "username": "anders", "email": user["email"]})


@pytest.mark.asyncio
async def test_the_mutation_lock_is_exclusive_across_concurrent_writers(flow):
    from services.mutation_lock import MutationLockBusy, mutation_lock

    order: list[str] = []

    async def holder():
        async with mutation_lock(flow.db, "tournament:probe:write", wait_seconds=0):
            order.append("gesperrt")
            await asyncio.sleep(0.3)
            order.append("frei")

    async def second():
        await asyncio.sleep(0.1)
        with pytest.raises(MutationLockBusy):
            async with mutation_lock(flow.db, "tournament:probe:write", wait_seconds=0):
                order.append("zweiter darf nicht")

    await asyncio.gather(holder(), second())
    assert order == ["gesperrt", "frei"]
    assert await flow.db.mutation_locks.count_documents({}) == 0, "die Sperre gibt sich frei"
    # Zwei gleichzeitige Erstanleger: genau einer gewinnt das Upsert, der Index hält den anderen auf.
    results = await asyncio.gather(*[_try_lock(flow.db) for _ in range(8)])
    assert results.count(True) == 8, "nacheinander kommen alle dran (kurzes Warten)"


async def _try_lock(db) -> bool:
    from services.mutation_lock import mutation_lock

    async with mutation_lock(db, "tournament:rennen:write", wait_seconds=5.0, retry_seconds=0.01):
        rows = await db.mutation_locks.count_documents({"resource": "tournament:rennen:write"})
        assert rows == 1
        await asyncio.sleep(0.01)
    return True


@pytest.mark.asyncio
async def test_every_test_starts_empty_with_the_indexes_intact():
    first, shutdown_first = make_flow()
    await first.add_user()
    await first.db.nur_in_diesem_test.insert_one({"id": "x"})
    await shutdown_first()

    second, shutdown_second = make_flow()
    try:
        assert second.db.name == first.db.name, "ein Prozess, eine Datenbank"
        assert await second.db.users.count_documents({}) == 0
        assert "nur_in_diesem_test" not in await second.db.list_collection_names()
        assert any(spec.get("unique") and spec["key"] == [("email", 1)] for spec in (await second.db.users.index_information()).values())
    finally:
        await shutdown_second()


@pytest.mark.asyncio
async def test_a_test_that_changes_indexes_gets_a_rebuilt_database():
    first, shutdown_first = make_flow()
    await first.db.users.drop_index("email_1")
    await shutdown_first()

    second, shutdown_second = make_flow()
    try:
        assert second.db.name != first.db.name
        assert "email_1" in await second.db.users.index_information()
        client = flow_mongo.new_client(flow_mongo.configured_url())
        try:
            assert first.db.name not in await client.list_database_names(), "die alte Datenbank ist weg"
        finally:
            client.close()
    finally:
        await shutdown_second()


def test_the_process_database_is_gone_at_the_end():
    from flow_harness import load_application
    from pymongo import MongoClient

    database, *_rest = load_application()
    url = flow_mongo.configured_url()
    name = flow_mongo.prepare_database(database, url)
    client = MongoClient(url)
    try:
        client[name].probe.insert_one({"id": "x"})
        assert name in client.list_database_names()
        flow_mongo.drop_process_database()
        assert name not in client.list_database_names()
    finally:
        client.close()
