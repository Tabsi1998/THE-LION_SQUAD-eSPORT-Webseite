"""Druckdatei-Generator und Ablage (#2069): exakte Pixel, Transparenz, Determinismus, Prüfungen mit Zahlen, der
injizierbare Motiv-Renderer (Teil A), fertige Dateien für Profis, Vorschau und die Umstellung alter Zoll-Positionen.

Printful ist der Vertrags-Fake über den echten Adapter - kein echter Aufruf. Designs und Namen sind erfunden."""
import hashlib
import io
import pathlib
import sys
from io import BytesIO

import httpx
import pytest
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import shop_catalog, shop_designs, shop_print_files, shop_products  # noqa: E402
from services import shop_print_templates as templates  # noqa: E402
from services.shop_common import ShopError  # noqa: E402
from shop_testdata import logo_png  # noqa: E402
from test_shop_products_unit import (  # noqa: E402,F401 - Fixtures und Helfer der Produktverwaltung
    BACK, BY, LION, PLACEMENTS, PRINTFUL_PRODUCT, club_designs, configured, db, design, design_dir, fake,
    new_product, provider)

Layer = shop_print_files.Layer


def square(size: int, color=(255, 255, 255, 255)) -> bytes:
    out = BytesIO()
    Image.new("RGBA", (size, size), color).save(out, format="PNG")
    return out.getvalue()


# ---------------------------------------------------------------- Generator (rein)

def test_the_print_file_is_the_whole_area_in_exact_pixels_transparent_and_deterministic():
    layers = [Layer(png=square(100), left=10, top=20, width=50, height=50, label="Löwe", native_width_px=1000)]
    first = shop_print_files.compose_print_file(1800, 2400, 150, layers)
    second = shop_print_files.compose_print_file(1800, 2400, 150, layers)
    assert first.sha256 == second.sha256 and first.payload == second.payload, "gleiche Eingaben, gleiche Datei"
    with Image.open(BytesIO(first.payload)) as img:
        assert img.size == (1800, 2400) and img.mode == "RGBA" and img.format == "PNG"
        assert set(img.info) == {"dpi"} and tuple(map(round, img.info["dpi"])) == (150, 150)
        assert img.getpixel((0, 0))[3] == 0 and img.getpixel((1799, 2399))[3] == 0
        assert img.getpixel((10, 20)) == (255, 255, 255, 255) and img.getpixel((59, 69))[3] == 255
        assert img.getpixel((60, 70))[3] == 0
    moved = shop_print_files.compose_print_file(1800, 2400, 150, [Layer(**{**layers[0].__dict__, "left": 11})])
    assert moved.sha256 != first.sha256


def test_a_motif_outside_the_area_is_refused_with_px_cm_and_inches():
    for left, top, width in ((-5, 10, 50), (1790, 10, 50), (10, 2390, 50), (10, 10, 1900)):
        with pytest.raises(ShopError) as refused:
            shop_print_files.compose_print_file(1800, 2400, 150, [Layer(png=square(50), left=left, top=top,
                                                                        width=width, height=50, label="Löwe")])
        text = str(refused.value)
        assert "„Löwe“ ragt" in text and " px = " in text and " cm (" in text and "Zoll)" in text
    with pytest.raises(ShopError, match="Sicherheitsrand"):
        shop_print_files.compose_print_file(4950, 6750, 150, [Layer(png=square(50), left=50, top=500, width=200,
                                                                    height=200, label="Logo")],
                                            safe_margin_px=templates.cm_to_px(2.0, 150))


def test_a_raster_motif_needs_enough_dpi_at_the_chosen_size():
    # 600 px auf 20 cm bei 150 DPI: 76 DPI - abgelehnt (unter 2/3 von 150), mit den nötigen Pixeln.
    too_small = Layer(png=square(60), left=0, top=0, width=1181, height=1181, label="Logo", native_width_px=600)
    with pytest.raises(ShopError) as refused:
        shop_print_files.compose_print_file(1800, 2400, 150, [too_small])
    text = str(refused.value)
    assert "Zu wenig Auflösung" in text and "600 px Breite" in text and "20 cm (7,87 Zoll)" in text
    assert "76 DPI" in text and "99 DPI" in text and "780 px" in text
    # 1000 px: 127 DPI - geht, aber mit Warnung.
    snug = Layer(png=square(60), left=0, top=0, width=1181, height=1181, label="Logo", native_width_px=1000)
    composed = shop_print_files.compose_print_file(1800, 2400, 150, [snug])
    assert composed.warnings and composed.warnings[0].startswith("Knapp:") and "127 DPI" in composed.warnings[0]
    # Ein Vektor (keine Quellpixel) hat keine DPI-Grenze.
    vector = Layer(png=square(60), left=0, top=0, width=1181, height=1181, label="Logo")
    assert shop_print_files.compose_print_file(1800, 2400, 150, [vector]).warnings == ()


def test_a_name_goes_onto_the_base_file_and_the_sizes_must_match():
    base = shop_print_files.compose_print_file(600, 525, 150, [Layer(png=square(10), left=0, top=0, width=100,
                                                                     height=100, label="Wappen")]).payload
    named = shop_print_files.compose_print_file(600, 525, 150, [Layer(png=square(10, (41, 182, 232, 255)), left=300,
                                                                      top=300, width=100, height=50,
                                                                      label="Gamertag")], base=base)
    with Image.open(BytesIO(named.payload)) as img:
        assert img.getpixel((50, 50))[3] == 255 and img.getpixel((350, 320)) == (41, 182, 232, 255)
    with pytest.raises(ShopError, match="Grunddatei hat 600 × 525 px"):
        shop_print_files.compose_print_file(450, 450, 150, [], base=base)
    with pytest.raises(ShopError, match="Millionen Pixel"):
        shop_print_files.compose_print_file(20000, 20000, 150, [])


# ---------------------------------------------------------------- Injizierbarer Motiv-Renderer (bis Teil A)

class FakeMotifs:
    """Ein Fake statt der Motiv-Bibliothek aus Teil A: Vektor-Motive mit festem Seitenverhältnis, je Shirtfarbe hell
    oder dunkel nach dem Farbwert - genau die zwei Stellen, die Teil A später ersetzt."""

    def __init__(self):
        self.rendered = []

    async def source(self, db, motif, color, color_hex):
        variant = "light" if (color_hex or "#000000").lower() in ("#ffffff",) else "dark"
        return shop_print_files.MotifSource(ref={"source": "motif", "motif_key": motif["key"], "variant": variant},
                                            width_px=2000, height_px=1000, title=f"{motif['key']} ({variant})",
                                            vector=True)

    async def png(self, db, source, *, width_px, dpi):
        self.rendered.append((source.ref["variant"], width_px, dpi))
        color = (0, 0, 0, 255) if source.ref["variant"] == "light" else (255, 255, 255, 255)
        return logo_png(width_px, width_px // 2, color)


@pytest.mark.asyncio
async def test_the_motif_access_sits_in_one_place_and_takes_a_fake_renderer(db, provider, fake, monkeypatch):
    motifs = FakeMotifs()
    monkeypatch.setattr(shop_print_files, "_motif_source", motifs.source)
    monkeypatch.setattr(shop_print_files, "_motif_png", motifs.png)
    fake.use_profile(PRINTFUL_PRODUCT, "snapback")
    product = await new_product(db, title="Snapback Test", personalization="none")
    await shop_products.load_printful_product(db, product["id"], PRINTFUL_PRODUCT, provider=provider, **BY)
    await shop_products.set_offer(db, product["id"], technique="dtf", colors=["Black", "White"], sizes=["M"],
                                  provider=provider, **BY)
    await club_designs(db)
    await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": [
        {"kind": "motif", "preset": "cap_front", "width_cm": 10.0, "motif": {"key": "loewe-weiss"}}]}],
        included_placement="front", **BY)
    result = await shop_products.generate_print_files(db, product["id"], **BY)
    assert {(item["color"], item["placement"]) for item in result["created"]} == {("Black", "front"),
                                                                                    ("White", "front")}
    assert sorted(motifs.rendered) == [("dark", 1182, 300), ("light", 1182, 300)], "je Farbe die passende Variante"
    rows = await db.shop_print_files.find({"product_id": product["id"]}, {"_id": 0}).to_list(5)
    assert {(row["width_px"], row["height_px"], row["dpi"]) for row in rows} == {(1350, 705, 300)}
    assert {row["sources"][0]["variant"] for row in rows} == {"light", "dark"}


@pytest.mark.asyncio
async def test_the_allover_jersey_gets_its_large_file(db, provider, fake, monkeypatch):
    motifs = FakeMotifs()
    monkeypatch.setattr(shop_print_files, "_motif_source", motifs.source)
    monkeypatch.setattr(shop_print_files, "_motif_png", motifs.png)
    fake.use_profile(PRINTFUL_PRODUCT, "jersey")
    product = await new_product(db, title="Trikot Test", personalization="none")
    await shop_products.load_printful_product(db, product["id"], PRINTFUL_PRODUCT, provider=provider, **BY)
    await shop_products.set_offer(db, product["id"], technique="sublimation", colors=["Black"], sizes=["M"],
                                  provider=provider, **BY)
    await club_designs(db)
    await shop_products.set_layout(db, product["id"], [{"key": "back", "layers": [
        {"kind": "motif", "preset": "back_large", "width_cm": 40.0, "motif": {"key": "ruecken-weiss"}}]}],
        included_placement="back", **BY)
    await shop_products.generate_print_files(db, product["id"], **BY)
    row = await shop_print_files.latest_base(db, product["id"], "back", "all", "Black")
    assert (row["width_px"], row["height_px"], row["dpi"]) == (4950, 6750, 150)
    with Image.open(shop_designs._path_of(row["file_ref"])) as img:
        assert img.size == (4950, 6750)
        # Rücken groß: 5 cm von oben, mittig - 40 cm breit, Seitenverhältnis 2:1.
        assert img.getpixel((2475, int(templates.cm_to_px(5.0 + 10.0, 150))))[3] == 255
        assert img.getpixel((2475, int(templates.cm_to_px(4.0, 150))))[3] == 0


# ---------------------------------------------------------------- Fertige Druckdatei für Profis

def png_of(width: int, height: int) -> bytes:
    out = BytesIO()
    Image.new("RGBA", (width, height), (10, 20, 30, 0)).save(out, format="PNG")
    return out.getvalue()


@pytest.mark.asyncio
async def test_a_finished_print_file_is_checked_exactly_against_the_template(db, provider):
    product = await configured(db, provider, accept=False)
    upload_mode = [PLACEMENTS[0], {"key": "back", "mode": "upload", "layers": []}]
    await shop_products.set_layout(db, product["id"], upload_mode, included_placement="front", **BY)
    view = await shop_products.admin_view(db, product["id"])
    back = next(row for row in view["placements"] if row["key"] == "back")
    assert {state["state"] for state in back["files"]} == {"missing"}
    common = {"placement": "back", "color": "Black", "filename": "ruecken.png", "content_type": "image/png", **BY}
    with pytest.raises(ShopError) as wrong:
        await shop_print_files.upload(db, product["id"], data=png_of(1800, 1800), **common)
    assert "Falsches Seitenverhältnis" in str(wrong.value) and "1800 × 2400 px" in str(wrong.value)
    assert "30,5 cm (12 Zoll)" in str(wrong.value) and "150 DPI" in str(wrong.value)
    with pytest.raises(ShopError) as small:
        await shop_print_files.upload(db, product["id"], data=png_of(900, 1200), **common)
    assert "Zu wenig Pixel" in str(small.value) and "75 DPI" in str(small.value)
    exact = await shop_print_files.upload(db, product["id"], data=png_of(1800, 2400), **common)
    assert exact["version"] == 2 and exact["origin"] == "upload" and (exact["width_px"], exact["height_px"]) == (1800,
                                                                                                                2400)
    bigger = await shop_print_files.upload(db, product["id"], data=png_of(3600, 4800),
                                           **{**common, "color": "White"})
    assert bigger["notes"][0].startswith("Auf die exakte Größe 1800 × 2400 px verkleinert")
    with Image.open(shop_designs._path_of((await shop_print_files.latest_base(
            db, product["id"], "back", "all", "White"))["file_ref"])) as img:
        assert img.size == (1800, 2400)
    view = await shop_products.admin_view(db, product["id"])
    back = next(row for row in view["placements"] if row["key"] == "back")
    assert {state["state"] for state in back["files"]} == {"ok"}
    entry = await db.audit_logs.find_one({"action": "shop.print_file.add", "data.origin": "upload"}, {"_id": 0})
    assert entry and entry["actor_id"] == BY["actor_id"]


# ---------------------------------------------------------------- Vorschau

@pytest.mark.asyncio
async def test_the_preview_puts_the_file_over_the_template_image_on_the_shirt_color(db, provider, monkeypatch):
    from printful_fake import template_box

    product = await configured(db, provider, accept=False)
    template_png = BytesIO()
    Image.new("RGBA", (1000, 1000), (0, 0, 0, 0)).save(template_png, format="PNG")
    monkeypatch.setattr(templates, "IMAGE_TRANSPORT", httpx.MockTransport(
        lambda request: httpx.Response(200, content=template_png.getvalue(), headers={"content-type": "image/png"})))
    stored = await shop_catalog.get_product(db, product["id"])
    payload = await shop_print_files.preview_png(db, stored, placement="front", color="Black")
    box = template_box(12, 16)
    with Image.open(BytesIO(payload)) as img:
        assert img.size == (900, 900) and img.mode == "RGB"
        assert img.getpixel((5, 5)) == (12, 12, 12), "die Shirtfarbe von Printful (#0c0c0c)"
        scale = 900 / 1000
        lion_x = (box["print_area_left"] + (223 + 263) * box["print_area_width"] / 1800) * scale
        lion_y = (box["print_area_top"] + (295 + 263) * box["print_area_height"] / 2400) * scale
        assert img.getpixel((int(lion_x), int(lion_y))) == (255, 255, 255), "der weiße Löwe an seiner Stelle"
    with pytest.raises(LookupError):
        await shop_print_files.preview_png(db, stored, placement="front", color="Pink")


# ---------------------------------------------------------------- Umstellung alter Zoll-Positionen

LEGACY = [
    {"key": "front_right", "kind": "design", "printful_placement": "front",
     "position": {"left_in": 1.49, "top_in": 1.0, "width_in": 3.5, "height_in": 3.5},
     "designs": [{"color": "Black", "design_key": "loewe-weiss"}, {"color": "White", "design_key": "loewe-schwarz"}]},
    {"key": "front_left", "kind": "gamertag", "printful_placement": "front",
     "position": {"left_in": 7.0, "top_in": 1.0, "width_in": 3.5, "height_in": 3.5}, "designs": []},
    {"key": "back", "kind": "design", "printful_placement": "back",
     "position": {"left_in": 1.0, "top_in": 1.0, "width_in": 10.0, "height_in": 10.0},
     "designs": [{"color": "Black", "design_key": "ruecken-weiss"}, {"color": "White", "design_key": "ruecken-schwarz"}]},
]


async def legacy_product(db, provider) -> dict:
    product = await configured(db, provider, accept=False, generate=False)
    await db.shop_products.update_one({"id": product["id"]}, {"$set": {"placements": LEGACY}})
    return await shop_catalog.get_product(db, product["id"])


@pytest.mark.asyncio
async def test_old_inch_positions_are_converted_keeping_the_position(db, provider):
    product = await legacy_product(db, provider)
    report = await shop_print_files.migrate(db)
    (item,) = report
    assert item["ready"] is True and "applied" not in item
    assert (await shop_catalog.get_product(db, product["id"]))["placements"] == LEGACY, "Trockenlauf schreibt nichts"
    front, back = item["rows"]
    assert [layer["kind"] for layer in front["layers"]] == ["motif", "gamertag"]
    lion = front["layers"][0]
    assert lion["preset"] == "chest_right" and lion["width_cm"] == 8.89
    assert lion["motif"] == {"key": "loewe-weiss", "by_color": {"White": "loewe-schwarz"}}
    assert front["layers"][1]["preset"] == "text_opposite" and back["layers"][0]["preset"] == "back_large"
    # Die Position bleibt: der neue Rahmen liegt genau auf dem alten (links 1,49 Zoll, oben 1 Zoll).
    view = await shop_products.admin_view(db, product["id"])
    assert view["layout_converted"] is True
    black = next(state for row in view["placements"] if row["key"] == "front" for state in row["files"]
                 if state["color"] == "Black")
    planned = black["plan"]["layers"][0]
    assert abs(planned["left_px"] - 1.49 * 150) <= 1 and abs(planned["top_px"] - 150) <= 1
    assert any("Gamertag" in note and "prüfen" in note for note in item["notes"])
    # Anwenden: Ebenen gespeichert, alte Platzierungen aufbewahrt, Druckdateien gleich erzeugt.
    applied = await shop_print_files.migrate(db, apply=True)
    assert applied[0]["applied"] is True and any("4 erzeugt" in note for note in applied[0]["notes"])
    stored = await shop_catalog.get_product(db, product["id"])
    assert stored["placements_legacy"] == LEGACY and all(shop_print_files.is_layout(row) for row in stored["placements"])
    assert await shop_print_files.migrate(db) == [], "nichts mehr umzustellen"
    # Rückweg.
    assert (await shop_print_files.rollback_migration(db))[0]["placements"] == 3
    back_again = await shop_print_files.rollback_migration(db, apply=True)
    assert back_again[0]["applied"] is True
    restored = await shop_catalog.get_product(db, product["id"])
    assert restored["placements"] == LEGACY and restored["placements_legacy"] is None
    actions = [row["data"]["migration"] async for row in db.audit_logs.find({"action": "shop.product.layout",
                                                                             "data.migration": {"$exists": True}})]
    assert actions == ["apply", "rollback"]


@pytest.mark.asyncio
async def test_the_migration_script_reports_and_applies(db, provider):
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
    import shop_print_layout

    product = await legacy_product(db, provider)
    out = io.StringIO()
    assert await shop_print_layout.main([], db=db, out=out) == 0
    assert "würde" in out.getvalue() and "Trockenlauf" in out.getvalue() and "chest_right" not in out.getvalue()
    assert "Brust rechts (vom Träger aus)" in out.getvalue()
    out = io.StringIO()
    assert await shop_print_layout.main(["--anwenden"], db=db, out=out) == 0
    assert "neu" in out.getvalue()
    out = io.StringIO()
    assert await shop_print_layout.main(["--abbauen", "--anwenden"], db=db, out=out) == 0
    assert "zurück" in out.getvalue()
    assert (await shop_catalog.get_product(db, product["id"]))["placements"] == LEGACY


@pytest.mark.asyncio
async def test_a_product_without_template_is_skipped_by_the_migration(db, provider):
    product = await legacy_product(db, provider)
    await db.shop_print_templates.delete_many({})
    (item,) = await shop_print_files.migrate(db, apply=True)
    assert item["ready"] is False and "abgleichen" in item["notes"][0]
    assert (await shop_catalog.get_product(db, product["id"]))["placements"] == LEGACY


def test_public_print_file_names_carry_no_name():
    row = {"sha256": hashlib.sha256(b"x").hexdigest(), "public_id": "a" * 43, "file_name": None}
    assert shop_print_files.file_name(row) == f"druck-{row['sha256'][:16]}.png"
    assert shop_print_files.public_path(row).startswith("/api/shop/print-files/")


@pytest.mark.asyncio
async def test_a_design_without_its_file_is_reported_not_crashed(db, provider, design_dir):
    product = await configured(db, provider, accept=False, generate=False)
    latest = await shop_catalog.latest_design(db, "ruecken-weiss")
    shop_designs._path_of(latest["file_ref"]).unlink()
    result = await shop_products.generate_print_files(db, product["id"], **BY)
    failed = [item for item in result["failed"] if item["placement"] == "back" and item["color"] == "Black"]
    assert failed and "fehlt auf dem Server" in failed[0]["detail"]
    assert BACK["motif"]["key"] == "ruecken-weiss" and LION["preset"] == "chest_right"
    await design(db, "ruecken-weiss", "back", ["Black"], width=3000, height=3000)
    result = await shop_products.generate_print_files(db, product["id"], **BY)
    assert not result["failed"]
