"""Fotos vom Event einsenden (#1186): Mitglieder schicken, Redaktion und Vereinsverwaltung geben frei.

Die Regeln stehen in ``services/event_photos.py``. Eingesandte Bilder liegen privat und kommen nur über
``GET /api/gallery/submissions/{id}/image`` - für die einsendende Person und die Freigabe; alle anderen bekommen 404.
Die Freigabe-Wege liegen unter ``/api/admin/gallery-submissions`` (nicht unter ``/api/admin/gallery/…``, dort steht
schon das einzelne Album).
"""
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from auth import get_current_user, get_optional_user, require_area
from database import get_db
from services import event_photos
from services.form_flags import form_flag
from services.image_variants import resolve_variant
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api", tags=["gallery"])

# Nie zwischenspeichern: bis zur Freigabe ist das Bild nur für wenige bestimmt.
FILE_HEADERS = {"X-Content-Type-Options": "nosniff", "Content-Disposition": "inline", "Cache-Control": "private, no-store"}
SUBMIT_RATE_LIMIT = 40
SUBMIT_RATE_WINDOW_SECONDS = 3600


class SubmissionDecision(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=200)
    action: str = Field(pattern="^(approve|reject)$")
    reason: str | None = Field(default=None, max_length=300)


@router.post("/gallery/{album_id}/submissions")
async def submit_photo(
    album_id: str,
    request: Request,
    file: UploadFile = File(...),
    consent: str | None = Form(None),
    # Text statt bool: ohne Feld gilt die Vorgabe in jeder FastAPI-Version (services/form_flags.py).
    credit: str | None = Form(None),
    me: dict = Depends(get_current_user),
):
    db = get_db()
    album = await event_photos.find_album(db, album_id)
    await enforce_rate_limit(request, "gallery:submission", limit=SUBMIT_RATE_LIMIT, window_seconds=SUBMIT_RATE_WINDOW_SECONDS, subject=me["id"])
    return await event_photos.store_submission(
        db, album, me, file, consent=form_flag(consent, default=False), credit=form_flag(credit, default=True))


@router.get("/gallery/submissions/{submission_id}/image")
async def submission_image(submission_id: str, w: int | None = None, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    doc = await db.gallery_submissions.find_one({"id": submission_id, "status": "pending"}, {"_id": 0})
    if not doc or not await event_photos.can_view(db, doc, user):
        raise HTTPException(status_code=404, detail="Foto nicht gefunden")
    path = event_photos.submission_path(doc.get("storage_key"))
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Foto nicht gefunden")
    if w is not None:
        variant = resolve_variant(path, w)
        if variant is not None:
            return FileResponse(variant, media_type="image/webp", headers=FILE_HEADERS)
    return FileResponse(path, media_type=doc.get("mime") or "application/octet-stream", headers=FILE_HEADERS)


@router.get("/admin/gallery-submissions")
async def list_submissions(me: dict = Depends(require_area(*event_photos.DECIDE_AREAS))):
    return await event_photos.queue(get_db())


@router.post("/admin/gallery-submissions/decide")
async def decide_submissions(body: SubmissionDecision, me: dict = Depends(require_area(*event_photos.DECIDE_AREAS))):
    return await event_photos.decide(get_db(), body.ids, approve=body.action == "approve", actor=me, reason=body.reason)
