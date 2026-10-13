"""Rückblick nach dem Event (#1187) und Freunde beim Event (#1188) - eigene Routen neben ``event_routes``.

- ``GET /api/events/{id}/recap``: Sieger, Zahlen, Bericht; mit Konto dazu „Du warst dabei“ - dann „private, no-store“.
  Ohne Konto gilt wie für jede API-Antwort „no-store“ (Middleware in ``server.py``).
- ``GET /api/events/{id}/friends``: welche bestätigten Freunde beim Event angemeldet sind - nur mit Konto, nie
  zwischengespeichert. Die Regeln stehen in ``services/event_friends.py``.
- ``POST /api/users/me/friends-hint``: den einmaligen Hinweis bestätigen oder dabei gleich ausschalten.
"""
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from auth import get_current_user, get_optional_user
from database import get_db
from models import now_utc
from services import event_friends, event_recap
from services.access_links import validate_access_link
from services.permissions import is_confirmed_tournament_lead
from services.slug_utils import find_by_slug_or_history
from services.visibility import lead_can_see

router = APIRouter(tags=["events"])

PRIVATE_CACHE = "private, no-store"


async def _visible_event(slug_or_id: str, user: dict | None, access: str | None) -> dict:
    """Das Event mit denselben Regeln wie die Event-Seite: Entwürfe nur für die Turnierleitung, sonst die Sichtbarkeit."""
    db = get_db()
    headers = {"Cache-Control": PRIVATE_CACHE} if user else None
    event, _ = await find_by_slug_or_history(db.events, slug_or_id, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event nicht gefunden", headers=headers)
    has_access = bool(await validate_access_link(db, access, "event", event["id"], user, "view"))
    if event.get("status") == "draft" and not (is_confirmed_tournament_lead(user) or has_access):
        raise HTTPException(status_code=404, detail="Event nicht gefunden", headers=headers)
    if not has_access and not await lead_can_see(user, event.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Event ist nicht sichtbar.", headers=headers)
    return event


@router.get("/api/events/{event_id}/recap")
async def event_recap_view(event_id: str, response: Response, access: str | None = None, user: dict | None = Depends(get_optional_user)):
    if user:
        response.headers["Cache-Control"] = PRIVATE_CACHE
    response.headers["Vary"] = "Authorization, Cookie"
    event = await _visible_event(event_id, user, access)
    return await event_recap.build(get_db(), event, user)


@router.get("/api/events/{event_id}/friends")
async def event_friends_view(event_id: str, response: Response, me: dict = Depends(get_current_user)):
    response.headers["Cache-Control"] = PRIVATE_CACHE
    response.headers["Vary"] = "Authorization, Cookie"
    event = await _visible_event(event_id, me, None)
    db = get_db()
    viewer = await db.users.find_one({"id": me["id"]}, {"_id": 0, "id": 1, "role": 1, "roles": 1, "birth_date": 1,
                                                       event_friends.SETTING: 1, event_friends.HINT_FIELD: 1}) or {}
    return await event_friends.friends_at_event(db, event, {**me, **viewer})


class FriendsHintBody(BaseModel):
    # „Ausschalten“ im Hinweis schaltet die Einstellung gleich mit aus; „Verstanden“ bestätigt nur.
    turn_off: bool = False


@router.post("/api/users/me/friends-hint")
async def confirm_friends_hint(body: FriendsHintBody, response: Response, me: dict = Depends(get_current_user)):
    response.headers["Cache-Control"] = PRIVATE_CACHE
    db = get_db()
    now = now_utc().isoformat()
    updates = {event_friends.HINT_FIELD: now, "updated_at": now}
    if body.turn_off:
        updates[event_friends.SETTING] = False
    await db.users.update_one({"id": me["id"]}, {"$set": updates})
    stored = await db.users.find_one({"id": me["id"]}, {"_id": 0, "birth_date": 1, event_friends.SETTING: 1}) or {}
    return {"sharing": event_friends.shares_registrations(stored)}
