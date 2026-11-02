"""Ein in Dolibarr gelöschter Entwurf (#2226): nur ein echtes „nicht gefunden“ zählt. Dann gilt der Beleg als entfernt, ein Prüffall
dazu ist erledigt, die Anmeldung steht wieder sauber da - und neu abgerechnet wird nur auf Wunsch der Finanzverwaltung.
Freigegebene Belege verschwinden nie still, Verbindungsfehler ändern nichts."""
import pathlib
import sys

import httpx
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import billing_cases, billing_orders, billing_repair, dolibarr_client  # noqa: E402
from test_billing_dolibarr_flow import TERMS, book, connect, order_of, paid_event, person  # noqa: E402

CONFIRMED = {"invoice_auto_validate": True, "tax_confirmed_at": "2026-09-23T10:00:00+00:00", **TERMS}


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


async def drafted(flow, name="paula"):
    """Eine Buchung bis zum Entwurf in Dolibarr (ohne „gleich freigeben“)."""
    await connect(flow, **TERMS)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    who = await person(flow, name)
    booked = await book(flow, who, event, companions=1)
    result = await billing_orders.classify_due()
    assert result["invoiced"] == 1
    order = await order_of(flow, booked)
    assert order["invoice_status"] == "draft" and order["payment_state"] == "draft"
    return kassier, event, who, booked, order


async def registration(flow, booked):
    return await flow.db.event_registrations.find_one({"id": booked["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_a_deleted_draft_leaves_lists_and_sums_and_closes_its_case(flow, fake):
    kassier, event, paula, booked, order = await drafted(flow)
    ref = order["invoice_ref"]
    # Vor dem Update hat der Abgleich dazu schon einen Prüffall geöffnet und den Fehler am Auftrag vermerkt.
    await billing_cases.open_case(flow.db, order, "invoice_gone", {"invoice_ref": ref, "invoice_id": order["invoice_id"]})
    await flow.db.billing_orders.update_one({"id": order["id"]}, {"$set": {"sync_error": "not_found", "sync_error_text": "Nicht gefunden (404)"}})
    posts_before = len(fake.posts)

    fake.remove(order["invoice_id"])
    counts = await billing_orders.sync_due()
    assert counts["removed"] == 1 and counts["errors"] == 0 and counts["cases"] == 0

    order = await order_of(flow, booked)
    assert order["status"] == "held" and ref in order["note"]
    for field in ("invoice_id", "invoice_ref", "invoice_status", "payment_state", "remaining_cents", "paid", "sync_error", "sync_error_text", "invoiced_at", "synced_at"):
        assert field not in order, field
    assert [row["invoice_ref"] for row in order["removed_invoices"]] == [ref]

    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["status"] == "resolved" and case["auto"] is True and "gelöscht" in case["resolution"]
    assert await flow.db.audit_logs.count_documents({"action": "billing.invoice.removed", "target_id": order["id"]}) == 1

    reg = await registration(flow, booked)
    assert reg["billing_status"] == "pending" and reg["status"] == "registered" and reg["price_snapshot"]["total_cents"] == 4000
    for field in ("invoice_id", "invoice_ref", "invoice_status", "payment_state"):
        assert field not in reg, field

    flow.act_as(kassier)
    overview = (await flow.get("/api/admin/finance/overview")).json()
    assert overview["invoiced"] == [] and overview["invoiced_total"] == 0 and overview["cases_open"] == 0
    assert [row["id"] for row in overview["open"]] == [order["id"]] and overview["open"][0]["removed_invoices"][0]["invoice_ref"] == ref
    summary = (await flow.get(f"/api/admin/finance/sources/event/{event['id']}")).json()
    assert {key: summary[key] for key in ("booked_cents", "invoiced_cents", "open_cents", "paid_cents", "orders")} == {"booked_cents": 0, "invoiced_cents": 0, "open_cents": 0, "paid_cents": 0, "orders": 0}
    assert (await flow.get("/api/admin/finance/export.csv")).headers["X-Export-Rows"] == "0"
    texts = [item["text"] for item in (await flow.get(f"/api/admin/finance/orders/{order['id']}")).json()["timeline"]]
    assert any(f"Entwurf {ref} in Dolibarr gelöscht" in text for text in texts) and not any("nicht lesbar" in text for text in texts)

    # Nichts legt ihn von selbst neu an: weder der Job noch das Nachholen fehlender Aufträge.
    result = await billing_orders.classify_due()
    assert result["looked"] == 0
    result = await billing_repair.repair_missing_orders(flow.db)
    assert result["repaired"] == 0
    assert len(fake.posts) == posts_before and await flow.db.billing_orders.count_documents({"registration_id": booked["id"]}) == 1

    flow.act_as(paula)
    assert (await flow.get("/api/account/invoices")).json()["invoices"] == []
    price = (await flow.get(f"/api/events/{event['slug']}")).json()["own_registration"]["price"]
    assert price["billing_status"] == "pending" and not price["invoice_ref"] and not price["payment_state"]


@pytest.mark.asyncio
async def test_billing_again_is_a_decision_of_the_finance_team(flow, fake):
    kassier, event, _, booked, order = await drafted(flow)
    old_id = order["invoice_id"]
    fake.remove(old_id)
    await billing_orders.sync_due()

    flow.act_as(kassier)
    result = await flow.post(f"/api/admin/finance/orders/{order['id']}/release")
    assert result.status_code == 200
    result = await billing_orders.classify_due()
    assert result["invoiced"] == 1
    order = await order_of(flow, booked)
    assert order["status"] == "invoiced" and order["invoice_id"] != old_id and order["invoice_status"] == "draft" and not order["note"]
    assert (await registration(flow, booked))["billing_status"] == "invoiced"
    summary = (await flow.get(f"/api/admin/finance/sources/event/{event['id']}")).json()
    assert summary["invoiced_cents"] == 4000, "wieder abgerechnet, wieder in den Summen"
    texts = [item["text"] for item in (await flow.get(f"/api/admin/finance/orders/{order['id']}")).json()["timeline"]]
    assert any("in Dolibarr gelöscht" in text for text in texts)


@pytest.mark.asyncio
async def test_no_new_invoice_closes_the_order_for_good(flow, fake):
    kassier, event, paula, booked, order = await drafted(flow)
    flow.act_as(kassier)
    result = await flow.post(f"/api/admin/finance/orders/{order['id']}/dismiss")
    assert result.status_code == 409, "der Beleg steht noch"
    fake.remove(order["invoice_id"])
    await billing_orders.sync_due()

    flow.act_as(paula)
    result = await flow.post(f"/api/admin/finance/orders/{order['id']}/dismiss")
    assert result.status_code == 403

    flow.act_as(kassier)
    done = await flow.post(f"/api/admin/finance/orders/{order['id']}/dismiss")
    assert done.status_code == 200
    order = await order_of(flow, booked)
    assert order["status"] == "cancelled" and order["cancel_reason"]
    assert (await registration(flow, booked))["billing_status"] == "cancelled"
    assert await flow.db.audit_logs.count_documents({"action": "billing.order.dismiss", "target_id": order["id"], "actor_id": kassier["id"]}) == 1
    assert (await flow.get("/api/admin/finance/overview")).json()["open"] == []
    result = await flow.post(f"/api/admin/finance/orders/{order['id']}/dismiss")
    assert result.status_code == 409

    # Ein gewöhnlicher Auftrag, der auf Freigabe wartet, lässt sich so nicht wegklicken.
    await flow.db.billing_orders.insert_one({"id": "o-held", "kind": "event", "source_id": event["id"], "registration_id": "r-x", "user_id": paula["id"], "status": "held", "total_cents": 100})
    result = await flow.post("/api/admin/finance/orders/o-held/dismiss")
    assert result.status_code == 409


@pytest.mark.asyncio
async def test_a_person_cannot_restart_billing_while_finance_decides(flow, fake):
    """Solange die Finanzverwaltung über den gelöschten Entwurf entscheidet, entsteht durch eine Änderung der Person kein neuer Beleg."""
    kassier, event, paula, booked, order = await drafted(flow)
    fake.remove(order["invoice_id"])
    await billing_orders.sync_due()

    flow.act_as(paula)
    url = f"/api/events/{event['id']}/registrations/me"
    refused = await flow.patch(url, json={"companion_count": 0})
    assert refused.status_code == 409, refused.text
    assert "Abrechnung" in refused.json()["detail"]
    stored = await flow.db.billing_orders.find_one({"id": order["id"]}, {"_id": 0})
    assert stored["status"] == "held"
    assert await flow.db.billing_orders.count_documents({"registration_id": booked["id"]}) == 1
    assert (await billing_orders.classify_due())["invoiced"] == 0
    assert (await registration(flow, booked))["companion_count"] == 1
    assert (await flow.patch(url, json={"note": "Komme etwas später"})).status_code == 200, "den Hinweis ändert die Person weiter selbst"

    flow.act_as(kassier)
    assert (await flow.post(f"/api/admin/finance/orders/{order['id']}/release")).status_code == 200
    flow.act_as(paula)
    assert (await flow.patch(url, json={"companion_count": 0})).status_code == 200, "nach der Freigabe geht es wieder"


@pytest.mark.asyncio
async def test_no_new_invoice_loses_cleanly_against_a_release(flow, fake):
    """Beide Knöpfe gleichzeitig: Beide haben „wartet“ gelesen, die Freigabe war zuerst da. Dann ändert „Keine neue Rechnung“ gar nichts."""
    kassier, _, _, booked, order = await drafted(flow)
    fake.remove(order["invoice_id"])
    await billing_orders.sync_due()
    read_before = await flow.db.billing_orders.find_one({"id": order["id"]}, {"_id": 0})
    await billing_orders.release_order(flow.db, order["id"], kassier["id"])

    assert await billing_orders.dismiss_removed(flow.db, read_before, kassier["id"]) is False
    assert (await flow.db.billing_orders.find_one({"id": order["id"]}, {"_id": 0}))["status"] == "pending"
    assert (await registration(flow, booked))["billing_status"] == "pending", "die Anmeldung wird nicht storniert, der Auftrag läuft weiter"
    assert await flow.db.audit_logs.count_documents({"action": "billing.order.dismiss", "target_id": order["id"]}) == 0


@pytest.mark.asyncio
async def test_a_deleted_draft_of_a_cancelled_booking_ends_the_case(flow, fake):
    kassier, event, paula, booked, order = await drafted(flow)
    flow.act_as(paula)
    result = await flow.client.delete(f"/api/events/{event['id']}/registrations/me")
    assert result.status_code == 200
    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["kind"] == "cancelled_after_invoice" and case["status"] == "open"

    # Genau das sagt der Prüffall: den Entwurf in Dolibarr löschen.
    fake.remove(order["invoice_id"])
    await billing_orders.sync_due()
    order = await order_of(flow, booked)
    assert order["status"] == "cancelled" and "invoice_id" not in order
    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["status"] == "resolved" and case["auto"] is True
    assert (await registration(flow, booked))["billing_status"] == "cancelled"
    flow.act_as(kassier)
    overview = (await flow.get("/api/admin/finance/overview")).json()
    assert overview["open"] == [] and overview["invoiced"] == [] and overview["cases_open"] == 0


@pytest.mark.asyncio
async def test_a_validated_invoice_never_vanishes_quietly(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    booked = await book(flow, await person(flow, "paula"), event)
    await billing_orders.classify_due()
    order = await order_of(flow, booked)
    assert order["invoice_status"] == "validated"
    fake.remove(order["invoice_id"])
    counts = await billing_orders.sync_due()
    assert counts["errors"] == 1 and counts["cases"] == 1 and not counts.get("removed")
    fresh = await order_of(flow, booked)
    assert fresh["status"] == "invoiced" and fresh["invoice_id"] == order["invoice_id"] and fresh["sync_error"] == "not_found"
    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["kind"] == "invoice_gone" and case["status"] == "open"
    assert (await registration(flow, booked))["invoice_ref"] == order["invoice_ref"]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [500, 502, 503])
async def test_a_connection_error_changes_nothing(flow, fake, status):
    _, _, _, booked, order = await drafted(flow)
    fake.fail_with = status
    counts = await billing_orders.sync_due()
    assert counts["errors"] == 1 and counts["cases"] == 0 and not counts.get("removed")
    fresh = await order_of(flow, booked)
    assert fresh["status"] == "invoiced" and fresh["invoice_id"] == order["invoice_id"] and fresh["invoice_status"] == "draft" and fresh["sync_error"]
    assert await billing_cases.cases_for_order(flow.db, order["id"]) == []


@pytest.mark.asyncio
async def test_a_network_failure_changes_nothing(flow, fake, monkeypatch):
    _, _, _, booked, order = await drafted(flow)

    def refuse(request):
        raise httpx.ConnectError("keine Verbindung", request=request)

    monkeypatch.setattr(dolibarr_client, "_transport", httpx.MockTransport(refuse))
    counts = await billing_orders.sync_due()
    assert counts["errors"] == 1 and not counts.get("removed")
    assert (await order_of(flow, booked))["invoice_id"] == order["invoice_id"]
    assert await billing_cases.cases_for_order(flow.db, order["id"]) == []


@pytest.mark.asyncio
async def test_a_404_that_does_not_come_from_dolibarr_is_no_proof(flow, fake, monkeypatch):
    """Ein Webserver davor, der eine Seite „Not Found“ liefert (falsche Adresse, Wartung): kein Beweis, der Auftrag bleibt."""
    _, _, _, booked, order = await drafted(flow)
    monkeypatch.setattr(dolibarr_client, "_transport", httpx.MockTransport(lambda request: httpx.Response(404, text="<html>Not Found</html>")))
    counts = await billing_orders.sync_due()
    assert not counts.get("removed")
    fresh = await order_of(flow, booked)
    assert fresh["status"] == "invoiced" and fresh["invoice_id"] == order["invoice_id"] and fresh["sync_error"] == "not_found"


@pytest.mark.asyncio
async def test_the_second_look_by_order_reference_must_agree(flow, fake):
    # Dolibarr kennt den Beleg unter seiner Kennung noch (eine neue Nummer nach einem Restore): nicht entfernt.
    _, _, _, booked, order = await drafted(flow)
    row = fake.core_invoices.pop(order["invoice_id"])
    row["id"] = 9001
    fake.core_invoices[9001] = row
    result = await billing_orders.sync_due()
    assert not result.get("removed")
    assert (await order_of(flow, booked))["status"] == "invoiced"

    # Scheitert der zweite Blick an der Verbindung, ist auch nichts bewiesen - und kein Prüffall nötig.
    await flow.db.billing_cases.delete_many({})
    fake.core_invoices.pop(9001)
    fake.fail_with, fake.fail_paths = 503, {"/invoices"}
    counts = await billing_orders.sync_due()
    assert not counts.get("removed") and counts["errors"] == 1 and counts["cases"] == 0
    fresh = await order_of(flow, booked)
    assert fresh["status"] == "invoiced" and fresh["sync_error"] != "not_found"
    assert await billing_cases.cases_for_order(flow.db, order["id"]) == []


@pytest.mark.asyncio
async def test_reading_by_hand_shows_the_removal_too(flow, fake):
    kassier, _, _, _, order = await drafted(flow)
    fake.remove(order["invoice_id"])
    flow.act_as(kassier)
    response = await flow.post(f"/api/admin/finance/orders/{order['id']}/resync")
    assert response.status_code == 200 and response.json()["ok"] is False and response.json()["order"]["status"] == "held"
    assert response.json()["removed"] == 1


@pytest.mark.asyncio
async def test_a_changed_booking_keeps_its_case_and_warns_about_the_price(flow, fake):
    kassier, event, _, booked, order = await drafted(flow)
    flow.act_as(kassier)
    result = await flow.patch(f"/api/events/{event['id']}/registrations/{booked['id']}", json={"companion_count": 0})
    assert result.status_code == 200
    fake.remove(order["invoice_id"])
    await billing_orders.sync_due()
    order = await order_of(flow, booked)
    assert order["status"] == "held" and "Preis prüfen" in order["note"]
    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["kind"] == "changed_after_invoice" and case["status"] == "open", "der Preis passt nicht mehr, das entscheidet die Finanzverwaltung"


@pytest.mark.asyncio
async def test_a_deleted_draft_of_a_start_fee_cleans_the_tournament_registration(flow, fake):
    await connect(flow, **TERMS)
    await flow.db.tournament_registrations.insert_one({"id": "tr-1", "tournament_id": "t-1", "status": "approved", "billing_status": "invoiced", "invoice_id": 4711, "invoice_ref": "(PROV4711)",
                                                       "invoice_status": "draft", "payment_state": "draft", "price_snapshot": {"total_cents": 2500, "hash": "h1", "positions": []}})
    await flow.db.billing_orders.insert_one({"id": "o-t", "kind": "tournament", "source_id": "t-1", "registration_id": "tr-1", "user_id": "u-1", "status": "invoiced", "total_cents": 2500, "currency": "EUR",
                                             "booking_key": "tournament:tr-1:h1", "invoice_id": 4711, "invoice_ref": "(PROV4711)", "invoice_status": "draft", "payment_state": "draft"})
    result = await billing_orders.sync_due()
    assert result["removed"] == 1
    assert (await flow.db.billing_orders.find_one({"id": "o-t"}, {"_id": 0}))["status"] == "held"
    reg = await flow.db.tournament_registrations.find_one({"id": "tr-1"}, {"_id": 0})
    assert reg["billing_status"] == "pending" and "invoice_id" not in reg and "invoice_ref" not in reg and "payment_state" not in reg and reg["price_snapshot"]["total_cents"] == 2500
    result = await billing_repair.repair_missing_orders(flow.db)
    assert result["repaired"] == 0, "kein zweiter Auftrag von selbst"
