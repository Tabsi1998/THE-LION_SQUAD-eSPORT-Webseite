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

SOURCE_LABELS = {
    "major": "Major-Turniere",
    "tournament": "Turniere",
    "mini": "Mini-Turniere",
    "challenge": "Challenges",
    "fastlap": "Fast Lap",
    "fun": "Fun-Challenges",
    "event": "Events",
    "custom": "Admin-Wertungen",
}

# Sources that count toward the 4-per-month farming cap
FARMABLE_SOURCES = {"fastlap", "fun"}


def _source_label(source_type: str | None) -> str:
    if not source_type:
        return "Unbekannt"
    return SOURCE_LABELS.get(source_type, source_type.replace("_", " ").title())


def _round_points(value) -> float:
    return round(float(value or 0), 1)


def _summarise_point_entries(entries: list[dict], drop_worst: int = 0) -> dict:
    """Build an explainable per-source summary for already fetched rows."""
    sorted_entries = sorted(entries, key=lambda item: float(item.get("total_points") or 0), reverse=True)
    if drop_worst and len(sorted_entries) > drop_worst:
        kept = sorted_entries[: len(sorted_entries) - drop_worst]
        dropped = sorted_entries[len(sorted_entries) - drop_worst:]
    else:
        kept = sorted_entries
        dropped = []

    by_source: dict[str, dict] = {}
    for item in kept:
        source_type = item.get("source_type") or "custom"
        summary = by_source.setdefault(source_type, {
            "source_type": source_type,
            "label": _source_label(source_type),
            "entries": 0,
            "wins": 0,
            "total_points": 0.0,
            "raw_points": 0.0,
            "bonus_points": 0.0,
            "farming_capped_entries": 0,
        })
        summary["entries"] += 1
        if item.get("rank") == 1:
            summary["wins"] += 1
        summary["total_points"] += float(item.get("total_points") or 0)
        summary["raw_points"] += float(item.get("raw_points") or 0)
        summary["bonus_points"] += float(item.get("bonus_points") or 0)
        if item.get("farming_capped"):
            summary["farming_capped_entries"] += 1

    breakdown = []
    for summary in by_source.values():
        summary["total_points"] = _round_points(summary["total_points"])
        summary["raw_points"] = _round_points(summary["raw_points"])
        summary["bonus_points"] = _round_points(summary["bonus_points"])
        breakdown.append(summary)
    breakdown.sort(key=lambda item: item["total_points"], reverse=True)

    return {
        "source_breakdown": breakdown,
        "dropped_events": len(dropped),
        "dropped_points": _round_points(sum(float(item.get("total_points") or 0) for item in dropped)),
    }


async def _leaderboard_breakdowns(
    db,
    *,
    season_id: str,
    ids: list[str],
    teams: bool,
    source_type: str | None,
    drop_worst: int,
) -> dict[str, dict]:
    if not ids:
        return {}
    id_field = "team_id" if teams else "user_id"
    match: dict = {
        "season_id": season_id,
        id_field: {"$in": ids},
    }
    if source_type:
        match["source_type"] = source_type
    projection = {
        "_id": 0,
        "id": 1,
        id_field: 1,
        "source_type": 1,
        "rank": 1,
        "raw_points": 1,
        "total_points": 1,
        "bonus_points": 1,
        "farming_capped": 1,
    }
    entries = await db.season_points.find(match, projection).to_list(50000)
    grouped: dict[str, list[dict]] = {item_id: [] for item_id in ids}
    for entry in entries:
        item_id = entry.get(id_field)
        if item_id in grouped:
            grouped[item_id].append(entry)
    return {item_id: _summarise_point_entries(rows, drop_worst) for item_id, rows in grouped.items()}


async def _achievement_summaries(db, user_ids: list[str]) -> dict[str, dict]:
    """Return non-negative profile achievement counts/points per user.

    These are intentionally separate from Season-Pass points so the UI can
    explain the difference instead of mixing two scoring systems silently.
    """
    if not user_ids:
        return {}
    awards = await db.user_achievements.find(
        {"user_id": {"$in": user_ids}},
        {"_id": 0, "user_id": 1, "tier_code": 1, "group_code": 1},
    ).to_list(50000)
    tier_codes = list({a.get("tier_code") for a in awards if a.get("tier_code")})
    tiers = {}
    if tier_codes:
        tiers = {t["code"]: t for t in await db.achievements.find(
            {"code": {"$in": tier_codes}},
            {"_id": 0, "code": 1, "group_code": 1, "points": 1},
        ).to_list(50000)}
    group_codes = list({
        (tiers.get(a.get("tier_code")) or {}).get("group_code") or a.get("group_code")
        for a in awards
        if a.get("tier_code") or a.get("group_code")
    })
    groups = {}
    if group_codes:
        groups = {g["code"]: g for g in await db.achievement_groups.find(
            {"code": {"$in": group_codes}},
            {"_id": 0, "code": 1, "is_negative": 1},
        ).to_list(1000)}

    summaries: dict[str, dict] = {
        user_id: {"achievement_count": 0, "achievement_points": 0}
        for user_id in user_ids
    }
    for award in awards:
        tier = tiers.get(award.get("tier_code")) or {}
        group_code = tier.get("group_code") or award.get("group_code")
        group = groups.get(group_code) or {}
        if group.get("is_negative"):
            continue
        summary = summaries.setdefault(award.get("user_id"), {"achievement_count": 0, "achievement_points": 0})
        summary["achievement_count"] += 1
        if group_code != "level_progression":
            summary["achievement_points"] += int(tier.get("points") or 0)
    return summaries


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
    else:
        season = await db.seasons.find_one({"id": season_id}, {"_id": 0})

    try:
        drop_worst = max(int((season or {}).get("drop_worst") or 0), 0)
    except (TypeError, ValueError):
        drop_worst = 0

    match: dict = {"season_id": season_id}
    if source_type:
        match["source_type"] = source_type
    if teams:
        match["team_id"] = {"$ne": None}
    else:
        match["user_id"] = {"$ne": None}

    group_field = "$team_id" if teams else "$user_id"
    group_stage = {
        "_id": group_field,
        "total": {"$sum": "$total_points"},
        "raw": {"$sum": "$raw_points"},
        "events": {"$sum": 1},
        "wins": {"$sum": {"$cond": [{"$eq": ["$rank", 1]}, 1, 0]}},
    }
    if drop_worst:
        group_stage["entries"] = {
            "$push": {
                "total": "$total_points",
                "raw": "$raw_points",
            },
        }

    pipeline = [
        {"$match": match},
        {"$group": group_stage},
    ]
    if not drop_worst:
        pipeline.extend([
            {"$sort": {"total": -1}},
            {"$limit": limit * 2 if (only_members or only_community or rookie_only) else limit},
        ])
    rows_limit = max(limit * 5, 20000) if drop_worst else limit * 5
    rows = await db.season_points.aggregate(pipeline).to_list(rows_limit)

    if drop_worst:
        for r in rows:
            entries = r.get("entries") or []
            if len(entries) > drop_worst:
                kept = sorted(entries, key=lambda item: float(item.get("total") or 0), reverse=True)[: len(entries) - drop_worst]
            else:
                kept = entries
            r["total"] = sum(float(item.get("total") or 0) for item in kept)
            r["raw"] = sum(float(item.get("raw") or 0) for item in kept)
        rows.sort(key=lambda item: item.get("total", 0), reverse=True)

    if teams:
        team_ids = [r["_id"] for r in rows]
        team_map = {t["id"]: t for t in await db.teams.find(
            {"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1, "logo_url": 1, "slug": 1}
        ).to_list(500)}
        breakdowns = await _leaderboard_breakdowns(
            db,
            season_id=season_id,
            ids=team_ids,
            teams=True,
            source_type=source_type,
            drop_worst=drop_worst,
        )
        out = []
        for r in rows:
            team = team_map.get(r["_id"])
            if not team:
                continue
            breakdown = breakdowns.get(r["_id"], {})
            out.append({**team, "total_points": round(r["total"], 1),
                        "season_points": round(r["total"], 1),
                        "raw_points": round(r["raw"], 1), "events": r["events"],
                        "wins": r.get("wins", 0),
                        "source_breakdown": breakdown.get("source_breakdown", []),
                        "dropped_events": breakdown.get("dropped_events", 0),
                        "dropped_points": breakdown.get("dropped_points", 0.0)})
        return out[:limit]

    user_ids = [r["_id"] for r in rows]
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1,
         "is_club_member": 1, "user_type": 1, "created_at": 1},
    ).to_list(500)}
    breakdowns = await _leaderboard_breakdowns(
        db,
        season_id=season_id,
        ids=user_ids,
        teams=False,
        source_type=source_type,
        drop_worst=drop_worst,
    )
    achievement_summaries = await _achievement_summaries(db, user_ids)
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
        breakdown = breakdowns.get(r["_id"], {})
        achievements = achievement_summaries.get(r["_id"], {})
        out.append({**u, "total_points": round(r["total"], 1),
                    "season_points": round(r["total"], 1),
                    "raw_points": round(r["raw"], 1), "events": r["events"],
                    "wins": r.get("wins", 0),
                    "achievement_count": achievements.get("achievement_count", 0),
                    "achievement_points": achievements.get("achievement_points", 0),
                    "profile_points": achievements.get("achievement_points", 0),
                    "source_breakdown": breakdown.get("source_breakdown", []),
                    "dropped_events": breakdown.get("dropped_events", 0),
                    "dropped_points": breakdown.get("dropped_points", 0.0)})
        if len(out) >= limit:
            break
    return out
