"""Rechnungsangaben (#1358): der Kassier pflegt Zahlungsziel, Zahlungsart, Bankkonto, Sprache der PDFs und „Steuersätze
geprüft“ selbst - über einen schmalen Weg mit dem Bereich Finanzen (und System). Alle anderen Dolibarr-Einstellungen
bleiben beim System; jede Änderung steht im Protokoll."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def granted(flow, name: str, *areas: str) -> dict:
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": list(areas)}})
    user["areas"] = list(areas)
    return user


@pytest.mark.asyncio
async def test_the_treasurer_keeps_the_invoice_details(flow):
    from services.dolibarr_client import SETTINGS_ID

    await flow.db.settings.insert_one({"id": SETTINGS_ID, "mode": "live", "write_enabled": True, "base_url": "https://erp.example.test"})
    treasurer = await granted(flow, "kassier", "finance")
    flow.act_as(treasurer)
    before = await flow.get("/api/admin/finance/invoice-details")
    assert before.status_code == 200, before.text
    assert before.json()["terms"]["complete"] is False
    assert "base_url" not in before.json() and "api_key_configured" not in before.json()

    saved = await flow.put("/api/admin/finance/invoice-details", json={
        "invoice_payment_term_id": 2, "invoice_payment_mode_id": 4, "invoice_bank_account_id": 1, "invoice_pdf_lang": "de_AT", "tax_confirmed": True,
    })
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["terms"]["complete"] is True and body["terms"]["bank_account_id"] == 1
    assert body["tax_confirmed"]["by"] == "kassier"
    auto = await flow.put("/api/admin/finance/invoice-details", json={"invoice_auto_validate": True})
    assert auto.status_code == 200 and auto.json()["invoice_auto_validate"] is True
    stored = await flow.db.settings.find_one({"id": SETTINGS_ID})
    assert stored["invoice_payment_term_id"] == 2 and stored["tax_confirmed_by"] == treasurer["id"]
    assert stored["base_url"] == "https://erp.example.test", "die Technik bleibt, wie sie ist"
    audits = [row["data"]["changed"] async for row in flow.db.audit_logs.find({"action": "finance.invoice_details"}, {"_id": 0})]
    assert audits[0] == ["invoice_bank_account_id", "invoice_payment_mode_id", "invoice_payment_term_id", "invoice_pdf_lang", "tax_confirmed_at", "tax_confirmed_by", "tax_confirmed_by_name"]
    assert audits[1] == ["invoice_auto_validate"]

    # Andere Dolibarr-Einstellungen bleiben beim System - über keinen der beiden Wege.
    technical = await flow.put("/api/admin/dolibarr/settings", json={"base_url": "https://anders.example.test"})
    assert technical.status_code == 403
    smuggled = await flow.put("/api/admin/finance/invoice-details", json={"write_enabled": False})
    assert smuggled.status_code == 422
    options = await flow.get("/api/admin/finance/invoice-options")
    assert options.status_code == 200, options.text


@pytest.mark.asyncio
async def test_auto_release_needs_complete_details_and_only_finance_or_system_may_change_them(flow):
    from services.dolibarr_client import SETTINGS_ID

    await flow.db.settings.insert_one({"id": SETTINGS_ID, "mode": "off"})
    for actor in (await granted(flow, "vorstand", "club"), await flow.add_user(role="tournament_admin", name="turnierleitung"),
                  await granted(flow, "redaktion", "content")):
        flow.act_as(actor)
        read = await flow.get("/api/admin/finance/invoice-details")
        write = await flow.put("/api/admin/finance/invoice-details", json={"invoice_payment_term_id": 2})
        options = await flow.get("/api/admin/finance/invoice-options")
        assert (read.status_code, write.status_code, options.status_code) == (403, 403, 403), actor["username"]

    flow.act_as(await flow.add_user(role="superadmin", name="root"))
    refused = await flow.put("/api/admin/finance/invoice-details", json={"invoice_auto_validate": True})
    assert refused.status_code == 400 and "Zahlungsziel" in refused.json()["detail"]
    offline = await flow.get("/api/admin/finance/invoice-options")
    assert offline.json()["available"] is False
