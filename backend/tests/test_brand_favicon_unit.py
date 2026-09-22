"""Standard-Favicon für hell und dunkel (#229), reine Bildlogik: Quelle, Farbe, Hinweis, Ergebnisbild."""
import io
import pathlib
import sys

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import brand_favicon  # noqa: E402


def white_mark(width=300, height=120) -> bytes:
    """Ein weißes Rechteck mit durchsichtigem Rand - so sieht das Maskottchen für den Kreis aus."""
    image = Image.new("RGBA", (width + 40, height + 40), (0, 0, 0, 0))
    image.paste((255, 255, 255, 255), (20, 20, 20 + width, 20 + height))
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def test_colour_parsing_falls_back_to_the_club_blue():
    assert brand_favicon.hex_to_rgb("#FF0000") == (255, 0, 0)
    assert brand_favicon.hex_to_rgb("0f0") == (0, 255, 0)
    assert brand_favicon.hex_to_rgb("") == (41, 182, 232)
    assert brand_favicon.hex_to_rgb("#zzzzzz") == (41, 182, 232)


def test_source_prefers_the_white_variants_and_falls_back_to_the_builtin_mascot():
    assert brand_favicon.pick_source({"favicon_dark_url": "/api/static/uploads/d.png", "mascot_url": "/api/static/uploads/m.png"}) == "/api/static/uploads/d.png"
    assert brand_favicon.pick_source({"mascot_url": " /api/static/uploads/m.png "}) == "/api/static/uploads/m.png"
    assert brand_favicon.pick_source({"favicon_light_url": "/api/static/uploads/l.png"}) == brand_favicon.BUILTIN_MASCOT
    assert brand_favicon.pick_source(None) == brand_favicon.BUILTIN_MASCOT
    assert brand_favicon.asset_path(brand_favicon.BUILTIN_MASCOT) is not None, "das eingebaute Maskottchen liegt im Repo"
    assert brand_favicon.asset_path("https://evil.example/x.png") is None
    assert brand_favicon.asset_path("/assets/brand/../../server.py") is None


def test_hint_only_when_the_default_is_the_dark_variant():
    assert brand_favicon.dark_only_default({"favicon_url": "/u/m.png", "mascot_url": "/u/m.png"}) is True
    assert brand_favicon.dark_only_default({"favicon_url": "/u/m.png", "favicon_dark_url": "/u/m.png"}) is True
    assert brand_favicon.dark_only_default({"favicon_url": "/u/f.png", "mascot_url": "/u/m.png"}) is False
    assert brand_favicon.dark_only_default({"favicon_url": "", "mascot_url": "/u/m.png"}) is False
    assert brand_favicon.dark_only_default(None) is False


def test_result_is_a_square_png_with_a_coloured_disc_and_the_mark_centred():
    data = brand_favicon.universal_favicon_png(white_mark(), "#FF0000")
    with Image.open(io.BytesIO(data)) as out:
        assert out.format == "PNG" and out.size == (512, 512) and out.mode == "RGBA"
        assert out.getpixel((0, 0))[3] == 0, "die Ecken bleiben durchsichtig - der Kreis ist rund"
        ring = out.getpixel((256, 24))
        assert ring[:3] == (255, 0, 0) and ring[3] == 255, "am Rand die Akzentfarbe"
        assert out.getpixel((256, 256))[:3] == (255, 255, 255), "in der Mitte das weiße Logo"
        assert out.getpixel((256, 120))[:3] == (255, 0, 0), "das Logo füllt den Kreis nicht ganz - Luft bleibt"
