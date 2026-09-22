"""Eigene Rechnungen für alle (#320): Nicht-Mitglieder sehen genau die Belege ihrer eigenen Vorgänge
(nie den ganzen Geschäftspartner, keine Entwürfe), das PDF kommt über die Dokument-API, bezahlt wird
per Überweisung; Mitglieder bekommen zu jedem Beleg seine Quelle - Beitrag, Event oder Turnier."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import BASE_URL, FakeDolibarr, invoice  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client  # noqa: E402
from services.dolibarr_invoices import view_core_invoice  # noqa: E402
from test_invoices_flow import connect, linked_person  # noqa: E402


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


def core_invoice(fake, invoice_id, socid, *, ref, statut=1, total=40.0, paye=0, remaining=None, kind="0", due=None):
    row = {"id": invoice_id, "ref": ref, "socid": socid, "statut": statut, "paye": paye, "total_ttc": total,
           "remaintopay": total if remaining is None else remaining, "type": kind, "lines": []}
    if due:
        row["date_lim_reglement"] = due
    fake.core_invoices[invoice_id] = row
    return row


def order(order_id, user_id, invoice_id, *, kind="event", source_id="ev1", registration_id="reg1", snapshot=None):
    return {"id": order_id, "user_id": user_id, "kind": kind, "source_id": source_id, "registration_id": registration_id,
            "status": "invoiced", "invoice_id": invoice_id, "snapshot": snapshot or {"recipient": {"display_name": "Wer"}}}


# ---------------------------------------------------------------- Abbildung

def test_core_invoice_view_hides_drafts_and_knows_no_payment_link():
    settings = {"base_url": BASE_URL}
    assert view_core_invoice({"id": 5, "ref": "(PROV5)", "statut": 0}, settings) is None, "Entwürfe gibt es nach außen nicht"
    row = view_core_invoice({"id": 6, "ref": "FA2609-0006", "statut": 1, "paye": 0, "total_ttc": "40", "remaintopay": "40",
                             "date": 1788220800, "date_lim_reglement": 1789430400}, settings, today="2026-09-23")
    assert row["key"] == "d-6" and row["status"] == "overdue" and row["total"] == 40.0 and row["remaining"] == 40.0
    assert row["date"] == "2026-09-01" and row["due_date"] == "2026-09-15", "Zeitstempel werden Vereinstage"
    assert row["can_pay"] is False and row["is_fee"] is False and "payment_url" not in row
    assert view_core_invoice({"id": 7, "ref": "FA-7", "statut": 1, "date_lim_reglement": 1800000000}, settings, today="2026-09-23")["status"] == "open"
    paid = view_core_invoice({"id": 8, "ref": "FA-8", "statut": 2, "paye": 1, "total_ttc": 40, "remaintopay": 0}, settings)
    assert paid["status"] == "paid" and paid["remaining"] == 0.0
    credit = view_core_invoice({"id": 9, "ref": "AV-9", "statut": 1, "type": "2", "total_ttc": -20}, settings)
    assert credit["type"] == "credit_note" and credit["type_label"] == "Gutschrift" and credit["can_pay"] is False
    assert view_core_invoice({"id": 10, "ref": "FA-10", "status": 3}, settings)["status"] == "abandoned"


# ---------------------------------------------------------------- Nicht-Mitglied

@pytest.mark.asyncio
async def test_non_member_sees_exactly_the_receipts_of_own_bookings(flow, fake):
    await connect(flow)
    max_ = await flow.add_user(role="player", name="max")
    other = await flow.add_user(role="player", name="other")
    soc = fake.add_thirdparty("Familie Muster", "muster@lionsquad-test.at")
    await flow.db.events.insert_one({"id": "ev1", "name": "Weihnachtsfeier", "start_date": "2026-12-12T18:00:00+01:00", "status": "published", "visibility": "members"})
    await flow.db.event_registrations.insert_one({"id": "reg1", "event_id": "ev1", "user_id": max_["id"], "companion_count": 1, "seat_count": 2, "status": "approved"})
    core_invoice(fake, 501, soc["id"], ref="FA2609-0501", total=40.0, due=1757894400)
    core_invoice(fake, 502, soc["id"], ref="FA2609-0502", total=15.0)     # derselbe Geschäftspartner (Familie), fremder Vorgang
    core_invoice(fake, 503, soc["id"], ref="(PROV503)", statut=0)         # Entwurf zu einem eigenen Vorgang
    await flow.db.billing_orders.insert_many([
        order("o1", max_["id"], 501),
        order("o2", max_["id"], 503, kind="tournament", source_id="t-weg", registration_id="tr-weg"),
        order("o3", other["id"], 502, registration_id="reg-o"),
        {"id": "o4", "user_id": max_["id"], "kind": "event", "source_id": "ev1", "registration_id": "reg-x", "status": "pending"},   # noch ohne Beleg
    ])

    flow.act_as(max_)
    data = (await flow.get("/api/account/invoices")).json()
    assert data["connected"] is True and data["member"] is False and data["available"] is True
    assert [row["key"] for row in data["invoices"]] == ["d-501"], "nur der eigene Vorgang - nicht der ganze Geschäftspartner, kein Entwurf"
    row = data["invoices"][0]
    assert row["source"] == "event" and row["source_label"] == "Weihnachtsfeier" and row["registration_id"] == "reg1"
    assert row["booking"] == {"name": "Weihnachtsfeier", "date": "12.12.2026", "seats": 2, "companions": 1, "team": "", "players": 0}
    assert row["status"] == "overdue" and row["can_pay"] is False and row["total"] == 40.0
    assert data["sources"] == {"event": 1} and data["summary"]["open_count"] == 1
    assert "socid" not in str(data) and "(PROV" not in str(data)

    pdf = await flow.get("/api/account/invoices/d-501/pdf")
    assert pdf.status_code == 200, pdf.text
    assert pdf.content == FakeDolibarr.pdf_bytes(501) and 'filename="FA2609-0501.pdf"' in pdf.headers["content-disposition"]
    assert "no-store" in pdf.headers["cache-control"]
    assert (await flow.get("/api/account/invoices/d-502/pdf")).status_code == 404, "fremder Vorgang am selben Geschäftspartner: 404 wie unbekannt"
    assert (await flow.get("/api/account/invoices/d-503/pdf")).status_code == 404, "Entwurf: 404"
    assert (await flow.get("/api/account/invoices/d-999/pdf")).status_code == 404

    pay = await flow.post("/api/account/invoices/d-501/pay")
    assert pay.status_code == 409 and "überweisen" in pay.json()["detail"], "kein Online-Zahlungsweg über den Kern - ehrlich gesagt"
    assert (await flow.post("/api/account/invoices/d-502/pay")).status_code == 404

    flow.act_as(other)
    theirs = (await flow.get("/api/account/invoices")).json()
    assert [row["key"] for row in theirs["invoices"]] == ["d-502"]

    fake.pdf_failures.add(501)
    flow.act_as(max_)
    assert (await flow.get("/api/account/invoices/d-501/pdf")).status_code == 503

    nobody = await flow.add_user(role="player", name="nobody")
    flow.act_as(nobody)
    assert (await flow.get("/api/account/invoices")).json()["connected"] is False


@pytest.mark.asyncio
async def test_outage_keeps_the_last_state_for_non_members_too(flow, fake):
    await connect(flow)
    max_ = await flow.add_user(role="player", name="max")
    soc = fake.add_thirdparty("Max Muster", "max@lionsquad-test.at")
    core_invoice(fake, 601, soc["id"], ref="FA-601", total=25.0)
    await flow.db.billing_orders.insert_one(order("o1", max_["id"], 601, kind="tournament", source_id="t1", registration_id="tr1"))
    flow.act_as(max_)
    first = (await flow.get("/api/account/invoices")).json()
    assert [row["key"] for row in first["invoices"]] == ["d-601"] and first["invoices"][0]["source"] == "tournament"

    fake.fail_with = 503
    outage = (await flow.get("/api/account/invoices")).json()
    assert outage["available"] is False and outage["member"] is False
    assert [row["key"] for row in outage["invoices"]] == ["d-601"] and outage["invoices"][0]["source"] == "tournament"


# ---------------------------------------------------------------- Mitglied mit Quelle

@pytest.mark.asyncio
async def test_member_invoices_carry_their_source(flow, fake):
    await connect(flow)
    paula = await linked_person(flow, fake, "paula", 12)
    fake.add_invoice(12, invoice(31, status="open"))
    fake.add_invoice(12, invoice(32, status="paid", fee=False, date="2026-09-10"))
    fake.add_invoice(12, invoice(33, status="paid", fee=False, date="2026-09-11"))
    await flow.db.tournaments.insert_one({"id": "t1", "title": "Herbst-Cup", "start_date": "2026-10-02T17:00:00+02:00"})
    await flow.db.billing_orders.insert_one(order("o9", paula["id"], 32, kind="tournament", source_id="t1", registration_id="tr1", snapshot={
        "recipient": {"display_name": "Paula"}, "source": {"display_name": "Team Lions"}, "positions": [{"basis": "per_person", "quantity": 5}],
    }))

    data = (await flow.get("/api/account/invoices")).json()
    assert data["member"] is True
    assert [row["key"] for row in data["invoices"]] == ["d-33", "d-32", "d-31"], "neueste zuerst, auch mit Kontext"
    by_key = {row["key"]: row for row in data["invoices"]}
    assert by_key["d-31"]["source"] == "club" and by_key["d-31"]["source_label"] == "Mitgliedsbeitrag" and by_key["d-31"]["booking"] is None
    assert by_key["d-33"]["source"] == "club" and by_key["d-33"]["source_label"] == "Verein", "ein Beleg des Vereins ohne Vorgang"
    assert by_key["d-32"]["source"] == "tournament" and by_key["d-32"]["source_label"] == "Startgeld Herbst-Cup – Team Lions"
    assert by_key["d-32"]["booking"]["players"] == 5 and by_key["d-32"]["booking"]["team"] == "Team Lions" and by_key["d-32"]["registration_id"] == "tr1"
    assert data["sources"] == {"club": 2, "tournament": 1}
    # Das Mitglied liest sein PDF weiter über das Vereinsmodul, nicht über die Dokument-API.
    assert (await flow.get("/api/account/invoices/d-32/pdf")).status_code == 200
    assert not any(path == "/documents" for path, _ in fake.calls)
