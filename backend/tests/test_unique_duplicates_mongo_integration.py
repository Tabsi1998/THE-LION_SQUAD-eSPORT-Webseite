"""Altdubletten gegen ein echtes MongoDB (#1043, Codex-Prüfung): ``$ifNull`` in ``$group``, ``partialFilterExpression``
und das Anlegen des eindeutigen Index - das prüft mongomock nicht verlässlich.

Läuft nur mit ``TLS_MONGO_INTEGRATION_URL`` (eine Wegwerf-Instanz, etwa ``docker run --rm -p 27018:27017 mongo:7``).
Nicht ``MONGO_URL``: die CI setzt sie, hat aber keinen MongoDB-Dienst. Jeder Test legt eine eigene Datenbank an und
löscht sie danach.
"""
import asyncio
import os
import uuid

import pytest
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError

import database
from services import unique_duplicates

URL = os.environ.get("TLS_MONGO_INTEGRATION_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="TLS_MONGO_INTEGRATION_URL fehlt - kein echtes MongoDB")


def scenario(body):
    async def wrapped():
        client = AsyncIOMotorClient(URL, serverSelectionTimeoutMS=3000)
        name = f"tls_dubletten_{uuid.uuid4().hex[:8]}"
        try:
            await body(client[name])
        finally:
            await client.drop_database(name)
            client.close()
    asyncio.run(wrapped())


def test_missing_and_null_keys_group_together_and_the_index_follows():
    async def body(db):
        await db.user_xp.insert_many([{"total": 1}, {"user_id": None, "total": 2}, {"user_id": "u1"}, {"user_id": "u1"}])
        assert "user_xp.user" in (await database.init_audit_indexes(db))["blocked"]
        report = {row["index"]: row for row in await unique_duplicates.plan(db)}
        assert report["user_xp.user"]["groups"] == 2 and report["user_xp.user"]["surplus"] == 2
        protocol = await unique_duplicates.apply(db, actor="test", only={"user_xp.user"})
        assert protocol["indexes"][0]["removed"] == 2 and protocol["indexes"][0]["unique_active"] is True
        assert "user_unique" in await db.user_xp.index_information()
        with pytest.raises(DuplicateKeyError):
            await db.user_xp.insert_one({"user_id": "u1"})
    scenario(body)


def test_the_partial_filter_is_respected():
    async def body(db):
        await db.billing_orders.insert_many([{"booking_key": "k1"}, {"booking_key": "k1"}, {"status": "a"}, {"status": "b"}])
        await db.platform_links.insert_many([
            {"platform": "steam", "user_id": "u1"}, {"platform": "steam", "user_id": "u2"},
            {"platform": "discord", "external_id": "42", "user_id": "u1"},
            {"platform": "discord", "external_id": "42", "user_id": "u2"},
        ])
        await database.init_audit_indexes(db)
        report = {row["index"]: row for row in await unique_duplicates.plan(db)}
        assert report["billing_orders.booking_key"]["groups"] == 1 and report["billing_orders.booking_key"]["surplus"] == 1
        assert report["platform_links.platform_external"]["groups"] == 1
        await unique_duplicates.apply(db, actor="test")
        assert await db.billing_orders.count_documents({}) == 4 and await db.platform_links.count_documents({}) == 4
    scenario(body)
