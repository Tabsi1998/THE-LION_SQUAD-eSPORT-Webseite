"""File upload routes.

Public images are stored on local disk and served through
/api/static/uploads/{filename}. A legacy /uploads/{filename} route is also kept
for older stored URLs.
"""
import os
import uuid
import pathlib
import logging
from io import BytesIO
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Request
from PIL import Image, ImageChops, ImageOps, UnidentifiedImageError
from auth import require_admin, get_current_user
from database import get_db
from models import new_id, now_utc
from services.rate_limit import enforce_rate_limit

logger = logging.getLogger("tls-arena.uploads")
UPLOAD_DIR = pathlib.Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC_UPLOAD_DIR = UPLOAD_DIR / "public"
PRIVATE_DOC_DIR = UPLOAD_DIR / "documents"
PUBLIC_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PRIVATE_DOC_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_IMAGE = {"image/png", "image/jpeg", "image/webp"}
ADMIN_MEDIA_ROLES = {"admin", "moderator", "tournament_admin", "club_admin", "superadmin"}
ALLOWED_MEDIA_SCOPES = {"user", "admin", "sponsor", "branding", "gallery"}
IMAGE_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}
PIL_IMAGE_FORMATS = {
    "PNG": ("image/png", ".png"),
    "JPEG": ("image/jpeg", ".jpg"),
    "WEBP": ("image/webp", ".webp"),
}


def _upload_mb_from_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        logger.warning("[uploads] invalid %s, falling back to %s MB", name, default)
        return default
    if value < 1:
        logger.warning("[uploads] invalid %s=%s, falling back to %s MB", name, value, default)
        return default
    return value


def _int_from_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        logger.warning("[uploads] invalid %s, falling back to %s", name, default)
        return default
    return value if value > 0 else default


ALLOWED_DOC = {
    "application/pdf",
    "application/zip",
    "application/x-zip-compressed",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "text/markdown",
    "image/png", "image/jpeg",
}
MAX_IMAGE_UPLOAD_MB = _upload_mb_from_env("MAX_IMAGE_UPLOAD_MB", 50)
MAX_DOCUMENT_UPLOAD_MB = _upload_mb_from_env("MAX_DOCUMENT_UPLOAD_MB", 50)
MAX_BYTES = MAX_IMAGE_UPLOAD_MB * 1024 * 1024  # images before re-encoding
MAX_DOC_BYTES = MAX_DOCUMENT_UPLOAD_MB * 1024 * 1024  # docs
MAX_IMAGE_DIMENSION = _int_from_env("MAX_IMAGE_DIMENSION", 4096)
MAX_IMAGE_PIXELS = _int_from_env("MAX_IMAGE_PIXELS", 50_000_000)
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


async def _read_upload_limited(file: UploadFile, max_bytes: int, max_mb: int) -> bytes:
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail=f"Datei zu groß (max {max_mb} MB)")
    return data


def _clean_media_scope(value: str | None, me: dict) -> str:
    scope = str(value or "user").strip().lower()
    if scope not in ALLOWED_MEDIA_SCOPES:
        scope = "user"
    if scope != "user" and me.get("role") not in ADMIN_MEDIA_ROLES:
        raise HTTPException(status_code=403, detail="Admin-Medienupload nicht erlaubt.")
    return scope


def _resize_for_storage(img: Image.Image) -> tuple[Image.Image, bool]:
    if img.width <= MAX_IMAGE_DIMENSION and img.height <= MAX_IMAGE_DIMENSION:
        return img, False
    resized = img.copy()
    resized.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
    return resized, True


def _crop_with_padding(img: Image.Image, bbox: tuple[int, int, int, int] | None) -> tuple[Image.Image, bool]:
    if not bbox:
        return img, False
    left, top, right, bottom = bbox
    if left <= 0 and top <= 0 and right >= img.width and bottom >= img.height:
        return img, False
    crop_w = right - left
    crop_h = bottom - top
    if crop_w >= img.width * 0.97 and crop_h >= img.height * 0.97:
        return img, False
    pad = max(4, int(max(crop_w, crop_h) * 0.06))
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(img.width, right + pad)
    bottom = min(img.height, bottom + pad)
    return img.crop((left, top, right, bottom)), True


def _trim_empty_borders(img: Image.Image) -> tuple[Image.Image, bool]:
    """Crop transparent or flat-color whitespace around logos.

    This is intentionally conservative and only crops when the detected content
    is clearly smaller than the canvas.
    """
    rgba = img.convert("RGBA")
    alpha_mask = rgba.getchannel("A").point(lambda p: 255 if p > 8 else 0)
    alpha_bbox = alpha_mask.getbbox()
    if alpha_bbox:
        alpha_area = (alpha_bbox[2] - alpha_bbox[0]) * (alpha_bbox[3] - alpha_bbox[1])
        full_area = rgba.width * rgba.height
        if alpha_area < full_area * 0.92:
            return _crop_with_padding(rgba, alpha_bbox)

    bg = Image.new("RGBA", rgba.size, rgba.getpixel((0, 0)))
    diff = ImageChops.difference(rgba, bg)
    mask = diff.convert("L").point(lambda p: 255 if p > 18 else 0)
    return _crop_with_padding(rgba, mask.getbbox())


async def _upload_image_impl(
    file: UploadFile,
    me: dict,
    trim_empty_borders: bool = False,
    media_scope: str = "user",
):
    """Upload an image. Returns public URL `/api/static/uploads/{filename}`.
    Accepts PNG/JPEG/WebP and re-encodes before serving."""
    media_scope = _clean_media_scope(media_scope, me)
    declared_content_type = file.content_type or ""
    suffix = pathlib.Path(file.filename or "").suffix.lower()
    filename_hint = file.filename or "upload"
    if declared_content_type and declared_content_type not in ALLOWED_IMAGE and suffix not in IMAGE_MIME_BY_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"Nur PNG, JPG oder WebP erlaubt. Erkannt: {declared_content_type or 'unbekannt'}",
        )
    # Read & size check
    data = await _read_upload_limited(file, MAX_BYTES, MAX_IMAGE_UPLOAD_MB)
    original_size = len(data)
    try:
        with Image.open(BytesIO(data)) as img:
            img.verify()
        with Image.open(BytesIO(data)) as img:
            detected_format = (img.format or "").upper()
            if detected_format not in PIL_IMAGE_FORMATS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Nur PNG, JPG oder WebP erlaubt. Erkannt: {detected_format or declared_content_type or 'unbekannt'}",
                )
            if img.width * img.height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="Bildauflösung ist zu groß")
            content_type, ext = PIL_IMAGE_FORMATS[detected_format]
            img = ImageOps.exif_transpose(img)
            if declared_content_type and declared_content_type not in ALLOWED_IMAGE:
                logger.info(
                    "[uploads] accepted image with browser content-type %s after detecting %s (%s)",
                    declared_content_type,
                    detected_format,
                    filename_hint,
                )
            elif suffix in IMAGE_MIME_BY_EXT and IMAGE_MIME_BY_EXT[suffix] != content_type:
                logger.info(
                    "[uploads] accepted image with mismatched suffix %s after detecting %s (%s)",
                    suffix,
                    detected_format,
                    filename_hint,
                )
            trimmed = False
            if trim_empty_borders:
                img, trimmed = _trim_empty_borders(img)
            img, resized = _resize_for_storage(img)
            output_format = img.format or detected_format
            if trimmed or resized or original_size > 12 * 1024 * 1024:
                output_format = "WEBP"
                content_type, ext = "image/webp", ".webp"
            out = BytesIO()
            save_kwargs = {}
            if output_format == "JPEG":
                img = img.convert("RGB")
                save_kwargs = {"quality": 88, "optimize": True}
            elif output_format == "PNG":
                img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
                save_kwargs = {"optimize": True}
            elif output_format == "WEBP":
                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
                save_kwargs = {"quality": 88, "method": 6}
            img.save(out, format=output_format, **save_kwargs)
            data = out.getvalue()
    except UnidentifiedImageError:
        raise HTTPException(status_code=400, detail="Ungültige Bilddatei")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("[uploads] image processing failed: %s", exc)
        raise HTTPException(status_code=400, detail="Bild konnte nicht verarbeitet werden. Bitte PNG, JPG oder WebP erneut exportieren.")
    filename = f"{uuid.uuid4().hex}{ext}"
    path = PUBLIC_UPLOAD_DIR / filename
    try:
        path.write_bytes(data)
    except OSError as exc:
        logger.error("[uploads] failed to write %s: %s", path, exc)
        raise HTTPException(status_code=500, detail="Upload-Speicher ist nicht beschreibbar. Bitte Docker-Volume/UPLOAD_DIR prüfen.")
    url = f"/api/static/uploads/{filename}"
    try:
        await get_db().media_uploads.insert_one({
            "id": new_id(),
            "filename": filename,
            "url": url,
            "size": len(data),
            "original_size": original_size,
            "original_filename": filename_hint,
            "mime": content_type,
            "ext": ext.lstrip("."),
            "owner_id": me.get("id"),
            "owner_role": me.get("role"),
            "media_scope": media_scope,
            "created_at": now_utc().isoformat(),
            "updated_at": now_utc().isoformat(),
        })
    except Exception as exc:
        logger.warning("[uploads] media metadata write failed for %s: %s", filename, exc)
    return {"url": url, "filename": filename, "size": len(data), "original_size": original_size, "media_scope": media_scope}


@router.post("/image")
async def upload_image(
    request: Request,
    file: UploadFile = File(...),
    me: dict = Depends(get_current_user),
    trim_empty_borders: bool = False,
    media_scope: str = "user",
):
    await enforce_rate_limit(request, "uploads:image:user", limit=30, window_seconds=3600, subject=me["id"])
    return await _upload_image_impl(file, me, trim_empty_borders, media_scope)


@router.post("/sponsor-logo")
async def upload_sponsor_logo(request: Request, file: UploadFile = File(...), me: dict = Depends(require_admin())):
    """Admin-only convenience alias for sponsor logos."""
    await enforce_rate_limit(request, "uploads:image:user", limit=30, window_seconds=3600, subject=me["id"])
    return await _upload_image_impl(file, me, trim_empty_borders=True, media_scope="sponsor")


@router.post("/logo")
async def upload_logo(request: Request, file: UploadFile = File(...), me: dict = Depends(require_admin())):
    """Admin-only logo upload with automatic whitespace trimming."""
    await enforce_rate_limit(request, "uploads:image:user", limit=30, window_seconds=3600, subject=me["id"])
    return await _upload_image_impl(file, me, trim_empty_borders=True, media_scope="branding")


@router.post("/migrate-external-images")
async def migrate_external_images(me: dict = Depends(require_admin())):
    """Scan all collections and download external image URLs into local uploads.
    Idempotent. Returns a per-collection summary of {scanned, updated, failed}."""
    from services.image_migrate import migrate_all
    summary = await migrate_all()
    return {"ok": True, "summary": summary}


@router.get("/audit-images")
async def audit_images(me: dict = Depends(require_admin())):
    """Report stored image references that are external, legacy or missing."""
    from services.media_audit import audit_image_references
    return await audit_image_references(repair=False)


@router.post("/normalize-image-urls")
async def normalize_image_urls(me: dict = Depends(require_admin())):
    """Normalize legacy local image URLs to /api/static/uploads/{filename}."""
    from services.media_audit import audit_image_references
    return await audit_image_references(repair=True)


@router.post("/clear-missing-image-refs")
async def clear_missing_image_refs(me: dict = Depends(require_admin())):
    """Clear direct image fields that point to missing local upload files."""
    from services.media_audit import audit_image_references
    return await audit_image_references(repair=True, clear_missing=True)


@router.get("/audit-media-scopes")
async def audit_media_upload_scopes(me: dict = Depends(require_admin())):
    """Report legacy media metadata entries that need a media_scope."""
    from services.media_audit import audit_media_scopes
    return await audit_media_scopes(repair=False)


@router.post("/repair-media-scopes")
async def repair_media_upload_scopes(me: dict = Depends(require_admin())):
    """Backfill media_scope on legacy media metadata entries."""
    from services.media_audit import audit_media_scopes
    return await audit_media_scopes(repair=True)


_EXT_BY_MIME = {
    "application/pdf": ".pdf",
    "application/zip": ".zip", "application/x-zip-compressed": ".zip",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "text/plain": ".txt", "text/csv": ".csv", "text/markdown": ".md",
    "image/png": ".png", "image/jpeg": ".jpg",
}


@router.post("/document")
async def upload_document(request: Request, file: UploadFile = File(...), me: dict = Depends(require_admin())):
    """Upload an arbitrary document (PDF, DOCX, XLSX, ZIP, ...).
    Stores it outside the public static tree and returns a storage key."""
    await enforce_rate_limit(request, "uploads:document:user", limit=20, window_seconds=3600, subject=me["id"])
    if file.content_type not in ALLOWED_DOC:
        raise HTTPException(status_code=400, detail=f"Dateityp nicht erlaubt: {file.content_type}")
    data = await _read_upload_limited(file, MAX_DOC_BYTES, MAX_DOCUMENT_UPLOAD_MB)
    if file.content_type == "application/pdf" and not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Dateiinhalt ist kein gültiges PDF")
    if file.content_type in {
        "application/zip",
        "application/x-zip-compressed",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    } and not data.startswith(b"PK"):
        raise HTTPException(status_code=400, detail="Dateiinhalt passt nicht zum angegebenen Dateityp")
    if file.content_type in {"image/png", "image/jpeg"}:
        try:
            with Image.open(BytesIO(data)) as img:
                img.verify()
        except UnidentifiedImageError:
            raise HTTPException(status_code=400, detail="Ungültige Bilddatei")
    # Extension by mime, fallback to original name extension
    ext = _EXT_BY_MIME.get(file.content_type)
    if not ext and file.filename:
        ext = pathlib.Path(file.filename).suffix.lower()
    filename = f"{uuid.uuid4().hex}{ext or ''}"
    path = PRIVATE_DOC_DIR / filename
    try:
        PRIVATE_DOC_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    except OSError as exc:
        logger.error("[uploads] failed to write document %s: %s", path, exc)
        raise HTTPException(status_code=500, detail="Upload-Speicher ist nicht beschreibbar. Bitte Docker-Volume/UPLOAD_DIR prüfen.")
    return {
        "url": "",
        "storage_key": filename,
        "filename": filename,
        "original_filename": file.filename,
        "size": len(data),
        "mime": file.content_type,
    }
