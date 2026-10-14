"""Rechnungsauftrag nach einem Abbruch ohne Zutun nachholen (#1042).

Anmeldung, Preis und Auftrag werden nacheinander gespeichert. Seit #1490/#1491 holt die Wiederholung derselben
Anmeldung einen fehlenden Auftrag nach. Wer aber nicht wiederholt - die Person ist ja angemeldet, die Verwaltung hat
schon freigegeben oder nachrücken lassen -, bliebe ohne Auftrag. Der Rechnungs-Job holt jeden eingefrorenen Preis ohne
Auftrag selbst nach, genau einmal. Ohne eingefrorenen Preis friert er nichts ein; das bleibt der Anmeldung vorbehalten.
Erfundene Konten."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import database  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import billing_orders, billing_repair  # noqa: E402
from test_billing_invoice_terms_flow import person  # noqa: E402

EVENT_FEE = {"enabled": True, "positions": [{"key": "beitrag", "label": "Kostenbeitrag", "amount": "20", "basis": "per_person"}]}
CUP_FEE = {"enabled": True, "positions": [{"key": "startgeld", "label": "Startgeld", "amount": "10", "basis": "per_person"}]}
CUP_BODY = {"accept_rules": True, "accept_privacy": True, "accept_costs": True}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await database.init_audit_indexes(instance.db)
        await instance.db.event_registrations.create_index([("event_id", 1), ("user_id", 1)], unique=True)
        yield instance
    finally:
        await shutdown()


async def paid_event(flow, admin, **extra):
    flow.act_as(admin)
    response = await flow.post("/api/events", json={
        "name": "Vereins-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
        "start_date": (now_utc() + timedelta(days=10)).isoformat(), "billing": EVENT_FEE, **extra})
    assert response.status_code == 200, response.text
    return response.json()


async def paid_cup(flow, admin):
    flow.act_as(admin)
    await flow.db.games.insert_one({"id": "g1", "name": "Rocket League", "slug": "rocket-league"})
    response = await flow.post("/api/tournaments", json={
        "title": "LAN-Cup", "game_id": "g1", "status": "registration_open", "visibility": "public", "is_public": True, "format": "single_elim",
        "team_mode": "solo", "team_size": 1, "max_participants": 8, "start_date": (now_utc() + timedelta(days=10)).isoformat(), "billing": CUP_FEE})
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


async def orders(flow, user, kind):
    return await flow.db.billing_orders.find({"user_id": user["id"], "kind": kind}, {"_id": 0}).to_list(20)


@pytest.mark.asyncio
async def test_the_job_repairs_an_event_registration_nobody_retries(flow, monkeypatch):
    admin = await person(flow, "chef", role="superadmin")
    event = await paid_event(flow, admin)
    paula = await person(flow, "paula")
    fail_once(monkeypatch)
    flow.act_as(paula)
    with pytest.raises(RuntimeError):
        await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})
    reg = await flow.db.event_registrations.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert reg["price_snapshot"]["total_cents"] == 2000 and await orders(flow, paula, "event") == []

    assert (await billing_repair.repair_missing_orders(flow.db))["repaired"] == 1
    rows = await orders(flow, paula, "event")
    assert len(rows) == 1 and rows[0]["booking_key"] == f"event:{reg['id']}:{reg['price_snapshot']['hash']}"
    assert rows[0]["total_cents"] == 2000 and rows[0]["source_id"] == event["id"]
    # Gegenprobe: ein zweiter Lauf und die Wiederholung der Person legen keinen zweiten an.
    assert (await billing_repair.repair_missing_orders(flow.db))["repaired"] == 0
    assert (await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})).status_code == 409
    assert len(await orders(flow, paula, "event")) == 1


@pytest.mark.asyncio
async def test_the_job_repairs_a_waitlist_promotion_by_the_admin(flow, monkeypatch):
    admin = await person(flow, "chef", role="superadmin")
    event = await paid_event(flow, admin, max_participants=1)
    paula, wanda = await person(flow, "paula"), await person(flow, "wanda")
    for user in (paula, wanda):
        flow.act_as(user)
        assert (await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})).status_code == 200
    first = await flow.db.event_registrations.find_one({"user_id": paula["id"]}, {"_id": 0})
    waiting = await flow.db.event_registrations.find_one({"user_id": wanda["id"]}, {"_id": 0})
    assert waiting["status"] == "waitlist"

    flow.act_as(admin)
    assert (await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"status": "cancelled"})).status_code == 200
    fail_once(monkeypatch)
    with pytest.raises(RuntimeError):
        await flow.patch(f"/api/events/{event['id']}/registrations/{waiting['id']}", json={"status": "registered"})
    promoted = await flow.db.event_registrations.find_one({"id": waiting["id"]}, {"_id": 0})
    assert promoted["status"] == "registered" and promoted["price_snapshot"]["total_cents"] == 2000
    assert await orders(flow, wanda, "event") == []

    assert (await billing_repair.repair_missing_orders(flow.db))["repaired"] == 1
    rows = await orders(flow, wanda, "event")
    assert len(rows) == 1 and rows[0]["booking_key"] == f"event:{waiting['id']}:{promoted['price_snapshot']['hash']}"


@pytest.mark.asyncio
async def test_the_job_repairs_a_tournament_approval_by_staff(flow, monkeypatch):
    admin = await person(flow, "chef", role="superadmin")
    cup = await paid_cup(flow, admin)
    paula = await person(flow, "paula")
    await flow.db.tournament_registrations.insert_one({
        "id": "r-paula", "identity_key": f"{cup['id']}:user:{paula['id']}", "tournament_id": cup["id"], "user_id": paula["id"],
        "status": "pending", "registration_type": "solo", "costs_accepted_by": paula["id"], "created_at": now_utc().isoformat()})
    fail_once(monkeypatch)
    flow.act_as(admin)
    with pytest.raises(RuntimeError):
        await flow.patch(f"/api/tournaments/{cup['id']}/registrations/r-paula", json={"status": "approved"})
    reg = await flow.db.tournament_registrations.find_one({"id": "r-paula"}, {"_id": 0})
    assert reg["status"] == "approved" and reg["price_snapshot"]["total_cents"] == 1000
    assert await orders(flow, paula, "tournament") == []

    assert (await billing_repair.repair_missing_orders(flow.db))["repaired"] == 1
    rows = await orders(flow, paula, "tournament")
    assert len(rows) == 1 and rows[0]["booking_key"] == f"tournament:r-paula:{reg['price_snapshot']['hash']}"
    assert (await billing_repair.repair_missing_orders(flow.db))["repaired"] == 0


@pytest.mark.asyncio
async def test_the_job_leaves_registrations_without_a_gap_alone(flow):
    """Gegenproben: kein eingefrorener Preis (nichts einfrieren), Warteliste, abgemeldet, schon abgerechnet, kostenlos,
    ein stornierter Auftrag zum selben Preis - und eine Anmeldung, deren Auftrag da ist."""
    admin = await person(flow, "chef", role="superadmin")
    event = await paid_event(flow, admin)
    cup = await paid_cup(flow, admin)
    people = {name: await person(flow, name) for name in ("ohnepreis", "warte", "weg", "bezahlt", "gratis", "storno", "fertig")}
    snapshot = {"total_cents": 2000, "currency": "EUR", "hash": "h-1", "invoice_timing": "on_confirm", "recipient": {}}
    rows = [
        ("ohnepreis", "registered", {}),
        ("warte", "waitlist", {"price_snapshot": snapshot, "billing_status": "pending"}),
        ("weg", "cancelled", {"price_snapshot": snapshot, "billing_status": "pending"}),
        ("bezahlt", "registered", {"price_snapshot": snapshot, "billing_status": "invoiced"}),
        ("gratis", "registered", {"price_snapshot": {**snapshot, "total_cents": 0}, "billing_status": "pending"}),
        ("storno", "registered", {"price_snapshot": snapshot, "billing_status": "pending"}),
    ]
    for name, status, extra in rows:
        await flow.db.event_registrations.insert_one({"id": f"e-{name}", "event_id": event["id"], "user_id": people[name]["id"],
                                                      "status": status, "seat_count": 1, **extra})
    await flow.db.billing_orders.insert_one({"id": "o-storno", "booking_key": "event:e-storno:h-1", "kind": "event", "registration_id": "e-storno",
                                             "user_id": people["storno"]["id"], "status": "cancelled", "total_cents": 2000})
    # Turnier: freigegeben, aber ohne eingefrorenen Preis - der Job friert nichts ein.
    await flow.db.tournament_registrations.insert_one({"id": "t-ohnepreis", "tournament_id": cup["id"], "user_id": people["ohnepreis"]["id"],
                                                       "status": "approved", "registration_type": "solo", "costs_accepted_by": people["ohnepreis"]["id"]})
    # Mit Auftrag: nichts zu tun.
    flow.act_as(people["fertig"])
    assert (await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})).status_code == 200

    before = await flow.db.billing_orders.count_documents({})
    result = await billing_repair.repair_missing_orders(flow.db)
    assert result["repaired"] == 0, result
    assert await flow.db.billing_orders.count_documents({}) == before
    assert (await flow.db.tournament_registrations.find_one({"id": "t-ohnepreis"}, {"_id": 0})).get("price_snapshot") is None


@pytest.mark.asyncio
async def test_one_broken_row_does_not_stop_the_others(flow, monkeypatch):
    admin = await person(flow, "chef", role="superadmin")
    event = await paid_event(flow, admin)
    paula, wanda = await person(flow, "paula"), await person(flow, "wanda")
    snapshot = {"total_cents": 2000, "currency": "EUR", "invoice_timing": "on_confirm", "recipient": {}}
    for user, digest in ((paula, "h-p"), (wanda, "h-w")):
        await flow.db.event_registrations.insert_one({"id": f"e-{user['username']}", "event_id": event["id"], "user_id": user["id"],
                                                      "status": "registered", "seat_count": 1, "billing_status": "pending",
                                                      "price_snapshot": {**snapshot, "hash": digest}})
    fail_once(monkeypatch)
    first = await billing_repair.repair_missing_orders(flow.db)
    assert (first["repaired"], first["errors"]) == (1, 1)
    second = await billing_repair.repair_missing_orders(flow.db)
    assert (second["repaired"], second["errors"]) == (1, 0)
    assert len(await orders(flow, paula, "event")) == 1 and len(await orders(flow, wanda, "event")) == 1


@pytest.mark.asyncio
async def test_the_billing_job_repairs_before_it_sorts(monkeypatch, flow):
    from services import scheduler

    calls = []

    async def repair(db, *args, **kwargs):
        calls.append("repair")
        return {"looked": 0, "repaired": 0, "errors": 0}

    async def classify(*args, **kwargs):
        calls.append("classify")
        return {"looked": 0}

    monkeypatch.setattr(billing_repair, "repair_missing_orders", repair)
    monkeypatch.setattr(billing_orders, "classify_due", classify)
    await scheduler._safe_billing_orders()
    assert calls == ["repair", "classify"]
