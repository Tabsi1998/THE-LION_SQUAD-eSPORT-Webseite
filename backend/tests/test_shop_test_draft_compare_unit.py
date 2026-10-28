"""Abgleich Testentwurf ↔ Printful mit der echten Antwort (#2138): Flächen ohne Technik-Endung, Datei als Printful-
Kopie, Position ohne Flächen, Kosten noch in Berechnung, Flächen nur im Auftrag statt in der Positionsliste, „Bei
Printful nachsehen“ und der Aufbau der Antwort ohne Werte.

Printful ist der Vertrags-Fake über den echten Adapter - kein echter Aufruf. Erfundene Testdaten."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import printful_client, shop_test_drafts  # noqa: E402
from services.shop_common import ShopConflict  # noqa: E402
from test_shop_products_unit import (  # noqa: E402,F401 - Fixtures und Helfer der Produktverwaltung
    WHITE_M, configured, db, design_dir, fake, provider, variant_for)
from test_shop_test_drafts_unit import ACTOR, preview, prepared, public_base  # noqa: E402,F401

URL_FRONT = "https://lsw.example.test/api/shop/print-files/a/front.png"
URL_BACK = "https://lsw.example.test/api/shop/print-files/b/back.png"


def record(placements=("front_dtf", "back_dtf")):
    urls = {"front_dtf": URL_FRONT, "back_dtf": URL_BACK}
    return {"payload": {"external_id": "lswtest-0123456789abcdef01234567", "order_items": [{
        "external_id": "0" * 32, "catalog_variant_id": 11547, "quantity": 1,
        "placements": [{"placement": key, "technique": "dtfilm", "layers": [{"type": "file", "url": urls[key]}]}
                       for key in placements]}]},
        "estimate": {"subtotal_cents": 1290, "shipping_cents": 449, "vat_cents": 348, "tax_cents": 0,
                     "total_cents": 2087}}


def answer(placements, *, status="done"):
    return {"external_id": "lswtest-0123456789abcdef01234567", "status": "draft",
            "costs": {"calculation_status": status, "subtotal_cents": 1290 if status == "done" else None,
                      "shipping_cents": 449 if status == "done" else None, "vat_cents": 348 if status == "done" else None,
                      "tax_cents": 0 if status == "done" else None, "total_cents": 2087 if status == "done" else None},
            "items": [{"external_id": "0" * 32, "variant_id": 11547, "quantity": 1, "placements": placements}]}


def levels(rows):
    return {row["label"]: row["level"] for row in rows}


def test_placement_without_technique_suffix_matches():
    rows = shop_test_drafts.compare(record(), answer([
        {"placement": "front", "technique": "dtfilm", "file_urls": [URL_FRONT]},
        {"placement": "back", "technique": "dtfilm", "file_urls": [URL_BACK]}]))
    shown = levels(rows)
    assert shown["Position 1: Fläche front_dtf (dtfilm)"] == "ok"
    assert shown["Position 1: Fläche back_dtf (dtfilm)"] == "ok"
    assert "error" not in shown.values()


def test_printful_copy_of_the_file_is_taken_not_wrong():
    rows = shop_test_drafts.compare(record(("front_dtf",)), answer([
        {"placement": "front_dtf", "technique": "dtfilm", "file_urls": ["https://files.cdn.printful.com/x/y.png"]}]))
    row = next(row for row in rows if row["label"].startswith("Position 1: Fläche front_dtf"))
    assert row["level"] == "warn" and "Printful-Kopie" in row["label"] and row["printful"] == "files.cdn.printful.com"


def test_no_placements_in_the_answer_is_a_hint_not_an_error():
    rows = shop_test_drafts.compare(record(), answer([]))
    shown = levels(rows)
    assert shown["Position 1: Flächen"] == "warn"
    assert "error" not in shown.values()


def test_costs_still_calculating_say_so():
    rows = shop_test_drafts.compare(record(), answer([
        {"placement": "front_dtf", "technique": "dtfilm", "file_urls": [URL_FRONT]},
        {"placement": "back_dtf", "technique": "dtfilm", "file_urls": [URL_BACK]}], status="calculating"))
    shown = levels(rows)
    assert shown["Preise bei Printful"] == "warn"
    assert not any(label.startswith("Preis:") for label in shown)


def test_wrong_technique_or_missing_placement_stays_an_error():
    rows = shop_test_drafts.compare(record(), answer([
        {"placement": "front_dtf", "technique": "dtg", "file_urls": [URL_FRONT]}]))
    shown = levels(rows)
    assert shown["Position 1: Fläche front_dtf (dtfilm)"] == "error"
    assert shown["Position 1: Fläche back_dtf"] == "error"


def test_answer_shape_has_no_values():
    order = {"id": 1, "external_id": "lswtest-x", "recipient": {"name": "Testverein Löwen", "address1": "Gasse 1"},
             "costs": {"calculation_status": "calculating", "total": "20.87"},
             "order_items": [{"id": 5, "name": "Testshirt", "placements": [
                 {"placement": "front_dtf", "technique": "dtfilm", "status": "ok",
                  "layers": [{"type": "file", "url": "https://files.cdn.printful.com/a/b.png?sig=geheim"}]}]}]}
    shape = printful_client.answer_shape(order, [{"id": 5, "catalog_variant_id": 1}])
    text = str(shape)
    for secret in ("Testverein", "Gasse", "20.87", "Testshirt", "geheim", "lswtest-x"):
        assert secret not in text
    assert shape["costs"]["calculation_status"] == "calculating"
    place = shape["order_items"][0]["placements"][0]
    assert place["placement"] == "front_dtf" and place["layers"][0]["host"] == "files.cdn.printful.com"
    assert shape["item_rows"][0]["placements"] == "NoneType"


@pytest.mark.asyncio
async def test_placements_only_in_the_order_and_recheck(db, provider, fake, monkeypatch):
    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    # Wie die echte Antwort (Vermutung #2138): die Positionsliste ohne Flächen, die Flächen stehen im Auftrag.
    original_items = fake._op_getItemsByOrderId
    original_view = fake._order_view

    def items_without_places(args, params, body):
        status, payload = original_items(args, params, body)
        if status == 200:
            payload = {**payload, "data": [{**row, "placements": []} for row in payload["data"]]}
        return status, payload

    def view_with_places(order_id):
        data = original_view(order_id)
        by_id = {item["id"]: item for item in fake.order_items[order_id]}
        data["order_items"] = [{**row, "placements": by_id[row["id"]]["placements"]} for row in data["order_items"]]
        data["costs"] = {**data["costs"], "calculation_status": "calculating"}
        return data

    monkeypatch.setattr(fake, "_op_getItemsByOrderId", items_without_places)
    monkeypatch.setattr(fake, "_order_view", view_with_places)
    sent = await shop_test_drafts.send(db, shown["id"], idempotency_key="klick-2138", actor_id=ACTOR, provider=provider)
    assert sent["deviation_summary"]["error"] == 0
    assert any(row["label"] == "Preise bei Printful" for row in sent["deviations"])
    assert sent["actions"]["recheck"] is True and sent["response"]["shape"]["costs"]["calculation_status"] == "calculating"

    monkeypatch.setattr(fake, "_order_view", original_view)
    again = await shop_test_drafts.recheck(db, shown["id"], actor_id=ACTOR, provider=provider)
    assert not any(row["label"] == "Preise bei Printful" for row in again["deviations"])
    assert any(row["label"].startswith("Preis: Gesamt") for row in again["deviations"])
    assert again["rechecked_at"]
    log = await db.audit_logs.find_one({"action": "shop.test_draft.recheck"}, {"_id": 0})
    assert log and "Vereinsgasse" not in str(log)


@pytest.mark.asyncio
async def test_recheck_only_for_sent_drafts(db, provider, fake):
    product, variant = await prepared(db, provider)
    shown = await preview(db, provider, product, variant)
    with pytest.raises(ShopConflict):
        await shop_test_drafts.recheck(db, shown["id"], actor_id=ACTOR, provider=provider)
