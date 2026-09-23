"""Abrechnung fertig (#321, #322): Zahlungsstand aus Dolibarr im Detail (Teilzahlung, überfällig,
Überzahlung, Gutschrift), Prüffälle statt stiller Änderungen (Storno und Änderung nach dem Beleg,
Abweichung, verschwundener Beleg), Erstattungen mit Nachweis und Grenze, Summen je Veranstaltung,
Zeitleiste, Rechte, Aufbewahrung bei Kontolöschung, bestätigte Steuersätze."""
import pathlib
import sys
import time

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import billing_cases, billing_orders, dolibarr_billing, dolibarr_client  # noqa: E402
from services.daily_center import task_counts  # noqa: E402
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


async def invoiced_booking(flow, fake, kassier, companions=1, name="paula"):
    """Eine bezahlte Buchung bis zum freigegebenen Beleg - der Ausgangspunkt der meisten Fälle."""
    event = await paid_event(flow, kassier)
    who = await person(flow, name)
    booked = await book(flow, who, event, companions=companions)
    assert (await billing_orders.classify_due())["invoiced"] == 1
    order = await order_of(flow, booked)
    assert order["invoice_status"] == "validated" and order["payment_state"] == "open" and order["synced_at"]
    return event, who, booked, order


def test_payment_state_is_a_pure_projection_of_sum_rest_and_due_date():
    state = dolibarr_billing.payment_state_for
    assert state("draft", 4000, 4000, "2026-10-23") == "draft"
    assert state("validated", 4000, 4000, "2026-10-23", today="2026-09-23") == "open"
    assert state("validated", 4000, 4000, "2026-09-01", today="2026-09-23") == "overdue"
    assert state("validated", 4000, 3000, "2026-09-01", today="2026-09-23") == "partial", "teilweise bezahlt zählt vor überfällig"
    assert state("paid", 4000, 0, "") == "paid"
    assert state("paid", 4000, -1000, "") == "overpaid"
    assert state("validated", 4000, 0, "", credited_cents=4000) == "credited"
    assert state("abandoned", 4000, 4000, "") == "abandoned"
    assert state("paid", None, None, "") == "paid" and state("validated", None, None, "") == "open", "ohne Rest zählt Dolibarrs Status"


@pytest.mark.asyncio
async def test_partial_payments_project_open_partial_paid_without_double_counting(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, paula, booked, order = await invoiced_booking(flow, fake, kassier)
    assert order["total_cents"] == 4000 and order["due_on"] > "2026"

    fake.pay(order["invoice_id"], 10)
    assert (await billing_orders.sync_due())["changed"] == 1
    order = await order_of(flow, booked)
    assert order["payment_state"] == "partial" and order["remaining_cents"] == 3000 and billing_orders.paid_cents(order) == 1000
    assert [p["amount_cents"] for p in order["payments"]] == [1000]
    reg = await flow.db.event_registrations.find_one({"id": booked["id"]}, {"_id": 0})
    assert reg["billing_status"] == "invoiced" and reg["payment_state"] == "partial"
    # Derselbe Stand nochmal gelesen: nichts ändert sich, nichts wird doppelt gezählt.
    assert (await billing_orders.sync_due())["changed"] == 0
    assert len((await order_of(flow, booked))["payments"]) == 1

    fake.pay(order["invoice_id"], 30)
    assert (await billing_orders.sync_due())["paid"] == 1
    order = await order_of(flow, booked)
    assert order["payment_state"] == "paid" and order["paid"] is True and billing_orders.paid_cents(order) == 4000 and len(order["payments"]) == 2
    assert (await flow.db.event_registrations.find_one({"id": booked["id"]}, {"_id": 0}))["billing_status"] == "paid"
    # Bezahlt heißt: nicht mehr alle zehn Minuten, aber der tägliche Abgleich liest es neu.
    assert (await billing_orders.sync_due())["looked"] == 0
    assert (await billing_orders.reconcile_due())["looked"] == 1

    flow.act_as(kassier)
    overview = (await flow.get("/api/admin/finance/overview")).json()
    [row] = overview["invoiced"]
    assert row["payment_label"] == "bezahlt" and row["paid_cents"] == 4000 and "payments" not in row
    summary = (await flow.get(f"/api/admin/finance/sources/event/{event['id']}")).json()
    assert summary == {"booked_cents": 4000, "invoiced_cents": 4000, "paid_cents": 4000, "open_cents": 0, "credited_cents": 0, "refunded_cents": 0,
                       "orders": 1, "cancelled_orders": 0, "cases_open": 0}
    flow.act_as(paula)
    own = (await flow.get(f"/api/events/{event['slug']}")).json()["own_registration"]
    assert own["price"]["payment_state"] == "paid"


@pytest.mark.asyncio
async def test_cancellation_after_invoice_is_a_case_and_refunds_are_tracked_apart_from_the_credit_note(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, paula, booked, order = await invoiced_booking(flow, fake, kassier)
    fake.pay(order["invoice_id"])
    assert (await billing_orders.sync_due())["paid"] == 1
    posts_before = len(fake.posts)

    # Paula sagt ab - der Beleg bleibt, die Website löscht und gutschreibt nichts.
    flow.act_as(paula)
    assert (await flow.client.delete(f"/api/events/{event['id']}/registrations/me")).status_code == 200
    order = await order_of(flow, booked)
    assert order["status"] == "invoiced" and order["booking_state"] == "cancelled" and order["paid_cents_at_cancel"] == 4000
    assert order["invoice_id"] in fake.core_invoices, "kein DELETE, kein Storno in Dolibarr"
    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["kind"] == "cancelled_after_invoice" and case["status"] == "open" and case["detail"]["paid_cents"] == 4000
    assert (await task_counts(flow.db))["billing_cases"] == 1

    flow.act_as(kassier)
    listed = (await flow.get("/api/admin/finance/cases")).json()
    assert listed["cases"][0]["label"] == "Storniert, Beleg existiert" and "Gutschrift" in listed["cases"][0]["todo"] and listed["cases"][0]["person"] == "Paula"
    overview = (await flow.get("/api/admin/finance/overview")).json()
    assert overview["cases_open"] == 1 and overview["invoiced"][0]["booking_state"] == "cancelled"

    # Erstattung: nie mehr als bezahlt, nie ohne Grund - und getrennt von der Gutschrift.
    too_much = await flow.post(f"/api/admin/finance/orders/{order['id']}/refunds", json={"amount_cents": 5000, "paid_on": "2026-09-24", "reason": "alles zurück"})
    assert too_much.status_code == 400 and "höchstens 40,00" in too_much.json()["detail"]
    assert (await flow.post(f"/api/admin/finance/orders/{order['id']}/refunds", json={"amount_cents": 2000, "paid_on": "2026-09-24", "reason": "x"})).status_code == 422
    first = await flow.post(f"/api/admin/finance/orders/{order['id']}/refunds", json={"amount_cents": 2000, "paid_on": "2026-09-24", "reference": "Überweisung", "reason": "Begleitperson entfallen"})
    assert first.status_code == 200 and first.json()["refund"]["amount_cents"] == 2000 and first.json()["resolved_case"] is None
    assert (await flow.post(f"/api/admin/finance/orders/{order['id']}/refunds", json={"amount_cents": 2500, "paid_on": "2026-09-25", "reason": "Rest"})).status_code == 400
    detail = (await flow.get(f"/api/admin/finance/orders/{order['id']}")).json()
    assert detail["sums"] == {"paid_cents": 4000, "refunded_cents": 2000, "credited_cents": 0, "refundable_cents": 2000}
    texts = [item["text"] for item in detail["timeline"]]
    assert any(t.startswith("Zahlung 40,00 €") for t in texts) and any(t.startswith("Erstattung 20,00 € am 2026-09-24 (Überweisung) – Begleitperson entfallen") for t in texts)
    assert any(t.startswith("Buchung storniert") for t in texts) and any(t.startswith("Prüffall: Storniert") for t in texts)
    assert "email" not in str(detail["order"].get("snapshot")), "keine Adressdaten im Detail"
    assert await flow.db.audit_logs.count_documents({"action": "billing.refund.record", "target_id": order["id"]}) == 1

    # Der Kassier schreibt in Dolibarr gut - der tägliche Abgleich (bezahlte Belege liest nur er) sieht es und erledigt den Fall von selbst.
    note = fake.credit(order["invoice_id"], 40)
    assert (await billing_orders.sync_due())["looked"] == 0, "bezahlt: nicht mehr alle zehn Minuten"
    assert (await billing_orders.reconcile_due())["looked"] == 1
    order = await order_of(flow, booked)
    assert order["payment_state"] == "credited" and order["credit_notes"][0]["ref"] == note["ref"] and billing_orders.paid_cents(order) == 4000, "eine Gutschrift ist keine Zahlung"
    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["status"] == "resolved" and case["auto"] is True and note["ref"] in case["resolution"]
    assert len(fake.posts) == posts_before, "nach dem Beleg hat die Website nichts mehr nach Dolibarr geschrieben"


@pytest.mark.asyncio
async def test_changes_after_the_invoice_keep_the_frozen_price_and_open_a_case_resolved_with_reason(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, paula, booked, order = await invoiced_booking(flow, fake, kassier)

    flow.act_as(kassier)
    changed = await flow.patch(f"/api/events/{event['id']}/registrations/{booked['id']}", json={"companion_count": 0})
    assert changed.status_code == 200, changed.text
    reg = await flow.db.event_registrations.find_one({"id": booked["id"]}, {"_id": 0})
    assert reg["companion_count"] == 0 and reg["price_snapshot"]["total_cents"] == 4000 and reg["billing_status"] == "invoiced", "der eingefrorene Preis bleibt"
    assert (await order_of(flow, booked))["status"] == "invoiced" and sum(1 for p, _ in fake.posts if p == "/invoices") == 1
    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["kind"] == "changed_after_invoice" and case["detail"] == {"reason": "Begleitpersonen geändert", "invoiced_cents": 4000, "new_total_cents": 2000, "invoice_ref": order["invoice_ref"]}
    # Nochmal ändern: derselbe Fall, kein zweiter.
    assert (await flow.patch(f"/api/events/{event['id']}/registrations/{booked['id']}", json={"companion_count": 2})).status_code == 200
    cases = await billing_cases.cases_for_order(flow.db, order["id"])
    assert len(cases) == 1 and cases[0]["detail"]["new_total_cents"] == 6000

    assert (await flow.post(f"/api/admin/finance/cases/{case['id']}/resolve", json={"reason": ""})).status_code == 422
    done = await flow.post(f"/api/admin/finance/cases/{case['id']}/resolve", json={"reason": "Gutschrift GA2026-0003 über 20 € angelegt"})
    assert done.status_code == 200 and done.json()["case"]["status"] == "resolved" and done.json()["case"]["resolved_by"] == kassier["id"]
    assert (await flow.post(f"/api/admin/finance/cases/{case['id']}/resolve", json={"reason": "nochmal"})).status_code == 409
    assert await flow.db.audit_logs.count_documents({"action": "billing.case.resolve", "target_id": order["id"]}) == 1
    assert (await task_counts(flow.db))["billing_cases"] == 0


@pytest.mark.asyncio
async def test_overpayment_late_payment_mismatch_and_a_vanished_invoice_are_cases_never_writes(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, paula, booked, order = await invoiced_booking(flow, fake, kassier)
    posts_before = len(fake.posts)

    # Überzahlung.
    fake.pay(order["invoice_id"], 50)
    assert (await billing_orders.sync_due())["cases"] == 1
    order = await order_of(flow, booked)
    assert order["payment_state"] == "overpaid" and billing_orders.paid_cents(order) == 5000
    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["kind"] == "overpaid" and case["detail"]["over_cents"] == 1000

    # Zahlung auf eine stornierte Buchung.
    event2, max_, booked2, order2 = await invoiced_booking(flow, fake, kassier, companions=0, name="max")
    flow.act_as(max_)
    assert (await flow.client.delete(f"/api/events/{event2['id']}/registrations/me")).status_code == 200
    fake.pay(order2["invoice_id"])
    await billing_orders.sync_due()
    kinds = sorted(c["kind"] for c in await billing_cases.cases_for_order(flow.db, order2["id"]))
    assert kinds == ["cancelled_after_invoice", "paid_after_cancel"]

    # Der Beleg wurde in Dolibarr geändert: Betrag weicht ab - und stimmt später wieder.
    fake.core_invoices[order["invoice_id"]]["total_ttc"] = 45.0
    await billing_orders.reconcile_due()
    kinds = {c["kind"]: c for c in await billing_cases.cases_for_order(flow.db, order["id"])}
    assert kinds["amount_mismatch"]["status"] == "open" and kinds["amount_mismatch"]["detail"]["remote_cents"] == 4500
    assert (await order_of(flow, booked))["total_cents"] == 4000, "der eingefrorene Preis wird nicht angepasst"
    fake.core_invoices[order["invoice_id"]]["total_ttc"] = 40.0
    await billing_orders.reconcile_due()
    kinds = {c["kind"]: c for c in await billing_cases.cases_for_order(flow.db, order["id"])}
    assert kinds["amount_mismatch"]["status"] == "resolved" and kinds["amount_mismatch"]["auto"] is True

    # Jemand löscht den Beleg in Dolibarr: sichtbar, kein zweiter Beleg.
    fake.remove(order["invoice_id"])
    result = await billing_orders.reconcile_due()
    assert result["errors"] == 1
    order = await order_of(flow, booked)
    assert order["status"] == "invoiced" and order["sync_error"] == "not_found" and order["sync_error_at"]
    kinds = {c["kind"]: c for c in await billing_cases.cases_for_order(flow.db, order["id"])}
    assert kinds["invoice_gone"]["status"] == "open"
    assert (await billing_orders.classify_due())["looked"] == 0, "ein Auftrag mit Beleg wird nie neu angelegt"
    flow.act_as(kassier)
    resync = await flow.post(f"/api/admin/finance/orders/{order['id']}/resync")
    assert resync.status_code == 200 and resync.json()["ok"] is False and resync.json()["order"]["sync_error"] == "not_found"
    assert len(fake.posts) == posts_before + 3, "in all dem nur die drei POSTs für den Beleg von Max (Kunde, Beleg, Freigabe)"
    detail = (await flow.get(f"/api/admin/finance/orders/{order['id']}")).json()
    assert any(item["kind"] == "error" and "Nicht gefunden" in item["text"] for item in detail["timeline"])


@pytest.mark.asyncio
async def test_overdue_shows_up_and_the_daily_reconcile_rereads_settled_invoices(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, paula, booked, order = await invoiced_booking(flow, fake, kassier)
    fake.core_invoices[order["invoice_id"]]["date_lim_reglement"] = int(time.time()) - 40 * 86400
    await billing_orders.sync_due()
    order = await order_of(flow, booked)
    assert order["payment_state"] == "overdue" and order["due_on"] < "2026-09-23"
    flow.act_as(kassier)
    row = (await flow.get("/api/admin/finance/overview")).json()["invoiced"][0]
    assert row["payment_label"] == "überfällig" and row["synced_at"]
    # Ohne Anbindung im Modus „live“ liest niemand nach - und das Nachlesen von Hand sagt es.
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {"mode": "preview"}})
    assert (await billing_orders.sync_due()) == {"looked": 0, "changed": 0, "paid": 0, "cases": 0, "errors": 0}
    assert (await flow.post(f"/api/admin/finance/orders/{order['id']}/resync")).status_code == 409


@pytest.mark.asyncio
async def test_summary_per_event_and_filters_and_who_may_look(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    paula, max_, gast = await person(flow, "paula"), await person(flow, "max"), await person(flow, "gast")
    b1, b2, _ = await book(flow, paula, event, companions=1), await book(flow, max_, event), await book(flow, gast, event)
    flow.act_as(gast)
    assert (await flow.client.delete(f"/api/events/{event['id']}/registrations/me")).status_code == 200, "storniert vor dem Beleg"
    assert (await billing_orders.classify_due())["invoiced"] == 2
    fake.pay((await order_of(flow, b1))["invoice_id"], 10)
    await billing_orders.sync_due()

    flow.act_as(kassier)
    summary = (await flow.get(f"/api/admin/finance/sources/event/{event['id']}")).json()
    assert summary == {"booked_cents": 6000, "invoiced_cents": 6000, "paid_cents": 1000, "open_cents": 5000, "credited_cents": 0, "refunded_cents": 0,
                       "orders": 3, "cancelled_orders": 1, "cases_open": 0}
    filtered = (await flow.get(f"/api/admin/finance/overview?source={event['id']}")).json()
    assert filtered["summary"] == summary and len(filtered["invoiced"]) == 2
    by_name = (await flow.get("/api/admin/finance/overview?q=PAU")).json()
    assert [row["person"] for row in by_name["invoiced"]] == ["Paula"] and by_name["summary"] is None
    assert (await flow.get("/api/admin/finance/overview?kind=tournament")).json()["invoiced"] == []
    assert (await flow.get("/api/admin/finance/sources/unsinn/x")).status_code == 404
    assert (await flow.post("/api/admin/finance/reconcile")).json()["looked"] == 2

    # Rechte: ohne Bereich Finanzen sieht niemand Geld - auch keine Turnierleitung oder Moderation.
    for other in (paula, await person(flow, "mod", role="moderator")):
        flow.act_as(other)
        for path in ("/api/admin/finance/overview", "/api/admin/finance/cases", f"/api/admin/finance/orders/{(await order_of(flow, b1))['id']}", f"/api/admin/finance/sources/event/{event['id']}"):
            assert (await flow.get(path)).status_code == 403, path
        assert (await flow.post("/api/admin/finance/reconcile")).status_code == 403

    # Kontolöschung: der Auftrag behält Betrag und Belegnummer, verliert Name und E-Mail; die Zuordnung fällt weg.
    order = await order_of(flow, b2)
    assert order["snapshot"]["recipient"]["email"] and await flow.db.billing_customers.count_documents({"user_id": max_["id"]}) == 1
    assert await billing_orders.anonymize_user(flow.db, max_["id"]) == 1
    order = await order_of(flow, b2)
    assert order["snapshot"]["recipient"] == {**order["snapshot"]["recipient"], "display_name": "Gelöschter User", "email": None}
    assert order["total_cents"] == 2000 and order["invoice_ref"] and order["anonymized_at"]
    assert await flow.db.billing_customers.count_documents({"user_id": max_["id"]}) == 0


@pytest.mark.asyncio
async def test_without_confirmed_tax_rates_nothing_is_validated_by_itself(flow, fake):
    await connect(flow, invoice_auto_validate=True, **TERMS)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    booked = await book(flow, await person(flow, "paula"), event)
    assert (await billing_orders.classify_due())["invoiced"] == 1
    order = await order_of(flow, booked)
    assert order["invoice_status"] == "draft" and order["payment_state"] == "draft", "Entwurf zur Prüfung, weil die Steuersätze niemand bestätigt hat"
    assert not any(p.endswith("/validate") for p, _ in fake.posts)
