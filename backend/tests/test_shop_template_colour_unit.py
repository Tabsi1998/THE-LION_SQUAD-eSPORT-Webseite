"""Vorschau in der echten Shirtfarbe (#2105): je angebotener Farbe die passende Printful-Vorlage, und eine Vorlage, die
nicht zu genau einer Farbe gehört, färbt der Server ein.

Die echten Printful-Bilder kennen wir nicht sicher - mal ein deckendes Foto eines hellen Shirts, mal ein durchsichtiges
„Ghost“-PNG. Beides wird hier mit **erfundenen, synthetisch gezeichneten Bildern** geprüft (kein echtes Printful-Bild).
"""
import hashlib
import pathlib
import sys
from io import BytesIO

import httpx
import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient
from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import shop_print_files, shop_products  # noqa: E402
from services import shop_print_templates as templates  # noqa: E402
from test_shop_products_unit import db, design_dir, fake, provider  # noqa: E402,F401 - Fixtures

BLACK, WHITE, SPORT_GREY, NAVY = (12, 12, 12), (255, 255, 255), (155, 150, 156), (29, 35, 53)
SIZE = (200, 240)
AREA = {"left": 70, "top": 80, "width": 60, "height": 80}
BODY = (50, 60, 150, 220)


def luminance(rgb) -> float:
    red, green, blue = rgb[:3]
    return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255


def shirt_mask() -> Image.Image:
    """Ein Shirt: Rumpf und zwei Ärmel."""
    mask = Image.new("L", SIZE, 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle(BODY, fill=255)
    draw.polygon([(50, 60), (15, 100), (35, 120), (50, 100)], fill=255)
    draw.polygon([(150, 60), (185, 100), (165, 120), (150, 100)], fill=255)
    return mask


def shaded(base: int) -> Image.Image:
    """Falten: senkrechte Streifen etwas dunkler und heller als ``base``."""
    img = Image.new("RGB", SIZE, (base, base, base))
    draw = ImageDraw.Draw(img)
    for x in range(0, SIZE[0], 20):
        draw.rectangle((x, 0, x + 6, SIZE[1]), fill=(base - 25, base - 25, base - 25))
        draw.rectangle((x + 10, 0, x + 12, SIZE[1]), fill=(min(255, base + 8),) * 3)
    return img


def opaque_photo(*, outline_gap: bool = False) -> Image.Image:
    """Deckendes Foto eines hellen Shirts auf hellem Hintergrund, mit dunkler Kontur."""
    img = Image.new("RGBA", SIZE, (250, 250, 250, 255))
    img.paste(shaded(232), mask=shirt_mask())
    draw = ImageDraw.Draw(img)
    draw.rectangle(BODY, outline=(150, 150, 150, 255))
    if outline_gap:  # die Kontur hat eine Lücke, das Shirt ist fast so hell wie der Hintergrund
        img.paste(Image.new("RGBA", SIZE, (246, 246, 246, 255)), mask=shirt_mask())
        draw.rectangle(BODY, outline=(150, 150, 150, 255))
        draw.line((BODY[0], 150, BODY[0], 170), fill=(246, 246, 246, 255))
    return img


def ghost_png(*, hole: bool = False) -> Image.Image:
    """Durchsichtiges Ghost-PNG: nur das Shirt deckend, optional mit durchsichtigem Druckbereich (Overlay)."""
    img = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    shirt = shaded(225).convert("RGBA")
    img.paste(shirt, mask=shirt_mask())
    if hole:
        ImageDraw.Draw(img).rectangle((AREA["left"], AREA["top"], AREA["left"] + AREA["width"],
                                       AREA["top"] + AREA["height"]), fill=(0, 0, 0, 0))
    return img


def garment(img: Image.Image) -> list:
    """Pixel mitten im Rumpf (außerhalb eines Lochs)."""
    return [img.getpixel((x, y)) for x in range(55, 145, 3) for y in range(170, 215, 3)]


def mean_luminance(pixels) -> float:
    return sum(luminance(pixel) for pixel in pixels) / len(pixels)


# ---------------------------------------------------------------- Einfärben

@pytest.mark.parametrize("make", [opaque_photo, ghost_png])
def test_black_looks_black_white_looks_white_and_grey_looks_grey(make):
    source = make()
    black = templates.tint(source, BLACK, area=AREA)
    white = templates.tint(source, WHITE, area=AREA)
    grey = templates.tint(source, SPORT_GREY, area=AREA)
    assert mean_luminance(garment(black)) < 0.1, "Schwarz muss wirklich dunkel sein"
    assert luminance(black.getpixel((40, 95))) < 0.1, "auch die Ärmel"
    assert mean_luminance(garment(white)) > 0.8
    assert abs(mean_luminance(garment(grey)) - luminance(SPORT_GREY)) < 0.12
    navy = garment(templates.tint(source, NAVY, area=AREA))
    assert all(pixel[2] >= pixel[0] for pixel in navy), "Marineblau bleibt blau"
    # Falten bleiben: auf Weiß sind die Streifen dunkler als der Stoff daneben.
    assert luminance(white.getpixel((62, 190))) < luminance(white.getpixel((56, 190))) - 0.05


def test_an_opaque_background_stays_unchanged():
    source = opaque_photo()
    black = templates.tint(source, BLACK, area=AREA)
    for corner in ((0, 0), (199, 0), (0, 239), (199, 239), (100, 30)):
        assert black.getpixel(corner) == source.getpixel(corner)
    assert black.size == source.size


def test_a_transparent_ghost_keeps_its_alpha_and_an_overlay_hole_stays_open():
    source = ghost_png(hole=True)
    black = templates.tint(source, BLACK, area=AREA)
    assert black.getpixel((100, 120))[3] == 0, "der Druckbereich bleibt durchsichtig - darunter liegt das Motiv"
    assert black.getpixel((100, 200))[3] == 255 and luminance(black.getpixel((100, 200))) < 0.1
    # Außen herum: ein ruhiger, heller Hintergrund statt Durchsicht - sonst verschwindet ein schwarzes Shirt.
    corner = black.getpixel((2, 2))
    assert corner[3] == 255 and luminance(corner) > 0.85


def test_a_leaking_outline_is_retried_with_a_tighter_tolerance():
    source = opaque_photo(outline_gap=True)
    black = templates.tint(source, BLACK, area=AREA)
    assert mean_luminance(garment(black)) < 0.15, "das helle Shirt fließt nicht in den Hintergrund"
    assert black.getpixel((0, 0)) == source.getpixel((0, 0))


def test_an_image_of_only_guide_lines_is_left_alone():
    lines = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(lines).rectangle((AREA["left"], AREA["top"], AREA["left"] + AREA["width"],
                                     AREA["top"] + AREA["height"]), outline=(80, 80, 80, 255))
    assert templates.tint(lines, BLACK, area=AREA).tobytes() == lines.tobytes()


def test_tinting_is_deterministic():
    source = opaque_photo()
    assert templates.tint(source, NAVY, area=AREA).tobytes() == templates.tint(source, NAVY, area=AREA).tobytes()


# ---------------------------------------------------------------- Welche Vorlage für welche Farbe

def preview(index: int, variant_ids, role="template"):
    return {"index": index, "variant_ids": variant_ids, "placement": "front", "technique": "dtg", "role": role,
            "image_url": f"https://files.cdn.printful.com/upload/v-{index}.png", "background_url": None,
            "background_color": None, "template_width": 200, "template_height": 240, "area": AREA,
            "positioning": "overlay", "orientation": "any"}


COLOR_IDS = {"Black": {11, 12}, "White": {21, 22}, "Navy": {31, 32}}


def test_each_colour_takes_the_template_of_its_own_variants():
    template = {"previews": [preview(0, [11, 12, 21, 22, 31, 32]), preview(1, [11, 12]), preview(2, [21])]}
    entry = {"preview_indexes": [0, 1, 2]}
    black, specific = templates.preview_for_color(template, entry, COLOR_IDS["Black"])
    assert black["index"] == 1 and specific is True
    white, specific = templates.preview_for_color(template, entry, COLOR_IDS["White"])
    assert white["index"] == 2 and specific is True
    navy, specific = templates.preview_for_color(template, entry, COLOR_IDS["Navy"])
    assert navy["index"] == 0 and specific is False, "für alle Farben - wird eingefärbt"
    none, specific = templates.preview_for_color({"previews": []}, {"preview_indexes": []}, COLOR_IDS["Navy"])
    assert none is None and specific is False


def test_a_template_without_variants_or_with_several_colours_is_not_colour_specific():
    template = {"previews": [preview(0, []), preview(1, [11, 21])]}
    assert templates.preview_for_color(template, {"preview_indexes": [0]}, COLOR_IDS["Black"]) == (
        template["previews"][0], False)
    assert templates.preview_for_color(template, {"preview_indexes": [1]}, COLOR_IDS["Black"])[1] is False
    # Die eigentliche Vorlage geht einer Zusatzansicht vor, auch wenn die Zusatzansicht genau die Farbe hat.
    template = {"previews": [preview(0, [11, 12, 21], role="template"), preview(1, [11], role=None)]}
    assert templates.preview_for_color(template, {"preview_indexes": [0, 1]}, COLOR_IDS["Black"])[0]["index"] == 0


# ---------------------------------------------------------------- Über die Website: nur gespeicherte Farbcodes

@pytest_asyncio.fixture
async def colour_db():
    instance = AsyncMongoMockClient()["shop_farbe"]
    await instance.shop_print_templates.insert_one({"printful_product_id": 71, "previews": [preview(0, [11, 21])],
                                                    "entries": []})
    await instance.shop_products.insert_one({"id": "p1", "printful": {
        "product_id": 71, "colors": [{"name": "Black", "code": "#0c0c0c"}, {"name": "White", "code": "#ffffff"}],
        "variants": [{"id": 11, "color": "Black", "color_code": "#0c0c0c"}]}})
    return instance


def png_bytes(img: Image.Image) -> bytes:
    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


@pytest.mark.asyncio
async def test_a_tinted_template_uses_only_stored_codes_and_is_cached(colour_db, monkeypatch, tmp_path):
    import storage

    db = colour_db
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    fetched = []

    def handler(request: httpx.Request) -> httpx.Response:
        fetched.append(str(request.url))
        return httpx.Response(200, content=png_bytes(opaque_photo()), headers={"content-type": "image/png"})

    monkeypatch.setattr(templates, "IMAGE_TRANSPORT", httpx.MockTransport(handler))
    plain = await templates.template_image(db, 71, 0)
    dark = await templates.template_image(db, 71, 0, tint="0C0C0C")
    again = await templates.template_image(db, 71, 0, tint="0c0c0c")
    assert dark == again and dark != plain and len(fetched) == 1
    with Image.open(BytesIO(dark)) as img:
        assert mean_luminance(garment(img.convert("RGBA"))) < 0.1
    cached = sorted(path.name for path in (tmp_path / templates.CACHE_FOLDER).glob("*.png"))
    assert len(cached) == 2 and all(len(name) == 64 + 4 for name in cached), "Name aus der Prüfsumme"
    url = "https://files.cdn.printful.com/upload/v-0.png"
    assert f"{hashlib.sha256(url.encode()).hexdigest()}.png" in cached
    for wrong in ("ff0000", "zzzzzz", "#0c0c0c0", "0c0c0"):
        with pytest.raises(LookupError):
            await templates.template_image(db, 71, 0, tint=wrong)


@pytest.mark.asyncio
async def test_parallel_requests_for_the_same_image_never_fail(colour_db, monkeypatch, tmp_path):
    """Review #2105: zwei gleiche Anfragen schreiben je eine eigene Zwischendatei; ist die Zieldatei beim Umbenennen
    schon da (Windows sperrt sie dann), gilt das als Erfolg - kein 500, keine Zwischendatei bleibt liegen."""
    import asyncio

    import storage

    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(templates, "IMAGE_TRANSPORT", httpx.MockTransport(
        lambda request: httpx.Response(200, content=png_bytes(opaque_photo()), headers={"content-type": "image/png"})))
    results = await asyncio.gather(*(templates.template_image(colour_db, 71, 0, tint="0c0c0c") for _ in range(4)),
                                   *(templates.template_image(colour_db, 71, 0) for _ in range(4)))
    assert len(set(results[:4])) == 1 and len(set(results[4:])) == 1
    folder = tmp_path / templates.CACHE_FOLDER
    assert not list(folder.glob("*.tmp")) and len(list(folder.glob("*.png"))) == 2
    # Das Umbenennen scheitert, die Zieldatei gibt es aber schon: kein Fehler.
    real_replace = type(folder).replace

    def locked(self, target):
        if pathlib.Path(target).is_file():
            raise PermissionError("Zugriff verweigert (Datei in Benutzung)")
        return real_replace(self, target)

    monkeypatch.setattr(type(folder), "replace", locked)
    templates._write_cache(folder / next(folder.glob("*.png")).name, b"neu")
    assert not list(folder.glob("*.tmp"))
    with pytest.raises(PermissionError):
        monkeypatch.setattr(type(folder), "replace", lambda self, target: (_ for _ in ()).throw(PermissionError("x")))
        templates._write_cache(folder / "gibt-es-nicht.png", b"neu")
    assert not list(folder.glob("*.tmp"))


# ---------------------------------------------------------------- Schritt 3 und die Vorschau-PNG je Farbe

@pytest.mark.asyncio
async def test_step_three_gets_a_preview_per_offered_colour(db, provider, fake):
    from test_shop_products_unit import BLACK_L, BLACK_M, PRINTFUL_PRODUCT, configured

    # Printful liefert für Schwarz eine eigene Vorlage; die allgemeine gilt für alle Farben.
    first = fake.templates[PRINTFUL_PRODUCT][0]
    fake.templates[PRINTFUL_PRODUCT].append({**first, "catalog_variant_ids": [BLACK_M, BLACK_L],
                                             "image_url": "https://files.cdn.printful.com/upload/schwarz.png"})
    product = await configured(db, provider, accept=False, generate=False)
    view = await shop_products.admin_view(db, product["id"])
    front = next(row for row in view["available_placements"] if row["key"] == "front")
    by_color = front["preview_by_color"]
    assert set(by_color) == {"Black", "White"}
    assert by_color["Black"]["tinted"] is False and "tint=" not in by_color["Black"]["image_path"]
    assert by_color["Black"]["image_path"] != front["preview"]["image_path"], "die eigene Vorlage für Schwarz"
    assert by_color["White"]["tinted"] is True and by_color["White"]["image_path"].endswith("?tint=ffffff")
    assert by_color["White"]["area"] == front["preview"]["area"]


@pytest.mark.asyncio
async def test_the_preview_png_shows_the_shirt_in_its_colour_not_the_light_template(db, provider, monkeypatch):
    from test_shop_products_unit import configured

    product = await configured(db, provider, accept=False)
    # Ein deckendes, helles Shirtfoto für alle Farben (erfunden): heller Hintergrund, hellgraues Shirt in der Mitte.
    photo = Image.new("RGBA", (1000, 1000), (250, 250, 250, 255))
    ImageDraw.Draw(photo).rectangle((150, 100, 850, 950), fill=(230, 230, 230, 255))
    monkeypatch.setattr(templates, "IMAGE_TRANSPORT", httpx.MockTransport(
        lambda request: httpx.Response(200, content=png_bytes(photo), headers={"content-type": "image/png"})))
    payload = await shop_print_files.preview_png(db, product, placement="front", color="Black")
    with Image.open(BytesIO(payload)) as img:
        assert luminance(img.getpixel((int(180 * 0.9), int(900 * 0.9)))) < 0.1, "das Shirt ist schwarz"
        assert img.getpixel((5, 5)) == (250, 250, 250), "der Hintergrund bleibt"
