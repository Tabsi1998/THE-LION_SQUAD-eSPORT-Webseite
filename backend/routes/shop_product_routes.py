"""Produktverwaltung im Shop-Admin (#1707) und Katalogabgleich (#1709) - Verwaltung → Finanzen → Shop → Produkte.

Wie alle Shop-Adminrouten nur der Bereich „Finanzen“ mit Zwei-Faktor (``require_area("finance")``, Regel 3 in
``scripts/check-code-patterns.py``). Jede Änderung steht mit Person und Zeit im Protokoll; der Grund ist optional und
nur beim Veröffentlichen Pflicht (Entscheidung Obmann 27.10.2026). Lesen ist keine Adminaktion. Anlegen, Lesen und Grunddaten (Titel, Sichtbarkeit, Personalisierung, Aufschlag) bleiben in
``routes/shop_admin_routes.py``; hier stehen die Schritte des Aufbaus, die Prüfung und der Abgleich. Jede Antwort ist die
volle Ansicht des Produkts (``shop_products.admin_view``). Printful wird nur über den Adapter gerufen
(``services/printful_client.py``).
"""
from __future__ import annotations

from typing import Literal

import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, StrictInt

from auth import require_area
from database import get_db
from services import shop_catalog_search, shop_catalog_sync, shop_designs, shop_print_files, shop_products
from services import shop_print_templates as print_templates
from services.image_upload import _read_upload_limited
from services.rate_limit import enforce_rate_limit
from services.printful_client import PrintfulClient
from services.shop_common import ShopConflict, ShopError
from services.shop_fulfillment import FulfillmentError

router = APIRouter(prefix="/api/admin/shop", tags=["shop"])

NO_KEY = "Kein lesbarer Printful-Schlüssel hinterlegt (Shop → Einstellungen)."
MANUAL_SYNC_REASON = "Mit Printful abgleichen (von Hand)"


class Reasoned(BaseModel):
    model_config = {"extra": "forbid"}

    # Grund optional (Entscheidung Obmann 27.10.2026) - Pflicht nur beim Veröffentlichen, das prüft der Service.
    reason: str = Field("", max_length=500)


class PrintfulChoice(Reasoned):
    printful_product_id: StrictInt = Field(..., ge=1, le=10_000_000)


class Offer(Reasoned):
    technique: str = Field(..., min_length=1, max_length=32)
    colors: list[str] = Field(..., min_length=1, max_length=40)
    sizes: list[str] = Field(..., min_length=1, max_length=20)
    # Eigene Bezeichnung je Farbe (#2105) - ohne Angabe bleiben die bisherigen; leer heißt „Vorgabe“.
    color_labels: dict[str, str | None] | None = Field(None, max_length=40)


class MotifRef(BaseModel):
    model_config = {"extra": "forbid"}

    key: str = Field(..., min_length=1, max_length=60)
    by_color: dict[str, str | None] = Field(default_factory=dict, max_length=40)


class LayerIn(BaseModel):
    model_config = {"extra": "forbid"}

    kind: Literal["motif", "gamertag", "member_number"]
    preset: str = Field(..., min_length=1, max_length=40)
    width_cm: float | None = None
    offset_x_cm: float = 0.0
    offset_y_cm: float = 0.0
    motif: MotifRef | None = None
    # Größe einer Gamertag- bzw. Vereinsnummer-Ebene (#2105) - ohne Angabe die globalen Gamertag-Regeln.
    text_height_cm: float | None = None
    max_width_cm: float | None = None


class PlacementLayout(BaseModel):
    model_config = {"extra": "forbid"}

    key: str = Field(..., min_length=1, max_length=64)
    mode: Literal["layout", "upload"] = "layout"
    layers: list[LayerIn] = Field(default_factory=list, max_length=shop_print_files.MAX_LAYERS)


class Layout(Reasoned):
    placements: list[PlacementLayout] = Field(..., min_length=1, max_length=shop_products.MAX_PLACEMENTS)
    included_placement: str | None = Field(None, max_length=64)


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


@router.get("/printful-catalog")
async def printful_catalog(q: str = Query("", max_length=120), category_id: int | None = Query(None, ge=1),
                           link: str | None = Query(None, max_length=500), refresh: bool = False,
                           me: dict = Depends(require_area("finance"))):
    """Schritt 1 ohne Nummer (#2069): im Printful-Katalog suchen - nach Name, Marke, Modell, Kategorie oder über einen
    Link aus dem Printful-Dashboard. Der Katalog wird zwischengespeichert (ein Tag)."""
    db = get_db()
    try:
        provider = await PrintfulClient.from_db(db)
    except FulfillmentError:
        provider = None  # ohne Schlüssel: nur der letzte Stand, falls es einen gibt
    try:
        catalog = await shop_catalog_search.load(db, provider=provider, refresh=refresh)
    except ShopConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ShopError as exc:
        raise HTTPException(409 if provider is None else 502, NO_KEY if provider is None else str(exc)) from exc
    found = shop_catalog_search.search(catalog, query=q, category_id=category_id, link=link)
    return {**found, "categories": shop_catalog_search.category_tree(catalog), "fetched_at": catalog.get("fetched_at"),
            "stale": catalog.get("stale", False), "error": catalog.get("error"),
            "products_total": len(catalog.get("products") or [])}


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
                                      color_labels=body.color_labels, provider=provider, actor_id=me["id"],
                                      reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return await _view(product_id)


@router.put("/products/{product_id}/layout")
async def set_layout(product_id: str, body: Layout, me: dict = Depends(require_area("finance"))):
    """Schritt 3: je Druckfläche Motiv, Vorgabe-Position und Größe in cm, Platzhalter für Gamertag und Nummer (#2069)."""
    placements = []
    for item in body.placements:
        row = item.model_dump(exclude_none=True)
        row["layers"] = [layer.model_dump(exclude_none=True) for layer in item.layers]
        placements.append(row)
    try:
        await shop_products.set_layout(get_db(), product_id, placements, included_placement=body.included_placement,
                                       actor_id=me["id"], reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return await _view(product_id)


def _env_int(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if low <= value <= high else default


def preview_limit() -> tuple[int, int]:
    """Wie oft die Vorschau für einen ungespeicherten Aufbau je Konto gerechnet wird: Aufrufe je Zeitfenster (Sekunden).
    ``SHOP_LAYOUT_PREVIEW_LIMIT`` (Vorgabe 60) und ``SHOP_LAYOUT_PREVIEW_WINDOW_SECONDS`` (Vorgabe 60)."""
    return (_env_int("SHOP_LAYOUT_PREVIEW_LIMIT", 60, 1, 10_000),
            _env_int("SHOP_LAYOUT_PREVIEW_WINDOW_SECONDS", 60, 1, 86_400))


PREVIEW_BUSY = "Zu viele Vorschau-Anfragen. Bitte warte noch {wait}."


@router.post("/products/{product_id}/layout/preview")
async def preview_layout(product_id: str, body: Layout, request: Request, me: dict = Depends(require_area("finance"))):
    """Pläne für den ungespeicherten Aufbau aus Schritt 3 - die Vorschau zeigt so genau die Fassung, die der Server je
    Shirtfarbe drucken würde. Speichert nichts, schreibt nichts ins Protokoll. Je Konto gedrosselt (``preview_limit``),
    darüber 429."""
    limit, window = preview_limit()
    await enforce_rate_limit(request, "shop:layout-preview", limit=limit, window_seconds=window, subject=me["id"],
                             message=PREVIEW_BUSY)
    placements = []
    for item in body.placements:
        row = item.model_dump(exclude_none=True)
        row["layers"] = [layer.model_dump(exclude_none=True) for layer in item.layers]
        placements.append(row)
    try:
        return await shop_products.plan_layout(get_db(), product_id, placements)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc


@router.post("/products/{product_id}/print-files")
async def generate_print_files(product_id: str, body: Reasoned, me: dict = Depends(require_area("finance"))):
    """„Druckdateien erzeugen“: je Fläche und Farbe exakt in der Pixelgröße von Printful - nur, was fehlt oder
    veraltet ist (#2069)."""
    try:
        result = await shop_products.generate_print_files(get_db(), product_id, actor_id=me["id"], reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return await _view(product_id, result=result)


@router.post("/products/{product_id}/print-templates/refresh")
async def refresh_print_templates(product_id: str, body: Reasoned, me: dict = Depends(require_area("finance"))):
    """Druckvorlagen des Printful-Produkts neu holen (Maße, Vorlagenbilder) - Abweichungen stehen in der Antwort."""
    db = get_db()
    view = await _view(product_id)
    printful = view["product"].get("printful") or {}
    if not printful.get("product_id"):
        raise HTTPException(400, "Erst das Printful-Produkt laden (Schritt 1).")
    provider = await _provider(db)
    result = await print_templates.refresh(db, printful["product_id"], provider=provider, actor_id=me["id"],
                                           reason=body.reason)
    return await _view(product_id, template_result={key: result.get(key) for key in ("ok", "changed", "changes",
                                                                                     "detail", "warning")})


PNG_HEADERS = {"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
               "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "no-referrer"}


@router.get("/products/{product_id}/preview")
async def preview(product_id: str, placement: str = Query(..., max_length=64), color: str = Query(..., max_length=60),
                  sample: bool = True, me: dict = Depends(require_area("finance"))):
    """Vorschau: Druckdatei über dem Printful-Vorlagenbild (Sicherheitslinien) auf der Shirtfarbe - als PNG."""
    db = get_db()
    try:
        product = await shop_products._product(db, product_id)
        payload = await shop_print_files.preview_png(db, product, placement=placement, color=color, sample=sample)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return Response(payload, media_type="image/png", headers=PNG_HEADERS)


@router.get("/products/{product_id}/name-sample")
async def name_sample(product_id: str, kind: Literal["gamertag", "member_number"] = "gamertag",
                      color: str = Query(..., max_length=60), text_height_cm: float | None = Query(None),
                      max_width_cm: float | None = Query(None), me: dict = Depends(require_area("finance"))):
    """Beispielname einer Namensebene in echter Größe (#2105) - gerendert wie die Druckdatei, als PNG der Leinwand."""
    db = get_db()
    try:
        product = await shop_products._product(db, product_id)
        payload = await shop_print_files.sample_png(db, product, kind=kind, color=color,
                                                    layer={"text_height_cm": text_height_cm,
                                                           "max_width_cm": max_width_cm})
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return Response(payload, media_type="image/png",
                    headers={**PNG_HEADERS, "Cache-Control": "private, max-age=600"})


@router.get("/products/{product_id}/print-files/{file_id}")
async def print_file(product_id: str, file_id: str, me: dict = Depends(require_area("finance"))):
    """Eine erzeugte Grunddatei ansehen oder herunterladen (Bestelldateien mit Namen nicht)."""
    try:
        path, name = await shop_print_files.admin_file(get_db(), product_id, file_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    return FileResponse(path, media_type="image/png",
                        headers={**PNG_HEADERS, "Content-Disposition": f'inline; filename="{name}"'})


@router.post("/print-files/upload")
async def upload_print_file(file: UploadFile = File(...), product_id: str = Form(..., max_length=64),
                            placement: str = Form(..., max_length=64), color: str = Form(..., max_length=60),
                            group: str | None = Form(None, max_length=20), reason: str = Form("", max_length=500),
                            me: dict = Depends(require_area("finance"))):
    """Für Profis: eine fertige Druckdatei je Fläche und Farbe - exakt gegen die Vorlage geprüft (Pixel bzw.
    Seitenverhältnis und DPI). Am Eingang höchstens 50 MB (``services/body_limits.py``, nginx)."""
    data = await _read_upload_limited(file, shop_designs.MAX_BYTES, shop_designs.MAX_UPLOAD_MB)
    db = get_db()
    try:
        uploaded = await shop_print_files.upload(db, product_id, placement=placement, color=color, data=data,
                                                 filename=file.filename or "", content_type=file.content_type or "",
                                                 actor_id=me["id"], reason=reason, group=group or None)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return await _view(product_id, uploaded=uploaded)


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
