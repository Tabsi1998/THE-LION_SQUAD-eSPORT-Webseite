"""Logos als SVG (#1952): sicher bereinigt, scharf im Web, als PNG für alles, was kein SVG kann.

Ein SVG ist ein Dokument, kein Bild: es kann Skripte, Ereignisse, Verweise auf fremde Adressen und eingebettetes HTML
tragen. Darum gilt hier eine **Positivliste**:

- Gelesen wird mit ``defusedxml`` - eine DTD, Entities und externe Verweise lehnt der Leser ab, XInclude gibt es nicht.
- Übernommen werden nur Zeichen-Elemente (``ELEMENTS``) mit den Attributen aus den Listen unten. Jeder Wert wird nach
  seiner Art geprüft (Zahl, Pfad, Transformation, Farbe/Darstellung); ein ``url()`` darf nur auf ``#id`` im selben
  Dokument zeigen, ``href`` nur bei ``use`` und Verläufen und ebenfalls nur auf ``#id``. Alles andere fällt weg, samt
  Inhalt.
- ``<style>`` wird Regel für Regel neu gebaut: einfache Selektoren, nur erlaubte Eigenschaften und Werte;
  ``@``-Regeln (``@import``, ``@font-face`` …) fallen weg.
- Grenzen: Dateigröße, Zahl der Elemente (auch über ``use`` vervielfacht), Tiefe. ``viewBox`` ist Pflicht oder wird aus
  Breite und Höhe gebildet.
- Gespeichert wird nur die neu geschriebene Fassung, nie die hochgeladene Datei.

Die Rasterfassung (PNG neben dem SVG, gleicher Name) zeichnet ``resvg`` - ohne Systembibliothek, und nur aus der
bereinigten Fassung. Mails, PDF, Teilen-Bilder, Discord, Favicons und die App bekommen sie über ``raster_url``.
"""
from __future__ import annotations

import io
import logging
import math
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse
from xml.etree import ElementTree as ET

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import fromstring as parse_xml

from storage import PUBLIC_UPLOAD_DIR, ensure_directory

logger = logging.getLogger("tls-arena.svg_logo")


def _int_env(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if low <= value <= high else default


MAX_SVG_UPLOAD_MB = _int_env("MAX_SVG_UPLOAD_MB", 1, 1, 10)
MAX_SVG_BYTES = MAX_SVG_UPLOAD_MB * 1024 * 1024
MAX_ELEMENTS = _int_env("SVG_MAX_ELEMENTS", 4000, 100, 20000)
MAX_INPUT_ELEMENTS = MAX_ELEMENTS * 10
MAX_DEPTH = 48
RASTER_PX = _int_env("SVG_RASTER_PX", 2000, 256, 4096)
INTRINSIC_PX = 1024
TRIM_PX = 512
MAX_COORD = 1e7

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
XML_NS = "http://www.w3.org/XML/1998/namespace"

# ---------------------------------------------------------------- Meldungen (feste Wörter, nie aus einer Ausnahme)
TOO_BIG = (f"Das SVG ist zu groß (höchstens {MAX_SVG_UPLOAD_MB} MB). Bitte schlanker exportieren oder als PNG "
           "hochladen.")
NO_DTD = "Das SVG enthält eine DTD oder Entities - das geht nicht. Bitte ohne DOCTYPE exportieren."
NOT_SVG = "Die Datei ist kein SVG, das sich lesen lässt. Bitte neu exportieren (UTF-8) oder als PNG hochladen."
TOO_MANY = (f"Das SVG hat zu viele Elemente (höchstens {MAX_ELEMENTS}). Bitte vereinfachen oder als PNG "
            "hochladen.")
TOO_DEEP = "Das SVG ist zu tief verschachtelt. Bitte Gruppen auflösen oder als PNG hochladen."
NO_SIZE = "Dem SVG fehlt die Größe (viewBox oder Breite und Höhe). Bitte mit viewBox exportieren."
NOTHING = ("Nach der Bereinigung bleibt nichts Sichtbares übrig. Bitte als einfaches SVG mit Pfaden und Formen "
           "exportieren oder als PNG hochladen.")
NO_DRAW = "Das SVG lässt sich nicht zeichnen. Bitte neu exportieren oder als PNG hochladen."


MESSAGES = {
    "too_big": TOO_BIG, "dtd": NO_DTD, "not_svg": NOT_SVG, "too_many": TOO_MANY, "too_deep": TOO_DEEP,
    "no_size": NO_SIZE, "nothing": NOTHING, "no_draw": NO_DRAW,
}


class SvgRejected(ValueError):
    """Ein SVG, das nicht sicher bereinigt werden kann. ``code`` sagt warum, ``message`` ist die feste Meldung dazu."""

    def __init__(self, code: str):
        self.code = code if code in MESSAGES else "no_draw"
        super().__init__(self.code)

    @property
    def message(self) -> str:
        return MESSAGES[self.code]

    def __str__(self) -> str:
        return self.message


# ---------------------------------------------------------------- Positivliste

ELEMENTS = frozenset({
    "svg", "g", "defs", "symbol", "title", "desc", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "text", "tspan", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "use", "style",
})
TEXT_ELEMENTS = frozenset({"text", "tspan", "title", "desc"})
MIXED_CONTENT = frozenset({"text", "tspan"})
HREF_ELEMENTS = frozenset({"use", "linearGradient", "radialGradient"})
GRADIENTS = frozenset({"linearGradient", "radialGradient"})

PRESENTATION = frozenset({
    "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
    "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "color", "display",
    "visibility", "overflow", "clip-path", "clip-rule", "mask", "stop-color", "stop-opacity", "font-family",
    "font-size", "font-weight", "font-style", "font-variant", "font-stretch", "text-anchor", "dominant-baseline",
    "alignment-baseline", "baseline-shift", "letter-spacing", "word-spacing", "text-decoration", "writing-mode",
    "direction", "unicode-bidi", "paint-order", "vector-effect", "shape-rendering", "text-rendering",
    "color-interpolation", "isolation", "mix-blend-mode", "white-space", "transform-origin",
})
GEOMETRY = frozenset({
    "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "width", "height", "dx", "dy",
    "rotate", "textLength", "pathLength", "offset", "refX", "refY",
})
ENUMS = frozenset({
    "lengthAdjust", "gradientUnits", "spreadMethod", "clipPathUnits", "maskUnits", "maskContentUnits",
    "preserveAspectRatio",
})
TRANSFORMS = frozenset({"transform", "gradientTransform"})
TRANSFORM_FUNCTIONS = frozenset({"matrix", "translate", "scale", "rotate", "skewx", "skewy"})
VALUE_FUNCTIONS = frozenset({"rgb", "rgba", "hsl", "hsla", "url"})

_LETTERS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
_DIGITS = frozenset("0123456789")
_SPACE = frozenset(" \t\r\n")
TOKEN_CHARS = _LETTERS | _DIGITS | frozenset("_-.:")
GEOMETRY_CHARS = _LETTERS | _DIGITS | _SPACE | frozenset(".,+-%")
ENUM_CHARS = _LETTERS | _DIGITS | _SPACE | frozenset("-")
PATH_CHARS = _DIGITS | _SPACE | frozenset("MmZzLlHhVvCcSsQqTtAaEe.,+-")
POINTS_CHARS = _DIGITS | _SPACE | frozenset("eE.,+-")
TRANSFORM_CHARS = _LETTERS | _DIGITS | _SPACE | frozenset(".,+-()")
VALUE_CHARS = _LETTERS | _DIGITS | _SPACE | frozenset("#%.,+-_()'\"!")
SELECTOR_CHARS = _LETTERS | _DIGITS | _SPACE | frozenset("-_.#*>")

UNITS_PX = {"": 1.0, "px": 1.0, "pt": 96 / 72, "pc": 16.0, "mm": 96 / 25.4, "cm": 96 / 2.54, "in": 96.0}


def _only(value: str, allowed: frozenset, limit: int) -> bool:
    return 0 < len(value) <= limit and all(ch in allowed for ch in value)


def _token(value: str) -> str | None:
    text = value.strip()
    return text if _only(text, TOKEN_CHARS, 120) else None


def _classes(value: str) -> str | None:
    parts = [part for part in value.split() if _only(part, TOKEN_CHARS, 120)]
    return " ".join(parts[:20]) or None


def _functions_ok(value: str, allowed: frozenset) -> bool:
    """Jede Klammer gehört zu einer erlaubten Funktion; ``url()`` nur mit ``#id``."""
    lowered = value.lower()
    start = 0
    while True:
        bracket = lowered.find("(", start)
        if bracket < 0:
            return True
        begin = bracket
        while begin > 0 and (lowered[begin - 1] in _LETTERS or lowered[begin - 1] == "-"):
            begin -= 1
        name = lowered[begin:bracket]
        if name not in allowed:
            return False
        if name == "url":
            end = value.find(")", bracket)
            if end < 0:
                return False
            inner = value[bracket + 1:end].strip().strip("'\"")
            if not inner.startswith("#") or _token(inner[1:]) is None:
                return False
        start = bracket + 1


def _css_value(value: str) -> str | None:
    text = " ".join(str(value).split())
    if not _only(text, VALUE_CHARS, 1000) or not _functions_ok(text, VALUE_FUNCTIONS):
        return None
    return text


def _transform(value: str) -> str | None:
    text = " ".join(str(value).split())
    if not _only(text, TRANSFORM_CHARS, 2000) or not _functions_ok(text, TRANSFORM_FUNCTIONS):
        return None
    return text


def _declarations(text: str) -> str | None:
    """``prop:wert;…`` - nur erlaubte Eigenschaften mit geprüften Werten."""
    kept = []
    for part in str(text).split(";"):
        prop, colon, value = part.partition(":")
        prop = prop.strip().lower()
        if not colon or prop not in PRESENTATION:
            continue
        clean = _css_value(value)
        if clean is not None:
            kept.append(f"{prop}:{clean}")
    return ";".join(kept) or None


def _without_comments(css: str) -> str:
    out = []
    pos = 0
    while True:
        start = css.find("/*", pos)
        if start < 0:
            out.append(css[pos:])
            return "".join(out)
        out.append(css[pos:start])
        end = css.find("*/", start + 2)
        if end < 0:
            return "".join(out)
        pos = end + 2


def _selector(text: str) -> str | None:
    parts = [" ".join(part.split()) for part in text.split(",")]
    kept = [part for part in parts if _only(part, SELECTOR_CHARS, 200)]
    return ",".join(kept) or None


def _stylesheet(css: str) -> str | None:
    """Ein Stylesheet Regel für Regel neu gebaut. Was nicht eindeutig ist (Escapes, ``<``), fällt ganz weg."""
    css = _without_comments(str(css or ""))
    if "\\" in css or "<" in css:
        return None
    rules = []
    pos = 0
    size = len(css)
    while pos < size:
        opening = css.find("{", pos)
        if opening < 0:
            break
        depth, end = 0, opening
        while end < size:
            if css[end] == "{":
                depth += 1
            elif css[end] == "}":
                depth -= 1
                if depth == 0:
                    break
            end += 1
        if end >= size:
            break
        # Anweisungen davor (``@import …;``) gehören nicht zum Selektor.
        head = css[pos:opening].rsplit(";", 1)[-1]
        body = css[opening + 1:end]
        pos = end + 1
        if "@" in head or "{" in body:
            continue
        selector, declarations = _selector(head), _declarations(body)
        if selector and declarations:
            rules.append(f"{selector}{{{declarations}}}")
    return "".join(rules) or None


def _clean_attribute(local: str, name: str, value: str) -> str | None:
    """Der bereinigte Wert eines Attributs - ``None`` heißt: fällt weg."""
    if name in ("id",):
        return _token(value)
    if name == "class":
        return _classes(value)
    if name == "style":
        return _declarations(value)
    if name in PRESENTATION:
        return _css_value(value)
    if name in TRANSFORMS:
        return _transform(value)
    if name == "d":
        text = " ".join(value.split())
        return text if _only(text, PATH_CHARS, MAX_SVG_BYTES) else None
    if name == "points":
        text = " ".join(value.split())
        return text if _only(text, POINTS_CHARS, MAX_SVG_BYTES) else None
    if name in GEOMETRY:
        text = " ".join(value.split())
        return text if _only(text, GEOMETRY_CHARS, 2000) else None
    if name in ENUMS:
        text = " ".join(value.split())
        return text if _only(text, ENUM_CHARS, 100) else None
    return None


# ---------------------------------------------------------------- Lesen und neu schreiben

def _local_name(tag, svg_default: bool) -> str | None:
    if not isinstance(tag, str):
        return None  # Kommentar oder Anweisung
    if tag.startswith("{"):
        namespace, _, local = tag[1:].partition("}")
        return local if namespace == SVG_NS else None
    return tag if svg_default else None


def _number(value) -> float | None:
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and abs(number) <= MAX_COORD else None


def _length_px(value) -> float | None:
    text = str(value or "").strip().lower()
    unit = text[-2:] if text[-2:] in UNITS_PX else ""
    number = _number(text[:-2] if unit else text)
    return number * UNITS_PX[unit] if number is not None and number > 0 else None


def _view_box(source: ET.Element) -> tuple[float, float, float, float]:
    raw = str(source.get("viewBox") or "").replace(",", " ").split()
    if raw:
        numbers = [_number(item) for item in raw]
        if len(numbers) == 4 and None not in numbers and numbers[2] > 0 and numbers[3] > 0:
            return tuple(numbers)  # type: ignore[return-value]
        raise SvgRejected("no_size")
    width, height = _length_px(source.get("width")), _length_px(source.get("height"))
    if not width or not height:
        raise SvgRejected("no_size")
    return (0.0, 0.0, width, height)


def _fmt(number: float) -> str:
    text = f"{number:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


class _Copier:
    def __init__(self, svg_default: bool):
        self.svg_default = svg_default
        self.count = 0

    def copy(self, source: ET.Element, local: str, depth: int) -> ET.Element:
        if depth > MAX_DEPTH:
            raise SvgRejected("too_deep")
        self.count += 1
        if self.count > MAX_ELEMENTS:
            raise SvgRejected("too_many")
        target = ET.Element(local)
        for key, value in source.attrib.items():
            if key.startswith("{"):
                namespace, _, name = key[1:].partition("}")
                if namespace == XLINK_NS and name == "href":
                    name = "href"
                elif namespace == XML_NS and name == "space":
                    if value in ("default", "preserve"):
                        target.set(f"{{{XML_NS}}}space", value)
                    continue
                else:
                    continue
            else:
                name = key
            if name == "href":
                text = str(value).strip()
                if local in HREF_ELEMENTS and text.startswith("#") and _token(text[1:]):
                    target.set("href", text)
                continue
            clean = _clean_attribute(local, name, str(value))
            if clean is not None:
                target.set(name, clean)
        if local == "style":
            target.text = _stylesheet("".join(source.itertext()))
            return target
        if local in TEXT_ELEMENTS and source.text:
            target.text = source.text
        for child in source:
            child_local = _local_name(child.tag, self.svg_default)
            if child_local in ELEMENTS:
                copied = self.copy(child, child_local, depth + 1)
                if local in MIXED_CONTENT and child.tail:
                    copied.tail = child.tail
                target.append(copied)
            elif local in MIXED_CONTENT and child.tail:
                # Was wegfällt, nimmt seinen Text nicht mit - der Text danach bleibt.
                if len(target):
                    target[-1].tail = (target[-1].tail or "") + child.tail
                else:
                    target.text = (target.text or "") + child.tail
        return target


def _subtree_size(element: ET.Element) -> int:
    return sum(1 for _ in element.iter())


def _resolve_references(root: ET.Element) -> None:
    """``use`` nur auf vorhandene Ziele ohne eigenes ``use`` und nie auf sich selbst; Verläufe nur auf Verläufe ohne
    Kreis. Vervielfachte Elemente zählen gegen die Grenze."""
    ids: dict[str, ET.Element] = {}
    parents: dict[ET.Element, ET.Element] = {}
    for parent in root.iter():
        for child in parent:
            parents[child] = parent
        element_id = parent.get("id")
        if element_id and element_id not in ids:
            ids[element_id] = parent
    use_tag = "use"
    expanded = _subtree_size(root)
    for element in list(root.iter()):
        local = element.tag.split("}", 1)[-1]
        ref = element.get("href")
        if not ref:
            continue
        target = ids.get(ref[1:])
        if local == "use":
            ancestors, node = set(), element
            while node in parents:
                node = parents[node]
                ancestors.add(node)
            if target is None or target is element or target in ancestors or any(
                    node.tag == use_tag for node in target.iter()):
                parents[element].remove(element)
                continue
            expanded += _subtree_size(target)
            if expanded > MAX_ELEMENTS:
                raise SvgRejected("too_many")
        elif local in GRADIENTS:
            seen, node = {element}, target
            while node is not None and node.tag.split("}", 1)[-1] in GRADIENTS and node not in seen:
                seen.add(node)
                nxt = node.get("href")
                node = ids.get(nxt[1:]) if nxt else None
            if target is None or target.tag.split("}", 1)[-1] not in GRADIENTS or node is not None and node in seen:
                del element.attrib["href"]
    if expanded > MAX_ELEMENTS:
        raise SvgRejected("too_many")


@dataclass
class CleanSvg:
    data: bytes
    width: int
    height: int
    view_box: tuple[float, float, float, float]


def _serialize(root: ET.Element, view_box: tuple[float, float, float, float]) -> CleanSvg:
    x, y, w, h = view_box
    scale = INTRINSIC_PX / max(w, h)
    width, height = max(1, round(w * scale)), max(1, round(h * scale))
    for key in ("x", "y", "width", "height", "viewBox"):
        root.attrib.pop(key, None)
    root.set("viewBox", " ".join(_fmt(value) for value in view_box))
    root.set("width", str(width))
    root.set("height", str(height))
    # Die Elemente tragen ihren Namen ohne Namensraum; die Datei sagt ihn einmal am Anfang.
    root.set("xmlns", SVG_NS)
    body = ET.tostring(root, encoding="unicode")
    data = ('<?xml version="1.0" encoding="UTF-8"?>\n' + body).encode("utf-8")
    return CleanSvg(data=data, width=width, height=height, view_box=view_box)


def _render(data: bytes, long_side: int) -> bytes:
    import resvg_py

    try:
        return bytes(resvg_py.svg_to_bytes(svg_string=data.decode("utf-8"), width=long_side))
    except Exception as exc:  # noqa: BLE001 - resvg meldet Fehler als ValueError/RuntimeError
        logger.info("[svg] zeichnen gescheitert: %s", type(exc).__name__)
        raise SvgRejected("no_draw") from None


def _render_rgba(data: bytes, view_box, long_side: int):
    from PIL import Image

    _x, _y, w, h = view_box
    # resvg skaliert nach der Breite; für ein hohes Bild wird die Breite so gewählt, dass die Höhe passt.
    width = long_side if w >= h else max(1, round(long_side * w / h))
    with Image.open(io.BytesIO(_render(data, width))) as image:
        return image.convert("RGBA")


def _trimmed(view_box, image) -> tuple[float, float, float, float] | None:
    """Die viewBox nur um den sichtbaren Teil (wie das Zuschneiden der Raster-Logos: deutlich kleiner als das Bild,
    mit etwas Rand) - sonst ``None``."""
    bbox = image.getchannel("A").point(lambda p: 255 if p > 8 else 0).getbbox()
    if not bbox:
        return None
    left, top, right, bottom = bbox
    width, height = right - left, bottom - top
    if width * height >= image.width * image.height * 0.92:
        return None
    pad = max(4, int(max(width, height) * 0.06))
    left, top = max(0, left - pad), max(0, top - pad)
    right, bottom = min(image.width, right + pad), min(image.height, bottom + pad)
    x, y, w, h = view_box
    sx, sy = w / image.width, h / image.height
    return (x + left * sx, y + top * sy, (right - left) * sx, (bottom - top) * sy)


def sanitize(data: bytes, *, trim: bool = False) -> CleanSvg:
    """Das hochgeladene SVG, neu geschrieben aus der Positivliste - oder ``SvgRejected`` mit einer Meldung."""
    if len(data) > MAX_SVG_BYTES:
        raise SvgRejected("too_big")
    try:
        source = parse_xml(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except DefusedXmlException:
        raise SvgRejected("dtd") from None
    except (ET.ParseError, ValueError, UnicodeError):
        raise SvgRejected("not_svg") from None
    svg_default = not str(source.tag).startswith("{")
    if _local_name(source.tag, svg_default) != "svg":
        raise SvgRejected("not_svg")
    if sum(1 for _ in source.iter()) > MAX_INPUT_ELEMENTS:
        raise SvgRejected("too_many")
    view_box = _view_box(source)
    root = _Copier(svg_default).copy(source, "svg", 0)
    _resolve_references(root)
    clean = _serialize(root, view_box)
    preview = _render_rgba(clean.data, view_box, TRIM_PX)
    if preview.getchannel("A").getbbox() is None:
        raise SvgRejected("nothing")
    if trim:
        smaller = _trimmed(view_box, preview)
        if smaller:
            clean = _serialize(root, smaller)
    return clean


def raster_png(data: bytes, long_side: int | None = None) -> bytes:
    """Die PNG-Fassung eines bereinigten SVG, die längere Seite ``long_side`` (Vorgabe ``RASTER_PX``) Pixel."""
    from PIL import Image

    side = long_side or RASTER_PX
    root = parse_xml(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    view_box = tuple(float(value) for value in root.get("viewBox").split())
    image = _render_rgba(data, view_box, side)
    _x, _y, w, h = view_box
    wanted = (side, max(1, round(side * h / w))) if w >= h else (max(1, round(side * w / h)), side)
    if image.size != wanted:
        image = image.resize(wanted, Image.Resampling.LANCZOS)
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def store(data: bytes, *, trim: bool, directory: Path | None = None) -> dict:
    """Bereinigen, rastern und beides ablegen: ``<zufall>.svg`` und daneben ``<zufall>.png``."""
    clean = sanitize(data, trim=trim)
    png = raster_png(clean.data)
    folder = directory or PUBLIC_UPLOAD_DIR
    ensure_directory(folder)
    stem = uuid.uuid4().hex
    svg_path, png_path = folder / f"{stem}.svg", folder / f"{stem}.png"
    svg_path.write_bytes(clean.data)
    png_path.write_bytes(png)
    return {
        "filename": svg_path.name, "path": svg_path, "size": len(clean.data), "width": clean.width,
        "height": clean.height, "raster_filename": png_path.name, "raster_path": png_path, "raster_size": len(png),
    }


# ---------------------------------------------------------------- PNG-Fassung für Stellen ohne SVG

_UPLOAD_SVG = re.compile(r"/api/static/uploads/([A-Za-z0-9][A-Za-z0-9_-]{0,150})\.svg(?![A-Za-z0-9_])")
_UPLOAD_SVG_BYTES = re.compile(rb"/api/static/uploads/([A-Za-z0-9][A-Za-z0-9_-]{0,150})\.svg(?![A-Za-z0-9_])")


def _has_raster(stem: str) -> bool:
    return (PUBLIC_UPLOAD_DIR / f"{stem}.png").is_file()


def raster_url(value):
    """Die Adresse der PNG-Fassung, wenn ``value`` ein hochgeladenes SVG mit Rasterfassung ist - sonst ``value``."""
    if not isinstance(value, str) or ".svg" not in value:
        return value
    path = urlparse(value).path
    match = _UPLOAD_SVG.fullmatch(path)
    if not match or not _has_raster(match.group(1)):
        return value
    return value.replace(path, f"{path[:-4]}.png", 1)


def raster_urls_in_text(text):
    """Jede SVG-Adresse eines Uploads in einem Text (Mail, Seite) durch ihre PNG-Fassung ersetzt."""
    if not isinstance(text, str) or ".svg" not in text:
        return text
    return _UPLOAD_SVG.sub(lambda m: f"{m.group(0)[:-4]}.png" if _has_raster(m.group(1)) else m.group(0), text)


def raster_urls_in_bytes(body: bytes) -> bytes:
    if b".svg" not in body:
        return body
    return _UPLOAD_SVG_BYTES.sub(
        lambda m: m.group(0)[:-4] + b".png" if _has_raster(m.group(1).decode("ascii")) else m.group(0), body)


def raster_path(path: Path | None) -> Path | None:
    """Für eine SVG-Datei die PNG daneben (``None``, wenn es keine gibt); jede andere Datei bleibt."""
    if path is None or path.suffix.lower() != ".svg":
        return path
    sibling = path.with_suffix(".png")
    return sibling if sibling.is_file() else None


def client_needs_raster(headers) -> bool:
    """Browser schicken bei jedem Abruf ``Sec-Fetch-Mode`` und zeigen SVG im ``<img>``. Wer es nicht schickt (die App,
    Programme), bekommt in Antworten der API die PNG-Fassung - die App kann noch kein SVG."""
    return not any(str(key).lower() == "sec-fetch-mode" for key in headers.keys())


def keep_vector(new, old):
    """Speichert die App die PNG-Fassung zurück, die sie bekommen hat, bleibt das SVG."""
    if not isinstance(new, str) or not isinstance(old, str):
        return new
    old_match = _UPLOAD_SVG.fullmatch(urlparse(old).path)
    if old_match and urlparse(new).path == f"/api/static/uploads/{old_match.group(1)}.png":
        return old
    return new
