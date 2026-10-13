"""Rechnungsauftrag zur Event-Anmeldung ohne Lücke (#1491): Anmeldung, Preis und Auftrag werden nacheinander gespeichert.
Bricht der Auftrag danach ab, holt die Wiederholung derselben Anmeldung ihn nach - genau einmal, auch bei gleichzeitigen
Wiederholungen. Gegenproben: ohne Lücke, auf der Warteliste, kostenlos oder schon abgerechnet entsteht nichts."""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import database  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import billing_orders, event_registration  # noqa: E402
from test_billing_invoice_terms_flow import person  # noqa: E402

FEE = {"enabled": True, "positions": [{"key": "beitrag", "label": "Kostenbeitrag", "amount": "20", "basis": "per_person"}]}
TAKEN = "Du bist für dieses Event bereits angemeldet"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await database.init_audit_indexes(instance.db)
        await instance.db.event_registrations.create_index([("event_id", 1), ("user_id", 1)], unique=True)
        yield instance
    finally:
        await shutdown()


async def paid_event(flow, admin=None, **extra):
    admin = admin or await person(flow, "chef", role="superadmin")
    flow.act_as(admin)
    payload = {"name": "Vereins-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
               "start_date": (now_utc() + timedelta(days=10)).isoformat(), "billing": FEE, **extra}
    response = await flow.post("/api/events", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def fail_once(monkeypatch):
    real = billing_orders.create_order
    calls = {"n": 0}

    async def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("Datenbank kurz weg")
        return await real(*args, **kwargs)

    monkeypatch.setattr(billing_orders, "create_order", flaky)
    return calls


async def orders(flow, user):
    return await flow.db.billing_orders.find({"user_id": user["id"], "kind": "event"}, {"_id": 0}).to_list(20)


async def register(flow, event):
    return await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})


@pytest.mark.asyncio
async def test_a_failed_order_is_created_exactly_once_by_the_retry(flow, monkeypatch):
    event = await paid_event(flow)
    paula = await person(flow, "paula")
    fail_once(monkeypatch)
    flow.act_as(paula)
    with pytest.raises(RuntimeError):
        await register(flow, event)
    reg = await flow.db.event_registrations.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert reg["status"] == "registered" and reg["price_snapshot"]["total_cents"] == 2000 and reg["billing_status"] == "pending"
    assert await orders(flow, paula) == [], "die Lücke: Anmeldung und Preis da, Auftrag fehlt"

    retry = await register(flow, event)
    assert retry.status_code == 409 and retry.json()["detail"] == TAKEN, "die Wiederholung bleibt „bereits angemeldet“"
    rows = await orders(flow, paula)
    assert len(rows) == 1 and rows[0]["total_cents"] == 2000 and rows[0]["status"] == "pending"
    assert rows[0]["booking_key"] == f"event:{reg['id']}:{reg['price_snapshot']['hash']}"
    assert rows[0]["user_id"] == paula["id"] and rows[0]["source_id"] == event["id"]

    # Gegenprobe: die nächste Wiederholung legt keinen zweiten an.
    assert (await register(flow, event)).status_code == 409
    assert len(await orders(flow, paula)) == 1


@pytest.mark.asyncio
async def test_parallel_retries_repair_the_order_only_once(flow, monkeypatch):
    event = await paid_event(flow)
    paula = await person(flow, "paula")
    fail_once(monkeypatch)
    flow.act_as(paula)
    with pytest.raises(RuntimeError):
        await register(flow, event)
    answers = await asyncio.gather(*(register(flow, event) for _ in range(4)))
    assert [answer.status_code for answer in answers] == [409] * 4
    assert len(await orders(flow, paula)) == 1


@pytest.mark.asyncio
async def test_parallel_first_registrations_create_one_registration_and_one_order(flow):
    event = await paid_event(flow)
    paula = await person(flow, "paula")
    flow.act_as(paula)
    answers = await asyncio.gather(*(register(flow, event) for _ in range(3)))
    assert sorted(answer.status_code for answer in answers)[0] == 200
    assert all(answer.status_code in (200, 409) for answer in answers), [answer.text for answer in answers]
    assert await flow.db.event_registrations.count_documents({"user_id": paula["id"]}) == 1
    assert len(await orders(flow, paula)) == 1


class _Racing:
    """Lässt zwei gleichzeitige Anmeldungen an der Vorprüfung vorbeilaufen - wie zwei Server-Anfragen im selben Moment."""

    def __init__(self, collection):
        self._collection = collection
        self._inserting = False

    async def find_one(self, *args, **kwargs):
        if self._inserting:
            return await self._collection.find_one(*args, **kwargs)
        await asyncio.sleep(0)
        return None

    async def insert_one(self, document):
        self._inserting = True
        await asyncio.sleep(0)
        return await self._collection.insert_one(document)

    def __getattr__(self, name):
        return getattr(self._collection, name)


class _RacingDb:
    def __init__(self, db):
        self._db = db
        self.event_registrations = _Racing(db.event_registrations)

    def __getattr__(self, name):
        return getattr(self._db, name)


@pytest.mark.asyncio
async def test_simultaneous_registrations_past_the_check_end_up_as_one_with_one_order(flow):
    """Beide Anfragen sehen noch keine Anmeldung: der eindeutige Index lässt eine durch, die andere wird „bereits
    angemeldet“ statt eines Serverfehlers - und es bleibt bei einem Auftrag."""
    event = await paid_event(flow)
    stored = await flow.db.events.find_one({"id": event["id"]}, {"_id": 0})
    paula = await person(flow, "paula")
    racing = _RacingDb(flow.db)
    results = await asyncio.gather(*(event_registration.register(racing, stored, paula) for _ in range(2)), return_exceptions=True)
    errors = [r for r in results if isinstance(r, Exception)]
    assert len(errors) == 1 and isinstance(errors[0], event_registration.RegistrationError) and errors[0].status == 409, results
    assert await flow.db.event_registrations.count_documents({"user_id": paula["id"]}) == 1
    assert len(await orders(flow, paula)) == 1


@pytest.mark.asyncio
async def test_no_repair_without_a_gap(flow):
    """Gegenproben: Warteliste (noch kein Preis), schon abgerechnet und kostenlos bekommen keinen Auftrag nachgelegt."""
    event = await paid_event(flow, max_participants=1)
    paula = await person(flow, "paula")
    wanda = await person(flow, "wanda")
    flow.act_as(paula)
    assert (await register(flow, event)).status_code == 200
    flow.act_as(wanda)
    assert (await register(flow, event)).json()["status"] == "waitlist"
    assert (await register(flow, event)).status_code == 409
    assert await orders(flow, wanda) == [], "Warteliste: Preis erst beim Nachrücken"

    # Abgerechnet: der Auftrag ist erledigt und wurde danach (z. B. beim Aufräumen) entfernt - kein neuer.
    await flow.db.event_registrations.update_one({"user_id": paula["id"]}, {"$set": {"billing_status": "invoiced"}})
    await flow.db.billing_orders.delete_many({"user_id": paula["id"]})
    flow.act_as(paula)
    assert (await register(flow, event)).status_code == 409
    assert await orders(flow, paula) == []

    chef = await flow.db.users.find_one({"username": "chef"}, {"_id": 0}) or await person(flow, "chef2", role="superadmin")
    free = await paid_event(flow, chef, billing={"enabled": False, "positions": []}, name="Gratis-LAN")
    flow.act_as(paula)
    assert (await register(flow, free)).status_code == 200
    assert (await register(flow, free)).status_code == 409
    assert await flow.db.billing_orders.count_documents({"source_id": free["id"]}) == 0


@pytest.mark.asyncio
async def test_a_cancelled_order_for_the_same_price_is_not_revived(flow):
    """Die Verwaltung hat den Auftrag zum selben Preis storniert: die Wiederholung legt ihn nicht still neu an."""
    event = await paid_event(flow)
    paula = await person(flow, "paula")
    flow.act_as(paula)
    assert (await register(flow, event)).status_code == 200
    await flow.db.billing_orders.update_many({"user_id": paula["id"]}, {"$set": {"status": "cancelled"}})
    assert (await register(flow, event)).status_code == 409
    rows = await orders(flow, paula)
    assert len(rows) == 1 and rows[0]["status"] == "cancelled"
