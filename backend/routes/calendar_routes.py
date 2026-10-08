"""Kalender der Website (#402): eine Liste für die Monatsansicht und ein Abo-Feed.

`GET /api/calendar` liefert, was die angemeldete Person sehen darf (mit „angemeldet“-Kennzeichen);
`GET /api/calendar/feed.ics` ist der öffentliche Feed für Kalender-Apps - anonym, ohne
Personendaten, damit die Adresse weitergegeben werden kann. `GET /api/calendar/events/{id}.ics`,
`.../tournaments/{id}.ics` (#580) und `.../fastlaps/{id}.ics` (#1272) sind ein einzelner Termin zum
Hinzufügen - nur, was öffentlich ist, mit Erinnerung eine Stunde vorher und bei Turnieren dem Check-in
im Text; ein mehrtägiges Event liefert mit `?day=2` nur diesen Tag.

Versammlungen und eigene Helferschichten (#1272) gibt es nur für die Person selbst: `.../meetings/{id}.ics`
für eine Sitzung, zu der sie eingeladen ist, `.../shifts/{veranstaltung}/{schicht}.ics` für eine Schicht,
für die sie eingetragen ist - ohne Namen anderer, ohne Zugangslink.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from auth import get_current_user, get_optional_user
from database import get_db
from routes.seo_render_routes import public_origin
from services import calendar_items, club_calendar
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


def _ics_response(text: str, filename: str, *, private: bool = False) -> Response:
    # Persönliches (Versammlung, eigene Schicht) bleibt in keinem geteilten Zwischenspeicher liegen.
    cache = "private, no-store" if private else "public, max-age=600"
    return Response(
        content=text,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": cache},
    )


async def _single_ics(request: Request, db, kind: str, doc: dict | None, day: int | None = None) -> Response:
    """Ein Termin als Datei - anonym gesehen: was nicht öffentlich ist, gibt es hier nicht."""
    hidden = not doc or doc.get("status") == "draft" or (kind == "tournament" and doc.get("is_public") is False)
    if hidden or not await user_can_see(None, doc.get("visibility")):
        raise HTTPException(404, "Diesen Termin gibt es nicht – oder er ist nicht öffentlich.")
    if kind == "event":
        items = calendar_items.event_items(doc)
    elif kind == "fastlap":
        items = [calendar_items.fastlap_item(doc)]
    else:
        items = [calendar_items.tournament_item(doc)]
    items = [item for item in items if item]
    if day is not None:
        # Ein einzelner Tag eines mehrtägigen Events (#1272): „Nur ein Tag“ im Menü „In den Kalender“.
        if len(items) < 2 or not 1 <= day <= len(items):
            raise HTTPException(404, "Diesen Tag gibt es bei diesem Termin nicht.")
        items = [items[day - 1]]
    if not items:
        raise HTTPException(404, "Dieser Termin hat noch kein Datum.")
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    extra = calendar_items.check_in_note(doc) if kind == "tournament" else None
    origin = public_origin(request, branding)
    if len(items) > 1:
        # Mehrtägig (#884): eine Datei mit einem Eintrag je Tag, benannt nach dem Event.
        text = calendar_items.ics_bundle(items, origin=origin)
        filename = calendar_items.ics_filename({"title": doc.get("name") or items[0]["title"]})
    else:
        text = calendar_items.ics_single(items[0], origin=origin, extra_detail=extra)
        filename = calendar_items.ics_filename(items[0])
    return _ics_response(text, filename)


@router.get("/events/{slug_or_id}.ics")
async def event_ics(slug_or_id: str, request: Request, day: int | None = None):
    db = get_db()
    doc, _ = await find_by_slug_or_history(db.events, slug_or_id, {"_id": 0})
    return await _single_ics(request, db, "event", doc, day)


@router.get("/tournaments/{slug_or_id}.ics")
async def tournament_ics(slug_or_id: str, request: Request):
    db = get_db()
    doc, _ = await find_by_slug_or_history(db.tournaments, slug_or_id, {"_id": 0})
    return await _single_ics(request, db, "tournament", doc)


@router.get("/fastlaps/{slug_or_id}.ics")
async def fastlap_ics(slug_or_id: str, request: Request):
    db = get_db()
    doc, _ = await find_by_slug_or_history(db.f1_challenges, slug_or_id, {"_id": 0})
    return await _single_ics(request, db, "fastlap", doc)


async def _private_ics(request: Request, db, item: dict | None) -> Response:
    if not item:
        raise HTTPException(404, "Diesen Termin gibt es für dich nicht.")
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    text = calendar_items.ics_single(item, origin=public_origin(request, branding))
    return _ics_response(text, calendar_items.ics_filename(item), private=True)


@router.get("/meetings/{meeting_id}.ics")
async def meeting_ics(meeting_id: int, request: Request, me: dict = Depends(get_current_user)):
    """Eine Sitzung, zu der die Person eingeladen ist - wer nicht eingeladen ist, bekommt 404 (wie „gibt es nicht“)."""
    db = get_db()
    meeting = next((row for row in await club_calendar.meetings_for(db, me) if int(row.get("id") or 0) == meeting_id), None)
    return await _private_ics(request, db, club_calendar.meeting_item(meeting) if meeting else None)


@router.get("/shifts/{event_id}/{shift_id}.ics")
async def shift_ics(event_id: int, shift_id: int, request: Request, me: dict = Depends(get_current_user)):
    """Eine Schicht, für die die Person eingetragen ist - fremde oder freie Schichten gibt es hier nicht."""
    db = get_db()
    pair = next(((event, shift) for event, shift in await club_calendar.own_shifts_for(db, me)
                 if int(event.get("id") or 0) == event_id and int(shift.get("id") or 0) == shift_id), None)
    return await _private_ics(request, db, club_calendar.shift_item(*pair) if pair else None)
