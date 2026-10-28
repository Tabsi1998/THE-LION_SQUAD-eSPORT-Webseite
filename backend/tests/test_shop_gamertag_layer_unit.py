"""Gamertag in echter Größe und je Ebene einstellbar (#2105): Texthöhe und Höchstbreite in cm je Gamertag- bzw.
Vereinsnummer-Ebene, Vorgabe aus den globalen Gamertag-Regeln, begrenzt durch die Fläche. Vorschau und Druckdatei je
Bestellung lesen dieselben Werte. Erfundene Testdaten (Namen, Konten, Motive)."""
import pathlib
import sys
from io import BytesIO

import pytest
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import (  # noqa: E402
    shop_catalog, shop_designs, shop_gamertag, shop_orders, shop_print_files, shop_products)
from services.shop_common import ShopError  # noqa: E402
from shop_testdata import publish_unchecked  # noqa: E402
from test_shop_products_unit import (  # noqa: E402,F401 - Fixtures und Helfer
    BACK, BILLING, BY, LION, SHIPPING, WHITE_M, configured, db, design_dir, fake, provider, variant_for)

CM = 2.54


# ---------------------------------------------------------------- Regeln je Ebene

def test_layer_rules_take_the_global_rules_and_override_height_and_width():
    rules = shop_gamertag.clean_rules({})
    assert shop_gamertag.layer_rules(rules, None) == rules, "ohne Angabe wie bisher"
    assert shop_gamertag.layer_rules(rules, {"kind": "gamertag"}) == rules
    own = shop_gamertag.layer_rules(rules, {"text_height_cm": 2.54, "max_width_cm": 25.4})
    assert (own["text_height_in"], own["max_width_in"]) == (1.0, 10.0)
    # Die Verkleinerung bleibt im selben Verhältnis wie global (0,4 zu 0,5 Zoll).
    assert own["min_text_height_in"] == pytest.approx(0.8)
    assert shop_gamertag.rules_hash(own) != shop_gamertag.rules_hash(rules)
    for wrong in ({"text_height_cm": 0.1}, {"max_width_cm": 1.0}, {"text_height_cm": "2"},
                  {"max_width_cm": float("nan")}, {"text_height_cm": 250.0}):
        with pytest.raises(ShopError):
            shop_gamertag.layer_rules(rules, wrong)
    # Seit #2142 begrenzt die Fläche, nicht mehr 2 bzw. 12 Zoll: eine Rückennummer mit 22 cm geht.
    big = shop_gamertag.layer_rules(rules, {"text_height_cm": 22.0, "max_width_cm": 31})
    assert big["text_height_in"] == pytest.approx(22.0 / CM, abs=0.001)
    bounds = {"text_height_cm": 20.0, "width_cm": 30.0, "label": "Rückseite"}
    with pytest.raises(ShopError, match="von 0,25 bis 20 - so viel lässt die Fläche „Rückseite“"):
        shop_gamertag.layer_rules(rules, {"text_height_cm": 22.0}, bounds=bounds)
    with pytest.raises(ShopError, match="Höchstbreite: eine Zahl in cm von 1,27 bis 30"):
        shop_gamertag.layer_rules(rules, {"max_width_cm": 31}, bounds=bounds)


def test_the_canvas_grows_with_the_text_height():
    rules = shop_gamertag.clean_rules({})
    width, height = shop_gamertag.canvas(rules)
    own = shop_gamertag.layer_rules(rules, {"text_height_cm": 2.54, "max_width_cm": 5.08})
    big_width, big_height = shop_gamertag.canvas(own)
    assert big_width == round(2.0 * rules["dpi"]) and big_width < width
    assert big_height == pytest.approx(height * 2, rel=0.05)


# ---------------------------------------------------------------- Schritt 3: speichern und planen

def name_layer(**sizes) -> dict:
    return {"kind": "gamertag", "preset": "text_opposite", **sizes}


@pytest.mark.asyncio
async def test_the_layout_stores_the_size_of_a_name_layer_and_plans_with_it(db, provider):
    product = await configured(db, provider, accept=False, generate=False)
    layout = [{"key": "front", "layers": [LION, name_layer(text_height_cm=1.0, max_width_cm=6.0)]},
              {"key": "back", "layers": [BACK]}]
    await shop_products.set_layout(db, product["id"], layout, included_placement="front", **BY)
    stored = await shop_catalog.get_product(db, product["id"])
    assert stored["placements"][0]["layers"][1] == {"kind": "gamertag", "preset": "text_opposite", "offset_x_cm": 0.0,
                                                    "offset_y_cm": 0.0, "text_height_cm": 1.0, "max_width_cm": 6.0}
    view = await shop_products.admin_view(db, product["id"])
    front = next(row for row in view["placements"] if row["key"] == "front")
    name = next(layer for layer in front["files"][0]["plan"]["layers"] if layer["kind"] == "gamertag")
    assert name["width_cm"] == pytest.approx(6.0, abs=0.02), "die Höchstbreite der Ebene, nicht 8,9 cm"
    rules = shop_gamertag.layer_rules(await shop_gamertag.load_rules(db), {"text_height_cm": 1.0})
    assert name["height_px"] == round(shop_gamertag.canvas(rules)[1] * 150 / 300)
    entry = await db.audit_logs.find_one({"action": "shop.product.layout"}, sort=[("_id", -1)])
    assert entry["data"]["after"][0]["layers"][1]["text_height_cm"] == 1.0


@pytest.mark.asyncio
async def test_sizes_only_for_names_within_limits_and_the_area(db, provider):
    product = await configured(db, provider, accept=False, generate=False)
    wrong = [
        [{"key": "front", "layers": [{**LION, "text_height_cm": 1.0}]}],  # ein Motiv hat keine Texthöhe
        [{"key": "front", "layers": [LION, name_layer(text_height_cm=0.1)]}],
        [{"key": "front", "layers": [LION, name_layer(max_width_cm=40.0)]}],
        [{"key": "front", "layers": [LION, name_layer(max_width_cm="breit")]}],
    ]
    for placements in wrong:
        with pytest.raises(ShopError):
            await shop_products.set_layout(db, product["id"], placements, included_placement=None, **BY)
    # Die Fläche (30,48 cm breit) begrenzt: ein fast flächenbreiter Name ragt mit 1 cm Versatz hinaus.
    with pytest.raises(ShopError, match="ragt"):
        await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": [
            LION, {"kind": "gamertag", "preset": "text_center", "max_width_cm": 30.4, "offset_x_cm": 1.0}]}],
            included_placement=None, **BY)


# ---------------------------------------------------------------- Druckdatei je Bestellung

@pytest.mark.asyncio
async def test_the_order_file_renders_the_name_with_the_size_of_its_layer(db, provider):
    product = await configured(db, provider)
    layout = [{"key": "front", "layers": [LION, name_layer(text_height_cm=1.0, max_width_cm=6.0)]},
              {"key": "back", "layers": [BACK]}]
    await shop_products.set_layout(db, product["id"], layout, included_placement="front", **BY)
    await shop_products.generate_print_files(db, product["id"], **BY)
    await publish_unchecked(db, product["id"])
    white = await variant_for(db, product["id"], WHITE_M)
    line = {"variant_id": white["id"], "quantity": 1, "gamertag": "Testlöwe"}
    order, _ = await shop_orders.place_order(
        db, idempotency_key="bestellung-groesse-1", lines=[line],
        user_id="konto-1", buyer_kind="member", shipping_estimate_cents=490, billing_address=dict(BILLING),
        shipping_address=dict(SHIPPING), actor_id="konto-1")
    (item,) = await shop_orders.items_for(db, order["id"])
    front = next(row for row in item["print_files"] if row["placement"] == "front")
    tag = await db.shop_gamertag_files.find_one({"id": front["gamertag_file_id"]}, {"_id": 0})
    assert tag["print_width_in"] == pytest.approx(6.0 / CM, abs=0.005), "Höchstbreite der Ebene"
    assert tag["text_height_in"] <= 1.0 / CM + 0.005
    personal = await db.shop_print_files.find_one({"id": front["file_id"]}, {"_id": 0})
    with Image.open(shop_designs._path_of(personal["file_ref"])) as img:
        alpha = img.getchannel("A")
        # Rechts vom Löwen (gegenüber): der Name liegt in seinem Rahmen, nicht breiter als 6 cm.
        box = alpha.crop((900, 0, 1800, 2400)).getbbox()
    assert box is not None and (box[2] - box[0]) <= round(6.0 / CM * 150) + 2


# ---------------------------------------------------------------- Beispielname in echter Größe

@pytest.mark.asyncio
async def test_the_sample_name_is_rendered_like_the_print_file(db, provider):
    product = await configured(db, provider, accept=False, generate=False)
    payload = await shop_print_files.sample_png(db, product, kind="gamertag", color="Black",
                                                layer={"text_height_cm": 1.0, "max_width_cm": 6.0})
    rules = shop_gamertag.layer_rules(await shop_gamertag.load_rules(db), {"text_height_cm": 1.0,
                                                                           "max_width_cm": 6.0})
    with Image.open(BytesIO(payload)) as img:
        assert img.size == shop_gamertag.canvas(rules), "die ganze Leinwand - die Vorschau legt sie in den Rahmen"
        ink = img.getchannel("A").getbbox()
        assert ink is not None and ink[2] - ink[0] < img.width, "der Name selbst ist schmaler als die Leinwand"
    default = await shop_print_files.sample_png(db, product, kind="member_number", color="White", layer=None)
    with Image.open(BytesIO(default)) as img:
        # Eine Nummer (#2142) braucht nur die Höhe der Ziffern.
        assert img.size == shop_gamertag.canvas(await shop_gamertag.load_rules(db), "number")
    with pytest.raises(LookupError):
        await shop_print_files.sample_png(db, product, kind="gamertag", color="Pink", layer=None)
    with pytest.raises(ShopError):
        await shop_print_files.sample_png(db, product, kind="gamertag", color="Black", layer={"text_height_cm": 0.1})
