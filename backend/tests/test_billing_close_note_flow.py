"""Grund und Anmerkung des Abschlusses (#2226): ``close_code`` und ``close_note`` aus Dolibarr, am Auftrag gespeichert, nur für
die Verwaltung. Fehlen sie in der Antwort, bleibt es bei „bezahlt mit Abzug“ ohne Grund - ohne Fehler."""
import csv
import io
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from routes import dsgvo_routes  # noqa: E402
from services import billing_orders, dolibarr_billing, dolibarr_client  # noqa: E402
from test_billing_dolibarr_flow import TERMS, book, connect, order_of, paid_event, person  # noqa: E402

CONFIRMED = {"invoice_auto_validate": True, "tax_confirmed_at": "2026-09-23T10:00:00+00:00", **TERMS}
NOTE = "Begleitperson kam nicht, laut Vorstand erlassen"


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


async def invoiced(flow, kassier, name="paula"):
    event = await paid_event(flow, kassier)
    who = await person(flow, name)
    booked = await book(flow, who, event, companions=1)
    result = await billing_orders.classify_due()
    assert result["invoiced"] == 1
    return event, who, booked, await order_of(flow, booked)


async def timeline(flow, order_id: str) -> list[str]:
    return [item["text"] for item in (await flow.get(f"/api/admin/finance/orders/{order_id}")).json()["timeline"]]


def test_every_dolibarr_code_has_a_plain_sentence():
    labels = billing_orders.CLOSE_REASONS
    assert set(labels) == {"discount_vat", "badcustomer", "product_returned", "bankcharge", "withholdingtax", "other", "abandon", "replaced"}
    for code, label in labels.items():
        assert code not in label and label[0].isupper()
    assert billing_orders.close_reason({"close_code": "discount_vat"}) == labels["discount_vat"]
    assert billing_orders.close_reason({"close_code": "ganz_neu_in_dolibarr"}) == "Grund in Dolibarr nachsehen", "ein unbekannter Code wird nicht roh gezeigt"
    assert billing_orders.close_reason({}) is None and billing_orders.close_reason({"close_code": ""}) is None


def test_the_note_is_stored_as_bounded_plain_text():
    clean = dolibarr_billing.plain_close_note
    assert clean("<b>Rabatt</b> &amp; mehr\x07\n zweite Zeile") == "Rabatt & mehr\nzweite Zeile"
    assert clean("<script>alert(1)</script>") == "alert(1)"
    assert clean(None) == "" and clean(12) == "12"
    assert len(clean("x" * 5000)) == dolibarr_billing.MAX_CLOSE_NOTE


@pytest.mark.asyncio
async def test_reason_and_note_show_up_only_for_the_administration(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    event, paula, booked, order = await invoiced(flow, kassier)
    fake.core_invoices[order["invoice_id"]].update(close_code="other", close_note=NOTE, statut=2, paye=1)
    counts = await billing_orders.sync_due()
    assert counts["errors"] == 0

    order = await order_of(flow, booked)
    assert order["close_code"] == "other" and order["close_note"] == NOTE and not order.get("sync_error")
    reg = await flow.db.event_registrations.find_one({"id": booked["id"]}, {"_id": 0})
    assert "close_code" not in reg and "close_note" not in reg, "an der Anmeldung steht nichts davon"

    flow.act_as(kassier)
    [row] = (await flow.get("/api/admin/finance/overview")).json()["invoiced"]
    assert row["close_reason"] == "Sonstiger Grund" and row["close_note"] == NOTE
    detail = (await flow.get(f"/api/admin/finance/orders/{order['id']}")).json()
    assert detail["order"]["close_reason"] == "Sonstiger Grund" and detail["order"]["close_note"] == NOTE
    [line] = list(csv.DictReader(io.StringIO((await flow.get("/api/admin/finance/export.csv")).text.lstrip("﻿")), delimiter=";"))
    assert line["Grund"] == "Sonstiger Grund"
    assert NOTE not in str(line), "freier Text bleibt aus der Datei, die weitergereicht wird"

    # Die Person selbst: Anmeldung (Web und App) ohne Grund und Anmerkung.
    flow.act_as(paula)
    own = (await flow.get(f"/api/events/{event['slug']}")).json()["own_registration"]
    assert NOTE not in str(own) and "close_" not in str(own)


@pytest.mark.asyncio
async def test_missing_fields_mean_no_reason_and_no_error(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    _, _, booked, order = await invoiced(flow, kassier)
    fake.close_reduced(order["invoice_id"], code=None)
    counts = await billing_orders.sync_due()
    assert counts["errors"] == 0
    order = await order_of(flow, booked)
    assert order["payment_state"] == "paid_reduced" and not order.get("close_code") and not order.get("close_note") and not order.get("sync_error")

    flow.act_as(kassier)
    [row] = (await flow.get("/api/admin/finance/overview")).json()["invoiced"]
    assert row["payment_label"] == "bezahlt mit Abzug" and row["close_reason"] is None and not row.get("close_note")
    assert not [text for text in await timeline(flow, order["id"]) if "Abschluss" in text]


@pytest.mark.asyncio
async def test_changes_are_kept_in_the_timeline_without_copying_the_free_text(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    _, _, booked, order = await invoiced(flow, kassier)
    fake.close_reduced(order["invoice_id"], code="other", note=NOTE)
    await billing_orders.sync_due()
    await billing_orders.reconcile_due()   # derselbe Stand nochmal gelesen: keine zweite Zeile
    flow.act_as(kassier)
    assert [text for text in await timeline(flow, order["id"]) if "Abschluss" in text] == ["Abschluss in Dolibarr: Sonstiger Grund – System"]

    fake.core_invoices[order["invoice_id"]].update(close_code="discount_vat", close_note="Skonto vereinbart")
    result = await billing_orders.reconcile_due()
    assert result["changed"] == 1
    assert (await order_of(flow, booked))["close_note"] == "Skonto vereinbart"
    lines = [text for text in await timeline(flow, order["id"]) if "Abschluss" in text]
    assert len(lines) == 2 and billing_orders.CLOSE_REASONS["discount_vat"] in lines[1]

    # Nur die Anmerkung geändert: das steht auch da.
    fake.core_invoices[order["invoice_id"]].update(close_note="Skonto laut Mail")
    await billing_orders.reconcile_due()
    lines = [text for text in await timeline(flow, order["id"]) if "Abschluss" in text]
    assert len(lines) == 3 and "Anmerkung geändert" in lines[2]

    # In Dolibarr wieder geöffnet: Dolibarr leert beide Felder, der Stand geht zurück.
    fake.core_invoices[order["invoice_id"]].update(close_code=None, close_note=None, statut=1, paye=0)
    await billing_orders.reconcile_due()
    order = await order_of(flow, booked)
    assert order["payment_state"] == "open" and not order["close_code"] and not order["close_note"]
    lines = [text for text in await timeline(flow, order["id"]) if "Abschluss" in text]
    assert len(lines) == 4 and "zurückgenommen" in lines[3]

    audit = await flow.db.audit_logs.find({"target_id": order["id"], "action": "billing.invoice.close"}, {"_id": 0}).to_list(10)
    assert len(audit) == 4
    assert NOTE not in str(audit) and "Skonto" not in str(audit), "das Protokoll hält den Grund fest, nicht den freien Text"


@pytest.mark.asyncio
async def test_abandoned_invoices_keep_their_reason_too(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    _, _, booked, order = await invoiced(flow, kassier)
    fake.abandon(order["invoice_id"], code="abandon", note="uneinbringlich laut Kassa")
    await billing_orders.sync_due()
    order = await order_of(flow, booked)
    assert order["payment_state"] == "abandoned" and order["close_code"] == "abandon" and order["close_note"] == "uneinbringlich laut Kassa"
    flow.act_as(kassier)
    [row] = (await flow.get("/api/admin/finance/overview")).json()["invoiced"]
    assert row["close_reason"] == billing_orders.CLOSE_REASONS["abandon"]


@pytest.mark.asyncio
async def test_account_deletion_removes_the_note_for_good_and_the_export_names_it(flow, fake):
    await connect(flow, **CONFIRMED)
    kassier = await person(flow, "kassier", role="club_admin")
    _, paula, booked, order = await invoiced(flow, kassier)
    fake.close_reduced(order["invoice_id"], code="other", note=NOTE)
    await billing_orders.sync_due()

    # Auskunft: Die Anmerkung ist eine gespeicherte Angabe über die Person, sie gehört in die Auskunft.
    export = await dsgvo_routes._user_data_export(flow.db, paula["id"])
    [exported] = export["billing_orders"]
    assert exported["close_note"] == NOTE and exported["close_code"] == "other"

    result = await billing_orders.anonymize_user(flow.db, paula["id"])
    assert result == 1
    order = await order_of(flow, booked)
    assert "close_note" not in order and order["close_code"] == "other", "Grund als Nachweis, der freie Text ist weg"

    # Der nächste Abgleich holt sie nicht zurück - in Dolibarr bleibt sie als Beleg.
    await billing_orders.reconcile_due()
    order = await order_of(flow, booked)
    assert "close_note" not in order and order["payment_state"] == "paid_reduced"
