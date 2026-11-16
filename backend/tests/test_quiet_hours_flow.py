"""Ruhezeit (#1206) auf der echten Datenbank-Schicht: Zurückhalten, Umstempeln und genau eine Sammelmeldung - mit
``FLOW_MONGO_URL`` gegen echtes MongoDB samt Sparse-Index ``quiet_hold_until`` und eindeutigem Teilindex
``user_unique_dedupe`` (docs/entwicklung/abnahme-lokal.md, Abschnitt 7)."""
import pathlib
import sys
from datetime import datetime, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow

from services import quiet_hours
from services.user_notifications import create_user_notification

NIGHT = {"enabled": True, "start": "22:00", "end": "07:00"}


def _utc(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _held(flow, monkeypatch, user_id, when, number):
    monkeypatch.setattr("services.quiet_hours.now_utc", lambda: _utc(when))
    return await create_user_notification(user_id, f"Meldung {number}", kind="tournament_registration",
                                          meta={"category": "tournament_updates", "dedupe_key": f"n{number}", "tournament_id": f"t{number}"})


@pytest.mark.asyncio
async def test_extended_night_one_digest_on_the_real_database(flow, monkeypatch):
    anna = await flow.add_user(name="anna")
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"quiet_hours": NIGHT}})
    await _held(flow, monkeypatch, anna["id"], "2026-11-16T22:00:00", 1)
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"quiet_hours.end": "08:00"}})
    await _held(flow, monkeypatch, anna["id"], "2026-11-17T00:00:00", 2)
    rows = await flow.db.notifications.find({"user_id": anna["id"]}, {"_id": 0}).to_list(10)
    assert sorted(row["quiet_hold_until"] for row in rows) == ["2026-11-17T06:00:00+00:00", "2026-11-17T07:00:00+00:00"]
    assert all(row["in_app_visible"] is True and row["quiet_held_channels"] == ["push"] for row in rows)

    early = await quiet_hours.release_due(flow.db, _utc("2026-11-17T06:00:00"))
    assert (early["released"], early["digests"], early["restamped"]) == (0, 0, 1)
    done = await quiet_hours.release_due(flow.db, _utc("2026-11-17T07:00:00"))
    assert (done["released"], done["digests"]) == (2, 1)
    again = await quiet_hours.release_due(flow.db, _utc("2026-11-17T07:05:00"))
    assert (again["released"], again["digests"]) == (0, 0)
    digests = await flow.db.notifications.find({"user_id": anna["id"], "kind": "quiet_digest"}, {"_id": 0}).to_list(10)
    assert len(digests) == 1 and digests[0]["title"] == "In der Nacht: 2 Meldungen"
    assert digests[0]["in_app_visible"] is False
    assert await flow.db.notifications.count_documents({"quiet_hold_until": {"$exists": True}}) == 0


@pytest.mark.asyncio
async def test_the_digest_key_holds_off_a_second_insert(flow, monkeypatch):
    """Der eindeutige Teilindex lässt je Person und Schlüssel nur eine Sammelmeldung zu - auf echtem MongoDB."""
    anna = await flow.add_user(name="anna")
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"quiet_hours": NIGHT}})
    await _held(flow, monkeypatch, anna["id"], "2026-11-16T22:00:00", 1)
    user = await flow.db.users.find_one({"id": anna["id"]}, {"_id": 0})
    rows = await flow.db.notifications.find({"user_id": anna["id"]}, {"_id": 0}).to_list(10)
    first = await quiet_hours._send_digest(flow.db, user, "quiet_digest:probe", rows[0]["quiet_hold_until"], rows, {"push"})
    second = await quiet_hours._send_digest(flow.db, user, "quiet_digest:probe", rows[0]["quiet_hold_until"], rows, {"push"})
    assert first is True
    # Der Index steht nur auf echtem MongoDB (mongomock legt ihn nicht an) - dort darf es keine zweite geben.
    if flow.real_mongo:
        assert second is False
        assert await flow.db.notifications.count_documents({"kind": "quiet_digest"}) == 1
        indexes = await flow.db.notifications.index_information()
        assert any(index.get("key") == [("quiet_hold_until", 1)] and index.get("sparse") for index in indexes.values())
