"""Rechnungs-PDF gleich beim Freigeben (#840): Dolibarrs Schnittstelle baut beim Freigeben keins - die Website lässt es
über `PUT /documents/builddoc` erzeugen, in der eingestellten Sprache. Scheitert das, bleibt die Anmeldung gültig und der
Grund steht am Auftrag; der Abgleich versucht es wieder (auch für Belege, die in Dolibarr von Hand freigegeben wurden),
und „Fehlende PDFs nachziehen“ holt die bestehenden Belege nach. Gäste laden ihr PDF über `/documents/download`."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import billing_orders, dolibarr_client  # noqa: E402
from test_billing_invoice_terms_flow import TERMS, book, connect, paid_event, person  # noqa: E402

LIVE = {"invoice_auto_validate": True, "tax_confirmed_at": "2026-09-23T10:00:00+00:00", **TERMS}


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


async def invoiced(flow, fake, name="gast", **settings):
    """Eine bezahlpflichtige Anmeldung bis zum Beleg - gibt Kassier, Person und Auftrag zurück."""
    await connect(flow, **{**LIVE, **settings})
    kassier = await person(flow, "kassier", role="club_admin")
    event = await paid_event(flow, kassier)
    guest = await person(flow, name)
    booked = await book(flow, guest, event)
    assert (await billing_orders.classify_due())["invoiced"] == 1
    order = await flow.db.billing_orders.find_one({"registration_id": booked["id"]}, {"_id": 0})
    return kassier, guest, order


@pytest.mark.asyncio
async def test_validated_invoice_gets_its_pdf_right_away_and_guests_can_download_it(flow, fake):
    kassier, guest, order = await invoiced(flow, fake)
    invoice = fake.core_invoices[order["invoice_id"]]
    assert invoice["statut"] == 1
    assert fake.builddocs == [{"original_file": f"{invoice['ref']}/{invoice['ref']}.pdf", "doctemplate": "", "langcode": "de_AT"}], \
        "gleich nach dem Freigeben, mit der Belegnummer, der Vorlage des Belegs und Deutsch (Österreich)"
    assert order["invoice_id"] in fake.core_pdfs
    assert order["pdf_built_at"] and order["pdf_source"] == "website" and not order.get("pdf_missing")

    # Gäste ohne Mitgliedschaft: das PDF über Dolibarrs Download - nicht über die Dateiliste.
    flow.act_as(guest)
    rows = (await flow.get("/api/account/invoices")).json()["invoices"]
    assert [row["key"] for row in rows] == [f"d-{order['invoice_id']}"]
    pdf = await flow.get(f"/api/account/invoices/d-{order['invoice_id']}/pdf")
    assert pdf.status_code == 200, pdf.text
    assert pdf.content == FakeDolibarr.pdf_bytes(order["invoice_id"])
    assert ("/documents/download", {"modulepart": "facture", "original_file": f"{invoice['ref']}/{invoice['ref']}.pdf"}) in fake.calls
    assert not any(path == "/documents" for path, _ in fake.calls), "GET /documents ist Dolibarrs Dateiliste - ohne id/ref 400"

    # In der Finanzübersicht: nichts offen; der Verlauf nennt das PDF.
    flow.act_as(kassier)
    overview = (await flow.get("/api/admin/finance/overview")).json()
    assert overview["pdfs"] == {"unconfirmed": 0, "failed": 0}
    detail = (await flow.get(f"/api/admin/finance/orders/{order['id']}")).json()
    assert any(item["text"] == "PDF in Dolibarr erzeugt" for item in detail["timeline"])


@pytest.mark.asyncio
async def test_drafts_get_no_pdf_and_the_language_follows_the_setting(flow, fake):
    _, _, draft = await invoiced(flow, fake, invoice_auto_validate=False)
    assert fake.core_invoices[draft["invoice_id"]]["statut"] == 0
    assert fake.builddocs == [] and not draft.get("pdf_built_at"), "Entwürfe bekommen kein PDF"

    # Die Sprache ist einstellbar - ohne Angabe Deutsch (Österreich); unbekannte Codes lehnt die Website ab.
    admin = await person(flow, "chef", role="superadmin")
    flow.act_as(admin)
    status = (await flow.get("/api/admin/dolibarr/status")).json()["invoice_terms"]
    assert status["pdf_lang"] == "de_AT" and [lang["code"] for lang in status["pdf_langs"]] == ["de_AT", "de_DE", "de_CH", "en_US", ""]
    assert (await flow.put("/api/admin/dolibarr/settings", json={"invoice_pdf_lang": "xx_YY"})).status_code == 400
    assert (await flow.put("/api/admin/dolibarr/settings", json={"invoice_pdf_lang": "de_DE"})).status_code == 200
    assert (await flow.get("/api/admin/dolibarr/status")).json()["invoice_terms"]["pdf_lang"] == "de_DE"

    # Der Kassier gibt den Entwurf in Dolibarr frei - mit PDF aus der Oberfläche: der Abgleich übernimmt es, ohne zu bauen.
    fake.hand_validate(draft["invoice_id"])
    await billing_orders.sync_due()
    order = await flow.db.billing_orders.find_one({"id": draft["id"]}, {"_id": 0})
    assert order["invoice_status"] == "validated" and order["pdf_source"] == "dolibarr" and fake.builddocs == []


@pytest.mark.asyncio
async def test_hand_validated_without_pdf_is_built_by_the_sync_in_the_chosen_language(flow, fake):
    _, _, draft = await invoiced(flow, fake, invoice_auto_validate=False, invoice_pdf_lang="de_DE")
    # MAIN_DISABLE_PDF_AUTOUPDATE oder eine andere Oberfläche: freigegeben, aber ohne PDF.
    fake.hand_validate(draft["invoice_id"], with_pdf=False)
    counts = await billing_orders.sync_due()
    assert counts["pdfs"] == 1
    assert fake.builddocs[-1]["langcode"] == "de_DE"
    order = await flow.db.billing_orders.find_one({"id": draft["id"]}, {"_id": 0})
    assert order["pdf_source"] == "website" and draft["invoice_id"] in fake.core_pdfs


@pytest.mark.asyncio
async def test_failed_pdf_keeps_the_booking_names_the_reason_and_is_retried(flow, fake):
    fake.builddoc_status = 403
    kassier, guest, order = await invoiced(flow, fake)
    assert order["status"] == "invoiced" and order["invoice_status"] == "validated", "ohne PDF bleibt der Beleg gültig"
    registration = await flow.db.event_registrations.find_one({"id": order["registration_id"]}, {"_id": 0})
    assert registration["billing_status"] == "invoiced"
    assert order["pdf_missing"] is True and order["pdf_error"] == "forbidden" and "Rechnungen erstellen/bearbeiten" in order["pdf_error_text"]

    # Der Abgleich wartet eine Stunde, bevor er es wieder versucht.
    tries = len(fake.builddocs)
    await billing_orders.sync_due()
    assert len(fake.builddocs) == tries
    await flow.db.billing_orders.update_one({"id": order["id"]}, {"$set": {"pdf_error_at": (now_utc() - timedelta(minutes=61)).isoformat()}})
    fake.builddoc_status = 500
    await billing_orders.sync_due()
    order = await flow.db.billing_orders.find_one({"id": order["id"]}, {"_id": 0})
    assert len(fake.builddocs) == tries + 1 and order["pdf_attempts"] == 2 and "PDF-Vorlage" in order["pdf_error_text"]

    flow.act_as(kassier)
    overview = (await flow.get("/api/admin/finance/overview")).json()
    assert overview["pdfs"] == {"unconfirmed": 1, "failed": 1}
    detail = (await flow.get(f"/api/admin/finance/orders/{order['id']}")).json()
    assert any(item["kind"] == "error" and item["text"].startswith("PDF fehlt: Dolibarr konnte das PDF nicht erzeugen") for item in detail["timeline"])

    # Die Gästin wartet nicht auf den Abgleich: Fehlt die Datei, baut der Download sie einmal - sobald Dolibarr es kann.
    fake.builddoc_status = None
    flow.act_as(guest)
    pdf = await flow.get(f"/api/account/invoices/d-{order['invoice_id']}/pdf")
    assert pdf.status_code == 200 and pdf.content == FakeDolibarr.pdf_bytes(order["invoice_id"])
    order = await flow.db.billing_orders.find_one({"id": order["id"]}, {"_id": 0})
    assert order["pdf_built_at"] and not order.get("pdf_missing") and not order.get("pdf_error_text")


@pytest.mark.asyncio
async def test_build_missing_pdfs_button_handles_existing_invoices_once(flow, fake):
    await connect(flow, **LIVE)
    kassier = await person(flow, "kassier", role="club_admin")
    guest = await person(flow, "gast")
    party = fake.add_thirdparty("Gast", "gast@example.test")
    # Drei Belege von vor dem Update: einer mit PDF aus der Oberfläche, zwei ohne; dazu ein Entwurf.
    rows = []
    for number, (statut, with_pdf) in enumerate([(1, True), (1, False), (1, False), (0, False)], start=1):
        invoice_id = 600 + number
        ref = f"FA2609-0{invoice_id}" if statut else f"(PROV{invoice_id})"
        fake.core_invoices[invoice_id] = {"id": invoice_id, "ref": ref, "socid": party["id"], "statut": statut, "paye": 0, "total_ttc": 20.0, "remaintopay": 20.0, "type": 0, "lines": []}
        if with_pdf:
            fake.core_pdfs.add(invoice_id)
            fake.core_invoices[invoice_id]["last_main_doc"] = f"facture/{ref}/{ref}.pdf"
        rows.append({"id": f"o{number}", "user_id": guest["id"], "kind": "event", "source_id": "ev1", "registration_id": f"r{number}", "status": "invoiced",
                     "invoice_id": invoice_id, "invoice_ref": ref, "invoice_status": "validated" if statut else "draft", "invoiced_at": f"2026-09-0{number}T10:00:00+00:00"})
    await flow.db.billing_orders.insert_many(rows)

    flow.act_as(kassier)
    assert (await flow.get("/api/admin/finance/overview")).json()["pdfs"]["unconfirmed"] == 3, "der Entwurf zählt nicht"
    fake.builddoc_status = 403
    first = (await flow.post("/api/admin/finance/pdfs/build-missing")).json()
    assert (first["looked"], first["present"], first["failed"]) == (3, 1, 2)
    assert first["summary"].startswith("1 hatte schon eins, 2 fehlgeschlagen.") and "Rechnungen erstellen/bearbeiten" in first["summary"]
    fake.builddoc_status = None
    second = (await flow.post("/api/admin/finance/pdfs/build-missing")).json()
    assert (second["looked"], second["built"]) == (2, 2) and second["summary"] == "2 PDFs erzeugt.", "gleich wieder versucht - ohne Stundenpause"
    assert not any(row["original_file"].startswith("(PROV") for row in fake.builddocs), "nie für Entwürfe"
    third = (await flow.post("/api/admin/finance/pdfs/build-missing")).json()
    assert third["looked"] == 0 and third["summary"] == "Alle freigegebenen Belege haben ihr PDF."
    audit = await flow.db.audit_logs.count_documents({"action": "billing.pdfs.build_missing", "actor_id": kassier["id"]})
    assert audit == 3

    # Ohne Schreibzugriff kein Knopf - ehrlich gesagt, warum.
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {"write_enabled": False}})
    refused = await flow.post("/api/admin/finance/pdfs/build-missing")
    assert refused.status_code == 409 and "Schreibzugriff" in refused.json()["detail"]
    flow.act_as(guest)
    assert (await flow.post("/api/admin/finance/pdfs/build-missing")).status_code in (401, 403)
