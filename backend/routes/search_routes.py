"""Public global search for quick navigation."""
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query

from auth import get_optional_user
from database import get_db
from models import now_utc
from services.public_phase import derive_public_phase
from services.visibility import user_can_see

router = APIRouter(prefix="/api/search", tags=["search"])
STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}


def _safe_regex(value: str | None, max_len: int = 80) -> str:
    return re.escape((value or "").strip()[:max_len])


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


def _published_now(post: dict) -> bool:
    published_at = _parse_dt(post.get("published_at"))
    return not published_at or published_at <= now_utc()


def _result(kind: str, title: str, url: str, **extra) -> dict:
    return {
        "kind": kind,
        "title": title,
        "url": url,
        **{key: value for key, value in extra.items() if value not in (None, "", [])},
    }


async def _search_tournaments(db, pattern: str, user: dict | None, limit: int) -> list[dict]:
    query = {
        "$or": [
            {"title": {"$regex": pattern, "$options": "i"}},
            {"description": {"$regex": pattern, "$options": "i"}},
        ],
    }
    rows = await db.tournaments.find(
        query,
        {"_id": 0, "id": 1, "title": 1, "slug": 1, "description": 1, "status": 1, "visibility": 1, "is_public": 1, "start_date": 1, "banner_url": 1},
    ).sort("created_at", -1).to_list(limit * 3)
    out = []
    is_staff = bool(user and user.get("role") in STAFF_ROLES)
    for row in rows:
        if not is_staff and (row.get("status") == "draft" or row.get("is_public") is False):
            continue
        if not await user_can_see(user, row.get("visibility") or "public"):
            continue
        phase = derive_public_phase(row, "tournament")
        out.append(_result(
            "tournament",
            row.get("title") or "Turnier",
            f"/tournaments/{row.get('slug') or row.get('id')}",
            subtitle=phase.get("label") or row.get("status"),
            date=row.get("start_date"),
            image=row.get("banner_url"),
        ))
        if len(out) >= limit:
            break
    return out


async def _search_events(db, pattern: str, user: dict | None, limit: int) -> list[dict]:
    rows = await db.events.find(
        {
            "$or": [
                {"name": {"$regex": pattern, "$options": "i"}},
                {"description": {"$regex": pattern, "$options": "i"}},
                {"location": {"$regex": pattern, "$options": "i"}},
            ],
        },
        {"_id": 0, "id": 1, "name": 1, "slug": 1, "description": 1, "status": 1, "visibility": 1, "start_date": 1, "banner_url": 1},
    ).sort("start_date", -1).to_list(limit * 3)
    out = []
    is_staff = bool(user and user.get("role") in STAFF_ROLES)
    for row in rows:
        if row.get("status") == "draft" and not is_staff:
            continue
        if not await user_can_see(user, row.get("visibility") or "public"):
            continue
        phase = derive_public_phase(row, "event")
        out.append(_result(
            "event",
            row.get("name") or "Event",
            f"/events/{row.get('slug') or row.get('id')}",
            subtitle=phase.get("label") or row.get("status"),
            date=row.get("start_date"),
            image=row.get("banner_url"),
        ))
        if len(out) >= limit:
            break
    return out


async def _search_news(db, pattern: str, user: dict | None, limit: int) -> list[dict]:
    rows = await db.news_posts.find(
        {
            "$or": [
                {"title": {"$regex": pattern, "$options": "i"}},
                {"excerpt": {"$regex": pattern, "$options": "i"}},
                {"content": {"$regex": pattern, "$options": "i"}},
                {"category": {"$regex": pattern, "$options": "i"}},
            ],
        },
        {"_id": 0, "id": 1, "title": 1, "slug": 1, "excerpt": 1, "published": 1, "published_at": 1, "created_at": 1, "visibility": 1, "banner_url": 1, "category": 1},
    ).sort([("published_at", -1), ("created_at", -1)]).to_list(limit * 3)
    out = []
    is_staff = bool(user and user.get("role") in STAFF_ROLES)
    for row in rows:
        if not is_staff and (row.get("published") is False or not _published_now(row)):
            continue
        if not await user_can_see(user, row.get("visibility") or "public"):
            continue
        out.append(_result(
            "news",
            row.get("title") or "News",
            f"/news/{row.get('slug') or row.get('id')}",
            subtitle=row.get("category"),
            date=row.get("published_at") or row.get("created_at"),
            image=row.get("banner_url"),
        ))
        if len(out) >= limit:
            break
    return out


async def _search_players(db, pattern: str, limit: int) -> list[dict]:
    rows = await db.users.find(
        {
            "privacy_public_profile": True,
            "is_active": True,
            "is_banned": {"$ne": True},
            "$or": [
                {"username": {"$regex": pattern, "$options": "i"}},
                {"display_name": {"$regex": pattern, "$options": "i"}},
            ],
        },
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "favorite_games": 1},
    ).sort("username", 1).to_list(limit)
    return [
        _result(
            "player",
            row.get("display_name") or row.get("username") or "Spieler",
            f"/players/{row.get('username')}",
            subtitle=row.get("username"),
            image=row.get("avatar_url"),
        )
        for row in rows
        if row.get("username")
    ]


async def _search_teams(db, pattern: str, limit: int) -> list[dict]:
    rows = await db.teams.find(
        {
            "is_public": {"$ne": False},
            "$or": [
                {"name": {"$regex": pattern, "$options": "i"}},
                {"tag": {"$regex": pattern, "$options": "i"}},
                {"description": {"$regex": pattern, "$options": "i"}},
            ],
        },
        {"_id": 0, "id": 1, "name": 1, "tag": 1, "logo_url": 1, "member_ids": 1},
    ).sort("created_at", -1).to_list(limit)
    return [
        _result(
            "team",
            row.get("name") or row.get("tag") or "Team",
            f"/teams/{row.get('id')}",
            subtitle=row.get("tag"),
            image=row.get("logo_url"),
            count=len(row.get("member_ids") or []),
        )
        for row in rows
        if row.get("id")
    ]


@router.get("")
async def global_search(
    q: str = Query(default="", min_length=0, max_length=80),
    limit: int = Query(default=6, ge=1, le=12),
    user: dict | None = Depends(get_optional_user),
):
    needle = (q or "").strip()
    if len(needle) < 2:
        return {"q": needle, "items": []}
    db = get_db()
    pattern = _safe_regex(needle)
    groups = [
        await _search_tournaments(db, pattern, user, limit),
        await _search_events(db, pattern, user, limit),
        await _search_news(db, pattern, user, limit),
        await _search_players(db, pattern, limit),
        await _search_teams(db, pattern, limit),
    ]
    items = [item for group in groups for item in group]
    return {"q": needle, "items": items[: limit * 5]}
