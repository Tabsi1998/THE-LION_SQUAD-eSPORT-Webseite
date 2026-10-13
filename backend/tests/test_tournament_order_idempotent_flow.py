"""Rechnungsauftrag zum Startgeld ohne Lücke (#1184, Codex-Prüfung): Anmeldung, Preis und Auftrag werden nacheinander
gespeichert. Bricht der Auftrag danach ab, holt die Wiederholung derselben Anmeldung ihn nach - genau einmal. Ein
eingefrorener Preis ergibt auch bei gleichzeitigen Anfragen höchstens einen Auftrag (eindeutiger ``booking_key``)."""
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
from services import billing_orders, pricing  # noqa: E402
from test_billing_invoice_terms_flow import person  # noqa: E402

FEE = {"enabled": True, "positions": [{"key": "startgeld", "label": "Startgeld", "amount": "10", "basis": "per_person"}]}
BODY = {"accept_rules": True, "accept_privacy": True, "accept_costs": True}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await database.init_audit_indexes(instance.db)
        yield instance
    finally:
        await shutdown()


async def paid_cup(flow, *, event=None):
    admin = await person(flow, "chef", role="superadmin")
    flow.act_as(admin)
    await flow.db.games.insert_one({"id": "g1", "name": "Rocket League", "slug": "rocket-league"})
    response = await flow.post("/api/tournaments", json={
        "title": "LAN-Cup", "game_id": "g1", "status": "registration_open", "visibility": "public", "is_public": True, "format": "single_elim",
        "team_mode": "solo", "team_size": 1, "max_participants": 8, "start_date": (now_utc() + timedelta(days=10)).isoformat(), "billing": FEE,
        **({"event_id": event["id"]} if event else {}),
    })
    assert response.status_code == 200, response.text
    return admin, response.json()


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
    return await flow.db.billing_orders.find({"user_id": user["id"], "kind": "tournament"}, {"_id": 0}).to_list(20)


@pytest.mark.asyncio
async def test_a_failed_order_is_created_exactly_once_by_the_retry(flow, monkeypatch):
    _, cup = await paid_cup(flow)
    paula = await person(flow, "paula")
    fail_once(monkeypatch)
    flow.act_as(paula)
    with pytest.raises(RuntimeError):
        await flow.post(f"/api/tournaments/{cup['id']}/register", json=BODY)
    reg = await flow.db.tournament_registrations.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert reg["status"] == "approved" and reg["price_snapshot"]["total_cents"] == 1000
    assert await orders(flow, paula) == [], "die Lücke: Anmeldung und Preis da, Auftrag fehlt"

    retry = await flow.post(f"/api/tournaments/{cup['id']}/register", json=BODY)
    assert retry.status_code == 200, retry.text
    assert retry.json()["idempotent_replay"] is True and retry.json()["order_repaired"] is True
    again = await flow.post(f"/api/tournaments/{cup['id']}/register", json=BODY)
    assert again.json()["order_repaired"] is False
    rows = await orders(flow, paula)
    assert len(rows) == 1 and rows[0]["total_cents"] == 1000 and rows[0]["status"] == "pending"
    assert rows[0]["booking_key"] == f"tournament:{reg['id']}:{reg['price_snapshot']['hash']}"


@pytest.mark.asyncio
async def test_switching_the_fee_off_after_the_gap_still_repairs_the_frozen_price(flow, monkeypatch):
    """Codex-Prüfung #1500: mit eingefrorenem Preis zählt nur dieser, nicht das heutige Startgeld. Gegenprobe: ohne
    eingefrorenen Preis friert ein abgeschaltetes Startgeld nichts mehr ein."""
    _, cup = await paid_cup(flow)
    paula = await person(flow, "paula")
    other = await person(flow, "other")
    fail_once(monkeypatch)
    flow.act_as(paula)
    with pytest.raises(RuntimeError):
        await flow.post(f"/api/tournaments/{cup['id']}/register", json=BODY)
    await flow.db.tournaments.update_one({"id": cup["id"]}, {"$set": {"billing.enabled": False, "billing.positions": []}})
    retry = await flow.post(f"/api/tournaments/{cup['id']}/register", json=BODY)
    assert retry.json()["order_repaired"] is True
    rows = await orders(flow, paula)
    assert len(rows) == 1 and rows[0]["total_cents"] == 1000
    assert (await flow.post(f"/api/tournaments/{cup['id']}/register", json=BODY)).json()["order_repaired"] is False

    await flow.db.tournament_registrations.insert_one({"id": "r-other", "identity_key": f"{cup['id']}:user:{other['id']}", "tournament_id": cup["id"],
                                                       "user_id": other["id"], "status": "approved", "registration_type": "solo", "costs_accepted_by": other["id"]})
    flow.act_as(other)
    assert (await flow.post(f"/api/tournaments/{cup['id']}/register", json=BODY)).json()["order_repaired"] is False
    assert await orders(flow, other) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("frozen, today, status", [("manual", "on_confirm", "held"), ("on_confirm", "manual", "pending")])
async def test_the_repaired_order_keeps_the_invoice_timing_of_the_frozen_price(flow, monkeypatch, frozen, today, status):
    """Codex-Prüfung #1500 (2): Startgeld - der Rechnungszeitpunkt wird mit dem Preis eingefroren und gilt beim
    Nachholen, auch wenn die Einstellung inzwischen gewechselt hat (in beide Richtungen)."""
    _, cup = await paid_cup(flow)
    await flow.db.tournaments.update_one({"id": cup["id"]}, {"$set": {"billing.invoice_timing": frozen}})
    paula = await person(flow, "paula")
    fail_once(monkeypatch)
    flow.act_as(paula)
    with pytest.raises(RuntimeError):
        await flow.post(f"/api/tournaments/{cup['id']}/register", json=BODY)
    reg = await flow.db.tournament_registrations.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert reg["price_snapshot"]["invoice_timing"] == frozen
    await flow.db.tournaments.update_one({"id": cup["id"]}, {"$set": {"billing.invoice_timing": today}})
    assert (await flow.post(f"/api/tournaments/{cup['id']}/register", json=BODY)).json()["order_repaired"] is True
    rows = await orders(flow, paula)
    assert len(rows) == 1 and rows[0]["timing"] == frozen and rows[0]["status"] == status


@pytest.mark.asyncio
async def test_without_frozen_price_the_retry_freezes_it_for_the_payer_only(flow):
    _, cup = await paid_cup(flow)
    paula = await person(flow, "paula")
    other = await person(flow, "other")
    # Abbruch vor dem Einfrieren: die Anmeldung steht, Preis und Auftrag fehlen.
    for user, accepted in ((paula, paula["id"]), (other, None)):
        await flow.db.tournament_registrations.insert_one({"id": f"r-{user['username']}", "identity_key": f"{cup['id']}:user:{user['id']}", "tournament_id": cup["id"],
                                                           "user_id": user["id"], "status": "approved", "registration_type": "solo", "costs_accepted_by": accepted})
    flow.act_as(paula)
    assert (await flow.post(f"/api/tournaments/{cup['id']}/register", json=BODY)).json()["order_repaired"] is True
    assert len(await orders(flow, paula)) == 1
    flow.act_as(other)
    assert (await flow.post(f"/api/tournaments/{cup['id']}/register", json=BODY)).json()["order_repaired"] is False
    assert await orders(flow, other) == [], "ohne übernommene Kosten keine Rechnung"


@pytest.mark.asyncio
async def test_play_along_retry_counts_the_repaired_order_in_the_sum(flow, monkeypatch):
    admin = await person(flow, "chef", role="superadmin")
    flow.act_as(admin)
    created = await flow.post("/api/events", json={"name": "Vereins-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
                                                    "start_date": (now_utc() + timedelta(days=10)).isoformat()})
    event = created.json()
    _, cup = await paid_cup(flow, event=event)
    paula = await person(flow, "paula")
    flow.act_as(paula)
    assert (await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})).status_code == 200
    fail_once(monkeypatch)
    first = (await flow.post(f"/api/events/{event['id']}/play-along", json={**BODY, "tournament_ids": [cup["id"]]})).json()
    assert first["results"][0]["state"] == "error" and first["total_cents"] == 0
    second = (await flow.post(f"/api/events/{event['id']}/play-along", json={**BODY, "tournament_ids": [cup["id"]]})).json()
    assert second["results"][0]["state"] == "already" and second["results"][0]["price"]["total_cents"] == 1000
    assert second["total_cents"] == 1000 == sum(order["total_cents"] for order in await orders(flow, paula))
    third = (await flow.post(f"/api/events/{event['id']}/play-along", json={**BODY, "tournament_ids": [cup["id"]]})).json()
    assert third["total_cents"] == 0 and len(await orders(flow, paula)) == 1


class _Racing:
    """Lässt zwei gleichzeitige Aufträge an der Vorprüfung vorbeilaufen - wie zwei Server-Anfragen im selben Moment."""

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
        self.billing_orders = _Racing(db.billing_orders)


@pytest.mark.asyncio
async def test_simultaneous_orders_for_the_same_price_end_up_as_one(flow):
    snapshot = pricing.snapshot({"currency": "EUR", "positions": [], "total_cents": 1000}, recipient={"id": "u1"}, source={"kind": "tournament"})
    racing = _RacingDb(flow.db)
    kwargs = {"kind": "tournament", "source_id": "t1", "registration_id": "r1", "user_id": "u1", "snapshot": snapshot, "timing": "on_confirm"}
    await asyncio.gather(billing_orders.create_order(racing, **kwargs), billing_orders.create_order(racing, **kwargs))
    assert await flow.db.billing_orders.count_documents({"registration_id": "r1"}) == 1
    # Ein neuer Preis (nach Storno neu bestätigt) bekommt weiter seinen eigenen Auftrag.
    await flow.db.billing_orders.update_many({"registration_id": "r1"}, {"$set": {"status": "cancelled"}})
    fresh = pricing.snapshot({"currency": "EUR", "positions": [], "total_cents": 1000}, recipient={"id": "u2"}, source={"kind": "tournament"})
    await billing_orders.create_order(flow.db, **{**kwargs, "snapshot": fresh})
    assert await flow.db.billing_orders.count_documents({"registration_id": "r1"}) == 2


@pytest.mark.asyncio
async def test_parallel_registrations_create_one_registration_and_one_order(flow):
    _, cup = await paid_cup(flow)
    paula = await person(flow, "paula")
    flow.act_as(paula)
    answers = await asyncio.gather(*(flow.post(f"/api/tournaments/{cup['id']}/register", json=BODY) for _ in range(3)))
    assert all(answer.status_code in (200, 409) for answer in answers), [answer.text for answer in answers]
    assert await flow.db.tournament_registrations.count_documents({"user_id": paula["id"]}) == 1
    assert len(await orders(flow, paula)) == 1
