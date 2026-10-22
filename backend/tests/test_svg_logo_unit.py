"""Logos als SVG (#1952): Bereinigung über eine Positivliste, Grenzen, Rasterfassung und die PNG-Adresse für Stellen
ohne SVG. Das Testkorpus unten enthält bösartige Dateien; jede wird bereinigt oder abgelehnt. Ein harmloses Logo bleibt
optisch gleich (Vergleich der Rasterbilder)."""
import io
import json
import pathlib
import sys
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
import resvg_py  # noqa: E402
from PIL import Image, ImageChops, ImageStat  # noqa: E402

from services import svg_logo  # noqa: E402

NS = 'xmlns="http://www.w3.org/2000/svg"'
XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"'
RECT = '<rect x="10" y="10" width="80" height="40" fill="#29B6E8"/>'


def svg(body: str, attrs: str = 'viewBox="0 0 100 60"') -> bytes:
    return f"<svg {NS} {XLINK} {attrs}>{body}</svg>".encode()


def clean_text(data: bytes, **kwargs) -> str:
    return svg_logo.sanitize(data, **kwargs).data.decode("utf-8")


def rejected(data: bytes) -> str:
    with pytest.raises(svg_logo.SvgRejected) as caught:
        svg_logo.sanitize(data)
    return str(caught.value)


def rejected_drawing(data: bytes) -> str:
    with pytest.raises(svg_logo.SvgRejected) as caught:
        svg_logo.prepare(data, trim=False)
    return str(caught.value)


def raster(data: bytes, width: int = 300) -> Image.Image:
    png = bytes(resvg_py.svg_to_bytes(svg_string=data.decode("utf-8"), width=width))
    return Image.open(io.BytesIO(png)).convert("RGBA")


# ---------------------------------------------------------------- Testkorpus: bereinigt

CLEANED = {
    "Skript": svg(f"<script>alert(1)</script>{RECT}<script><![CDATA[fetch('/api/auth/me')]]></script>"),
    "Skript mit Präfix": svg(f'<svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script>{RECT}'),
    "Ereignisse": svg(f'<rect x="1" y="1" width="9" height="9" onclick="alert(1)" onmouseover="alert(2)"/>{RECT}',
                      attrs='viewBox="0 0 100 60" onload="alert(3)"'),
    "Verweis nach außen": svg(f'<a href="javascript:alert(1)">{RECT}</a>'
                              f'<a xlink:href="https://boese.example/">{RECT}</a>{RECT}'),
    "url() nach außen": svg('<rect width="50" height="50" fill="url(https://boese.example/x#a)"/>'
                            '<rect width="50" height="50" style="fill:url(//boese.example/x);stroke:#000"/>'
                            '<rect width="50" height="50" style="fill: u\\72l(https://boese.example/)"/>' + RECT),
    "foreignObject": svg(f'<foreignObject width="100" height="60"><body xmlns="http://www.w3.org/1999/xhtml">'
                         f'<iframe src="https://boese.example/"></iframe><script>alert(1)</script></body>'
                         f'</foreignObject>{RECT}'),
    "style mit @import": svg('<style>@import url(https://boese.example/x.css);@import "//boese.example/y.css";'
                             '@font-face{font-family:x;src:url(https://boese.example/f.woff)}'
                             '.a{fill:#29B6E8;background:url(https://boese.example/z.png)}'
                             '.b{fill:expression(alert(1));behavior:url(x.htc);-moz-binding:url(x.xml#y)}</style>'
                             '<rect class="a b" x="10" y="10" width="80" height="40"/>'),
    "eingebettetes Bild": svg('<image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>'
                              '<image xlink:href="/etc/passwd" width="10" height="10"/>'
                              '<image href="../documents/geheim.png" width="10" height="10"/>'
                              '<image href="https://boese.example/a.svg" width="10" height="10"/>' + RECT),
    "use nach außen": svg('<use href="https://boese.example/sprite.svg#a"/><use xlink:href="other.svg#b"/>'
                          '<use href="file:///etc/passwd#c"/>' + RECT),
    "data-URI": svg('<use href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+#x"/>'
                    '<rect width="5" height="5" fill="url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)"/>'
                    '<rect width="5" height="5" style="fill:url(\'data:image/png;base64,AAAA\')"/>' + RECT),
    "Animation tauscht Verweis": svg(f'<a href="#x"><animate attributeName="href" to="javascript:alert(1)"/>'
                                     f'<set attributeName="href" to="javascript:alert(2)"/>{RECT}</a>{RECT}'),
    "XInclude": svg('<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///etc/passwd" '
                    f'parse="text"/>{RECT}'),
    "xml:base und Stylesheet-Anweisung": (
        b'<?xml-stylesheet href="https://boese.example/x.css" type="text/css"?>'
        + svg(RECT, attrs='viewBox="0 0 100 60" xml:base="https://boese.example/"')
    ),
    "Filter und Muster": svg('<filter id="f"><feImage href="https://boese.example/x.png"/></filter>'
                             '<pattern id="p"><image href="https://boese.example/y.png"/></pattern>'
                             f'<rect width="5" height="5" filter="url(#f)" fill="url(#p)"/>{RECT}'),
    "Rekursion über use": svg('<g id="a"><use href="#a"/></g><g id="b"><use href="#c"/></g>'
                              '<g id="c"><use href="#b"/></g>' + RECT),
}

FORBIDDEN = ("script", "onload", "onclick", "onmouseover", "javascript", "boese.example", "foreignobject", "iframe",
             "@import", "@font-face", "expression", "behavior", "binding", "data:", "<image", "passwd", "geheim",
             "other.svg", "file:", "xml:base", "xml-stylesheet", "xinclude", "animate", "<set", "<filter", "<pattern",
             "<a ", "\\")


@pytest.mark.parametrize("name", sorted(CLEANED))
def test_malicious_svg_is_cleaned_and_keeps_only_the_harmless_drawing(name):
    text = clean_text(CLEANED[name])
    lowered = text.lower()
    for word in FORBIDDEN:
        assert word not in lowered, f"{name}: „{word}“ steht noch drin"
    assert "<rect" in text, f"{name}: das harmlose Rechteck fehlt"
    # Was übrig bleibt, ist wieder gültiges SVG und lässt sich zeichnen.
    assert raster(text.encode()).getchannel("A").getbbox() is not None


def test_style_block_keeps_safe_rules_and_drops_everything_else():
    text = clean_text(CLEANED["style mit @import"])
    assert ".a{fill:#29B6E8}" in text
    assert ".b{" not in text  # nichts Erlaubtes übrig


def test_internal_references_survive():
    data = svg('<defs><linearGradient id="g1"><stop offset="0" stop-color="#29B6E8"/>'
               '<stop offset="1" stop-color="#fff"/></linearGradient><linearGradient id="g2" xlink:href="#g1" x2="1"/>'
               '<clipPath id="c"><circle cx="50" cy="30" r="25"/></clipPath>'
               '<symbol id="s"><rect width="10" height="10"/></symbol></defs>'
               '<rect width="100" height="60" fill="url(#g2)" clip-path="url(#c)"/><use href="#s" x="5" y="5"/>'
               '<use xlink:href="#fehlt"/>')
    text = clean_text(data)
    assert 'href="#g1"' in text
    assert 'fill="url(#g2)"' in text and 'clip-path="url(#c)"' in text
    assert 'href="#s"' in text
    assert "#fehlt" not in text


# ---------------------------------------------------------------- Testkorpus: abgelehnt

XXE = (b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
       b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>&xxe;</text></svg>')
LAUGHS = (b'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;">'
          b'<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>'
          b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>&lol3;</text></svg>')
EXTERNAL_DTD = (b'<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" '
                b'"https://boese.example/svg11.dtd">' + svg(RECT))


def test_doctype_entities_and_external_dtds_are_refused():
    for data in (XXE, LAUGHS, EXTERNAL_DTD):
        assert "DTD" in rejected(data)


def test_too_big_too_many_elements_too_deep_or_not_svg_is_refused():
    huge = svg("<!--" + "x" * svg_logo.MAX_SVG_BYTES + "-->" + RECT)
    assert "1 MB" in rejected(huge)
    many = svg(RECT * (svg_logo.MAX_ELEMENTS + 1))
    assert "Elemente" in rejected(many)
    deep = svg("<g>" * (svg_logo.MAX_DEPTH + 2) + RECT + "</g>" * (svg_logo.MAX_DEPTH + 2))
    assert "verschachtelt" in rejected(deep)
    assert "kein SVG" in rejected(b"<html><body>hallo</body></html>")
    assert "kein SVG" in rejected(b"<svg")
    assert "kein SVG" in rejected("<svg>ä</svg>".encode("latin-1"))


def test_use_amplification_counts_against_the_element_limit():
    shapes = RECT * 50
    uses = "".join(f'<use href="#gruppe" x="{i}"/>' for i in range(svg_logo.MAX_ELEMENTS // 50 + 5))
    assert "Elemente" in rejected(svg(f'<defs><g id="gruppe">{shapes}</g></defs>{uses}'))


def test_viewbox_comes_from_width_and_height_or_the_file_is_refused():
    text = clean_text(svg(RECT, attrs='width="200" height="120"'))
    assert 'viewBox="0 0 200 120"' in text
    text = clean_text(svg(RECT, attrs='width="20mm" height="10mm"'))
    assert 'viewBox="0 0 75.5906 37.7953"' in text
    assert "viewBox" in rejected(svg(RECT, attrs=""))
    assert "viewBox" in rejected(svg(RECT, attrs='width="100%" height="100%"'))
    assert "viewBox" in rejected(svg(RECT, attrs='viewBox="0 0 0 10"'))


def test_nothing_visible_after_cleaning_is_refused():
    assert "nichts Sichtbares" in rejected_drawing(svg("<script>alert(1)</script>"))
    image_only = svg('<image href="https://boese.example/logo.png" width="100" height="60"/>')
    assert "nichts Sichtbares" in rejected_drawing(image_only)


# ---------------------------------------------------------------- Harmloses Logo bleibt gleich

HARMLESS = svg(
    '<title>Löwe</title><desc>Test-Logo</desc>'
    '<style>.cls-1{fill:url(#verlauf);}.cls-2{fill:none;stroke:#0a0a0a;stroke-width:4px}</style>'
    '<defs><linearGradient id="verlauf" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#29B6E8"/><stop offset="1" stop-color="#FFD700" stop-opacity="0.8"/></linearGradient>'
    '<clipPath id="kreis"><circle cx="100" cy="60" r="55"/></clipPath></defs>'
    '<g transform="translate(4 2) rotate(3 100 60)">'
    '<path class="cls-1" d="M20 100 L100 10 L180 100 Z" clip-path="url(#kreis)"/>'
    '<ellipse class="cls-2" cx="100" cy="70" rx="40" ry="20"/>'
    '<polygon points="90,40 110,40 100,25" style="fill:#FF3B30;fill-opacity:.9"/>'
    '<polyline points="30,110 60,90 90,110" fill="none" stroke="#29B6E8" stroke-width="3" stroke-linecap="round"/>'
    '<line x1="10" y1="5" x2="190" y2="5" stroke="#fff" stroke-width="2"/>'
    '</g><use href="#zacke" x="0" y="0"/><defs><rect id="zacke" x="150" y="10" width="30" height="10" rx="3"/></defs>',
    attrs='width="200" height="120" viewBox="0 0 200 120"',
)


def test_harmless_logo_looks_the_same_after_cleaning():
    cleaned = svg_logo.sanitize(HARMLESS)
    before, after = raster(HARMLESS), raster(cleaned.data)
    assert before.size == after.size
    diff = ImageStat.Stat(ImageChops.difference(before, after)).mean
    assert max(diff) < 0.5, diff
    text = cleaned.data.decode("utf-8")
    assert "<title>Löwe</title>" in text
    # Gezeigt wird das Logo in jeder Größe scharf; die Eigengröße ist groß wie ein Raster-Logo.
    assert (cleaned.width, cleaned.height) == (svg_logo.INTRINSIC_PX, round(svg_logo.INTRINSIC_PX * 120 / 200))


def test_trim_moves_the_viewbox_to_the_drawing():
    data = svg('<rect x="400" y="300" width="200" height="100" fill="#29B6E8"/>', attrs='viewBox="0 0 1000 1000"')
    trimmed, png = svg_logo.prepare(data, trim=True)
    x, y, w, h = trimmed.view_box
    assert 370 < x < 400 and 270 < y < 300
    assert 200 < w < 260 and 100 < h < 160
    # Die PNG ist derselbe Ausschnitt aus dem einen gezeichneten Bild.
    with Image.open(io.BytesIO(png)) as image:
        assert abs(image.width / image.height - w / h) < 0.02
    # Ohne Rand (füllt das Bild) bleibt die viewBox stehen.
    full, _png = svg_logo.prepare(svg('<rect width="100" height="60"/>'), trim=True)
    assert full.view_box == (0.0, 0.0, 100.0, 60.0)


def test_png_has_the_raster_size_and_transparency():
    _clean, png = svg_logo.prepare(svg(RECT), trim=False)
    with Image.open(io.BytesIO(png)) as image:
        assert image.format == "PNG" and image.mode == "RGBA"
        assert image.size == (svg_logo.RASTER_PX, round(svg_logo.RASTER_PX * 60 / 100))
        assert image.getpixel((0, 0))[3] == 0


# ---------------------------------------------------------------- PNG-Fassung für Stellen ohne SVG

def test_raster_url_points_to_the_png_next_to_an_svg(tmp_path, monkeypatch):
    monkeypatch.setattr(svg_logo, "PUBLIC_UPLOAD_DIR", tmp_path)
    (tmp_path / "abc123.svg").write_bytes(b"<svg/>")
    (tmp_path / "abc123.png").write_bytes(b"png")
    (tmp_path / "ohnepng.svg").write_bytes(b"<svg/>")
    assert svg_logo.raster_url("/api/static/uploads/abc123.svg") == "/api/static/uploads/abc123.png"
    assert svg_logo.raster_url("https://lionsquad.example/api/static/uploads/abc123.svg?v=2") == \
        "https://lionsquad.example/api/static/uploads/abc123.png?v=2"
    assert svg_logo.raster_url("/api/static/uploads/ohnepng.svg") == "/api/static/uploads/ohnepng.svg"
    assert svg_logo.raster_url("/api/static/uploads/foto.webp") == "/api/static/uploads/foto.webp"
    assert svg_logo.raster_url("https://fremd.example/logo.svg") == "https://fremd.example/logo.svg"
    assert svg_logo.raster_url(None) is None
    text = '<img src="https://x.example/api/static/uploads/abc123.svg"> /api/static/uploads/ohnepng.svg'
    assert svg_logo.raster_urls_in_text(text) == \
        '<img src="https://x.example/api/static/uploads/abc123.png"> /api/static/uploads/ohnepng.svg'
    body = b'{"logo_url":"/api/static/uploads/abc123.svg","name":"svg"}'
    assert svg_logo.raster_urls_in_bytes(body) == b'{"logo_url":"/api/static/uploads/abc123.png","name":"svg"}'
    assert svg_logo.raster_path(tmp_path / "abc123.svg") == tmp_path / "abc123.png"
    assert svg_logo.raster_path(tmp_path / "ohnepng.svg") is None
    assert svg_logo.raster_path(tmp_path / "foto.webp") == tmp_path / "foto.webp"


def test_only_the_app_gets_png_answers():
    # Nur ein ausdrückliches Merkmal der App zählt - kein Raten aus fehlenden Browser-Kopfzeilen.
    assert svg_logo.client_is_app({"user-agent": "okhttp/4.12.0"}) is True
    assert svg_logo.client_is_app({"X-LionsApp": "1.8.0"}) is True
    assert svg_logo.client_is_app({}) is False
    assert svg_logo.client_is_app({"user-agent": "curl/8.0"}) is False
    assert svg_logo.client_is_app({"User-Agent": "Mozilla/5.0", "Sec-Fetch-Mode": "cors"}) is False


def test_a_saved_png_of_an_svg_logo_stays_the_svg(tmp_path, monkeypatch):
    monkeypatch.setattr(svg_logo, "PUBLIC_UPLOAD_DIR", tmp_path)
    (tmp_path / "abc123.svg").write_bytes(b"<svg/>")
    (tmp_path / "abc123.png").write_bytes(b"png")
    assert svg_logo.vector_url("/api/static/uploads/abc123.png") == "/api/static/uploads/abc123.svg"
    assert svg_logo.vector_url("https://x.example/api/static/uploads/abc123.png?v=1") == \
        "https://x.example/api/static/uploads/abc123.svg?v=1"
    assert svg_logo.vector_url("/api/static/uploads/neu.png") == "/api/static/uploads/neu.png"
    body = b'{"logo_url": "/api/static/uploads/abc123.png", "banner_url": "/api/static/uploads/abc123.png"}'
    changed = json.loads(svg_logo.gate_json_body(body))
    assert changed == {"logo_url": "/api/static/uploads/abc123.svg", "banner_url": "/api/static/uploads/abc123.png"}
    assert svg_logo.gate_json_body(b'{"logo_url": "/api/static/uploads/neu.png"}') is None


def test_svg_only_in_logo_fields():
    allowed = b'{"logo_url": "/api/static/uploads/a.svg", "brand": {"favicon_dark_url": "/api/static/uploads/b.svg"}}'
    assert svg_logo.gate_json_body(allowed) is None
    for refused in (
        b'{"avatar_url": "/api/static/uploads/a.svg"}',
        b'{"banner_url": "https://lionsquad.example/api/static/uploads/a.SVG?x=1"}',
        b'{"tools": [{"image_url": "/uploads/a.svg"}]}',
        b'{"award_images": {"1": "/api/static/uploads/a.svg"}}',
        b'{"content": "Text ![x](/api/static/uploads/a.svg) mehr"}',
        b'{"cover_url": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="}',
        b'[{"photo_url": "/api/static/uploads/a.svg"}]',
    ):
        with pytest.raises(svg_logo.FieldRefused):
            svg_logo.gate_json_body(refused)
    assert svg_logo.gate_json_body(b'{"avatar_url": "/api/static/uploads/a.png"}') is None
    assert svg_logo.gate_json_body(b"kein json mit svg") is None


def test_nginx_serves_uploaded_svg_with_the_strict_policy():
    nginx = (pathlib.Path(__file__).resolve().parents[2] / "frontend" / "nginx.conf").read_text(encoding="utf-8")
    block = nginx.split("location ^~ /api/static/uploads/ {", 1)[1].split("location @tls_upload_backend", 1)[0]
    svg_block = block.split("location ~* \\.svg$ {", 1)[1]
    assert f'add_header Content-Security-Policy "{svg_logo.SERVE_CSP}" always;' in svg_block
    assert 'add_header X-Content-Type-Options "nosniff" always;' in svg_block
    assert "types { image/svg+xml svg; }" in svg_block and "$tls_content_security_policy" not in svg_block


def test_render_heavy_features_are_limited():
    # Strichelung fällt weg; viele Masken bzw. Beschneidungen lehnt die Prüfung ab - beides ließe das Zeichnen ausufern.
    dashed = clean_text(svg('<circle cx="50" cy="30" r="20" stroke="#29B6E8" stroke-dasharray="0.001" '
                            'style="stroke-dashoffset:1;stroke-width:2" fill="none"/>' + RECT))
    assert "dash" not in dashed and 'stroke="#29B6E8"' in dashed
    mask = '<mask id="m{}"><rect width="10" height="10" fill="#fff"/></mask>'
    masks = "".join(mask.format(i) for i in range(svg_logo.MAX_LAYERS + 1))
    assert svg_logo.MAX_LAYERS <= 8
    assert "aufwendig" in rejected(svg(f"<defs>{masks}</defs>{RECT}"))
    # Viele Zahlen in Pfaden - auch erst über use vervielfacht.
    long_path = "M0 0 " + "L1 1 " * (svg_logo.MAX_PATH_NUMBERS // 2 + 1)
    assert "aufwendig" in rejected(svg(f'<path d="{long_path}" stroke="#000"/>'))
    part = "M0 0 " + "L1 1 " * (svg_logo.MAX_PATH_NUMBERS // 6)
    uses = "".join(f'<use href="#teil" x="{i}"/>' for i in range(4))
    assert "aufwendig" in rejected(svg(f'<defs><path id="teil" d="{part}" stroke="#000"/></defs>{uses}'))


# ---------------------------------------------------------------- Zeichnen: eigener Prozess, Grenzen, einmal

EXPENSIVE = svg("".join(f'<rect width="1000" height="1000" fill="#{i % 9}{i % 7}{i % 5}" opacity="0.5"/>'
                        for i in range(3900)), attrs='viewBox="0 0 1000 1000"')


def test_an_expensive_drawing_is_stopped_by_the_time_limit(monkeypatch):
    monkeypatch.setattr(svg_logo, "RASTER_TIMEOUT_SECONDS", 1.5)
    started = time.perf_counter()
    assert "aufwendig" in rejected_drawing(EXPENSIVE)
    assert time.perf_counter() - started < 5
    # Ein gewöhnliches Logo bleibt in der Zeit.
    clean, png = svg_logo.prepare(HARMLESS, trim=False)
    assert png.startswith(b"\x89PNG")


def test_one_drawing_per_upload(monkeypatch):
    calls = []
    original = svg_logo._render

    def counting(data, width):
        calls.append(width)
        return original(data, width)

    monkeypatch.setattr(svg_logo, "_render", counting)
    padded = svg('<rect x="400" y="300" width="200" height="100"/>', attrs='viewBox="0 0 1000 1000"')
    svg_logo.prepare(padded, trim=True)
    assert calls == [svg_logo.RASTER_PX]


def test_busy_when_every_drawing_slot_is_taken(monkeypatch):
    slots = threading.BoundedSemaphore(1)
    slots.acquire()
    monkeypatch.setattr(svg_logo, "_RASTER_SLOTS", slots)
    monkeypatch.setattr(svg_logo, "RASTER_WAIT_SECONDS", 0.05)
    assert "gleich noch einmal" in rejected_drawing(svg(RECT))
