"""Shop-Katalog (#1703): Produkte, Varianten, Druckdateien (Designs) und die Zuordnung Variante → Printful-Variante.

Einziger Weg, den Katalog zu schreiben. Jede Änderung ist eine Adminaktion der Finanzen und steht mit Person und Grund
im Protokoll (``shop_common.record_admin_action``, #1704); Preis- und Sichtbarkeitsänderungen bekommen eigene Einträge
mit vorher und nachher. Bestellungen lesen den Katalog nur beim Bestellen und frieren ihn ein
(``services/shop_orders.py``) - eine spätere Änderung hier wirkt nie zurück.

Sichere Vorgaben: ein neues Produkt ist ``draft`` und ``hidden``, ohne Steuerprofil (``None`` heißt „ungeklärt“, #1701 -
kein stilles „ohne Umsatzsteuer“). Beträge sind ganze Cent, nie negativ, mit festen Obergrenzen.
"""
from __future__ import annotations

import re
from typing import Any

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services.pricing import TAX_PROFILES
from services.shop_common import ShopConflict, ShopError, record_admin_action

STATUSES = ("draft", "active", "archived")
VISIBILITIES = ("hidden", "members", "public")
MAX_PRICE_CENTS = 100_000  # 1000 Euro je Artikel - alles darüber ist ein Tippfehler
MAX_MARKUP_CENTS = 10_000
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SKU = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
DESIGN_KEY = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
PLACEMENTS = ("front", "front_left", "front_right", "back", "sleeve_left", "sleeve_right", "label")
PRODUCT_FIELDS = ("slug", "title", "description", "status", "visibility", "base_price_cents", "markup_cents",
                  "gamertag_allowed", "tax_profile", "design_key")
VARIANT_FIELDS = ("sku", "label", "size", "color", "price_cents", "active")
PRICE_FIELDS = ("base_price_cents", "markup_cents", "price_cents")


def _text(value: Any, label: str, limit: int, *, required: bool = False) -> str | None:
    text = " ".join(str(value or "").split())
    if len(text) > limit:
        raise ShopError(f"{label} ist zu lang (höchstens {limit} Zeichen).")
    if required and not text:
        raise ShopError(f"{label} fehlt.")
    return text or None


def _cents(value: Any, label: str, limit: int, *, optional: bool = False) -> int | None:
    if value is None and optional:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ShopError(f"{label}: ganze Cent angeben.")
    if value < 0 or value > limit:
        raise ShopError(f"{label}: außerhalb des Rahmens (0 bis {limit} Cent).")
    return value


def _product_value(key: str, value: Any) -> Any:
    if key == "slug":
        slug = str(value or "").strip()
        if not SLUG.match(slug) or len(slug) > 80:
            raise ShopError("Slug: nur Kleinbuchstaben, Ziffern und Bindestriche.")
        return slug
    if key == "title":
        return _text(value, "Titel", 120, required=True)
    if key == "description":
        return _text(value, "Beschreibung", 2000)
    if key == "status":
        if value not in STATUSES:
            raise ShopError("Unbekannter Stand.")
        return value
    if key == "visibility":
        if value not in VISIBILITIES:
            raise ShopError("Unbekannte Sichtbarkeit.")
        return value
    if key == "base_price_cents":
        return _cents(value, "Preis", MAX_PRICE_CENTS)
    if key == "markup_cents":
        return _cents(value, "Vereinsaufschlag", MAX_MARKUP_CENTS)
    if key == "gamertag_allowed":
        if not isinstance(value, bool):
            raise ShopError("Gamertag: ja oder nein.")
        return value
    if key == "tax_profile":
        if value is not None and value not in TAX_PROFILES:
            raise ShopError("Unbekanntes Steuerprofil.")
        return value
    if key == "design_key":
        if value in (None, ""):
            return None
        if not DESIGN_KEY.match(str(value)):
            raise ShopError("Design: nur Kleinbuchstaben, Ziffern und Bindestriche.")
        return str(value)
    raise ShopError(f"Unbekanntes Feld: {key}.")


def _variant_value(key: str, value: Any) -> Any:
    if key == "sku":
        sku = str(value or "").strip()
        if not SKU.match(sku):
            raise ShopError("SKU: Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.")
        return sku
    if key == "label":
        return _text(value, "Bezeichnung", 80, required=True)
    if key in ("size", "color"):
        return _text(value, "Größe" if key == "size" else "Farbe", 40)
    if key == "price_cents":
        return _cents(value, "Preis", MAX_PRICE_CENTS, optional=True)
    if key == "active":
        if not isinstance(value, bool):
            raise ShopError("Aktiv: ja oder nein.")
        return value
    raise ShopError(f"Unbekanntes Feld: {key}.")


def _clean(fields: dict, allowed: tuple[str, ...], convert) -> dict:
    unknown = sorted(set(fields) - set(allowed))
    if unknown:
        raise ShopError(f"Unbekannte Felder: {', '.join(unknown)}.")
    return {key: convert(key, value) for key, value in fields.items()}


# ---------------------------------------------------------------- Produkte

async def create_product(db, fields: dict, *, actor_id: str, reason: str) -> dict:
    values = _clean(fields, PRODUCT_FIELDS, _product_value)
    for required in ("slug", "title", "base_price_cents"):
        if required not in values:
            raise ShopError(f"{required} fehlt.")
    now = now_utc().isoformat()
    product = {"id": new_id(), "description": None, "status": "draft", "visibility": "hidden", "markup_cents": 0,
               "gamertag_allowed": False, "tax_profile": None, "design_key": None, **values, "currency": "EUR",
               "version": 1, "created_at": now, "created_by": actor_id, "updated_at": now, "updated_by": actor_id}
    try:
        await db.shop_products.insert_one(dict(product))
    except DuplicateKeyError:
        raise ShopConflict("Diesen Slug gibt es schon.")
    await record_admin_action(db, "shop.product.create", actor_id=actor_id, target_id=product["id"], reason=reason,
                              data={"slug": product["slug"], "base_price_cents": product["base_price_cents"],
                                    "markup_cents": product["markup_cents"], "visibility": product["visibility"]})
    return product


async def get_product(db, product_id: str) -> dict | None:
    return await db.shop_products.find_one({"id": product_id}, {"_id": 0})


async def list_products(db, *, limit: int = 500) -> list[dict]:
    return await db.shop_products.find({}, {"_id": 0}).sort("title", 1).to_list(limit)


async def _log_changes(db, kind: str, target_id: str, before: dict, changed: list[str], *, actor_id: str, reason: str,
                       extra: dict) -> None:
    """Preis und Sichtbarkeit je ein eigener Eintrag mit vorher/nachher, der Rest als „geändert“."""
    def part(names):
        return ({name: before.get(name) for name in names}, {name: extra[name] for name in names})

    prices = [name for name in changed if name in PRICE_FIELDS]
    if prices:
        was, now = part(prices)
        await record_admin_action(db, "shop.product.price", actor_id=actor_id, target_id=target_id, reason=reason,
                                  data={"kind": kind, "before": was, "after": now})
    if "visibility" in changed:
        was, now = part(["visibility"])
        await record_admin_action(db, "shop.product.visibility", actor_id=actor_id, target_id=target_id, reason=reason,
                                  data={"before": was, "after": now})
    rest = [name for name in changed if name not in PRICE_FIELDS and name != "visibility"]
    if rest:
        action = "shop.product.update" if kind == "product" else "shop.variant.update"
        await record_admin_action(db, action, actor_id=actor_id, target_id=target_id, reason=reason,
                                  data={"fields": rest})


async def update_product(db, product_id: str, fields: dict, *, actor_id: str, reason: str) -> tuple[dict, list[str]]:
    """Ändert ein Produkt. Liefert das Produkt und die geänderten Felder; ohne Änderung kein Protokolleintrag."""
    values = _clean(fields, PRODUCT_FIELDS, _product_value)
    product = await get_product(db, product_id)
    if not product:
        raise LookupError("Produkt nicht gefunden.")
    changed = sorted(key for key, value in values.items() if product.get(key) != value)
    if not changed:
        return product, []
    now = now_utc().isoformat()
    update = {key: values[key] for key in changed}
    try:
        result = await db.shop_products.update_one(
            {"id": product_id, "version": product.get("version", 1)},
            {"$set": {**update, "updated_at": now, "updated_by": actor_id}, "$inc": {"version": 1}})
    except DuplicateKeyError:
        raise ShopConflict("Diesen Slug gibt es schon.")
    if getattr(result, "matched_count", 0) != 1:
        raise ShopConflict("Das Produkt wurde gerade geändert - bitte neu laden.")
    await _log_changes(db, "product", product_id, product, changed, actor_id=actor_id, reason=reason, extra=update)
    return await get_product(db, product_id), changed


# ---------------------------------------------------------------- Varianten

async def create_variant(db, product_id: str, fields: dict, *, actor_id: str, reason: str) -> dict:
    values = _clean(fields, VARIANT_FIELDS, _variant_value)
    for required in ("sku", "label"):
        if required not in values:
            raise ShopError(f"{required} fehlt.")
    if not await get_product(db, product_id):
        raise LookupError("Produkt nicht gefunden.")
    now = now_utc().isoformat()
    variant = {"id": new_id(), "product_id": product_id, "size": None, "color": None, "price_cents": None,
               "active": True, **values, "version": 1, "created_at": now, "created_by": actor_id, "updated_at": now,
               "updated_by": actor_id}
    try:
        await db.shop_variants.insert_one(dict(variant))
    except DuplicateKeyError:
        raise ShopConflict("Diese SKU gibt es schon.")
    await record_admin_action(db, "shop.variant.create", actor_id=actor_id, target_id=product_id, reason=reason,
                              data={"variant_id": variant["id"], "sku": variant["sku"],
                                    "price_cents": variant["price_cents"]})
    return variant


async def get_variant(db, variant_id: str) -> dict | None:
    return await db.shop_variants.find_one({"id": variant_id}, {"_id": 0})


async def variants_of(db, product_id: str) -> list[dict]:
    return await db.shop_variants.find({"product_id": product_id}, {"_id": 0}).sort("sku", 1).to_list(200)


async def update_variant(db, variant_id: str, fields: dict, *, actor_id: str, reason: str) -> tuple[dict, list[str]]:
    values = _clean(fields, VARIANT_FIELDS, _variant_value)
    variant = await get_variant(db, variant_id)
    if not variant:
        raise LookupError("Variante nicht gefunden.")
    changed = sorted(key for key, value in values.items() if variant.get(key) != value)
    if not changed:
        return variant, []
    update = {key: values[key] for key in changed}
    try:
        result = await db.shop_variants.update_one(
            {"id": variant_id, "version": variant.get("version", 1)},
            {"$set": {**update, "updated_at": now_utc().isoformat(), "updated_by": actor_id}, "$inc": {"version": 1}})
    except DuplicateKeyError:
        raise ShopConflict("Diese SKU gibt es schon.")
    if getattr(result, "matched_count", 0) != 1:
        raise ShopConflict("Die Variante wurde gerade geändert - bitte neu laden.")
    await _log_changes(db, "variant", variant["product_id"], variant, changed, actor_id=actor_id, reason=reason,
                       extra=update)
    return await get_variant(db, variant_id), changed


# ---------------------------------------------------------------- Druckdateien und Printful-Zuordnung

async def add_design_version(db, design_key: str, *, file_ref: str, sha256: str, placement: str, actor_id: str,
                             reason: str) -> dict:
    """Neue Fassung einer Druckdatei: Version zählt hoch, Prüfsumme ist Pflicht. Alte Fassungen bleiben - eine
    Bestellung zeigt auf die Fassung, die beim Bestellen galt. Die Datei selbst liegt im Speicher (#1708)."""
    if not DESIGN_KEY.match(str(design_key or "")):
        raise ShopError("Design: nur Kleinbuchstaben, Ziffern und Bindestriche.")
    if not SHA256.match(str(sha256 or "")):
        raise ShopError("Prüfsumme: SHA-256 als 64 Hex-Zeichen.")
    if placement not in PLACEMENTS:
        raise ShopError("Unbekannte Druckposition.")
    ref = _text(file_ref, "Datei", 300, required=True)
    for _attempt in range(3):
        latest = await latest_design(db, design_key)
        design = {"id": new_id(), "design_key": design_key, "version": (latest or {}).get("version", 0) + 1,
                  "file_ref": ref, "sha256": sha256, "placement": placement, "created_at": now_utc().isoformat(),
                  "created_by": actor_id}
        try:
            await db.shop_designs.insert_one(dict(design))
        except DuplicateKeyError:
            continue  # gleichzeitig eine Fassung angelegt - die nächste Nummer nehmen
        await record_admin_action(db, "shop.design.add", actor_id=actor_id, target_id=design_key, reason=reason,
                                  data={"version": design["version"], "sha256": sha256, "placement": placement})
        return design
    raise ShopConflict("Die Druckdatei wurde gerade mehrfach geändert - bitte erneut versuchen.")


async def latest_design(db, design_key: str) -> dict | None:
    rows = await db.shop_designs.find({"design_key": design_key}, {"_id": 0}).sort("version", -1).to_list(1)
    return rows[0] if rows else None


async def set_printful_variant(db, variant_id: str, *, printful_variant_id: int, printful_product_id: int | None,
                               actor_id: str, reason: str) -> dict:
    """Zuordnung Variante → Printful-Variante (#1709 füllt sie aus dem Katalogabgleich). Je Variante eine."""
    for label, value in (("Printful-Variante", printful_variant_id), ("Printful-Produkt", printful_product_id)):
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value <= 0):
            raise ShopError(f"{label}: positive Zahl.")
    if not await get_variant(db, variant_id):
        raise LookupError("Variante nicht gefunden.")
    row = {"provider": "printful", "variant_id": variant_id, "printful_variant_id": printful_variant_id,
           "printful_product_id": printful_product_id, "updated_at": now_utc().isoformat(), "updated_by": actor_id}
    await db.shop_printful_variants.update_one({"provider": "printful", "variant_id": variant_id}, {"$set": row},
                                               upsert=True)
    await record_admin_action(db, "shop.printful_variant.set", actor_id=actor_id, target_id=variant_id, reason=reason,
                              data={"printful_variant_id": printful_variant_id,
                                    "printful_product_id": printful_product_id})
    return row


async def printful_variant_for(db, variant_id: str) -> dict | None:
    return await db.shop_printful_variants.find_one({"provider": "printful", "variant_id": variant_id}, {"_id": 0})
