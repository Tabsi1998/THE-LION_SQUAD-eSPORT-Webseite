"""Produktverwaltung im Shop-Admin (#1707): ein Produkt geführt aufbauen, prüfen und veröffentlichen.

Fünf Schritte, wie die Seite (Verwaltung → Finanzen → Shop → Produkte) sie zeigt:

1. **Produkt wählen** - ``load_printful_product``: Printful-Produktnummer laden (über den Adapter, #1705). Gespeichert
   wird ein Abzug: Farben, Größen, Techniken, Druckflächen mit Maßen, die Varianten mit Nummer und Lager - ohne Preise.
   Produkt- und Variantennummer sind eigene Typen (``CatalogProductId``/``CatalogVariantId``); eine Variantennummer als
   Produktnummer findet Printful nicht.
2. **Farben und Größen** - ``set_offer``: was angeboten wird. Je Farbe × Größe eine Variante (``shop_variants``) mit
   Zuordnung zur Printful-Variante (``shop_printful_variants``); danach holt der Abgleich (#1709,
   ``services/shop_catalog_sync.py``) die Einkaufspreise - nur für diese Varianten.
3. **Druckflächen** - ``set_layout`` (#2069): je Printful-Fläche aus der Druckvorlage (``shop_print_templates``)
   Ebenen: Motiv mit Vorgabe-Position und Größe in cm, dazu optional Gamertag bzw. Vereinsnummer als Platzhalter (ihre
   Datei entsteht je Bestellung, #1711). Die Website erzeugt daraus die Druckdateien je Farbe exakt in der Pixelgröße
   von Printful (``shop_print_files.generate``); für Profis geht auch eine fertige Datei je Fläche (``upload``).
4. **Preise** - ``accept_prices``: Mitglieder zahlen den Selbstkostenpreis (Einkauf je Variante plus Aufpreise der
   Druckflächen außer der im Grundpreis enthaltenen), ohne Aufschlag. Der öffentliche Preis ist Einkauf plus Aufschlag
   (eigener des Produkts ersetzt den allgemeinen, ``shop_config.markup_cents``). Preise von Printful werden nie
   ungeprüft übernommen - erst „Preise übernehmen“ mit Grund.
5. **Prüfen und veröffentlichen** - ``run_check`` und ``set_status``: Entwurf → geprüft → veröffentlicht → archiviert.

Jeder Schritt braucht einen Grund und steht im Protokoll (Aktionen ``shop.product.*``). Ein veröffentlichtes Produkt
ändert man erst nach dem Zurückziehen; ein geprüftes fällt bei jeder Änderung des Aufbaus auf „Entwurf“ zurück.
"""
from __future__ import annotations

import functools
import math
from typing import Any

from datetime import datetime, timedelta, timezone

from models import now_utc
from services import shop_catalog, shop_catalog_sync, shop_colors, shop_config, shop_gamertag, shop_print_files
from services import shop_print_templates as templates
from services.shop_common import ShopConflict, ShopError, clean_reason, record_admin_action
from services.shop_costs import cost_cents, euro, included_placement, technique_of
from services.shop_fulfillment import CatalogProductId, FulfillmentError, FulfillmentProvider

KIND_LABELS = shop_print_files.LAYER_KINDS
MAX_OFFERED_VARIANTS = 80  # je Variante ein Preisaufruf beim Abgleich - mehr sprengt das Rate-Limit von Printful
MAX_PLACEMENTS = 12
MAX_WIDTH_CM = 400.0
# So alt darf die Druckvorlage höchstens sein (der tägliche Abgleich holt sie neu) - sonst ist sie „nicht aktuell“.
TEMPLATE_MAX_AGE_DAYS = 14
PREVIEW_BASE = "/api/admin/shop/print-templates"
NOT_EDITABLE_ACTIVE = "Veröffentlicht: zum Ändern das Produkt erst zurückziehen (zurück auf „Entwurf“)."
NOT_EDITABLE_ARCHIVED = "Archiviert: zum Ändern erst wieder als Entwurf öffnen."
MOCKUP_OPEN = "Offen: die Mockup-Prüfung kommt mit #1710 - bis dahin lässt sich nichts veröffentlichen."


def _locked(func):
    """Schritte des Aufbaus und der Schreibteil des Abgleichs nacheinander (``shop_catalog.product_lock``)."""
    @functools.wraps(func)
    async def wrapper(db, product_id: str, *args, **kwargs):
        async with shop_catalog.product_lock(db, product_id):
            return await func(db, product_id, *args, **kwargs)

    return wrapper


class CatalogUnavailable(ShopError):
    """Printful ist gerade nicht erreichbar oder antwortet nicht wie erwartet (Antwort 502)."""


# ---------------------------------------------------------------- Kleine Helfer

def _editable(product: dict) -> None:
    if product.get("status") == "active":
        raise ShopConflict(NOT_EDITABLE_ACTIVE)
    if product.get("status") == "archived":
        raise ShopConflict(NOT_EDITABLE_ARCHIVED)


async def _product(db, product_id: str) -> dict:
    product = await shop_catalog.get_product(db, product_id)
    if not product:
        raise LookupError("Produkt nicht gefunden.")
    return product


async def _save_content(db, product: dict, update: dict, *, actor_id: str, reason: str, action: str,
                        data: dict) -> dict:
    """Ein Schritt des Aufbaus: speichern, protokollieren - und ein geprüftes Produkt zurück auf „Entwurf“."""
    back_to_draft = product.get("status") == "reviewed"
    if back_to_draft:
        update = {**update, "status": "draft", "review": None}
    saved = await shop_catalog.save_setup(db, product, update, actor_id=actor_id)
    await record_admin_action(db, action, actor_id=actor_id, target_id=product["id"], reason=reason, data=data)
    if back_to_draft:
        await record_admin_action(db, "shop.product.status", actor_id=actor_id, target_id=product["id"],
                                  reason=reason, data={"before": {"status": "reviewed"}, "after": {"status": "draft"},
                                                       "cause": "Aufbau geändert"})
    return saved


def _canonical(value: Any, known: list[str], label: str) -> str:
    text = " ".join(str(value or "").split())
    for item in known:
        if item.casefold() == text.casefold():
            return item
    raise ShopError(f"{label} „{text}“ gibt es bei diesem Printful-Produkt nicht.")


def _number(value: Any, label: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or not low <= value <= high:
        raise ShopError(f"{label}: eine Zahl von {templates._number(low, 1)} bis {templates._number(high, 1)}.")
    return round(float(value), 2)


# ---------------------------------------------------------------- 1. Printful-Produkt laden

def _printful_number(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ShopError("Printful-Produktnummer: eine ganze Zahl ab 1 (aus dem Printful-Katalog).")
    return value


@_locked
async def load_printful_product(db, product_id: str, printful_product_id: Any, *, provider: FulfillmentProvider,
                                actor_id: str, reason: Any) -> dict:
    """Schritt 1: das Katalogprodukt bei Printful laden und als Abzug speichern (ohne Preise - die holt Schritt 2 nur
    für die angebotenen Varianten)."""
    number = _printful_number(printful_product_id)
    reason = clean_reason(reason, required=False)
    product = await _product(db, product_id)
    _editable(product)
    catalog_id = CatalogProductId(number)
    try:
        info = await provider.catalog_product(catalog_id)
        variants = await provider.catalog_variants(catalog_id, price_for=())
    except FulfillmentError as exc:
        if exc.reason == "not_found":
            raise ShopError(f"Printful kennt kein Produkt mit der Nummer {number}. Ist das vielleicht eine "
                            "Variantennummer? Gebraucht wird die Nummer des Katalogprodukts.") from exc
        raise CatalogUnavailable(f"Printful ist gerade nicht erreichbar: {exc.text}.") from exc
    snapshot = {
        "product_id": number, "name": info.name, "brand": info.brand, "model": info.model, "type": info.type,
        "is_discontinued": info.is_discontinued, "techniques": list(info.techniques),
        "default_technique": info.default_technique,
        "placements": [{"placement": row.placement, "technique": row.technique,
                        "width_in": row.width if isinstance(row.width, (int, float)) else None,
                        "height_in": row.height if isinstance(row.height, (int, float)) else None}
                       for row in info.placements],
        "sizes": list(info.sizes),
        "colors": [{"name": name, "code": code} for name, code in info.colors],
        "variants": [{"id": row.id.value, "color": row.color, "size": row.size, "color_code": row.color_code,
                      "availability": row.availability} for row in variants],
        "loaded_at": now_utc().isoformat(),
    }
    before = (product.get("printful") or {}).get("product_id")
    update: dict = {"printful": snapshot}
    if before != number:
        # Anderes Katalogprodukt: Angebot und Technik gelten nicht mehr; Varianten bleiben (Bestellungen), aber inaktiv.
        update.update(offer=None, technique=None)
        for variant in await shop_catalog.variants_of(db, product_id):
            if variant.get("active"):
                await shop_catalog.set_variant_state(db, variant["id"], {"active": False}, actor_id=actor_id)
    saved = await _save_content(db, product, update, actor_id=actor_id, reason=reason, action="shop.product.catalog",
                                data={"before": {"printful_product_id": before},
                                      "after": {"printful_product_id": number}, "name": info.name,
                                      "variants": len(variants)})
    # Die Druckvorlagen gleich mit (#2069): Maße je Fläche und Vorlagenbilder. Scheitert das, bleibt das Produkt
    # geladen - die Prüfung „Druckvorlage“ zeigt es, „Mit Printful abgleichen“ holt sie nach.
    await templates.refresh(db, number, provider=provider, actor_id=actor_id, reason=reason)
    return saved


# ---------------------------------------------------------------- 2. Farben und Größen

def _list(raw: Any, label: str) -> list:
    if not isinstance(raw, (list, tuple)) or not raw:
        raise ShopError(f"Bitte mindestens eine {label} wählen.")
    return list(raw)


async def set_offer(db, product_id: str, *, technique: Any, colors: Any, sizes: Any, provider: FulfillmentProvider,
                    actor_id: str, reason: Any, color_labels: Any = None) -> dict:
    """Schritt 2: welche Farben und Größen angeboten werden. Legt die Varianten an und holt danach die Einkaufspreise.
    Läuft gerade ein anderer Abgleich, bleiben die Preise offen (Prüfung „Preis“) - „Mit Printful abgleichen“ holt sie.

    ``color_labels`` (#2105): eigene Bezeichnung je angebotener Farbe statt der Übersetzung (leer = Vorgabe). Ohne
    Angabe bleiben die eigenen Bezeichnungen der weiter angebotenen Farben. Der Printful-Name bleibt der Schlüssel."""
    reason = clean_reason(reason, required=False)
    async with shop_catalog.product_lock(db, product_id):
        saved = await _save_offer(db, product_id, technique=technique, colors=colors, sizes=sizes, actor_id=actor_id,
                                  reason=reason, color_labels=color_labels)
    try:
        await shop_catalog_sync.sync_product(db, product_id, provider=provider, actor_id=actor_id, reason=reason,
                                             wait_seconds=5.0)
    except ShopConflict:
        pass  # ein anderer Abgleich läuft - die Ansicht zeigt die fehlenden Preise
    return await shop_catalog.get_product(db, product_id) or saved


async def _save_offer(db, product_id: str, *, technique: Any, colors: Any, sizes: Any, actor_id: str,
                      reason: str, color_labels: Any = None) -> dict:
    product = await _product(db, product_id)
    _editable(product)
    printful = product.get("printful")
    if not printful:
        raise ShopError("Erst das Printful-Produkt laden (Schritt 1).")
    if technique not in (printful.get("techniques") or []):
        raise ShopError("Diese Drucktechnik bietet das Printful-Produkt nicht an.")
    known_colors = [row["name"] for row in printful.get("colors") or []]
    chosen_colors = list(dict.fromkeys(_canonical(item, known_colors, "Farbe") for item in _list(colors, "Farbe")))
    chosen_sizes = list(dict.fromkeys(_canonical(item, printful.get("sizes") or [], "Größe")
                                      for item in _list(sizes, "Größe")))
    rows = [row for row in printful.get("variants") or []
            if row.get("color") in chosen_colors and row.get("size") in chosen_sizes]
    if not rows:
        raise ShopError("Diese Farben und Größen gibt es bei Printful nicht zusammen.")
    if len(rows) > MAX_OFFERED_VARIANTS:
        raise ShopError(f"Höchstens {MAX_OFFERED_VARIANTS} Varianten je Produkt (gewählt: {len(rows)}) - je Variante "
                        "fragt der Abgleich Printful einmal nach dem Preis.")
    if color_labels is None:
        kept = ((product.get("offer") or {}).get("color_labels") or {})
        labels = {name: text for name, text in kept.items() if name in chosen_colors}
    else:
        labels = shop_colors.clean_labels(color_labels, chosen_colors)
    offer = {"colors": chosen_colors, "sizes": chosen_sizes, "color_labels": labels}
    saved = await _save_content(db, product, {"offer": offer, "technique": technique}, actor_id=actor_id,
                                reason=reason, action="shop.product.offer",
                                data={"technique": technique, **offer, "variants": len(rows)})
    offered_ids = set()
    for row in rows:
        variant = await shop_catalog.ensure_catalog_variant(
            db, product_id, printful_variant_id=row["id"], label=f"{row['color']} / {row['size']}", size=row["size"],
            color=row["color"], color_code=row.get("color_code"), actor_id=actor_id)
        offered_ids.add(variant["id"])
        await shop_catalog.set_variant_state(db, variant["id"], {"active": True}, actor_id=actor_id)
        await shop_catalog.set_catalog_mapping(db, variant["id"], {
            "printful_variant_id": row["id"], "printful_product_id": printful["product_id"], "technique": technique,
        }, actor_id=actor_id)
    for variant in await shop_catalog.variants_of(db, product_id):
        if variant["id"] not in offered_ids and variant.get("active"):
            await shop_catalog.set_variant_state(db, variant["id"], {"active": False}, actor_id=actor_id)
    return saved


# ---------------------------------------------------------------- 3. Druckflächen (#2069)

def _preview_view(template: dict, entry: dict, preview: dict | None = None, tint: str | None = None) -> dict | None:
    """Das Vorlagenbild für die Vorschau in Schritt 3 - mit ``tint`` (Farbcode aus den Printful-Daten) eingefärbt."""
    preview = preview or templates.preview_for(template, entry)
    if not preview:
        return None
    base = f"{PREVIEW_BASE}/{template['printful_product_id']}/images/{preview['index']}"
    image_query = f"?tint={tint}" if tint else ""
    background_query = f"?layer=background&tint={tint}" if tint else "?layer=background"
    return {"image_path": f"{base}{image_query}" if templates.allowed_image_url(preview["image_url"]) else None,
            "background_path": (f"{base}{background_query}"
                                if templates.allowed_image_url(preview.get("background_url")) else None),
            "background_color": preview.get("background_color"), "positioning": preview["positioning"],
            "template_width": preview["template_width"], "template_height": preview["template_height"],
            "area": preview["area"], "orientation": preview["orientation"], "tinted": bool(tint)}


def _previews_by_color(product: dict, template: dict, entry: dict) -> dict[str, dict | None]:
    """Je angebotener Farbe das passende Vorlagenbild (#2105): die Vorlage der eigenen Varianten, sonst eingefärbt."""
    ids = shop_colors.variant_ids_by_color(product)
    out = {}
    for color in (product.get("offer") or {}).get("colors") or []:
        preview, specific = templates.preview_for_color(template, entry, ids.get(color) or ())
        out[color] = _preview_view(template, entry, preview, None if specific else shop_colors.code_of(product, color))
    return out


def _entry_view(entry: dict) -> dict:
    return {key: entry[key] for key in ("group", "variant_ids", "width_px", "height_px", "dpi", "width_in",
                                        "height_in", "width_cm", "height_cm", "aspect_ok")}


async def available_placements(db, product: dict, *, template: dict | None = None,
                               presets_doc: dict | None = None) -> list[dict]:
    """Welche Flächen das Printful-Produkt für die gewählte Technik hat - mit exakter Druckdatei-Größe (je Gruppe),
    Vorlagenbild und den passenden Positions-Vorgaben."""
    template = template if template is not None else await templates.get(db, (product.get("printful") or {}).get(
        "product_id"))
    presets_doc = presets_doc or await templates.load_presets(db)
    technique = technique_of(product)
    out = []
    for placement in templates.placements_of(template, technique):
        entries = [row for row in templates.entries_for(template, technique) if row["placement"] == placement]
        main = next((row for row in entries if not row["variant_ids"]), entries[0])
        out.append({
            "key": placement, "label": main["label"], "family": main["family"],
            # Englisch nur als letzter Rückfall (#2105) - dann zeigt der Admin einen Hinweis.
            "label_translated": templates.placement_translated(placement, main.get("display_name")),
            "family_label": templates.FAMILIES[main["family"]], "technique": main["technique"],
            "file": _entry_view(main), "groups": [_entry_view(row) for row in entries],
            "preview": _preview_view(template, main),
            "preview_by_color": _previews_by_color(product, template, main),
            "safe_margin_cm": presets_doc["rules"]["safe_margin_cm"].get(main["family"], 0.0),
            "presets": {kind: [item["key"] for item in templates.presets_for(presets_doc["presets"], main["family"],
                                                                             kind)]
                        for kind in templates.PRESET_KINDS},
        })
    return out


LAYER_FIELDS = {"kind", "preset", "width_cm", "offset_x_cm", "offset_y_cm", "motif", *shop_gamertag.LAYER_SIZE_FIELDS}


async def _clean_motif(db, raw: Any, colors: list[str], label: str) -> dict:
    if not isinstance(raw, dict) or set(raw) - {"key", "by_color"}:
        raise ShopError(f"{label}: Motiv mit Kennung und - wenn nötig - einer Ausnahme je Farbe.")
    key = raw.get("key")
    if not await shop_print_files.motif_exists(db, key):
        raise ShopError(f"{label}: das Motiv „{key}“ gibt es nicht (oder noch ohne Datei).")
    by_color = raw.get("by_color") or {}
    if not isinstance(by_color, dict) or len(by_color) > 40:
        raise ShopError(f"{label}: Ausnahmen je Farbe als Zuordnung Farbe → Motiv.")
    clean = {}
    for color, other in by_color.items():
        name = _canonical(color, colors, "Farbe")
        if other in (None, "", key):
            continue
        if not await shop_print_files.motif_exists(db, other):
            raise ShopError(f"{label}: das Motiv „{other}“ für {name} gibt es nicht.")
        clean[name] = other
    return {"key": key, "by_color": clean}


async def _clean_layout(db, product: dict, raw_rows: Any, available: dict[str, dict], presets_doc: dict) -> list[dict]:
    if not isinstance(raw_rows, (list, tuple)) or not 1 <= len(raw_rows) <= MAX_PLACEMENTS:
        raise ShopError("Bitte mindestens eine Druckfläche wählen.")
    personalization = product.get("personalization") or "none"
    colors = (product.get("offer") or {}).get("colors") or []
    by_key = {item["key"]: item for item in presets_doc["presets"]}
    min_width = presets_doc["rules"]["min_width_cm"]
    out: list[dict] = []
    for raw in raw_rows:
        if not isinstance(raw, dict) or set(raw) - {"key", "mode", "layers"}:
            raise ShopError("Druckfläche: nur Fläche, Art und Ebenen.")
        key = raw.get("key")
        area = available.get(key)
        if area is None:
            raise ShopError(f"Die Fläche „{key}“ gibt es bei diesem Printful-Produkt nicht.")
        if any(row["key"] == key for row in out):
            raise ShopError(f"„{area['label']}“ steht doppelt.")
        mode = raw.get("mode") or "layout"
        if mode not in shop_print_files.MODES:
            raise ShopError(f"{area['label']}: unbekannte Art.")
        layers = raw.get("layers") or []
        if not isinstance(layers, list) or len(layers) > shop_print_files.MAX_LAYERS:
            raise ShopError(f"{area['label']}: höchstens {shop_print_files.MAX_LAYERS} Ebenen.")
        if mode == "layout" and not layers:
            raise ShopError(f"{area['label']}: mindestens ein Motiv oder ein Platzhalter.")
        clean_layers = []
        for layer in layers:
            if not isinstance(layer, dict) or set(layer) - LAYER_FIELDS:
                raise ShopError(f"{area['label']}: Ebene mit Art, Vorgabe, Größe und Feinjustierung.")
            kind = layer.get("kind")
            if kind not in KIND_LABELS:
                raise ShopError(f"{area['label']}: unbekannte Art der Ebene.")
            label = f"{area['label']}, {KIND_LABELS[kind]}"
            if kind == "gamertag" and personalization not in ("gamertag", "both"):
                raise ShopError(f"{label}: ein Gamertag braucht die Personalisierung „Gamertag“.")
            if kind == "member_number" and personalization not in ("member_number", "both"):
                raise ShopError(f"{label}: die Vereinsnummer braucht die Personalisierung „Vereinsnummer“.")
            if kind != "motif" and any(item["kind"] == kind for item in clean_layers):
                raise ShopError(f"{label}: höchstens einmal je Fläche.")
            preset = by_key.get(layer.get("preset"))
            wanted = "motif" if kind == "motif" else "text"
            if preset is None or preset["kind"] != wanted:
                raise ShopError(f"{label}: bitte eine Vorgabe-Position aus der Liste wählen.")
            if area["family"] not in preset["families"]:
                raise ShopError(f"{label}: „{preset['label']}“ passt nicht zu {area['family_label']}.")
            item = {"kind": kind, "preset": preset["key"],
                    "offset_x_cm": _number(layer.get("offset_x_cm", 0.0), f"{label}: Versatz waagrecht (cm)",
                                           -shop_print_files.MAX_OFFSET_CM, shop_print_files.MAX_OFFSET_CM),
                    "offset_y_cm": _number(layer.get("offset_y_cm", 0.0), f"{label}: Versatz senkrecht (cm)",
                                           -shop_print_files.MAX_OFFSET_CM, shop_print_files.MAX_OFFSET_CM)}
            if kind == "motif":
                if any(layer.get(name) is not None for name in shop_gamertag.LAYER_SIZE_FIELDS):
                    raise ShopError(f"{label}: Texthöhe und Höchstbreite gibt es nur für Gamertag und Vereinsnummer.")
                item["width_cm"] = _number(layer.get("width_cm", preset.get("width_cm")), f"{label}: Breite (cm)",
                                           min_width, MAX_WIDTH_CM)
                item["motif"] = await _clean_motif(db, layer.get("motif"), colors, label)
            else:
                # Größe je Namensebene (#2105) - ohne Angabe gelten die globalen Gamertag-Regeln wie bisher.
                try:
                    item.update(shop_gamertag.clean_layer_sizes(layer))
                except ShopError as exc:
                    raise ShopError(f"{label}: {exc}") from exc
            clean_layers.append(item)
        clean_layers.sort(key=lambda layer: layer["kind"] != "motif")
        out.append({"key": key, "printful_placement": key, "technique": area["technique"], "mode": mode,
                    "layers": clean_layers})
    return out


def _layout_summary(rows: list[dict]) -> list[dict]:
    return [{"key": row["key"], "mode": row.get("mode") or "layout",
             "layers": [{name: layer.get(name) for name in ("kind", "preset", "width_cm", "offset_x_cm", "offset_y_cm")}
                        | {name: layer[name] for name in shop_gamertag.LAYER_SIZE_FIELDS if layer.get(name) is not None}
                        | ({"motif": (layer.get("motif") or {}).get("key")} if layer.get("kind") == "motif" else {})
                        for layer in row.get("layers") or []]}
            for row in rows]


@_locked
async def set_layout(db, product_id: str, placements: Any, *, included_placement: str | None, actor_id: str,
                     reason: Any) -> dict:
    """Schritt 3: je Druckfläche Motiv, Vorgabe-Position und Größe in cm, dazu die Platzhalter für Gamertag und
    Vereinsnummer. Geprüft für jede angebotene Farbe (und Größe mit eigener Fläche): alles liegt in der Fläche."""
    reason = clean_reason(reason, required=False)
    product = await _product(db, product_id)
    _editable(product)
    if not product.get("printful"):
        raise ShopError("Erst das Printful-Produkt laden (Schritt 1).")
    template = await templates.get(db, product["printful"]["product_id"])
    if not template or not template.get("entries"):
        raise ShopError("Erst die Druckvorlagen von Printful laden („Mit Printful abgleichen“).")
    presets_doc = await templates.load_presets(db)
    available = {row["key"]: row for row in await available_placements(db, product, template=template,
                                                                        presets_doc=presets_doc)}
    rows = await _clean_layout(db, product, placements, available, presets_doc)
    used = [row["key"] for row in rows]
    if included_placement is not None and included_placement not in used:
        raise ShopError("Die Fläche im Grundpreis muss eine der gewählten Druckflächen sein.")
    trial = {**product, "placements": rows}
    found = [state for state in await shop_print_files.states(db, trial) if state["state"] in ("invalid", "no_area")]
    if found:
        lines = list(dict.fromkeys(state["detail"] for state in found))
        raise ShopError(" ".join(lines[:4]) + (f" (und {len(lines) - 4} weitere)" if len(lines) > 4 else ""))
    before = _layout_summary(await shop_print_files.layout_rows(db, product, template=template,
                                                                presets_doc=presets_doc))
    after = _layout_summary(rows)
    stored_is_layout = all(shop_print_files.is_layout(row) for row in product.get("placements") or [])
    if (stored_is_layout and before == after and product.get("placements") == rows
            and product.get("included_placement") == included_placement):
        return product
    return await _save_content(db, product, {"placements": rows, "included_placement": included_placement},
                               actor_id=actor_id, reason=reason, action="shop.product.layout",
                               data={"before": before, "after": after, "included_placement": included_placement})


async def plan_layout(db, product_id: str, placements: Any) -> dict:
    """Vorschau für einen noch nicht gespeicherten Aufbau: dieselbe Prüfung und dieselben Pläne wie beim Speichern - je
    Fläche und Farbe die Fassung des Motivs, die gedruckt würde (Bild, Seitenverhältnis, Rahmen). Speichert nichts."""
    product = await _product(db, product_id)
    if not product.get("printful"):
        raise ShopError("Erst das Printful-Produkt laden (Schritt 1).")
    template = await templates.get(db, product["printful"]["product_id"])
    if not template or not template.get("entries"):
        raise ShopError("Erst die Druckvorlagen von Printful laden („Mit Printful abgleichen“).")
    presets_doc = await templates.load_presets(db)
    available = {row["key"]: row for row in await available_placements(db, product, template=template,
                                                                        presets_doc=presets_doc)}
    rows = await _clean_layout(db, product, placements, available, presets_doc)
    states = await shop_print_files.states(db, {**product, "placements": rows})
    return {"placements": [{"key": row["key"], "files": [{key: state[key] for key in ("placement", "color", "group",
                                                                                         "state", "detail", "plan")}
                                                         for state in states if state["placement"] == row["key"]]}
                           for row in rows]}


async def generate_print_files(db, product_id: str, *, actor_id: str, reason: Any) -> dict:
    """„Druckdateien erzeugen“: je Fläche und Farbe die Grunddatei, die fehlt oder veraltet ist."""
    product = await _product(db, product_id)
    if product.get("status") == "archived":
        raise ShopConflict(NOT_EDITABLE_ARCHIVED)
    return await shop_print_files.generate(db, product_id, actor_id=actor_id, reason=reason)


# ---------------------------------------------------------------- 4. Preise

async def _offered(db, product: dict) -> list[tuple[dict, dict | None]]:
    variants = [variant for variant in await shop_catalog.variants_of(db, product["id"]) if variant.get("active")]
    mappings = await shop_catalog.printful_variants_for(db, [variant["id"] for variant in variants])
    return [(variant, mappings.get(variant["id"])) for variant in variants]


@_locked
async def accept_prices(db, product_id: str, *, actor_id: str, reason: Any) -> dict:
    """Die Einkaufspreise als Mitgliederpreis übernehmen (Selbstkostenpreis) - nur so kommen Preise von Printful in
    den Shop. Beendet offene Preiswarnungen des Abgleichs."""
    reason = clean_reason(reason, required=False)
    product = await _product(db, product_id)
    if product.get("status") == "archived":
        raise ShopConflict(NOT_EDITABLE_ARCHIVED)
    offered = await _offered(db, product)
    if not offered:
        raise ShopError("Erst Farben und Größen wählen (Schritt 2).")
    minimum = (await shop_config.load(db))["min_price_cents"]
    costs = []
    for variant, mapping in offered:  # erst alles prüfen, dann schreiben - nie halb übernommen
        cost = cost_cents(product, mapping)
        shown = shop_colors.variant_label(product, variant)
        if cost is None:
            raise ShopError(f"Für {shown} fehlt der Einkaufspreis von Printful - erst abgleichen.")
        if cost < minimum:
            raise ShopError(f"{shown}: Selbstkosten {euro(cost)} liegen unter dem Mindestpreis "
                            f"{euro(minimum)} - Mindestpreis senken (Shop → Einstellungen) oder die Variante nicht "
                            "anbieten.")
        costs.append(cost)
    changes = []
    for (variant, mapping), cost in zip(offered, costs):
        if variant.get("price_cents") != cost:
            changes.append({"label": variant["label"], "before_cents": variant.get("price_cents"), "after_cents": cost})
            await shop_catalog.set_variant_state(db, variant["id"], {"price_cents": cost}, actor_id=actor_id)
        if (mapping or {}).get("price_warning"):
            await shop_catalog.set_catalog_mapping(db, variant["id"], {"price_warning": None}, actor_id=actor_id)
    if changes:
        await record_admin_action(db, "shop.product.price", actor_id=actor_id, target_id=product_id, reason=reason,
                                  data={"kind": "variants", "changes": changes})
    return await _product(db, product_id)


# ---------------------------------------------------------------- 5. Prüfen und Stand

async def mockup_check(db, product: dict) -> dict:
    """Mockups (#1710) gibt es noch nicht - die Prüfung bleibt offen und sperrt das Veröffentlichen."""
    return {"ok": False, "state": "open", "detail": MOCKUP_OPEN}


def _item(key: str, label: str, ok: bool, detail: str, *, for_review: bool = True) -> dict:
    return {"key": key, "label": label, "ok": ok, "state": "ok" if ok else "failed", "detail": detail,
            "for_review": for_review}


def _template_item(template: dict | None, now: datetime) -> dict:
    if not template or not template.get("entries"):
        error = ((template or {}).get("last_error") or {}).get("detail")
        return _item("template", "Druckvorlage von Printful", False,
                     f"Noch keine Druckvorlage geladen{f' ({error})' if error else ''} - „Mit Printful abgleichen“.")
    try:
        checked = datetime.fromisoformat(str(template.get("checked_at")))
    except ValueError:
        checked = None
    if checked is not None and checked.tzinfo is None:
        checked = checked.replace(tzinfo=timezone.utc)
    fresh = checked is not None and now - checked <= timedelta(days=TEMPLATE_MAX_AGE_DAYS)
    places = len({row["placement"] for row in template["entries"]})
    detail = f"{places} Flächen, zuletzt abgeglichen {str(template.get('checked_at'))[:10]}."
    if template.get("changes") and template.get("changed_at"):
        detail += f" Zuletzt geändert {str(template['changed_at'])[:10]}: " + " ".join(template["changes"][:3])
    if not fresh:
        return _item("template", "Druckvorlage von Printful", False,
                     f"Die Vorlage ist älter als {TEMPLATE_MAX_AGE_DAYS} Tage - „Mit Printful abgleichen“. {detail}")
    carried = [row for row in template.get("carried") or [] if isinstance(row, dict)]
    if carried:
        # Übernommene Paare (#2091, Review): Printful liefert sie unvollständig, es gilt der letzte vollständige Stand.
        # Sichtbar als Warnung; nach TEMPLATE_MAX_AGE_DAYS rot wie eine veraltete Vorlage.
        warning = templates.carried_warning(carried)
        since = [_aware(row.get("carried_since")) for row in carried]
        if any(moment is None or now - moment > timedelta(days=TEMPLATE_MAX_AGE_DAYS) for moment in since):
            return _item("template", "Druckvorlage von Printful", False,
                         f"Länger als {TEMPLATE_MAX_AGE_DAYS} Tage unvollständig von Printful - bitte in Printful "
                         f"prüfen und „Mit Printful abgleichen“. {warning}")
        return {**_item("template", "Druckvorlage von Printful", True, f"{warning} {detail}"), "state": "warn"}
    return _item("template", "Druckvorlage von Printful", True, detail)


def _aware(value: Any) -> datetime | None:
    try:
        moment = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


STATE_TEXT = {"missing": "fehlt", "outdated": "veraltet", "invalid": "passt nicht", "no_area": "Fläche fehlt"}


async def run_check(db, product: dict) -> dict:
    """Die Vorab-Prüfung: alles, was vor „geprüft“ stimmen muss - und dazu die Mockups vor „veröffentlicht“."""
    items = []
    printful = product.get("printful") or {}
    items.append(_item("printful", "Printful-Produkt", bool(printful) and not printful.get("is_discontinued"),
                       ("Eingestellt bei Printful." if printful.get("is_discontinued") else
                        f"{printful.get('name')} (Nr. {printful.get('product_id')})") if printful
                       else "Noch kein Printful-Produkt gewählt."))
    template = await templates.get(db, printful.get("product_id")) if printful else None
    items.append(_template_item(template, now_utc()))
    offered = await _offered(db, product)
    offer = product.get("offer") or {}
    colors = ", ".join(shop_colors.label(product, color) for color in offer.get("colors") or [])
    sizes = ", ".join(shop_colors.size_label(size) for size in offer.get("sizes") or [])
    items.append(_item("offer", "Farben und Größen", bool(offered),
                       f"{len(offered)} Varianten: {colors} in {sizes}" if offered
                       else "Noch keine Farben und Größen gewählt."))
    personalization = product.get("personalization") or "none"
    rows = await shop_print_files.layout_rows(db, product, template=template) if printful else []
    kinds = {layer.get("kind") for row in rows for layer in row.get("layers") or []}
    problems = []
    if product.get("visibility") == "public" and personalization != "none":
        problems.append(shop_catalog.PUBLIC_WITHOUT_PERSONALIZATION)
    if personalization in ("gamertag", "both") and "gamertag" not in kinds:
        problems.append("Personalisierung Gamertag, aber kein Platzhalter für den Gamertag.")
    if personalization in ("member_number", "both") and "member_number" not in kinds:
        problems.append("Personalisierung Vereinsnummer, aber kein Platzhalter dafür.")
    if "gamertag" in kinds and personalization not in ("gamertag", "both"):
        problems.append("Gamertag-Platzhalter ohne Personalisierung Gamertag.")
    if "member_number" in kinds and personalization not in ("member_number", "both"):
        problems.append("Vereinsnummer-Platzhalter ohne Personalisierung Vereinsnummer.")
    items.append(_item("personalization", "Sichtbarkeit und Personalisierung", not problems,
                       " ".join(problems) or f"{shop_catalog.VISIBILITY_LABELS.get(product.get('visibility'))}, "
                                             f"Personalisierung: {shop_catalog.PERSONALIZATION_LABELS[personalization]}."))
    conversion = await shop_print_files.layout_conversion(db, product) if printful else {"blocked": []}
    if conversion["blocked"]:
        # Alte Platzierungen, die sich nicht abbilden lassen: das ganze Produkt ist nicht bestellbar (fail-closed).
        items.append(_item("layout", "Druckflächen umgestellt", False,
                           "Nicht bestellbar - nicht abbildbar: " + " ".join(conversion["blocked"])
                           + " Bitte in Schritt 3 neu setzen und speichern."))
    printed = [row for row in rows if row.get("mode") == "upload"
               or any(layer.get("kind") == "motif" for layer in row.get("layers") or [])]
    items.append(_item("placements", "Druckflächen", bool(printed),
                       f"{len(rows)} Flächen, davon {len(printed)} mit Motiv oder fertiger Datei." if printed
                       else "Mindestens eine Fläche mit einem Motiv des Vereins."))
    states = await shop_print_files.states(db, product) if printful and rows else []
    bad = [state for state in states if state["state"] not in ("ok", "not_needed")]
    files_ok = bool(printed) and bool(offer.get("colors")) and bool(states) and not bad
    if files_ok:
        detail = "Jede angebotene Farbe hat an jeder Fläche eine gültige Druckdatei in der Größe von Printful."
        warned = sorted({warning for state in states for warning in ((state.get("file") or {}).get("warnings") or [])})
        if warned:
            detail += " Hinweise: " + " ".join(warned[:2])
    elif bad:
        detail = "; ".join(f"{templates.placement_label(state['placement'])} / "
                           f"{shop_colors.label(product, state['color'])}: "
                           f"{STATE_TEXT.get(state['state'], state['state'])}"
                           f"{(' - ' + state['detail']) if state['state'] in ('invalid', 'no_area') else ''}"
                           for state in bad[:8]) + (f" (und {len(bad) - 8} weitere)" if len(bad) > 8 else "")
        detail = "Ohne gültige Druckdatei: " + detail + ". „Druckdateien erzeugen“ in Schritt 3."
    else:
        detail = "Noch keine Druckfläche mit Motiv."
    items.append(_item("files", "Druckdateien je Farbe", files_ok, detail))
    unavailable = [shop_colors.variant_label(product, variant) for variant, mapping in offered
                   if variant.get("blocked_reason") or (mapping or {}).get("in_stock") is not True]
    items.append(_item("stock", "Lieferbar", bool(offered) and not unavailable,
                       ("Nicht lieferbar oder Lager unbekannt: " + ", ".join(unavailable)) if unavailable else
                       "Alle angebotenen Varianten sind bei Printful lieferbar." if offered else "Keine Varianten."))
    unpriced, too_cheap = [], []
    minimum = (await shop_config.load(db))["min_price_cents"]
    for variant, mapping in offered:
        cost = cost_cents(product, mapping)
        if cost is None or variant.get("price_cents") != cost or (mapping or {}).get("price_warning"):
            unpriced.append(shop_colors.variant_label(product, variant))
        elif variant["price_cents"] < minimum:
            too_cheap.append(shop_colors.variant_label(product, variant))
    problems = []
    if unpriced:
        problems.append("Preis fehlt oder weicht vom Einkauf ab: " + ", ".join(unpriced))
    if too_cheap:
        problems.append(f"Unter dem Mindestpreis ({euro(minimum)}): " + ", ".join(too_cheap))
    items.append(_item("prices", "Preis berechnet und übernommen", bool(offered) and not problems,
                       ". ".join(problems) if problems else
                       "Mitgliederpreis = Einkauf, übernommen." if offered else "Keine Varianten."))
    mockup = await mockup_check(db, product)
    items.append({"key": "mockup", "label": "Mockup-Prüfung", "ok": bool(mockup.get("ok")),
                  "state": mockup.get("state") or ("ok" if mockup.get("ok") else "open"),
                  "detail": mockup.get("detail") or "", "for_review": False})
    review_ready = all(item["ok"] for item in items if item["for_review"])
    return {"items": items, "review_ready": review_ready,
            "publish_ready": review_ready and all(item["ok"] for item in items)}


TRANSITIONS = {
    "draft": ("reviewed", "archived"),
    "reviewed": ("active", "draft", "archived"),
    "active": ("draft", "archived"),
    "archived": ("draft",),
}


@_locked
async def set_status(db, product_id: str, status: str, *, actor_id: str, reason: Any) -> dict:
    """Entwurf → geprüft (Prüfung ohne Mockups bestanden) → veröffentlicht (alles bestanden, auch Mockups) →
    archiviert. Zurück auf „Entwurf“ geht immer (Zurückziehen, wieder öffnen)."""
    if status not in shop_catalog.STATUSES:
        raise ShopError("Unbekannter Stand.")
    # Grund optional (Entscheidung Obmann 27.10.2026) - Pflicht nur beim Veröffentlichen: dann geht es live.
    reason = clean_reason(reason, required=status == "active")
    product = await _product(db, product_id)
    current = product.get("status") or "draft"
    if status == current:
        return product
    if status not in TRANSITIONS.get(current, ()):
        if status == "active":
            raise ShopConflict("Veröffentlichen geht erst nach bestandener Prüfung (Stand „geprüft“).")
        raise ShopConflict(f"Von „{shop_catalog.STATUS_LABELS[current]}“ geht es nicht direkt zu "
                           f"„{shop_catalog.STATUS_LABELS[status]}“.")
    update: dict = {"status": status}
    check = None
    if status in ("reviewed", "active"):
        check = await run_check(db, product)
        needed = [item for item in check["items"] if not item["ok"] and (item["for_review"] or status == "active")]
        if needed:
            names = ", ".join(f"{item['label']} ({'offen' if item['state'] == 'open' else 'fehlt'})"
                              for item in needed)
            prefix = "Die Prüfung ist noch nicht bestanden" if status == "reviewed" else "Noch nicht veröffentlichbar"
            raise ShopConflict(f"{prefix}: {names}.")
    now = now_utc().isoformat()
    if status == "reviewed":
        update["review"] = {"at": now, "by": actor_id}
    if status == "active":
        update["published_at"] = now
    if status == "archived":
        update["archived_at"] = now
    if status == "draft":
        update["review"] = None
    saved = await shop_catalog.save_setup(db, product, update, actor_id=actor_id)
    data: dict = {"before": {"status": current}, "after": {"status": status}}
    if check:
        data["check"] = {item["key"]: item["state"] for item in check["items"]}
    await record_admin_action(db, "shop.product.status", actor_id=actor_id, target_id=product_id, reason=reason,
                              data=data)
    return saved


# ---------------------------------------------------------------- Ansicht für den Admin

def _template_view(template: dict | None) -> dict | None:
    if not template:
        return None
    return {"printful_product_id": template.get("printful_product_id"), "checked_at": template.get("checked_at"),
            "fetched_at": template.get("fetched_at"), "changed_at": template.get("changed_at"),
            "changes": template.get("changes") or [], "last_error": template.get("last_error"),
            "hash": (template.get("hash") or "")[:12], "loaded": bool(template.get("entries")),
            "skipped": template.get("skipped") or [], "carried": template.get("carried") or [],
            "warning": templates.carried_warning(template.get("carried") or [])}


async def admin_view(db, product_id: str) -> dict:
    product = await _product(db, product_id)
    config = await shop_config.load(db)
    general = int(config.get("public_markup_cents") or 0)
    own = product.get("markup_cents")
    effective = shop_config.markup_cents(config, "public", product)
    variants = await shop_catalog.variants_of(db, product_id)
    mappings = await shop_catalog.printful_variants_for(db, [variant["id"] for variant in variants])
    variant_rows = []
    for variant in sorted(variants, key=lambda item: (not item.get("active"), item.get("label") or "")):
        mapping = mappings.get(variant["id"]) or {}
        cost = cost_cents(product, mapping) if mapping else None
        price = variant.get("price_cents")
        variant_rows.append({
            "id": variant["id"], "sku": variant["sku"], "label": variant["label"],
            "display_label": shop_colors.variant_label(product, variant), "color": variant.get("color"),
            "color_label": shop_colors.label(product, variant.get("color")) if variant.get("color") else None,
            "size": variant.get("size"), "color_code": variant.get("color_code"), "active": bool(variant.get("active")),
            "blocked_reason": variant.get("blocked_reason"), "printful_variant_id": mapping.get("printful_variant_id"),
            "availability": mapping.get("availability"), "in_stock": mapping.get("in_stock"),
            "base_cost_cents": mapping.get("base_cost_cents"), "placement_costs": mapping.get("placement_costs") or {},
            "cost_cents": cost, "price_cents": price,
            "public_price_cents": price + effective if isinstance(price, int) else None,
            "suggested_public_cents": cost + effective if isinstance(cost, int) else None,
            "price_warning": mapping.get("price_warning"), "synced_at": mapping.get("synced_at")})
    printful = product.get("printful") or {}
    template = await templates.get(db, printful.get("product_id")) if printful else None
    presets_doc = await templates.load_presets(db)
    included = included_placement(product)
    sample = next((mappings.get(variant["id"]) for variant in variants
                   if variant.get("active") and mappings.get(variant["id"])), None) or {}
    rows = await shop_print_files.layout_rows(db, product, template=template, presets_doc=presets_doc) \
        if printful else []
    states = await shop_print_files.states(db, product) if printful and rows else []
    available = await available_placements(db, product, template=template, presets_doc=presets_doc) \
        if printful else []
    labels = {row["key"]: row["label"] for row in available}
    placement_rows = []
    for row in rows:
        placement_rows.append({
            "key": row["key"], "label": labels.get(row["key"], row["key"]), "mode": row.get("mode") or "layout",
            "layers": row.get("layers") or [], "printful_placement": row["printful_placement"],
            "included": row["printful_placement"] == included,
            "surcharge_cents": (sample.get("placement_costs") or {}).get(row["printful_placement"]),
            "files": [{**state, "color_label": shop_colors.label(product, state["color"])}
                      for state in states if state["placement"] == row["key"]],
        })
    current = product.get("status") or "draft"
    conversion = await shop_print_files.layout_conversion(db, product) if printful else {"converted": False,
                                                                                          "notes": [], "blocked": []}
    return {
        "product": product,
        "labels": {"statuses": shop_catalog.STATUS_LABELS, "visibilities": shop_catalog.VISIBILITY_LABELS,
                   "personalizations": shop_catalog.PERSONALIZATION_LABELS, "kinds": KIND_LABELS,
                   "modes": shop_print_files.MODES, "families": templates.FAMILIES,
                   "anchors": templates.ANCHORS, "placements": _placement_names(printful, template)},
        "variants": variant_rows,
        # Printful-Name → Bezeichnung (#2105): eigene aus Schritt 2, sonst die Übersetzung; dazu die Vorgabe.
        "color_labels": shop_colors.labels_for(product),
        "color_defaults": shop_colors.defaults_for(product),
        "size_labels": {size: shop_colors.size_label(size) for size in printful.get("sizes") or []},
        "placements": placement_rows,
        "layout_converted": conversion["converted"],
        "layout_notes": conversion["notes"],
        "layout_blocked": conversion["blocked"],
        "available_placements": available,
        "included_placement": included,
        "print_template": _template_view(template),
        "presets": presets_doc["presets"],
        "preset_rules": presets_doc["rules"],
        "motif_options": await shop_print_files.motif_options(db),
        "gamertag_canvas": _gamertag_canvas(await shop_print_files.shop_gamertag.load_rules(db)),
        "pricing": {"general_markup_cents": general, "product_markup_cents": own, "effective_markup_cents": effective,
                    "source": "product" if isinstance(own, int) else "general",
                    "member_markup_cents": shop_config.MEMBER_MARKUP_CENTS},
        "check": await run_check(db, product),
        "sync": product.get("catalog_sync"),
        "transitions": list(TRANSITIONS.get(current, ())),
        "editable": current not in ("active", "archived"),
        "limits": {"max_variants": MAX_OFFERED_VARIANTS, "max_placements": MAX_PLACEMENTS,
                   "max_layers": shop_print_files.MAX_LAYERS, "min_width_cm": presets_doc["rules"]["min_width_cm"],
                   "max_offset_cm": shop_print_files.MAX_OFFSET_CM},
    }


def _placement_names(printful: dict, template: dict | None) -> dict[str, str]:
    """Kennung → deutscher Name für alle Flächen des Printful-Produkts (Schritt 1) und der Vorlage (#2105)."""
    names = {row["placement"]: row.get("label") or templates.placement_label(row["placement"])
             for row in (template or {}).get("entries") or [] if isinstance(row, dict) and row.get("placement")}
    for row in printful.get("placements") or []:
        key = row.get("placement")
        if key and key not in names:
            names[key] = templates.placement_label(key)
    return names


def _gamertag_canvas(rules: dict) -> dict:
    """Die Leinwand der Gamertag-Datei in Zoll - die Vorschau rechnet sie auf jede Fläche um."""
    width, height = shop_gamertag.canvas(rules)
    cm = shop_gamertag.CM_PER_INCH
    # Je Ebene einstellbar (#2105): die Vorgabe sind die globalen Regeln; die Leinwand wächst mit der Texthöhe
    # (``height_per_text``: Leinwandhöhe je Zoll Texthöhe), die Breite ist die Höchstbreite.
    return {"width_in": round(width / rules["dpi"], 4), "height_in": round(height / rules["dpi"], 4),
            "anchor_y_in": round(height / 2 / rules["dpi"], 4),
            "text_height_cm": round(rules["text_height_in"] * cm, 2),
            "max_width_cm": round(rules["max_width_in"] * cm, 2),
            "height_per_text": round(height / rules["dpi"] / rules["text_height_in"], 4),
            "limits": {"min_text_height_cm": round(shop_gamertag.MIN_HEIGHT_IN * cm, 2),
                       "max_text_height_cm": round(shop_gamertag.MAX_HEIGHT_IN * cm, 2),
                       "min_width_cm": round(shop_gamertag.MIN_WIDTH_IN * cm, 2),
                       "max_width_cm": round(shop_gamertag.MAX_WIDTH_IN * cm, 2)}}


async def list_view(db) -> list[dict]:
    """Die Produktliste: Stand, Sichtbarkeit, Printful, Anzahl Varianten und Warnungen."""
    out = []
    for product in await shop_catalog.list_products(db):
        variants = [variant for variant in await shop_catalog.variants_of(db, product["id"]) if variant.get("active")]
        mappings = await shop_catalog.printful_variants_for(db, [variant["id"] for variant in variants])
        out.append({
            "id": product["id"], "slug": product["slug"], "title": product["title"],
            "status": product.get("status"), "visibility": product.get("visibility"),
            "personalization": product.get("personalization") or "none",
            "printful_name": (product.get("printful") or {}).get("name"), "variants": len(variants),
            "blocked": sum(1 for variant in variants if variant.get("blocked_reason")),
            "price_warnings": sum(1 for variant in variants if (mappings.get(variant["id"]) or {}).get("price_warning")),
            "sync": product.get("catalog_sync"), "updated_at": product.get("updated_at"),
        })
    return out
