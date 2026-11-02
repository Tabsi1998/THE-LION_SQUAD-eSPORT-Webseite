"""„Bezahlt (mit Abzug)“ (#2226): Dolibarr schließt den Beleg, `remaintopay` bleibt stehen. Die Website zeigt keinen offenen
Rest, sondern den erlassenen Betrag - in Liste, Summen, Export und überall, wo sonst „offen“ gerechnet wird."""
import csv
import io
import pathlib
import sys
import time

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import billing_cases, billing_orders, dolibarr_billing, dolibarr_client, invoice_notice, tournament_fees  # noqa: E402
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


async def invoiced(flow, kassier, name="paula", companions=1):
    """Eine bezahlte Buchung bis zum freigegebenen Beleg über 40,00 €."""
    event = await paid_event(flow, kassier)
    who = await person(flow, name)
    booked = await book(flow, who, event, companions=companions)
    result = await billing_orders.classify_due()
    assert result["invoiced"] == 1
    return event, who, booked, await order_of(flow, booked)


def parse_csv(response) -> list[dict]:
    return list(csv.DictReader(io.StringIO(response.text.lstrip("﻿")), delimiter=";"))


def test_without_the_payment_list_a_credit_note_is_no_payment():
    """Fehlt das Recht auf die Zahlungen, gilt Summe minus Rest - eine angewendete Gutschrift darf davon nicht erstattbar werden."""
    order = {"total_cents": 4000, "remaining_cents": 2000, "payment_state": "paid_reduced", "credit_notes": [{"total_cents": 1000, "status": "validated"}]}
    assert billing_orders.paid_cents(order) == 1000
    assert billing_orders.paid_cents({**order, "credit_notes": [{"total_cents": 1000, "status": "draft"}]}) == 2000, "ein Entwurf gleicht noch nichts aus"
    assert billing_orders.paid_cents({**order, "credit_notes": [{"total_cents": 3000, "status": "validated"}]}) == 0, "nie unter null"
    assert billing_orders.paid_cents({"total_cents": 4000, "remaining_cents": 1000}) == 3000, "ohne Gutschrift wie bisher"


def test_payment_state_recognizes_a_paid_invoice_with_a_rest():
    state = dolibarr_billing.payment_state_for
    assert state("paid", 4000, 2000, "") == "paid_reduced"
    assert state("paid", 4000, 4000, "2026-09-01", today="2026-09-23") == "paid_reduced", "ohne Zahlung und nach dem Zahlungsziel: trotzdem nicht überfällig"
    assert state("validated", 4000, 2000, "", paid=True) == "paid_reduced", "paye=1 zählt wie der Status bezahlt"
    assert state("paid", 4000, 0, "") == "paid", "Rest 0 bleibt bezahlt"
    assert state("abandoned", 4000, 2000, "") == "abandoned", "aufgegeben bleibt aufgegeben"
    assert state("paid", 4000, 2000, "", credited_cents=4000) == "credited", "eine Gutschrift über alles bleibt gutgeschrieben"
    assert state("paid", 4000, -500, "") == "overpaid"
    assert state("validated", 4000, 2000, "") == "partial", "ohne Abschluss in Dolibarr bleibt der Rest offen"
    assert state("validated", None, None, "", paid=True) == "paid"


@pytest.mark.asyncio
async def test_reduction_without_any_payment_opens_nothing_and_refunds_nothing(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, paula, booked, order = await invoiced(flow, kassier)
    fake.core_invoices[order["invoice_id"]]["date_lim_reglement"] = int(time.time()) - 40 * 86400
    fake.close_reduced(order["invoice_id"], code="other", note="Vorstand erlässt den Betrag")

    result = await billing_orders.sync_due()
    assert result["paid"] == 1
    order = await order_of(flow, booked)
    assert order["payment_state"] == "paid_reduced" and order["paid"] is True and order["remaining_cents"] == 4000
    assert order["invoice_status"] == "paid"
    assert billing_orders.paid_cents(order) == 0, "ein Abzug ist keine Zahlung"
    reg = await flow.db.event_registrations.find_one({"id": booked["id"]}, {"_id": 0})
    assert reg["billing_status"] == "paid" and reg["payment_state"] == "paid_reduced"
    assert (await billing_orders.attention_counts(flow.db))["overdue"] == 0, "auch nach dem Zahlungsziel keine Mahnliste"
    result = await billing_orders.sync_due()
    assert result["looked"] == 0, "erledigt: nicht mehr alle zehn Minuten"
    result = await billing_orders.reconcile_due()
    assert result["looked"] == 1, "aber der tägliche Abgleich liest ihn neu"

    flow.act_as(kassier)
    overview = (await flow.get("/api/admin/finance/overview")).json()
    [row] = overview["invoiced"]
    assert row["payment_label"] == "bezahlt mit Abzug" and row["waived_cents"] == 4000 and row["paid_cents"] == 0
    assert overview["payment_labels"]["paid_reduced"] == "bezahlt mit Abzug"
    summary = (await flow.get(f"/api/admin/finance/sources/event/{event['id']}")).json()
    assert summary["open_cents"] == 0 and summary["paid_cents"] == 0 and summary["waived_cents"] == 4000 and summary["invoiced_cents"] == 4000
    detail = (await flow.get(f"/api/admin/finance/orders/{order['id']}")).json()
    assert detail["sums"] == {"paid_cents": 0, "refunded_cents": 0, "credited_cents": 0, "waived_cents": 4000, "refundable_cents": 0}
    refused = await flow.post(f"/api/admin/finance/orders/{order['id']}/refunds", json={"amount_cents": 100, "paid_on": "2026-09-24", "reason": "gibt es nicht"})
    assert refused.status_code == 400

    [line] = parse_csv(await flow.get("/api/admin/finance/export.csv"))
    assert line["Zahlungsstand"] == "bezahlt mit Abzug" and line["Bezahlt"] == "0,00 €" and line["Erlassen"] == "40,00 €"


@pytest.mark.asyncio
async def test_reduction_after_a_partial_payment_keeps_the_real_payment_as_refund_limit(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, _, booked, order = await invoiced(flow, kassier)
    fake.pay(order["invoice_id"], 20)
    await billing_orders.sync_due()
    assert (await order_of(flow, booked))["payment_state"] == "partial"

    fake.close_reduced(order["invoice_id"])
    await billing_orders.sync_due()
    order = await order_of(flow, booked)
    assert order["payment_state"] == "paid_reduced" and order["remaining_cents"] == 2000 and billing_orders.paid_cents(order) == 2000

    flow.act_as(kassier)
    summary = (await flow.get(f"/api/admin/finance/sources/event/{event['id']}")).json()
    assert (summary["paid_cents"], summary["open_cents"], summary["waived_cents"]) == (2000, 0, 2000)
    detail = (await flow.get(f"/api/admin/finance/orders/{order['id']}")).json()
    assert detail["sums"]["refundable_cents"] == 2000 and detail["sums"]["waived_cents"] == 2000
    too_much = await flow.post(f"/api/admin/finance/orders/{order['id']}/refunds", json={"amount_cents": 2001, "paid_on": "2026-09-24", "reason": "mehr als gezahlt"})
    assert too_much.status_code == 400 and "höchstens 20,00" in too_much.json()["detail"]


@pytest.mark.asyncio
async def test_reduction_on_top_of_a_credit_note_counts_each_part_once(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, _, booked, order = await invoiced(flow, kassier)
    fake.pay(order["invoice_id"], 10)
    fake.credit(order["invoice_id"], 10)
    fake.close_reduced(order["invoice_id"])
    await billing_orders.sync_due()
    order = await order_of(flow, booked)
    assert order["payment_state"] == "paid_reduced" and order["remaining_cents"] == 2000
    assert billing_orders.paid_cents(order) == 1000 and billing_orders.credited_cents(order) == 1000

    flow.act_as(kassier)
    summary = (await flow.get(f"/api/admin/finance/sources/event/{event['id']}")).json()
    assert (summary["paid_cents"], summary["credited_cents"], summary["waived_cents"], summary["open_cents"]) == (1000, 1000, 2000, 0)
    assert sum(summary[key] for key in ("paid_cents", "credited_cents", "waived_cents", "open_cents")) == summary["invoiced_cents"]


@pytest.mark.asyncio
async def test_existing_wrong_states_heal_at_the_next_read_without_a_migration(flow, fake):
    """Was vor dem Update als „teilweise“ oder „überfällig“ gespeichert wurde, ist nicht erledigt und wird alle zehn Minuten gelesen."""
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    _, _, booked, order = await invoiced(flow, kassier)
    fake.pay(order["invoice_id"], 20)
    fake.close_reduced(order["invoice_id"])
    await flow.db.billing_orders.update_one({"id": order["id"]}, {"$set": {"payment_state": "partial", "invoice_status": "paid", "paid": True, "remaining_cents": 2000}})
    result = await billing_orders.sync_due()
    assert result["looked"] == 1
    assert (await order_of(flow, booked))["payment_state"] == "paid_reduced"


@pytest.mark.asyncio
async def test_rest_zero_stays_paid_and_abandoned_stays_abandoned(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    _, _, paid_booking, paid_order = await invoiced(flow, kassier)
    fake.pay(paid_order["invoice_id"])
    _, _, lost_booking, lost_order = await invoiced(flow, kassier, name="max")
    fake.abandon(lost_order["invoice_id"], code="abandon", note="uneinbringlich")
    await billing_orders.sync_due()
    assert (await order_of(flow, paid_booking))["payment_state"] == "paid"
    lost = await order_of(flow, lost_booking)
    assert lost["payment_state"] == "abandoned" and lost["paid"] is False

    flow.act_as(kassier)
    rows = {row["id"]: row for row in (await flow.get("/api/admin/finance/overview")).json()["invoiced"]}
    assert rows[paid_order["id"]]["waived_cents"] == 0 and rows[lost_order["id"]]["waived_cents"] == 0


@pytest.mark.asyncio
async def test_a_person_sees_a_known_state_and_no_rest(flow, fake):
    """Web und App lesen ``billing_status``; ``payment_state`` geht als bekannter Wert hinaus - ein altes App-Build kennt „paid_reduced“ nicht."""
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, paula, booked, order = await invoiced(flow, kassier)
    fake.close_reduced(order["invoice_id"])
    await billing_orders.sync_due()

    flow.act_as(paula)
    price = (await flow.get(f"/api/events/{event['slug']}")).json()["own_registration"]["price"]
    assert price["billing_status"] == "paid" and price["payment_state"] == "paid"

    fresh = await order_of(flow, booked)
    assert invoice_notice.notice_text("Weihnachtsfeier", {**fresh, "invoice_status": "validated"}, fresh)["paid"] is True, "die Meldung nennt keinen offenen Betrag"


@pytest.mark.asyncio
async def test_partial_credit_note_and_offset_payment_end_as_plain_paid(flow, fake):
    """Die beiden anderen Wege aus der Kassa-Tabelle: Teil-Gutschrift angewendet und Zahlung als Verrechnung."""
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    _, _, credit_booking, credit_order = await invoiced(flow, kassier)
    fake.credit(credit_order["invoice_id"], 20)
    fake.pay(credit_order["invoice_id"])
    _, _, offset_booking, offset_order = await invoiced(flow, kassier, name="max")
    fake.pay(offset_order["invoice_id"], 20, kind="VIR")
    fake.pay(offset_order["invoice_id"], 20, kind="VERRECHNUNG")
    await billing_orders.sync_due()

    credited = await order_of(flow, credit_booking)
    assert credited["payment_state"] == "paid" and billing_orders.paid_cents(credited) == 2000 and billing_orders.credited_cents(credited) == 2000
    offset = await order_of(flow, offset_booking)
    assert offset["payment_state"] == "paid" and [p["type"] for p in offset["payments"]] == ["VIR", "VERRECHNUNG"]

    flow.act_as(kassier)
    detail = (await flow.get(f"/api/admin/finance/orders/{credited['id']}")).json()
    assert detail["sums"]["refundable_cents"] == 2000, "die Gutschrift erhöht das Limit nicht"
    assert (await billing_cases.open_count(flow.db)) == 0


@pytest.mark.asyncio
async def test_offset_payment_is_counted_once_and_never_beyond_the_booked_payments(flow, fake):
    """Festgehalten, wie es heute ist: Die Website kennt keine Zahlungsart „Verrechnung“ - jede in Dolibarr gebuchte Zahlung zählt
    zum Betrag, also auch zum Erstattungslimit. Sie zählt aber genau einmal und treibt das Limit nie über das Gebuchte."""
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    _, _, booked, order = await invoiced(flow, kassier)
    fake.pay(order["invoice_id"], 20, kind="VERRECHNUNG")
    fake.credit(order["invoice_id"], 20)
    await billing_orders.sync_due()
    await billing_orders.reconcile_due()
    order = await order_of(flow, booked)
    assert order["payment_state"] == "paid" and billing_orders.paid_cents(order) == 2000, "zweimal gelesen, einmal gezählt"

    flow.act_as(kassier)
    too_much = await flow.post(f"/api/admin/finance/orders/{order['id']}/refunds", json={"amount_cents": 2001, "paid_on": "2026-09-24", "reason": "über dem Gebuchten"})
    assert too_much.status_code == 400 and "höchstens 20,00" in too_much.json()["detail"]


def test_tournament_start_fee_shows_the_person_a_known_state_too():
    price = tournament_fees.public_price({"price_snapshot": {"total_cents": 4000, "currency": "EUR", "positions": []}, "billing_status": "paid", "payment_state": "paid_reduced", "invoice_ref": "FA-1"})
    assert price["billing_status"] == "paid" and price["payment_state"] == "paid"
