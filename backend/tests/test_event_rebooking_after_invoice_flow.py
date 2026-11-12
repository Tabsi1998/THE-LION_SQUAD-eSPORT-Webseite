"""Nach Storno wieder angemeldet, obwohl es zur Buchung schon einen Beleg gibt (#2184).

Wer sich selbst storniert und bei freiem Platz direkt neu anmeldet, bekommt keinen zweiten Auftrag und keinen neuen Preis:
Der Beleg in Dolibarr wird nie still ersetzt, die Finanzverwaltung bekommt einen Prüffall mit alt und neu - wie beim
Reaktivieren durch die Leitung (#2127). Die Anmeldung zeigt wieder den Stand dieses Belegs, die Nachricht nennt keinen
Betrag, der so nicht abgerechnet wird. Gibt es noch keinen Beleg (oder ist der Entwurf in Dolibarr gelöscht, #2226), gilt
der neue Preis mit eigenem Auftrag. Dolibarr ist nur der Fake, Namen sind erfunden."""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import billing_cases, billing_orders, dolibarr_billing, dolibarr_client, event_registration  # noqa: E402
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
    classified = await billing_orders.classify_due()
    assert classified["invoiced"] == 1
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
    classified = await billing_orders.classify_due()
    assert classified["looked"] == 0, "nichts wird neu abgerechnet"

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
    classified = await billing_orders.classify_due()
    assert classified["invoiced"] == 1


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
    assert "booking_state" not in stored and "credit_note_due_at" not in stored and stored.get("booking_cancelled_at")
    assert [entry["state"] for entry in stored["booking_events"]] == ["cancelled", "restored"]

    fake.pay(order["invoice_id"])
    counts = await billing_orders.sync_due()
    assert counts["credit_drafts"] == 0, "keine Gutschrift für eine Buchung, die wieder gilt"
    cases = await open_cases(flow, order)
    assert "paid_after_cancel" not in cases and "changed_after_invoice" in cases
    assert "cancelled_after_invoice" in cases, "den Storno-Fall erledigt die Finanzverwaltung mit Grund"
    summary = await billing_orders.source_summary(flow.db, "event", event["id"])
    assert summary["booked_cents"] == 4000 and summary["paid_cents"] == 4000


async def cancelled_with_credit_draft_due(flow, fake):
    """Freigegebener Beleg, Schalter „Gutschrift-Entwurf bei Abmeldung“ an, selbst storniert: Der Entwurf ist vorgemerkt."""
    await connect(flow, **TERMS, credit_note_draft_on_cancel=True)
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    paula = await person(flow, "paula")
    booked = await book(flow, paula, event, companions=1)
    await billing_orders.classify_due()
    await settle(flow, fake, await order_of(flow, booked), "validated")
    await cancel_self(flow, event, paula)
    order = await order_of(flow, booked)
    assert order["booking_state"] == "cancelled" and order.get("credit_note_due_at")
    return event, paula, booked, order


@pytest.mark.asyncio
async def test_rueckkehr_waehrend_haengendem_gutschrift_merker_legt_keinen_entwurf_an(flow, fake):
    """Der Gutschrift-Lauf hat den Auftrag schon beansprucht (Merker), da kommt die Person zurück. Gibt der Lauf den Merker nach
    einem Fehler wieder frei, legt der nächste trotzdem keinen Entwurf an: Die Buchung gilt wieder."""
    event, paula, booked, order = await cancelled_with_credit_draft_due(flow, fake)
    await flow.db.billing_orders.update_one({"id": order["id"]}, {"$set": {"credit_note_claim_at": "2026-01-01T00:00:00+00:00"}})
    await book(flow, paula, event, companions=0)
    await flow.db.billing_orders.update_one({"id": order["id"]}, {"$unset": {"credit_note_claim_at": ""}})

    counts = await billing_orders.sync_due()
    assert counts["credit_drafts"] == 0
    assert "credit_note_id" not in await order_of(flow, booked)
    settings = await dolibarr_client.load_settings(flow.db)
    result = await dolibarr_billing.draft_credit_note(flow.db, settings, dolibarr_client.DolibarrClient(settings), order)
    assert result == "skipped", "auch mit dem alten Stand des Auftrags in der Hand"


@pytest.mark.asyncio
async def test_rueckkehr_mitten_im_gutschrift_lauf_legt_keinen_entwurf_an(flow, fake, monkeypatch):
    """Der Lauf hat den Auftrag beansprucht und fragt Dolibarr, da kommt die Person zurück: Vor dem Anlegen sieht er nach."""
    event, paula, booked, order = await cancelled_with_credit_draft_due(flow, fake)
    original = dolibarr_client.DolibarrClient.credit_notes_of

    async def meanwhile_back(self, invoice_id):
        await flow.db.billing_orders.update_one({"id": order["id"]}, {"$unset": {"booking_state": ""}})
        return await original(self, invoice_id)

    monkeypatch.setattr(dolibarr_client.DolibarrClient, "credit_notes_of", meanwhile_back)
    settings = await dolibarr_client.load_settings(flow.db)
    result = await dolibarr_billing.draft_credit_note(flow.db, settings, dolibarr_client.DolibarrClient(settings), order)
    assert result == "skipped"
    stored = await order_of(flow, booked)
    assert "credit_note_id" not in stored and "credit_note_due_at" not in stored and "credit_note_claim_at" not in stored


@pytest.mark.asyncio
async def test_verlauf_zeigt_jeden_storno_und_jede_rueckkehr(flow, fake):
    """Der Verlauf des Auftrags verliert den Storno nicht, wenn die Person zurückkommt, und zeigt die Rückkehr - auch zweimal."""
    kassier, event, paula, booked, order = await drafted(flow)
    order = await settle(flow, fake, order, "validated")
    for _ in range(2):
        await cancel_self(flow, event, paula)
        await book(flow, paula, event, companions=0)
    flow.act_as(kassier)
    detail = (await flow.get(f"/api/admin/finance/orders/{order['id']}")).json()
    texts = [item["text"] for item in detail["timeline"]]
    assert texts.count("Buchung storniert: Anmeldung storniert") == 2
    assert texts.count(f"Buchung wieder aufgenommen: {SELF_REASON}") == 2
    stored = await order_of(flow, booked)
    assert "booking_state" not in stored and [entry["state"] for entry in stored["booking_events"]] == ["cancelled", "restored"] * 2


@pytest.mark.asyncio
async def test_protokoll_der_leitung_ohne_preis_und_belegfelder(flow, fake):
    """Das Protokoll nennt, was die Leitung geändert hat - nicht den eingefrorenen Preis (mit E-Mail und Name der Person) und nicht
    die Belegfelder, die mit der Rückbuchung kommen. Wie beim Ändern durch die Person selbst."""
    kassier, event, paula, booked, order = await drafted(flow)
    await settle(flow, fake, order, "validated")
    flow.act_as(kassier)
    url = f"/api/events/{event['id']}/registrations/{booked['id']}"
    for status in ("cancelled", "registered"):
        response = await flow.patch(url, json={"status": status})
        assert response.status_code == 200, response.text
    rows = await flow.db.audit_logs.find({"action": "event.registration.update", "target_id": event["id"]}, {"_id": 0}).to_list(10)
    assert [row["data"]["updates"] for row in rows] == [{"status": "cancelled"}, {"status": "registered"}]


@pytest.mark.asyncio
async def test_rueckkehr_kurz_vor_dem_anlegen_der_gutschrift_wird_ein_prueffall(flow, fake, monkeypatch):
    """Das letzte Fenster lässt sich nicht schließen: Die Person kommt zurück, unmittelbar bevor Dolibarr den Gutschrift-Entwurf
    anlegt. Dann bleibt der Entwurf am Auftrag vermerkt, und die Finanzverwaltung bekommt einen eigenen Prüffall: löschen."""
    event, paula, booked, order = await cancelled_with_credit_draft_due(flow, fake)
    original = dolibarr_client.DolibarrClient.create_invoice

    async def back_right_before(self, payload):
        await book(flow, paula, event, companions=0)
        return await original(self, payload)

    monkeypatch.setattr(dolibarr_client.DolibarrClient, "create_invoice", back_right_before)
    counts = await billing_orders.sync_due()
    monkeypatch.setattr(dolibarr_client.DolibarrClient, "create_invoice", original)

    assert counts["credit_drafts"] == 1
    stored = await order_of(flow, booked)
    assert stored.get("credit_note_id") and "booking_state" not in stored, "der Entwurf ist vermerkt, die Buchung gilt"
    assert "credit_note_due_at" not in stored and "credit_note_claim_at" not in stored and "credit_note_returned_at" not in stored
    case = (await open_cases(flow, order)).get("credit_after_return")
    assert case and case["detail"]["credit_note_ref"] == stored["credit_note_ref"], "Finanzen löscht den Entwurf in Dolibarr"
    assert billing_cases.case_view(case)["label"] == "Gutschrift-Entwurf trotz Rückkehr"
    assert case["detail"]["returned_at"], "die Rückkehr hat den laufenden Gutschrift-Lauf vermerkt"
    assert (await registration(flow, booked))["status"] == "registered"


@pytest.mark.asyncio
async def test_altauftrag_ohne_verlaufsliste_behaelt_den_ersten_storno(flow, fake):
    """Ein Auftrag von vor dieser Änderung kennt nur ``booking_cancelled_at``. Die erste Rückkehr übernimmt diesen Storno in den
    Verlauf, sonst überschriebe ihn der nächste Storno, und er ginge verloren."""
    kassier, event, paula, booked, order = await drafted(flow)
    order = await settle(flow, fake, order, "validated")
    await cancel_self(flow, event, paula)
    await flow.db.billing_orders.update_one({"id": order["id"]}, {"$unset": {"booking_events": ""}})
    legacy = await order_of(flow, booked)
    first_cancel = legacy["booking_cancelled_at"]
    for _ in range(2):
        await book(flow, paula, event, companions=0)
        await cancel_self(flow, event, paula)
    await book(flow, paula, event, companions=0)

    stored = await order_of(flow, booked)
    assert [entry["state"] for entry in stored["booking_events"]] == ["cancelled", "restored"] * 3
    assert stored["booking_events"][0]["at"] == first_cancel
    flow.act_as(kassier)
    texts = [item["text"] for item in (await flow.get(f"/api/admin/finance/orders/{order['id']}")).json()["timeline"]]
    assert texts.count("Buchung storniert: Anmeldung storniert") == 3 and texts.count(f"Buchung wieder aufgenommen: {SELF_REASON}") == 3


@pytest.mark.asyncio
async def test_rueckkehr_nach_dem_anlegen_der_gutschrift_wird_ein_prueffall(flow, fake):
    """Der Gutschrift-Entwurf liegt schon in Dolibarr, dann kommt die Person zurück: Der Beleg gilt weiter, der Entwurf muss weg."""
    event, paula, booked, order = await cancelled_with_credit_draft_due(flow, fake)
    counts = await billing_orders.sync_due()
    assert counts["credit_drafts"] == 1
    await book(flow, paula, event, companions=0)
    stored = await order_of(flow, booked)
    assert "booking_state" not in stored and stored.get("credit_note_id")
    case = (await open_cases(flow, order)).get("credit_after_return")
    assert case and case["detail"]["credit_note_ref"] == stored["credit_note_ref"]


class _ReturnAfterRead:
    """Die Datenbank des Gutschrift-Laufs: Gleich nachdem er den Stand der Buchung gelesen hat, kommt die Person zurück."""

    def __init__(self, db, comeback):
        self._db, self._comeback, self.fired = db, comeback, False

    def __getattr__(self, name):
        target = getattr(self._db, name)
        return _ReturnAfterReadCollection(target, self) if name == "billing_orders" else target


class _ReturnAfterReadCollection:
    def __init__(self, collection, gate):
        self._collection, self._gate = collection, gate

    def __getattr__(self, name):
        return getattr(self._collection, name)

    async def find_one(self, *args, **kwargs):
        document = await self._collection.find_one(*args, **kwargs)
        projection = args[1] if len(args) > 1 else kwargs.get("projection") or {}
        if "credit_note_returned_at" in projection and not self._gate.fired:
            self._gate.fired = True
            await self._gate._comeback()
        return document


@pytest.mark.asyncio
async def test_rueckkehr_gleich_nach_dem_lesen_im_gutschrift_lauf_wird_ein_prueffall(flow, fake):
    """Das Fenster nach dem letzten Lesen: Der Lauf hat „storniert“ gelesen, dann kommt die Person zurück, dann schreibt er den
    Entwurf an den Auftrag. Auch so bekommt die Finanzverwaltung den Fall „Gutschrift-Entwurf trotz Rückkehr“."""
    event, paula, booked, order = await cancelled_with_credit_draft_due(flow, fake)
    gate = _ReturnAfterRead(flow.db, lambda: book(flow, paula, event, companions=0))
    settings = await dolibarr_client.load_settings(flow.db)
    result = await dolibarr_billing.draft_credit_note(gate, settings, dolibarr_client.DolibarrClient(settings), await order_of(flow, booked))
    assert result == "created" and gate.fired
    stored = await order_of(flow, booked)
    assert "booking_state" not in stored and stored.get("credit_note_id") and "credit_note_returned_at" not in stored
    assert "credit_after_return" in await open_cases(flow, order)


class _ReturnAfterDraftRemoved(_ReturnAfterRead):
    """Die Datenbank des Abgleichs: Gleich nachdem er den gelöschten Entwurf am Auftrag vermerkt hat, meldet sich die Person neu an."""

    def __getattr__(self, name):
        target = getattr(self._db, name)
        return _ReturnAfterDraftRemovedCollection(target, self) if name == "billing_orders" else target


class _ReturnAfterDraftRemovedCollection(_ReturnAfterReadCollection):
    async def find_one(self, *args, **kwargs):
        return await self._collection.find_one(*args, **kwargs)

    async def update_one(self, query, update, *args, **kwargs):
        result = await self._collection.update_one(query, update, *args, **kwargs)
        if "removed_invoices" in (update.get("$push") or {}) and not self._gate.fired:
            self._gate.fired = True
            await self._gate._comeback()
        return result


@pytest.mark.asyncio
async def test_neuanmeldung_mitten_im_entfernen_des_entwurfs_behaelt_ihren_auftrag(flow, fake):
    """Der Abgleich hat den gelöschten Entwurf am Auftrag vermerkt, da meldet sich die Person neu an (neuer Preis, neuer Auftrag).
    Sein zweiter Schritt - die Anmeldung auf „storniert“ setzen - trifft nur die Anmeldung, die zu genau diesem Beleg gehört."""
    kassier, event, paula, booked, order = await drafted(flow)
    await cancel_self(flow, event, paula)
    stale = await order_of(flow, booked)
    fake.remove(order["invoice_id"])
    gate = _ReturnAfterDraftRemoved(flow.db, lambda: book(flow, paula, event, companions=0))
    settings = await dolibarr_client.load_settings(flow.db)
    await dolibarr_billing.sync_one(gate, settings, dolibarr_client.DolibarrClient(settings), stale)
    assert gate.fired
    reg = await registration(flow, booked)
    assert reg["status"] == "registered" and reg["billing_status"] == "pending", "die Neuanmeldung bleibt abzurechnen"
    fresh = await flow.db.billing_orders.find_one({"registration_id": booked["id"], "status": "pending"}, {"_id": 0})
    assert fresh and reg["price_snapshot"]["hash"] == fresh["snapshot"]["hash"]


@pytest.mark.asyncio
@pytest.mark.parametrize("dolibarr_fails", [False, True])
async def test_merker_der_rueckkehr_bleibt_nach_dem_gutschrift_lauf_nicht_liegen(flow, fake, monkeypatch, dolibarr_fails):
    """Die Rückkehr kommt, während der Lauf Dolibarr fragt (Merker gesetzt). Ob er danach nichts anlegt oder an Dolibarr scheitert:
    Der Merker ist danach weg - sonst stünde er bei einem späteren Lauf noch da."""
    event, paula, booked, order = await cancelled_with_credit_draft_due(flow, fake)
    original = dolibarr_client.DolibarrClient.credit_notes_of

    async def back_meanwhile(self, invoice_id):
        await book(flow, paula, event, companions=0)
        assert (await order_of(flow, booked)).get("credit_note_returned_at"), "die Rückkehr hat den laufenden Lauf vermerkt"
        if dolibarr_fails:
            raise dolibarr_client.DolibarrError("unavailable", 503, None)
        return await original(self, invoice_id)

    monkeypatch.setattr(dolibarr_client.DolibarrClient, "credit_notes_of", back_meanwhile)
    settings = await dolibarr_client.load_settings(flow.db)
    result = await dolibarr_billing.draft_credit_note(flow.db, settings, dolibarr_client.DolibarrClient(settings), order)
    assert result == ("failed" if dolibarr_fails else "skipped")
    stored = await order_of(flow, booked)
    assert "credit_note_returned_at" not in stored and "credit_note_claim_at" not in stored and "credit_note_id" not in stored


@pytest.mark.asyncio
async def test_abmelden_bei_belegter_platzsperre_sagt_gleich_nochmal(flow, fake, monkeypatch):
    """Hält gerade eine andere Anmeldung die Platzsperre, sagt das Abmelden nicht „viele melden sich an“, sondern „gleich nochmal“ -
    auf der Website wie im Discord. Die Anmeldung bleibt bestehen."""
    from datetime import timedelta

    from models import now_utc
    from services import discord_registration

    await flow.db.mutation_locks.create_index("resource", unique=True)   # wie in der echten Datenbank: eine Sperre je Event
    kassier, event, paula, booked, order = await drafted(flow)
    await flow.db.platform_links.insert_one({"id": "l-paula", "user_id": paula["id"], "platform": "discord", "external_id": "300000000000000078",
                                             "handle": "paula"})
    await flow.db.mutation_locks.insert_one({"resource": event_registration.seat_resource(event["id"]), "owner": "anderer-worker",
                                             "expires_at": now_utc() + timedelta(minutes=1)})
    monkeypatch.setattr(event_registration, "SEAT_WAIT_SECONDS", 0.0)

    flow.act_as(paula)
    web = await flow.delete(f"/api/events/{event['id']}/registrations/me")
    assert web.status_code == 409 and web.json()["detail"] == event_registration.CANCEL_BUSY
    discord = await discord_registration.handle_button(flow.db, "300000000000000078", f"tls:unreg:event:{event['id']}")
    assert discord.get("content") == event_registration.CANCEL_BUSY
    assert (await registration(flow, booked))["status"] == "registered"


async def credited_then_new_invoice(flow, fake):
    """Beleg A freigegeben, Storno, volle Gutschrift, Neuanmeldung: Auftrag B mit eigenem Beleg - zwei Aufträge an einer Anmeldung."""
    kassier, event, paula, booked, order = await drafted(flow)
    order = await settle(flow, fake, order, "validated")
    await cancel_self(flow, event, paula)
    fake.credit(order["invoice_id"], 40)
    await billing_orders.sync_due()
    await book(flow, paula, event, companions=0)
    classified = await billing_orders.classify_due()
    assert classified["invoiced"] == 1
    old, new = await flow.db.billing_orders.find({"registration_id": booked["id"]}, {"_id": 0}).sort("created_at", 1).to_list(5)
    assert old["id"] == order["id"] and new["status"] == "invoiced" and old["payment_state"] == "credited"
    return kassier, event, paula, booked, old, new


async def open_kinds(flow, order):
    return set(await open_cases(flow, order))


async def stored_order(flow, order):
    return await flow.db.billing_orders.find_one({"id": order["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_aenderung_nach_neuem_beleg_trifft_den_neuen_auftrag(flow, fake):
    """Ändert die Leitung die Begleitpersonen, gehören Prüffall und Vermerk an den Auftrag mit dem gültigen Beleg (B), nicht an den
    alten, gutgeschriebenen (A)."""
    kassier, event, paula, booked, old, new = await credited_then_new_invoice(flow, fake)
    flow.act_as(kassier)
    changed = await flow.patch(f"/api/events/{event['id']}/registrations/{booked['id']}", json={"companion_count": 2})
    assert changed.status_code == 200, changed.text
    assert "changed_after_invoice" in await open_kinds(flow, new)
    assert "changed_after_invoice" not in await open_kinds(flow, old)
    assert (await stored_order(flow, new))["booking_change"] == "Begleitpersonen geändert"
    assert not (await stored_order(flow, old)).get("booking_change")


@pytest.mark.asyncio
async def test_zweiter_zyklus_rueckkehr_trifft_den_neuen_auftrag(flow, fake):
    """Auch B wird storniert, die Person kommt wieder: Rückbuchung, Prüffall und Vermerk gehören an B."""
    kassier, event, paula, booked, old, new = await credited_then_new_invoice(flow, fake)
    await cancel_self(flow, event, paula)
    await book(flow, paula, event, companions=0)
    assert await flow.db.billing_orders.count_documents({"registration_id": booked["id"]}) == 2
    stored = await stored_order(flow, new)
    assert "booking_state" not in stored and stored["booking_change"] == SELF_REASON
    assert "changed_after_invoice" in await open_kinds(flow, new)
    assert "changed_after_invoice" not in await open_kinds(flow, old)
    assert not (await stored_order(flow, old)).get("booking_changed_at")


@pytest.mark.asyncio
async def test_warteliste_und_zurueck_mit_gueltigem_neuen_beleg_ist_keine_reaktivierung(flow, fake):
    """Der alte Auftrag A bleibt für immer „storniert“ - das macht ein Hin und Her über die Warteliste mit gültigem Beleg B nicht zur
    Rückkehr nach einem Storno: kein Prüffall, kein neuer Preis."""
    kassier, event, paula, booked, old, new = await credited_then_new_invoice(flow, fake)
    before = await registration(flow, booked)
    flow.act_as(kassier)
    url = f"/api/events/{event['id']}/registrations/{booked['id']}"
    for status in ("waitlist", "registered"):
        response = await flow.patch(url, json={"status": status})
        assert response.status_code == 200, response.text
    assert await open_kinds(flow, new) == set() and "changed_after_invoice" not in await open_kinds(flow, old)
    assert await flow.db.billing_orders.count_documents({"registration_id": booked["id"]}) == 2
    assert (await registration(flow, booked))["price_snapshot"]["hash"] == before["price_snapshot"]["hash"]


@pytest.mark.asyncio
@pytest.mark.parametrize("finance_did", ["deleted", "resolved_only"])
async def test_erneute_rueckkehr_oeffnet_den_gutschrift_fall_nicht_wieder(flow, fake, finance_did):
    """Der Fall „Gutschrift-Entwurf trotz Rückkehr“ ist erledigt (der Entwurf gelöscht oder bewusst behalten). Storniert die Person
    erneut und kommt wieder, öffnet er sich nicht noch einmal für denselben Entwurf."""
    event, paula, booked, order = await cancelled_with_credit_draft_due(flow, fake)
    await billing_orders.sync_due()
    await book(flow, paula, event, companions=0)
    case = (await open_cases(flow, order))["credit_after_return"]
    await billing_cases.resolve_case(flow.db, case["id"], "kassier", "Entwurf in Dolibarr gelöscht")
    if finance_did == "deleted":
        fake.core_invoices.pop((await stored_order(flow, order))["credit_note_id"], None)
    await flow.db.billing_orders.update_one({"id": order["id"]}, {"$set": {"synced_at": "2000-01-01T00:00:00+00:00"}})
    await billing_orders.sync_due()
    await cancel_self(flow, event, paula)
    await billing_orders.sync_due()
    await book(flow, paula, event, companions=0)
    assert "credit_after_return" not in await open_kinds(flow, order)
    assert "booking_state" not in await stored_order(flow, order), "die Rückkehr selbst gilt"


async def sync_with(flow, order):
    """Ein Abgleich, der den Auftrag gelesen hat, bevor die Person zurückkam - er hält den alten Stand in der Hand."""
    settings = await dolibarr_client.load_settings(flow.db)
    return await dolibarr_billing.sync_one(flow.db, settings, dolibarr_client.DolibarrClient(settings), order)


@pytest.mark.asyncio
async def test_abgleich_mit_altem_stand_meldet_keine_zahlung_auf_stornierte_buchung(flow, fake):
    kassier, event, paula, booked, order = await drafted(flow)
    order = await settle(flow, fake, order, "validated")
    await cancel_self(flow, event, paula)
    stale = await order_of(flow, booked)
    await book(flow, paula, event, companions=0)
    fake.pay(order["invoice_id"])
    await sync_with(flow, stale)
    cases = await open_cases(flow, order)
    assert "paid_after_cancel" not in cases and "changed_after_invoice" in cases


@pytest.mark.asyncio
async def test_abgleich_mit_altem_stand_beendet_den_auftrag_nach_geloeschtem_entwurf_nicht(flow, fake):
    kassier, event, paula, booked, order = await drafted(flow)
    await cancel_self(flow, event, paula)
    stale = await order_of(flow, booked)
    await book(flow, paula, event, companions=0)
    fake.remove(order["invoice_id"])
    await sync_with(flow, stale)
    stored = await order_of(flow, booked)
    assert stored["status"] == "held" and stored["removed_invoices"]
    assert (await registration(flow, booked))["billing_status"] == "pending"


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
    assert not reg.get("invoice_ref") and not reg.get("invoice_id"), "der alte Beleg steht nicht mehr an der Anmeldung"
    body = (await last_note(flow, paula))["body"]
    assert KEPT_INVOICE not in body and ("40,00" if by_lead else "20,00") in body, "der neue Preis wird abgerechnet - die Nachricht nennt ihn"
    invoiced = await billing_orders.classify_due()
    assert invoiced["invoiced"] == 1, "der neue Auftrag wird ein neuer Beleg"


@pytest.mark.asyncio
@pytest.mark.parametrize("by_lead", [False, True])
async def test_tagesabgleich_spiegelt_den_alten_beleg_nicht_zurueck(flow, fake, by_lead):
    """Nach der Rückkehr mit neuem Auftrag liest der Tagesabgleich den alten, voll gutgeschriebenen Beleg wieder. Er gehört nicht
    mehr zur Anmeldung: Sie behält den neuen Preis ohne alten Beleg, und eine spätere Änderung trifft den neuen Auftrag."""
    kassier, event, paula, booked, order = await drafted(flow)
    order = await settle(flow, fake, order, "validated")
    url = f"/api/events/{event['id']}/registrations/{booked['id']}"
    if by_lead:
        flow.act_as(kassier)
        gone = await flow.patch(url, json={"status": "cancelled"})
        assert gone.status_code == 200, gone.text
    else:
        await cancel_self(flow, event, paula)
    fake.credit(order["invoice_id"], 40)
    await billing_orders.sync_due()
    if by_lead:
        flow.act_as(kassier)
        back = await flow.patch(url, json={"status": "registered"})
        assert back.status_code == 200, back.text
    else:
        await book(flow, paula, event, companions=0)
    before = await registration(flow, booked)

    await flow.db.billing_orders.update_one({"id": order["id"]}, {"$set": {"synced_at": "2000-01-01T00:00:00+00:00"}})
    looked = await billing_orders.sync_due()
    assert looked["looked"] >= 1, "der alte Beleg wird wirklich wieder gelesen"
    reg = await registration(flow, booked)
    assert reg["billing_status"] == "pending" and not reg.get("invoice_id") and not reg.get("payment_state")
    assert reg["price_snapshot"]["hash"] == before["price_snapshot"]["hash"]

    flow.act_as(kassier)
    changed = await flow.patch(url, json={"companion_count": 2})
    assert changed.status_code == 200, changed.text
    assert "changed_after_invoice" not in await open_cases(flow, order), "der alte Auftrag bekommt keinen Prüffall"


@pytest.mark.asyncio
@pytest.mark.parametrize("by_lead", [False, True])
@pytest.mark.parametrize("meanwhile", ["credited", "abandoned", "removed"])
async def test_abgleich_zwischen_auswahl_und_rueckbuchung_ergibt_neuen_auftrag(flow, fake, monkeypatch, meanwhile, by_lead):
    """Die Rückkehr hat den Beleg als gültig gelesen, da liest der Abgleich eine volle Gutschrift, ein Aufgeben oder einen
    gelöschten Entwurf. Die Rückbuchung prüft im selben Zug noch einmal - und weicht auf den aktuellen Preis mit eigenem Auftrag aus."""
    kassier, event, paula, booked, order = await drafted(flow)
    if meanwhile != "removed":
        order = await settle(flow, fake, order, "validated")
    url = f"/api/events/{event['id']}/registrations/{booked['id']}"
    if by_lead:
        flow.act_as(kassier)
        gone = await flow.patch(url, json={"status": "cancelled"})
        assert gone.status_code == 200, gone.text
    else:
        await cancel_self(flow, event, paula)
    original = billing_orders.invoiced_order
    change = {"credited": lambda: fake.credit(order["invoice_id"], 40), "abandoned": lambda: fake.abandon(order["invoice_id"]),
              "removed": lambda: fake.remove(order["invoice_id"])}[meanwhile]

    async def read_then_sync(db, **kwargs):
        found = await original(db, **kwargs)
        assert found, "beim Auswählen gilt der Beleg noch"
        change()
        await billing_orders.sync_due()
        return found

    monkeypatch.setattr(billing_orders, "invoiced_order", read_then_sync)
    if by_lead:
        flow.act_as(kassier)
        response = await flow.patch(url, json={"status": "registered"})
        assert response.status_code == 200, response.text
    else:
        await book(flow, paula, event, companions=0)
    monkeypatch.setattr(billing_orders, "invoiced_order", original)

    orders = await flow.db.billing_orders.find({"registration_id": booked["id"]}, {"_id": 0}).to_list(5)
    fresh = [row for row in orders if row["id"] != order["id"]]
    new_cents = 4000 if by_lead else 2000
    assert [(row["status"], row["total_cents"]) for row in fresh] == [("pending", new_cents)], "neuer Auftrag zum aktuellen Preis"
    assert "changed_after_invoice" not in await open_cases(flow, order), "kein Prüffall zu einem Beleg, der nicht mehr gilt"
    reg = await registration(flow, booked)
    assert reg["status"] == "registered" and reg["billing_status"] == "pending" and reg["price_snapshot"]["hash"] == fresh[0]["snapshot"]["hash"]
    assert not reg.get("invoice_ref") and not reg.get("invoice_id")
    body = (await last_note(flow, paula))["body"]
    assert KEPT_INVOICE not in body and ("40,00" if by_lead else "20,00") in body


@pytest.mark.asyncio
async def test_storno_und_gleichzeitige_neuanmeldung_laufen_nacheinander(flow, fake, monkeypatch):
    """Die Person storniert und meldet sich im selben Moment wieder an (zwei Geräte, Website und Discord). Das Storno storniert
    erst die Anmeldung, dann den Auftrag - dazwischen darf keine Neuanmeldung zurückbuchen, sonst stünde der Auftrag danach
    wieder auf „storniert“, obwohl die Person dabei ist. Beide gehen unter derselben Platzsperre."""
    await flow.db.mutation_locks.create_index("resource", unique=True)   # wie in der echten Datenbank: eine Sperre je Event
    kassier, event, paula, booked, order = await drafted(flow)
    await settle(flow, fake, order, "validated")
    stored_event = await flow.db.events.find_one({"id": event["id"]}, {"_id": 0})
    started, go = asyncio.Event(), asyncio.Event()
    original = billing_orders.cancel_orders_for

    async def paused(db, **kwargs):
        started.set()
        await asyncio.wait_for(go.wait(), 5)
        return await original(db, **kwargs)

    monkeypatch.setattr(billing_orders, "cancel_orders_for", paused)
    cancelling = asyncio.create_task(event_registration.cancel(flow.db, stored_event, paula))
    await asyncio.wait_for(started.wait(), 5)
    registering = asyncio.create_task(event_registration.register(flow.db, stored_event, paula))
    await asyncio.sleep(0.3)
    go.set()
    await cancelling
    back = await registering
    monkeypatch.setattr(billing_orders, "cancel_orders_for", original)

    assert back["status"] == "registered"
    stored = await order_of(flow, booked)
    assert "booking_state" not in stored, "die Person ist dabei - der Auftrag gilt als gebucht"
    assert [entry["state"] for entry in stored["booking_events"]] == ["cancelled", "restored"]
    assert "changed_after_invoice" in await open_cases(flow, order)


@pytest.mark.asyncio
async def test_rueckbuchung_ist_wiederholbar(flow, fake):
    """Ist die Buchung schon zurück, gilt eine zweite Rückbuchung als erledigt - ohne zweiten Verlaufseintrag."""
    kassier, event, paula, booked, order = await drafted(flow)
    await settle(flow, fake, order, "validated")
    await cancel_self(flow, event, paula)
    stale = await order_of(flow, booked)
    for _ in range(2):
        kept = await billing_orders.rebook_after_invoice(flow.db, stale, reason=SELF_REASON, new_total_cents=2000)
        assert kept is True
    stored = await order_of(flow, booked)
    assert "booking_state" not in stored and [entry["state"] for entry in stored["booking_events"]] == ["cancelled", "restored"]


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
