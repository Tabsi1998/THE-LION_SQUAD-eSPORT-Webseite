"""Team level system: automatic points from member achievements + tournament activity."""
import logging
from datetime import datetime, timezone

from database import get_db

logger = logging.getLogger(__name__)

PARTICIPATION_BONUS = 100
WIN_BONUS = 500

TEAM_ACHIEVEMENTS = [
    {"code": "team_founded", "name": "Gegründet", "description": "Das Team wurde offiziell gegründet.", "icon": "flag"},
    {"code": "team_roster_3", "name": "Trio komplett", "description": "Mindestens 3 Mitglieder im Team.", "icon": "users"},
    {"code": "team_roster_5", "name": "Full Squad", "description": "Mindestens 5 Mitglieder im Team.", "icon": "users"},
    {"code": "team_points_500", "name": "Punktesammler", "description": "500 Team-Punkte erreicht.", "icon": "zap"},
    {"code": "team_points_2500", "name": "Punktemaschine", "description": "2.500 Team-Punkte erreicht.", "icon": "zap"},
    {"code": "team_points_10000", "name": "Punktelegende", "description": "10.000 Team-Punkte erreicht.", "icon": "zap"},
    {"code": "team_tournament_1", "name": "Turnier-Debüt", "description": "An einem Turnier teilgenommen.", "icon": "swords"},
    {"code": "team_tournament_3", "name": "Turnier-Stammgast", "description": "An 3 Turnieren teilgenommen.", "icon": "swords"},
    {"code": "team_champion", "name": "Champions", "description": "Ein Turnier gewonnen.", "icon": "trophy"},
    {"code": "team_level_5", "name": "Aufsteiger", "description": "Team-Level 5 erreicht.", "icon": "trending-up"},
    {"code": "team_level_10", "name": "Elite-Squad", "description": "Team-Level 10 erreicht.", "icon": "shield"},
    {"code": "team_level_20", "name": "Legendäres Team", "description": "Team-Level 20 erreicht.", "icon": "crown"},
]

_cache: dict = {"at": None, "data": None}
_CACHE_TTL = 60


def team_level_curve(points: int) -> dict:
    points = max(int(points or 0), 0)
    level = 1
    while points >= (level * level * 100):
        level += 1
    current_floor = (level - 1) * (level - 1) * 100
    next_floor = level * level * 100
    span = max(next_floor - current_floor, 1)
    progress = round(((points - current_floor) / span) * 100)
    return {
        "level": level,
        "points": points,
        "current_level_points": current_floor,
        "next_level_points": next_floor,
        "progress": max(0, min(progress, 100)),
    }


def _evaluate_achievements(stats: dict) -> list[dict]:
    checks = {
        "team_founded": True,
        "team_roster_3": stats["member_count"] >= 3,
        "team_roster_5": stats["member_count"] >= 5,
        "team_points_500": stats["points"] >= 500,
        "team_points_2500": stats["points"] >= 2500,
        "team_points_10000": stats["points"] >= 10000,
        "team_tournament_1": stats["tournaments"] >= 1,
        "team_tournament_3": stats["tournaments"] >= 3,
        "team_champion": stats["wins"] >= 1,
        "team_level_5": stats["level"] >= 5,
        "team_level_10": stats["level"] >= 10,
        "team_level_20": stats["level"] >= 20,
    }
    return [{**a, "earned": bool(checks.get(a["code"]))} for a in TEAM_ACHIEVEMENTS]


async def compute_all_team_levels() -> dict[str, dict]:
    db = get_db()
    teams = await db.teams.find({}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "member_ids": 1}).to_list(1000)
    if not teams:
        return {}
    tiers = await db.achievements.find({}, {"_id": 0, "code": 1, "points": 1}).to_list(4000)
    points_map = {t["code"]: int(t.get("points", 0) or 0) for t in tiers}
    neg = {g["code"] async for g in db.achievement_groups.find({"is_negative": True}, {"_id": 0, "code": 1})}
    awards = await db.user_achievements.find({}, {"_id": 0, "user_id": 1, "tier_code": 1, "group_code": 1}).to_list(50000)
    user_points: dict[str, int] = {}
    for a in awards:
        if a.get("group_code") in neg:
            continue
        user_points[a["user_id"]] = user_points.get(a["user_id"], 0) + points_map.get(a["tier_code"], 0)

    regs = await db.tournament_registrations.find(
        {"team_id": {"$ne": None}}, {"_id": 0, "team_id": 1, "tournament_id": 1}
    ).to_list(20000)
    team_tournaments: dict[str, set] = {}
    for r in regs:
        if r.get("team_id") and r.get("tournament_id"):
            team_tournaments.setdefault(r["team_id"], set()).add(r["tournament_id"])
    tournaments = {
        t["id"]: t async for t in db.tournaments.find({}, {"_id": 0, "id": 1, "status": 1, "winner_team_id": 1})
    }

    out: dict[str, dict] = {}
    for team in teams:
        member_ids = team.get("member_ids") or []
        member_points = sum(user_points.get(uid, 0) for uid in member_ids)
        tids = team_tournaments.get(team["id"], set())
        tournament_points = len(tids) * PARTICIPATION_BONUS
        wins = sum(1 for t in tournaments.values() if t.get("winner_team_id") == team["id"])
        tournament_points += wins * WIN_BONUS
        total = member_points + tournament_points
        curve = team_level_curve(total)
        stats = {
            **curve,
            "team_id": team["id"],
            "name": team.get("name"),
            "tag": team.get("tag"),
            "member_count": len(member_ids),
            "member_points": member_points,
            "tournament_points": tournament_points,
            "tournaments": len(tids),
            "wins": wins,
        }
        stats["achievements"] = _evaluate_achievements(stats)
        out[team["id"]] = stats
    return out


async def get_all_team_levels(force: bool = False) -> dict[str, dict]:
    now = datetime.now(timezone.utc)
    if not force and _cache["at"] and (now - _cache["at"]).total_seconds() < _CACHE_TTL and _cache["data"] is not None:
        return _cache["data"]
    data = await compute_all_team_levels()
    _cache["at"] = now
    _cache["data"] = data
    return data
