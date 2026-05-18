"""Fast-Lap prize pickup reminders shortly before a challenge ends."""
import logging
from datetime import datetime, timedelta, timezone

from database import get_db
from models import now_utc
from services.user_notifications import create_user_notification

logger = logging.getLogger("tls.f1_prize_reminder")


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _official_time_query(extra: dict | None = None) -> dict:
    return {
        **(extra or {}),
        "is_invalid": {"$ne": True},
        "$or": [{"score_scope": {"$exists": False}}, {"score_scope": {"$ne": "club_reference"}}],
    }


async def _track_top_entries(db, challenge_id: str, track_id: str, max_rank: int) -> list[dict]:
    rows = await db.f1_lap_times.find(
        _official_time_query({"challenge_id": challenge_id, "track_id": track_id}),
        {"_id": 0},
    ).to_list(5000)
    best_by_user: dict[str, dict] = {}
    for row in rows:
        uid = row.get("user_id")
        if not uid:
            continue
        effective = int(row.get("time_ms") or 0) + int((row.get("penalty_seconds") or 0) * 1000)
        if uid not in best_by_user or effective < best_by_user[uid]["effective_ms"]:
            best_by_user[uid] = {**row, "effective_ms": effective}
    ranked = sorted(best_by_user.values(), key=lambda item: item["effective_ms"])
    for index, row in enumerate(ranked):
        row["rank"] = index + 1
    return ranked[:max_rank]


async def schedule_f1_prize_reminders() -> dict:
    db = get_db()
    now = now_utc()
    window_start = now + timedelta(minutes=20)
    window_end = now + timedelta(minutes=40)
    cursor = db.f1_challenges.find(
        {
            "status": {"$in": ["live", "registration_closed", "registration_open"]},
            "end_date": {"$gte": window_start.isoformat(), "$lte": window_end.isoformat()},
            "prize_places": {"$type": "array", "$ne": []},
        },
        {"_id": 0},
    )
    created = 0
    async for challenge in cursor:
        end_dt = _parse_dt(challenge.get("end_date"))
        if not end_dt:
            continue
        prize_ranks = []
        for prize in challenge.get("prize_places") or []:
            try:
                prize_ranks.append((int(prize.get("place")), prize))
            except Exception:
                continue
        if not prize_ranks:
            continue
        max_rank = max(rank for rank, _ in prize_ranks)
        tracks = await db.f1_tracks.find(
            {"challenge_id": challenge["id"]},
            {"_id": 0},
        ).sort("order_index", 1).to_list(100)
        for track in tracks:
            by_rank = {row["rank"]: row for row in await _track_top_entries(db, challenge["id"], track["id"], max_rank)}
            for rank, prize in prize_ranks:
                entry = by_rank.get(rank)
                if not entry:
                    continue
                dedupe = f"f1_prize_end:{challenge['id']}:{track['id']}:{entry['user_id']}:{rank}"
                exists = await db.notifications.find_one(
                    {"user_id": entry["user_id"], "kind": "f1_prize_reminder", "meta.dedupe_key": dedupe},
                    {"_id": 1},
                )
                if exists:
                    continue
                prize_text = prize.get("value") or prize.get("label") or "ein Preis"
                minutes = max(0, int((end_dt - now).total_seconds() / 60))
                await create_user_notification(
                    entry["user_id"],
                    "Fast-Lap Preis in Reichweite",
                    f"{challenge.get('title') or 'Fast Lap'} - {track.get('name') or 'Strecke'} endet in ca. {minutes} Minuten. Du bist aktuell Platz {rank} und hast {prize_text} in Reichweite. Bitte nach Ende beim Team melden.",
                    url=f"/fastlap/{challenge.get('slug') or challenge['id']}",
                    kind="f1_prize_reminder",
                    meta={
                        "dedupe_key": dedupe,
                        "challenge_id": challenge["id"],
                        "track_id": track["id"],
                        "rank": rank,
                        "end_date": challenge.get("end_date"),
                    },
                )
                created += 1
    if created:
        logger.info("[f1-prize-reminder] created=%s", created)
    return {"notifications": created}
