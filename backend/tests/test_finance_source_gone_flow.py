"""Das Angebot hinter einem Auftrag gibt es nicht mehr (#2226): In Liste, Prüffall und Export steht ein Satz, nie die interne Kennung."""
import csv
import io
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import billing_cases  # noqa: E402
from test_billing_dolibarr_flow import person  # noqa: E402

GONE = "Angebot nicht mehr vorhanden"
ORDER = {"id": "o-weg", "kind": "event", "source_id": "ev-interne-kennung", "registration_id": "r-1", "total_cents": 2000, "currency": "EUR", "status": "invoiced",
         "invoice_id": 7, "invoice_ref": "FA-7", "invoice_status": "validated", "payment_state": "open", "remaining_cents": 2000, "payments": [], "invoiced_at": "2026-09-01T10:00:00+00:00",
         "updated_at": "2026-09-01T10:00:00+00:00", "created_at": "2026-09-01T09:00:00+00:00", "snapshot": {"positions": []}}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_a_missing_offer_is_named_and_the_internal_id_stays_hidden(flow):
    kassier = await person(flow, "kassier", role="club_admin")
    await flow.db.billing_orders.insert_many([{**ORDER, "user_id": kassier["id"]},
                                              {**ORDER, "id": "o-offen", "user_id": kassier["id"], "status": "held", "invoice_id": None, "invoice_ref": None, "registration_id": "r-2"}])
    await billing_cases.open_case(flow.db, {**ORDER, "user_id": kassier["id"]}, "overpaid", {"over_cents": 100})
    flow.act_as(kassier)

    overview = (await flow.get("/api/admin/finance/overview")).json()
    assert overview["invoiced"][0]["source"]["name"] == GONE and overview["open"][0]["source"]["name"] == GONE
    assert overview["invoiced"][0]["source"]["slug"] is None
    assert overview["cases"][0]["source"]["name"] == GONE
    assert (await flow.get("/api/admin/finance/cases")).json()["cases"][0]["source"]["name"] == GONE
    assert (await flow.get("/api/admin/finance/orders/o-weg")).json()["order"]["source"]["name"] == GONE

    response = await flow.get("/api/admin/finance/export.csv")
    [line] = list(csv.DictReader(io.StringIO(response.text.lstrip("﻿")), delimiter=";"))
    assert line["Angebot"] == GONE and "ev-interne-kennung" not in response.text
