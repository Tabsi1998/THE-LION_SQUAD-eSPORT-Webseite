"""Designs und Druckdateien im Shop-Admin (#1708) - Verwaltung → Finanzen → Shop → Designs.

Wie alle Shop-Adminrouten nur der Bereich „Finanzen“ mit Zwei-Faktor (``require_area("finance")``, Regel 3 in
``scripts/check-code-patterns.py``). Jede Änderung braucht einen Grund und steht im Protokoll der Adminaktionen
(``shop.design.add``, ``shop.design.profile``, ``shop.design.placement``, seit #2069 ``shop.design.light`` und
``shop.motif.settings``, seit #2084 ``shop.design.pair``); Lesen ist keine Adminaktion. Die Logik steht in
``services/shop_designs.py`` und ``services/shop_motifs.py`` (Motive mit Fassungen für dunkle und helle Shirts, als
Paar mit Paar-Prüfung); die öffentliche Adresse für Printful in ``routes/shop_print_file_routes.py``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from auth import require_area
from database import get_db
from services import shop_designs, shop_motifs
from services.image_upload import _read_upload_limited
from services.rate_limit import enforce_rate_limit
from services.shop_common import ShopConflict, ShopError

router = APIRouter(prefix="/api/admin/shop", tags=["shop"])
# Paar prüfen bzw. hochladen (#2084): je Anfrage zwei Dateien bereinigen und rastern - so oft je Minute und Person.
PAIR_CHECKS_PER_MINUTE = 20
_PAIR = shop_motifs.PAIR_SETTINGS


class Reasoned(BaseModel):
    model_config = {"extra": "forbid"}

    reason: str = Field("", max_length=500)  # optional (Entscheidung Obmann 27.10.2026)


class ColorVariant(BaseModel):
    model_config = {"extra": "forbid"}

    color: str = Field(..., min_length=1, max_length=40)
    variant: str = Field(..., pattern="^(dark|light)$")


class ProfileUpdate(Reasoned):
    title: str | None = Field(None, min_length=1, max_length=120)
    garment_colors: list[str] | None = Field(None, max_length=shop_designs.MAX_COLORS)
    note: str | None = Field(None, max_length=500)
    # Ausnahmen je Shirtfarbe (#2069): diese Farbe bekommt immer die Fassung für dunkle bzw. helle Shirts.
    color_variants: list[ColorVariant] | None = Field(None, max_length=shop_motifs.MAX_EXCEPTIONS)


class MotifSettings(Reasoned):
    light_ink: str | None = Field(None, min_length=7, max_length=7)
    threshold: float | None = Field(None, ge=shop_motifs.MIN_THRESHOLD, le=shop_motifs.MAX_THRESHOLD)
    # Schwellen der Paar-Prüfung (#2084)
    pair_aspect_tolerance: float | None = Field(None, ge=_PAIR["pair_aspect_tolerance"][1],
                                                le=_PAIR["pair_aspect_tolerance"][2])
    pair_min_overlap: float | None = Field(None, ge=_PAIR["pair_min_overlap"][1], le=_PAIR["pair_min_overlap"][2])
    pair_contrast_share: float | None = Field(None, ge=_PAIR["pair_contrast_share"][1],
                                              le=_PAIR["pair_contrast_share"][2])
    pair_position_tolerance: float | None = Field(None, ge=_PAIR["pair_position_tolerance"][1],
                                                  le=_PAIR["pair_position_tolerance"][2])


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
    # Ein abgelehntes SVG (#2069) bringt seinen Status mit: zu groß 413, zu aufwendig 422, ausgelastet 429.
    return HTTPException(getattr(exc, "status", 400), str(exc))


@router.get("/designs")
async def list_designs(me: dict = Depends(require_area("finance"))):
    """Designs mit allen Versionen, Ampel gegen die geltende Vorgabe, Druckbereiche je Platzierung."""
    return await shop_motifs.admin_view(get_db())


@router.post("/designs/upload")
async def upload_design(file: UploadFile = File(...), design_key: str = Form(..., max_length=60),
                        reason: str = Form("", max_length=500), title: str | None = Form(None, max_length=120),
                        placement: str | None = Form(None, max_length=40),
                        garment_colors: str | None = Form(None, max_length=1000),
                        variant: str = Form("dark", pattern="^(dark|light)$"),
                        me: dict = Depends(require_area("finance"))):
    """Neue Datei eines Motivs als neue Version - SVG streng bereinigt, PNG/JPG neu kodiert, geprüft, nie
    überschrieben. ``variant`` „light“ ist die eigene Datei für helle Shirts (#2069)."""
    data = await _read_upload_limited(file, shop_designs.MAX_BYTES, shop_designs.MAX_UPLOAD_MB)
    db = get_db()
    try:
        design = await shop_motifs.upload(db, design_key=design_key, data=data, filename=file.filename or "",
                                           content_type=file.content_type or "", actor_id=me["id"], reason=reason,
                                           title=title, placement=placement or None, garment_colors=garment_colors,
                                           variant=variant)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return {"uploaded": {"design_key": design["design_key"], "version": design["version"],
                         "variant": design.get("variant"), "sha256": design["sha256"],
                         "warnings": design["warnings"], "light": design.get("light"),
                         "pair": design.get("pair")},
            **await shop_motifs.admin_view(db)}


def _pair_refused(exc: Exception):
    """Paar-Prüfung Rot (400) bzw. Gelb ohne Bestätigung (409): die Meldung und der Prüfbericht für die Ampel."""
    if isinstance(exc, shop_motifs.PairRefused):
        return JSONResponse({"detail": str(exc), "pair": exc.report}, status_code=exc.status)
    raise _refused(exc) from exc


async def _pair_files(file_dark: UploadFile, file_light: UploadFile) -> tuple[tuple, tuple]:
    out = []
    for upload in (file_dark, file_light):
        data = await _read_upload_limited(upload, shop_designs.MAX_BYTES, shop_designs.MAX_UPLOAD_MB)
        out.append((data, upload.filename or "", upload.content_type or ""))
    return out[0], out[1]


@router.post("/designs/pair-check")
async def check_design_pair(request: Request, file_dark: UploadFile = File(...), file_light: UploadFile = File(...),
                            design_key: str | None = Form(None, max_length=60),
                            placement: str | None = Form(None, max_length=40), auto_assign: bool = Form(False),
                            me: dict = Depends(require_area("finance"))):
    """Motiv als Paar nur prüfen (#2084): Ampel mit Klartext, Vorschau beider Fassungen, Markierungen - speichert
    nichts. Gebremst, weil jede Prüfung zwei Dateien bereinigt und rastert."""
    await enforce_rate_limit(request, "shop_pair_check", PAIR_CHECKS_PER_MINUTE, 60, subject=me["id"])
    dark, light = await _pair_files(file_dark, file_light)
    try:
        return await shop_motifs.check_pair(get_db(), dark_file=dark, light_file=light, design_key=design_key or None,
                                            placement=placement or None, auto_assign=auto_assign)
    except (ShopError, LookupError) as exc:
        return _pair_refused(exc)


@router.post("/designs/upload-pair")
async def upload_design_pair(request: Request, file_dark: UploadFile = File(...), file_light: UploadFile = File(...),
                             design_key: str = Form(..., max_length=60), reason: str = Form("", max_length=500),
                             title: str | None = Form(None, max_length=120),
                             placement: str | None = Form(None, max_length=40),
                             garment_colors: str | None = Form(None, max_length=1000),
                             auto_assign: bool = Form(False), confirm_warnings: bool = Form(False),
                             me: dict = Depends(require_area("finance"))):
    """Motiv als Paar hochladen (#2084): Hauptdatei (für dunkle Shirts) und eigene Datei für helle Shirts in einem
    Schritt - Paar-Prüfung, dann beide oder keine. Rot 400, Gelb ohne ``confirm_warnings`` 409, jeweils mit Bericht."""
    await enforce_rate_limit(request, "shop_pair_check", PAIR_CHECKS_PER_MINUTE, 60, subject=me["id"])
    dark, light = await _pair_files(file_dark, file_light)
    db = get_db()
    try:
        saved = await shop_motifs.upload_pair(db, design_key=design_key, dark_file=dark, light_file=light,
                                              actor_id=me["id"], reason=reason, title=title,
                                              placement=placement or None, garment_colors=garment_colors,
                                              auto_assign=auto_assign, confirm_warnings=confirm_warnings)
    except (ShopError, LookupError) as exc:
        return _pair_refused(exc)
    return {"uploaded_pair": {"design_key": saved["dark"]["design_key"], "dark_version": saved["dark"]["version"],
                              "light_version": saved["light"]["version"], "warnings": saved["warnings"],
                              "pair": saved["pair"]},
            **await shop_motifs.admin_view(db)}


@router.post("/designs/{design_key}/light-auto")
async def use_auto_light(design_key: str, body: Reasoned, me: dict = Depends(require_area("finance"))):
    """Fassung für helle Shirts wieder automatisch (Weiß → Ersatzfarbe) bzw. jetzt erzeugen (#2069)."""
    db = get_db()
    try:
        light = await shop_motifs.use_auto_light(db, design_key, actor_id=me["id"], reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return {"light": light, **await shop_motifs.admin_view(db)}


@router.put("/designs/motif-settings")
async def update_motif_settings(body: MotifSettings, me: dict = Depends(require_area("finance"))):
    """Ersatzfarbe für helle Shirts und Helligkeits-Schwelle (#2069) - eine neue Ersatzfarbe erzeugt die automatischen
    Fassungen neu."""
    db = get_db()
    try:
        _, changed = await shop_motifs.set_settings(db, _fields(body), actor_id=me["id"], reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return {"changed": changed, **await shop_motifs.admin_view(db)}


@router.patch("/designs/{design_key}")
async def update_design(design_key: str, body: ProfileUpdate, me: dict = Depends(require_area("finance"))):
    """Titel, Shirtfarben oder Notiz - die Zuordnung Farbe ↔ Design für die Produktverwaltung (#1707)."""
    db = get_db()
    try:
        _, changed = await shop_designs.update_profile(db, design_key, _fields(body), actor_id=me["id"],
                                                       reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return {"changed": changed, **await shop_motifs.admin_view(db)}


@router.put("/designs/placements/{placement}")
async def update_placement(placement: str, body: PlacementUpdate, me: dict = Depends(require_area("finance"))):
    """Druckbreite, Druckbereich und Mindest-DPI einer Platzierung (Zoll; die Antwort nennt auch cm)."""
    db = get_db()
    try:
        _, changed = await shop_designs.set_placement(db, placement, _fields(body), actor_id=me["id"],
                                                      reason=body.reason)
    except (ShopError, LookupError) as exc:
        raise _refused(exc) from exc
    return {"changed": changed, **await shop_motifs.admin_view(db)}
