"""Druckdateien mit der Motiv-Bibliothek aus #2069 Teil A: je Shirtfarbe die richtige Fassung (hell oder dunkel samt
Version), Ausnahmen je Farbe, SVG scharf in der Rahmengröße, ein altes PNG wie bisher - und Druckdatei, Vorschau und
Bestellung nehmen dieselbe Fassung. Printful ist der Vertrags-Fake, Motive und Namen sind erfunden."""
import pathlib
import sys
from io import BytesIO

import httpx
import pytest
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import shop_catalog, shop_designs, shop_motifs, shop_print_files, shop_products  # noqa: E402
from services import shop_print_templates as templates  # noqa: E402
from test_shop_products_unit import (  # noqa: E402,F401 - Fixtures und Helfer der Produktverwaltung
    BACK, BY, GAMERTAG, LION, PRINTFUL_PRODUCT, configured, db, design_dir, fake, provider)

CLUB_SVG = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">'
    '<defs><style>.cls-1{fill:#fff;}.cls-2{fill:#27aae1;}</style></defs>'
    '<path class="cls-1" d="M0 0 L200 0 L200 50 L0 50 Z"/>'
    '<path class="cls-2" d="M0 50 L200 50 L200 100 L0 100 Z"/>'
    '</svg>'
).encode()


async def sources_of(db, product_id: str, placement: str) -> dict:
    rows = await db.shop_print_files.find({"product_id": product_id, "placement": placement, "purpose": "base"},
                                          {"_id": 0}).sort("version", -1).to_list(20)
    out = {}
    for row in rows:
        out.setdefault(row["color"], row["sources"][0])
    return out


@pytest.mark.asyncio
async def test_a_dark_shirt_gets_the_main_file_a_light_one_the_light_version_and_exceptions_apply(db, provider):
    product = await configured(db, provider, accept=False)
    front = await sources_of(db, product["id"], "front")
    assert (front["Black"]["variant"], front["Black"]["version"]) == ("dark", 1)
    assert (front["White"]["variant"], front["White"]["version"]) == ("light", 2), "automatisch umgefärbt"
    # Die helle Fassung ist wirklich anders: Weiß wurde dunkel.
    white_file = await shop_print_files.latest_base(db, product["id"], "front", "all", "White")
    with Image.open(shop_designs._path_of(white_file["file_ref"])) as img:
        red, green, blue, alpha = img.getpixel((223 + 263, 295 + 263))
        assert alpha == 255 and max(red, green, blue) < 60
    # Ausnahme am Motiv (Teil A): Weiß soll die Hauptdatei tragen - die Datei ist veraltet, neu erzeugt nimmt sie dark.
    await shop_designs.update_profile(db, "loewe-weiss", {"color_variants": [{"color": "White", "variant": "dark"}]},
                                      **BY)
    files = next(item for item in (await shop_products.admin_view(db, product["id"]))["check"]["items"]
                 if item["key"] == "files")
    assert files["ok"] is False and "Vorderseite / Weiß: veraltet" in files["detail"]
    await shop_products.generate_print_files(db, product["id"], **BY)
    assert (await sources_of(db, product["id"], "front"))["White"]["variant"] == "dark"
    # Ausnahme am Produkt: für Weiß ein ganz anderes Motiv.
    layout = [{"key": "front", "layers": [{**LION, "motif": {"key": "loewe-weiss", "by_color": {"White": "loewe-schwarz"}}},
                                          GAMERTAG]}, {"key": "back", "layers": [BACK]}]
    await shop_products.set_layout(db, product["id"], layout, included_placement="front", **BY)
    await shop_products.generate_print_files(db, product["id"], **BY)
    assert (await sources_of(db, product["id"], "front"))["White"]["design_key"] == "loewe-schwarz"


@pytest.mark.asyncio
async def test_print_file_preview_and_order_use_the_same_version(db, provider, monkeypatch):
    from shop_testdata import publish_unchecked
    from test_shop_products_unit import BILLING, SHIPPING, variant_for

    from services import shop_orders

    calls = []
    real = shop_motifs.render_motif_png

    async def spy(db_, key, variant, *, width_px, dpi, version=None):
        calls.append((key, variant, version))
        return await real(db_, key, variant, width_px=width_px, dpi=dpi, version=version)

    monkeypatch.setattr(shop_motifs, "render_motif_png", spy)
    product = await configured(db, provider)
    generated = {call for call in calls if call[0] == "loewe-weiss"}
    assert generated == {("loewe-weiss", "dark", 1), ("loewe-weiss", "light", 2)}
    calls.clear()
    template_png = BytesIO()
    Image.new("RGBA", (1000, 1000), (0, 0, 0, 0)).save(template_png, format="PNG")
    monkeypatch.setattr(templates, "IMAGE_TRANSPORT", httpx.MockTransport(
        lambda request: httpx.Response(200, content=template_png.getvalue(), headers={"content-type": "image/png"})))
    await shop_print_files.preview_png(db, await shop_catalog.get_product(db, product["id"]), placement="front",
                                       color="White")
    assert {call for call in calls if call[0] == "loewe-weiss"} == {("loewe-weiss", "light", 2)}
    # Schritt 3 zeigt dieselbe Fassung: Plan mit Version und dem Bild genau dieser Version.
    view = await shop_products.admin_view(db, product["id"])
    white = next(state for row in view["placements"] if row["key"] == "front" for state in row["files"]
                 if state["color"] == "White")
    layer = white["plan"]["layers"][0]
    light_row = await db.shop_designs.find_one({"design_key": "loewe-weiss", "version": 2}, {"_id": 0})
    assert layer["source"]["variant"] == "light" and layer["image_path"] == shop_designs.public_path(light_row)
    # Die Bestellung friert genau diese Fassung ein.
    await publish_unchecked(db, product["id"])
    white_m = await variant_for(db, product["id"], 4014)
    order, _ = await shop_orders.place_order(
        db, user_id="konto-1", idempotency_key="bestellung-0070", buyer_kind="member",
        lines=[{"variant_id": white_m["id"], "quantity": 1, "gamertag": "Testlöwe"}], shipping_estimate_cents=490,
        billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id="konto-1")
    (item,) = await shop_orders.items_for(db, order["id"])
    front = next(row for row in item["designs"] if row["placement"] == "front")
    assert (front["design_key"], front["variant"], front["version"]) == ("loewe-weiss", "light", 2)


@pytest.mark.asyncio
async def test_an_old_png_motif_without_light_version_prints_as_before(db, provider):
    product = await configured(db, provider, accept=False)
    back = await sources_of(db, product["id"], "back")
    assert back["White"] == back["Black"], "ohne Fassung für helle Shirts: die Hauptdatei wie bisher"
    assert (back["White"]["design_key"], back["White"]["variant"], back["White"]["version"]) == (
        "ruecken-weiss", "dark", 1)
    row = await shop_print_files.latest_base(db, product["id"], "back", "all", "White")
    with Image.open(shop_designs._path_of(row["file_ref"])) as img:
        assert img.getpixel((900, int(templates.cm_to_px(5 + 14, 150))))[:4] == (255, 255, 255, 255)


@pytest.mark.asyncio
async def test_an_svg_motif_is_rendered_sharp_in_the_frame_and_recoloured_for_light_shirts(db, provider):
    product = await configured(db, provider, accept=False, generate=False)
    await shop_motifs.upload(db, design_key="wappen", data=CLUB_SVG, filename="wappen.svg",
                             content_type="image/svg+xml", title="Wappen", placement="back", **BY)
    await shop_motifs.refresh_auto_light(db, "wappen", **BY)
    layout = [{"key": "front", "layers": [LION, GAMERTAG]},
              {"key": "back", "layers": [{**BACK, "width_cm": 28.0, "motif": {"key": "wappen"}}]}]
    await shop_products.set_layout(db, product["id"], layout, included_placement="front", **BY)
    result = await shop_products.generate_print_files(db, product["id"], **BY)
    assert not result["failed"] and not [item for item in result["created"] if item["warnings"]], "Vektor: keine DPI-Grenze"
    back = await sources_of(db, product["id"], "back")
    assert back["Black"]["variant"] == "dark" and back["White"]["variant"] == "light"
    for color, top_colour in (("Black", (255, 255, 255)), ("White", (17, 17, 17))):
        row = await shop_print_files.latest_base(db, product["id"], "back", "all", color)
        with Image.open(shop_designs._path_of(row["file_ref"])) as img:
            # 28 cm breit, Seitenverhältnis 2:1 aus der viewBox: obere Hälfte weiß bzw. umgefärbt, untere Vereinsblau.
            top = int(templates.cm_to_px(5 + 3.5, 150))
            bottom = int(templates.cm_to_px(5 + 10.5, 150))
            assert img.getpixel((900, top))[:3] == top_colour
            assert img.getpixel((900, bottom))[:3] == (0x27, 0xAA, 0xE1)
            assert img.getpixel((900, int(templates.cm_to_px(5 + 14.5, 150))))[3] == 0, "unter dem Motiv frei"
