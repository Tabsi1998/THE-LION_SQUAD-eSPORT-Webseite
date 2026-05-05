"""Event routes — Vereins-CMS Phase 3."""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from database import get_db
from auth import require_admin, get_optional_user
from services.visibility import user_can_see
from models import EventCreate, EventUpdate, now_utc, new_id

router = APIRouter(prefix="/api/events", tags=["events"])


async def _user_can_see(user: dict | None, visibility: str) -> bool:
    return await user_can_see(user, visibility)


@router.get("")
async def list_events(
    status: Optional[str] = None,
    event_type: Optional[str] = None,
    upcoming: bool = False,
    user: dict | None = Depends(get_optional_user),
):
    db = get_db()
    is_admin = user and user.get("role") in ("moderator", "tournament_admin", "club_admin", "superadmin")
    q: dict = {}
    if status:
        q["status"] = status
    elif not is_admin:
        # Hide drafts from non-admins
        q["status"] = {"$ne": "draft"}
    if event_type:
        q["event_type"] = event_type
    if upcoming:
        q["status"] = {"$nin": ["completed", "archived", "cancelled"]}
        if not is_admin:
            q["status"]["$nin"].append("draft")
    events = await db.events.find(q, {"_id": 0}).sort("start_date", 1 if upcoming else -1).to_list(500)
    out = []
    for ev in events:
        if await _user_can_see(user, ev.get("visibility") or "public"):
            out.append(ev)
    return out


@router.get("/meta")
async def event_meta():
    return {
        "types": [
            {"k": "club_evening", "l": "Vereinsabend"},
            {"k": "lan_party", "l": "LAN-Party"},
            {"k": "public_event", "l": "Public Event"},
            {"k": "community_evening", "l": "Community-Abend"},
            {"k": "grill_evening", "l": "Grillabend"},
            {"k": "mario_kart_event", "l": "Mario Kart Event"},
            {"k": "f1_event", "l": "F1 Event"},
            {"k": "expo", "l": "Messe / Expo"},
            {"k": "online_event", "l": "Online Event"},
            {"k": "internal", "l": "Interner Termin"},
            {"k": "sponsor_action", "l": "Sponsorenaktion"},
            {"k": "tournament_finals", "l": "Turnier-Finals"},
            {"k": "general", "l": "Allgemein"},
        ],
        "statuses": [
            {"k": "draft", "l": "Entwurf"},
            {"k": "scheduled", "l": "Warten auf Öffnung"},
            {"k": "registration_open", "l": "Anmeldung offen"},
            {"k": "registration_closed", "l": "Anmeldung geschlossen"},
            {"k": "checkin_open", "l": "Check-in offen"},
            {"k": "live", "l": "Läuft"},
            {"k": "paused", "l": "Pausiert"},
            {"k": "completed", "l": "Beendet"},
            {"k": "results_published", "l": "Ergebnisse veröffentlicht"},
            {"k": "archived", "l": "Archiviert"},
            {"k": "cancelled", "l": "Abgesagt"},
        ],
        "visibilities": [
            {"k": "public", "l": "Öffentlich"},
            {"k": "community", "l": "Nur registrierte Community"},
            {"k": "members", "l": "Nur Vereinsmitglieder"},
            {"k": "internal", "l": "Nur intern"},
        ],
    }


@router.get("/{slug_or_id}")
async def get_event(slug_or_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    event = await db.events.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event nicht gefunden")
    is_admin = user and user.get("role") in ("moderator", "tournament_admin", "club_admin", "superadmin")
    if event.get("status") == "draft" and not is_admin:
        raise HTTPException(404, "Event nicht gefunden.")
    if not await _user_can_see(user, event.get("visibility") or "public"):
        raise HTTPException(403, "Event ist nicht sichtbar.")
    # Attach tournaments and f1 challenges
    event["tournaments"] = await db.tournaments.find({"event_id": event["id"]}, {"_id": 0}).to_list(200)
    event["f1_challenges"] = await db.f1_challenges.find({"event_id": event["id"]}, {"_id": 0}).to_list(200)
    # Albums linked to this event
    event["albums"] = await db.gallery_albums.find(
        {"event_id": event["id"], "published": True}, {"_id": 0},
    ).sort("order_index", 1).to_list(50)
    # Linked news
    event["news"] = await db.news_posts.find(
        {"linked_event_ids": event["id"], "published": True},
        {"_id": 0, "id": 1, "title": 1, "slug": 1, "excerpt": 1, "banner_url": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(20)
    return event


@router.post("")
async def create_event(body: EventCreate, me: dict = Depends(require_admin())):
    db = get_db()
    if await db.events.find_one({"slug": body.slug}):
        raise HTTPException(status_code=409, detail="Slug bereits vergeben")
    doc = body.model_dump()
    doc["id"] = new_id()
    if not doc.get("status"):
        doc["status"] = "draft"
    for k in ("start_date", "end_date", "door_time", "registration_opens_at", "registration_closes_at"):
        if doc.get(k):
            doc[k] = doc[k].isoformat()
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    await db.events.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/{event_id}")
async def update_event(event_id: str, body: EventUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {
        "description", "location", "address", "banner_url", "registration_url",
        "twitch_channel", "stream_url", "stream_title", "event_url",
        "door_time", "registration_opens_at", "registration_closes_at", "end_date",
    }
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    for k in ("start_date", "end_date", "door_time", "registration_opens_at", "registration_closes_at"):
        if updates.get(k):
            updates[k] = updates[k].isoformat()
    updates["updated_at"] = now_utc().isoformat()
    await db.events.update_one({"id": event_id}, {"$set": updates})
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    return event


@router.delete("/{event_id}")
async def delete_event(event_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.events.delete_one({"id": event_id})
    return {"ok": True}
