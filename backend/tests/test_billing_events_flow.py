"""Abrechnung I, Teil 1 (#315, #316, #317, #318, #322): Kosten am Event, eingefrorener Preis bei der
Anmeldung, Aufträge im Postfach, Finanzübersicht - ohne dass etwas nach Dolibarr geschrieben wird."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import billing_orders  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def person(flow, name, *, role="player", **fields):
    user = await flow.add_user(role=role, name=name)
    user["email"] = f"{name}@lionsquad-test.at"
    fields = {"email": user["email"], **fields}
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    return user


OFFER = {
    "enabled": True,
    "positions": [
        {"key": "beitrag", "label": "Kostenbeitrag inkl. Essen und Getränke", "amount": "20", "basis": "per_person"},
        {"key": "shirt", "label": "Event-Shirt", "amount": "15", "basis": "per_registration", "optional": True, "dolibarr_product_id": 17},
    ],
}


async def create_event(flow, admin, **extra):
    flow.act_as(admin)
    payload = {"name": "Weihnachtsfeier", "status": "registration_open", "visibility": "members", "has_registration": True,
               "allow_companions": True, "max_companions_per_registration": 3,
               "start_date": (now_utc() + timedelta(days=30)).isoformat(), **extra}
    response = await flow.post("/api/events", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_only_finance_may_set_costs_and_the_public_never_sees_erp_numbers(flow):
    turnierleitung = await person(flow, "tl", role="tournament_admin")
    kassier = await person(flow, "kassier", role="tournament_admin", areas=["finance"])
    event = await create_event(flow, turnierleitung)
    assert event["billing"] == {"enabled": False, "positions": [], "invoice_timing": "on_confirm", "currency": "EUR", "version": 0}, "bestehende Events bleiben kostenlos"

    flow.act_as(turnierleitung)
    denied = await flow.put(f"/api/events/{event['id']}", json={"billing": OFFER})
    assert denied.status_code == 403 and "Finanzen" in denied.json()["detail"]

    flow.act_as(kassier)
    bad = await flow.put(f"/api/events/{event['id']}", json={"billing": {"enabled": True, "positions": [{"label": "x", "amount": "1", "basis": "seats*2"}]}})
    assert bad.status_code in (400, 422)
    ok = await flow.put(f"/api/events/{event['id']}", json={"billing": OFFER})
    assert ok.status_code == 200, ok.text
    stored = await flow.db.events.find_one({"id": event["id"]}, {"_id": 0, "billing": 1})
    assert stored["billing"]["version"] == 1 and stored["billing"]["positions"][0]["amount_cents"] == 2000

    mitglied = await person(flow, "mitglied")
    await flow.db.memberships.insert_one({"id": "m1", "user_id": mitglied["id"], "member_status": "active"})
    await flow.db.users.update_one({"id": mitglied["id"]}, {"$set": {"is_club_member": True}})
    mitglied["is_club_member"] = True
    flow.act_as(mitglied)
    view = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert "billing" not in view, "die Konfiguration mit Dolibarr-Nummern sieht nur Finanzen"
    assert view["offer"]["positions"][0] == {"key": "beitrag", "label": "Kostenbeitrag inkl. Essen und Getränke", "description": "", "amount_cents": 2000, "basis": "per_person", "optional": False}
    assert "dolibarr_product_id" not in view["offer"]["positions"][1]
    flow.act_as(kassier)
    assert (await flow.get(f"/api/events/{event['slug']}")).json()["billing"]["positions"][1]["dolibarr_product_id"] == 17


@pytest.mark.asyncio
async def test_registration_freezes_the_price_and_files_an_order(flow):
    kassier = await person(flow, "kassier", role="club_admin")
    event = await create_event(flow, kassier, billing=OFFER)
    paula = await person(flow, "paula", display_name="Paula B.")
    await flow.db.memberships.insert_one({"id": "m-paula", "user_id": paula["id"], "member_status": "active"})
    paula["is_club_member"] = True
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"is_club_member": True}})

    flow.act_as(paula)
    unknown = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 1, "selected_positions": ["gibt-es-nicht"]})
    assert unknown.status_code == 400
    booked = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 1, "selected_positions": ["shirt"]})
    assert booked.status_code == 200, booked.text
    price = booked.json()["price"]
    assert price["total_cents"] == 2 * 2000 + 1500, "20 € je Person mal zwei, Shirt einmal je Anmeldung"
    assert [p["quantity"] for p in price["positions"]] == [2, 1]
    assert price["billing_status"] == "pending"
    assert all("dolibarr_product_id" not in p for p in price["positions"])

    reg = await flow.db.event_registrations.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert reg["price_snapshot"]["recipient"] == {"user_id": paula["id"], "display_name": "Paula B.", "email": paula["email"]}
    assert reg["price_snapshot"]["offer_version"] == 1
    order = await flow.db.billing_orders.find_one({"registration_id": reg["id"]}, {"_id": 0})
    assert order["status"] == "pending" and order["total_cents"] == 5500 and order["kind"] == "event"

    # Der Kassier erhöht den Preis - Paulas bestätigte Buchung bleibt bei 55 €.
    flow.act_as(kassier)
    dearer = {**OFFER, "positions": [{**OFFER["positions"][0], "amount": "25"}, OFFER["positions"][1]]}
    assert (await flow.put(f"/api/events/{event['id']}", json={"billing": dearer})).status_code == 200
    assert (await flow.db.events.find_one({"id": event["id"]}))["billing"]["version"] == 2
    view = (await flow.get(f"/api/events/{event['slug']}")).json()
    flow.act_as(paula)
    own = (await flow.get(f"/api/events/{event['slug']}")).json()["own_registration"]
    assert own["price"]["total_cents"] == 5500
    # Andere Teilnehmer sehen kein Geld.
    others = [r for r in (await flow.get(f"/api/events/{event['slug']}")).json()["registrations"]]
    assert others and all("price" not in r for r in others)

    # Storno: Auftrag zu, Snapshot bleibt als Verlauf.
    assert (await flow.client.delete(f"/api/events/{event['id']}/registrations/me")).status_code == 200
    order = await flow.db.billing_orders.find_one({"registration_id": reg["id"]}, {"_id": 0})
    assert order["status"] == "cancelled"
    reg = await flow.db.event_registrations.find_one({"id": reg["id"]}, {"_id": 0})
    assert reg["billing_status"] == "cancelled" and reg["price_snapshot"]["total_cents"] == 5500


@pytest.mark.asyncio
async def test_waitlist_gets_its_price_when_promoted_and_seats_change_replaces_the_order(flow):
    kassier = await person(flow, "kassier", role="club_admin")
    event = await create_event(flow, kassier, billing=OFFER, max_participants=1, visibility="public")
    first = await person(flow, "erste")
    second = await person(flow, "zweite")
    flow.act_as(first)
    assert (await flow.post(f"/api/events/{event['id']}/registrations", json={})).json()["status"] == "registered"
    flow.act_as(second)
    waiting = (await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})).json()
    assert waiting["status"] == "waitlist" and "price" not in waiting, "die Warteliste zahlt noch nichts"
    assert await flow.db.billing_orders.count_documents({}) == 1

    flow.act_as(kassier)
    assert (await flow.put(f"/api/events/{event['id']}", json={"max_participants": 5})).status_code == 200
    reg = await flow.db.event_registrations.find_one({"user_id": second["id"]}, {"_id": 0})
    promoted = await flow.put(f"/api/events/{event['id']}/registrations/{reg['id']}", json={"status": "registered"})
    assert promoted.status_code == 200 and promoted.json()["price"]["total_cents"] == 2000
    assert await flow.db.billing_orders.count_documents({"registration_id": reg["id"], "status": "pending"}) == 1

    # Begleitperson dazu, solange kein Beleg da ist: neuer Snapshot, alter Auftrag zu, neuer offen.
    changed = await flow.put(f"/api/events/{event['id']}/registrations/{reg['id']}", json={"companion_count": 1})
    assert changed.json()["price"]["total_cents"] == 4000
    orders = await flow.db.billing_orders.find({"registration_id": reg["id"]}, {"_id": 0}).sort("created_at", 1).to_list(10)
    assert [o["status"] for o in orders] == ["cancelled", "pending"] and orders[1]["total_cents"] == 4000


@pytest.mark.asyncio
async def test_orders_are_sorted_by_what_is_missing_and_finance_sees_it(flow):
    kassier = await person(flow, "kassier", role="club_admin")
    event = await create_event(flow, kassier, billing=OFFER, visibility="public")
    paula = await person(flow, "paula")
    flow.act_as(paula)
    assert (await flow.post(f"/api/events/{event['id']}/registrations", json={})).status_code == 200

    # Nicht angebunden → wartet auf Schreibzugriff, kein Fehler, kein Beleg.
    assert (await billing_orders.classify_due())["not_connected"] == 1
    order = await flow.db.billing_orders.find_one({}, {"_id": 0})
    assert order["status"] == "waiting_write_access" and "nicht angebunden" in order["note"]

    # Angebunden, aber nur Lese-Schlüssel → immer noch kein Schreiben.
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {"id": "dolibarr", "mode": "live", "base_url": "https://erp.example", "api_key": "x"}}, upsert=True)
    assert (await billing_orders.classify_due())["waiting_write_access"] == 1
    # Schreibschlüssel und Schalter → jetzt fehlt der Geschäftspartner der Person.
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {"write_enabled": True, "write_api_key": "y"}})
    assert (await billing_orders.classify_due())["waiting_link"] == 1
    assert (await flow.db.billing_orders.find_one({}, {"_id": 0}))["status"] == "waiting_link"
    assert await flow.db.dolibarr_links.count_documents({}) == 0, "es wird kein Kunde angelegt, ohne dass jemand es freigibt"

    flow.act_as(paula)
    assert (await flow.get("/api/admin/finance/overview")).status_code == 403
    flow.act_as(kassier)
    overview = (await flow.get("/api/admin/finance/overview")).json()
    assert overview["by_status"]["waiting_link"]["count"] == 1
    row = overview["open"][0]
    assert row["person"] == "paula" and row["source"]["name"] == "Weihnachtsfeier" and row["total"] == "20,00 €"
    assert "snapshot" not in row and overview["dolibarr"]["write_capable"] is True


@pytest.mark.asyncio
async def test_manual_timing_holds_the_order_until_finance_releases_it(flow):
    kassier = await person(flow, "kassier", role="club_admin")
    event = await create_event(flow, kassier, billing={**OFFER, "invoice_timing": "manual"}, visibility="public")
    paula = await person(flow, "paula")
    flow.act_as(paula)
    assert (await flow.post(f"/api/events/{event['id']}/registrations", json={})).status_code == 200
    order = await flow.db.billing_orders.find_one({}, {"_id": 0})
    assert order["status"] == "held"
    assert (await billing_orders.classify_due())["looked"] == 0, "zurückgehaltene Aufträge fasst der Job nicht an"
    flow.act_as(kassier)
    released = await flow.post(f"/api/admin/finance/orders/{order['id']}/release")
    assert released.status_code == 200 and released.json()["status"] == "pending"
    assert (await flow.post(f"/api/admin/finance/orders/{order['id']}/release")).status_code == 409


@pytest.mark.asyncio
async def test_write_access_needs_its_own_key(flow):
    admin = await person(flow, "admin", role="superadmin")
    flow.act_as(admin)
    assert (await flow.put("/api/admin/dolibarr/settings", json={"write_enabled": True})).status_code == 400
    assert (await flow.put("/api/admin/dolibarr/settings", json={"write_api_key": "schreib-schluessel-test", "write_enabled": True})).status_code == 200
    status = (await flow.get("/api/admin/dolibarr/status")).json()
    assert status["write_enabled"] is True and status["write_api_key_configured"] is True
    stored = await flow.db.settings.find_one({"id": "dolibarr"}, {"_id": 0})
    assert stored["write_api_key"] != "schreib-schluessel-test", "der Schlüssel liegt verschlüsselt"
