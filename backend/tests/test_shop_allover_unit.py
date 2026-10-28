"""Allover (#2141): fertige Datei als Hintergrund, Motive, Gamertag und Vereinsnummer als Ebenen darüber - und die
Fassung bzw. Namensfarbe aus der Helligkeit des Hintergrunds unter der Ebene.

Geprüft: Hintergrund plus Motiv ergibt die Grunddatei in exakter Größe, ein neuer Hintergrund macht sie veraltet, der
Gamertag kommt je Bestellung darauf; die Automatik wählt auf dunklem bzw. hellem Hintergrund richtig, Überschreiben an
der Ebene und die Vorgabe des Produkts wirken, die Namensfarbe kontrastiert. Bestehende Produkte mit fertiger Datei ohne
Motive behalten Pixel und Prüfsumme. Nur synthetische Bilder - keine Vereinsgrafik, kein Printful-Bild."""
import hashlib
import json
import pathlib
import sys
from io import BytesIO

import httpx
import pytest
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import shop_catalog, shop_designs, shop_gamertag, shop_motifs, shop_orders, shop_print_files  # noqa: E402
from services import shop_products  # noqa: E402
from services import shop_print_templates as templates  # noqa: E402
from services.shop_common import ShopConflict, ShopError  # noqa: E402
from shop_testdata import logo_png, publish_unchecked  # noqa: E402
from test_shop_products_unit import (  # noqa: E402,F401 - Fixtures und Helfer der Produktverwaltung
    BACK, BILLING, BLACK_M, BY, LION, PLACEMENTS, PRINTFUL_PRODUCT, SHIPPING, WHITE_M, configured, db, design_dir,
    fake, provider, variant_for)

NAVY = (20, 20, 40)          # dunkler Hintergrund (Luminanz ≈ 0,007)
PALE = (240, 240, 240)       # heller Hintergrund (Luminanz ≈ 0,87)
GAMERTAG_TOP = {"kind": "gamertag", "preset": "text_back_top"}


def background(width: int = 1800, height: int = 2400, *, top=NAVY, bottom=None, alpha: int = 255) -> bytes:
    """Ein erfundener Hintergrund: oben ``top``, ab der Mitte ``bottom`` (ohne: alles ``top``)."""
    img = Image.new("RGBA", (width, height), (*top, alpha))
    if bottom is not None:
        img.paste(Image.new("RGBA", (width, height - height // 2), (*bottom, alpha)), (0, height // 2))
    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


async def upload(db, product_id: str, color: str, data: bytes, placement: str = "back") -> dict:
    return await shop_print_files.upload(db, product_id, placement=placement, color=color, data=data,
                                         filename="hintergrund.png", content_type="image/png", **BY)


async def plan_of(db, product_id: str, color: str, placement: str = "back") -> shop_print_files.Plan:
    product = await shop_catalog.get_product(db, product_id)
    plans, _context = await shop_print_files.plans_for(db, product)
    return next(plan for row, plan, plan_color, _ids in plans if row["key"] == placement and plan_color == color)


async def state_of(db, product_id: str, color: str, placement: str = "back") -> dict:
    product = await shop_catalog.get_product(db, product_id)
    return next(state for state in await shop_print_files.states(db, product)
                if state["placement"] == placement and state["color"] == color)


class FakeMotifs:
    """Vektor-Motive mit festem Seitenverhältnis (2:1); ohne entschiedenen Untergrund hell bei weißer Shirtfarbe -
    genau die Stelle, die ``_motif_source`` sonst über die Motiv-Bibliothek nimmt."""

    def __init__(self):
        self.asked = []

    async def source(self, db, motif, color, color_hex, variant=None):
        self.asked.append(variant)
        chosen = variant or ("light" if (color_hex or "").lower() == "#ffffff" else "dark")
        return shop_print_files.MotifSource(ref={"source": "motif", "motif_key": motif["key"], "variant": chosen},
                                            width_px=2000, height_px=1000, title=f"{motif['key']} ({chosen})",
                                            vector=True)

    async def png(self, db, source, *, width_px, dpi):
        color = (0, 0, 0, 255) if source.ref["variant"] == "light" else (255, 255, 255, 255)
        return logo_png(width_px, width_px // 2, color)


@pytest.fixture
def fake_motifs(monkeypatch):
    motifs = FakeMotifs()
    monkeypatch.setattr(shop_print_files, "_motif_source", motifs.source)
    monkeypatch.setattr(shop_print_files, "_motif_png", motifs.png)
    return motifs


# ---------------------------------------------------------------- Helligkeit des Hintergrunds (rein)

def test_the_mean_luminance_counts_only_the_frame_and_transparent_parts_as_the_surface():
    img = Image.new("RGBA", (400, 200), (0, 0, 0, 255))
    img.paste(Image.new("RGBA", (200, 200), (255, 255, 255, 255)), (200, 0))
    grid = shop_print_files.luma_grid(img)
    left = grid.mean(templates.Box(0, 0, 200, 200), None)
    right = grid.mean(templates.Box(200, 0, 200, 200), None)
    assert left == pytest.approx(0.0, abs=1e-6) and right == pytest.approx(1.0, abs=1e-6)
    assert grid.mean(templates.Box(100, 50, 200, 100), None) == pytest.approx(0.5, abs=0.01), "halb und halb"
    assert grid.mean(templates.Box(500, 0, 10, 10), None) is None, "außerhalb der Fläche"
    clear = shop_print_files.luma_grid(Image.new("RGBA", (100, 100), (0, 0, 0, 0)))
    whole = templates.Box(0, 0, 100, 100)
    assert clear.mean(whole, None) is None and clear.mean(whole, 1.0) == pytest.approx(1.0)
    assert clear.mean(whole, 0.0) == pytest.approx(0.0), "durchsichtig zählt als Untergrund"


def test_the_decision_order_is_layer_background_product_garment():
    grid = shop_print_files.luma_grid(Image.new("RGBA", (100, 100), (*NAVY, 255)))
    box = templates.Box(10, 10, 50, 50)
    common = {"garment_hex": "#ffffff", "threshold": 0.18}
    dark = shop_print_files.decide_surface({}, box, grid=grid, product_surface=None, **common)
    assert dark["variant"] == "dark" and dark["source"] == "background" and dark["luminance"] < 0.02
    assert shop_print_files.surface_text(dark) == "Fassung: dunkel (aus Hintergrund)"
    by_hand = shop_print_files.decide_surface({"variant": "light"}, box, grid=grid, product_surface="dark", **common)
    assert (by_hand["variant"], by_hand["source"]) == ("light", "layer")
    product = shop_print_files.decide_surface({}, box, grid=None, product_surface="dark", **common)
    assert (product["variant"], product["source"]) == ("dark", "product")
    garment = shop_print_files.decide_surface({"variant": "auto"}, box, grid=None, product_surface=None, **common)
    assert garment["variant"] is None and garment["source"] == "garment"
    assert shop_print_files.surface_text(garment) is None


def test_the_name_ink_has_enough_contrast_on_the_surface():
    rules = shop_gamertag.default_rules()
    on_dark = shop_gamertag.ink_for_surface(rules, "White", 0.007)
    on_light = shop_gamertag.ink_for_surface(rules, "Black", 0.87)
    assert on_dark["key"] == "vereinsblau", "die Vorgabefarbe, wenn sie reicht"
    assert on_light["key"] == "tiefschwarz", "Vereinsblau ist auf Hellgrau zu schwach"
    for ink, luminance in ((on_dark, 0.007), (on_light, 0.87)):
        ratio = shop_gamertag.contrast_ratio(shop_motifs.relative_luminance(ink["hex"]), luminance)
        assert ratio >= shop_gamertag.MIN_INK_CONTRAST
    # Eine Farbe der Shirtfarbe geht vor, solange sie kontrastiert.
    rules["colors"][1]["garment_colors"] = ["White"]
    assert shop_gamertag.ink_for_surface(rules, "White", 0.007)["key"] == "reinweiss"
    assert shop_gamertag.ink_for_surface(rules, "White", 0.9)["key"] == "tiefschwarz"


# ---------------------------------------------------------------- Bestand: fertige Datei ohne Motive bleibt gleich

@pytest.mark.asyncio
async def test_a_finished_file_without_motifs_keeps_pixels_checksum_and_order_file(db, provider):
    product = await configured(db, provider)
    front_black = await plan_of(db, product["id"], "Black", "front")
    payload = {"renderer": shop_print_files.RENDERER_VERSION, "template": front_black.template_hash, "mode": "layout",
               "motifs": [{"box": item.box.rounded(), "ref": item.source.ref} for item in front_black.motifs]}
    expected = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert front_black.layout_hash == expected, "der Fingerabdruck im Modus „Motiv und Position“ bleibt"
    assert (await shop_print_files.latest_base(db, product["id"], "front", "all", "Black"))["layout_hash"] == expected
    await shop_products.set_layout(db, product["id"], [PLACEMENTS[0], {"key": "back", "mode": "upload", "layers": []}],
                                   included_placement="front", **BY)
    data = background()
    stored = await upload(db, product["id"], "Black", data)
    assert stored["origin"] == "upload" and not [note for note in stored["notes"] if "Ebenen" in note]
    same = shop_designs.png_bytes(shop_designs.prepare(data, "hintergrund.png", "image/png")[0], 150)
    assert stored["sha256"] == hashlib.sha256(same).hexdigest(), "neu kodiert wie bisher - gleiche Prüfsumme"
    row = await db.shop_print_files.find_one({"id": stored["id"]}, {"_id": 0})
    assert shop_designs._path_of(row["file_ref"]).read_bytes() == same, "die Datei selbst ist die Grunddatei"
    plan = await plan_of(db, product["id"], "Black")
    assert plan.mode == "upload" and not plan.on_background and plan.background_ok
    assert (await state_of(db, product["id"], "Black"))["state"] == "ok"
    await publish_unchecked(db, product["id"])
    black = await variant_for(db, product["id"], BLACK_M)
    order, _ = await shop_orders.place_order(
        db, user_id="konto-1", idempotency_key="bestellung-2141", buyer_kind="member",
        lines=[{"variant_id": black["id"], "quantity": 1, "gamertag": "Testlöwe"}], shipping_estimate_cents=490,
        billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id="konto-1")
    (item,) = await shop_orders.items_for(db, order["id"])
    back = next(row for row in item["print_files"] if row["placement"] == "back")
    assert back["kind"] == "base" and back["file_id"] == stored["id"] and back["sha256"] == stored["sha256"]


@pytest.mark.asyncio
async def test_hidden_motifs_of_an_older_finished_file_are_not_printed_until_saved_again(db, provider):
    product = await configured(db, provider, accept=False)
    # So speicherte Schritt 3 vor #2141: Motive blieben im Modus „Fertige Druckdatei“ stehen, ausgeblendet.
    placements = [dict(row) for row in product["placements"]]
    placements[1] = {**placements[1], "mode": "upload"}
    placements[1].pop("background_layers", None)
    await db.shop_products.update_one({"id": product["id"]}, {"$set": {"placements": placements}})
    stored = await upload(db, product["id"], "Black", background())
    plan = await plan_of(db, product["id"], "Black")
    assert not plan.motifs and not plan.on_background
    assert (await state_of(db, product["id"], "Black"))["file"]["id"] == stored["id"]
    view = await shop_products.admin_view(db, product["id"])
    assert next(row for row in view["placements"] if row["key"] == "back")["motifs_hidden"] is True
    await shop_products.set_layout(db, product["id"], [{key: row[key] for key in ("key", "mode", "layers")}
                                                       for row in placements], included_placement="front", **BY)
    saved = await shop_catalog.get_product(db, product["id"])
    assert saved["placements"][1]["background_layers"] is True
    assert (await plan_of(db, product["id"], "Black")).on_background is True


# ---------------------------------------------------------------- Hintergrund plus Ebenen

@pytest.mark.asyncio
async def test_background_and_motif_give_the_print_file_in_exact_size_and_a_new_background_outdates_it(
        db, provider, monkeypatch):
    product = await configured(db, provider, accept=False)
    await shop_products.set_layout(db, product["id"], [PLACEMENTS[0], {"key": "back", "mode": "upload",
                                                                         "layers": [BACK]}],
                                   included_placement="front", **BY)
    waiting = await state_of(db, product["id"], "White")
    assert waiting["state"] == "missing" and "Noch kein Hintergrund" in waiting["detail"]
    stored = await upload(db, product["id"], "White", background())
    assert any("Mit den Ebenen zur Druckdatei" in note for note in stored["notes"])
    assert any("am Muster prüfen" in note for note in stored["notes"])
    plan = await plan_of(db, product["id"], "White")
    (motif,) = plan.motifs
    assert motif.surface["source"] == "background" and motif.surface["variant"] == "dark", "dunkler Hintergrund"
    assert motif.source.ref["variant"] == "dark", "der weiße Rückenlöwe - nicht die Fassung für weiße Shirts"
    base = await shop_print_files.current_base(db, product["id"], plan)
    assert base["origin"] == "composed" and base["sources"][0] == {"source": "background", "file_id": stored["id"],
                                                                   "sha256": stored["sha256"]}
    with Image.open(shop_designs._path_of(base["file_ref"])) as img:
        assert img.size == (1800, 2400) and tuple(map(round, img.info["dpi"])) == (150, 150)
        left, top, width, height = motif.box.rounded()
        assert img.getpixel((left + width // 2, top + height // 2)) == (255, 255, 255, 255), "Motiv auf dem Hintergrund"
        assert img.getpixel((10, 10)) == (*NAVY, 255) and img.getpixel((1790, 2390)) == (*NAVY, 255)
    assert (await state_of(db, product["id"], "White"))["state"] == "ok"

    # Ein neuer Hintergrund ohne Erzeugen: die Grunddatei ist veraltet.
    async def busy(*_args, **_kwargs):
        raise ShopConflict("Die Druckdateien werden gerade erzeugt - bitte gleich noch einmal.")

    real_generate = shop_print_files.generate
    monkeypatch.setattr(shop_print_files, "generate", busy)
    again = await upload(db, product["id"], "White", background(top=(30, 10, 10)))
    assert any("noch nicht erzeugt" in note for note in again["notes"])
    outdated = await state_of(db, product["id"], "White")
    assert outdated["state"] == "outdated" and outdated["background"]["id"] == again["id"]
    assert outdated["file"]["id"] == base["id"], "die alte erzeugte Datei - nie der Hintergrund allein"
    monkeypatch.setattr(shop_print_files, "generate", real_generate)
    result = await shop_products.generate_print_files(db, product["id"], **BY)
    assert [(item["placement"], item["color"]) for item in result["created"]] == [("back", "White")], result
    assert (await state_of(db, product["id"], "White"))["state"] == "ok"


@pytest.mark.asyncio
async def test_the_background_decides_the_version_and_the_name_colour(db, provider, fake_motifs):
    product = await configured(db, provider, accept=False)
    layers = [{**BACK, "width_cm": 20.0}, GAMERTAG_TOP]
    await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": [LION]},
                                                       {"key": "back", "mode": "upload", "layers": layers}],
                                   included_placement="front", **BY)
    # Weißes Trikot, oben dunkel bedruckt: dunkle Fassung, die Namensfarbe kontrastiert zum Dunkel.
    await upload(db, product["id"], "White", background(top=NAVY, bottom=PALE))
    # Schwarzes Trikot, ganz hell bedruckt: helle Fassung, Name in Schwarz.
    await upload(db, product["id"], "Black", background(top=PALE))
    white = await plan_of(db, product["id"], "White")
    black = await plan_of(db, product["id"], "Black")
    assert (white.motifs[0].source.ref["variant"], white.motifs[0].surface["source"]) == ("dark", "background")
    assert (black.motifs[0].source.ref["variant"], black.motifs[0].surface["source"]) == ("light", "background")
    rules = await shop_gamertag.load_rules(db)
    for plan in (white, black):
        (name,) = plan.texts
        ink = shop_gamertag.color_of(rules, name.ink)
        ratio = shop_gamertag.contrast_ratio(shop_motifs.relative_luminance(ink["hex"]), name.surface["luminance"])
        assert name.surface["source"] == "background" and ratio >= shop_gamertag.MIN_INK_CONTRAST, (plan.color, ink)
    assert black.texts[0].ink == "tiefschwarz"
    view = shop_print_files.plan_view(white, rules)
    assert view["layers"][0]["surface"]["text"] == "Fassung: dunkel (aus Hintergrund)"
    assert view["layers"][1]["ink"]["key"] == white.texts[0].ink
    # Von Hand überschrieben: hell, obwohl der Hintergrund dunkel ist.
    await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": [LION]},
                                                       {"key": "back", "mode": "upload",
                                                        "layers": [{**layers[0], "variant": "light"}, layers[1]]}],
                                   included_placement="front", **BY)
    stored = await shop_catalog.get_product(db, product["id"])
    assert stored["placements"][1]["layers"][0]["variant"] == "light"
    by_hand = await plan_of(db, product["id"], "White")
    assert (by_hand.motifs[0].source.ref["variant"], by_hand.motifs[0].surface["source"]) == ("light", "layer")
    assert by_hand.layout_hash != white.layout_hash, "andere Fassung, andere Grunddatei"
    with pytest.raises(ShopError, match="Fassung"):
        await shop_products.set_layout(db, product["id"], [{"key": "back", "mode": "upload",
                                                            "layers": [{**layers[0], "variant": "grau"}]}],
                                       included_placement="back", **BY)


@pytest.mark.asyncio
async def test_without_background_the_shirt_colour_or_the_product_setting_decides(db, provider, fake_motifs):
    product = await configured(db, provider, accept=False)
    white = await plan_of(db, product["id"], "White", "front")
    assert white.motifs[0].source.ref["variant"] == "light" and white.motifs[0].surface["source"] == "garment"
    assert set(fake_motifs.asked) == {None}, "ohne Vorgabe wie bisher - kein Untergrund entschieden"
    rules = await shop_gamertag.load_rules(db)
    assert white.texts[0].ink == shop_gamertag.inks_for_garment(rules, "White")[0]["key"]
    # „Untergrund gilt als dunkel“ (etwa Allover mit Grundfarbe Weiß, aber ohne Hintergrunddatei).
    await shop_products.set_layout(db, product["id"], PLACEMENTS, included_placement="front", print_surface="dark",
                                   **BY)
    assert (await shop_catalog.get_product(db, product["id"]))["print_surface"] == "dark"
    dark = await plan_of(db, product["id"], "White")
    assert (dark.motifs[0].source.ref["variant"], dark.motifs[0].surface["source"]) == ("dark", "product")
    entry = await db.audit_logs.find_one({"action": "shop.product.layout", "data.print_surface": {"$exists": True}},
                                         {"_id": 0})
    assert entry["data"]["print_surface"] == {"before": "garment", "after": "dark"}
    # Durchsichtiger Hintergrund: die durchsichtigen Stellen zählen als Untergrund (hier die Vorgabe dunkel).
    await shop_products.set_layout(db, product["id"], [PLACEMENTS[0], {"key": "back", "mode": "upload",
                                                                         "layers": [BACK]}],
                                   included_placement="front", **BY)
    await upload(db, product["id"], "White", background(alpha=0))
    clear = await plan_of(db, product["id"], "White")
    assert (clear.motifs[0].surface["variant"], clear.motifs[0].surface["source"]) == ("dark", "background")
    with pytest.raises(ShopError, match="Untergrund"):
        await shop_products.set_layout(db, product["id"], PLACEMENTS, included_placement="front",
                                       print_surface="grau", **BY)


@pytest.mark.asyncio
async def test_an_order_puts_the_gamertag_in_the_contrasting_colour_onto_background_and_motif(db, provider):
    product = await configured(db, provider)
    await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": [LION]},
                                                       {"key": "back", "mode": "upload",
                                                        "layers": [BACK, GAMERTAG_TOP]}],
                                   included_placement="front", **BY)
    await upload(db, product["id"], "White", background())
    await shop_products.generate_print_files(db, product["id"], **BY)
    plan = await plan_of(db, product["id"], "White")
    await publish_unchecked(db, product["id"])
    white = await variant_for(db, product["id"], WHITE_M)
    order, _ = await shop_orders.place_order(
        db, user_id="konto-1", idempotency_key="bestellung-2141-b", buyer_kind="member",
        lines=[{"variant_id": white["id"], "quantity": 1, "gamertag": "Testlöwe"}], shipping_estimate_cents=490,
        billing_address=dict(BILLING), shipping_address=dict(SHIPPING), actor_id="konto-1")
    (item,) = await shop_orders.items_for(db, order["id"])
    back = next(row for row in item["print_files"] if row["placement"] == "back")
    assert back["kind"] == "personal"
    personal = await db.shop_print_files.find_one({"id": back["file_id"]}, {"_id": 0})
    tag = await db.shop_gamertag_files.find_one({"id": back["gamertag_file_id"]}, {"_id": 0})
    assert tag["color_key"] == plan.texts[0].ink == "vereinsblau", "auf Dunkel die Vorgabefarbe"
    base = await shop_print_files.current_base(db, product["id"], plan)
    assert personal["base_file_id"] == base["id"]
    with Image.open(shop_designs._path_of(personal["file_ref"])) as mine:
        assert mine.size == (1800, 2400) and mine.getpixel((10, 10)) == (*NAVY, 255), "der Hintergrund bleibt"
        left, top, width, height = plan.texts[0].box.rounded()
        colours = {mine.getpixel((x, top + height // 2))[:3] for x in range(left, left + width)}
        assert (0x29, 0xB6, 0xE8) in colours, "der Name in Vereinsblau"
    assert "Testlöwe" not in str(personal)


@pytest.mark.asyncio
async def test_the_preview_shows_the_background_under_the_layers(db, provider, monkeypatch):
    product = await configured(db, provider, accept=False)
    await shop_products.set_layout(db, product["id"], [PLACEMENTS[0], {"key": "back", "mode": "upload",
                                                                         "layers": [BACK]}],
                                   included_placement="front", **BY)
    await upload(db, product["id"], "White", background())
    template_png = BytesIO()
    Image.new("RGBA", (1000, 1000), (0, 0, 0, 0)).save(template_png, format="PNG")
    monkeypatch.setattr(templates, "IMAGE_TRANSPORT", httpx.MockTransport(
        lambda request: httpx.Response(200, content=template_png.getvalue(), headers={"content-type": "image/png"})))
    stored = await shop_catalog.get_product(db, product["id"])
    payload = await shop_print_files.preview_png(db, stored, placement="back", color="White")
    from printful_fake import template_box

    box = template_box(12, 16)
    with Image.open(BytesIO(payload)) as img:
        scale = img.width / 1000
        corner = (int((box["print_area_left"] + 5) * scale), int((box["print_area_top"] + 5) * scale))
        assert img.getpixel(corner) == NAVY, "der Hintergrund statt der weißen Shirtfarbe"
    state = await state_of(db, product["id"], "White")
    thumb = await shop_print_files.admin_thumb(db, product["id"], state["background"]["id"])
    with Image.open(BytesIO(thumb)) as img:
        assert max(img.size) == shop_print_files.THUMB_SIDE and img.getpixel((5, 5)) == (*NAVY, 255)
    with pytest.raises(LookupError):
        await shop_print_files.admin_thumb(db, "anderes-produkt", state["background"]["id"])
