"""Gamertag-Druckdatei (#1711): aus einem Namen wird serverseitig ein PNG mit Transparenz - dieselbe Datei für den
Testentwurf an Printful (#2062) und später für jede Bestellung (#1712/#1713). Beschreibung: ``docs/SHOP.md``, Abschnitt
„Gamertag-Druckdatei“.

Der Weg eines Namens:

1. **Geprüft** (``clean_text``): Unicode zusammengesetzt (NFC, nie NFKC - „Ｔ“ wird nicht still zu „T“), Emojis und
   Symbole, Steuerzeichen und nicht erlaubte Zeichen abgelehnt - mit Begründung, die nur die störenden Zeichen nennt,
   nie den ganzen Namen. Rand getrimmt, innen ein Leerzeichen, Mindest- und Höchstlänge. Danach der Wortfilter der
   Moderation (``check_words``, async).
2. **Gerendert** (``render``): ohne Netz und ohne Dateizugriff - die Schrift liegt im Repo
   (``backend/static/fonts``, SIL Open Font License) und wird einmal in den Speicher gelesen. Die Texthöhe (Vorgabe
   0,5 Zoll, gemessen an der Höhe der Großbuchstaben) passt der Renderer an die Höchstbreite an: passt der Name nicht,
   wird er bis zur Mindesthöhe (Vorgabe 0,4 Zoll) verkleinert, sonst abgelehnt. Die Leinwand ist für alle Namen
   gleich groß (Höchstbreite × feste Höhe), die senkrechte Mitte der Großbuchstaben liegt genau auf der halben Höhe -
   das ist der Anker, den die Produktverwaltung (#1707) auf die Mitte des Löwen legt.
3. **Abgelegt** (``store``, async): wie die Designs (#1708) mit SHA-256, eigener Datei im selben Speicher und eigenem
   Zufallsschlüssel für die öffentliche Adresse, Herkunft ``gamertag``. Gleicher Text mit gleichen Regeln ergibt
   dieselbe Datei und damit dieselbe Zeile (``sha256`` eindeutig). Der Name selbst steht nie in der Zeile, nie im
   Protokoll und nie im Log - nur in der Datei und später an der Bestellposition.

Alle Maße und Regeln sind Einstellungen der Finanzen (``settings`` mit ``id = "shop_gamertag"``), nie fest verdrahtet.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import math
import re
import secrets
import unicodedata
import weakref
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont
from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services import shop_catalog, shop_designs
from services.shop_common import ShopError, clean_reason, record_admin_action

logger = logging.getLogger("tls-arena.shop-gamertag")

RENDERER_VERSION = 1  # ändert sich, wenn der Renderer andere Pixel liefert - dann ist es eine neue Datei
FONT_DIR = Path(__file__).resolve().parent.parent / "static" / "fonts"
# Dieselben Schriften wie die Website (frontend/src/fonts.css), lateinischer Zeichensatz mit Umlauten und ß.
FONTS: dict[str, dict[str, Any]] = {
    "rajdhani-700": {"label": "Rajdhani Bold – schmal, wie die Zahlen der Website", "file": "rajdhani-latin-700.woff2",
                     "license": "OFL-Rajdhani.txt", "weight": None},
    "outfit-800": {"label": "Outfit ExtraBold – Text der Website", "file": "outfit-latin-wght.woff2",
                   "license": "OFL-Outfit.txt", "weight": 800},
    "outfit-700": {"label": "Outfit Bold – Text der Website", "file": "outfit-latin-wght.woff2",
                   "license": "OFL-Outfit.txt", "weight": 700},
    "unbounded-800": {"label": "Unbounded ExtraBold – Überschriften, sehr breit", "file": "unbounded-latin-800.woff2",
                      "license": "OFL-Unbounded.txt", "weight": None},
    # Sport- und Blockschrift für Trikots (#2142): Name, Rückennummer und Vereinsname. Unverändert aus dem npm-Paket
    # ``@fontsource/saira-condensed@5.3.0`` (Datei ``files/saira-condensed-latin-900-normal.woff2``, Lizenz ``LICENSE``
    # als OFL-SairaCondensed.txt) - Quelle Google Fonts, wie die übrigen Schriften (scripts/build_web_fonts.py). Nur im
    # Backend; die Prüfsumme hält ein Test fest.
    "saira-condensed-900": {"label": "Saira Condensed Black – Sport- und Blockschrift für Trikots",
                            "file": "saira-condensed-latin-900.woff2", "license": "OFL-SairaCondensed.txt",
                            "weight": None, "package": "@fontsource/saira-condensed@5.3.0",
                            "sha256": "28e7f85ac4b26a1b9f2070fa6867c073457412414def415e9bd6387e7f3228f8"},
}
HEIGHT_MODES = {"cap": "Höhe der Großbuchstaben", "font": "Schriftgröße (wie im Printful-Designer)"}
ALIGNS = {"center": "mittig", "left": "links", "right": "rechts"}
MIN_DPI, MAX_DPI = 300, 600
MIN_HEIGHT_IN, MAX_HEIGHT_IN = 0.1, 2.0
MIN_WIDTH_IN, MAX_WIDTH_IN = 0.5, 12.0
MAX_LENGTH_LIMIT = 40  # so lang darf das Feld in Dolibarr sein
MAX_COLORS = 10
MAX_EXTRA_CHARS = 40
COLOR_KEY = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
PAD_PX = 2  # Luft über Akzenten und unter Unterlängen

# Vorgaben aus dem Testshirt (Stand 15.10.2026, #1711): Texthöhe 0,5 Zoll, Höchstbreite 3,5 Zoll, Verkleinerung bis
# 0,4 Zoll, 300 DPI wie die Löwen-Datei, Farbe Vereinsblau (Rolle „brand“, frontend/src/styles/system.css).
DEFAULT_RULES: dict[str, Any] = {
    "font": "rajdhani-700",
    "height_mode": "cap",
    "text_height_in": 0.5,
    "min_text_height_in": 0.4,
    "max_width_in": 3.5,
    "dpi": 300,
    "align": "center",
    "placement": "front_left",
    "min_length": 2,
    "max_length": 16,
    "allowed_chars": "ÄÖÜäöüß _-.",
    "block_flagged": True,
    "colors": [
        {"key": "vereinsblau", "label": "Vereinsblau", "hex": "#29B6E8", "garment_colors": []},
        {"key": "reinweiss", "label": "Weiß", "hex": "#FFFFFF", "garment_colors": []},
        {"key": "tiefschwarz", "label": "Schwarz", "hex": "#000000", "garment_colors": []},
    ],
    "default_color": "vereinsblau",
}
RULE_FIELDS = tuple(DEFAULT_RULES)
# Was die Pixel bestimmt (ohne Farbe - die steht an der Datei selbst).
RENDER_FIELDS = ("font", "height_mode", "text_height_in", "min_text_height_in", "max_width_in", "dpi", "align")


def default_rules() -> dict:
    return json.loads(json.dumps(DEFAULT_RULES))


# ---------------------------------------------------------------- Regeln prüfen

def _inches_value(value: Any, label: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ShopError(f"{label}: als Zahl in Zoll angeben.")
    if not low <= value <= high:
        raise ShopError(f"{label}: {shop_designs.inches(low)} bis {shop_designs.inches(high)}.")
    return round(float(value), 3)


def _whole(value: Any, label: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value or not low <= value <= high:
        raise ShopError(f"{label}: ganze Zahl von {low} bis {high}.")
    return int(value)


def _printable_latin(char: str) -> bool:
    code = ord(char)
    return 0x20 <= code <= 0x7E or 0xA1 <= code <= 0xFF


def _extra_chars(value: Any) -> str:
    if not isinstance(value, str):
        raise ShopError("Erlaubte Zeichen als Text angeben.")
    out = ""
    for char in unicodedata.normalize("NFC", value):
        if not _printable_latin(char):
            raise ShopError("Erlaubte Zeichen: nur druckbare Zeichen aus dem lateinischen Zeichensatz (die Schrift "
                            "kennt keine anderen) - keine Emojis, keine Steuerzeichen.")
        if char not in out and not (char.isascii() and char.isalnum()):
            out += char
    if len(out) > MAX_EXTRA_CHARS:
        raise ShopError(f"Erlaubte Zeichen: höchstens {MAX_EXTRA_CHARS} zusätzliche.")
    return "".join(sorted(out, key=ord))


def _colors(value: Any) -> list[dict]:
    if not isinstance(value, list) or not value:
        raise ShopError("Mindestens eine Farbe für den Namen.")
    if len(value) > MAX_COLORS:
        raise ShopError(f"Höchstens {MAX_COLORS} Farben für den Namen.")
    out, keys = [], set()
    for raw in value:
        if not isinstance(raw, dict) or set(raw) - {"key", "label", "hex", "garment_colors"}:
            raise ShopError("Farbe: Kennung, Bezeichnung, Farbwert und Shirtfarben.")
        key = str(raw.get("key") or "").strip()
        if not COLOR_KEY.match(key) or len(key) > 30 or key in keys:
            raise ShopError("Farbe: Kennung aus Kleinbuchstaben, Ziffern und Bindestrichen, je Farbe eine eigene.")
        label = " ".join(str(raw.get("label") or "").split())
        if not label or len(label) > 40:
            raise ShopError("Farbe: Bezeichnung mit 1 bis 40 Zeichen.")
        hex_value = str(raw.get("hex") or "").strip()
        if not HEX.match(hex_value):
            raise ShopError(f"Farbe „{label}“: Farbwert als #RRGGBB.")
        keys.add(key)
        out.append({"key": key, "label": label, "hex": hex_value.upper(),
                    "garment_colors": shop_designs.clean_colors(raw.get("garment_colors"))})
    return out


def clean_rules(raw: Any) -> dict:
    """Vollständige, geprüfte Regeln; fehlende Felder nehmen die Vorgabe. Lehnt mit Text für die Finanzen ab."""
    if not isinstance(raw, dict):
        raise ShopError("Regeln fehlen.")
    unknown = sorted(set(raw) - set(RULE_FIELDS))
    if unknown:
        raise ShopError(f"Unbekannte Felder: {', '.join(unknown)}.")
    merged = {**default_rules(), **raw}
    if merged["font"] not in FONTS:
        raise ShopError("Unbekannte Schrift.")
    if merged["height_mode"] not in HEIGHT_MODES:
        raise ShopError("Texthöhe gemessen an: Großbuchstaben oder Schriftgröße.")
    if merged["align"] not in ALIGNS:
        raise ShopError("Ausrichtung: mittig, links oder rechts.")
    if merged["placement"] not in shop_catalog.PLACEMENTS:
        raise ShopError("Unbekannte Platzierung.")
    rules = {
        "font": merged["font"], "height_mode": merged["height_mode"], "align": merged["align"],
        "placement": merged["placement"],
        "text_height_in": _inches_value(merged["text_height_in"], "Texthöhe", MIN_HEIGHT_IN, MAX_HEIGHT_IN),
        "min_text_height_in": _inches_value(merged["min_text_height_in"], "Mindesthöhe", MIN_HEIGHT_IN,
                                            MAX_HEIGHT_IN),
        "max_width_in": _inches_value(merged["max_width_in"], "Höchstbreite", MIN_WIDTH_IN, MAX_WIDTH_IN),
        "dpi": _whole(merged["dpi"], "DPI", MIN_DPI, MAX_DPI),
        "min_length": _whole(merged["min_length"], "Länge (Mindestlänge)", 1, MAX_LENGTH_LIMIT),
        "max_length": _whole(merged["max_length"], "Länge (Höchstlänge)", 1, MAX_LENGTH_LIMIT),
        "allowed_chars": _extra_chars(merged["allowed_chars"]),
        "block_flagged": merged["block_flagged"],
        "colors": _colors(merged["colors"]),
        "default_color": merged["default_color"],
    }
    if not isinstance(rules["block_flagged"], bool):
        raise ShopError("Wortfilter: ja oder nein.")
    if rules["min_text_height_in"] > rules["text_height_in"]:
        raise ShopError(f"Die Mindesthöhe ({shop_designs.inches(rules['min_text_height_in'])}) darf nicht größer "
                        f"sein als die Texthöhe ({shop_designs.inches(rules['text_height_in'])}).")
    if rules["min_length"] > rules["max_length"]:
        raise ShopError("Länge: die Mindestlänge ist größer als die Höchstlänge.")
    if rules["default_color"] not in {color["key"] for color in rules["colors"]}:
        raise ShopError("Die Vorgabefarbe muss eine der Farben sein.")
    return rules


CM_PER_INCH = 2.54
LAYER_SIZE_FIELDS = ("text_height_cm", "max_width_cm", "min_text_height_cm")
# Schrift und Kontur je Ebene (#2142) - ohne Angabe die Schrift der Gamertag-Regeln und keine Kontur.
LAYER_STYLE_FIELDS = ("font", "outline_cm", "outline_ink")
# Seit #2142 begrenzt die Druckfläche (mit Sicherheitsrand) Texthöhe und Höchstbreite einer Ebene - nicht mehr die
# festen 2 bzw. 12 Zoll der globalen Regeln. Ohne Fläche gilt nur diese technische Obergrenze; die Leinwand darf
# höchstens ``MAX_CANVAS_PIXELS`` haben (bei 300 DPI etwa eine 20 cm hohe Nummer auf 40 cm Breite).
LAYER_MAX_CM = 200.0
MAX_CANVAS_PIXELS = 20_000_000
MIN_OUTLINE_CM, MAX_OUTLINE_CM = 0.05, 2.0
# Optional in den Regeln einer Ebene - nur dann im Fingerabdruck, damit sich bestehende Dateien nicht ändern.
OPTIONAL_RENDER_FIELDS = ("outline_in", "outline_color")


def _cm_text(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".").replace(".", ",")


def _layer_cm(value: Any, label: str, low: float, high: float, where: str = "") -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or not low <= value <= high:
        raise ShopError(f"{label}: eine Zahl in cm von {_cm_text(low)} bis {_cm_text(high)}{where}.")
    return round(float(value), 2)


def clean_layer_sizes(layer: dict | None, *, bounds: dict | None = None) -> dict:
    """Texthöhe, Höchstbreite und Mindesthöhe einer Textebene in cm (#2105, #2142) - nur, was angegeben ist.
    Untergrenzen wie bei den globalen Regeln; die Obergrenze ist seit #2142 die Fläche: ``bounds`` mit
    ``text_height_cm``, ``width_cm`` (Fläche ohne Sicherheitsrand) und ``label`` - die Meldung nennt sie in cm. Ohne
    Fläche nur ``LAYER_MAX_CM``. Die Mindesthöhe (bis dahin wird ein zu breiter Name verkleinert) ist höchstens die
    Texthöhe."""
    out = {}
    layer = layer or {}
    where = f" - so viel lässt die Fläche „{bounds['label']}“ mit Sicherheitsrand zu" if bounds else ""
    lowest = round(MIN_HEIGHT_IN * CM_PER_INCH, 2)
    high_height = max(round(bounds["text_height_cm"], 2), lowest) if bounds else LAYER_MAX_CM
    if layer.get("text_height_cm") is not None:
        out["text_height_cm"] = _layer_cm(layer["text_height_cm"], "Texthöhe", lowest, high_height, where)
    if layer.get("max_width_cm") is not None:
        high = round(bounds["width_cm"], 2) if bounds else LAYER_MAX_CM
        out["max_width_cm"] = _layer_cm(layer["max_width_cm"], "Höchstbreite", round(MIN_WIDTH_IN * CM_PER_INCH, 2),
                                        max(high, round(MIN_WIDTH_IN * CM_PER_INCH, 2)), where)
    if layer.get("min_text_height_cm") is not None:
        out["min_text_height_cm"] = _layer_cm(layer["min_text_height_cm"], "Mindesthöhe", lowest, high_height, where)
        if "text_height_cm" in out and out["min_text_height_cm"] > out["text_height_cm"]:
            raise ShopError(f"Die Mindesthöhe ({_cm_text(out['min_text_height_cm'])} cm) darf nicht größer sein als die "
                            f"Texthöhe ({_cm_text(out['text_height_cm'])} cm).")
    return out


def clean_layer_style(layer: dict | None, rules: dict, *, strict: bool = True) -> dict:
    """Schrift und Kontur einer Namens- bzw. Textebene (#2142) - nur, was angegeben ist: ``font`` (eine der
    freigegebenen Schriften), ``outline_cm`` (Stärke der Kontur) und ``outline_ink`` (Farbe der Kontur aus den
    Gamertag-Regeln; ohne Angabe die Farbe mit dem höchsten Kontrast zur Schrift). Beim Speichern (``strict``) lehnt
    eine unbekannte Schrift oder Farbe ab; beim Rendern gilt dafür wieder die Vorgabe - wie bei der Farbe des Namens
    (#2141), etwa wenn eine Farbe später aus den Gamertag-Regeln entfernt wird."""
    out: dict = {}
    layer = layer or {}
    font = layer.get("font")
    if font not in (None, ""):
        if isinstance(font, str) and font in FONTS:
            out["font"] = font
        elif strict:
            raise ShopError("Unbekannte Schrift.")
    if layer.get("outline_cm") not in (None, 0, 0.0):
        out["outline_cm"] = _layer_cm(layer["outline_cm"], "Kontur", MIN_OUTLINE_CM, MAX_OUTLINE_CM)
    ink = layer.get("outline_ink")
    if ink not in (None, "", "auto"):
        if "outline_cm" not in out:
            if strict:
                raise ShopError("Eine Konturfarbe braucht eine Konturstärke.")
        elif isinstance(ink, str) and ink in {color["key"] for color in rules["colors"]}:
            out["outline_ink"] = ink
        elif strict:
            raise ShopError("Kontur: diese Farbe gibt es in den Gamertag-Regeln nicht.")
    return out


def has_own_settings(layer: dict | None, rules: dict) -> bool:
    """Hat die Ebene eigene Größe, Schrift oder Kontur? Dann prüft der Plan der Druckfläche, ob sie hineinpasst."""
    return bool(clean_layer_sizes(layer) or clean_layer_style(layer, rules, strict=False))


def layer_rules(rules: dict, layer: dict | None, *, bounds: dict | None = None) -> dict:
    """Die Regeln für eine Ebene (#2105, #2142): Texthöhe, Höchstbreite, Mindesthöhe, Schrift und Kontur der Ebene, wenn
    gesetzt, sonst die globalen. Ohne eigene Mindesthöhe bleibt die Verkleinerung im selben Verhältnis zur Texthöhe.
    Rendern (Vorschau, Grund- und Bestelldatei) und Platzieren (Leinwand) lesen genau diese Regeln - ohne Angabe ist
    alles wie bisher."""
    sizes = clean_layer_sizes(layer, bounds=bounds)
    style = clean_layer_style(layer, rules, strict=False)
    if not sizes and not style:
        return rules
    out = dict(rules)
    if "text_height_cm" in sizes:
        height = round(sizes["text_height_cm"] / CM_PER_INCH, 3)
        out["text_height_in"] = height
        out["min_text_height_in"] = round(min(height, rules["min_text_height_in"] * height / rules["text_height_in"]),
                                          3)
    if "min_text_height_cm" in sizes:
        out["min_text_height_in"] = round(min(out["text_height_in"], sizes["min_text_height_cm"] / CM_PER_INCH), 3)
    if "max_width_cm" in sizes:
        out["max_width_in"] = round(sizes["max_width_cm"] / CM_PER_INCH, 3)
    if "font" in style:
        out["font"] = style["font"]
    if "outline_cm" in style:
        out["outline_in"] = round(style["outline_cm"] / CM_PER_INCH, 4)
        out["outline_color"] = style.get("outline_ink")  # ohne Angabe: höchster Kontrast zur Schrift
    return out

def rules_hash(rules: dict) -> str:
    """Fingerabdruck dessen, was die Pixel bestimmt: Regeln, Schriftdatei und Renderer-Version. Die Kontur (#2142)
    zählt nur, wenn sie gesetzt ist - so bleibt der Fingerabdruck bestehender Dateien gleich."""
    font = FONTS[rules["font"]]
    payload = {"renderer": RENDERER_VERSION, "font_sha256": hashlib.sha256(_font_bytes(font["file"])).hexdigest(),
               **{name: rules[name] for name in RENDER_FIELDS},
               **{name: rules[name] for name in OPTIONAL_RENDER_FIELDS if name in rules}}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def color_of(rules: dict, color_key: str | None = None) -> dict:
    key = color_key or rules["default_color"]
    for color in rules["colors"]:
        if color["key"] == key:
            return color
    raise ShopError("Unbekannte Farbe für den Namen.")


def inks_for_garment(rules: dict, garment_color: str) -> list[dict]:
    """Die Farben des Namens für eine Shirtfarbe in ihrer Reihenfolge (die erste ist die Vorgabe) - mehrere sind
    erlaubt, etwa Weiß und Vereinsblau auf Schwarz. Ohne Zuordnung gilt die Vorgabefarbe."""
    wanted = " ".join(str(garment_color or "").split()).casefold()
    found = [color for color in rules["colors"]
             if wanted and wanted in {item.casefold() for item in color["garment_colors"]}]
    return found or [color_of(rules)]


# Kontrast nach WCAG (1 bis 21) - ab 3 gilt großer Text als lesbar. Ein Name auf dem Trikot ist großer Text.
MIN_INK_CONTRAST = 3.0


def contrast_ratio(first: float, second: float) -> float:
    high, low = max(first, second), min(first, second)
    return (high + 0.05) / (low + 0.05)


def ink_for_surface(rules: dict, garment_color: str, luminance: float) -> dict:
    """Die Farbe des Namens auf einem Untergrund mit dieser relativen Luminanz (#2141) - etwa dem Hintergrund einer
    Allover-Fläche unter der Ebene. Reihenfolge wie bisher: die Farben der Shirtfarbe (``inks_for_garment``), dann die
    Vorgabefarbe, dann die übrigen Farben der Regeln; die erste mit mindestens ``MIN_INK_CONTRAST`` gewinnt. Reicht
    keine, die mit dem höchsten Kontrast. Gleiche Eingaben, gleiche Farbe."""
    from services.shop_motifs import relative_luminance

    order = [*inks_for_garment(rules, garment_color), color_of(rules), *rules["colors"]]
    candidates = list({color["key"]: color for color in order}.values())
    measured = [(color, contrast_ratio(relative_luminance(color["hex"]) or 0.0, luminance)) for color in candidates]
    for color, ratio in measured:
        if ratio >= MIN_INK_CONTRAST:
            return color
    return max(measured, key=lambda item: item[1])[0]


# ---------------------------------------------------------------- Text prüfen

def _is_emoji(char: str) -> bool:
    code = ord(char)
    return (code >= 0x1F000 or 0x2600 <= code <= 0x27BF or 0x2B00 <= code <= 0x2BFF or 0x2190 <= code <= 0x21FF
            or code in (0x200D, 0x20E3, 0xFE0E, 0xFE0F) or unicodedata.category(char) == "So")


def allowed_text(rules: dict) -> str:
    """„Buchstaben A–Z, Ziffern 0–9, Leerzeichen und ÄÖÜäöüß _ - .“ - für Hinweise und Ablehnungen."""
    extras = rules["allowed_chars"]
    parts = ["Buchstaben A–Z", "Ziffern 0–9"]
    if " " in extras:
        parts.append("Leerzeichen")
    rest = " ".join(char for char in extras if char != " ")
    return ", ".join(parts) + (f" und {rest}" if rest else "")


def clean_text(raw: Any, rules: dict) -> str:
    """Der Name, so wie er gedruckt wird - oder ``ShopError`` mit Begründung. Nennt nur die störenden Zeichen."""
    text = unicodedata.normalize("NFC", "" if raw is None else str(raw))
    if any(_is_emoji(char) for char in text):
        raise ShopError(f"Emojis und Symbole gehen im Druck nicht. Erlaubt sind {allowed_text(rules)}.")
    if any(unicodedata.category(char).startswith("C") for char in text):
        raise ShopError("Der Name enthält Steuerzeichen (etwa einen Tabulator oder Zeilenumbruch) - bitte nur "
                        "Leerzeichen zwischen den Wörtern.")
    text = re.sub(" {2,}", " ", text.strip(" "))
    if not text:
        raise ShopError("Der Name ist leer.")
    extras = rules["allowed_chars"]
    bad: list[str] = []
    for char in text:
        if not ((char.isascii() and char.isalnum()) or char in extras) and char not in bad:
            bad.append(char)
    if bad:
        shown = ", ".join(f"„{char}“" for char in bad[:5]) + (" …" if len(bad) > 5 else "")
        raise ShopError(f"Diese Zeichen gehen nicht: {shown}. Erlaubt sind {allowed_text(rules)}.")
    if len(text) < rules["min_length"]:
        raise ShopError(f"Der Name braucht mindestens {rules['min_length']} Zeichen.")
    if len(text) > rules["max_length"]:
        raise ShopError(f"Der Name hat {len(text)} Zeichen - erlaubt sind höchstens {rules['max_length']} Zeichen.")
    return text


# Vereinsnummer (#2142): nur Ziffern, höchstens so viele wie die größte Wunschnummer (``jersey_numbers.HIGHEST``, 9999).
DIGITS = "0123456789"
MAX_NUMBER_DIGITS = 4
# Fester Text (#2142), etwa der Vereinsname: Buchstaben A–Z, Ziffern und diese Zeichen - eine eigene feste Liste,
# unabhängig von den erlaubten Zeichen der Gamertag-Regeln (die Schrift kennt sie alle).
MAX_FIXED_TEXT = 40
FIXED_TEXT_CHARS = "".join(sorted(set(" .,-_&'!?:/#+()ÄÖÜäöüß"), key=ord))
# Was gerendert wird: ein Name (Gamertag), eine Nummer (nur Ziffern, Leinwand so hoch wie die Ziffern) oder ein fester
# Text der Grunddatei.
RENDER_KINDS = ("gamertag", "number", "text")


def clean_number(raw: Any) -> str:
    """Eine Vereinsnummer, wie sie gedruckt wird: nur Ziffern 0–9."""
    text = unicodedata.normalize("NFC", "" if raw is None else str(raw)).strip()
    if not text:
        raise ShopError("Die Nummer ist leer.")
    if any(char not in DIGITS for char in text):
        raise ShopError("Die Nummer: nur Ziffern 0–9.")
    if len(text) > MAX_NUMBER_DIGITS:
        raise ShopError(f"Die Nummer hat höchstens {MAX_NUMBER_DIGITS} Ziffern.")
    return text


def clean_fixed_text(raw: Any, rules: dict | None = None) -> str:
    """Ein fester Text (#2142) wie der Vereinsname - geprüft wie ein Name, aber ohne Wortfilter und Mindestlänge (er
    kommt von den Finanzen, nicht aus der Bestellung). Nennt nur die störenden Zeichen."""
    text = unicodedata.normalize("NFC", "" if raw is None else str(raw))
    if any(_is_emoji(char) for char in text):
        raise ShopError("Fester Text: Emojis und Symbole gehen im Druck nicht.")
    if any(unicodedata.category(char).startswith("C") for char in text):
        raise ShopError("Fester Text: bitte ohne Steuerzeichen (etwa Tabulator oder Zeilenumbruch).")
    text = re.sub(" {2,}", " ", text.strip(" "))
    if not text:
        raise ShopError("Der feste Text ist leer.")
    extras = FIXED_TEXT_CHARS
    bad: list[str] = []
    for char in text:
        if not ((char.isascii() and char.isalnum()) or char in extras) and char not in bad:
            bad.append(char)
    if bad:
        shown = ", ".join(f"„{char}“" for char in bad[:5]) + (" …" if len(bad) > 5 else "")
        rest = " ".join(char for char in extras if char != " ")
        raise ShopError(f"Fester Text: diese Zeichen gehen nicht: {shown}. Erlaubt sind Buchstaben A–Z, Ziffern 0–9, "
                        f"Leerzeichen und {rest}")
    if len(text) > MAX_FIXED_TEXT:
        raise ShopError(f"Fester Text: höchstens {MAX_FIXED_TEXT} Zeichen.")
    return text


def _clean_for(kind: str, raw: Any, rules: dict) -> str:
    if kind == "number":
        return clean_number(raw)
    if kind == "text":
        return clean_fixed_text(raw, rules)
    return clean_text(raw, rules)


# ---------------------------------------------------------------- Renderer

@lru_cache(maxsize=8)
def _font_bytes(file_name: str) -> bytes:
    """Die Schrift einmal in den Speicher - danach rendert nichts mehr von der Platte."""
    return (FONT_DIR / file_name).read_bytes()


@lru_cache(maxsize=64)
def _font(key: str, size: int) -> ImageFont.FreeTypeFont:
    spec = FONTS[key]
    font = ImageFont.truetype(BytesIO(_font_bytes(spec["file"])), size)
    if spec["weight"]:
        font.set_variation_by_axes([spec["weight"]])
    return font


def _cap_px(font: ImageFont.FreeTypeFont) -> int:
    return -font.getbbox("H", anchor="ls")[1]


@lru_cache(maxsize=16)
def _cap_ratio(key: str) -> float:
    return _cap_px(_font(key, 1000)) / 1000


def _font_px(rules: dict, height_in: float) -> int:
    target = height_in * rules["dpi"]
    if rules["height_mode"] == "cap":
        target /= _cap_ratio(rules["font"])
    return max(4, round(target))


def _text_width(key: str, size: int, text: str) -> tuple[int, int]:
    left, _top, right, _bottom = _font(key, size).getbbox(text, anchor="ls")
    return right - left, left


def _height_in(rules: dict, size: int) -> float:
    pixels = _cap_px(_font(rules["font"], size)) if rules["height_mode"] == "cap" else size
    return pixels / rules["dpi"]


@dataclass(frozen=True)
class Rendered:
    text: str
    payload: bytes
    sha256: str
    meta: dict


def _stroke_px(rules: dict) -> int:
    """Stärke der Kontur in Pixeln der Datei (#2142) - 0 ohne Kontur."""
    return int(round(rules["outline_in"] * rules["dpi"])) if rules.get("outline_in") else 0


def _digit_band(font: ImageFont.FreeTypeFont) -> tuple[int, int]:
    """Wie weit die Ziffern über und unter die Grundlinie reichen - die Leinwand einer Nummer ist nur so hoch."""
    _left, top, _right, bottom = font.getbbox(DIGITS, anchor="ls")
    return -top, max(0, bottom)


def canvas(rules: dict, kind: str = "gamertag") -> tuple[int, int]:
    """Breite und Höhe der Leinwand in Pixeln - für jeden Namen gleich (Höchstbreite × Höhe bei voller Texthöhe). Eine
    Nummer (#2142, nur Ziffern) braucht keinen Platz für Akzente und Unterlängen: ihre Leinwand ist so hoch wie die
    Ziffern. Eine Kontur kommt oben und unten dazu."""
    size = _font_px(rules, rules["text_height_in"])
    font = _font(rules["font"], size)
    stroke = _stroke_px(rules)
    if kind == "number":
        up, down = _digit_band(font)
        half = math.ceil((up + down) / 2) + PAD_PX + stroke
    else:
        ascent, descent = font.getmetrics()
        cap = _cap_px(font)
        half = math.ceil(max(ascent - cap / 2, descent + cap / 2)) + PAD_PX + stroke
    return round(rules["max_width_in"] * rules["dpi"]), 2 * half


def canvas_problem(rules: dict, kind: str = "gamertag") -> str | None:
    """Zu viele Pixel für eine Datei? Die Fläche begrenzt die Größe, aber eine 300-DPI-Leinwand wächst schnell."""
    width, height = canvas(rules, kind)
    if width * height <= MAX_CANVAS_PIXELS:
        return None
    return (f"Die Datei dieser Ebene hätte {width} × {height} px ({rules['dpi']} DPI) - mehr als "
            f"{MAX_CANVAS_PIXELS // 1_000_000} Millionen Pixel. Bitte Texthöhe oder Höchstbreite kleiner wählen.")


NOUNS = {"gamertag": ("Der Name", "er", "einen kürzeren Namen"),
         "number": ("Die Nummer", "sie", "eine kleinere Texthöhe"),
         "text": ("Der Text", "er", "einen kürzeren Text oder eine größere Höchstbreite")}


def _too_wide(rules: dict, width_px: int, kind: str = "gamertag") -> str:
    noun, pronoun, advice = NOUNS.get(kind, NOUNS["gamertag"])
    return (f"{noun} ist zu breit: auch bei {shop_designs.inches(rules['min_text_height_in'])} Texthöhe wird "
            f"{pronoun} {shop_designs.inches(math.ceil(width_px / rules['dpi'] * 100) / 100)} breit, erlaubt sind "
            f"{shop_designs.inches(rules['max_width_in'])}. Bitte {advice} wählen.")


def outline_color(rules: dict, fill: dict) -> dict:
    """Die Farbe der Kontur: fest gewählt (``outline_color``), sonst die Farbe der Regeln mit dem höchsten Kontrast zur
    Schrift - bei gleichem Kontrast die erste. Gibt es die feste Farbe nicht mehr, gilt wieder automatisch."""
    from services.shop_motifs import relative_luminance

    wanted = rules.get("outline_color")
    for color in rules["colors"]:
        if color["key"] == wanted:
            return color
    fill_luminance = relative_luminance(fill["hex"]) or 0.0
    return max(rules["colors"],
               key=lambda color: contrast_ratio(relative_luminance(color["hex"]) or 0.0, fill_luminance))


def _rgb(hex_value: str) -> tuple[int, int, int]:
    red, green, blue = (int(hex_value[index:index + 2], 16) for index in (1, 3, 5))
    return red, green, blue


def _fit(rules: dict, text: str, kind: str = "gamertag") -> tuple[int, int, int]:
    """Die Schriftgröße, mit der der Text in die Höchstbreite passt (bis zur Mindesthöhe verkleinert) - dieselbe
    Rechnung für das Rendern und die Prüfung beim Speichern (``fit_problem``). Liefert Größe, Breite und linken Rand."""
    key = rules["font"]
    width_px = canvas(rules, kind)[0]
    stroke = _stroke_px(rules)
    room = width_px - 2 * stroke  # die Kontur liegt außen um die Schrift - sie muss mit in die Höchstbreite
    full = _font_px(rules, rules["text_height_in"])
    smallest = min(full, _font_px(rules, rules["min_text_height_in"]))
    size = full
    ink, left = _text_width(key, size, text)
    if ink > room:
        size = min(full - 1, int(full * room / ink))
        while size >= smallest:
            ink, left = _text_width(key, size, text)
            if ink <= room:
                break
            size -= 1
        if size < smallest:
            raise ShopError(_too_wide(rules, _text_width(key, smallest, text)[0] + 2 * stroke, kind))
    return size, ink, left


def widest_text(rules: dict, kind: str, digits: int = MAX_NUMBER_DIGITS) -> str:
    """Der breiteste erlaubte Text einer Ebene (#2142): beim Namen ``W`` in Höchstlänge der Gamertag-Regeln, bei der
    Nummer die breiteste Ziffer der Schrift so oft, wie die höchste Wunschnummer Stellen hat."""
    if kind == "number":
        size = _font_px(rules, rules["text_height_in"])
        widest = max(DIGITS, key=lambda digit: (_text_width(rules["font"], size, digit)[0], digit))
        return widest * max(1, digits)
    return "W" * rules["max_length"]


def fit_problem(rules: dict, text: str, kind: str = "gamertag") -> str | None:
    """Passt dieser Text mit den Regeln der Ebene - Leinwand nicht zu groß, Breite bis zur Mindesthöhe? Sonst der Satz,
    warum nicht. Rechnet nur Maße, rendert kein Bild."""
    problem = canvas_problem(rules, kind)
    if problem:
        return problem
    try:
        _fit(rules, text, kind)
    except ShopError as exc:
        return str(exc)
    return None


def render(raw: Any, rules: dict, *, color_key: str | None = None, kind: str = "gamertag") -> Rendered:
    """Prüft den Text und liefert das fertige PNG mit Maßen - **ohne Wortfilter** (der braucht die Datenbank). Von
    außen deshalb nie direkt aufrufen, sondern ``preview`` oder ``store``: die prüfen beides. ``kind`` (#2142):
    ``gamertag`` (Name), ``number`` (Vereinsnummer, nur Ziffern) oder ``text`` (fester Text der Grunddatei)."""
    if kind not in RENDER_KINDS:
        raise ShopError("Unbekannte Art des Texts.")
    text = _clean_for(kind, raw, rules)
    color = color_of(rules, color_key)
    problem = canvas_problem(rules, kind)
    if problem:
        raise ShopError(problem)
    key, dpi = rules["font"], rules["dpi"]
    width_px, height_px = canvas(rules, kind)
    stroke = _stroke_px(rules)
    full = _font_px(rules, rules["text_height_in"])
    size, ink, left = _fit(rules, text, kind)
    font = _font(key, size)
    anchor_y = height_px / 2
    if kind == "number":
        up, down = _digit_band(font)
        baseline = anchor_y + (up - down) / 2
    else:
        baseline = anchor_y + _cap_px(font) / 2
    if rules["align"] == "left":
        x = -left + stroke
    elif rules["align"] == "right":
        x = width_px - ink - left - stroke
    else:
        x = (width_px - ink) / 2 - left
    mask = Image.new("L", (width_px, height_px), 0)
    ImageDraw.Draw(mask).text((x, baseline), text, font=font, fill=255, anchor="ls")
    outline = None
    if stroke:
        outline = Image.new("L", (width_px, height_px), 0)
        ImageDraw.Draw(outline).text((x, baseline), text, font=font, fill=255, anchor="ls", stroke_width=stroke,
                                     stroke_fill=255)
    box = (outline or mask).getbbox()
    if box and (box[1] <= 0 or box[3] >= height_px):  # pragma: no cover - Schutz, falls eine Schrift ausreißt
        raise ShopError("Ein Zeichen ragt über die Druckdatei hinaus - bitte eine andere Schrift wählen.")
    red, green, blue = _rgb(color["hex"])
    # Farbe überall, Deckkraft aus der Maske: so entstehen keine dunklen Ränder an den Kanten.
    img = Image.new("RGBA", (width_px, height_px), (red, green, blue, 0))
    img.putalpha(mask)
    stroke_color = None
    if outline is not None:
        # Die Kontur darunter, die Schrift darüber - beide mit Farbe überall und Deckkraft aus ihrer Maske.
        stroke_color = outline_color(rules, color)
        under = Image.new("RGBA", (width_px, height_px), (*_rgb(stroke_color["hex"]), 0))
        under.putalpha(outline)
        img = Image.alpha_composite(under, img)
    payload = shop_designs.png_bytes(img, dpi)
    height_in = _height_in(rules, size)
    scaled = size < full
    measures = {
        "text_height": shop_designs.inches(height_in),
        "text_width": shop_designs.inches(ink / dpi),
        "max_width": shop_designs.inches(rules["max_width_in"]),
        "canvas": f"{shop_designs.inches(width_px / dpi)} × {shop_designs.inches(height_px / dpi)}",
    }
    noun = NOUNS[kind][0]
    notice = (f"Auf {measures['text_height']} Texthöhe verkleinert, damit {noun[0].lower() + noun[1:]} in "
              f"{measures['max_width']} passt." if scaled else None)
    meta = {
        "width_px": width_px, "height_px": height_px, "dpi": dpi,
        "print_width_in": round(width_px / dpi, 3), "print_height_in": round(height_px / dpi, 3),
        "text_height_in": round(height_in, 3), "text_width_in": round(ink / dpi, 3),
        "scaled": scaled, "notice": notice, "font": key, "font_px": size, "align": rules["align"],
        "color_key": color["key"], "color_hex": color["hex"],
        "anchor_x_px": width_px / 2, "anchor_y_px": anchor_y,
        "anchor_x_in": round(width_px / 2 / dpi, 3), "anchor_y_in": round(anchor_y / dpi, 3),
        "length": len(text), "rules_hash": rules_hash(rules), "measures": measures,
    }
    if kind != "gamertag":
        meta["kind"] = kind
    if stroke_color is not None:
        meta.update(outline_px=stroke, outline_key=stroke_color["key"], outline_hex=stroke_color["hex"])
    return Rendered(text=text, payload=payload, sha256=hashlib.sha256(payload).hexdigest(), meta=meta)


# ---------------------------------------------------------------- Rendern außerhalb der Ereignisschleife (#2142)

# Eine große Leinwand (Rückennummer, Trikot-Name) kostet Rechenzeit. Alle Text-Renderings - Bestelldatei, Grunddatei,
# Beispiel und Vorschau - teilen sich darum wenige Plätze je Prozess und laufen in einem Thread (wie
# ``shop_motifs.pair_semaphore``).
RENDER_SLOTS = 2
RENDER_WAIT_SECONDS = 20.0
RENDER_BUSY = "Gerade werden viele Texte gerendert - bitte gleich noch einmal."
_RENDER_SLOTS: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = weakref.WeakKeyDictionary()


class RenderBusy(ShopError):
    status = 429


def render_semaphore() -> asyncio.Semaphore:
    """Die Plätze fürs Rendern - je Ereignisschleife einer (ein Semaphor gehört zu genau einer)."""
    loop = asyncio.get_running_loop()
    slot = _RENDER_SLOTS.get(loop)
    if slot is None:
        slot = _RENDER_SLOTS[loop] = asyncio.Semaphore(RENDER_SLOTS)
    return slot


async def render_async(raw: Any, rules: dict, *, color_key: str | None = None, kind: str = "gamertag",
                       wait: float | None = None) -> Rendered:
    """``render`` in einem Thread, mit einem der gemeinsamen Plätze. ``wait``: so lange höchstens warten (Vorschau),
    sonst ``RenderBusy``; ohne Angabe wird gewartet (Bestellung, Grunddatei)."""
    slot = render_semaphore()
    if wait is None:
        await slot.acquire()
    else:
        try:
            await asyncio.wait_for(slot.acquire(), timeout=wait)
        except asyncio.TimeoutError:
            raise RenderBusy(RENDER_BUSY) from None
    try:
        return await asyncio.to_thread(render, raw, rules, color_key=color_key, kind=kind)
    finally:
        slot.release()


def preview_rules(rules: dict, dpi: int = 100) -> dict:
    """Dieselben Regeln mit der Auflösung einer Vorschau (#2142): Beispiele und Vorschaubilder brauchen keine 300 DPI.
    Maße in Zoll bleiben gleich - nur die Pixel werden weniger."""
    return {**rules, "dpi": min(int(rules["dpi"]), dpi)}


# ---------------------------------------------------------------- Regeln speichern (Finanzen, mit Grund)

SETTINGS_ID = "shop_gamertag"


async def load_rules(db) -> dict:
    """Die geltenden Regeln - gespeichert oder Vorgabe. Unsinn in der Datenbank gilt als Vorgabe (laut im Log, ohne
    Inhalt)."""
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    if not doc.get("rules"):
        return clean_rules({})
    try:
        return clean_rules(doc["rules"])
    except ShopError:
        logger.warning("[shop-gamertag] stored rules invalid - defaults apply")
        return clean_rules({})


async def _placement_problem(db, rules: dict) -> str | None:
    """Passt die Leinwand in den Druckbereich der Platzierung (#1708, Brust links – Namensfeld)?"""
    spec = (await shop_designs.placement_specs(db))[rules["placement"]]
    width_px, height_px = canvas(rules)
    if rules["max_width_in"] > spec["area_width_in"] + 1e-6:
        return (f"Die Höchstbreite ({shop_designs.inches(rules['max_width_in'])}) ist breiter als der Druckbereich "
                f"„{spec['label']}“ ({spec['area_width']}).")
    if height_px / rules["dpi"] > spec["area_height_in"] + 1e-6:
        return (f"Die Druckdatei wird {shop_designs.inches(height_px / rules['dpi'])} hoch - höher als der "
                f"Druckbereich „{spec['label']}“ ({spec['area_height']}).")
    return None


async def save_rules(db, fields: dict, *, actor_id: str, reason: Any) -> tuple[dict, list[str]]:
    """Regeln ändern - mit Grund, vorher/nachher im Protokoll (``shop.gamertag.rules``). Gespeicherte Dateien behalten
    ihre Maße: eine neue Regel ergibt beim nächsten Rendern eine neue Datei."""
    reason = clean_reason(reason)
    current = await load_rules(db)
    after = clean_rules({**current, **fields})
    problem = await _placement_problem(db, after)
    if problem:
        raise ShopError(problem)
    changed = sorted(name for name in RULE_FIELDS if after[name] != current[name])
    if not changed:
        return current, []
    await db.settings.update_one(
        {"id": SETTINGS_ID},
        {"$set": {"id": SETTINGS_ID, "rules": after, "updated_at": now_utc().isoformat(), "updated_by": actor_id}},
        upsert=True)
    await record_admin_action(db, "shop.gamertag.rules", actor_id=actor_id, target_id=SETTINGS_ID, reason=reason,
                              data={"before": {name: current[name] for name in changed},
                                    "after": {name: after[name] for name in changed}})
    return after, changed


# ---------------------------------------------------------------- Wortfilter, Vorschau, Ablage

FILTERED = "Der Name enthält ein Wort, das hier nicht erlaubt ist (Wortfilter der Moderation)."


async def check_words(db, text: str, rules: dict) -> list[str]:
    """Der Wortfilter der Moderation vor dem Rendern: „zurückhalten“ lehnt immer ab, „markieren“ je nach Regel
    (Vorgabe: auch ablehnen - ein Druck lässt sich nicht zurücknehmen). Legt keinen Fund an."""
    from services import word_filter

    verdict = (await word_filter.check_text(db, text))["action"]
    if verdict == "hold" or (verdict == "flag" and rules["block_flagged"]):
        raise ShopError(FILTERED)
    if verdict == "flag":
        return ["Der Wortfilter der Moderation markiert ein Wort in diesem Namen - bitte prüfen."]
    return []


async def _rendered(db, raw: Any, color_key: str | None, layer: dict | None = None) -> tuple[Rendered, list[str], dict]:
    rules = layer_rules(await load_rules(db), layer)
    warnings = await check_words(db, clean_text(raw, rules), rules)
    return await render_async(raw, rules, color_key=color_key), warnings, rules


async def preview(db, raw: Any, *, color_key: str | None = None) -> dict:
    """Die Druckdatei zum Ansehen - geprüft und gerendert wie beim Speichern, aber nichts wird abgelegt."""
    rendered, warnings, _rules = await _rendered(db, raw, color_key)
    image = "data:image/png;base64," + base64.b64encode(rendered.payload).decode("ascii")
    return {"text": rendered.text, "image": image, "sha256": rendered.sha256, "meta": rendered.meta,
            "warnings": warnings}


PURPOSES = ("test", "order")
FILE_FIELDS = ("width_px", "height_px", "dpi", "print_width_in", "print_height_in", "text_height_in", "text_width_in",
               "scaled", "font", "align", "color_key", "color_hex", "anchor_x_in", "anchor_y_in", "anchor_y_px",
               "rules_hash")


async def _reuse_test_file(db, sha256: str) -> dict | None:
    """Dieselbe Testdatei gibt es schon: zuletzt benutzt vermerken und sie liefern. Nur Testdateien werden geteilt -
    nie mit einer Bestelldatei."""
    row = await db.shop_gamertag_files.find_one({"purpose": "test", "sha256": sha256}, {"_id": 0})
    if row is None:
        return None
    used = now_utc().isoformat()
    await db.shop_gamertag_files.update_one({"id": row["id"]}, {"$set": {"last_used_at": used}})
    return {**row, "last_used_at": used}


STORE_KINDS = ("gamertag", "number")


async def store(db, raw: Any, *, purpose: str, color_key: str | None = None, actor_id: str | None = None,
                reason: Any = None, user_id: str | None = None, order_id: str | None = None,
                order_item_id: str | None = None, layer: dict | None = None, kind: str = "gamertag") -> dict:
    """Prüfen, rendern, ablegen. ``purpose``:

    - ``test``: Admin, mit Person und Grund im Protokoll. Gleiche Testdatei = dieselbe Zeile und Adresse.
    - ``order`` (für #1712/#1713): **immer eine eigene Datei mit eigener Adresse**, auch bei gleichem Namen - nie
      geteilt, weder mit einer anderen Bestellung noch mit einer Testdatei. Sie gehört zu einem Konto (``user_id``)
      und, sobald bekannt, zu Bestellung und Position; das PNG zeigt den Namen, die Zeile ist personenbezogen.

    ``layer`` (#2105): Texthöhe und Höchstbreite der Ebene in cm (``layer_rules``) - ohne Angabe die globalen Regeln.
    ``kind = "number"`` (#2150): die Vereinsnummer - nur als Bestelldatei, nur Ziffern, ohne Wortfilter; die Zeile trägt
    ``kind = "number"`` und ist personenbezogen wie eine Gamertag-Datei (Löschen, Auskunft)."""
    if purpose not in PURPOSES:
        raise ShopError("Unbekannter Zweck der Druckdatei.")
    if kind not in STORE_KINDS:
        raise ShopError("Unbekannte Art der Druckdatei.")
    if kind == "number" and purpose != "order":
        raise ShopError("Eine Nummerndatei gibt es nur für eine Bestellung.")
    if purpose == "test":
        reason = clean_reason(reason)
        if not actor_id:
            raise ShopError("Ohne Person keine Testdatei.")
    elif not user_id:
        raise ShopError("Eine Bestelldatei gehört zu einem Konto.")
    if kind == "number":
        # Eine Nummer kommt vom Server (Wunschnummer), nie aus einer Eingabe - kein Wortfilter; Größe und Lage prüft der
        # Plan der Druckfläche.
        rules = layer_rules(await load_rules(db), layer)
        rendered, warnings = await render_async(raw, rules, color_key=color_key, kind="number"), []
    else:
        rendered, warnings, rules = await _rendered(db, raw, color_key, layer)
    # Mit eigener Größe, Schrift oder Kontur der Ebene (#2105, #2142) prüft der Plan der Druckfläche, ob der Name
    # hineinpasst - nicht das alte Namensfeld aus #1708.
    problem = (None if kind == "number" or has_own_settings(layer, rules)
               else await _placement_problem(db, rules))
    if problem:
        raise ShopError(problem)
    row = await _reuse_test_file(db, rendered.sha256) if purpose == "test" else None
    created = row is None
    if row is None:
        file_ref, path = shop_designs._store(rendered.payload)
        now = now_utc().isoformat()
        row = {"id": new_id(), "origin": "gamertag", "purpose": purpose, "sha256": rendered.sha256,
               "file_ref": file_ref, "public_id": secrets.token_urlsafe(32), "content_type": "image/png",
               "size_bytes": len(rendered.payload), "placement": rules["placement"],
               **{name: rendered.meta[name] for name in FILE_FIELDS},
               "user_id": user_id if purpose == "order" else None,
               "order_id": order_id if purpose == "order" else None,
               "order_item_id": order_item_id if purpose == "order" else None,
               "created_at": now, "created_by": actor_id if purpose == "test" else None, "last_used_at": now}
        if kind == "number":
            row["kind"] = "number"  # Gamertag-Zeilen bleiben ohne Feld - wie vor #2150
        try:
            await db.shop_gamertag_files.insert_one(dict(row))
        except DuplicateKeyError:  # gleichzeitig dieselbe Testdatei - die andere gilt
            path.unlink(missing_ok=True)
            if purpose != "test":
                raise
            created = False
            row = await _reuse_test_file(db, rendered.sha256)
        except BaseException:
            path.unlink(missing_ok=True)  # keine Datei ohne Zeile
            raise
    if purpose == "test":
        await record_admin_action(db, "shop.gamertag.file", actor_id=actor_id, target_id=row["id"], reason=reason,
                                  data={"sha256": row["sha256"], "new": created, "width_px": row["width_px"],
                                        "height_px": row["height_px"], "dpi": row["dpi"],
                                        "color_key": row["color_key"], "scaled": row["scaled"]})
    return {"row": row, "text": rendered.text, "warnings": warnings, "created": created}


def frozen_for_order(row: dict, text: str) -> dict:
    """Was eine Bestellposition einfriert (#1712/#1713): der bestätigte Name und die Datei mit Prüfsumme, Maßen und
    Anker. Spätere Regeln oder Profiländerungen in Dolibarr ändern daran nichts - die Datei bleibt liegen."""
    return {"gamertag": text,
            "gamertag_file": {"file_id": row["id"], "sha256": row["sha256"], "rules_hash": row["rules_hash"],
                              "width_px": row["width_px"], "height_px": row["height_px"], "dpi": row["dpi"],
                              "print_width_in": row["print_width_in"], "print_height_in": row["print_height_in"],
                              "anchor_y_in": row["anchor_y_in"], "color_key": row["color_key"],
                              "placement": row["placement"]}}


def file_view(row: dict) -> dict:
    view = {name: row.get(name) for name in ("id", "origin", "purpose", "sha256", "created_at", "last_used_at",
                                             *FILE_FIELDS)}
    view["sha256_short"] = str(row.get("sha256") or "")[:12]
    view["file_name"] = shop_designs.file_name(row)
    view["public_path"] = shop_designs.public_path(row)
    view["public_url"] = shop_designs.public_url(row)
    view["measures"] = {"text_height": shop_designs.inches(row["text_height_in"]),
                        "canvas": f"{shop_designs.inches(row['print_width_in'])} × "
                                  f"{shop_designs.inches(row['print_height_in'])}"}
    return view


def band_px(rules: dict, kind: str = "gamertag") -> float:
    """Das sichtbare Band bei voller Texthöhe in Pixeln der Datei (#2142): bei Namen und Texten die Großbuchstaben, bei
    einer Nummer die Ziffern - mittig in der Leinwand. Daran misst „Abstand zur Ebene darüber“."""
    font = _font(rules["font"], _font_px(rules, rules["text_height_in"]))
    if kind == "number":
        up, down = _digit_band(font)
        return float(up + down)
    return float(_cap_px(font))


def font_metrics(rules: dict) -> dict:
    """Je Schrift (#2142): wie hoch die Leinwand wird - je Zoll Texthöhe (``name``, ``number``: Steigung) plus ein fester
    Rest (``name_offset``, ``number_offset`` in Zoll: der Rand ``PAD_PX``) - und das sichtbare Band je Zoll Texthöhe
    (``band_name``, ``band_number``). Damit rechnen die Vorschau in Schritt 3 und die Grenze der Fläche
    (``shop_products._text_bounds``); exakt rechnet der Server (``canvas``, ``band_px``). Eine Kontur kommt oben und
    unten dazu."""
    out = {}
    for key in FONTS:
        own = {**rules, "font": key}
        dpi = own["dpi"]
        entry = {}
        for kind, name in (("gamertag", "name"), ("number", "number")):
            low = canvas({**own, "text_height_in": 1.0}, kind)[1] / dpi
            high = canvas({**own, "text_height_in": 2.0}, kind)[1] / dpi
            entry[name] = round(high - low, 4)
            entry[f"{name}_offset"] = round(low - (high - low), 4)
        per = dpi * own["text_height_in"]
        entry.update(band_name=round(band_px(own) / per, 4), band_number=round(band_px(own, "number") / per, 4))
        out[key] = entry
    return out

async def admin_view(db) -> dict:
    rules = await load_rules(db)
    width_px, height_px = canvas(rules)
    spec = (await shop_designs.placement_specs(db))[rules["placement"]]
    files = await db.shop_gamertag_files.find({"purpose": "test"}, {"_id": 0}).sort("last_used_at", -1).to_list(20)
    return {
        "rules": rules, "defaults": default_rules(), "allowed_text": allowed_text(rules),
        "fonts": [{"key": key, "label": font["label"], "license": f"SIL Open Font License 1.1 ({font['license']})"}
                  for key, font in FONTS.items()],
        "height_modes": [{"key": key, "label": label} for key, label in HEIGHT_MODES.items()],
        "aligns": [{"key": key, "label": label} for key, label in ALIGNS.items()],
        "placements": [{"key": key, "label": label} for key, label in shop_designs.PLACEMENT_LABELS.items()],
        "placement": spec,
        "canvas": {"width_px": width_px, "height_px": height_px, "dpi": rules["dpi"],
                   "size": f"{shop_designs.inches(width_px / rules['dpi'])} × "
                           f"{shop_designs.inches(height_px / rules['dpi'])}",
                   "anchor_y_in": round(height_px / 2 / rules["dpi"], 3)},
        "limits": {"min_dpi": MIN_DPI, "max_dpi": MAX_DPI, "min_height_in": MIN_HEIGHT_IN,
                   "max_height_in": MAX_HEIGHT_IN, "min_width_in": MIN_WIDTH_IN, "max_width_in": MAX_WIDTH_IN,
                   "max_length": MAX_LENGTH_LIMIT, "max_colors": MAX_COLORS},
        "test_files": [file_view(row) for row in files],
    }


# ---------------------------------------------------------------- Aufbewahrung (nur Bericht)

TEST_GRACE_DAYS = 30


async def retention_plan(db, *, now: datetime | None = None) -> dict:
    """Welche Dateien weg dürften - nur ein Bericht, er löscht nichts. Testdateien, die 30 Tage nicht benutzt wurden
    und keine Bestellung brauchen (``purpose`` bleibt dann ``test``). Bestelldateien regelt #1731."""
    now = now or now_utc()
    may_delete, kept = [], 0
    async for row in db.shop_gamertag_files.find({}, {"_id": 0}):
        used = datetime.fromisoformat(row.get("last_used_at") or row["created_at"])
        if row.get("purpose") == "test" and now - used >= timedelta(days=TEST_GRACE_DAYS):
            may_delete.append({"id": row["id"], "sha256": row["sha256"], "purpose": "test",
                               "last_used_at": row.get("last_used_at")})
        else:
            kept += 1
    return {"may_delete": may_delete, "kept": kept, "grace_days": TEST_GRACE_DAYS}


# ---------------------------------------------------------------- Kontolöschung: Bestelldateien zeigen den Namen

# Stände, in denen Printful nichts mehr produziert. Die Statusmaschine (#1716) liefert die endgültige Liste; bis dahin
# gilt eine Bestellung mit Printful-Auftrag und einem anderen Stand als offen.
CLOSED_ORDER_STATES = ("cancelled", "canceled", "shipped", "delivered", "fulfilled", "completed", "archived")


async def _needed_for_production(db, row: dict) -> bool:
    if not row.get("order_id"):
        return False
    order = await db.shop_orders.find_one({"id": row["order_id"]}, {"_id": 0, "printful_order_id": 1, "status": 1})
    return bool(order and order.get("printful_order_id") and order.get("status") not in CLOSED_ORDER_STATES)


# Was sich aus dem Inhalt der Datei ableiten lässt (#2150): ``render`` ist deterministisch - aus Prüfsumme, Dateigröße,
# Textbreite oder (bei verkleinertem Text) Texthöhe ließe sich ein Name bzw. eine der höchstens 10.000 Nummern durch
# Durchprobieren zurückrechnen. Nach dem Löschen bleibt nur: Datei war da (Kennung, Zweck, Art, Maße der Leinwand nach
# den Regeln, Farbe, Bestellung) und wurde am … gelöscht.
CONTENT_FIELDS = ("sha256", "size_bytes", "text_width_in", "text_height_in", "scaled")


async def _take_off_line(db, row: dict, now: str) -> None:
    """Adresse abschalten (404) und die Datei löschen; die Zeile bleibt als Nachweis ohne Konto - ohne alles, was aus dem
    Inhalt ableitbar ist (``CONTENT_FIELDS``, #2150)."""
    path = shop_designs._path_of(row.get("file_ref"))
    if path is not None:
        path.unlink(missing_ok=True)
    await db.shop_gamertag_files.update_one(
        {"id": row["id"]},
        {"$set": {"public_disabled_at": now, "file_deleted_at": now, "user_id": None},
         "$unset": {"erase_pending_at": "", **{name: "" for name in CONTENT_FIELDS}}})


async def erase_for_user(db, user_id: str) -> dict:
    """Kontolöschung (``dsgvo_routes._anonymize_user_data``): jede Bestelldatei des Kontos verliert die Verknüpfung.
    Braucht ein offener Printful-Auftrag sie nicht (mehr), ist die Adresse sofort aus und die Datei gelöscht. Sonst
    bleibt sie nur für diesen Auftrag abrufbar (``erase_pending_at``), bis ``complete_pending_erasures`` sie nach dem
    Abschluss abschaltet und löscht. Testdateien der Finanzen haben kein Konto und bleiben."""
    now = now_utc().isoformat()
    removed = pending = 0
    rows = await db.shop_gamertag_files.find({"user_id": user_id, "purpose": "order"}, {"_id": 0}).to_list(None)
    for row in rows:
        if await _needed_for_production(db, row):
            await db.shop_gamertag_files.update_one({"id": row["id"]},
                                                    {"$set": {"erase_pending_at": now, "user_id": None}})
            pending += 1
        else:
            await _take_off_line(db, row, now)
            removed += 1
    return {"removed": removed, "pending": pending}


async def discard_order_files(db, order_id: str) -> int:
    """Eine Bestellung kam nicht zustande (#2069: ein gleichzeitiger Aufruf hat gewonnen, eine spätere Position ist
    nicht bestellbar): ihre Bestelldateien mit Zeile und Datei wieder weg - nie eine Testdatei."""
    removed = 0
    rows = await db.shop_gamertag_files.find({"order_id": order_id, "purpose": "order"}, {"_id": 0}).to_list(None)
    for row in rows:
        path = shop_designs._path_of(row.get("file_ref"))
        if path is not None:
            path.unlink(missing_ok=True)
        await db.shop_gamertag_files.delete_one({"id": row["id"]})
        removed += 1
    return removed


async def complete_pending_erasures(db) -> int:
    """Für den täglichen Job ``ops_retention``: vorgemerkte Bestelldateien abschalten und löschen, sobald kein offener
    Printful-Auftrag sie mehr braucht. Liefert die Zahl."""
    now = now_utc().isoformat()
    done = 0
    rows = await db.shop_gamertag_files.find({"erase_pending_at": {"$exists": True}}, {"_id": 0}).to_list(None)
    for row in rows:
        if not await _needed_for_production(db, row):
            await _take_off_line(db, row, now)
            done += 1
    return done


# ---------------------------------------------------------------- Größenlimit am Eingang

BODY_LIMIT_BYTES = 8 * 1024        # Vorschau und Testdatei: ein Name, eine Farbe, ein Grund
RULES_BODY_LIMIT_BYTES = 32 * 1024  # Regeln: bis zu zehn Farben mit ihren Shirtfarben


def body_limits() -> dict:
    """Für ``services/body_limits.BodySizeLimit``: die Gamertag-Routen nehmen nur kleine Anfragen an - vor dem Einlesen.
    nginx begrenzt dieselben Pfade zusätzlich (``frontend/nginx.conf``)."""
    def small() -> tuple[int, str]:
        return BODY_LIMIT_BYTES, "Anfrage zu groß (höchstens 8 KB)."

    def rules() -> tuple[int, str]:
        return RULES_BODY_LIMIT_BYTES, "Anfrage zu groß (höchstens 32 KB)."

    return {"/api/admin/shop/gamertag/preview": small, "/api/admin/shop/gamertag/test-files": small,
            "/api/admin/shop/gamertag/rules": rules}


# ---------------------------------------------------------------- Vorbelegung aus der Mitgliederakte

NO_LINK_REASONS = ("not_connected", "not_bound", "no_capability", "right_missing")


def _field_value(view: dict, code: str) -> str | None:
    for field in view.get("fields") or []:
        if isinstance(field, dict) and str(field.get("code")) == code:
            value = field.get("value")
            return str(value).strip() or None if isinstance(value, (str, int, float)) else None
    return None


async def _last_known(db, user: dict) -> dict | None:
    """Der zuletzt vom Abgleich übernommene Gamertag (``club_member_profiles``, #496) mit Datum."""
    from services import dolibarr_identity
    from services.dolibarr_client import load_settings

    access = await dolibarr_identity.access_for(db, await load_settings(db), user["id"])
    if not access:
        return None
    query: list[dict] = [{"user_id": user["id"]}]
    if access.get("member_id"):
        query.insert(0, {"dolibarr_member_id": int(access["member_id"])})
    profile = await db.club_member_profiles.find_one({"$or": query, "gamertag": {"$nin": [None, ""]}},
                                                     {"_id": 0, "gamertag": 1, "dolibarr_profile_at": 1,
                                                      "updated_at": 1})
    if not profile:
        return None
    return {"gamertag": profile["gamertag"], "as_of": profile.get("dolibarr_profile_at") or profile.get("updated_at")}


async def prefill_from_member_file(db, user: dict) -> dict:
    """Vorschlag für das Gamertag-Feld beim Kauf (#1712/#1713): der Gamertag aus dem Website-Profil der Mitgliederakte -
    nur mit bestätigter Zuordnung. Ist Dolibarr nicht erreichbar, der zuletzt bekannte Stand mit Datum. Liest nur:
    der Shop schreibt nie nach Dolibarr zurück, eine Änderung gilt nur für die eine Bestellung."""
    from services import dolibarr_self_service, dolibarr_sync

    view = await dolibarr_self_service.website_profile(db, user)
    out: dict[str, Any] = {"gamertag": None, "source": "none", "as_of": None, "valid": False, "problem": None,
                           "text": ""}
    if view.get("available") is False and view.get("reason") in NO_LINK_REASONS:
        out["text"] = ("Kein Vorschlag: das Konto ist nicht mit einem Mitgliedseintrag verbunden "
                       "(oder die Mitgliederverwaltung ist nicht angebunden).")
        return out
    if view.get("available") is False:
        known = await _last_known(db, user)
        if not known:
            out["text"] = "Die Mitgliederverwaltung antwortet gerade nicht, ein früherer Stand ist nicht bekannt."
            return out
        out.update(gamertag=known["gamertag"], source="last_known", as_of=known["as_of"],
                   text="Die Mitgliederverwaltung antwortet gerade nicht - das ist der zuletzt bekannte Stand.")
    else:
        code = (await dolibarr_sync.directory_field_map(db)).get("gamertag") or ""
        out.update(gamertag=_field_value(view, code), source="dolibarr", as_of=now_utc().isoformat(),
                   text="Aus deinem Website-Profil in der Mitgliederakte - du kannst ihn für diese Bestellung ändern.")
        if not out["gamertag"]:
            out["text"] = "Im Website-Profil ist kein Gamertag hinterlegt - bitte selbst eingeben."
    if out["gamertag"]:
        rules = await load_rules(db)
        try:
            await check_words(db, clean_text(out["gamertag"], rules), rules)
            out["valid"] = True
        except ShopError as exc:
            out["problem"] = str(exc)
    return out
