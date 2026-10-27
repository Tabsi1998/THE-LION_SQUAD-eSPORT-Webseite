"""Designs und Druckdateien im Shop-Admin (#1708) - Verwaltung → Finanzen → Shop → Designs.

Wie alle Shop-Adminrouten nur der Bereich „Finanzen“ mit Zwei-Faktor (``require_area("finance")``, Regel 3 in
``scripts/check-code-patterns.py``). Jede Änderung braucht einen Grund und steht im Protokoll der Adminaktionen
(``shop.design.add``, ``shop.design.profile``, ``shop.design.placement``); Lesen ist keine Adminaktion. Die Logik
steht in ``services/shop_designs.py``; die öffentliche Adresse für Printful in ``routes/shop_print_file_routes.py``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from auth import require_area
from database import get_db
from services import shop_designs
from services.image_upload import _read_upload_limited
from services.shop_common import ShopConflict, ShopError

router = APIRouter(prefix="/api/admin/shop", tags=["shop"])


class Reasoned(BaseModel):
    model_config = {"extra": "forbid"}

    reason: str = Field(..., min_length=3, max_length=500)


class ProfileUpdate(Reasoned):
    title: str | None = Field(None, min_length=1, max_length=120)
    garment_colors: list[str] | None = Field(None, max_length=shop_designs.MAX_COLORS)
    note: str | None = Field(None, max_length=500)


class PlacementUpdate(Reasoned):
    print_width_in: float | None = Field(None, ge=shop_designs.MIN_INCHES, le=shop_designs.MAX_INCHES)
    area_width_in: float | None = Field(None, ge=shop_designs.MIN_INCHES, le=shop_designs.MAX_INCHES)
    area_height_in: float | None = Field(None, ge=shop_designs.MIN_INCHES, le=shop_designs.MAX_INCHES)
    min_dpi: int | None = Field(None, ge=shop_designs.MIN_DPI, le=shop_designs.MAX_DPI)


def _fields(body: BaseModel) -> dict:
    return {key: value for key, value in body.model_dump(exclude_unset=True).items() if key != "reason"}


def _refused(exc: Exception) -> HTTPException:
    if isinstance(exc, LookupError):
        return HTTPException(404, str(exc))
    if isinstance(exc, ShopConflict):
        return HTTPException(409, str(exc))
    return HTTPException(400, str(exc))


@router.get("/designs")
async def list_designs(me: dict = Depends(require_area("finance"))):
    """Designs mit allen Versionen, Ampel gegen die geltende Vorgabe, Druckbereiche je Platzierung."""
    return await shop_designs.admin_view(get_db())


@router.post("/designs/upload")
async def upload_design(file: UploadFile = File(...), design_key: str = Form(..., max_length=60),
                        reason: str = Form(..., max_length=500), title: str | None = Form(None, max_length=120),
                        placement: str | None = Form(None, max_length=40),
                        garment_colors: str | None = Form(None, max_length=1000),
                        me: dict = Depends(require_area("finance"))):
    """Neue Druckdatei als neue Version - neu kodiert, geprüft, nie überschrieben."""
    data = await _read_upload_limited(file, shop_designs.MAX_BYTES, shop_designs.MAX_UPLOAD_MB)
    db = get_db()
    try:
        design = await shop_designs.upload(db, design_key=design_key, data=data, filename=file.filename or "",
                                           content_type=file.content_type or "", actor_id=me["id"], reason=reason,
                                           title=title, placement=placement or None, garment_colors=garment_colors)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return {"uploaded": {"design_key": design["design_key"], "version": design["version"],
                         "sha256": design["sha256"], "warnings": design["warnings"]},
            **await shop_designs.admin_view(db)}


@router.patch("/designs/{design_key}")
async def update_design(design_key: str, body: ProfileUpdate, me: dict = Depends(require_area("finance"))):
    """Titel, Shirtfarben oder Notiz - die Zuordnung Farbe ↔ Design für die Produktverwaltung (#1707)."""
    db = get_db()
    try:
        _, changed = await shop_designs.update_profile(db, design_key, _fields(body), actor_id=me["id"],
                                                       reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return {"changed": changed, **await shop_designs.admin_view(db)}


@router.put("/designs/placements/{placement}")
async def update_placement(placement: str, body: PlacementUpdate, me: dict = Depends(require_area("finance"))):
    """Druckbreite, Druckbereich und Mindest-DPI einer Platzierung (Zoll; die Antwort nennt auch cm)."""
    db = get_db()
    try:
        _, changed = await shop_designs.set_placement(db, placement, _fields(body), actor_id=me["id"],
                                                      reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return {"changed": changed, **await shop_designs.admin_view(db)}
