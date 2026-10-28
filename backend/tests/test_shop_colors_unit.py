"""Farbnamen im Shop auf Deutsch (#2105): eine Stelle übersetzt die Printful-Farben, je Produkt überschreibbar -
englisch nur als letzter Rückfall. Intern bleibt der Printful-Name der Schlüssel."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import shop_colors, shop_orders, shop_products, shop_test_drafts  # noqa: E402
from services.shop_common import ShopError  # noqa: E402
from shop_testdata import publish_unchecked  # noqa: E402
from test_shop_products_unit import (  # noqa: E402,F401 - Fixtures und Helfer
    BILLING, BY, SHIPPING, WHITE_M, check_item, configured, db, design_dir, fake, provider, variant_for)


@pytest.mark.parametrize("name, german", [
    ("Black", "Schwarz"), ("White", "Weiß"), ("Sport Grey", "Sportgrau"), ("Navy", "Marineblau"),
    ("Dark Heather", "Dunkelgrau meliert"), ("Maroon", "Weinrot"), ("Heather Grey", "Grau meliert"),
    ("Royal", "Königsblau"), ("Light Blue", "Hellblau"), ("Dark Grey", "Dunkelgrau"), ("Forest Green", "Waldgrün"),
    ("Heather Navy", "Marineblau meliert"), ("black", "Schwarz"), ("  Sport   Grey ", "Sportgrau"),
    ("Black/ White", "Schwarz / Weiß"), ("Heather Grey/Black", "Grau meliert / Schwarz"),
])
def test_printful_colours_become_german(name, german):
    assert shop_colors.german(name) == german


def test_unknown_words_keep_the_printful_name_as_last_fallback():
    assert shop_colors.german("Heliconia") == "Heliconia"
    assert shop_colors.german("Dark Heliconia") == "Dark Heliconia", "nie halb übersetzt"
    assert shop_colors.is_translated("Heliconia") is False and shop_colors.is_translated("Black") is True
    assert shop_colors.german("") == "" and shop_colors.german(None) == ""


def test_a_product_can_override_the_label_but_the_key_stays():
    product = {"offer": {"colors": ["Black", "White"], "color_labels": {"Black": "Tiefschwarz"}},
               "printful": {"colors": [{"name": "Black", "code": "#0c0c0c"}, {"name": "White", "code": "#ffffff"},
                                       {"name": "Navy", "code": "#1d2335"}]}}
    assert shop_colors.label(product, "Black") == "Tiefschwarz"
    assert shop_colors.label(product, "White") == "Weiß"
    assert shop_colors.labels_for(product) == {"Black": "Tiefschwarz", "White": "Weiß", "Navy": "Marineblau"}
    black_m = {"color": "Black", "size": "M", "label": "Black / M"}
    assert shop_colors.variant_label(product, black_m) == "Tiefschwarz / M"
    assert shop_colors.variant_label(None, {"color": "Navy", "size": "One size", "label": "Navy / One size"}) == \
        "Marineblau / Einheitsgröße"
    # Eine gespeicherte Bezeichnung einer Bestellung („Black / M“) ohne Variante: dieselbe Übersetzung.
    assert shop_colors.stored_label("Black / M") == "Schwarz / M"
    assert shop_colors.stored_label("Sport Grey / XL") == "Sportgrau / XL"
    assert shop_colors.stored_label("Einzelstück") == "Einzelstück"


def test_overrides_are_checked_against_the_offered_colours():
    colors = ["Black", "White"]
    assert shop_colors.clean_labels({"black": " Tief  schwarz ", "White": ""}, colors) == {"Black": "Tief schwarz"}
    assert shop_colors.clean_labels(None, colors) == {}
    for wrong in ({"Navy": "Blau"}, {"Black": "x" * 41}, {"Black": "Schwarz\n"}, ["Black"], {"Black": 7}):
        with pytest.raises(ShopError):
            shop_colors.clean_labels(wrong, colors)


def test_only_stored_printful_codes_are_valid_colours():
    product = {"printful": {"colors": [{"name": "Black", "code": "#0C0C0C"}, {"name": "Odd", "code": "rot"}],
                            "variants": [{"color": "White", "color_code": "#ffffff"}]}}
    assert shop_colors.codes_of(product) == {"0c0c0c", "ffffff"}
    assert shop_colors.hex_of("#0C0C0C") == "0c0c0c" and shop_colors.hex_of("rot") is None
    assert shop_colors.hex_of("#12345") is None and shop_colors.hex_of(None) is None


# ---------------------------------------------------------------- In der Produktverwaltung

@pytest.mark.asyncio
async def test_step_two_takes_own_colour_labels_with_log_and_keeps_the_printful_key(db, provider):
    product = await configured(db, provider, accept=False, generate=False)
    await shop_products.set_offer(db, product["id"], technique="dtg", colors=["Black", "White"], sizes=["M", "L"],
                                  color_labels={"black": "Tiefschwarz", "White": ""}, provider=provider, **BY)
    view = await shop_products.admin_view(db, product["id"])
    assert view["product"]["offer"]["color_labels"] == {"Black": "Tiefschwarz"}
    assert view["product"]["offer"]["colors"] == ["Black", "White"], "der Schlüssel bleibt der Printful-Name"
    assert view["color_labels"] == {"Black": "Tiefschwarz", "White": "Weiß"}
    assert view["color_defaults"] == {"Black": "Schwarz", "White": "Weiß"}
    labels = {row["label"]: row["display_label"] for row in view["variants"]}
    assert labels["Black / M"] == "Tiefschwarz / M" and labels["White / L"] == "Weiß / L"
    entry = await db.audit_logs.find_one({"action": "shop.product.offer"}, sort=[("_id", -1)])
    assert entry["data"]["color_labels"] == {"Black": "Tiefschwarz"}
    # Ohne Angabe bleiben die eigenen Bezeichnungen der weiter angebotenen Farben.
    await shop_products.set_offer(db, product["id"], technique="dtg", colors=["Black"], sizes=["M"],
                                  provider=provider, **BY)
    assert (await shop_products.admin_view(db, product["id"]))["product"]["offer"]["color_labels"] == {
        "Black": "Tiefschwarz"}
    with pytest.raises(ShopError):
        await shop_products.set_offer(db, product["id"], technique="dtg", colors=["Black"], sizes=["M"],
                                      color_labels={"White": "Weiß"}, provider=provider, **BY)


@pytest.mark.asyncio
async def test_the_check_and_the_print_files_speak_german(db, provider):
    product = await configured(db, provider, accept=False, generate=False)
    view = await shop_products.admin_view(db, product["id"])
    assert "Schwarz, Weiß in M, L" in check_item(view, "offer")["detail"]
    files = check_item(view, "files")["detail"]
    assert "Vorderseite / Schwarz: fehlt" in files and "front / Black" not in files
    front = next(row for row in view["placements"] if row["key"] == "front")
    shown = {(state["color"], state["color_label"]) for state in front["files"]}
    assert shown == {("Black", "Schwarz"), ("White", "Weiß")}
    prices = check_item(view, "prices")["detail"]
    assert "Schwarz / M" in prices and "Black / M" not in prices


@pytest.mark.asyncio
async def test_orders_keep_the_printful_name_and_show_the_german_one(db, provider):
    product = await configured(db, provider)
    await publish_unchecked(db, product["id"])
    white = await variant_for(db, product["id"], WHITE_M)
    line = {"variant_id": white["id"], "quantity": 1, "gamertag": "Testlöwe"}
    order, _ = await shop_orders.place_order(
        db, idempotency_key="bestellung-farbe-1", lines=[line],
        user_id="konto-1", buyer_kind="member", shipping_estimate_cents=490, billing_address=dict(BILLING),
        shipping_address=dict(SHIPPING), actor_id="konto-1")
    (item,) = await shop_orders.items_for(db, order["id"])
    assert item["variant_label"] == "White / M", "unverändert gespeichert"
    assert shop_orders.item_view(item)["variant_display"] == "Weiß / M"
    files = await db.shop_print_files.find({"order_id": order["id"]}, {"_id": 0, "color": 1}).to_list(None)
    assert {row["color"] for row in files} == {"White"}


@pytest.mark.asyncio
async def test_the_test_draft_offers_german_colour_names(db, provider):
    await configured(db, provider)
    (product,) = await shop_test_drafts.products(db)
    assert {(row["color"], row["color_label"]) for row in product["variants"]} == {("Black", "Schwarz"),
                                                                                   ("White", "Weiß")}
    assert {row["display_label"] for row in product["variants"]} == {"Schwarz / M", "Schwarz / L", "Weiß / M",
                                                                     "Weiß / L"}
    assert shop_test_drafts.view({"id": "t", "variant_label": "Black / M"})["variant_display"] == "Schwarz / M"
