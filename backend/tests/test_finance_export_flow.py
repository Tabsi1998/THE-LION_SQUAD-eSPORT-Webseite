"""Finanzen (#2131): Export vom Server (vollständig, Zeitraum, Formel-Schutz, Rechte, Protokoll), „N von M“, Prüffälle
offen und erledigt in derselben Auswahl, der Verlauf in Worten."""
import csv
import io
import pathlib
import re
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from routes import finance_routes  # noqa: E402
from services import billing_cases, billing_orders  # noqa: E402

BACKEND = pathlib.Path(__file__).resolve().parents[1]
EXPORT = "/api/admin/finance/export.csv"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def order(order_id, **fields):
    base = {"id": order_id, "user_id": "u1", "kind": "event", "source_id": "ev1", "registration_id": f"r-{order_id}", "status": "invoiced",
            "invoice_id": 7, "invoice_ref": f"FA-{order_id}", "invoice_status": "validated", "total_cents": 2000, "currency": "EUR", "remaining_cents": 500,
            "payment_state": "partial", "invoiced_at": "2026-05-04T10:00:00+00:00", "updated_at": "2026-05-04T10:00:00+00:00", "synced_at": "2026-05-04T22:30:00+00:00"}
    return {**base, **fields}


async def as_kassier(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="Kassier"))


def parse(response) -> list[dict]:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    assert response.text.startswith("﻿"), "Excel erkennt UTF-8 am BOM"
    return list(csv.DictReader(io.StringIO(response.text.lstrip("﻿")), delimiter=";"))


@pytest.mark.asyncio
async def test_export_is_complete_while_the_list_says_n_of_m(flow):
    await as_kassier(flow)
    total = billing_orders.INVOICED_LIST_LIMIT + 5
    await flow.db.billing_orders.insert_many([order(f"o-{index}") for index in range(total)])
    overview = (await flow.get("/api/admin/finance/overview")).json()
    assert len(overview["invoiced"]) == billing_orders.INVOICED_LIST_LIMIT and overview["invoiced_total"] == total
    response = await flow.get(EXPORT)
    assert len(parse(response)) == total, "die Liste kürzt, der Export nicht"
    assert response.headers["x-export-rows"] == str(total)


@pytest.mark.asyncio
async def test_export_keeps_the_amounts_and_protects_cells_and_columns(flow):
    await as_kassier(flow)
    await flow.db.users.insert_one({"id": "u-formel", "display_name": "=SUMME(A1)", "username": "formel"})
    await flow.db.events.insert_one({"id": "ev1", "name": "Sommer; LAN", "slug": "sommer"})
    await flow.db.billing_orders.insert_one(order("o-1", user_id="u-formel", total_cents=123456, refunds=[{"amount_cents": 250}], credit_notes=[{"total_cents": -1050}],
                                                  thirdparty_id=42, booking_state="cancelled"))
    response = await flow.get(EXPORT)
    row = parse(response)[0]
    assert row["Person"] == "'=SUMME(A1)", "keine Formel in der Tabellenkalkulation"
    assert row["Angebot"] == "Sommer; LAN"
    assert row["Betrag"] == "1234,56 €" and row["Bezahlt"] == "1229,56 €" and row["Erstattet"] == "2,50 €"
    assert row["Gutgeschrieben"] == "'-10,50 €", "Vorzeichen getrennt und als Text geschützt"
    assert row["Buchung"] == "storniert"
    # Wiener Uhr: 10:00 UTC im Mai = 12:00, 22:30 UTC = 00:30 am nächsten Tag.
    assert row["Angelegt am"] == "04.05.2026 12:00" and row["Stand"] == "05.05.2026 00:30"
    assert "Rechnungsdatum" not in row, "die Website kennt nur den Tag des Anlegens, nicht das Datum auf dem Beleg"
    assert "42" not in response.text.replace("1229,56", ""), "keine Dolibarr-Kennungen"


@pytest.mark.asyncio
async def test_a_credit_note_is_no_payment_in_export_list_and_detail(flow):
    await as_kassier(flow)
    await flow.db.billing_orders.insert_one(order("o-gut", remaining_cents=0, payment_state="credited", payments=[],
                                                  credit_notes=[{"id": 1, "ref": "AV1", "total_cents": 2000, "status": "validated"}]))
    await flow.db.billing_orders.insert_one(order("o-zahl", remaining_cents=500, payments=[{"amount_cents": 1500, "date": "2026-05-05"}]))
    rows = {row["Rechnung"]: row for row in parse(await flow.get(EXPORT))}
    assert rows["FA-o-gut"]["Bezahlt"] == "0,00 €" and rows["FA-o-gut"]["Gutgeschrieben"] == "20,00 €"
    assert rows["FA-o-zahl"]["Bezahlt"] == "15,00 €"
    listed = {row["id"]: row for row in (await flow.get("/api/admin/finance/overview")).json()["invoiced"]}
    assert listed["o-gut"]["paid_cents"] == 0 and listed["o-zahl"]["paid_cents"] == 1500
    assert "payments" not in listed["o-gut"] and "payments" not in listed["o-zahl"], "die einzelnen Zahlungen zeigt erst das Detail"
    detail = (await flow.get("/api/admin/finance/orders/o-gut")).json()
    assert detail["sums"]["paid_cents"] == 0, "Liste, Export und Detail nennen dieselbe Zahl"


@pytest.mark.asyncio
async def test_a_draft_credit_note_is_not_credited_yet(flow):
    await as_kassier(flow)
    notes = [{"id": 1, "ref": "(PROV1)", "total_cents": 2000, "status": "draft"}, {"id": 2, "ref": "AV2", "total_cents": 300, "status": "validated"}]
    await flow.db.billing_orders.insert_one(order("o-entwurf", remaining_cents=2000, payment_state="open", payments=[], credit_notes=notes))
    assert parse(await flow.get(EXPORT))[0]["Gutgeschrieben"] == "3,00 €"
    assert (await flow.get("/api/admin/finance/overview")).json()["invoiced"][0]["credited_cents"] == 300
    assert (await flow.get("/api/admin/finance/orders/o-entwurf")).json()["sums"]["credited_cents"] == 300
    assert (await billing_orders.source_summary(flow.db, "event", "ev1"))["credited_cents"] == 300


@pytest.mark.asyncio
async def test_without_known_payments_the_sum_minus_rest_still_applies(flow):
    """Fehlt das Recht auf die Zahlungen in Dolibarr, steht `payments` nicht am Auftrag: dann bleibt die Rechnung über den Rest."""
    await as_kassier(flow)
    await flow.db.billing_orders.insert_one(order("o-ohne", remaining_cents=500))
    assert parse(await flow.get(EXPORT))[0]["Bezahlt"] == "15,00 €"
    assert (await flow.get("/api/admin/finance/overview")).json()["invoiced"][0]["paid_cents"] == 1500


@pytest.mark.asyncio
async def test_export_period_counts_vienna_days_and_is_checked(flow):
    await as_kassier(flow)
    await flow.db.billing_orders.insert_many([
        # 31.12. 23:30 in Wien (22:30 UTC) und 1.1. 00:30 in Wien (23:30 UTC am 31.12.)
        order("o-silvester", invoiced_at="2026-12-31T22:30:00+00:00"),
        order("o-neujahr", invoiced_at="2026-12-31T23:30:00+00:00"),
        order("o-mitte", invoiced_at="2027-06-01T10:00:00.123456+00:00"),
        order("o-ende", invoiced_at="2027-12-31T22:59:59+00:00"),
        order("o-danach", invoiced_at="2027-12-31T23:00:00+00:00"),
    ])
    year = parse(await flow.get(EXPORT, params={"from": "2027-01-01", "to": "2027-12-31"}))
    assert [row["Rechnung"] for row in year] == ["FA-o-neujahr", "FA-o-mitte", "FA-o-ende"]
    assert [row["Rechnung"] for row in parse(await flow.get(EXPORT, params={"to": "2026-12-31"}))] == ["FA-o-silvester"]
    assert len(parse(await flow.get(EXPORT))) == 5
    assert (await flow.get(EXPORT, params={"from": "2027-02-01", "to": "2027-01-01"})).status_code == 400
    assert (await flow.get(EXPORT, params={"from": "2027-02-30"})).status_code == 400
    assert (await flow.get(EXPORT, params={"from": "morgen"})).status_code == 422
    # Am Rand des Kalenders läuft die Umrechnung über: eine Meldung, kein Serverfehler.
    for edge in ({"from": "0001-01-01"}, {"to": "9999-12-31"}, {"from": "0001-01-01", "to": "9999-12-31"}):
        response = await flow.get(EXPORT, params=edge)
        assert response.status_code == 400, edge
        assert response.json()["detail"] == "Der Zeitraum liegt außerhalb des Kalenders."
    assert len(parse(await flow.get(EXPORT, params={"from": "1000-01-01", "to": "9000-01-01"}))) == 5, "weit, aber gültig"


@pytest.mark.asyncio
async def test_a_period_narrows_the_views_instead_of_replacing_their_conditions(flow):
    await as_kassier(flow)
    now = now_utc()
    moment = lambda days: (now - timedelta(days=days)).isoformat()  # noqa: E731
    day = lambda days: (now - timedelta(days=days)).strftime("%Y-%m-%d")  # noqa: E731
    await flow.db.billing_orders.insert_many([
        # Entwürfe: erst nach sieben Tagen „alt“ - der jüngere bleibt auch mit einem Zeitraum draußen.
        order("o-jung", invoice_status="draft", invoiced_at=moment(1), pdf_built_at=moment(1)),
        order("o-alt", invoice_status="draft", invoiced_at=moment(20), pdf_built_at=moment(20)),
        order("o-uralt", invoice_status="draft", invoiced_at=moment(100), pdf_built_at=moment(100)),
        # Überfällig und ohne PDF: je einer im Zeitraum, einer davor.
        order("o-ueber", invoiced_at=moment(20), due_on=day(10), payment_state="open", pdf_built_at=moment(20)),
        order("o-ueber-vorher", invoiced_at=moment(100), due_on=day(90), payment_state="open", pdf_built_at=moment(100)),
        order("o-pdf", invoiced_at=moment(20), due_on=""),
        order("o-pdf-vorher", invoiced_at=moment(100), due_on=""),
    ])
    period = {"from": day(30), "to": day(0)}
    async def refs(attention):
        return [row["Rechnung"] for row in parse(await flow.get(EXPORT, params={"attention": attention, **period}))]

    assert await refs("draft_old") == ["FA-o-alt"], "jung bleibt draußen, uralt liegt vor dem Zeitraum"
    assert await refs("overdue") == ["FA-o-ueber"]
    assert await refs("pdf_missing") == ["FA-o-pdf"]
    assert {row["Rechnung"] for row in parse(await flow.get(EXPORT, params={"attention": "draft_old"}))} == {"FA-o-alt", "FA-o-uralt"}


@pytest.mark.asyncio
async def test_export_follows_the_selection_needs_finance_and_is_logged_without_names(flow):
    await flow.db.users.insert_one({"id": "u-a", "display_name": "Anna Beispiel", "username": "anna"})
    await flow.db.billing_orders.insert_many([order("o-1", user_id="u-a"), order("o-2", source_id="ev2"), order("o-3", kind="tournament", source_id="t1"),
                                              order("o-4", status="pending", invoice_ref=None)])
    flow.act_as(await flow.add_user(role="tournament_admin", name="Turnier"))
    assert (await flow.get(EXPORT)).status_code == 403
    flow.act_as(None)
    assert (await flow.get(EXPORT)).status_code == 401
    await as_kassier(flow)
    assert {row["Rechnung"] for row in parse(await flow.get(EXPORT))} == {"FA-o-1", "FA-o-2", "FA-o-3"}, "ohne offene Aufträge"
    assert [row["Rechnung"] for row in parse(await flow.get(EXPORT, params={"kind": "tournament"}))] == ["FA-o-3"]
    assert [row["Rechnung"] for row in parse(await flow.get(EXPORT, params={"source": "ev2"}))] == ["FA-o-2"]
    assert [row["Rechnung"] for row in parse(await flow.get(EXPORT, params={"q": "anna"}))] == ["FA-o-1"]
    entry = await flow.db.audit_logs.find_one({"action": "billing.export", "data.person_filter": True}, {"_id": 0})
    assert entry["data"]["rows"] == 1 and "anna" not in str(entry).lower(), "das Protokoll nennt die Auswahl, nie den Namen"


@pytest.mark.asyncio
async def test_tile_and_list_of_cases_read_the_same_selection_and_resolved_ones_stay_readable(flow):
    await as_kassier(flow)
    await flow.db.users.insert_one({"id": "u-k", "display_name": "Kim Kassa", "username": "kim"})
    first = order("o-1")
    other = order("o-2", source_id="ev2")
    done = order("o-3")
    auto = order("o-4")
    await flow.db.billing_orders.insert_many([first, other, done, auto])
    await billing_cases.open_case(flow.db, first, "overpaid")
    await billing_cases.open_case(flow.db, other, "overpaid")
    finished = await billing_cases.open_case(flow.db, done, "overpaid")
    await billing_cases.resolve_case(flow.db, finished["id"], "u-k", "20 € überwiesen")
    automatic = await billing_cases.open_case(flow.db, auto, "invoice_gone")
    await billing_cases.resolve_case(flow.db, automatic["id"], None, "wieder da", auto=True)

    everything = (await flow.get("/api/admin/finance/overview")).json()
    assert everything["cases_open"] == 2 == len(everything["cases"]) and everything["cases_resolved"] == 2
    selected = (await flow.get("/api/admin/finance/overview", params={"source": "ev2"})).json()
    assert selected["cases_open"] == 1 == len(selected["cases"]) and selected["cases_resolved"] == 0, "Kachel wie Liste"

    resolved = (await flow.get("/api/admin/finance/cases", params={"status": "resolved"})).json()
    assert resolved["total"] == 2
    by_id = {row["id"]: row for row in resolved["cases"]}
    assert by_id[finished["id"]]["resolved_by_name"] == "Kim Kassa" and by_id[finished["id"]]["resolution"] == "20 € überwiesen"
    assert by_id[automatic["id"]]["resolved_by_name"] == "Abgleich"
    narrowed = (await flow.get("/api/admin/finance/cases", params={"status": "resolved", "source": "ev2"})).json()
    assert narrowed == {"cases": [], "total": 0, "kinds": narrowed["kinds"]}


@pytest.mark.asyncio
async def test_timeline_speaks_german_and_the_registration_status_has_a_word(flow):
    await as_kassier(flow)
    await flow.db.event_registrations.insert_one({"id": "r-o-1", "status": "registered", "event_id": "ev1"})
    await flow.db.billing_orders.insert_one(order("o-1", refunds=[{"amount_cents": 500, "paid_on": "2026-09-24", "reason": "Absage", "recorded_at": "2026-09-24T10:00:00+00:00"}]))
    await flow.db.audit_logs.insert_many([
        {"id": "a1", "action": "billing.order.retry", "target_id": "o-1", "actor_id": "u-x", "data": {}, "created_at": "2026-09-20T10:00:00+00:00"},
        {"id": "a2", "action": "event.registration.update", "target_id": "r-o-1", "actor_id": "u-x", "data": {"registration_id": "r-o-1"}, "created_at": "2026-09-21T10:00:00+00:00"},
        {"id": "a3", "action": "billing.kuenftig", "target_id": "o-1", "actor_id": "u-x", "data": {}, "created_at": "2026-09-22T10:00:00+00:00"},
    ])
    detail = (await flow.get("/api/admin/finance/orders/o-1")).json()
    texts = [item["text"] for item in detail["timeline"]]
    assert "Neuer Versuch gestartet – System" in texts and "Anmeldung geändert – System" in texts
    assert "Änderung am Vorgang – System" in texts, "eine unbekannte Kennung wird nicht roh gezeigt"
    assert not [text for text in texts if re.search(r"billing\.|event\.registration", text)]
    assert any("am 24.09.2026" in text for text in texts)
    assert detail["registration"]["status_label"] == "angemeldet" and detail["registration"]["status"] == "registered"


def test_every_audit_key_of_the_timeline_has_a_sentence():
    """Wächter: eine neue Kennung im Code braucht einen Satz im Verlauf. `billing.dolibarr` und `billing.notice` sind Logger-Namen."""
    pattern = re.compile(r'"((?:billing|event\.registration|tournament\.registration)\.[a-z_.]+)"')
    found: set[str] = set()
    for path in BACKEND.rglob("*.py"):
        relative = path.relative_to(BACKEND).as_posix()
        if relative.startswith(("tests/", "venv", ".venv")):
            continue
        found |= set(pattern.findall(path.read_text(encoding="utf-8")))
    missing = found - set(finance_routes.AUDIT_TEXTS) - {"billing.dolibarr", "billing.notice"}
    assert missing == set()
