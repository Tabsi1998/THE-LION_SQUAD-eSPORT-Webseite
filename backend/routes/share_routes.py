"""Ergebnis als Bild teilen (#1194).

- ``GET /api/share/result/{turnier}/{benutzer}``            die Daten der Teilen-Seite - nur öffentlich teilbar
- ``GET /api/share/result/{turnier}/{benutzer}/story.png``  hoch, 1080×1920 (WhatsApp-Status, Instagram-Story)
- ``GET /api/share/result/{turnier}/{benutzer}/wide.png``   breit, 1200×630 (Link-Vorschau)
- ``GET /api/share/result-options/{turnier}``               für den Knopf „Ergebnis teilen“: geht es, und wenn nicht, warum
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from auth import get_current_user
from database import get_db
from services import result_share
from services.profile_references import RESULT_TOURNAMENT_STATUSES, _visible_tournament

router = APIRouter(prefix="/api/share", tags=["share"])

NOT_PUBLIC = "Dieses Ergebnis ist nicht öffentlich."


@router.get("/result/{tournament}/{username}")
async def shared_result(tournament: str, username: str):
    payload = await result_share.share_payload(get_db(), tournament, username)
    if not payload:
        raise HTTPException(status_code=404, detail=NOT_PUBLIC)
    return {**payload, "headline": result_share.headline(payload), "share_text": result_share.share_text(payload)}


@router.get("/result/{tournament}/{username}/{fmt}.png")
async def shared_result_image(tournament: str, username: str, fmt: Literal["story", "wide"]):
    payload = await result_share.share_payload(get_db(), tournament, username)
    if not payload:
        raise HTTPException(status_code=404, detail=NOT_PUBLIC)
    name = f"ergebnis-{payload['tournament']['slug']}-{username}-{fmt}.png"
    return Response(content=result_share.render(payload, fmt), media_type="image/png",
                    headers={"Content-Disposition": f'inline; filename="{name}"'})


@router.get("/result-options/{tournament}")
async def result_share_options(tournament: str, me: dict = Depends(get_current_user)):
    """Ob die angemeldete Person ihr Ergebnis teilen kann - und wenn nicht, ein Satz, warum."""
    db = get_db()
    doc = await db.tournaments.find_one({"$or": [{"id": tournament}, {"slug": tournament}]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if doc.get("status") not in RESULT_TOURNAMENT_STATUSES:
        return {"shareable": False, "reason": "not_finished", "text": "Teilen geht, sobald das Turnier Ergebnisse hat."}
    regs, _team = await result_share.own_registrations(db, doc, me)
    if not regs:
        return {"shareable": False, "reason": "not_participant", "text": "Du hast bei diesem Turnier nicht mitgespielt."}
    if not await _visible_tournament(doc):
        return {"shareable": False, "reason": "not_public", "text": "Das Turnier ist nicht öffentlich – darum gibt es kein Teilen-Bild."}
    if not me.get("privacy_public_profile"):
        return {"shareable": False, "reason": "private_profile",
                "text": "Dein Profil ist privat. Teilen geht, sobald du es unter Einstellungen → Privatsphäre öffentlich stellst."}
    payload = await result_share.share_payload(db, doc["id"], me["username"])
    if not payload:
        return {"shareable": False, "reason": "not_public", "text": NOT_PUBLIC}
    return {"shareable": True, "path": payload["path"], "image_paths": payload["image_paths"],
            "headline": result_share.headline(payload), "share_text": result_share.share_text(payload)}
