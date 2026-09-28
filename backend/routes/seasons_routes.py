"""Jahreszeiten (#632): die öffentliche Abfrage „was ist gerade aktiv“ und der Jahreskalender.

Ohne Anmeldung, ohne personenbezogene Daten, eine Minute gecacht (ETag). Mit einem gültigen
Vorschau-Token (Admin-Seite, 60 Sekunden) rechnet der Server die gewählte Saison als aktiv - nur
für die Person, die das Token mitschickt, deshalb dann ohne Cache.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Query, Request, Response

from database import get_db
from services import seasons

router = APIRouter(prefix="/api/seasonal", tags=["seasonal"])  # /api/seasons gehört den Wettkampf-Saisonen
ABOUT_SETTINGS_ID = "about_page"


async def load_context(db) -> tuple[dict, str | None]:
    """Gespeicherte Saison-Einstellungen und das Gründungsdatum aus Verein → Über uns."""
    stored = await db.settings.find_one({"id": seasons.SETTINGS_ID}, {"_id": 0}) or {}
    about = await db.settings.find_one({"id": ABOUT_SETTINGS_ID}, {"_id": 0, "founded_on": 1}) or {}
    return stored, about.get("founded_on")


@router.get("/active")
async def active_seasons(request: Request, response: Response, preview: str | None = Query(None)):
    db = get_db()
    stored, founded = await load_context(db)
    token = seasons.read_preview_token(preview)
    if token:
        key, at_time = token
        payload = seasons.active(at_time, stored, founded, preview_key=key)
        response.headers["Cache-Control"] = "no-store"
        return payload
    payload = seasons.active(None, stored, founded)
    # Die Sekunde in „now“ würde jeden ETag brechen; für den Vergleich zählt nur, was gezeigt wird.
    etag = seasons.etag_for({k: v for k, v in payload.items() if k != "now"})
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "public, max-age=60"
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=60"})
    return payload


@router.get("/calendar")
async def seasons_calendar(response: Response, year: int | None = Query(None, ge=2000, le=2100)):
    db = get_db()
    _stored, founded = await load_context(db)
    year = year or datetime.now(tz=seasons.VIENNA).year
    response.headers["Cache-Control"] = "public, max-age=3600"
    return {"year": year, "items": seasons.calendar(year, founded)}
