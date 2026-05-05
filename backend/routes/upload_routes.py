"""File upload routes. Stores images and documents on local disk at /app/backend/uploads/
served via /uploads/... static mount."""
import os
import uuid
import pathlib
import logging
from io import BytesIO
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from PIL import Image, UnidentifiedImageError
from auth import require_admin, get_current_user

logger = logging.getLogger("tls-arena.uploads")
UPLOAD_DIR = pathlib.Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC_UPLOAD_DIR = UPLOAD_DIR / "public"
PRIVATE_DOC_DIR = UPLOAD_DIR / "documents"
PUBLIC_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PRIVATE_DOC_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_IMAGE = {"image/png", "image/jpeg", "image/webp"}
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
MAX_IMAGE_PIXELS = 36_000_000

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


@router.post("/image")
async def upload_image(file: UploadFile = File(...), me: dict = Depends(get_current_user)):
    """Upload an image. Returns public URL `/uploads/{filename}`.
    Accepts PNG/JPEG/WebP and re-encodes before serving."""
    declared_content_type = file.content_type or ""
    suffix = pathlib.Path(file.filename or "").suffix.lower()
    filename_hint = file.filename or "upload"
    if declared_content_type and declared_content_type not in ALLOWED_IMAGE and suffix not in IMAGE_MIME_BY_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"Nur PNG, JPG oder WebP erlaubt. Erkannt: {declared_content_type or 'unbekannt'}",
        )
    # Read & size check
    data = await file.read()
    original_size = len(data)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Datei zu gross (max {MAX_IMAGE_UPLOAD_MB} MB)")
    try:
        with Image.open(BytesIO(data)) as img:
            img.verify()
        with Image.open(BytesIO(data)) as img:
            if img.width * img.height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="Bild ist zu gross (max 36 Megapixel)")
            detected_format = (img.format or "").upper()
            if detected_format not in PIL_IMAGE_FORMATS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Nur PNG, JPG oder WebP erlaubt. Erkannt: {detected_format or declared_content_type or 'unbekannt'}",
                )
            content_type, ext = PIL_IMAGE_FORMATS[detected_format]
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
            output_format = img.format
            out = BytesIO()
            save_kwargs = {}
            if output_format == "JPEG":
                img = img.convert("RGB")
                save_kwargs = {"quality": 88, "optimize": True}
            elif output_format == "PNG":
                img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
                save_kwargs = {"optimize": True}
            elif output_format == "WEBP" and img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
                save_kwargs = {"quality": 88, "method": 6}
            img.save(out, format=output_format, **save_kwargs)
            data = out.getvalue()
    except UnidentifiedImageError:
        raise HTTPException(status_code=400, detail="Ungueltige Bilddatei")
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
        raise HTTPException(status_code=500, detail="Upload-Speicher ist nicht beschreibbar. Bitte Docker-Volume/UPLOAD_DIR pruefen.")
    return {"url": f"/api/static/uploads/{filename}", "filename": filename, "size": len(data), "original_size": original_size}


@router.post("/sponsor-logo")
async def upload_sponsor_logo(file: UploadFile = File(...), me: dict = Depends(require_admin())):
    """Admin-only convenience alias for sponsor logos."""
    return await upload_image(file, me)


@router.post("/migrate-external-images")
async def migrate_external_images(me: dict = Depends(require_admin())):
    """Scan all collections and download external image URLs into local uploads.
    Idempotent. Returns a per-collection summary of {scanned, updated, failed}."""
    from services.image_migrate import migrate_all
    summary = await migrate_all()
    return {"ok": True, "summary": summary}


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
async def upload_document(file: UploadFile = File(...), me: dict = Depends(require_admin())):
    """Upload an arbitrary document (PDF, DOCX, XLSX, ZIP, ...).
    Stores it outside the public static tree and returns a storage key."""
    if file.content_type not in ALLOWED_DOC:
        raise HTTPException(status_code=400, detail=f"Dateityp nicht erlaubt: {file.content_type}")
    data = await file.read()
    if len(data) > MAX_DOC_BYTES:
        raise HTTPException(status_code=413, detail=f"Datei zu gross (max {MAX_DOCUMENT_UPLOAD_MB} MB)")
    if file.content_type == "application/pdf" and not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Dateiinhalt ist kein gueltiges PDF")
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
            raise HTTPException(status_code=400, detail="Ungueltige Bilddatei")
    # Extension by mime, fallback to original name extension
    ext = _EXT_BY_MIME.get(file.content_type)
    if not ext and file.filename:
        ext = pathlib.Path(file.filename).suffix.lower()
    filename = f"{uuid.uuid4().hex}{ext or ''}"
    path = PRIVATE_DOC_DIR / filename
    path.write_bytes(data)
    return {
        "url": "",
        "storage_key": filename,
        "filename": filename,
        "original_filename": file.filename,
        "size": len(data),
        "mime": file.content_type,
    }
