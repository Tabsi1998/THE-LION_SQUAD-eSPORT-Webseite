"""Gemeinsamer SVG-Baustein (#2069, #2073): strenge Bereinigung mit Ablehnung und Begründung, Umfärben für helle
Shirts, Analyse und Rastern in genau einer Größe.

Das „Vereinslogo“ hier ist synthetisch im Stil der echten Dateien (nur Pfade, eine ``<style>``-Klasse je Farbe, Weiß
``#fff`` für die Linien, Blau ``#27aae1`` für den Schriftzug) - die echten Vereinsdateien kommen nicht ins Repo."""
import hashlib
import io
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from PIL import Image  # noqa: E402

from services import svg_safe  # noqa: E402

NS = 'xmlns="http://www.w3.org/2000/svg"'
XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"'
RECT = '<rect x="10" y="10" width="80" height="40" fill="#27aae1"/>'

CLUB_LOGO = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<svg id="Ebene_1" data-name="Ebene 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">'
    '<defs><style>.cls-1{fill:#fff;}.cls-2{fill:#27aae1;}</style></defs>'
    '<path class="cls-1" d="M20 20 L180 20 L180 180 L20 180 Z"/>'
    '<path class="cls-1" d="M40 40 L160 40 L100 160 Z"/>'
    '<path class="cls-2" d="M220 60 L380 60 L380 140 L220 140 Z"/>'
    '</svg>'
).encode()


def svg(body: str, attrs: str = 'viewBox="0 0 100 60"') -> bytes:
    return f"<svg {NS} {XLINK} {attrs}>{body}</svg>".encode()


def refused(data: bytes) -> svg_safe.SvgRejected:
    with pytest.raises(svg_safe.SvgRejected) as caught:
        svg_safe.sanitize(data)
    return caught.value


# ---------------------------------------------------------------- Bösartige SVGs: streng abgelehnt, mit Fund

MALICIOUS = {
    "script": (svg(f"<script>alert(1)</script>{RECT}"), "script"),
    "script mit Präfix": (svg(f'<svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script>{RECT}'),
                          "script"),
    "onload": (svg(RECT, attrs='viewBox="0 0 100 60" onload="alert(1)"'), "events"),
    "onclick an einer Form": (svg('<rect width="9" height="9" onclick="alert(1)"/>'), "events"),
    "javascript-href": (svg(f'<a href="javascript:alert(1)">{RECT}</a>'), "script"),
    "javascript kodiert": (svg(f'<a href="java%73cript:alert(1)">{RECT}</a>'), "script"),
    "externe href": (svg('<use href="https://boese.example/sprite.svg#a"/>' + RECT), "external"),
    "externe xlink:href": (svg('<use xlink:href="other.svg#b"/>' + RECT), "external"),
    "foreignObject": (svg('<foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml">'
                          '<iframe src="https://boese.example/"/></body></foreignObject>' + RECT), "foreign"),
    "eingebettetes PNG": (svg('<image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>' + RECT),
                          "raster"),
    "Bild per xlink": (svg('<image xlink:href="logo.png" width="10" height="10"/>' + RECT), "raster"),
    "CSS @import": (svg('<style>@import url(https://boese.example/x.css);.a{fill:#fff}</style>' + RECT), "css"),
    "CSS url nach außen": (svg('<style>.a{fill:url(http://boese.example/x)}</style>' + RECT), "css"),
    "url nach außen im Attribut": (svg('<rect width="5" height="5" fill="url(https://boese.example/a#b)"/>'), "css"),
    "data-URI im Stil": (svg('<rect width="5" height="5" style="fill:url(data:image/png;base64,AAAA)"/>'), "data"),
    "xml:base": (svg(RECT, attrs='viewBox="0 0 100 60" xml:base="https://boese.example/"'), "external"),
    "Stylesheet-Anweisung": (b'<?xml-stylesheet href="https://boese.example/x.css"?>' + svg(RECT), "external"),
    "XInclude": (svg('<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///etc/passwd"/>' + RECT),
                 "external"),
    "Animation setzt href": (svg('<set attributeName="href" to="javascript:alert(2)"/>' + RECT), "script"),
    "Schrift als Text": (svg('<text x="1" y="20">LSW</text>' + RECT), "text"),
}


@pytest.mark.parametrize("name", sorted(MALICIOUS))
def test_a_dangerous_svg_is_refused_and_the_message_names_what_was_found(name):
    data, finding = MALICIOUS[name]
    rejected = refused(data)
    assert rejected.code == "unsafe"
    assert finding in rejected.findings, (name, rejected.findings)
    assert (svg_safe.NOT_VECTOR if finding == "raster" else svg_safe.FINDINGS[finding]) in rejected.message
    # Feste Wörter, nie Text aus der Datei.
    assert "boese.example" not in rejected.message and "alert" not in rejected.message


def test_an_embedded_pixel_image_is_no_real_vector_svg():
    data = svg('<image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/><path d="M0 0 L9 9"/>')
    rejected = refused(data)
    assert rejected.is_vector is False
    assert rejected.message.startswith("Kein echtes Vektor-SVG – enthält ein Pixelbild.")
    assert "eingebettete Daten (data:)" in rejected.message
    assert svg_safe.analyze(data)["is_vector"] is False


XXE = (b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
       b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L9 9">&xxe;</path></svg>')
LAUGHS = (b'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">'
          b'<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>'
          b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><desc>&lol3;</desc></svg>')
PLAIN_DOCTYPE = (b'<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" '
                 b'"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">' + svg(RECT))


@pytest.mark.parametrize("data", [XXE, LAUGHS, PLAIN_DOCTYPE], ids=["xxe", "billion-laughs", "doctype"])
def test_doctype_and_entities_are_refused_in_both_modes(data):
    for strict in (True, False):
        with pytest.raises(svg_safe.SvgRejected) as caught:
            svg_safe.sanitize(data, strict=strict)
        assert caught.value.code == "dtd" and "DTD" in caught.value.message


def test_too_big_and_too_many_elements_are_refused():
    huge = svg("<!--" + "x" * svg_safe.MAX_SVG_BYTES + "-->" + RECT)
    assert refused(huge).code == "too_big"
    assert svg_safe.STATUS["too_big"] == 413
    many = svg('<path d="M0 0 L1 1"/>' * (svg_safe.MAX_ELEMENTS + 1))
    assert refused(many).code == "too_many"
    assert refused(b"<html/>").code == "not_svg"
    assert refused("kein svg".encode()).code == "not_svg"


def test_lenient_mode_cleans_instead_of_refusing_for_the_branding():
    data = svg(f'<script>alert(1)</script><image href="data:image/png;base64,AAAA"/>{RECT}',
               attrs='viewBox="0 0 100 60" onload="alert(1)"')
    text = svg_safe.sanitize(data, strict=False).data.decode()
    assert "script" not in text and "onload" not in text and "<image" not in text and "<rect" in text


# ---------------------------------------------------------------- Gute SVGs

def test_the_club_logo_style_is_accepted_and_analysed():
    clean = svg_safe.sanitize(CLUB_LOGO)
    text = clean.data.decode()
    assert ".cls-1{fill:#fff}" in text and ".cls-2{fill:#27aae1}" in text
    assert "data-name" not in text  # unbekannte Attribute fallen weg, ohne abzulehnen
    info = svg_safe.analyze(CLUB_LOGO)
    assert info["ok"] is True and info["is_vector"] is True and info["findings"] == []
    assert info["view_box"] == [0.0, 0.0, 400.0, 200.0] and info["aspect_ratio"] == 2.0
    assert info["colors"] == [{"hex": "#27aae1", "count": 1}, {"hex": "#ffffff", "count": 1}]


def test_inkscape_metadata_in_other_namespaces_is_dropped_without_refusing():
    data = (b'<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/s'
            b'odipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10" '
            b'inkscape:version="1.3"><sodipodi:namedview pagecolor="#ffffff"/><metadata/>'
            b'<path d="M0 0 L9 9" stroke="#fff"/></svg>')
    text = svg_safe.sanitize(data).data.decode()
    assert "namedview" not in text and "inkscape" not in text and "<path" in text


# ---------------------------------------------------------------- Umfärben

def test_white_becomes_dark_and_the_brand_colour_stays():
    light = svg_safe.recolor(CLUB_LOGO, {"#fff": "#111111"}).decode()
    assert ".cls-1{fill:#111111}" in light and ".cls-2{fill:#27aae1}" in light
    assert [item["hex"] for item in svg_safe.colors(light.encode())] == ["#111111", "#27aae1"]


@pytest.mark.parametrize("white", ["#FFFFFF", "#fff", "#FFF", "white", "rgb(255,255,255)", "rgb(100%, 100%, 100%)",
                                   "RGB(255 255 255)"])
def test_every_spelling_of_white_is_recoloured_in_attributes_and_styles(white):
    data = svg(f'<path d="M0 0 L9 9" fill="{white}"/><path d="M1 1 L8 8" style="stroke:{white};fill:#27AAE1"/>'
               f'<linearGradient id="g"><stop offset="0" stop-color="{white}"/></linearGradient>')
    text = svg_safe.recolor(data, {"#ffffff": "#111111"}).decode()
    assert 'fill="#111111"' in text and "stroke:#111111" in text and 'stop-color="#111111"' in text
    assert "fill:#27AAE1" in text  # die Markenfarbe bleibt, wie sie stand


def test_alpha_stays_and_ids_or_selectors_that_look_like_colours_are_untouched():
    data = svg('<style>#fff{fill:#ffff}.b{fill:rgba(255,255,255,0.5)}</style>'
               '<defs><linearGradient id="fff"><stop offset="0" stop-color="#27aae1"/></linearGradient></defs>'
               '<path id="w" class="b" d="M0 0 L9 9" fill="url(#fff)"/>')
    text = svg_safe.recolor(data, {"#ffffff": "#111111"}).decode()
    assert "#fff{fill:#111111ff}" in text  # Selektor bleibt, Farbe mit Alpha
    assert "rgba(17,17,17,0.5)" in text
    assert 'fill="url(#fff)"' in text and 'id="fff"' in text


def test_the_colour_mapping_takes_only_colours():
    for bad in ({}, {"#fff": "javascript:alert(1)"}, {"weiss": "#000"}, {"#fff": "red"}):
        with pytest.raises(ValueError):
            svg_safe.recolor(CLUB_LOGO, bad)
    assert svg_safe.normalize_color(" #ABC ") == "#aabbcc"
    assert svg_safe.normalize_color("rgb(39, 170, 225)") == "#27aae1"
    assert svg_safe.normalize_color("url(#a)") is None


# ---------------------------------------------------------------- Rastern

def png(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    image.load()
    return image


def test_raster_has_the_exact_width_transparency_and_dpi():
    out = svg_safe.rasterize(CLUB_LOGO, width_px=1234, dpi=300)
    image = png(out)
    assert image.format == "PNG" and image.mode == "RGBA"
    assert image.size == (1234, 617)
    assert image.getpixel((0, 0))[3] == 0  # Rand durchsichtig
    assert image.getpixel((round(100 * 1234 / 400), round(30 * 617 / 200))) == (255, 255, 255, 255)
    assert round(image.info["dpi"][0]) == 300
    tall = png(svg_safe.rasterize(CLUB_LOGO, height_px=333))
    assert tall.size == (666, 333) and "dpi" not in tall.info


def test_raster_is_deterministic():
    first = svg_safe.rasterize(CLUB_LOGO, width_px=900, dpi=150)
    second = svg_safe.rasterize(CLUB_LOGO, width_px=900, dpi=150)
    assert hashlib.sha256(first).hexdigest() == hashlib.sha256(second).hexdigest()
    assert svg_safe.rasterize(CLUB_LOGO, width_px=901, dpi=150) != first


def test_raster_refuses_nonsense_sizes_and_unsafe_input():
    for kwargs in ({}, {"width_px": 10, "height_px": 10}, {"width_px": 0}, {"width_px": -5}, {"width_px": 1.5},
                   {"width_px": True}, {"width_px": 100, "dpi": 0}):
        with pytest.raises(ValueError):
            svg_safe.rasterize(CLUB_LOGO, **kwargs)
    with pytest.raises(svg_safe.SvgRejected) as caught:
        svg_safe.rasterize(CLUB_LOGO, width_px=svg_safe.MAX_RASTER_SIDE + 1)
    assert caught.value.code == "raster_size"
    with pytest.raises(svg_safe.SvgRejected):
        svg_safe.rasterize(svg(f"<script>alert(1)</script>{RECT}"), width_px=100)
