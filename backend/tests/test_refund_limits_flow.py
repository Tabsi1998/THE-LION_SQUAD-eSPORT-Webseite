"""Erstattungen am Rechnungsauftrag (#1034): nie mehr als bezahlt - auch gleichzeitig und beim erneuten Senden.

Zwei Kassiere (oder zwei Browserfenster) erfassen im selben Augenblick eine Erstattung: zusammen dürfen sie den
bezahlten Betrag nicht übersteigen. Kommt dieselbe Erfassung ein zweites Mal an (Antwort verloren, erneut
geklickt), entsteht kein zweiter Eintrag.
"""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr  # noqa: E402
from flow_harness import InterleavedReads, make_flow  # noqa: E402
from services import billing_orders, dolibarr_client  # noqa: E402
from test_billing_cases_flow import CONFIRMED, invoiced_booking  # noqa: E402
from test_billing_dolibarr_flow import connect, order_of, person  # noqa: E402


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


async def paid_order(flow, fake):
    """Ein bezahlter Beleg über 40 € - die Kassierin ist angemeldet."""
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    _, _, booked, order = await invoiced_booking(flow, fake, kassier)
    fake.pay(order["invoice_id"])
    assert (await billing_orders.sync_due())["paid"] == 1
    flow.act_as(kassier)
    return booked, await order_of(flow, booked)


def refund(flow, order, amount_cents, **extra):
    payload = {"amount_cents": amount_cents, "paid_on": "2026-10-13", "reason": "Begleitperson entfallen", **extra}
    return flow.post(f"/api/admin/finance/orders/{order['id']}/refunds", json=payload)


def gated(monkeypatch, flow) -> None:
    """Beide Anfragen lesen den Auftrag, bevor eine von ihnen schreibt - wie zwei Worker auf echtem MongoDB."""
    from routes import finance_routes

    gate = InterleavedReads(flow.db, "billing_orders")
    monkeypatch.setattr(finance_routes, "get_db", lambda: gate)


@pytest.mark.asyncio
async def test_two_refunds_at_once_never_exceed_what_was_paid(flow, fake, monkeypatch):
    booked, order = await paid_order(flow, fake)
    gated(monkeypatch, flow)

    first, second = await asyncio.gather(refund(flow, order, 3000), refund(flow, order, 3000))

    assert sorted([first.status_code, second.status_code]) == [200, 400]
    stored = await order_of(flow, booked)
    assert billing_orders.refunded_cents(stored) == 3000 and len(stored["refunds"]) == 1
    assert await flow.db.audit_logs.count_documents({"action": "billing.refund.record", "target_id": order["id"]}) == 1


@pytest.mark.asyncio
async def test_two_smaller_refunds_at_once_both_count_when_they_fit(flow, fake, monkeypatch):
    booked, order = await paid_order(flow, fake)
    gated(monkeypatch, flow)

    first, second = await asyncio.gather(refund(flow, order, 1500), refund(flow, order, 2500))

    assert first.status_code == 200 and second.status_code == 200
    assert billing_orders.refunded_cents(await order_of(flow, booked)) == 4000


@pytest.mark.asyncio
async def test_the_same_refund_sent_twice_is_recorded_once(flow, fake, monkeypatch):
    booked, order = await paid_order(flow, fake)

    once = await refund(flow, order, 1000, request_id="erfassung-1")
    again = await refund(flow, order, 1000, request_id="erfassung-1")
    assert once.status_code == 200 and again.status_code == 200
    assert again.json()["refund"]["id"] == once.json()["refund"]["id"]

    gated(monkeypatch, flow)
    together = await asyncio.gather(*(refund(flow, order, 500, request_id="erfassung-2") for _ in range(2)))
    assert [r.status_code for r in together] == [200, 200]
    assert together[0].json()["refund"]["id"] == together[1].json()["refund"]["id"]

    stored = await order_of(flow, booked)
    assert billing_orders.refunded_cents(stored) == 1500 and len(stored["refunds"]) == 2
    assert await flow.db.audit_logs.count_documents({"action": "billing.refund.record", "target_id": order["id"]}) == 2

    # Eine neue Erfassung mit demselben Betrag ist eine zweite Erstattung.
    assert (await refund(flow, order, 1000, request_id="erfassung-3")).status_code == 200
    assert billing_orders.refunded_cents(await order_of(flow, booked)) == 2500


ENTRY = {"paid_on": "2026-10-13", "reference": "", "reason": "Rest"}


@pytest.mark.asyncio
async def test_a_refund_prepared_before_the_payment_shrank_is_not_written(flow, fake):
    booked, order = await paid_order(flow, fake)
    before = order  # So hat die Kassierin den Auftrag gelesen: 40 € bezahlt.

    # Dazwischen meldet Dolibarr nur noch 10 € Zahlung, der Abgleich übernimmt das.
    fake.core_invoices[order["invoice_id"]].update(
        payments=[{"amount": "10.00", "date": "2026-09-23", "type": "VIR", "ref": "PAY-1", "num": ""}],
        remaintopay=30.0, statut=1, paye=0)
    assert (await flow.post(f"/api/admin/finance/orders/{order['id']}/resync")).status_code == 200
    synced = await order_of(flow, booked)
    assert billing_orders.paid_cents(synced) == 1000

    with pytest.raises(billing_orders.RefundError):
        await billing_orders.add_refund(flow.db, before, "kassier", amount_cents=3000, **ENTRY)
    assert billing_orders.refunded_cents(await order_of(flow, booked)) == 0

    await billing_orders.add_refund(flow.db, before, "kassier", amount_cents=1000, **ENTRY)
    stored = await order_of(flow, booked)
    assert billing_orders.refunded_cents(stored) == 1000
    # Abgleich und Erstattung zählen beide die Revision hoch.
    assert int(synced.get("money_rev") or 0) > int(before.get("money_rev") or 0)
    assert stored["money_rev"] == synced["money_rev"] + 1
