"""Abrechnung I, Teil 2 (#316, #317, #321 Anfang): Aus dem Auftrag wird in Dolibarr ein Beleg -
Geschäftspartner gefunden oder angelegt, nie doppelt, Entwurf zur Prüfung, Stand zurückgelesen."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import billing_orders, dolibarr_client  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    return instance


async def connect(flow, **extra):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL,
        "api_key": encrypt_secret(API_KEY), "instance": "verein", "entity": 1, "write_enabled": True, **extra,
    }}, upsert=True)


async def person(flow, name, *, role="player", **fields):
    user = await flow.add_user(role=role, name=name)
    fields.setdefault("email", f"{name}@example.test")
    fields.setdefault("display_name", name.capitalize())
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    return user


OFFER = {"enabled": True, "positions": [
    {"key": "beitrag", "label": "Kostenbeitrag", "description": "Essen und Getränke", "amount": "20", "basis": "per_person"},
]}


async def paid_event(flow, admin, **extra):
    flow.act_as(admin)
    response = await flow.post("/api/events", json={"name": "Weihnachtsfeier", "status": "registration_open", "visibility": "public", "has_registration": True,
                                                    "allow_companions": True, "max_companions_per_registration": 3,
                                                    "start_date": (now_utc() + timedelta(days=30)).isoformat(), "billing": {**OFFER, **extra}})
    assert response.status_code == 200, response.text
    return response.json()


async def book(flow, user, event, companions=0):
    flow.act_as(user)
    response = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": companions})
    assert response.status_code == 200, response.text
    return response.json()


async def order_of(flow, registration):
    return await flow.db.billing_orders.find_one({"registration_id": registration["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_member_gets_the_invoice_on_the_thirdparty_of_her_membership(flow, fake):
    await connect(flow)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    paula = await person(flow, "paula")
    # Bestätigte Zuordnung zum Dolibarr-Mitglied 7, das am Geschäftspartner 42 hängt.
    fake.add(member(7, firstname="Paula", lastname="Beispiel"), email=paula["email"])
    fake.add_thirdparty("Paula Beispiel", paula["email"])
    fake.core_members[7] = {"id": 7, "fk_soc": fake.next_id}
    socid = fake.next_id
    await flow.db.dolibarr_links.insert_one({"id": "l1", "user_id": paula["id"], "instance": "verein:1", "member_key": "verein:1:7", "member_id": 7, "member_ref": "7", "status": "verified", "thirdparty_id": None})

    booked = await book(flow, paula, event, companions=1)
    result = await billing_orders.classify_due()
    assert result["invoiced"] == 1, result

    order = await order_of(flow, booked)
    assert order["status"] == "invoiced" and order["thirdparty_id"] == socid and order["invoice_status"] == "draft"
    assert order["invoice_ref"].startswith("(PROV"), "sichere Erstinbetriebnahme: Entwurf zur Prüfung"
    link = await flow.db.dolibarr_links.find_one({"id": "l1"}, {"_id": 0})
    assert link["thirdparty_id"] == socid, "die Nummer des Geschäftspartners wird an der Zuordnung gemerkt"
    invoice = fake.core_invoices[order["invoice_id"]]
    assert invoice["socid"] == socid and invoice["ref_ext"] == f"tls-{order['id']}"
    assert invoice["lines"] == [{"desc": "Kostenbeitrag – Essen und Getränke", "subprice": 20.0, "qty": 2, "tva_tx": 0.0, "product_type": 1}]
    assert invoice["total_ttc"] == 40.0
    assert [p for p, _ in fake.posts] == ["/invoices"], "kein Geschäftspartner angelegt - es gab ihn"

    flow.act_as(paula)
    own = (await flow.get(f"/api/events/{event['slug']}")).json()["own_registration"]
    assert own["price"]["billing_status"] == "invoiced" and own["price"]["invoice_status"] == "draft"


@pytest.mark.asyncio
async def test_non_member_gets_a_new_thirdparty_and_a_validated_invoice_when_configured(flow, fake):
    await connect(flow, invoice_auto_validate=True)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    gast = await person(flow, "gast")
    booked = await book(flow, gast, event)
    assert (await billing_orders.classify_due())["invoiced"] == 1

    order = await order_of(flow, booked)
    party = fake.thirdparties[order["thirdparty_id"]]
    assert party["name"] == "Gast" and party["email"] == gast["email"] and gast["id"] in party["note_private"]
    customer = await flow.db.billing_customers.find_one({"user_id": gast["id"]}, {"_id": 0})
    assert customer["thirdparty_id"] == party["id"] and customer["source"] == "created"
    assert order["invoice_status"] == "validated" and order["invoice_ref"].startswith("FA2609-")
    assert [p for p, _ in fake.posts] == ["/thirdparties", "/invoices", f"/invoices/{order['invoice_id']}/validate"]

    # Zweite Buchung derselben Person: derselbe Geschäftspartner, kein zweiter Kunde.
    event2 = await paid_event(flow, kassier)
    booked2 = await book(flow, gast, event2)
    assert (await billing_orders.classify_due())["invoiced"] == 1
    assert (await order_of(flow, booked2))["thirdparty_id"] == party["id"]
    assert sum(1 for p, _ in fake.posts if p == "/thirdparties") == 1


@pytest.mark.asyncio
async def test_same_email_in_dolibarr_waits_for_finance_instead_of_guessing(flow, fake):
    await connect(flow)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    gast = await person(flow, "gast")
    existing = fake.add_thirdparty("Familie Gast", gast["email"])
    booked = await book(flow, gast, event)
    assert (await billing_orders.classify_due())["waiting_review"] == 1
    order = await order_of(flow, booked)
    assert order["status"] == "waiting_review" and str(existing["id"]) in order["note"]
    assert not fake.posts, "nichts angelegt, nichts angenommen"

    # Finanzen ordnet den bestehenden Geschäftspartner zu - nach Prüfung, dass es ihn gibt.
    flow.act_as(kassier)
    assert (await flow.post(f"/api/admin/finance/orders/{order['id']}/thirdparty", json={"thirdparty_id": 999})).status_code == 404
    assigned = await flow.post(f"/api/admin/finance/orders/{order['id']}/thirdparty", json={"thirdparty_id": existing["id"]})
    assert assigned.status_code == 200 and assigned.json()["thirdparty"]["name"] == "Familie Gast"
    assert (await billing_orders.classify_due())["invoiced"] == 1
    assert (await order_of(flow, booked))["thirdparty_id"] == existing["id"]

    # Andere Antwort: bewusst neu anlegen.
    other = await person(flow, "zweiter", email=gast["email"])
    booked2 = await book(flow, other, event)
    assert (await billing_orders.classify_due())["waiting_review"] == 1
    order2 = await order_of(flow, booked2)
    flow.act_as(kassier)
    created = await flow.post(f"/api/admin/finance/orders/{order2['id']}/new-thirdparty")
    assert created.status_code == 200 and created.json()["thirdparty_id"] != existing["id"]
    assert (await billing_orders.classify_due())["invoiced"] == 1


@pytest.mark.asyncio
async def test_no_second_invoice_after_a_crash_between_create_and_store(flow, fake):
    await connect(flow)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    gast = await person(flow, "gast")
    booked = await book(flow, gast, event)
    order = await order_of(flow, booked)
    # Der Beleg existiert in Dolibarr schon (mit unserer Auftragskennung), der Auftrag weiß es nicht mehr.
    party = fake.add_thirdparty("Gast", gast["email"])
    await flow.db.billing_customers.insert_one({"id": "c1", "user_id": gast["id"], "instance": "verein:1", "thirdparty_id": party["id"], "source": "created"})
    fake.next_id += 1
    fake.core_invoices[fake.next_id] = {"id": fake.next_id, "ref": "FA2609-0007", "ref_ext": f"tls-{order['id']}", "socid": party["id"], "statut": 1, "paye": 0, "total_ttc": 20.0, "remaintopay": 20.0}

    assert (await billing_orders.classify_due())["invoiced"] == 1
    assert not any(p == "/invoices" for p, _ in fake.posts), "kein zweites POST /invoices"
    order = await order_of(flow, booked)
    assert order["invoice_ref"] == "FA2609-0007" and order["invoice_status"] == "validated"

    # Der Kassier bucht die Zahlung in Dolibarr - der Abgleich holt sie.
    fake.pay(order["invoice_id"])
    assert (await billing_orders.sync_due())["paid"] == 1
    order = await order_of(flow, booked)
    assert order["paid"] is True and order["paid_at"]
    reg = await flow.db.event_registrations.find_one({"id": booked["id"]}, {"_id": 0})
    assert reg["billing_status"] == "paid" and reg["invoice_ref"] == "FA2609-0007"


@pytest.mark.asyncio
async def test_dolibarr_outage_is_retried_then_given_up_and_retryable(flow, fake):
    await connect(flow)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    gast = await person(flow, "gast")
    booked = await book(flow, gast, event)
    fake.fail_with = 503
    for attempt in range(1, 5):
        assert (await billing_orders.classify_due())["pending"] == 1
        assert (await order_of(flow, booked))["attempts"] == attempt
    assert (await billing_orders.classify_due())["failed"] == 1
    order = await order_of(flow, booked)
    assert order["status"] == "failed" and "aufgegeben" in order["note"]

    fake.fail_with = None
    flow.act_as(kassier)
    assert (await flow.post(f"/api/admin/finance/orders/{order['id']}/retry")).json()["status"] == "pending"
    assert (await billing_orders.classify_due())["invoiced"] == 1


@pytest.mark.asyncio
async def test_without_write_switch_nothing_is_written(flow, fake):
    await connect(flow, write_enabled=False)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    gast = await person(flow, "gast")
    await book(flow, gast, event)
    assert (await billing_orders.classify_due())["waiting_write_access"] == 1
    assert not fake.posts and not fake.calls
    flow.act_as(kassier)
    overview = (await flow.get("/api/admin/finance/overview")).json()
    assert overview["open"][0]["status"] == "waiting_write_access" and overview["dolibarr"]["write_capable"] is False


@pytest.mark.asyncio
async def test_tax_profiles_become_net_prices_with_rates(flow, fake):
    from services import dolibarr_billing

    settings = {"tax_rates": {"standard": 20, "reduced": 10}}
    snapshot = {"positions": [
        {"label": "Beitrag", "unit_cents": 2000, "quantity": 2, "tax_profile": "none"},
        {"label": "Shirt", "unit_cents": 1200, "quantity": 1, "tax_profile": "standard", "dolibarr_product_id": 17},
        {"label": "Essen", "unit_cents": 1100, "quantity": 1, "tax_profile": "reduced"},
    ]}
    lines = dolibarr_billing.invoice_lines(snapshot, settings)
    assert lines[0] == {"desc": "Beitrag", "subprice": 20.0, "qty": 2, "tva_tx": 0.0, "product_type": 1}
    assert lines[1]["subprice"] == 10.0 and lines[1]["tva_tx"] == 20.0 and lines[1]["fk_product"] == 17
    assert lines[2]["subprice"] == 10.0 and lines[2]["tva_tx"] == 10.0
    assert dolibarr_billing.tax_rate_for({"tax_rates": {"none": 5}}, "none") == 0.0, "ohne Steuer bleibt ohne Steuer"
