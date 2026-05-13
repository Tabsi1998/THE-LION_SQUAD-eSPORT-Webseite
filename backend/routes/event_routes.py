"""Event routes — Vereins-CMS Phase 3."""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
from database import get_db
from auth import require_admin, get_optional_user, get_current_user
from services.visibility import user_can_see
from services.content_embed_service import resolve_content_embeds
from services.public_phase import derive_public_phase
from services.sponsor_utils import dedupe_public_sponsors
from services.notification_preferences import enqueue_newsletter_for_item
from models import EventCreate, EventUpdate, EventRegistrationCreate, EventRegistrationUpdate, now_utc, new_id

router = APIRouter(prefix="/api/events", tags=["events"])
STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}
LEGACY_SPONSOR_TIERS = {"supporter": "bronze", "partner": "bronze"}
ACTIVE_EVENT_REGISTRATION_STATUSES = {"registered", "checked_in"}
PUBLIC_EVENT_REGISTRATION_STATUSES = {"registered", "checked_in", "waitlist"}
ADMIN_EVENT_REGISTRATION_STATUSES = {"registered", "checked_in", "waitlist", "cancelled", "no_show"}


async def _user_can_see(user: dict | None, visibility: str) -> bool:
    return await user_can_see(user, visibility)


async def _filter_related(items: list[dict], user: dict | None, kind: str) -> list[dict]:
    out: list[dict] = []
    is_staff = bool(user and user.get("role") in STAFF_ROLES)
    for item in items:
        if item.get("status") == "draft" and not is_staff:
            continue
        if kind == "tournament" and item.get("is_public") is False and not is_staff:
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
    return bool(sponsor.get("show_on_events"))


def _event_phase(event: dict) -> dict:
    return derive_public_phase(event, "event")


def _published_now(post: dict) -> bool:
    published_at = _parse_dt(post.get("published_at"))
    return not published_at or published_at <= now_utc()


async def _find_event(slug_or_id: str) -> dict | None:
    db = get_db()
    return await db.events.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})


def _registration_seats(registration: dict) -> int:
    try:
        companion_count = int(registration.get("companion_count") or 0)
    except (TypeError, ValueError):
        companion_count = 0
    return 1 + max(0, companion_count)


def _public_event_registration(registration: dict, is_staff: bool = False) -> dict:
    payload = {
        "id": registration.get("id"),
        "user_id": registration.get("user_id"),
        "display_name": registration.get("display_name"),
        "status": registration.get("status"),
        "companion_count": int(registration.get("companion_count") or 0),
        "seat_count": _registration_seats(registration),
        "created_at": registration.get("created_at"),
        "updated_at": registration.get("updated_at"),
    }
    if is_staff:
        payload["email"] = registration.get("email")
        payload["note"] = registration.get("note")
        payload["internal_note"] = registration.get("internal_note")
    return payload


async def _event_registration_summary(event: dict, exclude_registration_id: str | None = None) -> dict:
    db = get_db()
    regs = await db.event_registrations.find({"event_id": event["id"]}, {"_id": 0}).to_list(2000)
    if exclude_registration_id:
        regs = [r for r in regs if r.get("id") != exclude_registration_id]
    active = [r for r in regs if r.get("status") in ACTIVE_EVENT_REGISTRATION_STATUSES]
    waitlist = [r for r in regs if r.get("status") == "waitlist"]
    reserved_seats = sum(_registration_seats(r) for r in active)
    waitlist_seats = sum(_registration_seats(r) for r in waitlist)
    companion_count = sum(max(0, int(r.get("companion_count") or 0)) for r in active)
    max_participants = event.get("max_participants")
    spots_left = None
    if max_participants:
        spots_left = max(int(max_participants) - reserved_seats, 0)
    return {
        "registered_count": len(active),
        "waitlist_count": len(waitlist),
        "checked_in_count": len([r for r in regs if r.get("status") == "checked_in"]),
        "no_show_count": len([r for r in regs if r.get("status") == "no_show"]),
        "cancelled_count": len([r for r in regs if r.get("status") == "cancelled"]),
        "reserved_seats": reserved_seats,
        "waitlist_seats": waitlist_seats,
        "companion_count": companion_count,
        "spots_left": spots_left,
        "max_participants": max_participants,
    }


def _event_registration_open(event: dict) -> bool:
    return bool(event.get("has_registration") and derive_public_phase(event, "event").get("state") == "registration_open")


def _validated_companion_count(event: dict, value: int | None) -> int:
    companion_count = int(value or 0)
    if companion_count < 0:
        raise HTTPException(status_code=400, detail="Begleitpersonen duerfen nicht negativ sein")
    max_companions = int(event.get("max_companions_per_registration") or 0)
    if companion_count and not event.get("allow_companions"):
        raise HTTPException(status_code=400, detail="Bei diesem Event sind keine Begleitpersonen aktiviert")
    if companion_count > max_companions:
        raise HTTPException(status_code=400, detail=f"Maximal {max_companions} Begleitpersonen erlaubt")
    return companion_count


async def _apply_event_checkin_rewards(event: dict, registration: dict) -> None:
    """Award Season/achievement progress once an admin confirms attendance."""
    user_id = registration.get("user_id")
    if not user_id:
        return
    db = get_db()
    try:
        from services.season_service import award_points

        summary = await _event_registration_summary(event)
        await award_points(
            user_id=user_id,
            source_type="event",
            source_id=f"{event['id']}:{registration['id']}",
            source_name=event.get("name") or "Event-Teilnahme",
            rank=None,
            num_participants=max(int(summary.get("checked_in_count") or summary.get("registered_count") or 1), 1),
            weight=0.5,
            bonus=5,
            bonus_reason="Teilnahme von Admin/Moderator bestaetigt",
        )
    except Exception:
        import logging
        logging.getLogger("tls.events").warning("event check-in season points failed", exc_info=True)
    try:
        from badges import evaluate_user_progress

        await evaluate_user_progress(user_id)
    except Exception:
        import logging
        logging.getLogger("tls.events").warning("event check-in achievement evaluation failed", exc_info=True)


async def _attach_event_registration_view(event: dict, user: dict | None) -> None:
    db = get_db()
    is_staff = bool(user and user.get("role") in STAFF_ROLES)
    event["own_registration"] = None
    if user:
        own = await db.event_registrations.find_one(
            {"event_id": event["id"], "user_id": user["id"]},
            {"_id": 0},
        )
        if own:
            event["own_registration"] = _public_event_registration(own, is_staff=True)
    if event.get("show_participants") or is_staff:
        statuses = ADMIN_EVENT_REGISTRATION_STATUSES if is_staff else PUBLIC_EVENT_REGISTRATION_STATUSES
        regs = await db.event_registrations.find(
            {"event_id": event["id"], "status": {"$in": list(statuses)}},
            {"_id": 0},
        ).sort("created_at", 1).to_list(2000)
        event["registrations"] = [_public_event_registration(r, is_staff=is_staff) for r in regs]
    else:
        event["registrations"] = []


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
    sponsors = [sponsor for sponsor in sponsors if _sponsor_show_on_events(sponsor)]
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
    event["sponsors"] = dedupe_public_sponsors(sponsors)


async def _decorate_event(event: dict, include_sponsors: bool = False) -> dict:
    event["public_phase"] = _event_phase(event)
    event["event_phase"] = event["public_phase"]
    if event.get("has_registration"):
        event["registration_summary"] = await _event_registration_summary(event)
    else:
        event["registration_summary"] = {
            "registered_count": 0,
            "waitlist_count": 0,
            "checked_in_count": 0,
            "no_show_count": 0,
            "cancelled_count": 0,
            "reserved_seats": 0,
            "waitlist_seats": 0,
            "companion_count": 0,
            "spots_left": event.get("max_participants"),
            "max_participants": event.get("max_participants"),
        }
    if include_sponsors:
        await _attach_event_sponsors(event)
    return event


@router.get("")
async def list_events(
    status: Optional[str] = None,
    event_type: Optional[str] = None,
    upcoming: bool = False,
    include_drafts: bool = False,
    user: dict | None = Depends(get_optional_user),
):
    db = get_db()
    is_admin = user and user.get("role") in ("moderator", "tournament_admin", "club_admin", "superadmin")
    q: dict = {}
    if status:
        if status == "draft" and not (include_drafts and is_admin):
            return []
        q["status"] = status
    elif not (include_drafts and is_admin):
        # Public views hide drafts even when an admin is logged in.
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
async def get_event(slug_or_id: str, include_draft: bool = False, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    event = await _find_event(slug_or_id)
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
    await _attach_event_registration_view(event, user)
    return event


@router.get("/{event_id}/registrations")
async def list_event_registrations(event_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    event = await _find_event(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event nicht gefunden")
    regs = await db.event_registrations.find(
        {"event_id": event["id"]},
        {"_id": 0},
    ).sort("created_at", 1).to_list(2000)
    return {
        "event": {"id": event["id"], "name": event.get("name"), "max_participants": event.get("max_participants")},
        "summary": await _event_registration_summary(event),
        "registrations": [_public_event_registration(r, is_staff=True) for r in regs],
    }


@router.post("/{event_id}/registrations")
async def register_for_event(event_id: str, body: EventRegistrationCreate,
                             me: dict = Depends(get_current_user)):
    db = get_db()
    event = await _find_event(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event nicht gefunden")
    if event.get("status") == "draft" and me.get("role") not in STAFF_ROLES:
        raise HTTPException(status_code=404, detail="Event nicht gefunden")
    if not await _user_can_see(me, event.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Event ist nicht sichtbar")
    if not _event_registration_open(event):
        raise HTTPException(status_code=400, detail="Die Anmeldung ist aktuell nicht offen")

    companion_count = _validated_companion_count(event, body.companion_count)
    requested_seats = 1 + companion_count
    existing = await db.event_registrations.find_one(
        {"event_id": event["id"], "user_id": me["id"]},
        {"_id": 0},
    )
    if existing and existing.get("status") not in {"cancelled", "no_show"}:
        raise HTTPException(status_code=409, detail="Du bist fuer dieses Event bereits angemeldet")

    summary = await _event_registration_summary(event, exclude_registration_id=existing.get("id") if existing else None)
    status = "registered"
    max_participants = event.get("max_participants")
    if max_participants and summary["reserved_seats"] + requested_seats > int(max_participants):
        status = "waitlist"

    now = now_utc().isoformat()
    doc = {
        "event_id": event["id"],
        "user_id": me["id"],
        "display_name": me.get("display_name") or me.get("username"),
        "email": me.get("email"),
        "status": status,
        "companion_count": companion_count,
        "seat_count": requested_seats,
        "note": body.note,
        "updated_at": now,
    }
    if existing:
        await db.event_registrations.update_one(
            {"id": existing["id"]},
            {"$set": doc},
        )
        doc = await db.event_registrations.find_one({"id": existing["id"]}, {"_id": 0})
    else:
        doc["id"] = new_id()
        doc["created_at"] = now
        await db.event_registrations.insert_one(doc)
        doc.pop("_id", None)
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "event.registration.create",
        "target_id": event["id"],
        "actor_id": me["id"],
        "data": {"registration_id": doc["id"], "status": status, "companion_count": companion_count},
        "created_at": now,
    })
    return _public_event_registration(doc, is_staff=True)


@router.delete("/{event_id}/registrations/me")
async def cancel_my_event_registration(event_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    event = await _find_event(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event nicht gefunden")
    reg = await db.event_registrations.find_one(
        {"event_id": event["id"], "user_id": me["id"]},
        {"_id": 0},
    )
    if not reg:
        raise HTTPException(status_code=404, detail="Anmeldung nicht gefunden")
    now = now_utc().isoformat()
    await db.event_registrations.update_one(
        {"id": reg["id"]},
        {"$set": {"status": "cancelled", "updated_at": now}},
    )
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "event.registration.cancel",
        "target_id": event["id"],
        "actor_id": me["id"],
        "data": {"registration_id": reg["id"]},
        "created_at": now,
    })
    return {"ok": True}


@router.patch("/{event_id}/registrations/{registration_id}")
@router.put("/{event_id}/registrations/{registration_id}")
async def update_event_registration(event_id: str, registration_id: str, body: EventRegistrationUpdate,
                                    me: dict = Depends(require_admin())):
    db = get_db()
    event = await _find_event(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event nicht gefunden")
    current = await db.event_registrations.find_one(
        {"id": registration_id, "event_id": event["id"]},
        {"_id": 0},
    )
    if not current:
        raise HTTPException(status_code=404, detail="Anmeldung nicht gefunden")
    nullable = {"note", "internal_note"}
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k in nullable}
    if "companion_count" in updates:
        companion_count = _validated_companion_count(event, updates.get("companion_count"))
        updates["companion_count"] = companion_count
        updates["seat_count"] = 1 + companion_count
    proposed = {**current, **updates}
    proposed_status = proposed.get("status")
    if proposed_status in ACTIVE_EVENT_REGISTRATION_STATUSES and event.get("max_participants"):
        summary = await _event_registration_summary(event, exclude_registration_id=registration_id)
        if summary["reserved_seats"] + _registration_seats(proposed) > int(event["max_participants"]):
            raise HTTPException(status_code=400, detail="Kapazitaet waere ueberschritten")
    updates["updated_at"] = now_utc().isoformat()
    await db.event_registrations.update_one({"id": registration_id}, {"$set": updates})
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "event.registration.update",
        "target_id": event["id"],
        "actor_id": me["id"],
        "data": {"registration_id": registration_id, "updates": {k: v for k, v in updates.items() if k != "updated_at"}},
        "created_at": now_utc().isoformat(),
    })
    updated = await db.event_registrations.find_one({"id": registration_id}, {"_id": 0})
    if current.get("status") != "checked_in" and updated.get("status") == "checked_in":
        await _apply_event_checkin_rewards(event, updated)
    return _public_event_registration(updated, is_staff=True)


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
    if doc.get("status") not in {"draft", "archived", "cancelled"}:
        result = await enqueue_newsletter_for_item("event", doc)
        if result.get("reason") not in {"internal_visibility", "not_announced"}:
            doc["newsletter_sent_at"] = now_utc().isoformat()
            doc["newsletter_sent_count"] = int(result.get("queued") or 0)
            await db.events.update_one(
                {"id": doc["id"]},
                {"$set": {
                    "newsletter_sent_at": doc["newsletter_sent_at"],
                    "newsletter_sent_count": doc["newsletter_sent_count"],
                }},
            )
    doc.pop("_id", None)
    return doc


@router.put("/{event_id}")
@router.patch("/{event_id}")
async def update_event(event_id: str, body: EventUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    existing = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Event nicht gefunden.")
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
    if event and event.get("status") not in {"draft", "archived", "cancelled"} and not event.get("newsletter_sent_at"):
        result = await enqueue_newsletter_for_item("event", event)
        if result.get("reason") not in {"internal_visibility", "not_announced"}:
            await db.events.update_one(
                {"id": event_id},
                {"$set": {
                    "newsletter_sent_at": now_utc().isoformat(),
                    "newsletter_sent_count": int(result.get("queued") or 0),
                }},
            )
            event = await db.events.find_one({"id": event_id}, {"_id": 0})
    return event


@router.delete("/{event_id}")
async def delete_event(event_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.events.delete_one({"id": event_id})
    await db.event_registrations.delete_many({"event_id": event_id})
    await db.tournaments.update_many({"event_id": event_id}, {"$set": {"event_id": None, "updated_at": now_utc().isoformat()}})
    await db.f1_challenges.update_many({"event_id": event_id}, {"$set": {"event_id": None, "updated_at": now_utc().isoformat()}})
    await db.gallery_albums.update_many({"event_id": event_id}, {"$set": {"event_id": None, "updated_at": now_utc().isoformat()}})
    return {"ok": True}
