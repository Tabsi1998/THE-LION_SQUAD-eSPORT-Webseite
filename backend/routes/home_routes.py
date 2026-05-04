"""Public homepage live state — Phase 5.

Aggregates:
* `live`   — anything currently `live`
* `today`  — events/tournaments/challenges happening today
* `soon`   — registration_open, scheduled, check_in (next up)
* `news`   — latest 4 published news visible to the caller

Hides drafts and respects per-object visibility.
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from database import get_db
from auth import get_optional_user
from services.visibility import user_can_see

router = APIRouter(prefix="/api/home", tags=["home"])

LIVE_STATUSES = {"live"}
SOON_STATUSES = {"scheduled", "registration_open", "registration_closed", "check_in"}


def _today_window():
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    end = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    return start, end


async def _filter_events(rows, user):
    out = []
    for r in rows:
        if r.get("status") == "draft":
            continue
        if not await user_can_see(user, r.get("visibility")):
            continue
        out.append(r)
    return out


@router.get("/state")
async def home_state(user: dict | None = Depends(get_optional_user)):
    db = get_db()
    today_start, today_end = _today_window()

    # ---------- LIVE ----------
    live_tournaments = await db.tournaments.find(
        {"status": {"$in": list(LIVE_STATUSES)}}, {"_id": 0},
    ).sort("updated_at", -1).to_list(20)
    live_challenges = await db.f1_challenges.find(
        {"status": {"$in": list(LIVE_STATUSES)}}, {"_id": 0},
    ).sort("updated_at", -1).to_list(20)
    live_events = await db.events.find(
        {"status": {"$in": list(LIVE_STATUSES)}}, {"_id": 0},
    ).sort("updated_at", -1).to_list(20)

    live = {
        "tournaments": await _filter_events(live_tournaments, user),
        "challenges": await _filter_events(live_challenges, user),
        "events": await _filter_events(live_events, user),
    }

    # ---------- TODAY ----------
    today_t = await db.tournaments.find(
        {"start_date": {"$gte": today_start, "$lt": today_end},
         "status": {"$nin": ["draft", "cancelled", "archived"]}}, {"_id": 0},
    ).to_list(20)
    today_e = await db.events.find(
        {"start_date": {"$gte": today_start, "$lt": today_end},
         "status": {"$nin": ["draft", "cancelled", "archived"]}}, {"_id": 0},
    ).to_list(20)
    today_c = await db.f1_challenges.find(
        {"start_date": {"$gte": today_start, "$lt": today_end},
         "status": {"$nin": ["draft", "cancelled", "archived"]}}, {"_id": 0},
    ).to_list(20)

    today = {
        "tournaments": await _filter_events(today_t, user),
        "events": await _filter_events(today_e, user),
        "challenges": await _filter_events(today_c, user),
    }

    # ---------- SOON (next 14 days, registration_open / scheduled / check_in) ----------
    horizon = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    soon_t = await db.tournaments.find(
        {"status": {"$in": list(SOON_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(50)
    soon_e = await db.events.find(
        {"status": {"$in": list(SOON_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(50)
    soon_c = await db.f1_challenges.find(
        {"status": {"$in": list(SOON_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(50)

    def _within_horizon(rows):
        out = []
        for r in rows:
            sd = r.get("start_date")
            if not sd or sd <= horizon:
                out.append(r)
        return out

    soon = {
        "tournaments": _within_horizon(await _filter_events(soon_t, user))[:8],
        "events": _within_horizon(await _filter_events(soon_e, user))[:8],
        "challenges": _within_horizon(await _filter_events(soon_c, user))[:8],
    }

    # ---------- NEWS (latest 4 published, visibility-filtered) ----------
    news = await db.news_posts.find(
        {"published": True}, {"_id": 0},
    ).sort([("pinned", -1), ("created_at", -1)]).to_list(20)
    visible_news = []
    for n in news:
        if await user_can_see(user, n.get("visibility")):
            visible_news.append(n)
        if len(visible_news) >= 4:
            break

    has_live = any(len(v) > 0 for v in live.values())
    return {
        "has_live": has_live,
        "live": live,
        "today": today,
        "soon": soon,
        "news": visible_news,
    }
