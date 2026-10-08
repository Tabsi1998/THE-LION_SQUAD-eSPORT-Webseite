"""Gutschrift-Entwurf bei Abmeldung (#843): mit Schalter legt der Abgleich nach einer Abmeldung bei freigegebenem Beleg
genau einen Gutschrift-Entwurf über den ganzen Betrag mit Bezug auf den Beleg an - nie freigegeben, das macht der
Kassier. Ein Entwurfs-Beleg bekommt keine Gutschrift (löschen statt gutschreiben), eine schon vorhandene Gutschrift wird
übernommen statt verdoppelt, der Prüffall nennt den Entwurf. Schalter aus = wie bisher, und das ist die Vorgabe."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import billing_cases, billing_orders, dolibarr_client  # noqa: E402
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


async def cancel(flow, who, event):
    flow.act_as(who)
    deleted = await flow.client.delete(f"/api/events/{event['id']}/registrations/me")
    assert deleted.status_code == 200


async def switch(flow, kassier, on):
    flow.act_as(kassier)
    response = await flow.put("/api/admin/finance/settings", json={"credit_note_draft_on_cancel": on})
    assert response.status_code == 200, response.text
    return response.json()


def credit_notes(fake, invoice_id):
    return [row for row in fake.core_invoices.values() if row.get("type") == 2 and int(row.get("fk_facture_source") or 0) == invoice_id]


@pytest.mark.asyncio
async def test_switch_off_is_the_default_and_behaves_as_before(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, paula, booked, order = await invoiced_booking(flow, fake, kassier)
    flow.act_as(kassier)
    assert (await flow.get("/api/admin/finance/overview")).json()["dolibarr"]["credit_note_draft_on_cancel"] is False
    await cancel(flow, paula, event)
    await billing_orders.sync_due()
    assert credit_notes(fake, order["invoice_id"]) == [] and fake.credit_posts == []
    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["kind"] == "cancelled_after_invoice" and "credit_note" not in case["detail"]


@pytest.mark.asyncio
async def test_switch_on_creates_exactly_one_draft_with_reference_and_full_amount(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, paula, booked, order = await invoiced_booking(flow, fake, kassier)
    await switch(flow, kassier, True)
    await cancel(flow, paula, event)
    # Die Abmeldung fragt Dolibarr nicht - sie merkt nur vor.
    assert fake.credit_posts == []
    marked = await order_of(flow, booked)
    assert marked["credit_note_due_at"]

    counts = await billing_orders.sync_due()
    assert counts["credit_drafts"] == 1
    [draft] = credit_notes(fake, order["invoice_id"])
    original = fake.core_invoices[order["invoice_id"]]
    assert draft["statut"] == 0, "nur ein Entwurf - freigeben tut der Kassier"
    assert draft["socid"] == original["socid"] and draft["total_ttc"] == -original["total_ttc"]
    assert [line["subprice"] for line in draft["lines"]] == [-line["subprice"] for line in original["lines"]]
    assert draft["ref_ext"] == f"credit-{original['ref_ext']}"
    assert not any(path.endswith(f"/invoices/{draft['id']}/validate") for path, _ in fake.calls), "nie freigegeben"

    order = await order_of(flow, booked)
    assert order["credit_note_id"] == draft["id"] and order["credit_note_source"] == "website" and "credit_note_due_at" not in order
    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["status"] == "open" and case["detail"]["credit_note_ref"] == draft["ref"]
    assert case["detail"]["credit_note"].startswith(f"Gutschrift-Entwurf {draft['ref']} über den ganzen Betrag liegt in Dolibarr bereit")

    # Weitere Läufe legen nichts doppelt an.
    await billing_orders.sync_due()
    await billing_orders.reconcile_due()
    assert len(credit_notes(fake, order["invoice_id"])) == 1 and len(fake.credit_posts) == 1

    # Der Kassier gibt den Entwurf in Dolibarr frei: der Abgleich erledigt den Prüffall von selbst (wie bisher).
    fake.core_invoices[draft["id"]].update(statut=1, ref="AV2609-0099")
    await billing_orders.sync_due(full=True)
    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["status"] == "resolved" and "AV2609-0099" in case["resolution"]


@pytest.mark.asyncio
async def test_an_existing_credit_note_is_linked_not_doubled(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, paula, booked, order = await invoiced_booking(flow, fake, kassier)
    await switch(flow, kassier, True)
    await cancel(flow, paula, event)
    # Der Kassier war schneller und hat die Gutschrift schon von Hand angelegt (Entwurf).
    by_hand = fake.credit(order["invoice_id"], 20.0, validated=False)
    await billing_orders.sync_due()
    assert fake.credit_posts == [] and len(credit_notes(fake, order["invoice_id"])) == 1
    order = await order_of(flow, booked)
    assert order["credit_note_id"] == by_hand["id"] and order["credit_note_source"] == "dolibarr"


@pytest.mark.asyncio
async def test_draft_invoice_gets_no_credit_note_the_case_says_delete(flow, fake):
    await connect(flow, **{**CONFIRMED, "invoice_auto_validate": False})
    kassier = await person(flow, "kassier", role="club_admin")
    from test_billing_dolibarr_flow import book, paid_event
    event = await paid_event(flow, kassier)
    paula = await person(flow, "paula")
    booked = await book(flow, paula, event, companions=1)
    assert (await billing_orders.classify_due())["invoiced"] == 1
    await switch(flow, kassier, True)
    await cancel(flow, paula, event)
    await billing_orders.sync_due()
    order = await order_of(flow, booked)
    assert credit_notes(fake, order["invoice_id"]) == [] and fake.credit_posts == []
    assert order.get("credit_note_note") == "draft_invoice" and "credit_note_due_at" not in order
    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["detail"]["credit_note"].startswith("Der Beleg ist noch Entwurf – in Dolibarr löschen")


@pytest.mark.asyncio
async def test_switching_off_drops_pending_drafts_and_only_finance_may_switch(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, paula, booked, order = await invoiced_booking(flow, fake, kassier)
    await switch(flow, kassier, True)
    await cancel(flow, paula, event)
    off = await switch(flow, kassier, False)
    assert off == {"credit_note_draft_on_cancel": False, "dropped": 1}
    await billing_orders.sync_due()
    assert fake.credit_posts == []
    audit = await flow.db.audit_logs.count_documents({"action": "billing.settings.credit_note_draft", "actor_id": kassier["id"]})
    assert audit == 2
    turnier = await person(flow, "turnier", role="tournament_admin")
    flow.act_as(turnier)
    assert (await flow.put("/api/admin/finance/settings", json={"credit_note_draft_on_cancel": True})).status_code == 403


@pytest.mark.asyncio
async def test_failure_is_named_in_the_case_and_retried_at_most_three_times(flow, fake, monkeypatch):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, paula, booked, order = await invoiced_booking(flow, fake, kassier)
    await switch(flow, kassier, True)
    await cancel(flow, paula, event)

    async def refused(self, payload):
        raise dolibarr_client.DolibarrError("forbidden", 403)

    monkeypatch.setattr(dolibarr_client.DolibarrClient, "create_invoice", refused)
    for _ in range(4):
        await billing_orders.sync_due()
    order = await order_of(flow, booked)
    assert order["credit_note_attempts"] == 3 and "credit_note_due_at" not in order and "credit_note_id" not in order
    [case] = await billing_cases.cases_for_order(flow.db, order["id"])
    assert case["detail"]["credit_note"].startswith("Gutschrift-Entwurf nicht angelegt:") and case["detail"]["credit_note"].endswith("bitte von Hand in Dolibarr anlegen.")
