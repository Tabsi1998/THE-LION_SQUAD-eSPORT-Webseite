"""Mobile app aggregation routes."""
from __future__ import annotations

import json
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user, get_optional_user
from database import get_db
from models import new_id, now_utc
from services.profile_references import personal_profile_references
from services.public_phase import derive_public_phase
from services.visibility import user_can_see

router = APIRouter(prefix="/api/mobile", tags=["mobile"])

STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}
ACTIVE_TOURNAMENT_REGISTRATION_STATUSES = {"pending", "registered", "approved", "checked_in", "waitlist"}
ACTIVE_EVENT_REGISTRATION_STATUSES = {"registered", "checked_in", "waitlist"}
OPEN_MATCH_STATUSES = {"ready", "scheduled", "in_progress", "waiting_result"}
HIDDEN_PUBLIC_STATUSES = {"draft", "completed", "results_published", "archived", "cancelled"}


class MobilePushTokenCreate(BaseModel):
    token: str = Field(min_length=20, max_length=300)
    platform: str | None = Field(default=None, max_length=40)
    device_name: str | None = Field(default=None, max_length=120)


class MobileClientLogCreate(BaseModel):
    level: str = Field(default="info", max_length=20)
    message: str = Field(min_length=1, max_length=2000)
    source: str | None = Field(default=None, max_length=120)
    screen: str | None = Field(default=None, max_length=120)
    error_name: str | None = Field(default=None, max_length=160)
    stack: str | None = Field(default=None, max_length=8000)
    context: dict[str, Any] | None = None
    platform: str | None = Field(default=None, max_length=40)
    device_name: str | None = Field(default=None, max_length=160)
    os_version: str | None = Field(default=None, max_length=80)
    app_version: str | None = Field(default=None, max_length=80)
    build_version: str | None = Field(default=None, max_length=80)
    session_id: str | None = Field(default=None, max_length=120)
    created_at: datetime | None = None


LOG_LEVELS = {"debug", "info", "warn", "warning", "error", "fatal"}
LOG_DEDUPE_SECONDS = 30
LOG_RETENTION_DAYS = 90


def _clip_text(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if len(text) <= limit else text[:limit]


def _safe_log_context(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        encoded = json.dumps(value, default=str, ensure_ascii=False)
    except TypeError:
        return {"raw": _clip_text(str(value), 8000)}
    if len(encoded) <= 8000:
        return value
    return {"truncated": True, "raw": encoded[:8000]}


def _log_priority(level: str) -> tuple[str, int]:
    if level == "fatal":
        return "critical", 0
    if level == "error":
        return "high", 1
    if level == "warn":
        return "normal", 2
    return "low", 3


def _log_fingerprint(body: MobileClientLogCreate, level: str, message: str) -> str:
    stack_head = (body.stack or "").strip().splitlines()[0][:240] if body.stack else ""
    parts = [
        level,
        (body.source or "").strip().lower(),
        (body.screen or "").strip().lower(),
        (body.error_name or "").strip().lower(),
        message.strip().lower()[:500],
        stack_head.strip().lower(),
    ]
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _date_key(row: dict) -> datetime:
    return (
        _parse_dt(row.get("start_date"))
        or _parse_dt(row.get("date"))
        or _parse_dt(row.get("scheduled_at"))
        or datetime.max.replace(tzinfo=timezone.utc)
    )


def _public_user_registration(registration: dict | None) -> dict | None:
    if not registration:
        return None
    return {
        "id": registration.get("id"),
        "status": registration.get("status"),
        "display_name": registration.get("display_name") or registration.get("ingame_name"),
        "ingame_name": registration.get("ingame_name"),
        "team_id": registration.get("team_id"),
        "created_at": registration.get("created_at"),
        "updated_at": registration.get("updated_at"),
    }


def _public_event_registration(registration: dict | None) -> dict | None:
    if not registration:
        return None
    return {
        "id": registration.get("id"),
        "status": registration.get("status"),
        "display_name": registration.get("display_name"),
        "companion_count": int(registration.get("companion_count") or 0),
        "created_at": registration.get("created_at"),
        "updated_at": registration.get("updated_at"),
    }


async def _team_ids_for_user(user_id: str) -> list[str]:
    db = get_db()
    memberships = await db.team_members.find(
        {"user_id": user_id},
        {"_id": 0, "team_id": 1},
    ).to_list(200)
    return [row["team_id"] for row in memberships if row.get("team_id")]


async def _visible_tournament(tournament: dict, user: dict | None, participant_ids: set[str] | None = None) -> bool:
    participant_ids = participant_ids or set()
    is_staff = bool(user and user.get("role") in STAFF_ROLES)
    if tournament.get("status") == "draft" and not is_staff:
        return False
    if tournament.get("id") in participant_ids:
        return True
    if tournament.get("is_public") is False and not is_staff:
        return False
    return await user_can_see(user, tournament.get("visibility") or "public")


async def _visible_event(event: dict, user: dict | None, registered_ids: set[str] | None = None) -> bool:
    registered_ids = registered_ids or set()
    is_staff = bool(user and user.get("role") in STAFF_ROLES)
    if event.get("status") == "draft" and not is_staff:
        return False
    if event.get("id") in registered_ids:
        return True
    return await user_can_see(user, event.get("visibility") or "public")


async def _event_summary(event_id: str | None, user: dict | None) -> dict | None:
    if not event_id:
        return None
    db = get_db()
    event = await db.events.find_one(
        {"id": event_id},
        {"_id": 0, "id": 1, "slug": 1, "name": 1, "title": 1, "location": 1, "start_date": 1, "status": 1, "visibility": 1},
    )
    if not event or not await _visible_event(event, user):
        return None
    event["public_phase"] = derive_public_phase(event, "event")
    return event


async def _compact_tournament(tournament: dict, user: dict | None, registration: dict | None = None) -> dict:
    db = get_db()
    phase = derive_public_phase(tournament, "tournament")
    participant_count = await db.tournament_registrations.count_documents(
        {"tournament_id": tournament.get("id"), "status": {"$in": ["approved", "checked_in"]}},
    )
    game = None
    if tournament.get("game_id"):
        game = await db.games.find_one(
            {"id": tournament.get("game_id")},
            {"_id": 0, "id": 1, "name": 1, "display_name": 1, "logo_url": 1, "cover_url": 1},
        )
    return {
        "id": tournament.get("id"),
        "slug": tournament.get("slug"),
        "title": tournament.get("title") or tournament.get("name") or "Turnier",
        "status": tournament.get("status"),
        "public_phase": phase,
        "start_date": tournament.get("start_date"),
        "end_date": tournament.get("end_date"),
        "registration_enabled": tournament.get("registration_enabled"),
        "registration_open_from": tournament.get("registration_open_from"),
        "registration_open_until": tournament.get("registration_open_until"),
        "check_in_from": tournament.get("check_in_from"),
        "check_in_until": tournament.get("check_in_until"),
        "max_participants": tournament.get("max_participants"),
        "participant_count": participant_count,
        "game_name": tournament.get("game_name"),
        "game": game,
        "event": await _event_summary(tournament.get("event_id"), user),
        "banner_url": tournament.get("banner_url"),
        "format": tournament.get("format"),
        "format_label": tournament.get("format_label"),
        "my_registration": _public_user_registration(registration),
    }


async def _compact_event(event: dict, registration: dict | None = None) -> dict:
    return {
        "id": event.get("id"),
        "slug": event.get("slug"),
        "title": event.get("name") or event.get("title") or "Event",
        "name": event.get("name") or event.get("title") or "Event",
        "status": event.get("status"),
        "public_phase": derive_public_phase(event, "event"),
        "start_date": event.get("start_date"),
        "date": event.get("start_date") or event.get("date"),
        "end_date": event.get("end_date"),
        "location": event.get("location"),
        "city": event.get("city"),
        "country": event.get("country"),
        "type": event.get("event_type") or event.get("type"),
        "event_type": event.get("event_type") or event.get("type"),
        "banner_url": event.get("banner_url"),
        "has_registration": event.get("has_registration"),
        "own_registration": _public_event_registration(registration),
    }


def _compact_news(post: dict) -> dict:
    return {
        "id": post.get("id"),
        "slug": post.get("slug"),
        "title": post.get("title") or "News",
        "excerpt": post.get("excerpt") or post.get("summary") or "",
        "summary": post.get("summary") or post.get("excerpt") or "",
        "category": post.get("category"),
        "banner_url": post.get("banner_url"),
        "published_at": post.get("published_at"),
        "created_at": post.get("created_at"),
        "pinned": bool(post.get("pinned")),
    }


def _compact_match(match: dict, tournament_map: dict[str, dict]) -> dict:
    tournament = tournament_map.get(match.get("tournament_id") or "")
    return {
        "id": match.get("id"),
        "status": match.get("status"),
        "scheduled_at": match.get("scheduled_at"),
        "tournament_id": match.get("tournament_id"),
        "tournament_title": (tournament or {}).get("title"),
        "round": match.get("round"),
        "round_name": match.get("round_name") or match.get("matchday_label"),
    }


async def _latest_news(user: dict | None) -> list[dict]:
    db = get_db()
    posts = await db.news_posts.find(
        {"published": True},
        {
            "_id": 0,
            "id": 1,
            "slug": 1,
            "title": 1,
            "excerpt": 1,
            "summary": 1,
            "category": 1,
            "banner_url": 1,
            "published_at": 1,
            "created_at": 1,
            "pinned": 1,
            "visibility": 1,
        },
    ).sort([("published_at", -1), ("created_at", -1)]).to_list(80)
    now = now_utc()
    visible = []
    for post in posts:
        published_at = _parse_dt(post.get("published_at") or post.get("created_at"))
        if published_at and published_at > now:
            continue
        if await user_can_see(user, post.get("visibility") or "public"):
            visible.append(post)
    visible.sort(
        key=lambda row: (
            bool(row.get("pinned")),
            _parse_dt(row.get("published_at") or row.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        ),
        reverse=True,
    )
    return [_compact_news(post) for post in visible[:6]]


async def _public_upcoming(user: dict | None) -> dict:
    db = get_db()
    now = now_utc()
    tournaments = await db.tournaments.find(
        {"status": {"$nin": list(HIDDEN_PUBLIC_STATUSES)}, "is_public": {"$ne": False}},
        {"_id": 0},
    ).sort("start_date", 1).to_list(80)
    events = await db.events.find(
        {"status": {"$nin": list(HIDDEN_PUBLIC_STATUSES)}},
        {"_id": 0},
    ).sort("start_date", 1).to_list(80)

    public_tournaments = []
    for tournament in sorted(tournaments, key=_date_key):
        start = _parse_dt(tournament.get("start_date"))
        end = _parse_dt(tournament.get("end_date")) or start
        if end and end < now:
            continue
        if await _visible_tournament(tournament, user):
            public_tournaments.append(await _compact_tournament(tournament, user))
        if len(public_tournaments) >= 6:
            break

    public_events = []
    for event in sorted(events, key=_date_key):
        start = _parse_dt(event.get("start_date"))
        end = _parse_dt(event.get("end_date")) or start
        if end and end < now:
            continue
        if await _visible_event(event, user):
            public_events.append(await _compact_event(event))
        if len(public_events) >= 6:
            break

    return {"tournaments": public_tournaments, "events": public_events}


async def _my_tournament_registrations(user: dict) -> list[dict]:
    db = get_db()
    team_ids = await _team_ids_for_user(user["id"])
    reg_query = {"user_id": user["id"]}
    if team_ids:
        reg_query = {"$or": [{"user_id": user["id"]}, {"team_id": {"$in": team_ids}}]}
    regs = await db.tournament_registrations.find(reg_query, {"_id": 0}).sort("created_at", -1).to_list(250)
    return [reg for reg in regs if (reg.get("status") or "pending") in ACTIVE_TOURNAMENT_REGISTRATION_STATUSES]


async def _my_event_registrations(user: dict) -> list[dict]:
    db = get_db()
    return await db.event_registrations.find(
        {"user_id": user["id"], "status": {"$in": list(ACTIVE_EVENT_REGISTRATION_STATUSES)}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)


async def _my_matches(registrations: list[dict]) -> list[dict]:
    db = get_db()
    reg_ids = [reg["id"] for reg in registrations if reg.get("id")]
    if not reg_ids:
        return []
    match_query = {
        "$or": [
            {"participant_a_id": {"$in": reg_ids}},
            {"participant_b_id": {"$in": reg_ids}},
            {"slots.registration_id": {"$in": reg_ids}},
        ],
        "status": {"$in": list(OPEN_MATCH_STATUSES)},
    }
    legacy = await db.matches.find(match_query, {"_id": 0}).sort("scheduled_at", 1).to_list(60)
    v2 = await db.matches_v2.find(match_query, {"_id": 0}).sort("scheduled_at", 1).to_list(60)
    matches = sorted([*legacy, *v2], key=_date_key)[:12]
    tournament_ids = list({match.get("tournament_id") for match in matches if match.get("tournament_id")})
    tournament_map = {
        tournament["id"]: tournament
        for tournament in await db.tournaments.find(
            {"id": {"$in": tournament_ids}},
            {"_id": 0, "id": 1, "title": 1},
        ).to_list(100)
    }
    return [_compact_match(match, tournament_map) for match in matches]


def _dashboard_actions(tournaments: list[dict], events: list[dict], matches: list[dict]) -> list[dict]:
    actions = []
    for tournament in tournaments:
        reg = tournament.get("my_registration") or {}
        phase = tournament.get("public_phase") or {}
        if phase.get("state") == "check_in" and reg.get("status") in {"approved", "registered"}:
            actions.append({
                "id": f"tournament-checkin-{tournament.get('id')}",
                "type": "tournament_checkin",
                "label": "Turnier Check-in offen",
                "detail": tournament.get("title"),
                "target_type": "tournament",
                "target_id": tournament.get("slug") or tournament.get("id"),
                "priority": 10,
            })
        if reg.get("status") == "pending":
            actions.append({
                "id": f"tournament-pending-{tournament.get('id')}",
                "type": "registration_pending",
                "label": "Anmeldung wartet auf Freigabe",
                "detail": tournament.get("title"),
                "target_type": "tournament",
                "target_id": tournament.get("slug") or tournament.get("id"),
                "priority": 3,
            })

    for event in events:
        reg = event.get("own_registration") or {}
        phase = event.get("public_phase") or {}
        if phase.get("state") == "check_in" and reg.get("status") == "registered":
            actions.append({
                "id": f"event-checkin-{event.get('id')}",
                "type": "event_checkin",
                "label": "Event Check-in offen",
                "detail": event.get("title") or event.get("name"),
                "target_type": "event",
                "target_id": event.get("slug") or event.get("id"),
                "priority": 8,
            })

    for match in matches[:4]:
        actions.append({
            "id": f"match-{match.get('id')}",
            "type": "match_open",
            "label": "Match offen",
            "detail": match.get("tournament_title") or match.get("round_name") or "Turniermatch",
            "target_type": "match",
            "target_id": match.get("id"),
            "priority": 7,
        })
    actions.sort(key=lambda item: int(item.get("priority") or 0), reverse=True)
    return actions[:8]


@router.get("/dashboard")
async def mobile_dashboard(user: dict | None = Depends(get_optional_user)):
    db = get_db()
    news = await _latest_news(user)
    public = await _public_upcoming(user)
    try:
        from routes.phase_ef_routes import list_live_streams
        live_streams = await list_live_streams()
    except Exception:
        live_streams = []

    my_tournaments: list[dict] = []
    my_events: list[dict] = []
    my_matches: list[dict] = []

    if user:
        tournament_regs = await _my_tournament_registrations(user)
        tournament_ids = list({reg.get("tournament_id") for reg in tournament_regs if reg.get("tournament_id")})
        tournament_by_id = {
            tournament["id"]: tournament
            for tournament in await db.tournaments.find({"id": {"$in": tournament_ids}}, {"_id": 0}).to_list(250)
        }
        participant_ids = set(tournament_ids)
        for reg in tournament_regs:
            tournament = tournament_by_id.get(reg.get("tournament_id"))
            if tournament and await _visible_tournament(tournament, user, participant_ids):
                my_tournaments.append(await _compact_tournament(tournament, user, reg))
        my_tournaments.sort(key=_date_key)
        my_tournaments = my_tournaments[:12]

        event_regs = await _my_event_registrations(user)
        event_ids = list({reg.get("event_id") for reg in event_regs if reg.get("event_id")})
        event_by_id = {
            event["id"]: event
            for event in await db.events.find({"id": {"$in": event_ids}}, {"_id": 0}).to_list(200)
        }
        registered_event_ids = set(event_ids)
        for reg in event_regs:
            event = event_by_id.get(reg.get("event_id"))
            if event and await _visible_event(event, user, registered_event_ids):
                my_events.append(await _compact_event(event, reg))
        my_events.sort(key=_date_key)
        my_events = my_events[:12]

        my_matches = await _my_matches(tournament_regs)

    actions = _dashboard_actions(my_tournaments, my_events, my_matches)
    return {
        "me": {
            "tournaments": my_tournaments,
            "events": my_events,
            "matches": my_matches,
            "actions": actions,
        },
        "public": public,
        "news": news,
        "streams": live_streams[:6] if isinstance(live_streams, list) else [],
        "stats": {
            "my_tournaments": len(my_tournaments),
            "my_events": len(my_events),
            "open_matches": len(my_matches),
            "open_actions": len(actions),
            "news": len(news),
            "public_tournaments": len(public["tournaments"]),
            "public_events": len(public["events"]),
            "live_streams": len(live_streams) if isinstance(live_streams, list) else 0,
        },
    }


@router.get("/profile/references")
async def mobile_profile_references(user: dict = Depends(get_current_user)):
    return await personal_profile_references(user)


@router.get("/notifications")
async def mobile_notifications(user: dict = Depends(get_current_user)):
    db = get_db()
    return await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(80)


@router.post("/notifications/{notification_id}/read")
async def mark_mobile_notification_read(notification_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    await db.notifications.update_one(
        {"id": notification_id, "user_id": user["id"]},
        {"$set": {"read": True, "read_at": now_utc().isoformat()}},
    )
    return {"ok": True}


@router.post("/notifications/read-all")
async def mark_all_mobile_notifications_read(user: dict = Depends(get_current_user)):
    db = get_db()
    await db.notifications.update_many(
        {"user_id": user["id"], "read": {"$ne": True}},
        {"$set": {"read": True, "read_at": now_utc().isoformat()}},
    )
    return {"ok": True}


@router.post("/client-logs")
async def create_mobile_client_log(body: MobileClientLogCreate, user: dict = Depends(get_current_user)):
    db = get_db()
    level = (body.level or "info").strip().lower()
    if level == "warning":
        level = "warn"
    if level not in LOG_LEVELS:
        level = "info"
    now = now_utc()
    now_iso = now.isoformat()
    message = _clip_text(body.message, 2000) or ""
    priority, priority_rank = _log_priority(level)
    fingerprint = _log_fingerprint(body, level, message)
    session_id = _clip_text(body.session_id, 120)
    dedupe_query = {
        "user_id": user["id"],
        "fingerprint": fingerprint,
        "last_seen_at": {"$gte": (now - timedelta(seconds=LOG_DEDUPE_SECONDS)).isoformat()},
    }
    if session_id:
        dedupe_query["session_id"] = session_id
    existing = await db.mobile_client_logs.find_one(dedupe_query, {"_id": 0, "id": 1})
    if existing:
        await db.mobile_client_logs.update_one(
            {"id": existing["id"]},
            {
                "$set": {
                    "level": level,
                    "priority": priority,
                    "priority_rank": priority_rank,
                    "status": "open" if level in {"warn", "error", "fatal"} else "info",
                    "message": message,
                    "source": _clip_text(body.source, 120),
                    "screen": _clip_text(body.screen, 120),
                    "error_name": _clip_text(body.error_name, 160),
                    "stack": _clip_text(body.stack, 8000),
                    "context": _safe_log_context(body.context),
                    "platform": _clip_text(body.platform, 40),
                    "device_name": _clip_text(body.device_name, 160),
                    "os_version": _clip_text(body.os_version, 80),
                    "app_version": _clip_text(body.app_version, 80),
                    "build_version": _clip_text(body.build_version, 80),
                    "last_seen_at": now_iso,
                    "received_at": now_iso,
                    "expires_at": now + timedelta(days=LOG_RETENTION_DAYS),
                },
                "$inc": {"repeat_count": 1},
            },
        )
        return {"ok": True, "id": existing["id"], "deduped": True}
    row = {
        "id": new_id(),
        "level": level,
        "status": "open" if level in {"warn", "error", "fatal"} else "info",
        "priority": priority,
        "priority_rank": priority_rank,
        "fingerprint": fingerprint,
        "repeat_count": 1,
        "message": message,
        "source": _clip_text(body.source, 120),
        "screen": _clip_text(body.screen, 120),
        "error_name": _clip_text(body.error_name, 160),
        "stack": _clip_text(body.stack, 8000),
        "context": _safe_log_context(body.context),
        "platform": _clip_text(body.platform, 40),
        "device_name": _clip_text(body.device_name, 160),
        "os_version": _clip_text(body.os_version, 80),
        "app_version": _clip_text(body.app_version, 80),
        "build_version": _clip_text(body.build_version, 80),
        "session_id": session_id,
        "created_at": (_parse_dt(body.created_at) or now_utc()).isoformat(),
        "received_at": now_iso,
        "first_seen_at": now_iso,
        "last_seen_at": now_iso,
        "expires_at": now + timedelta(days=LOG_RETENTION_DAYS),
        "user_id": user["id"],
        "username": user.get("username"),
        "display_name": user.get("display_name"),
    }
    await db.mobile_client_logs.insert_one(row)
    return {"ok": True, "id": row["id"]}


@router.get("/push-status")
async def mobile_push_status(user: dict = Depends(get_current_user)):
    db = get_db()
    tokens = await db.mobile_push_tokens.find(
        {"user_id": user["id"]},
        {
            "_id": 0,
            "token": 1,
            "platform": 1,
            "enabled": 1,
            "created_at": 1,
            "updated_at": 1,
            "last_sent_at": 1,
            "last_ticket_id": 1,
            "last_ticket_status": 1,
            "last_ticket_message": 1,
            "last_ticket_error": 1,
            "last_ticket_at": 1,
            "last_receipt_status": 1,
            "last_receipt_message": 1,
            "last_receipt_error": 1,
            "last_receipt_checked_at": 1,
            "disabled_at": 1,
        },
    ).sort("updated_at", -1).to_list(10)
    for row in tokens:
        token = str(row.get("token") or "")
        row["token_preview"] = f"{token[:24]}..." if len(token) > 24 else token
        row.pop("token", None)
    return {
        "tokens": tokens,
        "enabled_count": len([row for row in tokens if row.get("enabled") is not False]),
        "has_enabled_token": any(row.get("enabled") is not False for row in tokens),
    }


@router.post("/push-receipts/check")
async def mobile_push_receipts_check(user: dict = Depends(get_current_user)):
    from services.push_notifications import check_mobile_push_receipts_for_user
    return await check_mobile_push_receipts_for_user(user["id"])


@router.post("/push-token")
async def register_mobile_push_token(body: MobilePushTokenCreate, user: dict = Depends(get_current_user)):
    token = body.token.strip()
    if not (token.startswith("ExponentPushToken[") or token.startswith("ExpoPushToken[")):
        raise HTTPException(status_code=400, detail="Ungültiger Expo Push Token")
    db = get_db()
    now = now_utc().isoformat()
    await db.mobile_push_tokens.update_one(
        {"token": token},
        {
            "$set": {
                "token": token,
                "user_id": user["id"],
                "platform": body.platform,
                "device_name": body.device_name,
                "enabled": True,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return {"ok": True}


@router.delete("/push-token")
async def unregister_mobile_push_token(body: MobilePushTokenCreate, user: dict = Depends(get_current_user)):
    db = get_db()
    result = await db.mobile_push_tokens.update_one(
        {"token": body.token.strip(), "user_id": user["id"]},
        {"$set": {"enabled": False, "updated_at": now_utc().isoformat()}},
    )
    return {"ok": True, "updated": result.modified_count}
