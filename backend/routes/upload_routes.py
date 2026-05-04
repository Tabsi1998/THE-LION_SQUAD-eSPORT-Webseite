"""File upload routes. Stores images on local disk at /app/backend/uploads/
served via /uploads/... static mount."""
import os
import uuid
import pathlib
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from auth import require_admin, get_current_user

UPLOAD_DIR = pathlib.Path("/app/backend/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_IMAGE = {"image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"}
MAX_BYTES = 5 * 1024 * 1024  # 5 MB

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
