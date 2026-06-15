"""Shared match planning guards."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException


ACTIVE_PLANNING_STATUSES = {"preview", "pending", "ready", "scheduled", "in_progress", "waiting_result"}
RESULT_OPEN_TOURNAMENT_STATUSES = {"live", "paused"}


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _duration_minutes(match: dict, updates: dict | None = None) -> int:
    updates = updates or {}
    raw = (
        updates.get("duration_minutes")
        if "duration_minutes" in updates
        else match.get("duration_minutes") or (match.get("settings") or {}).get("duration_minutes")
    )
    try:
        return max(1, int(raw or 30))
    except Exception:
        return 30


def _overlaps(start_a: datetime, minutes_a: int, start_b: datetime, minutes_b: int) -> bool:
    end_a = start_a + timedelta(minutes=minutes_a)
    end_b = start_b + timedelta(minutes=minutes_b)
    return start_a < end_b and start_b < end_a


async def ensure_station_slot_available(db, current_match: dict, updates: dict, collection_name: str) -> None:
    station_id = updates.get("station_id") if "station_id" in updates else current_match.get("station_id")
    if not station_id:
        return
    scheduled_raw = updates.get("scheduled_at") if "scheduled_at" in updates else current_match.get("scheduled_at")
    scheduled_at = _parse_dt(scheduled_raw)
    if not scheduled_at:
        return

    duration = _duration_minutes(current_match, updates)
    tournament_id = current_match["tournament_id"]
    current_id = current_match["id"]
    queries = [
        ("matches", {
            "tournament_id": tournament_id,
            "station_id": station_id,
            "id": {"$ne": current_id if collection_name == "matches" else "__none__"},
            "status": {"$in": list(ACTIVE_PLANNING_STATUSES)},
        }),
        ("matches_v2", {
            "tournament_id": tournament_id,
            "station_id": station_id,
            "id": {"$ne": current_id if collection_name == "matches_v2" else "__none__"},
            "status": {"$in": list(ACTIVE_PLANNING_STATUSES)},
        }),
    ]
    for other_collection, query in queries:
        for other in await db[other_collection].find(query, {"_id": 0}).to_list(3000):
            other_start = _parse_dt(other.get("scheduled_at"))
            if not other_start:
                continue
            if _overlaps(scheduled_at, duration, other_start, _duration_minutes(other)):
                label = other.get("match_key") or other.get("round_name") or other.get("id")
                raise HTTPException(
                    status_code=409,
                    detail=f"Station ist in diesem Zeitraum bereits belegt ({label}).",
                )


async def ensure_tournament_accepts_results(db, tournament_id: str) -> None:
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "status": 1})
    if not tournament or tournament.get("status") not in RESULT_OPEN_TOURNAMENT_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="Ergebnisse können erst gespeichert werden, wenn das Turnier gestartet ist.",
        )
