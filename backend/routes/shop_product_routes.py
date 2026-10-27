"""Produktverwaltung im Shop-Admin (#1707) und Katalogabgleich (#1709) - Verwaltung → Finanzen → Shop → Produkte.

Wie alle Shop-Adminrouten nur der Bereich „Finanzen“ mit Zwei-Faktor (``require_area("finance")``, Regel 3 in
``scripts/check-code-patterns.py``). Jede Änderung braucht einen Grund und steht im Protokoll; Lesen ist keine
Adminaktion. Anlegen, Lesen und Grunddaten (Titel, Sichtbarkeit, Personalisierung, Aufschlag) bleiben in
``routes/shop_admin_routes.py``; hier stehen die Schritte des Aufbaus, die Prüfung und der Abgleich. Jede Antwort ist die
volle Ansicht des Produkts (``shop_products.admin_view``). Printful wird nur über den Adapter gerufen
(``services/printful_client.py``).
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StrictInt

from auth import require_area
from database import get_db
from services import shop_catalog_sync, shop_products
from services.printful_client import PrintfulClient
from services.shop_common import ShopConflict, ShopError
from services.shop_fulfillment import FulfillmentError

router = APIRouter(prefix="/api/admin/shop", tags=["shop"])

NO_KEY = "Kein lesbarer Printful-Schlüssel hinterlegt (Shop → Einstellungen)."
MANUAL_SYNC_REASON = "Mit Printful abgleichen (von Hand)"


class Reasoned(BaseModel):
    model_config = {"extra": "forbid"}

    reason: str = Field(..., min_length=3, max_length=500, pattern=r"\S.*\S|\S{3,}")


class PrintfulChoice(Reasoned):
    printful_product_id: StrictInt = Field(..., ge=1, le=10_000_000)


class Offer(Reasoned):
    technique: str = Field(..., min_length=1, max_length=32)
    colors: list[str] = Field(..., min_length=1, max_length=40)
    sizes: list[str] = Field(..., min_length=1, max_length=20)


class Position(BaseModel):
    model_config = {"extra": "forbid"}

    left_in: float
    top_in: float
    width_in: float
    height_in: float


class PlacementIn(BaseModel):
    model_config = {"extra": "forbid"}

    key: str = Field(..., max_length=32)
    kind: Literal["design", "gamertag", "member_number"] = "design"
    position: Position | None = None


class Placements(Reasoned):
    placements: list[PlacementIn] = Field(..., min_length=1, max_length=shop_products.MAX_PLACEMENTS)
    included_placement: str | None = Field(None, max_length=32)


class Assignment(BaseModel):
    model_config = {"extra": "forbid"}

    placement: str = Field(..., max_length=32)
    color: str = Field(..., max_length=60)
    design_key: str | None = Field(None, max_length=60)


class Designs(Reasoned):
    assignments: list[Assignment] = Field(..., min_length=1, max_length=200)


class StatusChange(Reasoned):
    status: Literal["draft", "reviewed", "active", "archived"]


class SyncRequest(BaseModel):
    model_config = {"extra": "forbid"}

    reason: str | None = Field(None, max_length=500)


def _refused(exc: Exception) -> HTTPException:
    if isinstance(exc, LookupError):
        return HTTPException(404, str(exc))
    if isinstance(exc, ShopConflict):
        return HTTPException(409, str(exc))
    if isinstance(exc, shop_products.CatalogUnavailable):
        return HTTPException(502, str(exc))
    return HTTPException(400, str(exc))


async def _provider(db) -> PrintfulClient:
    try:
        return await PrintfulClient.from_db(db)
    except FulfillmentError as exc:
        raise HTTPException(409, NO_KEY) from exc


async def _view(product_id: str, **extra) -> dict:
    try:
        return {**await shop_products.admin_view(get_db(), product_id), **extra}
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/products/{product_id}/printful")
async def choose_printful_product(product_id: str, body: PrintfulChoice, me: dict = Depends(require_area("finance"))):
    """Schritt 1: Printful-Katalogprodukt laden (Farben, Größen, Druckflächen, Varianten mit Lager - ohne Preise)."""
    db = get_db()
    provider = await _provider(db)
    try:
        await shop_products.load_printful_product(db, product_id, body.printful_product_id, provider=provider,
                                                  actor_id=me["id"], reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return await _view(product_id)


@router.put("/products/{product_id}/offer")
async def set_offer(product_id: str, body: Offer, me: dict = Depends(require_area("finance"))):
    """Schritt 2: angebotene Farben und Größen; danach Einkaufspreise für genau diese Varianten."""
    db = get_db()
    provider = await _provider(db)
    try:
        await shop_products.set_offer(db, product_id, technique=body.technique, colors=body.colors, sizes=body.sizes,
                                      provider=provider, actor_id=me["id"], reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return await _view(product_id)


@router.put("/products/{product_id}/placements")
async def set_placements(product_id: str, body: Placements, me: dict = Depends(require_area("finance"))):
    """Schritt 3a: Platzierungen mit Art und Position (Zoll)."""
    placements = [item.model_dump(exclude_none=True) for item in body.placements]
    try:
        await shop_products.set_placements(get_db(), product_id, placements,
                                           included_placement=body.included_placement, actor_id=me["id"],
                                           reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return await _view(product_id)


@router.put("/products/{product_id}/designs")
async def set_designs(product_id: str, body: Designs, me: dict = Depends(require_area("finance"))):
    """Schritt 3b: je Platzierung und Farbe ein Design (``design_key: null`` entfernt die Zuordnung)."""
    try:
        await shop_products.set_designs(get_db(), product_id, [item.model_dump() for item in body.assignments],
                                        actor_id=me["id"], reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return await _view(product_id)


@router.post("/products/{product_id}/prices/accept")
async def accept_prices(product_id: str, body: Reasoned, me: dict = Depends(require_area("finance"))):
    """Schritt 4: Einkauf als Mitgliederpreis übernehmen (beendet Preiswarnungen)."""
    try:
        await shop_products.accept_prices(get_db(), product_id, actor_id=me["id"], reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return await _view(product_id)


@router.post("/products/{product_id}/sync")
async def sync_with_printful(product_id: str, body: SyncRequest, me: dict = Depends(require_area("finance"))):
    """„Mit Printful abgleichen“: Lager und Einkauf neu holen - sperrt nicht Lieferbares, warnt bei Preisänderungen.
    Ändert keine Entscheidung der Finanzen; im Protokoll steht die Person (Grund optional)."""
    db = get_db()
    provider = await _provider(db)
    reason = (body.reason or "").strip() or MANUAL_SYNC_REASON
    try:
        result = await shop_catalog_sync.sync_product(db, product_id, provider=provider, actor_id=me["id"],
                                                      reason=reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return await _view(product_id, result=result)


@router.post("/products/{product_id}/status")
async def set_status(product_id: str, body: StatusChange, me: dict = Depends(require_area("finance"))):
    """Schritt 5: prüfen, veröffentlichen, zurückziehen, archivieren - nur mit bestandener Vorab-Prüfung."""
    try:
        await shop_products.set_status(get_db(), product_id, body.status, actor_id=me["id"], reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return await _view(product_id)
