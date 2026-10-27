"""Shop im Adminbereich (#1704): nur der Bereich „Finanzen“ (``finance``, mit Zwei-Faktor) - Club-Admin und Superadmin
bringen ihn mit, andere bekommen ihn als Freigabe. Kein eigener Bereich.

Dieses Fundament liest Produkte und Bestellungen und legt Produkte und Varianten an bzw. ändert sie. Jede Änderung
braucht einen Grund und steht im Protokoll der Adminaktionen (``services/shop_catalog``); Lesen ist keine
Adminaktion. Die Bestellliste zeigt keine Anschriften. Öffentliche Shop-Routen gibt es nicht - der Shop bleibt von
außen unsichtbar, bis Konfiguration und Betriebsarten (#1706) und die Shop-Seiten (#1712) stehen.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from auth import require_area
from database import get_db
from services import shop_catalog, shop_orders
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
    title: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)
    status: Literal["draft", "active", "archived"] | None = None
    visibility: Literal["hidden", "members", "public"] | None = None
    base_price_cents: int | None = Field(None, ge=0, le=shop_catalog.MAX_PRICE_CENTS)
    markup_cents: int | None = Field(None, ge=0, le=shop_catalog.MAX_MARKUP_CENTS)
    gamertag_allowed: bool | None = None
    tax_profile: str | None = Field(None, max_length=20)
    design_key: str | None = Field(None, max_length=80)


class ProductCreate(ProductFields):
    slug: str = Field(..., min_length=1, max_length=80)
    title: str = Field(..., min_length=1, max_length=120)
    base_price_cents: int = Field(..., ge=0, le=shop_catalog.MAX_PRICE_CENTS)


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
