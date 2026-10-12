"""Foto vom Ergebnis (#1157, #1158): hochladen und geschützt ausliefern.

Hochladen darf, wer für eine Seite des Spiels handelt (wer angemeldet hat, bei Teams Teamleitung und Co-Leitung -
#1136) oder dort Ergebnisse eintragen darf. Ausgeliefert wird nur an die Spieler dieses Spiels und die Turnierleitung
dieses Turniers (services/match_proofs.can_see) - alle anderen bekommen 404.
"""
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from auth import get_current_user, get_optional_user
from database import get_db
from services import match_proofs
from services.image_variants import resolve_variant
from services.match_audience import acting_registration, registrations_for_match
from services.rate_limit import enforce_rate_limit
from services.tournament_permissions import has_match_result_permission

router = APIRouter(prefix="/api/matches", tags=["matches"])

# Nie zwischenspeichern: das Foto ist persönlich und nur für wenige bestimmt.
FILE_HEADERS = {"X-Content-Type-Options": "nosniff", "Content-Disposition": "inline", "Cache-Control": "private, no-store"}
CLOSED_STATUSES = {"cancelled", "archived", "bye"}


@router.post("/{match_id}/proof-photos")
async def upload_proof_photo(match_id: str, request: Request, file: UploadFile = File(...), me: dict = Depends(get_current_user)):
    db = get_db()
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    if str(match.get("status") or "") in CLOSED_STATUSES:
        raise HTTPException(status_code=409, detail="Zu diesem Spiel lässt sich kein Foto mehr anhängen.")
    acting = await acting_registration(db, await registrations_for_match(db, match), me.get("id"))
    if not acting and not await has_match_result_permission(me, match):
        raise HTTPException(status_code=403, detail="Fotos zum Ergebnis schicken nur die Spieler dieses Spiels.")
    await enforce_rate_limit(request, "matches:proof-photo", limit=20, window_seconds=3600, subject=me["id"])
    return await match_proofs.store_proof(db, match, me, (acting or {}).get("id"), file)


@router.get("/{match_id}/proof-photos/{photo_id}")
async def get_proof_photo(match_id: str, photo_id: str, w: int | None = None, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    doc = await db.match_proof_photos.find_one({"id": photo_id, "match_id": match_id}, {"_id": 0})
    if not doc or not await match_proofs.can_see(db, doc, user):
        raise HTTPException(status_code=404, detail="Foto nicht gefunden")
    path = match_proofs.proof_path(doc.get("storage_key"))
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Foto nicht gefunden")
    if w is not None:
        variant = resolve_variant(path, w)
        if variant is not None:
            return FileResponse(variant, media_type="image/webp", headers=FILE_HEADERS)
    return FileResponse(path, media_type=doc.get("mime") or "application/octet-stream", headers=FILE_HEADERS)
