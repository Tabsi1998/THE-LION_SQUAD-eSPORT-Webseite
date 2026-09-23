"""Kalender der Website (#402): eine Liste für die Monatsansicht und ein Abo-Feed.

`GET /api/calendar` liefert, was die angemeldete Person sehen darf (mit „angemeldet“-Kennzeichen);
`GET /api/calendar/feed.ics` ist der öffentliche Feed für Kalender-Apps - anonym, ohne
Personendaten, damit die Adresse weitergegeben werden kann.
"""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from auth import get_optional_user
from database import get_db
from routes.seo_render_routes import public_origin
from services import calendar_items

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
