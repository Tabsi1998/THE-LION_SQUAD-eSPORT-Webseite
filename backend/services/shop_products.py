"""Produktverwaltung im Shop-Admin (#1707): ein Produkt geführt aufbauen, prüfen und veröffentlichen.

Fünf Schritte, wie die Seite (Verwaltung → Finanzen → Shop → Produkte) sie zeigt:

1. **Produkt wählen** - ``load_printful_product``: Printful-Produktnummer laden (über den Adapter, #1705). Gespeichert
   wird ein Abzug: Farben, Größen, Techniken, Druckflächen mit Maßen, die Varianten mit Nummer und Lager - ohne Preise.
   Produkt- und Variantennummer sind eigene Typen (``CatalogProductId``/``CatalogVariantId``); eine Variantennummer als
   Produktnummer findet Printful nicht.
2. **Farben und Größen** - ``set_offer``: was angeboten wird. Je Farbe × Größe eine Variante (``shop_variants``) mit
   Zuordnung zur Printful-Variante (``shop_printful_variants``); danach holt der Abgleich (#1709,
   ``services/shop_catalog_sync.py``) die Einkaufspreise - nur für diese Varianten.
3. **Designs je Platzierung** - ``set_placements`` und ``set_designs``: Platzierungen aus den Druckflächen des
   Produkts mit Position, Breite und Höhe in Zoll (Vorlage aus ``shop_designs.placement_specs``), je Platzierung und
   Farbe ein Design aus #1708 (vorgeschlagen über ``shop_designs.design_for_color``). Gamertag und Vereinsnummer sind
   Platzhalter: ihre Datei entsteht je Bestellung (#1711).
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

from models import now_utc
from services import shop_catalog, shop_catalog_sync, shop_config, shop_designs
from services.shop_common import ShopConflict, ShopError, clean_reason, record_admin_action
from services.shop_costs import cost_cents, included_placement, technique_of
from services.shop_fulfillment import CatalogProductId, FulfillmentError, FulfillmentProvider

PLACEMENT_KINDS = ("design", "gamertag", "member_number")
KIND_LABELS = {"design": "Design des Vereins", "gamertag": "Gamertag (Datei je Bestellung, #1711)",
               "member_number": "Vereinsnummer (Datei je Bestellung, folgt)"}
# Unsere Platzierung → Druckfläche bei Printful. Brust links/rechts liegen auf der Vorderseite (Position im Druckbereich).
PRINTFUL_PLACEMENTS = {"front": "front", "front_left": "front", "front_right": "front", "back": "back",
                       "sleeve_left": "sleeve_left", "sleeve_right": "sleeve_right", "label": "label_inside"}
# Mitte des Motivs als Anteil der Druckbreite, von vorne gesehen. „Brust rechts vom Träger aus“ liegt von vorne
# gesehen links.
_CENTER = {"front_right": 0.27, "front_left": 0.73}
POSITION_FIELDS = ("left_in", "top_in", "width_in", "height_in")
MIN_SIZE_IN, MAX_SIZE_IN = 0.5, 25.0
MAX_OFFERED_VARIANTS = 80  # je Variante ein Preisaufruf beim Abgleich - mehr sprengt das Rate-Limit von Printful
MAX_PLACEMENTS = len(PRINTFUL_PLACEMENTS)
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


def _area(product: dict, printful_placement: str) -> dict | None:
    technique = technique_of(product)
    rows = [row for row in (product.get("printful") or {}).get("placements") or []
            if row.get("placement") == printful_placement]
    if not rows:
        return None
    row = next((item for item in rows if item.get("technique") == technique), rows[0])
    return {"width_in": row.get("width_in"), "height_in": row.get("height_in"), "technique": row.get("technique")}


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ShopError(f"{label}: als Zahl in Zoll angeben.")
    return round(float(value), 3)


def default_position(key: str, area: dict, spec: dict) -> dict:
    """Vorlage für Position, Breite und Höhe in Zoll - die Finanzen passen sie an."""
    area_w = float(area.get("width_in") or spec["area_width_in"])
    area_h = float(area.get("height_in") or spec["area_height_in"])
    width = min(float(spec["print_width_in"]), area_w)
    height = min(width, area_h)
    if key in _CENTER:
        left = area_w * _CENTER[key] - width / 2
    else:
        left = (area_w - width) / 2
    top = 1.0 if area_h >= height + 1.0 else 0.0
    return {"left_in": round(max(0.0, left), 2), "top_in": top, "width_in": round(width, 2),
            "height_in": round(height, 2)}


def _position(raw: Any, area: dict, label: str) -> dict:
    if not isinstance(raw, dict) or set(raw) - set(POSITION_FIELDS):
        raise ShopError(f"{label}: Position mit links, oben, Breite und Höhe in Zoll.")
    values = {name: _number(raw.get(name), f"{label}: {name}") for name in POSITION_FIELDS}
    if values["left_in"] < 0 or values["top_in"] < 0:
        raise ShopError(f"{label}: Position nicht negativ.")
    for name in ("width_in", "height_in"):
        if not MIN_SIZE_IN <= values[name] <= MAX_SIZE_IN:
            raise ShopError(f"{label}: Breite und Höhe von 0,5 bis 25 Zoll.")
    area_w, area_h = area.get("width_in"), area.get("height_in")
    if isinstance(area_w, (int, float)) and values["left_in"] + values["width_in"] > area_w + 1e-6:
        raise ShopError(f"{label}: ragt rechts aus dem Druckbereich ({shop_designs.inches(area_w)} breit).")
    if isinstance(area_h, (int, float)) and values["top_in"] + values["height_in"] > area_h + 1e-6:
        raise ShopError(f"{label}: ragt unten aus dem Druckbereich ({shop_designs.inches(area_h)} hoch).")
    return values


def _position_text(position: dict) -> dict:
    return {"left": shop_designs.inches(position["left_in"]), "top": shop_designs.inches(position["top_in"]),
            "width": shop_designs.inches(position["width_in"]), "height": shop_designs.inches(position["height_in"])}


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
    reason = clean_reason(reason)
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
    return await _save_content(db, product, update, actor_id=actor_id, reason=reason, action="shop.product.catalog",
                               data={"before": {"printful_product_id": before},
                                     "after": {"printful_product_id": number}, "name": info.name,
                                     "variants": len(variants)})


# ---------------------------------------------------------------- 2. Farben und Größen

def _list(raw: Any, label: str) -> list:
    if not isinstance(raw, (list, tuple)) or not raw:
        raise ShopError(f"Bitte mindestens eine {label} wählen.")
    return list(raw)


async def set_offer(db, product_id: str, *, technique: Any, colors: Any, sizes: Any, provider: FulfillmentProvider,
                    actor_id: str, reason: Any) -> dict:
    """Schritt 2: welche Farben und Größen angeboten werden. Legt die Varianten an und holt danach die Einkaufspreise.
    Läuft gerade ein anderer Abgleich, bleiben die Preise offen (Prüfung „Preis“) - „Mit Printful abgleichen“ holt sie."""
    reason = clean_reason(reason)
    async with shop_catalog.product_lock(db, product_id):
        saved = await _save_offer(db, product_id, technique=technique, colors=colors, sizes=sizes, actor_id=actor_id,
                                  reason=reason)
    try:
        await shop_catalog_sync.sync_product(db, product_id, provider=provider, actor_id=actor_id, reason=reason,
                                             wait_seconds=5.0)
    except ShopConflict:
        pass  # ein anderer Abgleich läuft - die Ansicht zeigt die fehlenden Preise
    return await shop_catalog.get_product(db, product_id) or saved


async def _save_offer(db, product_id: str, *, technique: Any, colors: Any, sizes: Any, actor_id: str,
                      reason: str) -> dict:
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
    offer = {"colors": chosen_colors, "sizes": chosen_sizes}
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


# ---------------------------------------------------------------- 3. Platzierungen und Designs

async def available_placements(db, product: dict) -> list[dict]:
    """Welche Platzierungen dieses Printful-Produkt hergibt - mit Druckbereich und Vorlage für die Position."""
    specs = await shop_designs.placement_specs(db)
    out = []
    for key in shop_catalog.PLACEMENTS:
        area = _area(product, PRINTFUL_PLACEMENTS[key])
        if area is None:
            continue
        position = default_position(key, area, specs[key])
        out.append({"key": key, "label": shop_designs.PLACEMENT_LABELS[key],
                    "printful_placement": PRINTFUL_PLACEMENTS[key], "area": area,
                    "area_text": {name: shop_designs.inches(area[name]) if isinstance(area[name], (int, float)) else None
                                  for name in ("width_in", "height_in")},
                    "default_position": position, "default_position_text": _position_text(position)})
    return out


@_locked
async def set_placements(db, product_id: str, placements: Any, *, included_placement: str | None, actor_id: str,
                         reason: Any) -> dict:
    """Platzierungen mit Art (Design, Gamertag, Vereinsnummer) und Position in Zoll. Designs bleiben bei Platzierungen,
    die es weiter gibt."""
    reason = clean_reason(reason)
    product = await _product(db, product_id)
    _editable(product)
    if not product.get("printful"):
        raise ShopError("Erst das Printful-Produkt laden (Schritt 1).")
    if not isinstance(placements, (list, tuple)) or not 1 <= len(placements) <= MAX_PLACEMENTS:
        raise ShopError("Bitte mindestens eine Platzierung wählen.")
    available = {row["key"]: row for row in await available_placements(db, product)}
    personalization = product.get("personalization") or "none"
    old = {row["key"]: row for row in product.get("placements") or []}
    clean: list[dict] = []
    for raw in placements:
        if not isinstance(raw, dict) or set(raw) - {"key", "kind", "position"}:
            raise ShopError("Platzierung: nur Platzierung, Art und Position.")
        key, kind = raw.get("key"), raw.get("kind", "design")
        if key not in shop_catalog.PLACEMENTS:
            raise ShopError("Unbekannte Platzierung.")
        label = shop_designs.PLACEMENT_LABELS[key]
        if key not in available:
            raise ShopError(f"„{label}“ gibt es bei diesem Printful-Produkt nicht.")
        if any(row["key"] == key for row in clean):
            raise ShopError(f"„{label}“ steht doppelt.")
        if kind not in PLACEMENT_KINDS:
            raise ShopError(f"{label}: unbekannte Art.")
        if kind == "gamertag" and personalization not in ("gamertag", "both"):
            raise ShopError(f"{label}: ein Gamertag-Feld braucht die Personalisierung „Gamertag“.")
        if kind == "member_number" and personalization not in ("member_number", "both"):
            raise ShopError(f"{label}: ein Feld für die Vereinsnummer braucht die Personalisierung „Vereinsnummer“.")
        area = available[key]["area"]
        position = (_position(raw["position"], area, label) if raw.get("position") is not None
                    else dict(available[key]["default_position"]))
        designs = (old.get(key) or {}).get("designs") or [] if kind == "design" else []
        clean.append({"key": key, "kind": kind, "printful_placement": PRINTFUL_PLACEMENTS[key], "position": position,
                      "designs": designs})
    used = list(dict.fromkeys(row["printful_placement"] for row in clean))
    if included_placement is not None and included_placement not in used:
        raise ShopError("Die Fläche im Grundpreis muss eine der gewählten Druckflächen sein.")
    before = [{"key": row["key"], "kind": row["kind"], "position": row["position"]} for row in old.values()]
    after = [{"key": row["key"], "kind": row["kind"], "position": row["position"]} for row in clean]
    if before == after and product.get("included_placement") == included_placement:
        return product
    return await _save_content(db, product, {"placements": clean, "included_placement": included_placement},
                               actor_id=actor_id, reason=reason, action="shop.product.placements",
                               data={"before": before, "after": after, "included_placement": included_placement})


@_locked
async def set_designs(db, product_id: str, assignments: Any, *, actor_id: str, reason: Any) -> dict:
    """Je Platzierung und Farbe ein Design aus #1708 (``design_key`` oder ``None`` zum Entfernen)."""
    reason = clean_reason(reason)
    product = await _product(db, product_id)
    _editable(product)
    if not isinstance(assignments, (list, tuple)) or not assignments:
        raise ShopError("Keine Zuordnung angegeben.")
    colors = (product.get("offer") or {}).get("colors") or []
    placements = [dict(row, designs=[dict(cell) for cell in row.get("designs") or []])
                  for row in product.get("placements") or []]
    by_key = {row["key"]: row for row in placements}
    changes = []
    for raw in assignments:
        if not isinstance(raw, dict) or set(raw) - {"placement", "color", "design_key"}:
            raise ShopError("Zuordnung: Platzierung, Farbe und Design.")
        row = by_key.get(raw.get("placement"))
        if not row or row["kind"] != "design":
            raise ShopError("Diese Platzierung nimmt kein Design (Platzierungen zuerst speichern).")
        color = _canonical(raw.get("color"), colors, "Farbe")
        key = raw.get("design_key")
        if key is not None:
            profile = await shop_designs.get_profile(db, str(key))
            if not profile:
                raise ShopError(f"Das Design „{key}“ gibt es nicht.")
            if profile["placement"] != row["key"]:
                raise ShopError(f"Das Design „{key}“ gehört zur Platzierung "
                                f"„{shop_designs.PLACEMENT_LABELS[profile['placement']]}“, nicht zu "
                                f"„{shop_designs.PLACEMENT_LABELS[row['key']]}“.")
            if not await shop_catalog.latest_design(db, key):
                raise ShopError(f"Zum Design „{key}“ gibt es noch keine Datei.")
        current = next((cell for cell in row["designs"] if cell["color"] == color), None)
        if (current or {}).get("design_key") == key:
            continue
        changes.append({"placement": row["key"], "color": color, "before": (current or {}).get("design_key"),
                        "after": key})
        row["designs"] = [cell for cell in row["designs"] if cell["color"] != color]
        if key is not None:
            row["designs"].append({"color": color, "design_key": key})
    if not changes:
        return product
    return await _save_content(db, product, {"placements": placements}, actor_id=actor_id, reason=reason,
                               action="shop.product.designs", data={"changes": changes})


# ---------------------------------------------------------------- 4. Preise

async def _offered(db, product: dict) -> list[tuple[dict, dict | None]]:
    variants = [variant for variant in await shop_catalog.variants_of(db, product["id"]) if variant.get("active")]
    mappings = await shop_catalog.printful_variants_for(db, [variant["id"] for variant in variants])
    return [(variant, mappings.get(variant["id"])) for variant in variants]


@_locked
async def accept_prices(db, product_id: str, *, actor_id: str, reason: Any) -> dict:
    """Die Einkaufspreise als Mitgliederpreis übernehmen (Selbstkostenpreis) - nur so kommen Preise von Printful in
    den Shop. Beendet offene Preiswarnungen des Abgleichs."""
    reason = clean_reason(reason)
    product = await _product(db, product_id)
    if product.get("status") == "archived":
        raise ShopConflict(NOT_EDITABLE_ARCHIVED)
    offered = await _offered(db, product)
    if not offered:
        raise ShopError("Erst Farben und Größen wählen (Schritt 2).")
    changes = []
    for variant, mapping in offered:
        cost = cost_cents(product, mapping)
        if cost is None:
            raise ShopError(f"Für {variant['label']} fehlt der Einkaufspreis von Printful - erst abgleichen.")
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


async def _design_cell(db, design_key: str, specs: dict) -> dict:
    profile = await shop_designs.get_profile(db, design_key)
    latest = await shop_catalog.latest_design(db, design_key)
    cell = {"design_key": design_key, "title": (profile or {}).get("title") or design_key,
            "version": (latest or {}).get("version"), "level": "missing", "text": "Keine Datei", "public_path": None}
    if not latest:
        return cell
    public = bool(latest.get("public_id")) and not latest.get("public_disabled_at")
    cell["public_path"] = shop_designs.public_path(latest) if public else None
    spec = specs.get(latest.get("placement")) or specs["front"]
    if latest.get("width_px") and latest.get("height_px"):
        fit = shop_designs.check_fit(int(latest["width_px"]), int(latest["height_px"]), spec)
        cell["level"], cell["text"] = fit["level"], fit["text"]
    else:
        cell["level"], cell["text"] = "unknown", "Ohne Maße gespeichert - neu hochladen."
    if not public:
        cell["level"], cell["text"] = "missing", "Die Datei ist nicht mehr öffentlich - Printful kann sie nicht holen."
    return cell


async def run_check(db, product: dict) -> dict:
    """Die Vorab-Prüfung: alles, was vor „geprüft“ stimmen muss - und dazu die Mockups vor „veröffentlicht“."""
    items = []
    printful = product.get("printful") or {}
    items.append(_item("printful", "Printful-Produkt", bool(printful) and not printful.get("is_discontinued"),
                       ("Eingestellt bei Printful." if printful.get("is_discontinued") else
                        f"{printful.get('name')} (Nr. {printful.get('product_id')})") if printful
                       else "Noch kein Printful-Produkt gewählt."))
    offered = await _offered(db, product)
    offer = product.get("offer") or {}
    items.append(_item("offer", "Farben und Größen", bool(offered),
                       f"{len(offered)} Varianten: {', '.join(offer.get('colors') or [])} in "
                       f"{', '.join(offer.get('sizes') or [])}" if offered else "Noch keine Farben und Größen gewählt."))
    personalization = product.get("personalization") or "none"
    kinds = {row.get("kind") for row in product.get("placements") or []}
    problems = []
    if product.get("visibility") == "public" and personalization != "none":
        problems.append(shop_catalog.PUBLIC_WITHOUT_PERSONALIZATION)
    if personalization in ("gamertag", "both") and "gamertag" not in kinds:
        problems.append("Personalisierung Gamertag, aber keine Gamertag-Platzierung.")
    if personalization in ("member_number", "both") and "member_number" not in kinds:
        problems.append("Personalisierung Vereinsnummer, aber keine Platzierung dafür.")
    if "gamertag" in kinds and personalization not in ("gamertag", "both"):
        problems.append("Gamertag-Platzierung ohne Personalisierung Gamertag.")
    if "member_number" in kinds and personalization not in ("member_number", "both"):
        problems.append("Vereinsnummer-Platzierung ohne Personalisierung Vereinsnummer.")
    items.append(_item("personalization", "Sichtbarkeit und Personalisierung", not problems,
                       " ".join(problems) or f"{shop_catalog.VISIBILITY_LABELS.get(product.get('visibility'))}, "
                                             f"Personalisierung: {shop_catalog.PERSONALIZATION_LABELS[personalization]}."))
    design_rows = [row for row in product.get("placements") or [] if row.get("kind") == "design"]
    items.append(_item("placements", "Platzierungen", bool(design_rows),
                       f"{len(product.get('placements') or [])} Platzierungen, davon {len(design_rows)} mit Design."
                       if design_rows else "Mindestens eine Platzierung mit einem Design des Vereins."))
    specs = await shop_designs.placement_specs(db)
    missing = []
    for row in design_rows:
        cells = {cell["color"]: cell["design_key"] for cell in row.get("designs") or []}
        bad = []
        for color in offer.get("colors") or []:
            key = cells.get(color)
            cell = await _design_cell(db, key, specs) if key else None
            if not cell or cell["level"] in ("missing", "too_low", "unknown"):
                bad.append(color)
        if bad:
            missing.append(f"{shop_designs.PLACEMENT_LABELS[row['key']]}: {', '.join(bad)}")
    files_ok = bool(design_rows) and bool(offer.get("colors")) and not missing
    items.append(_item("files", "Druckdateien je Farbe", files_ok,
                       "Jede angebotene Farbe hat an jeder Platzierung eine gültige Datei." if files_ok else
                       ("Ohne gültige Datei: " + "; ".join(missing)) if missing else "Noch keine Designs zugeordnet."))
    unavailable = [variant["label"] for variant, mapping in offered
                   if variant.get("blocked_reason") or (mapping or {}).get("in_stock") is not True]
    items.append(_item("stock", "Lieferbar", bool(offered) and not unavailable,
                       ("Nicht lieferbar oder Lager unbekannt: " + ", ".join(unavailable)) if unavailable else
                       "Alle angebotenen Varianten sind bei Printful lieferbar." if offered else "Keine Varianten."))
    unpriced, too_cheap = [], []
    minimum = (await shop_config.load(db))["min_price_cents"]
    for variant, mapping in offered:
        cost = cost_cents(product, mapping)
        if cost is None or variant.get("price_cents") != cost or (mapping or {}).get("price_warning"):
            unpriced.append(variant["label"])
        elif variant["price_cents"] < minimum:
            too_cheap.append(variant["label"])
    problems = []
    if unpriced:
        problems.append("Preis fehlt oder weicht vom Einkauf ab: " + ", ".join(unpriced))
    if too_cheap:
        problems.append(f"Unter dem Mindestpreis ({minimum // 100},{minimum % 100:02d} €): " + ", ".join(too_cheap))
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
    reason = clean_reason(reason)
    if status not in shop_catalog.STATUSES:
        raise ShopError("Unbekannter Stand.")
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

async def design_suggestions(db, product: dict) -> list[dict]:
    out = []
    for row in product.get("placements") or []:
        if row.get("kind") != "design":
            continue
        for color in (product.get("offer") or {}).get("colors") or []:
            found = await shop_designs.design_for_color(db, row["key"], color)
            if found:
                out.append({"placement": row["key"], "color": color, "design_key": found["profile"]["design_key"]})
    return out


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
            "id": variant["id"], "sku": variant["sku"], "label": variant["label"], "color": variant.get("color"),
            "size": variant.get("size"), "color_code": variant.get("color_code"), "active": bool(variant.get("active")),
            "blocked_reason": variant.get("blocked_reason"), "printful_variant_id": mapping.get("printful_variant_id"),
            "availability": mapping.get("availability"), "in_stock": mapping.get("in_stock"),
            "base_cost_cents": mapping.get("base_cost_cents"), "placement_costs": mapping.get("placement_costs") or {},
            "cost_cents": cost, "price_cents": price,
            "public_price_cents": price + effective if isinstance(price, int) else None,
            "suggested_public_cents": cost + effective if isinstance(cost, int) else None,
            "price_warning": mapping.get("price_warning"), "synced_at": mapping.get("synced_at")})
    specs = await shop_designs.placement_specs(db)
    included = included_placement(product)
    sample = next((mappings.get(variant["id"]) for variant in variants
                   if variant.get("active") and mappings.get(variant["id"])), None) or {}
    suggestions = await design_suggestions(db, product)
    placement_rows = []
    for row in product.get("placements") or []:
        cells = {}
        for cell in row.get("designs") or []:
            cells[cell["color"]] = await _design_cell(db, cell["design_key"], specs)
        placement_rows.append({
            "key": row["key"], "label": shop_designs.PLACEMENT_LABELS.get(row["key"], row["key"]), "kind": row["kind"],
            "kind_label": KIND_LABELS[row["kind"]], "printful_placement": row["printful_placement"],
            "position": row["position"], "position_text": _position_text(row["position"]),
            "area": _area(product, row["printful_placement"]),
            "included": row["printful_placement"] == included,
            "surcharge_cents": (sample.get("placement_costs") or {}).get(row["printful_placement"]),
            "designs": cells,
            "suggestions": {item["color"]: item["design_key"] for item in suggestions if item["placement"] == row["key"]},
        })
    options: dict[str, list[dict]] = {}
    async for profile in db.shop_design_profiles.find({}, {"_id": 0}).sort("design_key", 1):
        options.setdefault(profile["placement"], []).append(
            {"design_key": profile["design_key"], "title": profile.get("title"),
             "garment_colors": profile.get("garment_colors") or []})
    current = product.get("status") or "draft"
    return {
        "product": product,
        "labels": {"statuses": shop_catalog.STATUS_LABELS, "visibilities": shop_catalog.VISIBILITY_LABELS,
                   "personalizations": shop_catalog.PERSONALIZATION_LABELS, "kinds": KIND_LABELS,
                   "placements": shop_designs.PLACEMENT_LABELS},
        "variants": variant_rows,
        "placements": placement_rows,
        "available_placements": await available_placements(db, product) if product.get("printful") else [],
        "included_placement": included,
        "design_suggestions": suggestions,
        "design_options": options,
        "pricing": {"general_markup_cents": general, "product_markup_cents": own, "effective_markup_cents": effective,
                    "source": "product" if isinstance(own, int) else "general",
                    "member_markup_cents": shop_config.MEMBER_MARKUP_CENTS},
        "check": await run_check(db, product),
        "sync": product.get("catalog_sync"),
        "transitions": list(TRANSITIONS.get(current, ())),
        "editable": current not in ("active", "archived"),
        "limits": {"max_variants": MAX_OFFERED_VARIANTS, "min_size_in": MIN_SIZE_IN, "max_size_in": MAX_SIZE_IN},
    }


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
