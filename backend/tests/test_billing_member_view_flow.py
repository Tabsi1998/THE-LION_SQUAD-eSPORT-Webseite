"""„Meine Rechnungen“ bei einem Abschluss mit Abzug (#2226): bezahlt heißt bezahlt - kein offener Rest, keine Anmerkung,
auch nicht in Meldung und Mail. Web und App lesen dieselbe Antwort."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import billing_orders, dolibarr_client  # noqa: E402
from services.dolibarr_invoices import summarize, view_core_invoice, view_invoice  # noqa: E402
from test_billing_dolibarr_flow import TERMS, book, connect, order_of, paid_event, person  # noqa: E402

CONFIRMED = {"invoice_auto_validate": True, "tax_confirmed_at": "2026-09-23T10:00:00+00:00", **TERMS}
NOTE = "Begleitperson kam nicht, laut Vorstand erlassen"
SETTINGS = {"base_url": "https://erp.example.test"}


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


def test_a_paid_invoice_never_shows_a_rest_whichever_way_it_comes():
    core = view_core_invoice({"id": 8, "ref": "FA-8", "statut": 2, "paye": 1, "total_ttc": 40, "remaintopay": 20, "close_code": "other", "close_note": NOTE}, SETTINGS)
    assert core["status"] == "paid" and core["status_label"] == "bezahlt" and core["remaining"] == 0 and core["can_pay"] is False
    assert NOTE not in str(core) and "close_" not in str(core)
    # Über das Vereinsmodul kommt derselbe Beleg mit Status und Rest.
    module = view_invoice({"id": 9, "ref": "FA-9", "type": "standard", "status": "paid", "total": 40, "remaining": 20}, SETTINGS)
    assert module["remaining"] == 0 and module["status_label"] == "bezahlt"
    assert summarize([{**core}, {**module}])["open_total"] == 0
    # Noch offene Belege behalten ihren Rest.
    still_open = view_core_invoice({"id": 10, "ref": "FA-10", "statut": 1, "paye": 0, "total_ttc": 40, "remaintopay": 20}, SETTINGS, today="2026-09-23")
    assert still_open["status"] == "open" and still_open["remaining"] == 20


@pytest.mark.asyncio
async def test_my_invoices_show_paid_without_rest_and_without_note(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    paula = await person(flow, "paula")
    booked = await book(flow, paula, event, companions=1)
    await billing_orders.classify_due()
    order = await order_of(flow, booked)
    fake.pay(order["invoice_id"], 20)
    fake.close_reduced(order["invoice_id"], code="other", note=NOTE)
    await billing_orders.sync_due()

    flow.act_as(paula)
    data = (await flow.get("/api/account/invoices")).json()
    [row] = data["invoices"]
    assert row["status"] == "paid" and row["remaining"] == 0 and data["summary"]["open_total"] == 0 and data["summary"]["open_count"] == 0
    assert NOTE not in str(data) and "close_" not in str(data)

    # Dolibarr weg: der letzte Stand aus dem Zwischenspeicher sagt dasselbe - auch einer von vor dem Update.
    await flow.db.dolibarr_invoice_cache.update_one({"user_id": paula["id"]}, {"$set": {"invoices.0.remaining": 20}})
    fake.fail_with = 503
    cached = (await flow.get("/api/account/invoices")).json()
    assert cached["available"] is False and cached["invoices"][0]["remaining"] == 0 and cached["summary"]["open_total"] == 0


@pytest.mark.asyncio
async def test_notice_and_mail_never_carry_the_note(flow, fake):
    """Ein Entwurf wird in Dolibarr freigegeben und gleich mit Abzug geschlossen: die Meldung sagt „bezahlt“, mehr nicht."""
    await connect(flow, **TERMS)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    paula = await person(flow, "paula")
    booked = await book(flow, paula, event)
    await billing_orders.classify_due()
    order = await order_of(flow, booked)
    assert order["invoice_status"] == "draft"
    fake.hand_validate(order["invoice_id"])
    fake.close_reduced(order["invoice_id"], code="other", note=NOTE)
    await billing_orders.sync_due()

    notices = await flow.db.notifications.find({"user_id": paula["id"], "kind": "invoice_ready"}, {"_id": 0}).to_list(5)
    mails = await flow.db.mail_jobs.find({"template_key": "invoice_ready"}, {"_id": 0}).to_list(5)
    assert len(notices) == 1 and "bezahlt" in notices[0]["body"]
    assert NOTE not in str(notices) and NOTE not in str(mails)
