"""Wo Belege hängen (#842): drei Blicke für den Kassier mit Zahl - „PDF fehlt“, „Entwurf seit mehr als 7 Tagen“,
„überfällig“ (Zahlungsziel vor heute nach dem Wiener Tag, Rest offen) -, ein Klick öffnet den Beleg in Dolibarr, der
Export folgt der Auswahl, und die Tageszentrale nennt die Zahlen. Alles nur mit dem Bereich Finanzen."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import billing_orders  # noqa: E402
from test_billing_invoice_terms_flow import connect, person  # noqa: E402

# 3. Oktober 2026, 23:30 in Wien = 21:30 UTC: der Wiener Tag ist noch der 3.
NOW = datetime(2026, 10, 3, 21, 30, tzinfo=timezone.utc)


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def order(order_id, **fields):
    base = {"id": order_id, "user_id": "u1", "kind": "event", "source_id": "ev1", "registration_id": f"r-{order_id}", "status": "invoiced",
            "invoice_id": int(order_id.split("-")[1]), "invoice_ref": f"FA-{order_id}", "invoice_status": "validated", "total_cents": 2000,
            "remaining_cents": 2000, "payment_state": "open", "due_on": "2026-10-20", "pdf_built_at": "2026-09-30T10:00:00+00:00",
            "invoiced_at": "2026-09-30T10:00:00+00:00", "updated_at": "2026-09-30T10:00:00+00:00"}
    return {**base, **fields}


ROWS = [
    # Entwürfe: genau an der Grenze von sieben Tagen - eine Minute davor jung, eine Minute danach alt.
    order("o-1", invoice_status="draft", invoiced_at=(NOW - timedelta(days=7) + timedelta(minutes=1)).isoformat(), pdf_built_at=None),
    order("o-2", invoice_status="draft", invoiced_at=(NOW - timedelta(days=7, minutes=1)).isoformat(), pdf_built_at=None),
    # Zahlungsziel heute (Wiener Tag) - noch nicht überfällig; gestern - überfällig.
    order("o-3", due_on="2026-10-03"),
    order("o-4", due_on="2026-10-02"),
    # Gestern fällig, aber bezahlt oder gutgeschrieben - nicht überfällig; teilweise bezahlt - schon.
    order("o-5", due_on="2026-10-02", payment_state="paid", remaining_cents=0, invoice_status="paid"),
    order("o-6", due_on="2026-10-02", payment_state="credited"),
    order("o-7", due_on="2026-10-02", payment_state="partial", remaining_cents=500),
    # Der Abgleich hat den Stand noch nicht neu geschrieben („open“) - überfällig zählt trotzdem nach dem Datum.
    order("o-8", due_on="2026-09-01", remaining_cents=None),
    # Freigegeben ohne bestätigtes PDF.
    order("o-9", pdf_built_at=None, pdf_missing=True),
]


@pytest.mark.asyncio
async def test_three_views_with_their_boundaries(flow):
    db = flow.db
    for row in ROWS:
        row = {key: value for key, value in row.items() if value is not None}
        await db.billing_orders.insert_one(row)
    counts = await billing_orders.attention_counts(db, now=NOW)
    assert counts == {"pdf_missing": 1, "draft_old": 1, "overdue": 3}
    async def ids(name):
        return sorted([row["id"] async for row in db.billing_orders.find(billing_orders.attention_query(name, NOW), {"_id": 0, "id": 1})])

    assert await ids("draft_old") == ["o-2"]
    assert await ids("overdue") == ["o-4", "o-7", "o-8"]
    assert await ids("pdf_missing") == ["o-9"]
    with pytest.raises(ValueError):
        billing_orders.attention_query("alles")


@pytest.mark.asyncio
async def test_overview_filters_counts_links_to_dolibarr_and_only_for_finance(flow):
    await connect(flow)
    for row in ROWS:
        await flow.db.billing_orders.insert_one({key: value for key, value in row.items() if value is not None})
    kassier = await person(flow, "kassier", role="club_admin")
    flow.act_as(kassier)
    everything = (await flow.get("/api/admin/finance/overview")).json()
    assert everything["attention_labels"] == {"pdf_missing": "PDF fehlt", "draft_old": "Entwurf seit mehr als 7 Tagen", "overdue": "überfällig"}
    assert set(everything["attention"]) == {"pdf_missing", "draft_old", "overdue"} and everything["attention_active"] == ""
    assert len(everything["invoiced"]) == len(ROWS)

    pdf = (await flow.get("/api/admin/finance/overview", params={"attention": "pdf_missing"})).json()
    assert [row["id"] for row in pdf["invoiced"]] == ["o-9"] and pdf["attention_active"] == "pdf_missing"
    # Ein Klick öffnet den Beleg in Dolibarr - ohne `/api/index.php`.
    assert pdf["invoiced"][0]["dolibarr_url"] == "https://erp.example.test/compta/facture/card.php?facid=9"
    # Die Zahlen gelten für die Auswahl: eine andere Veranstaltung hat nichts.
    other = (await flow.get("/api/admin/finance/overview", params={"source": "ev-x", "attention": "pdf_missing"})).json()
    assert other["attention"] == {"pdf_missing": 0, "draft_old": 0, "overdue": 0} and other["invoiced"] == []
    # Unbekannter Blick = alles, wie ohne.
    assert len((await flow.get("/api/admin/finance/overview", params={"attention": "alles"})).json()["invoiced"]) == len(ROWS)

    turnier = await person(flow, "turnier", role="tournament_admin")
    flow.act_as(turnier)
    assert (await flow.get("/api/admin/finance/overview", params={"attention": "overdue"})).status_code == 403


@pytest.mark.asyncio
async def test_daily_center_shows_the_numbers_only_to_finance(flow):
    await connect(flow)
    for row in ROWS:
        await flow.db.billing_orders.insert_one({key: value for key, value in row.items() if value is not None})
    kassier = await person(flow, "kassier", role="club_admin")
    flow.act_as(kassier)
    board = (await flow.get("/api/admin/dashboard")).json()
    assert set(board["finance_attention"]) == {"pdf_missing", "draft_old", "overdue"}
    assert board["finance_attention"]["pdf_missing"] == 1
    turnier = await person(flow, "turnier", role="tournament_admin")
    flow.act_as(turnier)
    assert (await flow.get("/api/admin/dashboard")).json()["finance_attention"] is None
