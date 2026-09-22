"""Eigene Rechnungen (#296) durch die echte Anwendung: nur die eigenen, alle Seiten, PDF unverändert
durchgereicht, Zahlungslink erst im Moment des Klicks geprüft - und bei Ausfall der letzte
verlässliche Stand statt „keine Rechnungen“."""
import hashlib
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, invoice, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client  # noqa: E402
from services.dolibarr_invoices import payment_url_allowed, summarize, view_core_invoice, view_invoice  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402

PAY = BASE_URL + "/public/payment/newpayment.php?source=invoice&ref=FA-31&securekey=abc"


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


async def connect(flow, mode="live"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL,
        "api_key": encrypt_secret(API_KEY), "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)


async def linked_person(flow, fake, name, member_id, **member_fields):
    fake.add(member(member_id, **member_fields))
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"email": f"{name}@lionsquad-test.at", "email_verified": True}})
    flow.act_as(await flow.add_user(role="club_admin"))
    assert (await flow.post("/api/admin/dolibarr/links", json={"user_id": user["id"], "member_id": member_id})).status_code == 200
    flow.act_as(user)
    return user


# ---------------------------------------------------------------- Abbildung

def test_invoice_view_labels_and_pay_decision():
    settings = {"base_url": BASE_URL}
    row = view_invoice(invoice(31, status="overdue", payment_url=PAY), settings)
    assert row["key"] == "d-31" and row["type_label"] == "Rechnung" and row["status_label"] == "überfällig"
    assert row["can_pay"] is True and "payment_url" not in row and "securekey" not in str(row)
    assert view_invoice(invoice(32, status="paid", payment_url=PAY), settings)["can_pay"] is False
    assert view_invoice(invoice(33, kind="credit_note", total=-20, remaining=0, payment_url=PAY), settings)["can_pay"] is False
    assert view_invoice(invoice(34, status="open"), settings)["can_pay"] is False, "ohne Online-Zahlungsdienst kein Knopf"
    assert view_invoice(invoice(35, status="open", payment_url="https://boese.example/pay"), settings)["can_pay"] is False, "nur die eigene Installation"
    assert view_invoice(invoice(36, status="open", payment_url="http://erp.example.test/pay"), settings)["can_pay"] is False, "nur https"


def test_payment_target_is_never_an_open_redirect():
    settings = {"base_url": "https://erp.example.test/dolibarr"}
    assert payment_url_allowed("https://erp.example.test/public/payment/x", settings) is True
    assert payment_url_allowed("https://erp.example.test.attacker.io/x", settings) is False
    assert payment_url_allowed("https://user:pw@erp.example.test/x", settings) is False
    assert payment_url_allowed("javascript:alert(1)", settings) is False
    assert payment_url_allowed("", settings) is False


def test_summary_counts_only_real_open_claims():
    settings = {"base_url": BASE_URL}
    rows = [view_invoice(r, settings) for r in (
        invoice(1, status="open", total=60), invoice(2, status="overdue", total=40, remaining=15),
        invoice(3, kind="credit_note", status="open", total=-20, remaining=-20), invoice(4, status="paid"), invoice(5, status="abandoned"),
    )]
    assert summarize(rows) == {"count": 5, "open_count": 2, "open_total": 75.0, "overdue_count": 1}


# ---------------------------------------------------------------- Liste

@pytest.mark.asyncio
async def test_only_own_invoices_across_all_pages(flow, fake, monkeypatch):
    monkeypatch.setattr(dolibarr_client, "PAGE_LIMIT", 100)
    await connect(flow)
    paula = await linked_person(flow, fake, "paula", 12)
    for number in range(1, 131):
        fake.add_invoice(12, invoice(number, status="paid" if number < 128 else "open", date=f"2024-{(number % 12) + 1:02d}-01"))
    fake.add(member(13))
    fake.add_invoice(13, invoice(900, status="overdue", total=999))

    data = (await flow.get("/api/account/invoices")).json()
    assert data["connected"] is True and data["available"] is True
    assert len(data["invoices"]) == 130, "mehr als 100 eigene Belege, vollständig"
    assert all(row["key"] != "d-900" for row in data["invoices"]), "der fremde Beleg taucht nie auf"
    assert data["summary"]["open_count"] == 3
    pages = sorted(params.get("page") for path, params in fake.calls if path == "/vereine/members/12/invoices")
    assert pages == ["0", "1"], "beide Seiten gelesen, dann Schluss"

    fremd = await flow.add_user(role="player", name="fremd")
    flow.act_as(fremd)
    empty = (await flow.get("/api/account/invoices")).json()
    assert empty == {"connected": False, "available": True, "invoices": [], "summary": {"count": 0, "open_count": 0, "open_total": 0, "overdue_count": 0}, "currency": "EUR", "member": False, "sources": {}}
    _ = paula


@pytest.mark.asyncio
async def test_former_member_keeps_own_old_invoices_and_outage_shows_last_known_state(flow, fake):
    await connect(flow)
    alt = await linked_person(flow, fake, "alt", 14, status="terminated", fee_status="inactive")
    fake.add_invoice(14, invoice(41, status="paid", date="2025-01-10"))
    fake.add_invoice(14, invoice(42, status="open", payment_url=PAY))
    first = (await flow.get("/api/account/invoices")).json()
    assert [row["key"] for row in first["invoices"]] == ["d-42", "d-41"], "Ehemalige behalten ihre Belege"
    assert first["invoices"][0]["can_pay"] is True

    fake.fail_with = 503
    outage = (await flow.get("/api/account/invoices")).json()
    assert outage["available"] is False and outage["reason"] == "unavailable" and outage["as_of"] == first["as_of"]
    assert [row["key"] for row in outage["invoices"]] == ["d-42", "d-41"], "der letzte Stand, nicht „keine Rechnungen“"
    assert outage["invoices"][0]["can_pay"] is False, "bezahlt wird nur gegen einen frischen Stand"
    assert outage["summary"]["open_count"] == 1, "und aus einem Ausfall wird kein „unbezahlt“"
    _ = alt


# ---------------------------------------------------------------- PDF

@pytest.mark.asyncio
async def test_pdf_is_passed_through_unchanged_and_only_to_its_owner(flow, fake):
    await connect(flow)
    paula = await linked_person(flow, fake, "paula", 12)
    fake.add_invoice(12, invoice(31, status="open"))
    fake.add(member(13))
    fake.add_invoice(13, invoice(77, status="open"))

    response = await flow.get("/api/account/invoices/d-31/pdf")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.content == FakeDolibarr.pdf_bytes(31), "Bytes wie geliefert"
    assert response.headers["x-content-sha256"] == hashlib.sha256(response.content).hexdigest()
    assert "no-store" in response.headers["cache-control"], "persönliches Dokument: nirgends zwischengespeichert"
    assert 'inline; filename="FA-31.pdf"' == response.headers["content-disposition"]
    assert (await flow.get("/api/account/invoices/d-31/pdf?download=1")).headers["content-disposition"].startswith("attachment;")

    assert (await flow.get("/api/account/invoices/d-77/pdf")).status_code == 404, "fremder Beleg: 404 wie unbekannt"
    assert (await flow.get("/api/account/invoices/d-999/pdf")).status_code == 404
    assert (await flow.get("/api/account/invoices/31/pdf")).status_code == 404
    assert (await flow.get("/api/account/invoices/d-31%20OR%201/pdf")).status_code == 404
    assert await flow.db.dolibarr_invoice_cache.count_documents({"invoices.content": {"$exists": True}}) == 0, "PDFs werden nie gespeichert"

    fake.pdf_failures.add(31)
    broken = await flow.get("/api/account/invoices/d-31/pdf")
    assert broken.status_code == 503 and "antwortet gerade nicht" in broken.json()["detail"]

    fremd = await flow.add_user(role="player", name="fremd")
    flow.act_as(fremd)
    assert (await flow.get("/api/account/invoices/d-31/pdf")).status_code == 404
    flow.act_as(None)
    assert (await flow.get("/api/account/invoices/d-31/pdf")).status_code == 401
    _ = paula


@pytest.mark.asyncio
async def test_garbage_instead_of_a_pdf_is_refused(flow, fake, monkeypatch):
    await connect(flow)
    await linked_person(flow, fake, "paula", 12)
    fake.add_invoice(12, invoice(31))
    monkeypatch.setattr(FakeDolibarr, "pdf_bytes", staticmethod(lambda _id: b"<html>Login</html>"))
    response = await flow.get("/api/account/invoices/d-31/pdf")
    assert response.status_code == 503


# ---------------------------------------------------------------- Zahlung

@pytest.mark.asyncio
async def test_payment_is_checked_at_the_moment_of_the_click(flow, fake):
    await connect(flow)
    await linked_person(flow, fake, "paula", 12)
    fake.add_invoice(12, invoice(31, status="overdue", payment_url=PAY))
    fake.add_invoice(12, invoice(32, status="paid", payment_url=PAY))
    fake.add_invoice(12, invoice(33, status="open"))

    go = await flow.post("/api/account/invoices/d-31/pay")
    assert go.status_code == 200 and go.json() == {"url": PAY}
    assert await flow.db.audit_logs.count_documents({"action": "invoice.pay_redirect", "target_id": "d-31"}) == 1
    assert (await flow.post("/api/account/invoices/d-32/pay")).status_code == 409, "bezahlt: kein Zahlungsweg"
    assert (await flow.post("/api/account/invoices/d-33/pay")).status_code == 409, "kein Online-Zahlungsdienst"
    assert (await flow.post("/api/account/invoices/d-900/pay")).status_code == 404

    # Zwischen Anzeige und Klick bezahlt: der frische Stand entscheidet, nicht die Liste von vorhin.
    fake.invoices[12][0] = invoice(31, status="paid", payment_url=PAY)
    assert (await flow.post("/api/account/invoices/d-31/pay")).status_code == 409

    fake.invoices[12][0] = invoice(31, status="overdue", payment_url="https://boese.example/pay")
    assert (await flow.post("/api/account/invoices/d-31/pay")).status_code == 409, "kein offener Redirect"


@pytest.mark.asyncio
async def test_unlinking_and_anonymisation_forget_the_invoice_state(flow, fake):
    await connect(flow)
    paula = await linked_person(flow, fake, "paula", 12)
    fake.add_invoice(12, invoice(31))
    assert len((await flow.get("/api/account/invoices")).json()["invoices"]) == 1
    assert await flow.db.dolibarr_invoice_cache.count_documents({"user_id": paula["id"]}) == 1

    flow.act_as(await flow.add_user(role="club_admin"))
    assert (await flow.client.delete(f"/api/admin/dolibarr/links/{paula['id']}")).status_code == 200
    assert await flow.db.dolibarr_invoice_cache.count_documents({"user_id": paula["id"]}) == 0
    flow.act_as(paula)
    assert (await flow.get("/api/account/invoices")).json()["connected"] is False
    assert (await flow.get("/api/account/invoices/d-31/pdf")).status_code == 404
