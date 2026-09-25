"""Kalender der Website (#402): eine Liste für die Monatsansicht und ein Abo-Feed.

`GET /api/calendar` liefert, was die angemeldete Person sehen darf (mit „angemeldet“-Kennzeichen);
`GET /api/calendar/feed.ics` ist der öffentliche Feed für Kalender-Apps - anonym, ohne
Personendaten, damit die Adresse weitergegeben werden kann. `GET /api/calendar/events/{id}.ics`
und `.../tournaments/{id}.ics` (#580) sind ein einzelner Termin zum Hinzufügen - nur, was
öffentlich ist, mit Erinnerung eine Stunde vorher und bei Turnieren dem Check-in im Text.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from auth import get_optional_user
from database import get_db
from routes.seo_render_routes import public_origin
from services import calendar_items
from services.slug_utils import find_by_slug_or_history
from services.visibility import user_can_see

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

FEED_PATH = "/api/calendar/feed.ics"


@router.get("")
async def calendar(user: dict | None = Depends(get_optional_user)):
    db = get_db()
    items = await calendar_items.collect(db, user)
    return {"items": items, "signed_in": bool(user), "feed_path": FEED_PATH}


@router.get("/feed.ics")
async def calendar_feed(request: Request):
    db = get_db()
    items = await calendar_items.collect(db, None)
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    text = calendar_items.ics_feed(items, origin=public_origin(request, branding))
    return Response(
        content=text,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'inline; filename="lionsquad-termine.ics"', "Cache-Control": "public, max-age=600"},
    )


async def _single_ics(request: Request, db, kind: str, doc: dict | None) -> Response:
    """Ein Termin als Datei - anonym gesehen: was nicht öffentlich ist, gibt es hier nicht."""
    hidden = not doc or doc.get("status") == "draft" or (kind == "tournament" and doc.get("is_public") is False)
    if hidden or not await user_can_see(None, doc.get("visibility")):
        raise HTTPException(404, "Diesen Termin gibt es nicht – oder er ist nicht öffentlich.")
    item = calendar_items.event_item(doc) if kind == "event" else calendar_items.tournament_item(doc)
    if not item:
        raise HTTPException(404, "Dieser Termin hat noch kein Datum.")
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    extra = calendar_items.check_in_note(doc) if kind == "tournament" else None
    text = calendar_items.ics_single(item, origin=public_origin(request, branding), extra_detail=extra)
    return Response(
        content=text,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{calendar_items.ics_filename(item)}"', "Cache-Control": "public, max-age=600"},
    )


@router.get("/events/{slug_or_id}.ics")
async def event_ics(slug_or_id: str, request: Request):
    db = get_db()
    doc, _ = await find_by_slug_or_history(db.events, slug_or_id, {"_id": 0})
    return await _single_ics(request, db, "event", doc)


@router.get("/tournaments/{slug_or_id}.ics")
async def tournament_ics(slug_or_id: str, request: Request):
    db = get_db()
    doc, _ = await find_by_slug_or_history(db.tournaments, slug_or_id, {"_id": 0})
    return await _single_ics(request, db, "tournament", doc)
