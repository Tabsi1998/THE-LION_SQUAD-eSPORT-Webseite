"""Chat-Anhänge hochladen und geschützt ausliefern.

Die Dateien liegen nicht im öffentlichen Upload-Verzeichnis. Wer keinen Zugriff
hat, bekommt 404 statt 403 - sonst ließe sich prüfen, ob es einen Anhang gibt.
"""
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from auth import get_current_user, get_optional_user
from database import get_db
from services import moderation_standing
from services.chat_attachments import (
    CHAT_UPLOAD_RATE_LIMIT,
    attachment_path,
    can_access,
    store_chat_upload,
)
from services.image_variants import resolve_variant
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/chat-attachments", tags=["chat-attachments"])

FILE_HEADERS = {"X-Content-Type-Options": "nosniff", "Content-Disposition": "inline"}


@router.post("")
async def upload_chat_attachment(
    request: Request,
    file: UploadFile = File(...),
    poster: UploadFile | None = File(None),
    me: dict = Depends(get_current_user),
):
    await moderation_standing.require_chat_allowed(get_db(), me)
    await enforce_rate_limit(
        request,
        "chat-attachments:upload",
        limit=CHAT_UPLOAD_RATE_LIMIT,
        window_seconds=3600,
        subject=me["id"],
    )
    return await store_chat_upload(file, me, poster)


async def _authorized(attachment_id: str, user: dict | None) -> dict:
    doc = await get_db().chat_attachments.find_one({"id": attachment_id}, {"_id": 0})
    if not doc or not await can_access(doc, user):
        raise HTTPException(status_code=404, detail="Anhang nicht gefunden")
    return doc


@router.get("/{attachment_id}")
async def get_chat_attachment(attachment_id: str, w: int | None = None, user: dict | None = Depends(get_optional_user)):
    doc = await _authorized(attachment_id, user)
    path = attachment_path(doc.get("storage_key"))
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Anhang nicht gefunden")
    if doc.get("kind") == "image" and w is not None:
        variant = resolve_variant(path, w)
        if variant is not None:
            return FileResponse(variant, media_type="image/webp", headers=FILE_HEADERS)
    return FileResponse(path, media_type=doc.get("mime") or "application/octet-stream", headers=FILE_HEADERS)


@router.get("/{attachment_id}/poster")
async def get_chat_attachment_poster(attachment_id: str, user: dict | None = Depends(get_optional_user)):
    doc = await _authorized(attachment_id, user)
    path = attachment_path(doc.get("poster_key"))
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Kein Standbild vorhanden")
    return FileResponse(path, media_type="image/webp" if path.suffix == ".webp" else "image/png", headers=FILE_HEADERS)
