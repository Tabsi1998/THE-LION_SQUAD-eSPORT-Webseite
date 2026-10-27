"""Gamertag-Druckdatei (#1711): Regeln, Prüfung und Renderer ohne Datenbank.

Alle Namen hier sind erfunden (Testname, TestnameAB …) - keine echten Gamertags."""
import builtins
import socket
from io import BytesIO

import pytest
from PIL import Image

from services import shop_gamertag
from services.shop_common import ShopError

RULES = shop_gamertag.default_rules()


def png(rendered) -> Image.Image:
    img = Image.open(BytesIO(rendered.payload))
    img.load()
    return img


def ink_box(img: Image.Image) -> tuple[int, int, int, int]:
    return img.getchannel("A").point(lambda value: 255 if value > 127 else 0).getbbox()


# ---------------------------------------------------------------- Text prüfen

@pytest.mark.parametrize("raw, expected", [
    ("Testname", "Testname"),
    ("  Test   Name  ", "Test Name"),          # Rand getrimmt, innen ein Leerzeichen
    ("Löwe_Ä-ß.9", "Löwe_Ä-ß.9"),               # Umlaute, ß, Ziffern, _ - .
    ("Löwe", "Löwe"),                     # zusammengesetztes ö wird ein Zeichen (NFC)
])
def test_allowed_names_are_cleaned_visibly(raw, expected):
    assert shop_gamertag.clean_text(raw, RULES) == expected


@pytest.mark.parametrize("raw, words", [
    ("", "leer"),
    ("    ", "leer"),
    (None, "leer"),
    ("T", "mindestens 2 Zeichen"),
    ("Testname-zu-lang-x", "höchstens 16 Zeichen"),
    ("Test\U0001F981", "Emojis"),
    ("Test❤️", "Emojis"),
    ("Test$Name", "„$“"),
    ("Test@Na#me", "„@“, „#“"),
    ("Test\tName", "Steuerzeichen"),
    ("Ｔｅｓｔ", "„Ｔ“"),                         # Vollbreite wird nicht still umgedeutet
])
def test_unsuitable_names_are_refused_with_a_reason(raw, words):
    with pytest.raises(ShopError) as refused:
        shop_gamertag.clean_text(raw, RULES)
    assert words in str(refused.value)


def test_the_refusal_never_repeats_the_whole_name():
    with pytest.raises(ShopError) as refused:
        shop_gamertag.clean_text("Geheimname$", RULES)
    assert "Geheimname" not in str(refused.value)


# ---------------------------------------------------------------- Renderer: Maße, DPI, Transparenz

def test_a_short_name_is_rendered_at_full_height_with_transparency_and_dpi():
    rendered = shop_gamertag.render("Testname", RULES)
    img = png(rendered)
    assert img.mode == "RGBA" and img.size == (1050, rendered.meta["height_px"])
    assert img.info["dpi"] == pytest.approx((300, 300), abs=0.01)
    assert img.getchannel("A").getextrema() == (0, 255)
    meta = rendered.meta
    assert meta["scaled"] is False and meta["text_height_in"] == pytest.approx(0.5, abs=0.01)
    assert meta["width_px"] == 1050 and meta["dpi"] == 300 and meta["print_width_in"] == 3.5
    assert meta["text_width_in"] <= 3.5
    assert "Zoll" in meta["measures"]["text_height"] and "cm" in meta["measures"]["text_height"]


def test_cap_height_is_half_an_inch_and_the_name_is_centred_on_the_anchor():
    rendered = shop_gamertag.render("HHH", RULES)
    left, top, right, bottom = ink_box(png(rendered))
    assert bottom - top == pytest.approx(150, abs=2)            # 0,5 Zoll bei 300 DPI
    assert (top + bottom) / 2 == pytest.approx(rendered.meta["anchor_y_px"], abs=1.5)
    assert rendered.meta["anchor_y_px"] == rendered.meta["height_px"] / 2
    assert (left + right) / 2 == pytest.approx(525, abs=2)       # mittig in der Höchstbreite
    assert rendered.meta["anchor_y_in"] == pytest.approx(rendered.meta["height_px"] / 2 / 300, abs=0.001)


def test_every_name_has_the_same_canvas_so_one_placement_fits_all():
    sizes = {png(shop_gamertag.render(name, RULES)).size for name in ("Äx", "Testname", "jgpq", "TestnameAB")}
    assert len(sizes) == 1


def test_umlauts_and_descenders_stay_inside_the_canvas():
    img = png(shop_gamertag.render("ÄÖÜ gjpq", RULES))
    left, top, right, bottom = ink_box(img)
    assert top > 0 and bottom < img.height


def test_a_name_that_does_not_fit_is_reduced_down_to_the_minimum():
    rendered = shop_gamertag.render("TestnameAB", RULES)
    meta = rendered.meta
    assert meta["scaled"] is True
    assert 0.4 <= meta["text_height_in"] < 0.5
    assert meta["text_width_in"] <= 3.5
    assert "verkleinert" in meta["notice"]
    left, _top, right, _bottom = ink_box(png(rendered))
    assert right - left <= 1050


def test_a_very_wide_name_is_refused_even_at_the_minimum_height():
    with pytest.raises(ShopError) as refused:
        shop_gamertag.render("WWWWWWWWWW", RULES)
    text = str(refused.value)
    assert "zu breit" in text and "0,4 Zoll (1 cm)" in text and "3,5 Zoll (8,9 cm)" in text


def test_dpi_and_width_follow_the_rules():
    rules = shop_gamertag.clean_rules({**RULES, "dpi": 600, "max_width_in": 3.0})
    img = png(shop_gamertag.render("Testname", rules))
    assert img.width == 1800 and img.info["dpi"] == pytest.approx((600, 600), abs=0.01)


def test_rendering_is_deterministic_and_depends_on_text_colour_and_rules():
    first = shop_gamertag.render("Testname", RULES)
    again = shop_gamertag.render("  Testname ", RULES)
    assert first.sha256 == again.sha256 and first.payload == again.payload
    assert shop_gamertag.render("Testname", RULES, color_key="weiss").sha256 != first.sha256
    other = shop_gamertag.clean_rules({**RULES, "font": "outfit-800"})
    assert shop_gamertag.render("Testname", other).sha256 != first.sha256
    assert shop_gamertag.rules_hash(other) != shop_gamertag.rules_hash(RULES)


def test_the_ink_has_the_chosen_colour_without_dark_fringes():
    img = png(shop_gamertag.render("Testname", RULES, color_key="weiss"))
    colours = {img.getpixel((x, y))[:3] for x in range(img.width) for y in range(img.height)
               if img.getpixel((x, y))[3] > 0}
    assert colours == {(255, 255, 255)}


def test_rendering_needs_neither_network_nor_files_once_the_font_is_loaded(monkeypatch):
    shop_gamertag.render("Testname", RULES)  # Schrift einmal geladen

    def refuse(*_args, **_kwargs):
        raise AssertionError("kein Netz- oder Dateizugriff beim Rendern")

    monkeypatch.setattr(builtins, "open", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    assert shop_gamertag.render("Testname", RULES, color_key="weiss").sha256


def test_every_font_is_bundled_with_its_licence():
    for key, font in shop_gamertag.FONTS.items():
        path = shop_gamertag.FONT_DIR / font["file"]
        assert path.is_file(), key
        assert (shop_gamertag.FONT_DIR / font["license"]).read_text(encoding="utf-8").count("SIL Open Font License")
        shop_gamertag.render("Test", shop_gamertag.clean_rules({**RULES, "font": key}))


# ---------------------------------------------------------------- Regeln

@pytest.mark.parametrize("change, words", [
    ({"min_text_height_in": 0.6}, "Mindesthöhe"),
    ({"dpi": 200}, "DPI"),
    ({"dpi": 300.5}, "DPI"),
    ({"font": "comic-sans"}, "Schrift"),
    ({"allowed_chars": "ab\U0001F981"}, "Zeichen"),
    ({"allowed_chars": "<\x00"}, "Zeichen"),
    ({"max_length": 0}, "Länge"),
    ({"min_length": 20, "max_length": 10}, "Länge"),
    ({"max_width_in": 30}, "Zoll"),
    ({"align": "justify"}, "Ausrichtung"),
    ({"height_mode": "x"}, "Texthöhe"),
    ({"colors": [{"key": "blau", "label": "Blau", "hex": "blau", "garment_colors": []}],
      "default_color": "blau"}, "#RRGGBB"),
    ({"default_color": "pink"}, "Vorgabefarbe"),
    ({"colors": []}, "Farbe"),
    ({"unknown": 1}, "Unbekannte"),
])
def test_rules_are_checked(change, words):
    with pytest.raises(ShopError) as refused:
        shop_gamertag.clean_rules({**RULES, **change})
    assert words in str(refused.value)


def test_default_rules_follow_the_test_shirt():
    assert RULES["text_height_in"] == 0.5 and RULES["min_text_height_in"] == 0.4
    assert RULES["max_width_in"] == 3.5 and RULES["dpi"] >= 300
    assert RULES["default_color"] == "vereinsblau"
    blue = next(color for color in RULES["colors"] if color["key"] == "vereinsblau")
    assert blue["hex"] == "#29B6E8"  # Rolle „brand“ (frontend/src/styles/system.css)


def test_several_ink_colours_per_shirt_colour_in_their_order():
    rules = shop_gamertag.clean_rules({**RULES, "colors": [
        {"key": "weiss", "label": "Weiß", "hex": "#FFFFFF", "garment_colors": ["Schwarz", "Navy"]},
        {"key": "vereinsblau", "label": "Vereinsblau", "hex": "#29B6E8", "garment_colors": ["schwarz", "Weiß"]},
    ]})
    assert [c["key"] for c in shop_gamertag.inks_for_garment(rules, "SCHWARZ")] == ["weiss", "vereinsblau"]
    assert [c["key"] for c in shop_gamertag.inks_for_garment(rules, "Weiß")] == ["vereinsblau"]
    assert [c["key"] for c in shop_gamertag.inks_for_garment(rules, "Rot")] == ["vereinsblau"]  # Vorgabefarbe
