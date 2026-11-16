"""FAQ (#2448): geschützte Fragen nach Rechteprüfung am Server.

``GET /api/faq`` beantwortet jede Anfrage, auch ohne Konto - aber nur mit dem, was die Person sehen darf: Gäste und
Konten ohne Mitgliedschaft bekommen keine Mitglieder-Fragen, ohne den Bereich Turnierleitung keine Fragen der Leitung.
Die öffentlichen Fragen stehen im Frontend; ``darf`` sagt der Seite, welche Bereiche und Filter sie zeigen soll.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from auth import get_optional_user
from services import faq_protected

router = APIRouter(prefix="/api/faq", tags=["faq"])


@router.get("")
async def faq_for_viewer(response: Response, viewer: dict | None = Depends(get_optional_user)):
    access = await faq_protected.viewer_access(viewer)
    # Je Person verschieden: kein gemeinsamer Zwischenspeicher (Cloudflare, Browser).
    response.headers["Cache-Control"] = "private, no-store"
    return {"darf": access, "fragen": faq_protected.visible_questions(access), "anleitungen": []}
