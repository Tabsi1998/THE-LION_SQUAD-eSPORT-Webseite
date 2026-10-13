"""Rückblick nach dem Event (#1187) und Freunde beim Event (#1188) - eigene Routen neben ``event_routes``.

- ``GET /api/events/{id}/recap``: Sieger, Zahlen, Bericht; mit Konto dazu „Du warst dabei“ - dann „private, no-store“.
  Ohne Konto gilt wie für jede API-Antwort „no-store“ (Middleware in ``server.py``).
- ``GET /api/events/{id}/friends``: welche bestätigten Freunde beim Event angemeldet sind - nur mit Konto, nie
  zwischengespeichert. Die Regeln stehen in ``services/event_friends.py``.
- ``GET /api/tournaments/{id}/friends`` und ``GET /api/f1/challenges/{id}/friends`` (#1188 Teil 2): dieselbe Zeile auf
  Turnier- und Fast-Lap-Seite, mit denselben Regeln. Ob die Person die Seite sehen darf, prüft derselbe Wächter wie die
  Seite selbst (``_get_visible_tournament`` bzw. ``_get_visible_challenge_record``).
- ``GET /api/users/me/friends-hint``: ob der einmalige Hinweis direkt nach der ersten Anmeldung fällig ist.
- ``POST /api/users/me/friends-hint``: den einmaligen Hinweis bestätigen oder dabei gleich ausschalten.
"""
import re

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
# Die persönlichen Freunde-Pfade: „private, no-store“ in jeder Antwort, auch bei 401/403/404 vor oder im Handler
# (Codex-Prüfung #1500) - die Middleware in ``server.py`` setzt es für genau diese Pfade.
PRIVATE_PATHS = re.compile(r"^/api/(?:events/[^/]+/friends|tournaments/[^/]+/friends|f1/challenges/[^/]+/friends|users/me/friends-hint)/?$")


def is_private_path(path: str) -> bool:
    return bool(PRIVATE_PATHS.match(path or ""))
# Feldnamen ausgeschrieben, damit der Wächter für private Kontofelder (#1492) die reine Auswahl erkennt; sie sind
# event_friends.SETTING und event_friends.HINT_FIELD.
VIEWER_FIELDS = {"_id": 0, "id": 1, "role": 1, "roles": 1, "birth_date": 1, "privacy_friends_see_registrations": 1, "friends_registrations_hint_seen_at": 1}


async def _viewer(me: dict) -> dict:
    """Die fragende Person mit Einstellung und Hinweis-Zeitpunkt - beides steht nicht im Sitzungs-Nutzer."""
    stored = await get_db().users.find_one({"id": me["id"]}, VIEWER_FIELDS) or {}
    return {**me, **stored}


def _private(response: Response) -> None:
    response.headers["Cache-Control"] = PRIVATE_CACHE
    response.headers["Vary"] = "Authorization, Cookie"


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
    _private(response)
    event = await _visible_event(event_id, me, None)
    return await event_friends.friends_at_event(get_db(), event, await _viewer(me))


@router.get("/api/tournaments/{tournament_id}/friends")
async def tournament_friends_view(tournament_id: str, response: Response, me: dict = Depends(get_current_user)):
    from routes.tournament_common import _get_visible_tournament, _resolve_tid

    _private(response)
    tid = await _resolve_tid(tournament_id)
    tournament = await _get_visible_tournament(tid, me)
    return await event_friends.friends_at_tournament(get_db(), tournament, await _viewer(me))


@router.get("/api/f1/challenges/{challenge_id}/friends")
async def challenge_friends_view(challenge_id: str, response: Response, me: dict = Depends(get_current_user)):
    from routes.f1_routes import _get_visible_challenge_record

    _private(response)
    challenge, _ = await _get_visible_challenge_record(challenge_id, me)
    return await event_friends.friends_at_challenge(get_db(), challenge, await _viewer(me))


@router.get("/api/users/me/friends-hint")
async def friends_hint_status(response: Response, me: dict = Depends(get_current_user)):
    """Direkt nach einer Anmeldung fragen Website und App, ob der einmalige Hinweis jetzt fällig ist."""
    _private(response)
    viewer = await _viewer(me)
    return {"due": await event_friends.hint_due(get_db(), viewer), "sharing": event_friends.shares_registrations(viewer)}


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
    stored = await db.users.find_one({"id": me["id"]}, {"_id": 0, "birth_date": 1, "privacy_friends_see_registrations": 1}) or {}
    return {"sharing": event_friends.shares_registrations(stored)}
