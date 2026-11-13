"""Turniere: nach Storno wieder dabei, obwohl es zur Anmeldung schon einen Beleg gibt (#2368) - wie bei Events (#2184).

Die Abmeldung löscht die Turnier-Anmeldung; ihr Auftrag mit Beleg bleibt „storniert“. Meldet sich dieselbe Person (bei Teams:
dieselbe zahlende Person mit demselben Team) wieder an, kommt dieselbe Anmeldung zurück: kein zweiter Auftrag, kein neuer Preis,
ein Prüffall mit alt und neu für die Finanzverwaltung - direkt, beim Nachrücken von der Warteliste und wenn die Turnierleitung
eine abgelehnte Anmeldung wieder bestätigt. Gilt der Beleg nicht mehr (voll gutgeschrieben, aufgegeben), gilt der aktuelle Preis
mit eigenem Auftrag. Nachrichten nennen dann keinen Betrag, sondern die bestehende Rechnung. Dolibarr ist nur der Fake, Namen
sind erfunden."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import billing_orders, discord_registration, dolibarr_client  # noqa: E402
from services.event_notifications import KEPT_INVOICE  # noqa: E402
from services.registration_notifications import registration_message  # noqa: E402
from test_billing_dolibarr_flow import TERMS, connect  # noqa: E402
from test_event_rebooking_after_invoice_flow import assert_no_contradicting_credit_case, open_cases, settle  # noqa: E402
from test_tournament_fees_flow import FEE, person, register, tournament  # noqa: E402

SELF_REASON = "Nach Storno selbst neu angemeldet"
LEAD_REASON = "Anmeldung wieder aktiviert"
MOVED_UP_REASON = "Nach Storno von der Warteliste nachgerückt"
# Das Startgeld steigt nach dem Beleg: Der Prüffall nennt alt (10 €) und neu (15 €), der Beleg wird nie still ersetzt.
DEARER = {"enabled": True, "positions": [{"key": "startgeld", "label": "Startgeld", "amount": "15", "basis": "per_person"}]}
DISCORD_ID = "300000000000002368"


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


async def booked_with_invoice(flow, fake, *, how="validated", credit_draft=False, max_participants=32):
    """Paula meldet sich mit Startgeld (10 €) an, der Beleg entsteht in Dolibarr und wird wie angegeben weitergebracht."""
    await connect(flow, **TERMS, **({"credit_note_draft_on_cancel": True} if credit_draft else {}))
    kassier = await person(flow, "kassier", role="club_admin")
    cup = await tournament(flow, kassier, billing=FEE, max_participants=max_participants)
    paula = await person(flow, "paula")
    response = await register(flow, paula, cup["id"], accept_costs=True)
    assert response.status_code == 200, response.text
    booked = response.json()
    assert booked["status"] == "approved"
    assert (await billing_orders.classify_due())["invoiced"] == 1
    order = await settle(flow, fake, await order_of(flow, booked), how)
    return kassier, cup, paula, booked, order


async def order_of(flow, registration):
    return await flow.db.billing_orders.find_one({"registration_id": registration["id"]}, {"_id": 0}, sort=[("created_at", 1)])


async def orders_of(flow, user):
    return await flow.db.billing_orders.find({"kind": "tournament", "user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(10)


async def stored(flow, order):
    return await flow.db.billing_orders.find_one({"id": order["id"]}, {"_id": 0})


async def registration_of(flow, cup, user):
    return await flow.db.tournament_registrations.find_one({"tournament_id": cup["id"], "user_id": user["id"]}, {"_id": 0})


async def unregister(flow, cup, who, registration):
    flow.act_as(who)
    gone = await flow.delete(f"/api/tournaments/{cup['id']}/registrations/{registration['id']}")
    assert gone.status_code == 200, gone.text


async def set_status(flow, lead, cup, registration, status):
    flow.act_as(lead)
    response = await flow.put(f"/api/tournaments/{cup['id']}/registrations/{registration['id']}", json={"status": status})
    assert response.status_code == 200, response.text
    return response.json()


async def raise_fee(flow, kassier, cup):
    flow.act_as(kassier)
    response = await flow.put(f"/api/tournaments/{cup['id']}", json={"billing": DEARER})
    assert response.status_code == 200, response.text


async def cancel(flow, cup, kassier, paula, booked, *, by_lead):
    if by_lead:
        await set_status(flow, kassier, cup, booked, "rejected")
    else:
        await unregister(flow, cup, paula, booked)


async def come_back(flow, cup, kassier, paula, booked, *, by_lead):
    if by_lead:
        return await set_status(flow, kassier, cup, booked, "approved")
    response = await register(flow, paula, cup["id"], accept_costs=True)
    assert response.status_code == 200, response.text
    return response.json()


async def last_note(flow, user):
    rows = await flow.db.notifications.find({"kind": "tournament_registration", "user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(1)
    return rows[0]


async def last_mail(flow, user):
    rows = await flow.db.mail_jobs.find({"template_key": "registration_approved", "to": user["email"]}, {"_id": 0}).to_list(20)
    return rows[-1]


async def assert_review(flow, booked, order, *, reason, new_cents, billing_status):
    """Kein zweiter Auftrag, kein neuer Preis - ein Prüffall mit alt und neu, die Anmeldung trägt wieder den Beleg."""
    orders = await flow.db.billing_orders.find({"kind": "tournament", "user_id": order["user_id"]}, {"_id": 0}).to_list(5)
    assert [row["id"] for row in orders] == [order["id"]], "kein zweiter Auftrag"
    current = orders[0]
    assert current["status"] == "invoiced" and current["booking_change"] == reason and "booking_state" not in current
    changed = (await open_cases(flow, current)).get("changed_after_invoice")
    assert changed, "Finanzen bekommt einen Prüffall"
    assert changed["detail"]["reason"] == reason
    assert changed["detail"]["invoiced_cents"] == 1000 and changed["detail"]["new_total_cents"] == new_cents
    classified = await billing_orders.classify_due()
    assert classified["looked"] == 0, "nichts wird neu abgerechnet"

    reg = await flow.db.tournament_registrations.find_one({"id": booked["id"]}, {"_id": 0})
    assert reg["status"] in ("approved", "checked_in")
    assert reg["price_snapshot"]["hash"] == current["snapshot"]["hash"], "der Preis ist der des Belegs, kein neuer"
    assert reg["billing_status"] == billing_status
    assert reg["invoice_ref"] == current["invoice_ref"] and reg["payment_state"] == current["payment_state"]
    assert "invoice_kept" not in reg, "der Merker für die Nachricht wird nie gespeichert"
    return current


# ---------------------------------------------------------------- Selbst-Weg und Leitungsweg

@pytest.mark.asyncio
@pytest.mark.parametrize("how,billing_status", [("draft", "invoiced"), ("validated", "invoiced"), ("paid", "paid")])
@pytest.mark.parametrize("synced_between", [False, True])
async def test_selbst_abgemeldet_und_neu_angemeldet_mit_beleg_ergibt_einen_prueffall(flow, fake, how, billing_status, synced_between):
    kassier, cup, paula, booked, order = await booked_with_invoice(flow, fake, how=how)
    await unregister(flow, cup, paula, booked)
    assert await registration_of(flow, cup, paula) is None, "die Abmeldung löscht die Turnier-Anmeldung"
    assert "cancelled_after_invoice" in await open_cases(flow, order)
    if synced_between:
        await billing_orders.sync_due()
    await raise_fee(flow, kassier, cup)

    again = await come_back(flow, cup, kassier, paula, booked, by_lead=False)
    assert again["id"] == booked["id"] and again["status"] == "approved", "dieselbe Anmeldung kommt zurück"
    assert again["price_snapshot"]["total_cents"] == 1000 and again.get("invoice_kept") is True
    await assert_review(flow, booked, order, reason=SELF_REASON, new_cents=1500, billing_status=billing_status)

    note = await last_note(flow, paula)
    assert note["title"].startswith("Du bist dabei") and KEPT_INVOICE in note["body"], "kein Betrag, aber der Hinweis auf die Rechnung"
    assert "schon eine Rechnung" in (await last_mail(flow, paula))["html"]

    flow.act_as(paula)
    own = next(r for r in (await flow.get(f"/api/tournaments/{cup['id']}/bracket")).json()["registrations"] if r.get("user_id") == paula["id"])
    assert own["price"]["total_cents"] == 1000 and own["price"]["billing_status"] == billing_status

    # Der nächste Abgleich ändert daran nichts: kein zweiter Beleg, der Prüffall bleibt offen.
    await billing_orders.sync_due()
    assert len(await orders_of(flow, paula)) == 1
    assert "changed_after_invoice" in await open_cases(flow, order)


@pytest.mark.asyncio
async def test_noch_kein_beleg_neue_anmeldung_mit_eigenem_auftrag(flow, fake):
    """Der Auftrag war noch nicht in Dolibarr: Er ist mit der Abmeldung zu, die neue Anmeldung hat ihren eigenen - nichts zu prüfen."""
    await connect(flow, **TERMS)
    kassier = await person(flow, "kassier", role="club_admin")
    cup = await tournament(flow, kassier, billing=FEE)
    paula = await person(flow, "paula")
    booked = (await register(flow, paula, cup["id"], accept_costs=True)).json()
    await unregister(flow, cup, paula, booked)
    again = await come_back(flow, cup, kassier, paula, booked, by_lead=False)

    assert again["id"] != booked["id"] and "invoice_kept" not in again
    assert [(row["status"], row["registration_id"]) for row in await orders_of(flow, paula)] == [("cancelled", booked["id"]), ("pending", again["id"])]
    assert await flow.db.billing_cases.count_documents({}) == 0
    assert KEPT_INVOICE not in (await last_note(flow, paula))["body"]


@pytest.mark.asyncio
@pytest.mark.parametrize("by_lead", [False, True])
async def test_zurueck_nach_storno_gilt_am_auftrag_wieder_als_gebucht(flow, fake, by_lead):
    """Der Auftrag vergisst den Storno, sobald die Person zurück ist: kein vorgemerkter Gutschrift-Entwurf mehr, eine Zahlung ist
    keine „Zahlung auf stornierte Buchung“, und die Summe des Turniers zählt die Buchung wieder."""
    kassier, cup, paula, booked, order = await booked_with_invoice(flow, fake, credit_draft=True)
    await cancel(flow, cup, kassier, paula, booked, by_lead=by_lead)
    cancelled = await stored(flow, order)
    assert cancelled["booking_state"] == "cancelled" and cancelled.get("credit_note_due_at"), "Gutschrift-Entwurf ist vorgemerkt"

    back = await come_back(flow, cup, kassier, paula, booked, by_lead=by_lead)
    assert back["id"] == booked["id"] and back.get("invoice_kept") is True
    current = await assert_review(flow, booked, order, reason=LEAD_REASON if by_lead else SELF_REASON, new_cents=1000, billing_status="invoiced")
    assert "credit_note_due_at" not in current and current.get("booking_cancelled_at")
    assert [entry["state"] for entry in current["booking_events"]] == ["cancelled", "restored"]
    assert KEPT_INVOICE in (await last_note(flow, paula))["body"]

    fake.pay(order["invoice_id"])
    counts = await billing_orders.sync_due()
    assert counts["credit_drafts"] == 0, "keine Gutschrift für eine Buchung, die wieder gilt"
    cases = await open_cases(flow, order)
    assert "paid_after_cancel" not in cases and "changed_after_invoice" in cases
    summary = await billing_orders.source_summary(flow.db, "tournament", cup["id"])
    assert summary["booked_cents"] == 1000 and summary["paid_cents"] == 1000


@pytest.mark.asyncio
async def test_leitung_bestaetigt_wieder_ohne_storno_kein_prueffall(flow, fake):
    """Gegenprobe: Ohne vorherigen Storno bleibt eine zweite Freigabe ohne Folgen - kein Prüffall, kein Hinweis."""
    kassier, cup, paula, booked, order = await booked_with_invoice(flow, fake)
    await set_status(flow, kassier, cup, booked, "pending")
    back = await set_status(flow, kassier, cup, booked, "approved")
    assert "invoice_kept" not in back
    assert "changed_after_invoice" not in await open_cases(flow, order)
    assert len(await orders_of(flow, paula)) == 1
    assert KEPT_INVOICE not in (await last_note(flow, paula))["body"]


async def checkin_status(flow, lead, cup, registration, status):
    flow.act_as(lead)
    response = await flow.post(f"/api/tournaments/{cup['id']}/registrations/{registration['id']}/checkin", json={"status": status})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("no_show_via", ["status", "checkin"])
@pytest.mark.parametrize("back_to", ["checked_in", "approved"])
async def test_nicht_erschienen_dann_doch_eingecheckt_gilt_wieder_als_gebucht(flow, fake, no_show_via, back_to):
    """„Nicht erschienen“ über den Status oder den Check-in-Dienst schließt den Auftrag; checkt der Check-in-Dienst die Person
    danach doch ein (oder setzt sie zurück), gilt die Buchung wieder - wie im Weg über den Status, ohne Gutschrift-Entwurf."""
    kassier, cup, paula, booked, order = await booked_with_invoice(flow, fake, credit_draft=True)
    if no_show_via == "status":
        await set_status(flow, kassier, cup, booked, "no_show")
    else:
        await checkin_status(flow, kassier, cup, booked, "no_show")
    cancelled = await stored(flow, order)
    assert cancelled["booking_state"] == "cancelled" and cancelled.get("credit_note_due_at"), "Nicht erschienen schließt den Auftrag"

    back = await checkin_status(flow, kassier, cup, booked, back_to)
    assert back["status"] == back_to and back.get("invoice_kept") is True
    current = await assert_review(flow, booked, order, reason=LEAD_REASON, new_cents=1000, billing_status="invoiced")
    assert "credit_note_due_at" not in current
    assert (await billing_orders.sync_due())["credit_drafts"] == 0, "keine Gutschrift für eine Buchung, die wieder gilt"


# ---------------------------------------------------------------- Warteliste nach Abgleich

@pytest.mark.asyncio
@pytest.mark.parametrize("by_lead", [False, True])
async def test_warteliste_nach_abgleich_dann_nachgerueckt_ein_prueffall(flow, fake, by_lead):
    """Storno, der Abgleich setzt den Stand des Belegs, dann über die Warteliste zurück: Entscheidend ist die Buchung am Auftrag -
    beim Nachrücken bucht die Freigabe zurück, statt einen zweiten Auftrag anzulegen."""
    kassier, cup, paula, booked, order = await booked_with_invoice(flow, fake, max_participants=1)
    if by_lead:
        await set_status(flow, kassier, cup, booked, "rejected")
        await billing_orders.sync_due()
        assert (await flow.db.tournament_registrations.find_one({"id": booked["id"]}, {"_id": 0}))["billing_status"] == "invoiced"
        await set_status(flow, kassier, cup, booked, "waitlist")
        await set_status(flow, kassier, cup, booked, "approved")
        reason = LEAD_REASON
    else:
        await unregister(flow, cup, paula, booked)
        otto = await person(flow, "otto")
        taken = (await register(flow, otto, cup["id"], accept_costs=True)).json()
        assert taken["status"] == "approved"
        await billing_orders.sync_due()
        waiting = await come_back(flow, cup, kassier, paula, booked, by_lead=False)
        assert waiting["id"] == booked["id"] and waiting["status"] == "waitlist" and "price_snapshot" not in waiting
        assert len(await orders_of(flow, paula)) == 1, "die Warteliste zahlt nichts"
        await unregister(flow, cup, otto, taken)
        reason = MOVED_UP_REASON
    await assert_review(flow, booked, order, reason=reason, new_cents=1000, billing_status="invoiced")
    note = await last_note(flow, paula)
    assert note["title"].startswith("Nachgerückt") and KEPT_INVOICE in note["body"]


@pytest.mark.asyncio
async def test_leitung_holt_selbst_zurueckgekehrte_von_der_warteliste_grund_selbst_neu_angemeldet(flow, fake):
    """Abgemeldet, selbst neu auf die Warteliste, die Turnierleitung bestätigt: Der Prüffall nennt den eigentlichen Grund - die
    Person hat sich nach dem Storno selbst neu angemeldet, die Leitung hat nichts reaktiviert."""
    kassier, cup, paula, booked, order = await booked_with_invoice(flow, fake, max_participants=1)
    await unregister(flow, cup, paula, booked)
    otto = await person(flow, "otto")
    assert (await register(flow, otto, cup["id"], accept_costs=True)).json()["status"] == "approved"
    assert (await billing_orders.classify_due())["invoiced"] == 1, "Ottos eigener Beleg"
    waiting = await come_back(flow, cup, kassier, paula, booked, by_lead=False)
    assert waiting["id"] == booked["id"] and waiting["status"] == "waitlist"
    await set_status(flow, kassier, cup, waiting, "approved")
    await assert_review(flow, booked, order, reason=SELF_REASON, new_cents=1000, billing_status="invoiced")


# ---------------------------------------------------------------- Beleg gilt nicht mehr

@pytest.mark.asyncio
@pytest.mark.parametrize("by_lead", [False, True])
@pytest.mark.parametrize("settled", ["credited", "abandoned"])
async def test_voll_gutgeschriebener_oder_aufgegebener_beleg_zaehlt_nicht_mehr(flow, fake, settled, by_lead):
    """Der Beleg ist in Dolibarr voll gutgeschrieben oder aufgegeben: Er gilt nicht mehr. Wer zurückkommt, bekommt den aktuellen
    Preis mit eigenem Auftrag (und daraus einen neuen Beleg), keinen Prüffall und keinen Hinweis auf eine bestehende Rechnung."""
    kassier, cup, paula, booked, order = await booked_with_invoice(flow, fake)
    await cancel(flow, cup, kassier, paula, booked, by_lead=by_lead)
    if settled == "credited":
        fake.credit(order["invoice_id"], 10)
    else:
        fake.abandon(order["invoice_id"])
    await billing_orders.sync_due()
    assert (await stored(flow, order))["payment_state"] == settled
    await raise_fee(flow, kassier, cup)

    back = await come_back(flow, cup, kassier, paula, booked, by_lead=by_lead)
    assert "invoice_kept" not in back
    orders = await orders_of(flow, paula)
    assert [(row["status"], row.get("booking_state"), row["total_cents"]) for row in orders] == [("invoiced", "cancelled", 1000), ("pending", None, 1500)]
    assert orders[1]["registration_id"] == back["id"]
    assert "changed_after_invoice" not in await open_cases(flow, orders[0])
    reg = await flow.db.tournament_registrations.find_one({"id": back["id"]}, {"_id": 0})
    assert reg["billing_status"] == "pending" and reg["price_snapshot"]["hash"] == orders[1]["snapshot"]["hash"]
    assert not reg.get("invoice_ref") and not reg.get("invoice_id"), "der alte Beleg steht nicht mehr an der Anmeldung"
    assert KEPT_INVOICE not in (await last_note(flow, paula))["body"]

    # Der Tagesabgleich liest den alten Beleg wieder - er gehört nicht mehr zur Anmeldung und wird nicht zurückgespiegelt.
    await flow.db.billing_orders.update_one({"id": order["id"]}, {"$set": {"synced_at": "2000-01-01T00:00:00+00:00"}})
    assert (await billing_orders.sync_due())["looked"] >= 1
    reg = await flow.db.tournament_registrations.find_one({"id": back["id"]}, {"_id": 0})
    assert reg["billing_status"] == "pending" and not reg.get("invoice_id") and not reg.get("payment_state")
    assert (await billing_orders.classify_due())["invoiced"] == 1, "der neue Auftrag wird ein neuer Beleg"


# ---------------------------------------------------------------- Gutschrift-Lauf mit Rückkehr

@pytest.mark.asyncio
@pytest.mark.parametrize("by_lead", [False, True])
async def test_rueckkehr_nach_dem_anlegen_der_gutschrift_wird_ein_prueffall(flow, fake, by_lead):
    """Der Gutschrift-Entwurf zur Abmeldung liegt schon in Dolibarr, dann kommt die Person zurück: Der Beleg gilt weiter, der
    Entwurf muss weg - der Fall „Gutschrift-Entwurf trotz Rückkehr“, der Storno-Fall erledigt sich."""
    kassier, cup, paula, booked, order = await booked_with_invoice(flow, fake, credit_draft=True)
    await cancel(flow, cup, kassier, paula, booked, by_lead=by_lead)
    assert (await billing_orders.sync_due())["credit_drafts"] == 1
    await come_back(flow, cup, kassier, paula, booked, by_lead=by_lead)
    current = await stored(flow, order)
    assert "booking_state" not in current and current.get("credit_note_id")
    case = (await open_cases(flow, order)).get("credit_after_return")
    assert case and case["detail"]["credit_note_ref"] == current["credit_note_ref"]
    await assert_no_contradicting_credit_case(flow, order)


# ---------------------------------------------------------------- Mehrere Aufträge je Anmeldung

@pytest.mark.asyncio
async def test_abgleich_zwischen_auswahl_und_rueckbuchung_ergibt_neuen_auftrag(flow, fake, monkeypatch):
    """Die Neuanmeldung hat den Beleg als gültig gelesen und die Anmeldung zurückgeholt, da liest der Abgleich eine volle
    Gutschrift. Die Rückbuchung prüft im selben Zug - dieselbe Anmeldung hat dann zwei Aufträge, der alte bleibt beim alten Beleg."""
    kassier, cup, paula, booked, order = await booked_with_invoice(flow, fake)
    await unregister(flow, cup, paula, booked)
    original = billing_orders.invoiced_order

    async def read_then_sync(db, **kwargs):
        found = await original(db, **kwargs)
        assert found, "beim Auswählen gilt der Beleg noch"
        fake.credit(order["invoice_id"], 10)
        await billing_orders.sync_due()
        return found

    monkeypatch.setattr(billing_orders, "invoiced_order", read_then_sync)
    back = await come_back(flow, cup, kassier, paula, booked, by_lead=False)
    monkeypatch.setattr(billing_orders, "invoiced_order", original)

    assert back["id"] == booked["id"] and "invoice_kept" not in back
    orders = await flow.db.billing_orders.find({"registration_id": booked["id"]}, {"_id": 0}).sort("created_at", 1).to_list(5)
    assert [(row["status"], row["total_cents"]) for row in orders] == [("invoiced", 1000), ("pending", 1000)]
    assert "changed_after_invoice" not in await open_cases(flow, order), "kein Prüffall zu einem Beleg, der nicht mehr gilt"
    reg = await flow.db.tournament_registrations.find_one({"id": booked["id"]}, {"_id": 0})
    assert reg["billing_status"] == "pending" and reg["price_snapshot"]["hash"] == orders[1]["snapshot"]["hash"]
    assert not reg.get("invoice_ref") and not reg.get("invoice_id")
    await flow.db.billing_orders.update_one({"id": order["id"]}, {"$set": {"synced_at": "2000-01-01T00:00:00+00:00"}})
    await billing_orders.sync_due()
    assert (await flow.db.tournament_registrations.find_one({"id": booked["id"]}, {"_id": 0}))["billing_status"] == "pending", \
        "der alte, gutgeschriebene Beleg spiegelt sich nicht zurück"


@pytest.mark.asyncio
@pytest.mark.parametrize("by_lead", [False, True])
async def test_zweiter_zyklus_rueckkehr_trifft_den_neuen_auftrag(flow, fake, by_lead):
    """Erster Beleg voll gutgeschrieben, zurück mit neuem Auftrag und neuem Beleg, wieder storniert, wieder zurück: Die Rückbuchung
    trifft den neuen Auftrag, der alte bleibt gutgeschrieben und storniert."""
    kassier, cup, paula, booked, order = await booked_with_invoice(flow, fake)
    await cancel(flow, cup, kassier, paula, booked, by_lead=by_lead)
    fake.credit(order["invoice_id"], 10)
    await billing_orders.sync_due()
    second = await come_back(flow, cup, kassier, paula, booked, by_lead=by_lead)
    assert (await billing_orders.classify_due())["invoiced"] == 1
    newer = (await orders_of(flow, paula))[1]
    newer = await settle(flow, fake, newer, "validated")

    await cancel(flow, cup, kassier, paula, second, by_lead=by_lead)
    back = await come_back(flow, cup, kassier, paula, second, by_lead=by_lead)
    assert back["id"] == second["id"] and back.get("invoice_kept") is True
    orders = await orders_of(flow, paula)
    assert [row["id"] for row in orders] == [order["id"], newer["id"]], "kein dritter Auftrag"
    assert orders[0]["booking_state"] == "cancelled" and "changed_after_invoice" not in await open_cases(flow, orders[0])
    assert "booking_state" not in orders[1] and "changed_after_invoice" in await open_cases(flow, orders[1])
    reg = await flow.db.tournament_registrations.find_one({"id": back["id"]}, {"_id": 0})
    assert reg["price_snapshot"]["hash"] == orders[1]["snapshot"]["hash"] and reg["invoice_ref"] == orders[1]["invoice_ref"]


# ---------------------------------------------------------------- Teams

async def team_invoiced(flow, fake):
    """Die Teamleitung meldet das Team an (5 x 10 €), der Beleg ist freigegeben; die Co-Leitung darf das Team ebenfalls anmelden."""
    await connect(flow, **TERMS)
    kassier = await person(flow, "kassier", role="club_admin")
    cup = await tournament(flow, kassier, team_mode="team", team_size=5, billing=FEE)
    leader = await person(flow, "captain")
    co_leader = await person(flow, "vize")
    await flow.db.teams.insert_one({"id": "team-1", "name": "Lions", "tag": "TLS", "leader_id": leader["id"], "co_leader_ids": [co_leader["id"]],
                                    "member_ids": [leader["id"], co_leader["id"]]})
    booked = (await register(flow, leader, cup["id"], team_id="team-1", accept_costs=True)).json()
    assert booked["price_snapshot"]["total_cents"] == 5000
    assert (await billing_orders.classify_due())["invoiced"] == 1
    order = await settle(flow, fake, await order_of(flow, booked), "validated")
    return kassier, cup, leader, co_leader, booked, order


async def team_cup(flow, fake):
    kassier, cup, leader, co_leader, booked, order = await team_invoiced(flow, fake)
    await unregister(flow, cup, leader, booked)
    return cup, leader, co_leader, booked, order


@pytest.mark.asyncio
@pytest.mark.parametrize("who", ["co_leader", "leader"])
async def test_team_nach_weggenommener_ablehnung_bucht_nur_dieselbe_zahlende_person_zurueck(flow, fake, who):
    """Abgelehnt, die Teamleitung nimmt die Ablehnung weg, das Team wird neu angemeldet (dieselbe Anmeldung kommt zur Prüfung) und
    die Turnierleitung bestätigt. Meldet die Co-Leitung neu an, zahlt sie selbst: eigener Auftrag, an ihrer Anmeldung kein fremder
    Preis, Empfänger oder Beleg - die Rechnung der Teamleitung bleibt storniert. Meldet die Teamleitung selbst neu an, gilt ihr Beleg."""
    kassier, cup, leader, co_leader, booked, order = await team_invoiced(flow, fake)
    await set_status(flow, kassier, cup, booked, "rejected")
    await unregister(flow, cup, leader, booked)   # nimmt die Ablehnung nur weg (#2113)
    payer = co_leader if who == "co_leader" else leader
    again = (await register(flow, payer, cup["id"], team_id="team-1", accept_costs=True)).json()
    assert again["id"] == booked["id"] and again["status"] == "pending"
    back = await set_status(flow, kassier, cup, again, "approved")

    if who == "leader":
        assert back.get("invoice_kept") is True and [row["id"] for row in await orders_of(flow, leader)] == [order["id"]]
        assert "booking_state" not in await stored(flow, order)
        return
    assert "invoice_kept" not in back
    assert back["price_snapshot"]["recipient"]["user_id"] == co_leader["id"]
    [own] = await orders_of(flow, co_leader)
    assert own["status"] == "pending" and own["registration_id"] == booked["id"] and own["total_cents"] == 5000
    old = await stored(flow, order)
    assert old["booking_state"] == "cancelled" and "changed_after_invoice" not in await open_cases(flow, old)
    reg = await flow.db.tournament_registrations.find_one({"id": booked["id"]}, {"_id": 0})
    assert reg["billing_status"] == "pending" and reg["price_snapshot"]["hash"] == own["snapshot"]["hash"]
    assert not reg.get("invoice_ref") and not reg.get("invoice_id"), "kein fremder Beleg an der Anmeldung"
    await flow.db.billing_orders.update_one({"id": order["id"]}, {"$set": {"synced_at": "2000-01-01T00:00:00+00:00"}})
    await billing_orders.sync_due()
    reg = await flow.db.tournament_registrations.find_one({"id": booked["id"]}, {"_id": 0})
    assert reg["billing_status"] == "pending" and not reg.get("invoice_ref"), "der Abgleich spiegelt die Rechnung der Teamleitung nicht"
    assert (await billing_orders.classify_due())["invoiced"] == 1, "die Co-Leitung bekommt ihre eigene Rechnung"


@pytest.mark.asyncio
async def test_team_dieselbe_teamleitung_meldet_neu_an_ein_prueffall(flow, fake):
    cup, leader, co_leader, booked, order = await team_cup(flow, fake)
    back = (await register(flow, leader, cup["id"], team_id="team-1", accept_costs=True)).json()
    assert back["id"] == booked["id"] and back.get("invoice_kept") is True
    assert [row["id"] for row in await orders_of(flow, leader)] == [order["id"]]
    current = await stored(flow, order)
    assert "booking_state" not in current and current["booking_change"] == SELF_REASON


@pytest.mark.asyncio
async def test_team_anderes_mitglied_meldet_neu_an_eigener_auftrag(flow, fake):
    """Die Co-Leitung meldet das Team neu an und übernimmt die Kosten selbst: Die Rechnung der Teamleitung geht nicht auf sie
    über - eigener Auftrag, der alte bleibt storniert (Gutschrift an die Teamleitung) und bekommt keinen Prüffall „geändert“."""
    cup, leader, co_leader, booked, order = await team_cup(flow, fake)
    back = (await register(flow, co_leader, cup["id"], team_id="team-1", accept_costs=True)).json()
    assert back["id"] != booked["id"] and "invoice_kept" not in back
    assert back["price_snapshot"]["recipient"]["user_id"] == co_leader["id"]
    [own] = await orders_of(flow, co_leader)
    assert own["status"] == "pending" and own["registration_id"] == back["id"]
    old = await stored(flow, order)
    assert old["booking_state"] == "cancelled"
    cases = await open_cases(flow, old)
    assert "cancelled_after_invoice" in cases and "changed_after_invoice" not in cases

    # Solo statt Team ist ebenfalls eine andere Anmeldung - die Teamleitung allein bekäme hier keinen Rückweg auf den Teambeleg.
    from services import tournament_fees
    assert await tournament_fees.returning_registration_id(flow.db, cup, payer_id=leader["id"], team_id=None) is None


# ---------------------------------------------------------------- Discord

@pytest.mark.asyncio
async def test_discord_nennt_nach_der_rueckbuchung_keinen_betrag(flow, fake):
    kassier, cup, paula, booked, order = await booked_with_invoice(flow, fake)
    await flow.db.platform_links.insert_one({"id": "l-paula", "user_id": paula["id"], "platform": "discord", "external_id": DISCORD_ID, "handle": "paula"})
    await unregister(flow, cup, paula, booked)

    reply = await discord_registration.handle_button(flow.db, DISCORD_ID, f"tls:reg:tournament:{cup['id']}")
    text = reply.get("content") or ""
    assert "angemeldet" in text and "Startgeld:" not in text and "10,00" not in text
    assert KEPT_INVOICE in text, "kein Betrag, aber der Hinweis auf die bestehende Rechnung"
    assert [row["id"] for row in await orders_of(flow, paula)] == [order["id"]]
    assert "changed_after_invoice" in await open_cases(flow, order)


# ---------------------------------------------------------------- Texte

def test_bestaetigung_nennt_die_bestehende_rechnung_nur_nach_einer_rueckbuchung():
    cup = {"title": "Herbst-Cup"}
    kept = {"status": "approved", "billing_status": "invoiced", "invoice_kept": True}
    message = registration_message(cup, "approved", registration=kept)
    assert KEPT_INVOICE in message["body"] and KEPT_INVOICE in message["detail"]
    moved = registration_message(cup, "approved", "waitlist", registration=kept)
    assert moved["title"].startswith("Nachgerückt") and KEPT_INVOICE in moved["body"]
    for registration in ({"status": "approved", "billing_status": "invoiced"}, {**kept, "billing_status": "pending"}, None):
        assert KEPT_INVOICE not in registration_message(cup, "approved", registration=registration)["body"]
