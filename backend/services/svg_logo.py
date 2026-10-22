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
import json
import logging
import math
import os
import re
import subprocess
import sys
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse
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
# Jede Ebene (Gruppe mit Deckkraft, Maske, Beschneidung) kann beim Zeichnen eine eigene Bildfläche brauchen - darum
# begrenzt: Tiefe und Zahl der Masken und Beschneidungspfade. Logos kommen mit wenigen aus. Dazu die Menge an Zahlen in
# Pfaden und Polygonen (auch über ``use`` vervielfacht) - sie bestimmt, wie lange das Zeichnen dauert.
MAX_DEPTH = 24
MAX_LAYERS = 8
MAX_PATH_NUMBERS = _int_env("SVG_MAX_PATH_NUMBERS", 100_000, 1_000, 1_000_000)
RASTER_PX = _int_env("SVG_RASTER_PX", 2000, 256, 4096)
INTRINSIC_PX = 1024
MAX_COORD = 1e7
# Gezeichnet wird in einem eigenen Prozess mit Zeit- und Speichergrenze, höchstens ``RASTER_CONCURRENCY`` zugleich;
# wer länger als ``RASTER_WAIT_SECONDS`` auf einen Platz wartet, bekommt „bitte gleich noch einmal“.
RASTER_TIMEOUT_SECONDS = float(_int_env("SVG_RASTER_TIMEOUT_SECONDS", 5, 1, 60))
RASTER_MEMORY_MB = _int_env("SVG_RASTER_MEMORY_MB", 512, 128, 4096)
RASTER_CONCURRENCY = _int_env("SVG_RASTER_CONCURRENCY", 1, 1, 8)
RASTER_WAIT_SECONDS = 20.0
WORKER = Path(__file__).with_name("svg_raster_worker.py")
_RASTER_SLOTS = threading.BoundedSemaphore(RASTER_CONCURRENCY)
# SVG-Uploads je Konto und Zeitfenster (zusätzlich zur Grenze für Bilder).
SVG_UPLOAD_RATE_LIMIT = _int_env("SVG_UPLOAD_RATE_LIMIT", 20, 1, 1000)
SVG_UPLOAD_RATE_WINDOW_SECONDS = _int_env("SVG_UPLOAD_RATE_WINDOW_SECONDS", 3600, 60, 86400)

# Kopfzeilen beim Ausliefern (Backend und nginx): kein Raten des Typs, und wird die Datei direkt geöffnet, darf darin
# nichts laden oder laufen - nur Zeichnen und Stil.
SERVE_CSP = "default-src 'none'; style-src 'unsafe-inline'"
SERVE_HEADERS = {"Content-Security-Policy": SERVE_CSP, "X-Content-Type-Options": "nosniff"}

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
TOO_COMPLEX = "Das SVG ist zu aufwendig zum Zeichnen. Bitte vereinfachen oder als PNG hochladen."
BUSY = "Gerade werden andere Logos verarbeitet. Bitte gleich noch einmal versuchen."
FIELD_REFUSED = "SVG geht nur in Logo-Feldern. Für Fotos, Banner und Profilbilder bitte PNG, JPG oder WebP."


MESSAGES = {
    "too_big": TOO_BIG, "dtd": NO_DTD, "not_svg": NOT_SVG, "too_many": TOO_MANY, "too_deep": TOO_DEEP,
    "no_size": NO_SIZE, "nothing": NOTHING, "no_draw": NO_DRAW, "too_complex": TOO_COMPLEX, "busy": BUSY,
}
# Antwort-Status je Grund: zu groß 413, zu aufwendig 422, ausgelastet 429, sonst 400.
STATUS = {"too_big": 413, "too_complex": 422, "busy": 429}


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

# Ohne Strichelung (stroke-dasharray): winzige Striche auf einer langen Linie lassen das Zeichnen ausufern.
PRESENTATION = frozenset({
    "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
    "stroke-linejoin", "stroke-miterlimit", "opacity", "color", "display",
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


def _digit_runs(text: str | None) -> int:
    """Wie viele Zahlen in Pfaddaten stehen (grob: zusammenhängende Ziffernfolgen) - ohne Regex."""
    count, inside = 0, False
    for ch in text or "":
        digit = "0" <= ch <= "9"
        if digit and not inside:
            count += 1
        inside = digit
    return count


def _path_numbers(element: ET.Element) -> int:
    return sum(_digit_runs(node.get("d")) + _digit_runs(node.get("points")) for node in element.iter())


def _resolve_references(root: ET.Element) -> None:
    """``use`` nur auf vorhandene Ziele ohne eigenes ``use`` und nie auf sich selbst; Verläufe nur auf Verläufe ohne
    Kreis. Vervielfachte Elemente und Pfadzahlen zählen gegen die Grenzen."""
    ids: dict[str, ET.Element] = {}
    parents: dict[ET.Element, ET.Element] = {}
    for parent in root.iter():
        for child in parent:
            parents[child] = parent
        element_id = parent.get("id")
        if element_id and element_id not in ids:
            ids[element_id] = parent
    use_tag = "use"
    if sum(1 for node in root.iter() if node.tag in ("mask", "clipPath")) > MAX_LAYERS:
        raise SvgRejected("too_complex")
    expanded = _subtree_size(root)
    numbers = _path_numbers(root)
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
            numbers += _path_numbers(target)
            if expanded > MAX_ELEMENTS:
                raise SvgRejected("too_many")
            if numbers > MAX_PATH_NUMBERS:
                raise SvgRejected("too_complex")
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
    if numbers > MAX_PATH_NUMBERS:
        raise SvgRejected("too_complex")


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


def _render(data: bytes, width: int) -> bytes:
    """Ein bereinigtes SVG als PNG - in einem eigenen Prozess (``svg_raster_worker.py``) mit harter Zeitgrenze und
    Speichergrenze, höchstens ``RASTER_CONCURRENCY`` zugleich. Ein zu aufwendiges Bild bricht ab, statt den Server zu
    binden."""
    if not _RASTER_SLOTS.acquire(timeout=RASTER_WAIT_SECONDS):
        raise SvgRejected("busy")
    try:
        result = subprocess.run(
            [sys.executable, "-I", str(WORKER), str(int(width)), str(RASTER_MEMORY_MB),
             str(math.ceil(RASTER_TIMEOUT_SECONDS) + 1)],
            input=data, capture_output=True, timeout=RASTER_TIMEOUT_SECONDS, check=False,
        )
    except subprocess.TimeoutExpired:
        logger.info("[svg] zeichnen dauerte zu lange - abgebrochen")
        raise SvgRejected("too_complex") from None
    finally:
        _RASTER_SLOTS.release()
    if result.returncode == 0 and result.stdout.startswith(b"\x89PNG"):
        return result.stdout
    logger.info("[svg] zeichnen gescheitert (Rückgabe %s)", result.returncode)
    # 3: resvg konnte das Dokument nicht lesen; alles andere (Speicher, Rechenzeit, Abbruch) heißt zu aufwendig.
    raise SvgRejected("no_draw" if result.returncode == 3 else "too_complex")


def _render_rgba(data: bytes, view_box, long_side: int):
    from PIL import Image

    _x, _y, w, h = view_box
    # resvg skaliert nach der Breite; für ein hohes Bild wird die Breite so gewählt, dass die Höhe passt.
    width = long_side if w >= h else max(1, round(long_side * w / h))
    with Image.open(io.BytesIO(_render(data, width))) as image:
        image = image.convert("RGBA")
    wanted = (long_side, max(1, round(long_side * h / w))) if w >= h else (max(1, round(long_side * w / h)), long_side)
    if image.size != wanted:
        image = image.resize(wanted, Image.Resampling.LANCZOS)
    return image


def _trim_box(image) -> tuple[int, int, int, int] | None:
    """Der sichtbare Teil mit etwas Rand, wenn er deutlich kleiner ist als das Bild (wie beim Zuschneiden der
    Raster-Logos) - sonst ``None``."""
    bbox = image.getchannel("A").point(lambda p: 255 if p > 8 else 0).getbbox()
    if not bbox:
        return None
    left, top, right, bottom = bbox
    width, height = right - left, bottom - top
    if width * height >= image.width * image.height * 0.92:
        return None
    pad = max(4, int(max(width, height) * 0.06))
    return max(0, left - pad), max(0, top - pad), min(image.width, right + pad), min(image.height, bottom + pad)


def _png_bytes(image) -> bytes:
    out = io.BytesIO()
    image.save(out, format="PNG", compress_level=6)
    return out.getvalue()


def _clean_tree(data: bytes) -> tuple[ET.Element, tuple[float, float, float, float]]:
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
    return root, view_box


def sanitize(data: bytes) -> CleanSvg:
    """Das hochgeladene SVG, neu geschrieben aus der Positivliste - oder ``SvgRejected`` mit einer Meldung. Zeichnet
    nichts; das macht ``prepare``."""
    root, view_box = _clean_tree(data)
    return _serialize(root, view_box)


def prepare(data: bytes, *, trim: bool) -> tuple[CleanSvg, bytes]:
    """Bereinigen und **einmal** zeichnen: Aus dem einen Bild mit ``RASTER_PX`` an der längeren Seite kommen die Prüfung
    auf Sichtbares, der Zuschnitt (neue viewBox) und die PNG-Fassung."""
    root, view_box = _clean_tree(data)
    clean = _serialize(root, view_box)
    image = _render_rgba(clean.data, view_box, RASTER_PX)
    if image.getchannel("A").getbbox() is None:
        raise SvgRejected("nothing")
    if trim:
        box = _trim_box(image)
        if box:
            left, top, right, bottom = box
            x, y, w, h = view_box
            sx, sy = w / image.width, h / image.height
            clean = _serialize(root, (x + left * sx, y + top * sy, (right - left) * sx, (bottom - top) * sy))
            image = image.crop(box)
    return clean, _png_bytes(image)


def raster_png(data: bytes, long_side: int | None = None) -> bytes:
    """Die PNG-Fassung eines bereinigten SVG, die längere Seite ``long_side`` (Vorgabe ``RASTER_PX``) Pixel."""
    root = parse_xml(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    view_box = tuple(float(value) for value in root.get("viewBox").split())
    return _png_bytes(_render_rgba(data, view_box, long_side or RASTER_PX))


def store(data: bytes, *, trim: bool, directory: Path | None = None) -> dict:
    """Bereinigen, einmal zeichnen und beides ablegen: ``<zufall>.svg`` und daneben ``<zufall>.png``."""
    clean, png = prepare(data, trim=trim)
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
_UPLOAD_PNG = re.compile(r"/api/static/uploads/([A-Za-z0-9][A-Za-z0-9_-]{0,150})\.png")


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


def client_is_app(headers) -> bool:
    """Die LionsAPP (bis sie SVG kann): Kopfzeile ``X-LionsApp`` (künftige Fassungen) oder die Kennung ihres
    Netzwerk-Bausteins (``User-Agent: okhttp/…``, so meldet sich die Android-App heute). Nur sie bekommt in Antworten
    auf GET-Abrufe die PNG-Fassung; Browser und alle anderen bekommen die gespeicherte Adresse."""
    lowered = {str(key).lower(): str(value) for key, value in headers.items()}
    return "x-lionsapp" in lowered or lowered.get("user-agent", "").lower().startswith("okhttp/")


# ---------------------------------------------------------------- SVG nur in Logo-Feldern

# Die Felder, in denen ein SVG-Logo stehen darf - überall gleich benannt: Branding, Sponsoren, Partner, Spiele, Teams,
# Spur und Saison einer Serie.
LOGO_FIELDS = frozenset({
    "logo_url", "logo_dark_url", "logo_light_url", "mascot_url", "qr_logo_url",
    "favicon_url", "favicon_light_url", "favicon_dark_url",
})


def _compact(value: str) -> str:
    """Für den Vergleich: mehrfach URL-dekodiert (höchstens viermal), ohne Leerraum und Steuerzeichen, klein."""
    text = value
    for _ in range(4):
        decoded = unquote(text)
        if decoded == text:
            break
        text = decoded
    return "".join(ch for ch in text if not ch.isspace() and ord(ch) >= 32 and ch != "\x7f").lower()


def _is_logo_svg_upload(path: str) -> bool:
    """Zeigt der (schon dekodierte) Pfad auf ein SVG-Logo aus dem Logo-Upload - die Datei liegt bei den Uploads und
    hat ihre PNG-Fassung daneben? Ältere SVG-Dateien ohne PNG (aus der früheren Bild-Migration) zählen nicht."""
    if "uploads/" not in path:
        return False
    name = path.rsplit("/", 1)[-1]
    if not name.endswith(".svg") or name.startswith("."):
        return False
    return (PUBLIC_UPLOAD_DIR / name).is_file() and (PUBLIC_UPLOAD_DIR / f"{name[:-4]}.png").is_file()


def _refused_outside_logo(value: str) -> bool:
    """Ein Bildfeld außerhalb der Logo-Felder darf kein SVG tragen: weder ein SVG-Logo aus dem Upload (auch kodiert,
    groß geschrieben, mit Zusatz) noch eine data-URI mit SVG. Geprüft werden nur Werte, die ganz aus einer Adresse
    bestehen; ein längerer Text (etwa Markdown mit Bild) bleibt, wie er ist - dort steht ein Bild nur über ``<img>``."""
    stripped = value.strip()
    # Browser lesen „\“ in Adressen wie „/“.
    compact = _compact(stripped).replace("\\", "/")
    if compact.startswith("data:"):
        return compact.startswith("data:image/svg")
    if not stripped or any(ch.isspace() for ch in stripped):
        return False
    target = compact.split("#", 1)[0].split("?", 1)[0]
    if "://" in target:
        target = target.split("://", 1)[1]
        target = target[target.find("/"):] if "/" in target else ""
    return _is_logo_svg_upload(target)


def vector_url(value: str) -> str:
    """Ist ``value`` die PNG-Fassung eines gespeicherten SVG-Logos (gleicher Name daneben), die Adresse des SVG -
    sonst ``value``. So bleibt das SVG, wenn ein Formular (etwa die App) die PNG zurückschickt."""
    path = urlparse(value).path
    match = _UPLOAD_PNG.fullmatch(path)
    if not match or not (PUBLIC_UPLOAD_DIR / f"{match.group(1)}.svg").is_file():
        return value
    return value.replace(path, f"{path[:-4]}.svg", 1)


class FieldRefused(ValueError):
    """Ein SVG in einem Feld, das kein Logo-Feld ist."""


def _gate_value(value, key, state):
    if isinstance(value, dict):
        return {name: _gate_value(inner, name, state) for name, inner in value.items()}
    if isinstance(value, list):
        return [_gate_value(inner, key, state) for inner in value]
    if not isinstance(value, str):
        return value
    if key in LOGO_FIELDS:
        kept = vector_url(value) if ".png" in value else value
        if kept != value:
            state["changed"] = True
        return kept
    if _refused_outside_logo(value):
        raise FieldRefused(key)
    return value


def gate_json_body(body: bytes) -> bytes | None:
    """Prüft einen JSON-Körper vor dem Speichern: ein SVG-Logo bzw. eine SVG-data-URI nur in ``LOGO_FIELDS``, sonst
    ``FieldRefused``; die PNG-Fassung eines SVG-Logos in einem Logo-Feld wird wieder das SVG. Liefert den geänderten
    Körper oder ``None``, wenn nichts zu ändern ist (auch bei ungültigem JSON - das meldet die Route selbst)."""
    try:
        payload = json.loads(body)
    except ValueError:
        return None
    state = {"changed": False}
    result = _gate_value(payload, None, state)
    return json.dumps(result, ensure_ascii=False).encode("utf-8") if state["changed"] else None


# Wie viel JSON der Baustein vor der Route liest - darüber 413. Routen mit eigener Grenze, die den Körper selbst
# streamen (Webhooks der Integrationen, Ergebnis- und Original-Bilder einer Serie), lässt er ganz aus; sie speichern
# keine Bildfelder. Uploads (multipart) liest er nie.
JSON_BODY_MAX_BYTES = _int_env("JSON_BODY_MAX_KB", 4096, 64, 65536) * 1024
GATE_SKIPPED = (
    re.compile(r"/api/integrations/[^?#]*"),
    re.compile(r"/api/reference-series/admin/series/[^/]+/"
               r"(?:rounds/[^/]+/(?:results/image|originals)|season-table/image)"),
)
TOO_LARGE = "Die Anfrage ist zu groß."


class SvgFieldGate:
    """ASGI-Baustein vor allen Routen: jeder JSON-Körper von POST, PUT und PATCH unter ``/api/`` (bis
    ``JSON_BODY_MAX_BYTES``) geht durch ``gate_json_body`` - ein SVG außerhalb eines Logo-Felds bekommt 422, bevor eine
    Route etwas speichert."""

    METHODS = frozenset({"POST", "PUT", "PATCH"})

    def __init__(self, app):
        self.app = app

    @staticmethod
    async def _answer(scope, receive, send, status: int, detail: str):
        from starlette.responses import JSONResponse

        await JSONResponse({"detail": detail}, status_code=status)(scope, receive, send)

    async def __call__(self, scope, receive, send):
        path = str(scope.get("path") or "")
        if (scope.get("type") != "http" or scope.get("method") not in self.METHODS or not path.startswith("/api/")
                or any(pattern.fullmatch(path) for pattern in GATE_SKIPPED)):
            return await self.app(scope, receive, send)
        headers = scope.get("headers") or []
        content_type = next((value for key, value in headers if key.lower() == b"content-type"), b"")
        if b"json" not in content_type.lower():
            return await self.app(scope, receive, send)
        declared = next((value for key, value in headers if key.lower() == b"content-length"), b"")
        if declared.strip().isdigit() and int(declared) > JSON_BODY_MAX_BYTES:
            return await self._answer(scope, receive, send, 413, TOO_LARGE)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message.get("type") != "http.request":
                return None  # Verbindung weg
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > JSON_BODY_MAX_BYTES:
                return await self._answer(scope, receive, send, 413, TOO_LARGE)
            chunks.append(chunk)
            if not message.get("more_body"):
                break
        body = b"".join(chunks)
        try:
            changed = gate_json_body(body)
        except FieldRefused:
            return await self._answer(scope, receive, send, 422, FIELD_REFUSED)
        if changed is not None:
            body = changed
            scope = {**scope, "headers": [(key, value) for key, value in headers if key.lower() != b"content-length"]
                     + [(b"content-length", str(len(body)).encode("ascii"))]}
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        return await self.app(scope, replay, send)
