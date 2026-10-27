"""Sichere SVGs - ein Baustein für Logos im Branding (#1952, #2073) und Motive im Shop (#2069).

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

**Streng (Vorgabe) oder nachsichtig.** ``sanitize(data)`` ist streng: findet die Prüfung Gefährliches (Skript,
Ereignis-Attribute, ``foreignObject``, eingebettetes Pixelbild, Verweise nach außen oder ``data:``, ``@import`` oder
``url()`` nach außen im Stylesheet, ``xml:base``) oder Schrift als Text, wird das SVG **abgelehnt** - mit einer Meldung,
die sagt, was gefunden wurde (feste Wörter, nie Text aus der Datei). Ein Pixelbild heißt „kein echtes Vektor-SVG“.
``strict=False`` (nur das Branding bis #2073) entfernt dieselben Dinge still und behält den Rest.

Dazu: ``recolor`` (Farben ersetzen, etwa Weiß → Dunkel für helle Shirts), ``analyze`` (Farben, viewBox,
Seitenverhältnis, echtes Vektor-SVG ja/nein) und ``rasterize`` (PNG in genau einer Breite oder Höhe, transparent,
deterministisch). Gezeichnet wird mit ``resvg`` in einem eigenen Prozess (``svg_raster_worker.py``) - immer aus der
bereinigten Fassung.
"""
from __future__ import annotations

import io
import logging
import math
import os
import re
import subprocess
import sys
import threading
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import fromstring as parse_xml

logger = logging.getLogger("tls-arena.svg_safe")


def _int_env(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if low <= value <= high else default


MAX_SVG_UPLOAD_MB = _int_env("MAX_SVG_UPLOAD_MB", 2, 1, 10)
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
# Druckgrößen (``rasterize``): größere Flächen, darum mehr Zeit und Speicher - aber feste Obergrenzen.
PRINT_TIMEOUT_SECONDS = float(_int_env("SVG_PRINT_TIMEOUT_SECONDS", 30, 5, 120))
PRINT_MEMORY_MB = _int_env("SVG_PRINT_MEMORY_MB", 1536, 256, 8192)
MAX_RASTER_SIDE = _int_env("SVG_MAX_RASTER_SIDE", 20000, 1000, 40000)
MAX_RASTER_PIXELS = _int_env("SVG_MAX_RASTER_MEGAPIXELS", 60, 1, 400) * 1_000_000
WORKER = Path(__file__).with_name("svg_raster_worker.py")
_RASTER_SLOTS = threading.BoundedSemaphore(RASTER_CONCURRENCY)

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
RASTER_TOO_BIG = (f"Diese Größe ist zu groß zum Zeichnen (höchstens {MAX_RASTER_SIDE} Pixel je Seite und "
                  f"{MAX_RASTER_PIXELS // 1_000_000} Millionen Pixel).")
NOT_VECTOR = "Kein echtes Vektor-SVG – enthält ein Pixelbild."
UNSAFE_HINT = "Bitte als reine Vektorgrafik (nur Pfade und Formen, Schrift in Pfade umgewandelt) neu exportieren."

MESSAGES = {
    "too_big": TOO_BIG, "dtd": NO_DTD, "not_svg": NOT_SVG, "too_many": TOO_MANY, "too_deep": TOO_DEEP,
    "no_size": NO_SIZE, "nothing": NOTHING, "no_draw": NO_DRAW, "too_complex": TOO_COMPLEX, "busy": BUSY,
    "raster_size": RASTER_TOO_BIG, "unsafe": UNSAFE_HINT,
}
# Antwort-Status je Grund: zu groß 413, zu aufwendig 422, ausgelastet 429, sonst 400.
STATUS = {"too_big": 413, "too_complex": 422, "busy": 429}

# Was die strenge Prüfung findet - je Fund ein fester Text. Reihenfolge = Reihenfolge in der Meldung.
FINDINGS: dict[str, str] = {
    "raster": "ein eingebettetes Pixelbild (<image>)",
    "script": "Skript (<script> oder javascript:)",
    "events": "Ereignis-Attribute (onload, onclick …)",
    "foreign": "eingebettetes HTML (<foreignObject>, <iframe> …)",
    "external": "Verweise nach außen (href, xml:base, Stylesheet-Anweisung)",
    "data": "eingebettete Daten (data:)",
    "css": "Stylesheet mit @import, @font-face, url() nach außen oder Ausdrücken",
    "text": "Schrift als Text (bitte in Pfade umwandeln)",
}


class SvgRejected(ValueError):
    """Ein SVG, das nicht sicher bereinigt werden kann. ``code`` sagt warum, ``message`` ist die feste Meldung dazu;
    bei ``code == "unsafe"`` nennt ``findings`` (Schlüssel aus ``FINDINGS``), was gefunden wurde."""

    def __init__(self, code: str, findings: tuple[str, ...] | list[str] = ()):
        self.code = code if code in MESSAGES else "no_draw"
        self.findings = tuple(key for key in FINDINGS if key in set(findings))
        super().__init__(self.code)

    @property
    def is_vector(self) -> bool:
        return "raster" not in self.findings

    @property
    def message(self) -> str:
        if self.code != "unsafe":
            return MESSAGES[self.code]
        found = [FINDINGS[key] for key in self.findings if key != "raster"]
        parts = [] if self.is_vector else [NOT_VECTOR]
        if found:
            parts.append(("Gefunden: " if self.is_vector else "Außerdem gefunden: ") + "; ".join(found) + ".")
        parts.append(UNSAFE_HINT)
        return " ".join(parts)

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


# ---------------------------------------------------------------- Strenge Prüfung: was ist im Original?

RASTER_ELEMENTS = frozenset({"image", "feimage"})
SCRIPT_ELEMENTS = frozenset({"script", "handler", "listener"})
FOREIGN_ELEMENTS = frozenset({"foreignobject", "iframe", "object", "embed", "audio", "video", "canvas", "html",
                              "body"})
TEXT_CONTENT = frozenset({"text", "tspan", "textpath"})
XINCLUDE_NS = "http://www.w3.org/2001/XInclude"


def _compact(value: str) -> str:
    """Für den Vergleich: mehrfach URL-dekodiert (höchstens viermal), ohne Leerraum und Steuerzeichen, klein."""
    text = str(value)
    for _ in range(4):
        decoded = unquote(text)
        if decoded == text:
            break
        text = decoded
    return "".join(ch for ch in text if not ch.isspace() and ord(ch) >= 32 and ch != "\x7f").lower()


def _url_targets(css: str) -> list[str]:
    """Die Ziele aller ``url(…)`` in einem kompakten (kleingeschriebenen, leerzeichenfreien) Text."""
    targets, start = [], 0
    while True:
        begin = css.find("url(", start)
        if begin < 0:
            return targets
        end = css.find(")", begin)
        targets.append(css[begin + 4:end if end >= 0 else len(css)].strip("'\""))
        start = begin + 4


def _css_findings(css: str) -> set[str]:
    text = _compact(css)
    found = set()
    if "javascript:" in text or "expression(" in text or "behavior:" in text or "-moz-binding" in text:
        found.add("script")
    if "@import" in text or "@font-face" in text or "\\" in text:
        found.add("css")
    for target in _url_targets(text):
        if target.startswith("data:"):
            found.add("data")
        elif not target.startswith("#"):
            found.add("css")
    return found


def _reference_findings(value: str) -> set[str]:
    target = _compact(value)
    if not target or target.startswith("#"):
        return set()
    if target.startswith(("javascript:", "vbscript:")):
        return {"script"}
    if target.startswith("data:"):
        return {"data"}
    return {"external"}


def findings(data: bytes, source: ET.Element) -> set[str]:
    """Was die strenge Prüfung im gelesenen Original findet - Schlüssel aus ``FINDINGS``."""
    found: set[str] = set()
    if b"<?xml-stylesheet" in data.lower():
        found.add("external")
    for element in source.iter():
        tag = element.tag if isinstance(element.tag, str) else ""
        namespace, local = ("", tag)
        if tag.startswith("{"):
            namespace, _, local = tag[1:].partition("}")
        lowered = local.lower()
        if namespace == XINCLUDE_NS:
            found.add("external")
        if lowered in RASTER_ELEMENTS:
            found.add("raster")
        elif lowered in SCRIPT_ELEMENTS:
            found.add("script")
        elif lowered in FOREIGN_ELEMENTS:
            found.add("foreign")
        elif lowered in TEXT_CONTENT:
            found.add("text")
        elif lowered == "style":
            found |= _css_findings("".join(element.itertext()))
        for key, value in element.attrib.items():
            name = key.split("}", 1)[-1].lower()
            attr_ns = key[1:].split("}", 1)[0] if key.startswith("{") else ""
            compact = _compact(value)
            if name.startswith("on"):
                found.add("events")
            if "javascript:" in compact or "vbscript:" in compact:
                found.add("script")
            if name == "href":
                found |= _reference_findings(value)
            elif attr_ns == XML_NS and name == "base":
                found.add("external")
            elif name == "style" or name in PRESENTATION:
                found |= _css_findings(value)
    return found


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


def _serialize(root: ET.Element, view_box: tuple[float, float, float, float],
               size: tuple[int, int] | None = None) -> CleanSvg:
    x, y, w, h = view_box
    if size is None:
        scale = INTRINSIC_PX / max(w, h)
        width, height = max(1, round(w * scale)), max(1, round(h * scale))
    else:
        width, height = size
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


def _render(data: bytes, width: int, *, height: int | None = None, timeout: float | None = None,
            memory_mb: int | None = None, fonts: bool = True) -> bytes:
    """Ein bereinigtes SVG als PNG - in einem eigenen Prozess (``svg_raster_worker.py``) mit harter Zeitgrenze und
    Speichergrenze, höchstens ``RASTER_CONCURRENCY`` zugleich. Ein zu aufwendiges Bild bricht ab, statt den Server zu
    binden."""
    limit = float(timeout or RASTER_TIMEOUT_SECONDS)
    if not _RASTER_SLOTS.acquire(timeout=RASTER_WAIT_SECONDS):
        raise SvgRejected("busy")
    try:
        result = subprocess.run(
            [sys.executable, "-I", str(WORKER), str(int(width)), str(int(memory_mb or RASTER_MEMORY_MB)),
             str(math.ceil(limit) + 1), str(int(height or 0)), "1" if fonts else "0"],
            input=data, capture_output=True, timeout=limit, check=False,
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


def render_rgba(data: bytes, view_box, long_side: int):
    """Ein bereinigtes SVG als RGBA-Bild mit ``long_side`` Pixeln an der längeren Seite (für die Logos)."""
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


def png_bytes(image, dpi: int | None = None) -> bytes:
    """PNG ohne Metadaten außer der DPI - gleiche Pixel ergeben dieselben Bytes."""
    out = io.BytesIO()
    if dpi:
        image.save(out, format="PNG", compress_level=6, dpi=(int(dpi), int(dpi)))
    else:
        image.save(out, format="PNG", compress_level=6)
    return out.getvalue()


def _parse(data: bytes) -> ET.Element:
    if not isinstance(data, (bytes, bytearray)):
        raise SvgRejected("not_svg")
    if len(data) > MAX_SVG_BYTES:
        raise SvgRejected("too_big")
    try:
        return parse_xml(bytes(data), forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except DefusedXmlException:
        raise SvgRejected("dtd") from None
    except (ET.ParseError, ValueError, UnicodeError):
        raise SvgRejected("not_svg") from None


def clean_tree(data: bytes, *, strict: bool = True) -> tuple[ET.Element, tuple[float, float, float, float]]:
    """Lesen, (streng) prüfen und aus der Positivliste neu bauen: der neue Baum (ohne Namensraum) und die viewBox."""
    source = _parse(data)
    svg_default = not str(source.tag).startswith("{")
    if _local_name(source.tag, svg_default) != "svg":
        raise SvgRejected("not_svg")
    if sum(1 for _ in source.iter()) > MAX_INPUT_ELEMENTS:
        raise SvgRejected("too_many")
    if strict:
        found = findings(bytes(data), source)
        if found:
            raise SvgRejected("unsafe", sorted(found))
    view_box = _view_box(source)
    root = _Copier(svg_default).copy(source, "svg", 0)
    _resolve_references(root)
    return root, view_box


def sanitize(data: bytes, *, strict: bool = True) -> CleanSvg:
    """Das hochgeladene SVG, neu geschrieben aus der Positivliste - oder ``SvgRejected`` mit einer Meldung. Streng
    (Vorgabe): Gefährliches oder ein Pixelbild lehnt ab, statt es still zu entfernen. Zeichnet nichts."""
    root, view_box = clean_tree(data, strict=strict)
    return _serialize(root, view_box)


# ---------------------------------------------------------------- Farben: lesen, normalisieren, ersetzen

# Eigenschaften, die eine Farbe tragen. Nur dort wird umgefärbt - nie in Selektoren, Kennungen oder url(#…).
COLOR_PROPS = frozenset({"fill", "stroke", "stop-color", "color"})
NAMED_COLORS = {"white": "#ffffff", "black": "#000000"}
HEX_DIGITS = frozenset("0123456789abcdef")
# Begrenzt und ohne Verschachtelung: kein Rückverfolgen über lange Eingaben.
_COLOR_TOKEN = re.compile(r"#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])|rgba?\([^()]{0,80}\)|\b(?:white|black)\b",
                          re.IGNORECASE)
_URL_SPAN = re.compile(r"url\([^()]{0,200}\)", re.IGNORECASE)


def _channel(text: str) -> int | None:
    text = text.strip()
    try:
        value = float(text[:-1]) * 2.55 if text.endswith("%") else float(text)
    except ValueError:
        return None
    if not math.isfinite(value):
        return None
    return max(0, min(255, round(value)))


def _parse_color(token: str) -> tuple[str, str | None] | None:
    """``(#rrggbb, alpha-Rest)`` für eine Farbe - ``alpha-Rest`` ist der Alpha-Teil, wie er stand (oder ``None``)."""
    text = token.strip().lower()
    if text in NAMED_COLORS:
        return NAMED_COLORS[text], None
    if text.startswith("#"):
        digits = text[1:]
        if not digits or any(ch not in HEX_DIGITS for ch in digits):
            return None
        if len(digits) in (3, 4):
            return "#" + "".join(ch * 2 for ch in digits[:3]), (digits[3] * 2 if len(digits) == 4 else None)
        if len(digits) in (6, 8):
            return "#" + digits[:6], (digits[6:] if len(digits) == 8 else None)
        return None
    if text.startswith(("rgb(", "rgba(")) and text.endswith(")"):
        inner = text[text.index("(") + 1:-1].replace("/", ",")
        parts = [part for part in inner.replace(",", " ").split() if part]
        if len(parts) not in (3, 4):
            return None
        channels = [_channel(part) for part in parts[:3]]
        if None in channels:
            return None
        return "#" + "".join(f"{value:02x}" for value in channels), (parts[3] if len(parts) == 4 else None)
    return None


def normalize_color(value: str) -> str | None:
    """Eine Farbe als ``#rrggbb`` (klein) - Kurz-Hex, Groß-/Kleinschreibung, ``rgb()`` und Weiß/Schwarz als Wort;
    sonst ``None``."""
    parsed = _parse_color(str(value or ""))
    return parsed[0] if parsed else None


def _outside_urls(value: str):
    """Die Farb-Treffer eines Werts außerhalb von ``url(…)`` - dort steht eine Kennung, keine Farbe."""
    spans = [match.span() for match in _URL_SPAN.finditer(value)]
    for match in _COLOR_TOKEN.finditer(value):
        if not any(start <= match.start() < end for start, end in spans):
            yield match


def _value_colors(value: str) -> list[str]:
    return [color for match in _outside_urls(value) if (color := normalize_color(match.group(0)))]


def _recolor_value(value: str, mapping: dict[str, str]) -> str:
    out, last = [], 0
    for match in _outside_urls(value):
        parsed = _parse_color(match.group(0))
        if not parsed or parsed[0] not in mapping:
            continue
        target, alpha = mapping[parsed[0]], parsed[1]
        if alpha is None:
            replacement = target
        elif match.group(0).startswith("#"):
            replacement = target + alpha
        else:
            red, green, blue = (int(target[index:index + 2], 16) for index in (1, 3, 5))
            replacement = f"rgba({red},{green},{blue},{alpha})"
        out.append(value[last:match.start()] + replacement)
        last = match.end()
    return "".join(out) + value[last:]


def _map_declarations(text: str, apply) -> str:
    parts = []
    for part in text.split(";"):
        prop, colon, value = part.partition(":")
        parts.append(f"{prop}:{apply(value)}" if colon and prop.strip().lower() in COLOR_PROPS else part)
    return ";".join(parts)


def _map_stylesheet(css: str, apply) -> str:
    """Ein bereinigtes Stylesheet (``sel{decl;…}sel{…}``): nur die Deklarationen, nie die Selektoren."""
    out, pos = [], 0
    while True:
        opening = css.find("{", pos)
        closing = css.find("}", opening) if opening >= 0 else -1
        if opening < 0 or closing < 0:
            out.append(css[pos:])
            return "".join(out)
        out.append(css[pos:opening + 1] + _map_declarations(css[opening + 1:closing], apply) + "}")
        pos = closing + 1


def _walk_colors(root: ET.Element, apply) -> None:
    """``apply(wert) -> wert`` auf jede Farbe in Attributen, ``style``-Attributen und ``<style>``-Blöcken."""
    for element in root.iter():
        for name in list(element.attrib):
            if name in COLOR_PROPS:
                element.set(name, apply(element.get(name)))
            elif name == "style":
                element.set(name, _map_declarations(element.get(name), apply))
        if element.tag == "style" and element.text:
            element.text = _map_stylesheet(element.text, apply)


def _valid_mapping(mapping: dict[str, str]) -> dict[str, str]:
    if not isinstance(mapping, dict) or not mapping:
        raise ValueError("Farbzuordnung fehlt.")
    out = {}
    for source, target in mapping.items():
        key, value = normalize_color(source), normalize_color(target)
        if key is None or value is None or not str(target).strip().startswith("#"):
            raise ValueError("Farbzuordnung: nur Farben wie #ffffff → #111111.")
        out[key] = value
    return out


def recolor(data: bytes, mapping: dict[str, str], *, strict: bool = True) -> bytes:
    """Das SVG bereinigt und mit ersetzten Farben, etwa ``{"#ffffff": "#111111"}`` für helle Shirts. Ersetzt wird in
    ``fill``, ``stroke``, ``stop-color`` und ``color`` - als Attribut, im ``style``-Attribut und im ``<style>``-Block;
    ``#fff``, ``#FFFFFF``, ``white`` und ``rgb(255,255,255)`` gelten als dieselbe Farbe. Alle anderen Farben bleiben."""
    wanted = _valid_mapping(mapping)
    root, view_box = clean_tree(data, strict=strict)
    _walk_colors(root, lambda value: _recolor_value(value, wanted))
    return _serialize(root, view_box).data


def colors(data: bytes, *, strict: bool = True) -> list[dict]:
    """Die Farben im SVG (normalisiert), häufigste zuerst: ``[{"hex": "#ffffff", "count": 12}, …]``. Formen ohne
    Füllangabe zeichnet ein SVG schwarz - die stehen hier nicht."""
    root, _view_box = clean_tree(data, strict=strict)
    counter: Counter[str] = Counter()

    def collect(value: str) -> str:
        counter.update(_value_colors(value))
        return value

    _walk_colors(root, collect)
    return [{"hex": hex_value, "count": count}
            for hex_value, count in sorted(counter.items(), key=lambda item: (-item[1], item[0]))]


def analyze(data: bytes, *, strict: bool = True) -> dict:
    """Für die Anzeige: angenommen ja/nein (mit Meldung und Funden), echtes Vektor-SVG ja/nein, viewBox,
    Seitenverhältnis, Farben, Zahl der Elemente nach der Bereinigung."""
    try:
        root, view_box = clean_tree(data, strict=strict)
    except SvgRejected as rejected:
        return {"ok": False, "is_vector": rejected.is_vector, "code": rejected.code,
                "findings": list(rejected.findings), "message": rejected.message}
    _x, _y, w, h = view_box
    clean = _serialize(root, view_box).data
    return {"ok": True, "is_vector": True, "code": None, "findings": [], "message": None,
            "view_box": [float(value) for value in view_box], "aspect_ratio": round(w / h, 6),
            "colors": colors(clean, strict=False), "elements": _subtree_size(root)}


# ---------------------------------------------------------------- Rastern in genau einer Größe

def target_size(view_box, *, width_px: int | None = None, height_px: int | None = None) -> tuple[int, int]:
    """Breite und Höhe in Pixeln bei erhaltenem Seitenverhältnis - genau eins von beiden ist vorgegeben."""
    if (width_px is None) == (height_px is None):
        raise ValueError("Genau eins angeben: width_px oder height_px.")
    given = width_px if width_px is not None else height_px
    if isinstance(given, bool) or not isinstance(given, int) or given < 1:
        raise ValueError("Pixelmaß als ganze Zahl ab 1.")
    _x, _y, w, h = view_box
    if width_px is not None:
        size = (width_px, max(1, round(width_px * h / w)))
    else:
        size = (max(1, round(height_px * w / h)), height_px)
    if max(size) > MAX_RASTER_SIDE or size[0] * size[1] > MAX_RASTER_PIXELS:
        raise SvgRejected("raster_size")
    return size


def rasterize(data: bytes, *, width_px: int | None = None, height_px: int | None = None, dpi: int | None = None,
              strict: bool = True) -> bytes:
    """Das SVG als PNG in genau ``width_px`` Breite (oder ``height_px`` Höhe), Seitenverhältnis erhalten, Hintergrund
    durchsichtig, im PNG nur die DPI. Die Eingabe wird immer zuerst bereinigt (streng als Vorgabe). Gleiche Eingabe
    ergibt dieselben Bytes."""
    from PIL import Image

    if dpi is not None and (isinstance(dpi, bool) or not isinstance(dpi, int) or not 1 <= dpi <= 2400):
        raise ValueError("DPI als ganze Zahl von 1 bis 2400.")
    root, view_box = clean_tree(data, strict=strict)
    size = target_size(view_box, width_px=width_px, height_px=height_px)
    sized = _serialize(root, view_box, size=size).data
    rendered = _render(sized, size[0], height=size[1], timeout=PRINT_TIMEOUT_SECONDS, memory_mb=PRINT_MEMORY_MB,
                       fonts=not strict)
    with Image.open(io.BytesIO(rendered)) as image:
        image = image.convert("RGBA")
    if image.size != size:
        image = image.resize(size, Image.Resampling.LANCZOS)
    return png_bytes(image, dpi)
