"""Produktoptionen von Printful (#2158), etwa die Nahtfarbe bei Zuschnitt und Naht (Allover-Trikot).

Printful nennt im Katalog (``GET /v2/catalog-products/{id}``, ``product_options``) je Option Name, Art, erlaubte Werte
und Techniken - aber nicht, ob sie Pflicht ist. Fehlt eine Pflichtoption, lehnt Printful Schätzung und Auftrag ab
(„The required product option: `stitch_color` is missing.“). Darum:

- **Pflicht** sind die Optionen aus ``REQUIRED`` - die, die Printful nachweislich verlangt. Sie werden immer gesendet,
  unabhängig von der Technik (die Katalogangabe der Techniken ist nur Hinweis). Weitere kommen dazu, sobald Printful sie
  verlangt.
- Der Abzug des Printful-Produkts (Schritt 1) speichert die Optionen (``printful.options``); Schritt 2 speichert die
  Wahl am Angebot (``offer.options``: Name → Wert, nur Werte aus dem Katalog, Vorgabe der erste erlaubte Wert).
- Schätzung, Testentwurf und Auftrag senden ``product_options: [{name, value}]`` (``line_options``); die Bestellung
  friert die Optionen je Position ein. Produkte ohne Optionen bleiben unverändert - kein Feld, kein anderer Rumpf.
"""
from __future__ import annotations

from typing import Any

from services import shop_colors
from services.shop_common import ShopError

# Optionen, die Printful verlangt (Fehlermeldung beim Testentwurf des Allover-Trikots, Variante 16261).
REQUIRED = ("stitch_color",)
LABELS = {
    "stitch_color": "Nahtfarbe",
    "inside_pocket": "Innentasche",
    "notes": "Hinweis für die Produktion",
    "lifelike": "Lebensecht (Mockup)",
    "custom_border_color": "Randfarbe",
    "base_color": "Grundfarbe",
    "trim_color": "Bündchenfarbe",
    "color_reduction_mode": "Farbreduktion",
    "license_type": "Lizenz",
}
MISSING = "Produktoptionen von Printful noch nicht geladen - in Schritt 1 das Printful-Produkt neu laden."


def label(name: str) -> str:
    return LABELS.get(name) or name.replace("_", " ").capitalize()


def value_label(value: Any) -> str:
    if isinstance(value, bool):
        return "ja" if value else "nein"
    if isinstance(value, str):
        # Farben heißen deutsch wie im übrigen Shop (#2105): „White“ → „Weiß“.
        return shop_colors.german(value)
    return str(value)


def catalog(product: dict) -> list[dict]:
    """Die Optionen aus dem Abzug des Printful-Produkts - leer, wenn das Produkt keine hat oder vor #2158 geladen
    wurde (``loaded`` sagt, welches von beiden)."""
    rows = (product.get("printful") or {}).get("options")
    return [row for row in rows or [] if isinstance(row, dict) and row.get("name") and row.get("values")]


def loaded(product: dict) -> bool:
    return isinstance((product.get("printful") or {}).get("options"), list)


def required(product: dict) -> list[dict]:
    return [row for row in catalog(product) if row["name"] in REQUIRED]


def clean_choice(product: dict, raw: Any, *, previous: dict | None = None) -> dict:
    """Die Wahl in Schritt 2: je Pflichtoption ein Wert aus dem Katalog. Ohne Angabe bleibt die bisherige Wahl, sonst
    der erste erlaubte Wert. Unbekannte Optionen oder Werte lehnt der Server ab."""
    if raw is not None and not isinstance(raw, dict):
        raise ShopError("Produktoptionen: Name und Wert.")
    raw = dict(raw or {})
    options = {row["name"]: row for row in required(product)}
    unknown = sorted(set(raw) - set(options))
    if unknown:
        raise ShopError(f"Diese Produktoption kennt das Printful-Produkt nicht: {', '.join(unknown)}.")
    chosen = {}
    for name, row in options.items():
        if name in raw:
            value = raw[name]
            if not _allowed(value, row["values"]):
                raise ShopError(f"{label(name)}: diesen Wert bietet Printful nicht an.")
        elif name in (previous or {}) and _allowed(previous[name], row["values"]):
            value = previous[name]
        else:
            value = row["values"][0]
        chosen[name] = value
    return chosen


def _allowed(value: Any, values: list) -> bool:
    """Genau ein Katalogwert - auch in der Art (``True`` ist nicht ``1``)."""
    return any(type(item) is type(value) and item == value for item in values)


def problems(product: dict) -> list[str]:
    """Was an den Pflichtoptionen fehlt - leer, wenn alles gewählt ist."""
    chosen = (product.get("offer") or {}).get("options") or {}
    return [f"{label(row['name'])} fehlt" for row in required(product)
            if row["name"] not in chosen or not _allowed(chosen[row["name"]], row["values"])]


def line_options(product: dict) -> tuple[tuple[str, Any], ...]:
    """Was je Position an Printful geht: die gewählten Pflichtoptionen als Paare. Fehlt eine, ``ShopError`` - dann ist
    die Position nicht bestellbar (Printful würde ablehnen)."""
    missing = problems(product)
    if missing:
        raise ShopError("Produktoptionen fehlen: " + ", ".join(missing) + ".")
    chosen = (product.get("offer") or {}).get("options") or {}
    return tuple((row["name"], chosen[row["name"]]) for row in required(product))


def frozen(options: tuple[tuple[str, Any], ...]) -> list[dict]:
    return [{"name": name, "value": value, "label": label(name), "value_label": value_label(value)}
            for name, value in options]


def view(product: dict) -> dict:
    """Für Schritt 2: je Option Name, deutsche Bezeichnung, erlaubte Werte (mit Bezeichnung), Pflicht und Wahl."""
    chosen = (product.get("offer") or {}).get("options") or {}
    rows = []
    for row in catalog(product):
        rows.append({"name": row["name"], "label": label(row["name"]), "type": row.get("type"),
                     "techniques": row.get("techniques") or [], "required": row["name"] in REQUIRED,
                     "values": [{"value": value, "label": value_label(value)} for value in row["values"]],
                     "selected": chosen.get(row["name"])})
    return {"loaded": loaded(product), "options": rows,
            "skipped": (product.get("printful") or {}).get("options_skipped") or [],
            "missing": problems(product)}


def snapshot(options, skipped) -> dict:
    """Für den Abzug in Schritt 1: Optionen ohne Typen des Adapters, dazu die übersprungenen Zeilen (ohne Werte)."""
    return {"options": [{"name": row.name, "type": row.type, "values": list(row.values),
                         "techniques": list(row.techniques)} for row in options],
            "options_skipped": list(skipped)}
