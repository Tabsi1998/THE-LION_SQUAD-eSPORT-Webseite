"""Event routes — Vereins-CMS Phase 3."""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
from database import get_db
from auth import require_admin, get_optional_user
from services.visibility import user_can_see
from services.content_embed_service import resolve_content_embeds
from services.public_phase import derive_public_phase
from models import EventCreate, EventUpdate, now_utc, new_id

router = APIRouter(prefix="/api/events", tags=["events"])
STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}
SPONSOR_EVENT_TIERS = {"main", "platinum", "gold"}
LEGACY_SPONSOR_TIERS = {"supporter": "bronze", "partner": "bronze"}


async def _user_can_see(user: dict | None, visibility: str) -> bool:
    return await user_can_see(user, visibility)


async def _filter_related(items: list[dict], user: dict | None, kind: str) -> list[dict]:
    is_staff = bool(user and user.get("role") in STAFF_ROLES)
    out: list[dict] = []
    for item in items:
        if not is_staff and item.get("status") == "draft":
            continue
        if kind == "tournament" and not is_staff and item.get("is_public") is False:
            continue
        if await _user_can_see(user, item.get("visibility") or "public"):
            phase_kind = "f1" if kind == "fastlap" else kind
            item["public_phase"] = derive_public_phase(item, phase_kind)
            out.append(item)
    return out


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except ValueError:
        return None


def _normalize_sponsor_tier(tier: str | None) -> str:
    if not tier:
        return "bronze"
    if tier in {"main", "platinum", "gold", "silver", "bronze"}:
        return tier
    return LEGACY_SPONSOR_TIERS.get(tier, "bronze")


def _sponsor_show_on_events(sponsor: dict) -> bool:
    raw = sponsor.get("show_on_events")
    if raw is not None:
        return bool(raw)
    return _normalize_sponsor_tier(sponsor.get("tier")) in SPONSOR_EVENT_TIERS


def _event_phase(event: dict) -> dict:
    return derive_public_phase(event, "event")


def _published_now(post: dict) -> bool:
    published_at = _parse_dt(post.get("published_at"))
    return not published_at or published_at <= now_utc()


async def _attach_event_sponsors(event: dict) -> None:
    if event.get("owned_by_club") is False or event.get("show_sponsors") is False:
        event["sponsors"] = []
        return
    db = get_db()
    sponsor_ids = [sid for sid in event.get("sponsor_ids") or [] if sid]
    query: dict = {"is_active": {"$ne": False}}
    if sponsor_ids:
        query["id"] = {"$in": sponsor_ids}
    sponsors = await db.sponsors.find(query, {"_id": 0}).to_list(100)
    if not sponsor_ids:
        filtered = []
        for sponsor in sponsors:
            sponsor["tier"] = _normalize_sponsor_tier(sponsor.get("tier"))
            event_ids = sponsor.get("event_ids") or []
            if (event_ids and event.get("id") in event_ids) or (not event_ids and _sponsor_show_on_events(sponsor)):
                filtered.append(sponsor)
        sponsors = filtered
    for sponsor in sponsors:
        sponsor["tier"] = _normalize_sponsor_tier(sponsor.get("tier"))
    sponsors.sort(key=lambda s: (s.get("order_index") or 0, s.get("name") or ""))
    event["sponsors"] = sponsors


async def _decorate_event(event: dict, include_sponsors: bool = False) -> dict:
    event["public_phase"] = _event_phase(event)
    event["event_phase"] = event["public_phase"]
    if include_sponsors:
        await _attach_event_sponsors(event)
    return event


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
    if upcoming:
        now = datetime.now(timezone.utc)
        fresh = []
        for ev in events:
            start = _parse_dt(ev.get("start_date"))
            end = _parse_dt(ev.get("end_date")) or start
            if start and (not end or end >= now):
                fresh.append(ev)
        events = fresh
    out = []
    for ev in events:
        if await _user_can_see(user, ev.get("visibility") or "public"):
            await _decorate_event(ev)
            out.append(ev)
    return out


@router.get("/meta")
async def event_meta():
    return {
        "types": [
            {"k": "general", "l": "Allgemein"},
            {"k": "public_event", "l": "Public Event"},
            {"k": "club_evening", "l": "Vereinsabend"},
            {"k": "lan_party", "l": "LAN-Party"},
            {"k": "online_event", "l": "Online Event"},
            {"k": "expo", "l": "Messe / Expo"},
            {"k": "community_evening", "l": "Community-Abend"},
            {"k": "grill_evening", "l": "Grillabend"},
            {"k": "mario_kart_event", "l": "Mario Kart Event"},
            {"k": "f1_event", "l": "F1 Event"},
            {"k": "internal", "l": "Interner Termin"},
            {"k": "sponsor_action", "l": "Sponsorenaktion"},
            {"k": "tournament_finals", "l": "Turnier-Finals"},
        ],
        "primary_types": ["general", "public_event", "club_evening", "lan_party", "online_event", "expo"],
        "statuses": [
            {"k": "draft", "l": "Entwurf"},
            {"k": "scheduled", "l": "Angekündigt"},
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
    event["tournaments"] = await _filter_related(
        await db.tournaments.find({"event_id": event["id"]}, {"_id": 0}).to_list(200),
        user,
        "tournament",
    )
    event["f1_challenges"] = await _filter_related(
        await db.f1_challenges.find({"event_id": event["id"]}, {"_id": 0}).to_list(200),
        user,
        "fastlap",
    )
    # Albums linked to this event
    albums = await db.gallery_albums.find(
        {"event_id": event["id"], "published": True}, {"_id": 0},
    ).sort("order_index", 1).to_list(50)
    event["albums"] = [
        album for album in albums
        if await _user_can_see(user, album.get("visibility") or "public")
    ]
    # Linked news
    news = await db.news_posts.find(
        {"linked_event_ids": event["id"], "published": True},
        {"_id": 0, "id": 1, "title": 1, "slug": 1, "excerpt": 1, "banner_url": 1, "created_at": 1, "published_at": 1, "visibility": 1},
    ).sort([("published_at", -1), ("created_at", -1)]).to_list(20)
    event["news"] = [
        post for post in news
        if _published_now(post) and await _user_can_see(user, post.get("visibility") or "public")
    ]
    event["content_embeds"] = await resolve_content_embeds(db, event.get("program"), user)
    await _decorate_event(event, include_sponsors=True)
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


@router.put("/{event_id}")
@router.patch("/{event_id}")
async def update_event(event_id: str, body: EventUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {
        "description", "location", "address", "postal_code", "city", "country",
        "banner_url", "registration_url", "organizer_name", "organizer_url",
        "twitch_channel", "stream_url", "stream_title", "event_url",
        "door_time", "registration_opens_at", "registration_closes_at", "end_date",
        "contact", "program", "stream_platform",
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
    await db.tournaments.update_many({"event_id": event_id}, {"$set": {"event_id": None, "updated_at": now_utc().isoformat()}})
    await db.f1_challenges.update_many({"event_id": event_id}, {"$set": {"event_id": None, "updated_at": now_utc().isoformat()}})
    await db.gallery_albums.update_many({"event_id": event_id}, {"$set": {"event_id": None, "updated_at": now_utc().isoformat()}})
    return {"ok": True}
