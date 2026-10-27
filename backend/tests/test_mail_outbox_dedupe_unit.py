"""Schlüssel gegen doppelten Versand in der Mail-Warteschlange (#2067, Codex-Befund).

Vorher: erst nachsehen, dann einfügen - zwei gleichzeitige Aufrufe konnten beide einfügen, und der Index auf
``dedupe_key`` war nicht eindeutig. Jetzt: ein eindeutiger Index nur für Zeilen mit Schlüssel und ein Upsert mit
``$setOnInsert``; ein ``DuplicateKeyError`` aus einem Wettlauf zählt als „schon da“.
"""
import asyncio
import pathlib
import sys

import pytest
from mongomock_motor import AsyncMongoMockClient
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import database  # noqa: E402
from services import mail_outbox  # noqa: E402


@pytest.fixture
def db(monkeypatch):
    instance = AsyncMongoMockClient()["outbox"]
    monkeypatch.setattr(mail_outbox, "get_db", lambda: instance)
    asyncio.run(database.init_audit_indexes(instance))
    return instance


def enqueue(**kwargs):
    return asyncio.run(mail_outbox.enqueue_mail(to="vorstand@lionsquad-test.at", subject="Hallo", html="<p>x</p>", **kwargs))


def test_same_key_queues_once(db):
    first = enqueue(dedupe_key="contact:1:admin")
    second = enqueue(dedupe_key="contact:1:admin")
    assert first.get("deduped") is None and second["deduped"] is True and second["id"] == first["id"]
    assert asyncio.run(db.mail_jobs.count_documents({})) == 1


def test_mails_without_key_never_collide(db):
    for _ in range(3):
        enqueue()
    asyncio.run(db.mail_jobs.insert_one({"id": "alt", "to": "x@lionsquad-test.at", "dedupe_key": None}))
    assert asyncio.run(db.mail_jobs.count_documents({})) == 4


def test_an_empty_key_means_no_key_and_never_collides(db):
    enqueue(dedupe_key="")
    enqueue(dedupe_key="")
    assert asyncio.run(db.mail_jobs.count_documents({})) == 2
    assert asyncio.run(db.mail_jobs.count_documents({"dedupe_key": ""})) == 0


def test_the_index_refuses_a_second_row_with_the_same_key(db):
    asyncio.run(db.mail_jobs.insert_one({"id": "a", "dedupe_key": "k"}))
    with pytest.raises(DuplicateKeyError):
        asyncio.run(db.mail_jobs.insert_one({"id": "b", "dedupe_key": "k"}))


def test_a_lost_race_counts_as_already_queued(db, monkeypatch):
    asyncio.run(db.mail_jobs.insert_one({"id": "gewinner", "dedupe_key": "contact:2:admin", "status": "pending"}))

    class Racing:
        """Wie ein zweiter Prozess, der gleichzeitig upsertet: der Index lehnt ab."""

        def __getattr__(self, name):
            return getattr(db.mail_jobs, name)

        async def update_one(self, *args, **kwargs):
            raise DuplicateKeyError("E11000 duplicate key")

    class Db:
        mail_jobs = Racing()

    monkeypatch.setattr(mail_outbox, "get_db", lambda: Db())
    result = enqueue(dedupe_key="contact:2:admin")
    assert result == {"ok": True, "id": "gewinner", "deduped": True}
