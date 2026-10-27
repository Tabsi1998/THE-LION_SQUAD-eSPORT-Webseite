"""Shop im Adminbereich (#1704): nur der Bereich „Finanzen“ (``finance``, mit Zwei-Faktor) - Club-Admin und Superadmin
bringen ihn mit, andere bekommen ihn als Freigabe. Kein eigener Bereich.

Dieses Fundament liest Produkte und Bestellungen und legt Produkte und Varianten an bzw. ändert sie. Jede Änderung
braucht einen Grund und steht im Protokoll der Adminaktionen (``services/shop_catalog``); Lesen ist keine
Adminaktion. Die Bestellliste zeigt keine Anschriften. Öffentliche Shop-Routen gibt es nicht - der Shop bleibt von
außen unsichtbar, bis die Shop-Seiten (#1712) stehen; die fragen dann ``services/shop_access``.

Einstellungen (#1706, ``services/shop_config``): Stufe, Notschalter, Preise, Printful-Zugang. Jede Änderung mit Grund
als Aktion ``shop.config``. „Öffentlich“ und die Freigabe „Steuer geklärt“ nur Superadmin; den Printful-Zugang
hinterlegt nur, wer zusätzlich den Bereich System hat. Alle Routen hängen trotzdem an ``require_area("finance")``
(Regel 3 in ``scripts/check-code-patterns.py``); die strengeren Rechte prüft die Route selbst.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from auth import require_area
from database import get_db
from services import printful_client, shop_catalog, shop_config, shop_orders
from services.permissions import can_use_area, is_superadmin
from services.shop_common import ShopConflict, ShopError

router = APIRouter(prefix="/api/admin/shop", tags=["shop"])


class Reasoned(BaseModel):
    """Jede Änderung mit Grund; unbekannte Felder (etwa ein Preis an falscher Stelle) werden abgelehnt."""
    model_config = {"extra": "forbid"}

    reason: str = Field(..., min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def _reason_has_text(cls, value: str) -> str:
        if len(value.strip()) < 3:
            raise ValueError("Bitte einen Grund angeben.")
        return value.strip()


class ProductFields(Reasoned):
    """Den Stand gibt es hier nicht: ihn ändert nur die Prüfung (``POST /products/{id}/status``, #1707).
    ``markup_cents: null`` heißt „der allgemeine öffentliche Aufschlag gilt“; ein Wert (auch 0) ersetzt ihn."""
    title: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)
    visibility: Literal["hidden", "members", "public"] | None = None
    personalization: Literal["none", "gamertag", "member_number", "both"] | None = None
    base_price_cents: int | None = Field(None, ge=0, le=shop_catalog.MAX_PRICE_CENTS)
    markup_cents: int | None = Field(None, ge=0, le=shop_catalog.MAX_MARKUP_CENTS)
    tax_profile: str | None = Field(None, max_length=20)
    design_key: str | None = Field(None, max_length=80)


class ProductCreate(ProductFields):
    slug: str | None = Field(None, min_length=1, max_length=80)
    title: str = Field(..., min_length=1, max_length=120)


class ProductUpdate(ProductFields):
    slug: str | None = Field(None, min_length=1, max_length=80)


class VariantFields(Reasoned):
    label: str | None = Field(None, min_length=1, max_length=80)
    size: str | None = Field(None, max_length=40)
    color: str | None = Field(None, max_length=40)
    price_cents: int | None = Field(None, ge=0, le=shop_catalog.MAX_PRICE_CENTS)
    active: bool | None = None


class VariantCreate(VariantFields):
    sku: str = Field(..., min_length=1, max_length=64)
    label: str = Field(..., min_length=1, max_length=80)


class VariantUpdate(VariantFields):
    sku: str | None = Field(None, min_length=1, max_length=64)


def _fields(body: BaseModel) -> dict:
    """Nur, was die Anfrage wirklich mitgibt - ein weggelassenes Feld bleibt, ``null`` leert es."""
    return {key: value for key, value in body.model_dump(exclude_unset=True).items() if key != "reason"}


def _refused(exc: Exception) -> HTTPException:
    if isinstance(exc, LookupError):
        return HTTPException(404, str(exc))
    if isinstance(exc, ShopConflict):
        return HTTPException(409, str(exc))
    return HTTPException(400, str(exc))


@router.get("/products")
async def list_products(me: dict = Depends(require_area("finance"))):
    return {"products": await shop_catalog.list_products(get_db()), "statuses": shop_catalog.STATUSES,
            "visibilities": shop_catalog.VISIBILITIES}


@router.post("/products")
async def create_product(body: ProductCreate, me: dict = Depends(require_area("finance"))):
    try:
        product = await shop_catalog.create_product(get_db(), _fields(body), actor_id=me["id"], reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return {"product": product}


@router.get("/products/{product_id}")
async def product_detail(product_id: str, me: dict = Depends(require_area("finance"))):
    db = get_db()
    product = await shop_catalog.get_product(db, product_id)
    if not product:
        raise HTTPException(404, "Produkt nicht gefunden.")
    return {"product": product, "variants": await shop_catalog.variants_of(db, product_id)}


@router.patch("/products/{product_id}")
async def update_product(product_id: str, body: ProductUpdate, me: dict = Depends(require_area("finance"))):
    try:
        product, changed = await shop_catalog.update_product(get_db(), product_id, _fields(body), actor_id=me["id"],
                                                             reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return {"product": product, "changed": changed}


@router.post("/products/{product_id}/variants")
async def create_variant(product_id: str, body: VariantCreate, me: dict = Depends(require_area("finance"))):
    try:
        variant = await shop_catalog.create_variant(get_db(), product_id, _fields(body), actor_id=me["id"],
                                                    reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return {"variant": variant}


@router.patch("/variants/{variant_id}")
async def update_variant(variant_id: str, body: VariantUpdate, me: dict = Depends(require_area("finance"))):
    try:
        variant, changed = await shop_catalog.update_variant(get_db(), variant_id, _fields(body), actor_id=me["id"],
                                                             reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return {"variant": variant, "changed": changed}


# ---------------------------------------------------------------- Einstellungen (#1706)

class ConfigUpdate(Reasoned):
    stage: Literal["off", "admins", "members", "public"] | None = None
    orders_to_printful: bool | None = Field(None, strict=True)
    public_markup_cents: int | None = Field(None, ge=0, le=shop_config.MAX_PUBLIC_MARKUP_CENTS)
    fallback_shipping_cents: int | None = Field(None, ge=1, le=shop_config.MAX_FALLBACK_SHIPPING_CENTS)


class TaxClearance(Reasoned):
    cleared: bool = Field(..., strict=True)


class PrintfulKey(Reasoned):
    api_key: str = Field(..., min_length=shop_config.MIN_KEY_LENGTH, max_length=shop_config.MAX_KEY_LENGTH + 20)


ACCESS_NEEDS_SYSTEM = "Den Printful-Zugang hinterlegt, wer den Bereich „System“ hat (Club-Admin, Superadmin)."
ONLY_SUPERADMIN_TAX = "Die Freigabe „Steuer geklärt“ setzt nur der Superadmin."


async def _config_answer(me: dict, config: dict | None = None, **extra) -> dict:
    db = get_db()
    view = await shop_config.admin_view(db, config if config is not None else await shop_config.load(db),
                                        is_superadmin=is_superadmin(me),
                                        can_edit_access=await can_use_area(me, "system", db=db))
    return {**view, **extra}


def _config_refused(exc: Exception) -> HTTPException:
    if isinstance(exc, shop_config.ShopForbidden):
        return HTTPException(403, str(exc))
    return _refused(exc)


@router.get("/config")
async def read_config(me: dict = Depends(require_area("finance"))):
    """Stufe, Notschalter, Preise, Zugang und Status - ohne Schlüssel. Lesen ist keine Adminaktion."""
    return await _config_answer(me)


@router.patch("/config")
async def update_config(body: ConfigUpdate, me: dict = Depends(require_area("finance"))):
    """Stufe, Notschalter, öffentlicher Aufschlag, Ersatzpauschale. „Öffentlich“ nur Superadmin und nur mit Freigabe."""
    try:
        config, changed = await shop_config.update(get_db(), _fields(body), actor=me, is_superadmin=is_superadmin(me),
                                                   reason=body.reason)
    except ShopError as exc:
        raise _config_refused(exc) from exc
    return await _config_answer(me, config, changed=changed)


@router.put("/config/tax-clearance")
async def set_tax_clearance(body: TaxClearance, me: dict = Depends(require_area("finance"))):
    """Freigabe „Steuer geklärt“ (#1701) - nur Superadmin, mit Grund."""
    if not is_superadmin(me):
        raise HTTPException(403, ONLY_SUPERADMIN_TAX)
    try:
        config = await shop_config.set_tax_clearance(get_db(), body.cleared, actor=me, reason=body.reason)
    except ShopError as exc:
        raise _config_refused(exc) from exc
    return await _config_answer(me, config)


async def _require_system(me: dict) -> None:
    if not await can_use_area(me, "system", db=get_db()):
        raise HTTPException(403, ACCESS_NEEDS_SYSTEM)


@router.put("/config/printful-key")
async def set_printful_key(body: PrintfulKey, me: dict = Depends(require_area("finance"))):
    """Schlüssel verschlüsselt speichern; er kommt nie zurück - nur „hinterlegt seit …“."""
    await _require_system(me)
    try:
        config = await shop_config.set_printful_key(get_db(), body.api_key, actor=me, reason=body.reason)
    except ShopError as exc:
        raise _config_refused(exc) from exc
    return await _config_answer(me, config)


@router.post("/config/printful-key/remove")
async def remove_printful_key(body: Reasoned, me: dict = Depends(require_area("finance"))):
    await _require_system(me)
    try:
        config = await shop_config.remove_printful_key(get_db(), actor=me, reason=body.reason)
    except ShopError as exc:
        raise _config_refused(exc) from exc
    return await _config_answer(me, config)


@router.post("/config/printful-test")
async def test_printful(me: dict = Depends(require_area("finance"))):
    """Verbindung testen: ein lesender Aufruf bei Printful. Schreibt nichts dort und braucht keinen Notschalter."""
    db = get_db()
    key = await shop_config.printful_api_key(db)
    if not key:
        raise HTTPException(409, "Kein lesbarer Printful-Schlüssel hinterlegt.")
    result = await printful_client.PrintfulClient(key).check_connection()
    await shop_config.record_test(db, result)
    return await _config_answer(me, result=result)


# ---------------------------------------------------------------- Bestellungen

@router.get("/orders")
async def list_orders(status: str | None = Query(None, max_length=40), me: dict = Depends(require_area("finance"))):
    """Bestellungen ohne Anschriften - die stehen nur in der Einzelansicht."""
    return {"orders": await shop_orders.list_orders(get_db(), status=status),
            "status_labels": shop_orders.STATUS_LABELS}


@router.get("/orders/{order_id}")
async def order_detail(order_id: str, me: dict = Depends(require_area("finance"))):
    db = get_db()
    order = await shop_orders.get_order(db, order_id)
    if not order:
        raise HTTPException(404, "Bestellung nicht gefunden.")
    for hidden in ("request_hash", "idempotency_key"):
        order.pop(hidden, None)
    return {"order": order, "items": await shop_orders.items_for(db, order_id),
            "events": await shop_orders.events_for(db, order_id)}
