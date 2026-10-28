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
from contextlib import asynccontextmanager
from typing import Any

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services import shop_config
from services.mutation_lock import MutationLockBusy, mutation_lock
from services.pricing import TAX_PROFILES
from services.shop_common import MODEL_FIELDS, ShopConflict, ShopError, record_admin_action

# Stand (#1707): Entwurf → geprüft → veröffentlicht (``active``) → archiviert. Den Stand ändert nur
# ``shop_products.set_status`` nach der Vorab-Prüfung - nie ein gewöhnliches Speichern.
STATUSES = ("draft", "reviewed", "active", "archived")
STATUS_LABELS = {"draft": "Entwurf", "reviewed": "geprüft", "active": "veröffentlicht", "archived": "archiviert"}
VISIBILITIES = ("hidden", "members", "public")
VISIBILITY_LABELS = {"public": "öffentlich (mit Konto)", "members": "nur Mitglieder", "hidden": "nur intern"}
# Personalisierung je Produkt (#1707). Öffentliche Produkte haben nie eine - der Server lehnt die Kombination ab.
PERSONALIZATIONS = ("none", "gamertag", "member_number", "both")
PERSONALIZATION_LABELS = {"none": "keine", "gamertag": "Gamertag", "member_number": "Vereinsnummer",
                          "both": "Gamertag und Vereinsnummer"}
PUBLIC_WITHOUT_PERSONALIZATION = ("Öffentliche Produkte haben keine Personalisierung - entweder „nur Mitglieder“ "
                                  "bzw. „nur intern“ wählen oder die Personalisierung auf „keine“ setzen.")
STATUS_ONLY_BY_CHECK = "Den Stand ändert nur die Prüfung (Schritt „Prüfen und veröffentlichen“)."
MAX_PRICE_CENTS = 100_000  # 1000 Euro je Artikel - alles darüber ist ein Tippfehler
MAX_MARKUP_CENTS = 10_000
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SKU = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
DESIGN_KEY = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
PLACEMENTS = ("front", "front_left", "front_right", "back", "sleeve_left", "sleeve_right", "label")
PRODUCT_FIELDS = ("slug", "title", "description", "visibility", "base_price_cents", "markup_cents",
                  "personalization", "tax_profile", "design_key")
VARIANT_FIELDS = ("sku", "label", "size", "color", "price_cents", "active")
PRICE_FIELDS = ("base_price_cents", "markup_cents", "price_cents")
# Was der Produktaufbau (``services/shop_products.py``) schreibt - nur über ``save_setup``.
SETUP_FIELDS = ("printful", "technique", "offer", "placements", "included_placement", "status", "review",
                "published_at", "archived_at", "placements_legacy", "print_surface")
_UMLAUTS = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "Ä": "ae", "Ö": "oe", "Ü": "ue"})


def slugify(text: str) -> str:
    """Slug aus dem Titel: Kleinbuchstaben, Ziffern, Bindestriche; Umlaute ausgeschrieben (ä → ae, ß → ss)."""
    plain = str(text or "").translate(_UMLAUTS).lower()
    return "-".join(re.findall(r"[a-z0-9]+", plain))[:80].strip("-")


def allows_gamertag(product: dict) -> bool:
    """Gamertag bestellbar? Aus der Personalisierung; ältere Produkte ohne sie aus ``gamertag_allowed``."""
    if product.get("personalization") in PERSONALIZATIONS:
        return product["personalization"] in ("gamertag", "both")
    return bool(product.get("gamertag_allowed"))


def _check_personalization(product: dict) -> None:
    if product.get("visibility") == "public" and product.get("personalization", "none") != "none":
        raise ShopError(PUBLIC_WITHOUT_PERSONALIZATION)


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
    if key == "personalization":
        if value not in PERSONALIZATIONS:
            raise ShopError("Unbekannte Personalisierung.")
        return value
    if key == "visibility":
        if value not in VISIBILITIES:
            raise ShopError("Unbekannte Sichtbarkeit.")
        return value
    if key == "base_price_cents":
        # Ohne Printful von Hand; mit Printful trägt jede Variante ihren Preis aus dem Einkauf (#1707).
        return _cents(value, "Preis", MAX_PRICE_CENTS, optional=True)
    if key == "markup_cents":
        # Leer heißt „der allgemeine öffentliche Aufschlag gilt“; ein Wert (auch 0) ersetzt ihn (#1707).
        return _cents(value, "Vereinsaufschlag", MAX_MARKUP_CENTS, optional=True)
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
    if "status" in fields and allowed is PRODUCT_FIELDS:
        raise ShopError(STATUS_ONLY_BY_CHECK)
    unknown = sorted(set(fields) - set(allowed))
    if unknown:
        raise ShopError(f"Unbekannte Felder: {', '.join(unknown)}.")
    return {key: convert(key, value) for key, value in fields.items()}


# ---------------------------------------------------------------- Produkte

async def create_product(db, fields: dict, *, actor_id: str, reason: str) -> dict:
    """Neues Produkt - immer als Entwurf. Nur der Titel ist Pflicht; der Slug folgt sonst aus dem Titel."""
    values = _clean(fields, PRODUCT_FIELDS, _product_value)
    if "title" not in values:
        raise ShopError("title fehlt.")
    if "slug" not in values:
        values["slug"] = _product_value("slug", slugify(values["title"]) or "produkt")
    if values.get("base_price_cents") is not None:
        await _check_min_price(db, values["base_price_cents"])
    now = now_utc().isoformat()
    product = {"id": new_id(), "description": None, "status": "draft", "visibility": "hidden", "markup_cents": None,
               "base_price_cents": None, "personalization": "none", "tax_profile": None, "design_key": None, **values,
               "currency": "EUR", "version": 1, "created_at": now, "created_by": actor_id, "updated_at": now,
               "updated_by": actor_id}
    product["gamertag_allowed"] = allows_gamertag(product)
    _check_personalization(product)
    try:
        await db.shop_products.insert_one(dict(product))
    except DuplicateKeyError:
        raise ShopConflict("Diesen Slug gibt es schon.")
    await record_admin_action(db, "shop.product.create", actor_id=actor_id, target_id=product["id"], reason=reason,
                              data={"slug": product["slug"], "base_price_cents": product["base_price_cents"],
                                    "markup_cents": product["markup_cents"], "visibility": product["visibility"],
                                    "personalization": product["personalization"]})
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
    merged = {**product, **update}
    _check_personalization(merged)
    structural = sorted(set(update) - set(TEXT_FIELDS))
    _check_editable(product, structural)
    if update.get("base_price_cents") is not None:
        await _check_min_price(db, update["base_price_cents"])
    extra_set: dict = {}
    if "personalization" in update:
        extra_set["gamertag_allowed"] = allows_gamertag(merged)
    if structural and product.get("status") == "reviewed":
        # Preis, Sichtbarkeit, Aufschlag, Personalisierung … gehören zur Prüfung - geprüft gilt nicht mehr.
        extra_set.update(status="draft", review=None)
    try:
        result = await db.shop_products.update_one(
            {"id": product_id, "version": product.get("version", 1)},
            {"$set": {**update, **extra_set, "updated_at": now, "updated_by": actor_id}, "$inc": {"version": 1}})
    except DuplicateKeyError:
        raise ShopConflict("Diesen Slug gibt es schon.")
    if getattr(result, "matched_count", 0) != 1:
        raise ShopConflict("Das Produkt wurde gerade geändert - bitte neu laden.")
    await _log_changes(db, "product", product_id, product, changed, actor_id=actor_id, reason=reason, extra=update)
    if extra_set.get("status"):
        await _log_back_to_draft(db, product_id, actor_id=actor_id, reason=reason,
                                 cause=f"geändert: {', '.join(structural)}")
    return await get_product(db, product_id), changed


# ---------------------------------------------------------------- Regeln für die alten Wege (#1707)
# PATCH Produkt/Variante, Variante anlegen, Printful-Zuordnung von Hand: dieselben Regeln wie der geführte Aufbau.
# Veröffentlicht oder archiviert ändert man nur Titel und Beschreibung; geprüft fällt bei jeder anderen Änderung auf
# „Entwurf“; Preise und Angebot eines Printful-Produkts nur über „Preise übernehmen“ bzw. „Farben und Größen“.

TEXT_FIELDS = ("title", "description")
NOT_EDITABLE_ACTIVE = "Veröffentlicht: zum Ändern das Produkt erst zurückziehen (zurück auf „Entwurf“)."
NOT_EDITABLE_ARCHIVED = "Archiviert: zum Ändern erst wieder als Entwurf öffnen."
PRINTFUL_PRICES = "Preise eines Printful-Produkts nur über „Preise übernehmen“ (Schritt Preise)."
PRINTFUL_OFFER = "Varianten eines Printful-Produkts entstehen aus „Farben und Größen“ (Schritt 2)."


def _check_editable(product: dict, structural: list[str]) -> None:
    if not structural:
        return
    if product.get("status") == "active":
        raise ShopConflict(NOT_EDITABLE_ACTIVE)
    if product.get("status") == "archived":
        raise ShopConflict(NOT_EDITABLE_ARCHIVED)


async def _check_min_price(db, cents: int | None) -> None:
    shop_config.check_min_price(await shop_config.load(db), cents)


async def _log_back_to_draft(db, product_id: str, *, actor_id: str, reason: str, cause: str) -> None:
    await record_admin_action(db, "shop.product.status", actor_id=actor_id, target_id=product_id, reason=reason,
                              data={"before": {"status": "reviewed"}, "after": {"status": "draft"}, "cause": cause})


async def _variant_change_allowed(db, product: dict, changed: list[str], *, actor_id: str, reason: str) -> None:
    """Prüft eine Änderung an Varianten bzw. ihrer Zuordnung und setzt „geprüft“ zurück auf „Entwurf“."""
    _check_editable(product, changed)
    if product.get("printful"):
        if "price_cents" in changed:
            raise ShopError(PRINTFUL_PRICES)
        if set(changed) - {"label"}:
            raise ShopError(PRINTFUL_OFFER)
    if changed:
        await _reset_reviewed(db, product, cause=f"Variante geändert: {', '.join(changed)}", actor_id=actor_id,
                              reason=reason)


async def _reset_reviewed(db, product: dict, *, cause: str, actor_id: str, reason: str) -> None:
    if product.get("status") == "reviewed":
        result = await db.shop_products.update_one(
            {"id": product["id"], "version": product.get("version", 1)},
            {"$set": {"status": "draft", "review": None, "updated_at": now_utc().isoformat(), "updated_by": actor_id},
             "$inc": {"version": 1}})
        if getattr(result, "matched_count", 0) != 1:
            raise ShopConflict("Das Produkt wurde gerade geändert - bitte neu laden.")
        await _log_back_to_draft(db, product["id"], actor_id=actor_id, reason=reason, cause=cause)


async def save_setup(db, product: dict, update: dict, *, actor_id: str) -> dict:
    """Schreibt den Produktaufbau (#1707) - nur ``SETUP_FIELDS``, geprüft und protokolliert von
    ``services/shop_products.py``. Mit Versionsprüfung: wer gleichzeitig ändert, bekommt 409."""
    unknown = sorted(set(update) - set(SETUP_FIELDS))
    if unknown:
        raise ShopError(f"Unbekannte Felder: {', '.join(unknown)}.")
    if "status" in update and update["status"] not in STATUSES:
        raise ShopError("Unbekannter Stand.")
    result = await db.shop_products.update_one(
        {"id": product["id"], "version": product.get("version", 1)},
        {"$set": {**update, "updated_at": now_utc().isoformat(), "updated_by": actor_id}, "$inc": {"version": 1}})
    if getattr(result, "matched_count", 0) != 1:
        raise ShopConflict("Das Produkt wurde gerade geändert - bitte neu laden.")
    return await get_product(db, product["id"])


PRODUCT_BUSY = "Das Produkt wird gerade geändert oder mit Printful abgeglichen - bitte gleich noch einmal."


@asynccontextmanager
async def product_lock(db, product_id: str, *, wait_seconds: float = 5.0):
    """Schreiben am Aufbau eines Produkts und der Schreibteil des Abgleichs (#1709) nacheinander - auch über mehrere
    Prozesse (MongoDB-Sperre mit Ablauf). Besetzt: ``ShopConflict``."""
    try:
        async with mutation_lock(db, f"shop:product:{product_id}", wait_seconds=wait_seconds, lease_seconds=60.0):
            yield
    except MutationLockBusy as exc:
        raise ShopConflict(PRODUCT_BUSY) from exc


async def record_catalog_sync(db, product_id: str, state: dict) -> None:
    """Stand des letzten Abgleichs mit Printful (#1709) - ohne Versionssprung: er ändert keine Entscheidung der
    Finanzen, und ein gleichzeitiges Speichern im Admin soll daran nicht scheitern."""
    await db.shop_products.update_one({"id": product_id}, {"$set": {"catalog_sync": state}})


# ---------------------------------------------------------------- Varianten

async def create_variant(db, product_id: str, fields: dict, *, actor_id: str, reason: str) -> dict:
    values = _clean(fields, VARIANT_FIELDS, _variant_value)
    for required in ("sku", "label"):
        if required not in values:
            raise ShopError(f"{required} fehlt.")
    product = await get_product(db, product_id)
    if not product:
        raise LookupError("Produkt nicht gefunden.")
    _check_editable(product, ["variant"])
    if product.get("printful"):
        raise ShopError(PRINTFUL_OFFER)
    await _check_min_price(db, values.get("price_cents"))
    await _variant_change_allowed(db, product, ["variant"], actor_id=actor_id, reason=reason)
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
    product = await get_product(db, variant["product_id"]) or {}
    _check_editable(product, changed)
    if update.get("price_cents") is not None:
        await _check_min_price(db, update["price_cents"])
    await _variant_change_allowed(db, product, changed, actor_id=actor_id, reason=reason)
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

DESIGN_CORE = ("id", "design_key", "version", "file_ref", "sha256", "placement", "created_at", "created_by")


async def add_design_version(db, design_key: str, *, file_ref: str, sha256: str, placement: str, actor_id: str,
                             reason: str, details: dict | None = None) -> dict:
    """Neue Fassung einer Druckdatei: Version zählt hoch, Prüfsumme ist Pflicht. Alte Fassungen bleiben - eine
    Bestellung zeigt auf die Fassung, die beim Bestellen galt. Die Datei selbst liegt im Speicher (#1708,
    ``services/shop_designs.py``); ``details`` trägt deren Maße und öffentlichen Schlüssel - nur Felder des Modells."""
    if not DESIGN_KEY.match(str(design_key or "")):
        raise ShopError("Design: nur Kleinbuchstaben, Ziffern und Bindestriche.")
    if not SHA256.match(str(sha256 or "")):
        raise ShopError("Prüfsumme: SHA-256 als 64 Hex-Zeichen.")
    if placement not in PLACEMENTS:
        raise ShopError("Unbekannte Druckposition.")
    extra = dict(details or {})
    unknown = sorted(set(extra) - set(MODEL_FIELDS["shop_designs"]) | set(extra) & set(DESIGN_CORE))
    if unknown:
        raise ShopError(f"Unbekannte Felder der Druckdatei: {', '.join(unknown)}.")
    ref = _text(file_ref, "Datei", 300, required=True)
    for _attempt in range(3):
        # Die Nummer zählt über alle Fassungen eines Motivs - auch die für helle Shirts (#2069).
        latest = await _newest_design_row(db, design_key)
        design = {**extra, "id": new_id(), "design_key": design_key,
                  "version": (latest or {}).get("version", 0) + 1, "file_ref": ref, "sha256": sha256,
                  "placement": placement, "created_at": now_utc().isoformat(), "created_by": actor_id}
        try:
            await db.shop_designs.insert_one(dict(design))
        except DuplicateKeyError:
            continue  # gleichzeitig eine Fassung angelegt - die nächste Nummer nehmen
        await record_admin_action(db, "shop.design.add", actor_id=actor_id, target_id=design_key, reason=reason,
                                  data={"version": design["version"], "sha256": sha256, "placement": placement,
                                        **{name: extra[name] for name in ("width_px", "height_px", "dpi", "variant",
                                                                          "origin", "source_format")
                                           if name in extra}})
        return design
    raise ShopConflict("Die Druckdatei wurde gerade mehrfach geändert - bitte erneut versuchen.")


async def _newest_design_row(db, design_key: str) -> dict | None:
    rows = await db.shop_designs.find({"design_key": design_key}, {"_id": 0}).sort("version", -1).to_list(1)
    return rows[0] if rows else None


async def latest_design(db, design_key: str) -> dict | None:
    """Die neueste Hauptdatei („für dunkle Shirts“) eines Designs bzw. Motivs. Fassungen für helle Shirts (#2069,
    ``variant = "light"``) zählen hier nicht - die wählt ``shop_motifs.file_for_garment`` je Shirtfarbe. Halbe Paare
    (#2084, ``pending``) auch nicht: sie gelten erst, wenn beide Fassungen liegen."""
    rows = await db.shop_designs.find({"design_key": design_key, "variant": {"$ne": "light"}, "pending": {"$ne": True}},
                                      {"_id": 0}).sort("version", -1).to_list(1)
    return rows[0] if rows else None


async def set_printful_variant(db, variant_id: str, *, printful_variant_id: int, printful_product_id: int | None,
                               actor_id: str, reason: str) -> dict:
    """Zuordnung Variante → Printful-Variante (#1709 füllt sie aus dem Katalogabgleich). Je Variante eine."""
    for label, value in (("Printful-Variante", printful_variant_id), ("Printful-Produkt", printful_product_id)):
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value <= 0):
            raise ShopError(f"{label}: positive Zahl.")
    variant = await get_variant(db, variant_id)
    if not variant:
        raise LookupError("Variante nicht gefunden.")
    product = await get_product(db, variant["product_id"]) or {}
    _check_editable(product, ["printful_variant"])
    printful = product.get("printful") or {}
    if printful:
        # Gegen Verwechslungen (#1709): nur Nummern aus dem geladenen Katalog genau dieses Produkts.
        known = {row.get("id") for row in printful.get("variants") or []}
        if printful_product_id != printful.get("product_id") or printful_variant_id not in known:
            raise ShopError("Diese Printful-Nummer gehört nicht zum gewählten Printful-Produkt "
                            f"({printful.get('product_id')}) - Produkt- und Variantennummer prüfen.")
    await _reset_reviewed(db, product, cause="Printful-Zuordnung geändert", actor_id=actor_id, reason=reason)
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


async def printful_variants_for(db, variant_ids: list[str]) -> dict[str, dict]:
    rows = await db.shop_printful_variants.find({"provider": "printful", "variant_id": {"$in": list(variant_ids)}},
                                                {"_id": 0}).to_list(len(variant_ids) or 1)
    return {row["variant_id"]: row for row in rows}


# ---------------------------------------------------------------- Varianten aus dem Printful-Katalog (#1707, #1709)
# Schreiben nur ``services/shop_products.py`` (Angebot, Preise übernehmen) und ``services/shop_catalog_sync.py``
# (Abgleich). Sie protokollieren je Schritt einen Eintrag mit Grund - nicht je Variante.

MAPPING_FIELDS = ("printful_variant_id", "printful_product_id", "technique", "currency", "base_cost_cents",
                  "placement_costs", "availability", "in_stock", "synced_at", "price_warning",
                  # Bruttoschätzung je Variante (#2135, ``services/shop_pricing.py``)
                  "gross_estimate")
VARIANT_STATE_FIELDS = ("active", "price_cents", "blocked_reason", "blocked_at", "label", "size", "color",
                        "color_code", "price_source")


def catalog_sku(product_id: str, printful_variant_id: int) -> str:
    """Stabil, auch wenn sich der Slug ändert; dieselbe Printful-Variante darf in zwei Produkten stecken."""
    return f"PF{printful_variant_id}-{str(product_id).replace('-', '')[:8]}"


async def ensure_catalog_variant(db, product_id: str, *, printful_variant_id: int, label: str, size: str,
                                 color: str, color_code: str | None, actor_id: str) -> dict:
    sku = catalog_sku(product_id, printful_variant_id)
    existing = await db.shop_variants.find_one({"product_id": product_id, "sku": sku}, {"_id": 0})
    if existing:
        return existing
    now = now_utc().isoformat()
    variant = {"id": new_id(), "product_id": product_id, "sku": sku, "label": _text(label, "Bezeichnung", 80),
               "size": _text(size, "Größe", 40), "color": _text(color, "Farbe", 40), "color_code": color_code,
               "price_cents": None, "active": False, "blocked_reason": None, "blocked_at": None, "version": 1,
               "created_at": now, "created_by": actor_id, "updated_at": now, "updated_by": actor_id}
    try:
        await db.shop_variants.insert_one(dict(variant))
    except DuplicateKeyError:
        raise ShopConflict("Diese Variante wurde gerade angelegt - bitte neu laden.")
    return variant


async def set_variant_state(db, variant_id: str, fields: dict, *, actor_id: str) -> None:
    unknown = sorted(set(fields) - set(VARIANT_STATE_FIELDS))
    if unknown:
        raise ShopError(f"Unbekannte Felder: {', '.join(unknown)}.")
    if "price_cents" in fields:
        _cents(fields["price_cents"], "Preis", MAX_PRICE_CENTS, optional=True)
    await db.shop_variants.update_one(
        {"id": variant_id}, {"$set": {**fields, "updated_at": now_utc().isoformat(), "updated_by": actor_id},
                             "$inc": {"version": 1}})


async def set_catalog_mapping(db, variant_id: str, fields: dict, *, actor_id: str) -> None:
    unknown = sorted(set(fields) - set(MAPPING_FIELDS))
    if unknown:
        raise ShopError(f"Unbekannte Felder: {', '.join(unknown)}.")
    for label in ("printful_variant_id", "printful_product_id"):
        value = fields.get(label)
        if label in fields and (isinstance(value, bool) or not isinstance(value, int) or value <= 0):
            raise ShopError(f"{label}: positive Zahl.")
    await db.shop_printful_variants.update_one(
        {"provider": "printful", "variant_id": variant_id},
        {"$set": {**fields, "provider": "printful", "variant_id": variant_id, "updated_at": now_utc().isoformat(),
                  "updated_by": actor_id}}, upsert=True)
