"""Flächennamen im Shop auf Deutsch (#2105): jede Printful-Platzierung bekommt einen deutschen Namen aus Kennung bzw.
Anzeigename - englisch nur als letzter Rückfall, dann mit Hinweis im Admin."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import shop_products, shop_test_drafts  # noqa: E402
from services import shop_print_templates as templates  # noqa: E402
from test_shop_products_unit import (  # noqa: E402,F401 - Fixtures
    BY, PRINTFUL_PRODUCT, db, design_dir, fake, new_product, provider)


@pytest.mark.parametrize("placement, display_name, german", [
    ("front", "Front print", "Vorderseite"), ("back_dtf", "Back print", "Rückseite"),
    ("front_dtf", "Front print", "Vorderseite"), ("label_inside_dtf", "Inside label", "Innenetikett"),
    ("sleeve_left_short_dtf", "Short left sleeve", "Ärmel links (kurz)"),
    ("short_sleeve_right", "Short right sleeve", "Ärmel rechts (kurz)"),
    ("sleeve_left_long", None, "Ärmel links (lang)"), ("label_outside", None, "Außenetikett"),
    ("embroidery_chest_left", None, "Stickerei Brust links"), ("front_large", None, "Vorderseite groß"),
    ("pocket_area_front", None, "Tasche vorne"), ("hood", None, "Kapuze"), ("leg_left", None, "Bein links"),
    ("chest_center", None, "Brust mittig"), ("back_neck", None, "Nacken"), ("default", None, "Druckfläche"),
    ("x_custom_1", "Inside label", "Innenetikett"), ("embroidery_wrist_right", None, "Stickerei Handgelenk rechts"),
])
def test_every_printful_placement_gets_a_german_name(placement, display_name, german):
    assert templates.placement_label(placement, display_name) == german
    assert templates.placement_translated(placement, display_name) is True


def test_english_only_as_last_fallback_and_marked():
    assert templates.placement_label("zz_flux", "Flux capacitor") == "Flux capacitor"
    assert templates.placement_translated("zz_flux", "Flux capacitor") is False
    assert templates.placement_label("zz_flux") == "Zz flux"


@pytest.mark.asyncio
async def test_stored_templates_with_english_labels_read_german():
    from mongomock_motor import AsyncMongoMockClient

    db = AsyncMongoMockClient()["shop_namen"]
    await db.shop_print_templates.insert_one({"printful_product_id": 71, "entries": [
        {"placement": "back_dtf", "technique": "dtfilm", "label": "Back print", "display_name": "Back print"}]})
    stored = await templates.get(db, 71)
    assert stored["entries"][0]["label"] == "Rückseite"
    raw = await db.shop_print_templates.find_one({"printful_product_id": 71}, {"_id": 0})
    assert raw["entries"][0]["label"] == "Back print", "nur gelesen, nichts migriert"


# ---------------------------------------------------------------- In der Produktverwaltung

@pytest.mark.asyncio
async def test_the_admin_shows_german_area_names_and_marks_an_english_fallback(db, provider, fake):
    fake.set_print_area(PRINTFUL_PRODUCT, "sleeve_left_short_dtf", 4, 3.5, display_name="Short left sleeve")
    fake.set_print_area(PRINTFUL_PRODUCT, "zz_odd", 4, 4, display_name="Odd panel")
    product = await new_product(db)
    await shop_products.load_printful_product(db, product["id"], PRINTFUL_PRODUCT, provider=provider, **BY)
    view = await shop_products.admin_view(db, product["id"])
    areas = {row["key"]: row for row in view["available_placements"]}
    assert areas["sleeve_left_short_dtf"]["label"] == "Ärmel links (kurz)"
    assert areas["sleeve_left_short_dtf"]["label_translated"] is True
    assert areas["zz_odd"]["label"] == "Odd panel" and areas["zz_odd"]["label_translated"] is False
    # Schritt 1 zeigt die Flächen des Printful-Produkts mit Namen statt Kennung.
    assert view["labels"]["placements"]["front"] == "Vorderseite"
    assert view["labels"]["placements"]["back"] == "Rückseite"


def test_a_test_draft_shows_area_names_but_keeps_the_printful_keys():
    record = {"id": "t1", "state": "sent", "variant_label": "Black / M",
              "files": [{"placement": "front", "technique": "dtg"}, {"placement": "label_inside_dtf"}]}
    shown = shop_test_drafts.view(record)
    assert [row["placement_label"] for row in shown["files"]] == ["Vorderseite", "Innenetikett"]
    assert [row["placement"] for row in shown["files"]] == ["front", "label_inside_dtf"]
    assert record["files"][0] == {"placement": "front", "technique": "dtg"}, "der Datensatz bleibt"
