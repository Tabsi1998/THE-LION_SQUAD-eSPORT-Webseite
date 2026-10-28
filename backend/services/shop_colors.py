"""Farbnamen im Shop auf Deutsch (#2105) - an genau dieser Stelle.

Printful liefert die Farben englisch („Black“, „Sport Grey“, „Dark Heather“). **Intern bleibt der Printful-Name der
Schlüssel**: Varianten, Bestellungen, Druckdateien, Ausnahmen je Farbe und Testkennungen benutzen ihn weiter, es gibt
keine Datenänderung. Angezeigt wird überall die deutsche Bezeichnung:

1. **Tabelle** der gängigen Printful-Farben (``NAMES``), dann **wortweise** (``WORDS``, ``MODIFIERS``: „Dark Grey“ →
   „Dunkelgrau“, „Heather …“ → „… meliert“), zweifarbige Namen („Black/ White“) je Teil. Kennt die Übersetzung ein Wort
   nicht, bleibt der Printful-Name stehen - nie halb übersetzt.
2. **Je Produkt überschreibbar** in Schritt 2 (``offer.color_labels``: Printful-Name → eigene Bezeichnung, geprüft mit
   ``clean_labels``). ``label``/``labels_for``/``variant_label`` nehmen sie zuerst.
3. Für gespeicherte Bezeichnungen ohne Produkt (Bestellposition „Black / M“) übersetzt ``stored_label`` dieselbe Art.

Farbcodes für die eingefärbte Vorschau kommen nur aus den gespeicherten Printful-Daten (``codes_of``, ``hex_of``).
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable

from services.shop_common import ShopError

# Ganze Namen, wie Printful sie bei den gängigen Shirts, Hoodies und Kappen liefert (klein geschrieben).
NAMES = {
    "black": "Schwarz", "white": "Weiß", "navy": "Marineblau", "sport grey": "Sportgrau", "sport gray": "Sportgrau",
    "dark heather": "Dunkelgrau meliert", "heather": "Grau meliert", "athletic heather": "Sportgrau meliert",
    "black heather": "Schwarz meliert", "maroon": "Weinrot", "royal": "Königsblau", "royal blue": "Königsblau",
    "true royal": "Königsblau", "charcoal": "Anthrazit", "ash": "Aschgrau", "asphalt": "Asphaltgrau",
    "carolina blue": "Carolinablau", "irish green": "Irischgrün", "kelly green": "Kellygrün", "kelly": "Kellygrün",
    "military green": "Militärgrün", "army": "Armeegrün", "olive": "Olivgrün", "forest green": "Waldgrün",
    "forest": "Waldgrün", "natural": "Natur", "sand": "Sand", "tan": "Hellbraun", "cream": "Creme",
    "ivory": "Elfenbein", "dark chocolate": "Dunkelbraun", "chocolate": "Schokobraun", "cardinal red": "Kardinalrot",
    "cardinal": "Kardinalrot", "cherry red": "Kirschrot", "burgundy": "Burgunderrot", "berry": "Beerenrot",
    "azalea": "Azaleenrosa", "dusty rose": "Altrosa", "mauve": "Mauve", "coral": "Koralle", "teal": "Petrol",
    "mint": "Mint", "lavender": "Lavendel", "mustard": "Senfgelb", "khaki": "Khaki", "camo": "Tarnmuster",
    "steel blue": "Stahlblau", "sapphire": "Saphirblau", "turquoise": "Türkis", "lime": "Limettengrün",
    "safety green": "Signalgrün", "safety orange": "Signalorange", "safety pink": "Signalrosa",
    "vintage black": "Vintage-Schwarz", "vintage white": "Vintage-Weiß", "solid black blend": "Schwarz",
    "solid white blend": "Weiß", "spruce": "Tannengrün", "pebble": "Kieselgrau", "stone": "Steingrau",
}
# Grundfarben für die wortweise Übersetzung - Großschreibung am Anfang, klein im zusammengesetzten Wort.
WORDS = {
    "black": "schwarz", "white": "weiß", "red": "rot", "blue": "blau", "green": "grün", "yellow": "gelb",
    "orange": "orange", "purple": "lila", "pink": "rosa", "grey": "grau", "gray": "grau", "brown": "braun",
    "navy": "marineblau", "maroon": "weinrot", "gold": "gold", "silver": "silber", "beige": "beige", "olive": "oliv",
    "khaki": "khaki", "sand": "sand", "violet": "violett", "magenta": "magenta", "cyan": "cyan", "teal": "petrol",
    "mint": "mint", "turquoise": "türkis", "charcoal": "anthrazit", "coral": "koralle", "lavender": "lavendel",
    "burgundy": "burgunderrot", "cream": "creme",
}
# Vorsilben: „Dark Grey“ → „Dunkelgrau“, „Royal Blue“ → „Königsblau“.
MODIFIERS = {
    "dark": "dunkel", "light": "hell", "pale": "blass", "deep": "tief", "bright": "leucht", "neon": "neon",
    "royal": "königs", "sky": "himmel", "forest": "wald", "military": "militär", "army": "armee", "steel": "stahl",
    "ocean": "ozean", "baby": "baby", "sport": "sport", "athletic": "sport", "cherry": "kirsch", "cardinal": "kardinal",
    "heavy": "", "solid": "", "true": "", "classic": "",
}
HEATHER = ("heather", "heathered", "melange", "marl")
SIZES = {"one size": "Einheitsgröße", "onesize": "Einheitsgröße"}
MAX_LABEL = 40
HEX = re.compile(r"^#?([0-9A-Fa-f]{6})$")


def _key(name: Any) -> str:
    return " ".join(str(name or "").split())


def _words(part: str) -> str | None:
    """Ein Farbname ohne „/“ wortweise - ``None``, wenn ein Wort unbekannt ist."""
    words = part.casefold().split()
    if not words:
        return None
    whole = NAMES.get(" ".join(words))
    if whole:
        return whole
    heather = any(word in HEATHER for word in words)
    words = [word for word in words if word not in HEATHER]
    if heather and not words:
        return NAMES["heather"]
    whole = NAMES.get(" ".join(words))
    if whole and heather:
        return f"{whole} meliert"
    if whole:
        return whole
    *prefix, base = words
    if base not in WORDS or any(word not in MODIFIERS for word in prefix):
        return None
    text = "".join(MODIFIERS[word] for word in prefix) + WORDS[base]
    text = text[:1].upper() + text[1:]
    return f"{text} meliert" if heather else text


def german(name: Any) -> str:
    """Die deutsche Bezeichnung einer Printful-Farbe - unbekannt: der Printful-Name selbst."""
    text = _key(name)
    if not text:
        return ""
    parts = [part.strip() for part in text.split("/")]
    translated = [_words(part) for part in parts]
    if any(item is None for item in translated):
        return text
    return " / ".join(translated)


def is_translated(name: Any) -> bool:
    text = _key(name)
    return bool(text) and german(text) != text


def size_label(size: Any) -> str:
    text = _key(size)
    return SIZES.get(text.casefold(), text)


def _overrides(product: dict | None) -> dict:
    labels = ((product or {}).get("offer") or {}).get("color_labels")
    return labels if isinstance(labels, dict) else {}


def label(product: dict | None, name: Any) -> str:
    """Die Bezeichnung einer Farbe für dieses Produkt: eigene aus Schritt 2, sonst die Übersetzung."""
    text = _key(name)
    own = _overrides(product).get(text)
    return own if isinstance(own, str) and own.strip() else german(text)


def labels_for(product: dict | None, extra: Iterable[str] = ()) -> dict[str, str]:
    """Printful-Name → Bezeichnung für alle Farben des Printful-Produkts und die angebotenen."""
    names = [row.get("name") for row in ((product or {}).get("printful") or {}).get("colors") or []
             if isinstance(row, dict)]
    names += list(((product or {}).get("offer") or {}).get("colors") or []) + list(extra)
    return {_key(name): label(product, name) for name in dict.fromkeys(names) if _key(name)}


def defaults_for(product: dict | None) -> dict[str, str]:
    """Wie ``labels_for``, aber ohne eigene Bezeichnungen - die Vorgabe, die im Admin als Platzhalter steht."""
    return labels_for({**(product or {}), "offer": {**((product or {}).get("offer") or {}), "color_labels": {}}})


def variant_label(product: dict | None, variant: dict) -> str:
    """„Schwarz / M“ - Farbe und Größe einer Variante zum Anzeigen (der gespeicherte ``label`` bleibt Schlüssel)."""
    color, size = _key(variant.get("color")), _key(variant.get("size"))
    if not color and not size:
        return stored_label(variant.get("label"))
    return " / ".join(part for part in (label(product, color) if color else "", size_label(size)) if part)


def stored_label(text: Any) -> str:
    """Eine gespeicherte Bezeichnung „Farbe / Größe“ (etwa an einer Bestellposition) - dieselbe Übersetzung."""
    value = _key(text)
    if " / " not in value:
        return german(value) if is_translated(value) else value
    color, _sep, size = value.rpartition(" / ")
    return f"{german(color)} / {size_label(size)}"


def clean_labels(raw: Any, colors: list[str]) -> dict[str, str]:
    """Eigene Bezeichnungen aus Schritt 2: nur für angebotene Farben (Schreibweise egal), Text bis ``MAX_LABEL``
    Zeichen ohne Steuerzeichen; leer heißt „Vorgabe“ und fällt weg."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ShopError("Farbbezeichnungen: als Zuordnung Printful-Farbe → Bezeichnung.")
    known = {color.casefold(): color for color in colors}
    out = {}
    for key, value in raw.items():
        name = known.get(_key(key).casefold())
        if name is None:
            raise ShopError(f"Farbbezeichnung für „{_key(key)[:40]}“: diese Farbe wird nicht angeboten.")
        if value is None:
            continue
        if not isinstance(value, str) or any(unicodedata.category(char).startswith("C") for char in value):
            raise ShopError(f"Farbbezeichnung für {name}: nur Text in einer Zeile.")
        text = " ".join(value.split())
        if len(text) > MAX_LABEL:
            raise ShopError(f"Farbbezeichnung für {name}: höchstens {MAX_LABEL} Zeichen.")
        if text:
            out[name] = text
    return out


def hex_of(value: Any) -> str | None:
    """``#0C0C0C`` → ``0c0c0c`` - sonst ``None``."""
    match = HEX.match(str(value or "").strip())
    return match.group(1).lower() if match else None


def variant_ids_by_color(product: dict | None) -> dict[str, set[int]]:
    """Printful-Farbe → alle Printful-Varianten dieser Farbe (aus dem gespeicherten Abzug, alle Größen)."""
    out: dict[str, set[int]] = {}
    for row in ((product or {}).get("printful") or {}).get("variants") or []:
        if isinstance(row, dict) and type(row.get("id")) is int and row.get("color"):
            out.setdefault(row["color"], set()).add(row["id"])
    return out


def code_of(product: dict | None, name: Any) -> str | None:
    """Der Farbcode (``rrggbb``) einer Printful-Farbe aus den gespeicherten Daten - sonst ``None``."""
    for row in ((product or {}).get("printful") or {}).get("colors") or []:
        if isinstance(row, dict) and row.get("name") == name:
            return hex_of(row.get("code"))
    return None


def codes_of(product: dict | None) -> set[str]:
    """Alle Farbcodes aus den gespeicherten Printful-Daten eines Produkts (Farben und Varianten)."""
    printful = (product or {}).get("printful") or {}
    found = {hex_of(row.get("code")) for row in printful.get("colors") or [] if isinstance(row, dict)}
    found |= {hex_of(row.get("color_code")) for row in printful.get("variants") or [] if isinstance(row, dict)}
    return {code for code in found if code}
