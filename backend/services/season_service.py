"""Season Pass v2 — points calculation and farming protection (Phase 7).

Formula:
    points = base_points × event_weight × participant_factor + bonus_points

Weights (Vereinsplattform spec):
    Major Tournament       3.0
    Normal Tournament      2.0
    Mini Tournament        1.25
    Fast-Lap Challenge     1.0
    Fun Challenge          0.75
    Community Event        0.5
    Custom                 (admin defined per event)

Base points by placement:
    1.    100
    2.     80
    3.     65
    4.     50
    5-8.   35
    9-16.  20
    Teiln. 10

Participant factor:
    1-7    0.75
    8-15   1.0
    16-31  1.15
    32-63  1.3
    64+    1.5

Bonus points (additive, capped per source):
    +5  pünktlicher Check-in
    +5  Match gewonnen (max 3× pro Turnier)
    +5  Fair Play (kein Dispute)
    +10 Schnellste Runde (Fast-Lap)
    +25 Turnier ohne Niederlage
    +10 Team vollständig eingecheckt

Farming protection:
    Per calendar month, Fast-Lap + Fun-Challenge points award full value
    for the first 4 sources, then 50 % thereafter.
    Major / Normal / Mini tournaments are always full value.
    Admin can flag any season point row as `farming_exempt=True`.
"""
from datetime import datetime, timezone
from typing import Literal
from database import get_db
from models import new_id, now_utc

SourceType = Literal["tournament", "challenge", "fastlap", "fun", "event", "custom",
                     "major", "mini"]


# ---------- Configuration ----------
PLACEMENT_BASE = {1: 100, 2: 80, 3: 65, 4: 50}


def base_points_for_rank(rank: int | None, participated: bool = True) -> int:
    if rank is None:
        return 10 if participated else 0
    if rank in PLACEMENT_BASE:
        return PLACEMENT_BASE[rank]
    if 5 <= rank <= 8:
        return 35
    if 9 <= rank <= 16:
        return 20
    if rank > 16:
        return 10
    return 0


def participant_factor(num_participants: int) -> float:
    if num_participants <= 0:
        return 0.75
    if num_participants <= 7:
        return 0.75
    if num_participants <= 15:
        return 1.0
    if num_participants <= 31:
        return 1.15
    if num_participants <= 63:
        return 1.3
    return 1.5


# Default weights by source category — admin can override per object
DEFAULT_WEIGHT = {
    "major": 3.0, "tournament": 2.0, "mini": 1.25,
    "fastlap": 1.0, "fun": 0.75, "event": 0.5, "custom": 1.0,
}

# Sources that count toward the 4-per-month farming cap
FARMABLE_SOURCES = {"fastlap", "fun"}


# ---------- Award helpers ----------
async def _active_season(db) -> dict | None:
    return await db.seasons.find_one({"status": "active"}, {"_id": 0})


async def _farming_count_this_month(db, user_id: str, source_type: str, season_id: str) -> int:
    """Count how many farmable awards this user already collected this month in
    the active season."""
    if source_type not in FARMABLE_SOURCES:
        return 0
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    return await db.season_points.count_documents({
        "season_id": season_id,
        "user_id": user_id,
        "source_type": {"$in": list(FARMABLE_SOURCES)},
        "created_at": {"$gte": month_start},
        "farming_exempt": {"$ne": True},
    })


async def award_points(
    *,
    user_id: str | None = None,
    team_id: str | None = None,
    source_type: SourceType,
    source_id: str | None,
    source_name: str | None = None,
    rank: int | None = None,
    num_participants: int = 1,
    weight: float | None = None,
    bonus: int = 0,
    bonus_reason: str | None = None,
    farming_exempt: bool = False,
) -> dict | None:
    """Persist a season points entry and return it (or None if no active season)."""
    db = get_db()
    season = await _active_season(db)
    if not season:
        return None
    season_id = season["id"]
    if weight is None:
        weight = DEFAULT_WEIGHT.get(source_type, 1.0)
    if source_id:
        existing = await db.season_points.find_one(
            {
                "season_id": season_id,
                "source_type": source_type,
                "source_id": source_id,
                "user_id": user_id,
                "team_id": team_id,
            },
            {"_id": 0},
        )
        if existing:
            return existing
    base = base_points_for_rank(rank, participated=True)
    factor = participant_factor(num_participants)
    raw = base * weight * factor + bonus
    raw = round(raw, 1)

    farming_multiplier = 1.0
    farming_capped = False
    if user_id and not farming_exempt and source_type in FARMABLE_SOURCES:
        prior = await _farming_count_this_month(db, user_id, source_type, season_id)
        if prior >= 4:
            farming_multiplier = 0.5
            farming_capped = True
    final_total = round(raw * farming_multiplier, 1)

    doc = {
        "id": new_id(),
        "season_id": season_id,
        "user_id": user_id,
        "team_id": team_id,
        "source_type": source_type,
        "source_id": source_id,
        "source_name": source_name,
        "rank": rank,
        "num_participants": num_participants,
        "base_points": base,
        "weight": weight,
        "participant_factor": factor,
        "bonus_points": bonus,
        "bonus_reason": bonus_reason,
        "farming_multiplier": farming_multiplier,
        "farming_capped": farming_capped,
        "farming_exempt": farming_exempt,
        "raw_points": raw,
        "total_points": final_total,
        "created_at": now_utc().isoformat(),
    }
    await db.season_points.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def aggregate_leaderboard(
    *,
    season_id: str | None = None,
    only_members: bool = False,
    only_community: bool = False,
    rookie_only: bool = False,
    teams: bool = False,
    source_type: str | None = None,
    limit: int = 100,
) -> list[dict]:
    """Aggregate season points into a ranked leaderboard."""
    db = get_db()
    if not season_id:
        season = await _active_season(db)
        if not season:
            return []
        season_id = season["id"]

    match: dict = {"season_id": season_id}
    if source_type:
        match["source_type"] = source_type
    if teams:
        match["team_id"] = {"$ne": None}
    else:
        match["user_id"] = {"$ne": None}

    group_field = "$team_id" if teams else "$user_id"
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": group_field,
            "total": {"$sum": "$total_points"},
            "raw": {"$sum": "$raw_points"},
            "events": {"$sum": 1},
        }},
        {"$sort": {"total": -1}},
        {"$limit": limit * 2 if (only_members or only_community or rookie_only) else limit},
    ]
    rows = await db.season_points.aggregate(pipeline).to_list(limit * 5)

    if teams:
        team_ids = [r["_id"] for r in rows]
        team_map = {t["id"]: t for t in await db.teams.find(
            {"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1, "logo_url": 1, "slug": 1}
        ).to_list(500)}
        out = []
        for r in rows:
            team = team_map.get(r["_id"])
            if not team:
                continue
            out.append({**team, "total_points": round(r["total"], 1),
                        "raw_points": round(r["raw"], 1), "events": r["events"]})
        return out[:limit]

    user_ids = [r["_id"] for r in rows]
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1,
         "is_club_member": 1, "user_type": 1, "created_at": 1},
    ).to_list(500)}
    out = []
    for r in rows:
        u = users.get(r["_id"])
        if not u:
            continue
        if only_members and not u.get("is_club_member"):
            continue
        if only_community and u.get("is_club_member"):
            continue
        if rookie_only:
            try:
                created = datetime.fromisoformat((u.get("created_at") or "").replace("Z", "+00:00"))
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                age_days = (datetime.now(timezone.utc) - created).days
                if age_days > 365:
                    continue
            except (ValueError, TypeError):
                continue
        out.append({**u, "total_points": round(r["total"], 1),
                    "raw_points": round(r["raw"], 1), "events": r["events"]})
        if len(out) >= limit:
            break
    return out
