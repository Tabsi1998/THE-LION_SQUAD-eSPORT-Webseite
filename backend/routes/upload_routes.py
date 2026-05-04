"""File upload routes. Stores images and documents on local disk at /app/backend/uploads/
served via /uploads/... static mount."""
import os
import uuid
import pathlib
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from auth import require_admin, get_current_user

UPLOAD_DIR = pathlib.Path("/app/backend/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_IMAGE = {"image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"}
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
MAX_BYTES = 5 * 1024 * 1024  # 5 MB images
MAX_DOC_BYTES = 25 * 1024 * 1024  # 25 MB docs

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


@router.post("/image")
async def upload_image(file: UploadFile = File(...), me: dict = Depends(get_current_user)):
    """Upload an image. Returns public URL `/uploads/{filename}`.
    Accepts PNG/JPEG/WebP/SVG/GIF up to 5 MB."""
    if file.content_type not in ALLOWED_IMAGE:
        raise HTTPException(status_code=400, detail="Nur PNG, JPG, WebP, SVG oder GIF")
    ext = {
        "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
        "image/svg+xml": ".svg", "image/gif": ".gif",
    }.get(file.content_type, "")
    # Read & size check
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Datei zu groß (max 5 MB)")
    filename = f"{uuid.uuid4().hex}{ext}"
    path = UPLOAD_DIR / filename
    path.write_bytes(data)
    return {"url": f"/api/static/uploads/{filename}", "filename": filename, "size": len(data)}


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
    """Upload an arbitrary document (PDF, DOCX, XLSX, ZIP, …) up to 25 MB.
    Returns the public URL plus mime + filename + size for the documents table."""
    if file.content_type not in ALLOWED_DOC:
        raise HTTPException(status_code=400, detail=f"Dateityp nicht erlaubt: {file.content_type}")
    data = await file.read()
    if len(data) > MAX_DOC_BYTES:
        raise HTTPException(status_code=413, detail="Datei zu groß (max 25 MB)")
    # Extension by mime, fallback to original name extension
    ext = _EXT_BY_MIME.get(file.content_type)
    if not ext and file.filename:
        ext = pathlib.Path(file.filename).suffix.lower()
    filename = f"{uuid.uuid4().hex}{ext or ''}"
    path = UPLOAD_DIR / filename
    path.write_bytes(data)
    return {
        "url": f"/api/static/uploads/{filename}",
        "filename": filename,
        "original_filename": file.filename,
        "size": len(data),
        "mime": file.content_type,
    }
