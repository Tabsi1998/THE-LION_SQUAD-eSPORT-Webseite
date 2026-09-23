"""Public homepage live state — Phase 5.

Aggregates:
* `live`   — anything currently `live`
* `today`  — events/tournaments/challenges happening today
* `soon`   — registration_open, scheduled, check_in (next up)
* `news`   — latest 4 published news visible to the caller

Hides drafts and respects per-object visibility.
"""
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends
from database import get_db
from auth import get_optional_user
from services.visibility import user_can_see
from services.public_phase import derive_public_phase

router = APIRouter(prefix="/api/home", tags=["home"])

LIVE_STATUSES = {"live"}
SOON_STATUSES = {"scheduled", "registration_open", "registration_closed", "check_in"}
EVENT_SOON_STATUSES = SOON_STATUSES | {"checkin_open"}
FINISHED_STATUSES = {"completed", "results_published", "archived", "cancelled"}
HIDDEN_STATUSES = {"draft", *FINISHED_STATUSES}
LOCAL_TZ = ZoneInfo("Europe/Vienna")


def _today_window():
    now = datetime.now(LOCAL_TZ)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


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


def _normalize_status(row: dict, kind: str | None = None) -> dict:
    # Events historically use `checkin_open`, while shared UI badges use `check_in`.
    if kind == "event" and row.get("status") == "checkin_open":
        row["source_status"] = "checkin_open"
        row["status"] = "check_in"
    phase_kind = "f1" if kind == "fastlap" else (kind or "content")
    row["public_phase"] = derive_public_phase(row, phase_kind)
    return row


def _event_date(row: dict):
    return _parse_dt(row.get("start_date")) or datetime.max.replace(tzinfo=timezone.utc)


def _row_not_finished(row: dict, now: datetime) -> bool:
    if row.get("status") in FINISHED_STATUSES:
        return False
    end = _parse_dt(row.get("end_date"))
    return not end or end >= now


def _overlaps_window(row: dict, start: datetime, end: datetime) -> bool:
    row_start = _parse_dt(row.get("start_date"))
    if not row_start:
        return False
    row_end = _parse_dt(row.get("end_date")) or row_start
    return row_start < end and row_end >= start


def _starts_between(row: dict, start: datetime, end: datetime | None = None) -> bool:
    row_start = _parse_dt(row.get("start_date"))
    if not row_start or row_start < start:
        return False
    return end is None or row_start <= end


async def _filter_rows(rows, user, kind: str | None = None):
    out = []
    for r in rows:
        if r.get("status") == "draft":
            continue
        if kind == "tournament" and r.get("is_public") is False:
            continue
        if not await user_can_see(user, r.get("visibility")):
            continue
        out.append(_normalize_status(r, kind))
    return out


async def _attach_events_to_challenges(challenges: list[dict]) -> list[dict]:
    db = get_db()
    event_ids = list({c.get("event_id") for c in challenges if c.get("event_id")})
    if not event_ids:
        return challenges
    events = {
        e["id"]: e for e in await db.events.find(
            {"id": {"$in": event_ids}},
            {"_id": 0, "id": 1, "name": 1, "slug": 1, "start_date": 1, "location": 1},
        ).to_list(100)
    }
    for c in challenges:
        if c.get("event_id") in events:
            c["event"] = events[c["event_id"]]
    return challenges


# Live-Zahlen je Karte (#224): Anmeldungen, laufende Matches, Fahrer. Ein Zähler je Sammlung
# über alle Karten - nicht eine Abfrage je Karte. Zuschauer kommen vom Stream-Slider selbst.
RUNNING_MATCH_STATUSES = ("running", "in_progress")
ACTIVE_TOURNAMENT_REGISTRATIONS = ("approved", "checked_in")
ACTIVE_EVENT_REGISTRATIONS = ("registered", "checked_in")


async def _count_by(collection, field: str, ids: list[str], extra: dict | None = None) -> dict[str, int]:
    if not ids:
        return {}
    match = {field: {"$in": ids}, **(extra or {})}
    counts: dict[str, int] = {}
    async for row in collection.aggregate([{"$match": match}, {"$group": {"_id": f"${field}", "n": {"$sum": 1}}}]):
        counts[row["_id"]] = int(row["n"])
    return counts


def _rows_by_id(groups, kind: str) -> dict[str, list[dict]]:
    """Dieselbe Karte kann in „heute“ und „bald“ liegen - als zwei Objekte. Beide bekommen die Zahl."""
    rows: dict[str, list[dict]] = {}
    for group in groups:
        for row in group.get(kind, []):
            rows.setdefault(row["id"], []).append(row)
    return rows


async def _attach_live_counts(db, *groups: dict) -> None:
    tournaments = _rows_by_id(groups, "tournaments")
    events = _rows_by_id(groups, "events")
    challenges = _rows_by_id(groups, "challenges")
    t_regs = await _count_by(db.tournament_registrations, "tournament_id", list(tournaments), {"status": {"$in": list(ACTIVE_TOURNAMENT_REGISTRATIONS)}})
    t_running = await _count_by(db.matches_v2, "tournament_id", list(tournaments), {"status": {"$in": list(RUNNING_MATCH_STATUSES)}})
    e_regs = await _count_by(db.event_registrations, "event_id", list(events), {"status": {"$in": list(ACTIVE_EVENT_REGISTRATIONS)}})
    for tid, rows in tournaments.items():
        for row in rows:
            row["live_counts"] = {"registered": t_regs.get(tid, 0), "capacity": row.get("max_participants") or None, "running_matches": t_running.get(tid, 0)}
    for eid, rows in events.items():
        for row in rows:
            if row.get("has_registration"):
                row["live_counts"] = {"registered": e_regs.get(eid, 0), "capacity": row.get("max_participants") or None}
    if challenges:
        # Fahrer je Challenge: wie f1_routes zählt, nur für alle Karten auf einmal.
        official = {"challenge_id": {"$in": list(challenges)}, "is_invalid": {"$ne": True},
                    "$or": [{"score_scope": {"$exists": False}}, {"score_scope": {"$ne": "club_reference"}}]}
        drivers: dict[str, set] = {}
        async for lap in db.f1_lap_times.find(official, {"_id": 0, "challenge_id": 1, "user_id": 1}):
            drivers.setdefault(lap["challenge_id"], set()).add(lap.get("user_id"))
        for cid, rows in challenges.items():
            for row in rows:
                row["live_counts"] = {"participants": len(drivers.get(cid, set()))}


@router.get("/state")
async def home_state(user: dict | None = Depends(get_optional_user)):
    db = get_db()
    today_start, today_end = _today_window()
    now = datetime.now(timezone.utc)

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
        "tournaments": await _filter_rows(live_tournaments, user, "tournament"),
        "challenges": await _attach_events_to_challenges(await _filter_rows(live_challenges, user, "fastlap")),
        "events": await _filter_rows(live_events, user, "event"),
    }

    # ---------- TODAY ----------
    today_t = await db.tournaments.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$nin": list(HIDDEN_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(100)
    today_e = await db.events.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$nin": list(HIDDEN_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(100)
    today_c = await db.f1_challenges.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$nin": list(HIDDEN_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(100)
    today_t = [r for r in today_t if _overlaps_window(r, today_start, today_end) and _row_not_finished(r, now)][:20]
    today_e = [r for r in today_e if _overlaps_window(r, today_start, today_end) and _row_not_finished(r, now)][:20]
    today_c = [r for r in today_c if _overlaps_window(r, today_start, today_end) and _row_not_finished(r, now)][:20]

    today = {
        "tournaments": await _filter_rows(today_t, user, "tournament"),
        "events": await _filter_rows(today_e, user, "event"),
        "challenges": await _attach_events_to_challenges(await _filter_rows(today_c, user, "fastlap")),
    }

    # ---------- SOON (next 14 days, registration_open / scheduled / check_in) ----------
    horizon = now + timedelta(days=14)
    soon_t = await db.tournaments.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$in": list(SOON_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(50)
    soon_e = await db.events.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$in": list(EVENT_SOON_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(50)
    soon_c = await db.f1_challenges.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$in": list(SOON_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(50)

    def _within_horizon(rows):
        return sorted(
            [r for r in rows if _starts_between(r, now, horizon) and _row_not_finished(r, now)],
            key=_event_date,
        )

    soon = {
        "tournaments": _within_horizon(await _filter_rows(soon_t, user, "tournament"))[:8],
        "events": _within_horizon(await _filter_rows(soon_e, user, "event"))[:8],
        "challenges": await _attach_events_to_challenges(_within_horizon(await _filter_rows(soon_c, user, "fastlap"))[:8]),
    }

    # ---------- UPCOMING (date-driven, finished content gone) ----------
    upcoming_t = await db.tournaments.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$nin": list(HIDDEN_STATUSES)}},
        {"_id": 0},
    ).sort("start_date", 1).to_list(50)
    upcoming_e = await db.events.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$nin": list(HIDDEN_STATUSES)}},
        {"_id": 0},
    ).sort("start_date", 1).to_list(50)
    upcoming_c = await db.f1_challenges.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$nin": list(HIDDEN_STATUSES)}},
        {"_id": 0},
    ).sort("start_date", 1).to_list(50)
    upcoming_t = sorted([r for r in upcoming_t if _starts_between(r, now) and _row_not_finished(r, now)], key=_event_date)
    upcoming_e = sorted([r for r in upcoming_e if _starts_between(r, now) and _row_not_finished(r, now)], key=_event_date)
    upcoming_c = sorted([r for r in upcoming_c if _starts_between(r, now) and _row_not_finished(r, now)], key=_event_date)
    upcoming = {
        "tournaments": (await _filter_rows(upcoming_t, user, "tournament"))[:6],
        "events": (await _filter_rows(upcoming_e, user, "event"))[:6],
        "challenges": await _attach_events_to_challenges((await _filter_rows(upcoming_c, user, "fastlap"))[:6]),
    }

    # ---------- NEWS (latest published, visibility-filtered) ----------
    news = await db.news_posts.find(
        {"published": True}, {"_id": 0},
    ).sort([("published_at", -1), ("created_at", -1)]).to_list(200)
    visible_news = []
    for n in news:
        published_at = _parse_dt(n.get("published_at") or n.get("created_at"))
        if published_at and published_at > now:
            continue
        if await user_can_see(user, n.get("visibility")):
            visible_news.append(n)
    visible_news.sort(
        key=lambda n: (_parse_dt(n.get("published_at") or n.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc), bool(n.get("pinned"))),
        reverse=True,
    )
    visible_news = visible_news[:8]

    stats = {
        "news": len([n for n in news if (n.get("visibility") in (None, "public")) and not ((_parse_dt(n.get("published_at") or n.get("created_at")) or now) > now)]),
        "events": len(upcoming["events"]),
        "tournaments": len(upcoming["tournaments"]),
        "fastlaps": len(upcoming["challenges"]),
    }
    # Der Verein in Zahlen (#407, #425): echte Zähler, nur was öffentlich zählt - keine Entwürfe,
    # keine Absagen, keine nicht-öffentlichen Turniere, keine internen Events. „Turnierteilnahmen“
    # sind die Referenzen (der Verein bei fremden Turnieren), nicht die Auszeichnungen.
    club_numbers = {
        "members": await db.memberships.count_documents({"member_status": {"$in": ["active", "honorary"]}}),
        "tournaments": await db.tournaments.count_documents({"status": {"$nin": ["draft", "cancelled"]}, "is_public": {"$ne": False}}),
        "events": await db.events.count_documents({"status": {"$nin": ["draft", "cancelled"]}, "visibility": {"$in": [None, "public"]}}),
        "participations": await db.references.count_documents({}),
    }

    await _attach_live_counts(db, live, today, soon, upcoming)
    has_live = any(len(v) > 0 for v in live.values())
    return {
        "has_live": has_live,
        "live": live,
        "today": today,
        "soon": soon,
        "upcoming": upcoming,
        "news": visible_news,
        "featured_news": visible_news[:1],
        "stats": stats,
        "club_numbers": club_numbers,
    }
