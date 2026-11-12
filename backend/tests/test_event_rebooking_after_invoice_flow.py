"""Nach Storno wieder angemeldet, obwohl es zur Buchung schon einen Beleg gibt (#2184).

Wer sich selbst storniert und bei freiem Platz direkt neu anmeldet, bekommt keinen zweiten Auftrag und keinen neuen Preis:
Der Beleg in Dolibarr wird nie still ersetzt, die Finanzverwaltung bekommt einen Prüffall mit alt und neu - wie beim
Reaktivieren durch die Leitung (#2127). Die Anmeldung zeigt wieder den Stand dieses Belegs, die Nachricht nennt keinen
Betrag, der so nicht abgerechnet wird. Gibt es noch keinen Beleg (oder ist der Entwurf in Dolibarr gelöscht, #2226), gilt
der neue Preis mit eigenem Auftrag. Dolibarr ist nur der Fake, Namen sind erfunden."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import billing_cases, billing_orders, dolibarr_client  # noqa: E402
from services.event_notifications import KEPT_INVOICE, KIND, kept_invoice_line, price_to_bill  # noqa: E402
from test_billing_dolibarr_flow import TERMS, book, connect, order_of, paid_event, person  # noqa: E402

SELF_REASON = "Nach Storno selbst neu angemeldet"
LEAD_REASON = "Anmeldung wieder aktiviert"


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
    """Eine Buchung mit einer Begleitperson (2 x 20 €) bis zum Entwurf in Dolibarr."""
    await connect(flow, **TERMS)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    who = await person(flow, name)
    booked = await book(flow, who, event, companions=1)
    assert (await billing_orders.classify_due())["invoiced"] == 1
    order = await order_of(flow, booked)
    assert order["invoice_status"] == "draft"
    return kassier, event, who, booked, order


async def settle(flow, fake, order, how):
    """Den Beleg in Dolibarr weiterbringen - so, wie der Kassier es dort tut - und nachlesen."""
    if how in ("validated", "paid", "paid_reduced"):
        fake.hand_validate(order["invoice_id"])
    if how == "paid":
        fake.pay(order["invoice_id"])
    if how == "paid_reduced":
        fake.pay(order["invoice_id"], 30)
        fake.close_reduced(order["invoice_id"])
    await billing_orders.sync_due()
    order = await flow.db.billing_orders.find_one({"id": order["id"]}, {"_id": 0})
    expected = {"draft": "draft", "validated": "open", "paid": "paid", "paid_reduced": "paid_reduced"}[how]
    assert order["payment_state"] == expected, order.get("payment_state")
    return order


async def cancel_self(flow, event, who):
    flow.act_as(who)
    gone = await flow.delete(f"/api/events/{event['id']}/registrations/me")
    assert gone.status_code == 200, gone.text


async def registration(flow, booked):
    return await flow.db.event_registrations.find_one({"id": booked["id"]}, {"_id": 0})


async def last_note(flow, user):
    rows = await flow.db.notifications.find({"kind": KIND, "user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(1)
    return rows[0]


async def open_cases(flow, order):
    return {case["kind"]: case for case in await billing_cases.cases_for_order(flow.db, order["id"]) if case["status"] == "open"}


async def assert_review(flow, booked, order, *, reason, new_cents, billing_status):
    """Kein zweiter Auftrag, kein neuer Preis - ein Prüffall mit alt und neu, die Anmeldung zeigt den Beleg."""
    orders = await flow.db.billing_orders.find({"registration_id": booked["id"]}, {"_id": 0}).to_list(5)
    assert [row["id"] for row in orders] == [order["id"]], "kein zweiter Auftrag"
    stored = orders[0]
    assert stored["status"] == "invoiced" and stored["booking_change"] == reason
    changed = (await open_cases(flow, stored)).get("changed_after_invoice")
    assert changed, "Finanzen bekommt einen Prüffall"
    assert changed["detail"]["reason"] == reason
    assert changed["detail"]["invoiced_cents"] == 4000 and changed["detail"]["new_total_cents"] == new_cents
    assert (await billing_orders.classify_due())["looked"] == 0, "nichts wird neu abgerechnet"

    reg = await registration(flow, booked)
    assert reg["status"] == "registered"
    assert reg["price_snapshot"]["hash"] == stored["snapshot"]["hash"], "der Preis ist der des Belegs, kein neuer"
    assert reg["billing_status"] == billing_status
    assert reg["invoice_ref"] == stored["invoice_ref"] and reg["payment_state"] == stored["payment_state"]
    return stored


@pytest.mark.asyncio
@pytest.mark.parametrize("how,billing_status", [("validated", "invoiced"), ("paid", "paid"), ("paid_reduced", "paid"), ("draft", "invoiced")])
@pytest.mark.parametrize("synced_between", [False, True])
async def test_selbst_storniert_und_neu_angemeldet_mit_beleg_ergibt_einen_prueffall(flow, fake, how, billing_status, synced_between):
    kassier, event, paula, booked, order = await drafted(flow)
    order = await settle(flow, fake, order, how)
    await cancel_self(flow, event, paula)
    assert "cancelled_after_invoice" in await open_cases(flow, order)
    if synced_between:
        # Der Abgleich liest den Beleg zwischendurch neu - die stornierte Anmeldung trägt dann wieder seinen Stand.
        await billing_orders.sync_due()

    again = await book(flow, paula, event, companions=0)
    assert again["id"] == booked["id"] and again["status"] == "registered"
    await assert_review(flow, booked, order, reason=SELF_REASON, new_cents=2000, billing_status=billing_status)

    note = await last_note(flow, paula)
    assert note["title"].startswith("Du bist dabei") and "Kostenbeitrag" not in note["body"] and "20,00" not in note["body"]
    assert KEPT_INVOICE in note["body"], "kein Betrag, aber der Hinweis auf die bestehende Rechnung"

    flow.act_as(paula)
    own = (await flow.get(f"/api/events/{event['slug']}")).json()["own_registration"]
    assert own["price"]["total_cents"] == 4000 and own["price"]["billing_status"] == billing_status

    flow.act_as(kassier)
    overview = (await flow.get("/api/admin/finance/overview")).json()
    listed = [case for case in overview["cases"] if case["kind"] == "changed_after_invoice"]
    assert len(listed) == 1 and listed[0]["detail"]["reason"] == SELF_REASON

    # Der nächste Abgleich ändert daran nichts: kein zweiter Beleg, der Prüffall bleibt offen.
    await billing_orders.sync_due()
    assert await flow.db.billing_orders.count_documents({"registration_id": booked["id"]}) == 1
    assert "changed_after_invoice" in await open_cases(flow, order)


@pytest.mark.asyncio
async def test_noch_kein_beleg_neuer_preis_mit_eigenem_auftrag(flow, fake):
    """Der Auftrag war noch nicht in Dolibarr: Er ist mit dem Storno zu, die neue Anmeldung hat ihren eigenen - nichts zu prüfen."""
    await connect(flow, **TERMS)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    paula = await person(flow, "paula")
    booked = await book(flow, paula, event, companions=1)
    await cancel_self(flow, event, paula)
    await book(flow, paula, event, companions=0)

    orders = await flow.db.billing_orders.find({"registration_id": booked["id"]}, {"_id": 0}).to_list(5)
    assert sorted((row["status"], row["total_cents"]) for row in orders) == [("cancelled", 4000), ("pending", 2000)]
    assert await flow.db.billing_cases.count_documents({"registration_id": booked["id"]}) == 0
    reg = await registration(flow, booked)
    assert reg["billing_status"] == "pending" and reg["price_snapshot"]["total_cents"] == 2000
    fresh = (await last_note(flow, paula))["body"]
    assert "20,00" in fresh and KEPT_INVOICE not in fresh, "der neue Preis wird abgerechnet - die Nachricht nennt ihn"


@pytest.mark.asyncio
@pytest.mark.parametrize("removed_before_cancel", [True, False])
async def test_geloeschter_entwurf_ist_kein_beleg_mehr(flow, fake, removed_before_cancel):
    """Der Entwurf ist in Dolibarr gelöscht (#2226), vor oder nach dem Storno: Es gibt nichts mehr zu ersetzen - der neue Preis
    bekommt seinen eigenen Auftrag, und daraus wird ein neuer Beleg."""
    kassier, event, paula, booked, order = await drafted(flow)
    if removed_before_cancel:
        fake.remove(order["invoice_id"])
        await billing_orders.sync_due()
        assert (await order_of(flow, booked))["status"] == "held"
    await cancel_self(flow, event, paula)
    if not removed_before_cancel:
        fake.remove(order["invoice_id"])
        await billing_orders.sync_due()
    assert (await order_of(flow, booked))["status"] == "cancelled"

    await book(flow, paula, event, companions=0)
    orders = await flow.db.billing_orders.find({"registration_id": booked["id"]}, {"_id": 0}).to_list(5)
    assert sorted((row["status"], row["total_cents"]) for row in orders) == [("cancelled", 4000), ("pending", 2000)]
    assert await flow.db.billing_cases.count_documents({"registration_id": booked["id"], "status": "open"}) == 0
    reg = await registration(flow, booked)
    assert reg["billing_status"] == "pending" and reg["price_snapshot"]["total_cents"] == 2000
    assert (await billing_orders.classify_due())["invoiced"] == 1


@pytest.mark.asyncio
async def test_entwurf_nach_der_neuanmeldung_geloescht_der_prueffall_bleibt(flow, fake):
    """Erst neu angemeldet (Prüffall), dann löscht der Kassier den alten Entwurf: Der Fall „Buchung nach dem Beleg geändert“
    bleibt offen - der Preis passt nicht mehr, das entscheidet die Finanzverwaltung."""
    kassier, event, paula, booked, order = await drafted(flow)
    await cancel_self(flow, event, paula)
    await book(flow, paula, event, companions=0)
    fake.remove(order["invoice_id"])
    await billing_orders.sync_due()
    cases = await open_cases(flow, order)
    assert "changed_after_invoice" in cases and "cancelled_after_invoice" not in cases
    # Die Buchung ist wieder da: Der Auftrag wartet auf die Entscheidung der Finanzverwaltung, statt mit dem Storno zu enden.
    stored = await order_of(flow, booked)
    assert stored["status"] == "held" and stored["removed_invoices"]
    assert (await registration(flow, booked))["billing_status"] == "pending"


@pytest.mark.asyncio
@pytest.mark.parametrize("by_lead", [False, True])
async def test_zurueck_nach_storno_gilt_am_auftrag_wieder_als_gebucht(flow, fake, by_lead):
    """Der Auftrag vergisst den Storno, sobald die Person zurück ist (#2184): kein vorgemerkter Gutschrift-Entwurf mehr, eine
    Zahlung ist keine „Zahlung auf stornierte Buchung“, und die Summe der Veranstaltung zählt die Buchung wieder."""
    await connect(flow, **TERMS, credit_note_draft_on_cancel=True)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    paula = await person(flow, "paula")
    booked = await book(flow, paula, event, companions=1)
    await billing_orders.classify_due()
    order = await settle(flow, fake, await order_of(flow, booked), "validated")
    url = f"/api/events/{event['id']}/registrations/{booked['id']}"
    if by_lead:
        flow.act_as(kassier)
        gone = await flow.patch(url, json={"status": "cancelled"})
        assert gone.status_code == 200, gone.text
    else:
        await cancel_self(flow, event, paula)
    cancelled = await order_of(flow, booked)
    assert cancelled["booking_state"] == "cancelled" and cancelled.get("credit_note_due_at"), "Gutschrift-Entwurf ist vorgemerkt"

    if by_lead:
        flow.act_as(kassier)
        response = await flow.patch(url, json={"status": "registered"})
        assert response.status_code == 200, response.text
    else:
        await book(flow, paula, event, companions=0)
    stored = await order_of(flow, booked)
    assert "booking_state" not in stored and "credit_note_due_at" not in stored and stored.get("booking_restored_at")

    fake.pay(order["invoice_id"])
    counts = await billing_orders.sync_due()
    assert counts["credit_drafts"] == 0, "keine Gutschrift für eine Buchung, die wieder gilt"
    cases = await open_cases(flow, order)
    assert "paid_after_cancel" not in cases and "changed_after_invoice" in cases
    assert "cancelled_after_invoice" in cases, "den Storno-Fall erledigt die Finanzverwaltung mit Grund"
    summary = await billing_orders.source_summary(flow.db, "event", event["id"])
    assert summary["booked_cents"] == 4000 and summary["paid_cents"] == 4000


@pytest.mark.asyncio
async def test_leitung_aktiviert_nach_dem_abgleich_wieder_auch_dann_ein_prueffall(flow, fake):
    """Dieselbe Regel für die Leitung (#2127): Auch wenn der Abgleich die stornierte Anmeldung schon wieder auf den Stand des
    Belegs gesetzt hat, entsteht beim Wiederaktivieren ein Prüffall - kein stiller Wechsel zurück."""
    kassier, event, paula, booked, order = await drafted(flow)
    order = await settle(flow, fake, order, "validated")
    flow.act_as(kassier)
    url = f"/api/events/{event['id']}/registrations/{booked['id']}"
    gone = await flow.patch(url, json={"status": "cancelled"})
    assert gone.status_code == 200, gone.text
    await billing_orders.sync_due()
    assert (await registration(flow, booked))["billing_status"] == "invoiced"

    response = await flow.patch(url, json={"status": "registered"})
    assert response.status_code == 200, response.text
    await assert_review(flow, booked, order, reason=LEAD_REASON, new_cents=4000, billing_status="invoiced")
    note = await last_note(flow, paula)
    assert note["title"].startswith("Du bist wieder dabei") and "Kostenbeitrag" not in note["body"] and KEPT_INVOICE in note["body"]


@pytest.mark.asyncio
async def test_leitung_storno_warteliste_abgleich_dann_dabei_ein_prueffall(flow, fake):
    """Storniert, von der Leitung auf die Warteliste gesetzt, der Abgleich setzt den Stand des Belegs, dann nachgerückt: Es
    entscheidet der Auftrag (Buchung storniert), nicht der Stand der Anmeldung - auch hier ein Prüffall, die Buchung gilt wieder."""
    kassier, event, paula, booked, order = await drafted(flow)
    order = await settle(flow, fake, order, "validated")
    flow.act_as(kassier)
    url = f"/api/events/{event['id']}/registrations/{booked['id']}"
    for status in ("cancelled", "waitlist"):
        response = await flow.patch(url, json={"status": status})
        assert response.status_code == 200, response.text
    await billing_orders.sync_due()
    waiting = await registration(flow, booked)
    assert waiting["status"] == "waitlist" and waiting["billing_status"] == "invoiced"

    response = await flow.patch(url, json={"status": "registered"})
    assert response.status_code == 200, response.text
    stored = await assert_review(flow, booked, order, reason=LEAD_REASON, new_cents=4000, billing_status="invoiced")
    assert "booking_state" not in stored
    assert KEPT_INVOICE in (await last_note(flow, paula))["body"]


@pytest.mark.asyncio
@pytest.mark.parametrize("by_lead", [False, True])
@pytest.mark.parametrize("settled", ["credited", "abandoned"])
async def test_voll_gutgeschriebener_oder_aufgegebener_beleg_zaehlt_nicht_mehr(flow, fake, settled, by_lead):
    """Der Beleg ist in Dolibarr voll gutgeschrieben oder aufgegeben: Er gilt nicht mehr. Wer zurückkommt, bekommt den aktuellen
    Preis mit eigenem Auftrag (und daraus einen neuen Beleg), keinen Prüffall und keinen Hinweis auf eine bestehende Rechnung."""
    kassier, event, paula, booked, order = await drafted(flow)
    order = await settle(flow, fake, order, "validated")
    url = f"/api/events/{event['id']}/registrations/{booked['id']}"
    if by_lead:
        flow.act_as(kassier)
        gone = await flow.patch(url, json={"status": "cancelled"})
        assert gone.status_code == 200, gone.text
    else:
        await cancel_self(flow, event, paula)
    if settled == "credited":
        fake.credit(order["invoice_id"], 40)
    else:
        fake.abandon(order["invoice_id"])
    await billing_orders.sync_due()
    assert (await order_of(flow, booked))["payment_state"] == settled

    if by_lead:
        flow.act_as(kassier)
        response = await flow.patch(url, json={"status": "registered"})
        assert response.status_code == 200, response.text
    else:
        await book(flow, paula, event, companions=0)
    orders = await flow.db.billing_orders.find({"registration_id": booked["id"]}, {"_id": 0}).sort("created_at", 1).to_list(5)
    new_cents = 4000 if by_lead else 2000
    assert [(row["status"], row.get("booking_state")) for row in orders] == [("invoiced", "cancelled"), ("pending", None)]
    assert orders[1]["total_cents"] == new_cents
    assert "changed_after_invoice" not in await open_cases(flow, orders[0])
    reg = await registration(flow, booked)
    assert reg["billing_status"] == "pending" and reg["price_snapshot"]["hash"] == orders[1]["snapshot"]["hash"]
    body = (await last_note(flow, paula))["body"]
    assert KEPT_INVOICE not in body and ("40,00" if by_lead else "20,00") in body, "der neue Preis wird abgerechnet - die Nachricht nennt ihn"
    invoiced = await billing_orders.classify_due()
    assert invoiced["invoiced"] == 1, "der neue Auftrag wird ein neuer Beleg"


def test_nur_ein_jetzt_abgerechneter_preis_wird_genannt():
    """Dieselbe Regel für Glocke, Mail und die Discord-Antwort: kein Betrag nach der Rückbuchung auf einen Beleg oder nach dem Storno."""
    snapshot = {"total_cents": 2000, "currency": "EUR"}
    for status in (None, "pending", "invoiced", "paid"):
        assert price_to_bill({"price_snapshot": snapshot, "billing_status": status}) == snapshot
        assert price_to_bill({"price_snapshot": snapshot, "billing_status": status, "invoice_kept": True}) is None
    assert price_to_bill({"price_snapshot": snapshot, "billing_status": "cancelled"}) is None
    assert price_to_bill({"price_snapshot": {"total_cents": 0}}) is None and price_to_bill({}) is None


def test_hinweis_auf_die_bestehende_rechnung_nur_nach_einer_rueckbuchung():
    for billing_status in ("invoiced", "paid"):
        assert kept_invoice_line({"status": "registered", "billing_status": billing_status, "invoice_kept": True}) == KEPT_INVOICE
    assert kept_invoice_line({"status": "checked_in", "billing_status": "paid", "invoice_kept": True}) == KEPT_INVOICE
    for row in ({"status": "registered", "billing_status": "invoiced"}, {"status": "registered", "billing_status": "pending", "invoice_kept": True},
                {"status": "cancelled", "billing_status": "invoiced", "invoice_kept": True}, {"status": "waitlist", "billing_status": "invoiced", "invoice_kept": True}):
        assert kept_invoice_line(row) == ""


@pytest.mark.asyncio
async def test_warteliste_und_zurueck_ohne_storno_kein_hinweis_auf_eine_pruefung(flow, fake):
    """Ohne Storno (Leitung setzt auf die Warteliste und wieder zurück) gibt es keinen Prüffall - also auch keinen Satz, dass der
    Verein die Rechnung prüft. Die Nachricht bleibt wie bisher."""
    kassier, event, paula, booked, order = await drafted(flow)
    await settle(flow, fake, order, "validated")
    flow.act_as(kassier)
    url = f"/api/events/{event['id']}/registrations/{booked['id']}"
    for status in ("waitlist", "registered"):
        response = await flow.patch(url, json={"status": status})
        assert response.status_code == 200, response.text
    assert await open_cases(flow, order) == {}
    note = await last_note(flow, paula)
    assert note["title"].startswith("Nachgerückt") and KEPT_INVOICE not in note["body"]
    assert "40,00" in note["body"], "wie bisher: der Kostenbeitrag der bestehenden Rechnung"
