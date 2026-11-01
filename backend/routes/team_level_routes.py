"""Team level endpoints — must be registered BEFORE team_routes (/{team_id} catch)."""
from fastapi import APIRouter, Depends, HTTPException

from auth import get_optional_user
from database import get_db
from services.team_levels import get_all_team_levels, top_team_id

router = APIRouter(prefix="/api/teams", tags=["team-levels"])


@router.get("/levels")
async def all_team_levels():
    data = await get_all_team_levels()
    # Private Teams (#2128, TM9) tauchen in der öffentlichen Übersicht nicht auf.
    private = {row["id"] async for row in get_db().teams.find({"is_public": False}, {"_id": 0, "id": 1})}
    data = {tid: v for tid, v in data.items() if tid not in private}
    top_id = top_team_id(data)
    return {
        "levels": {
            tid: {"level": v["level"], "points": v["points"], "progress": v["progress"]}
            for tid, v in data.items()
        },
        "crowns": {top_id: "gold"} if top_id else {},
    }


@router.get("/{team_id}/level")
async def team_level_detail(team_id: str, user: dict | None = Depends(get_optional_user)):
    from routes.team_routes import _is_member, _is_staff

    data = await get_all_team_levels()
    info = data.get(team_id)
    if not info:
        raise HTTPException(404, "Team nicht gefunden.")
    team = await get_db().teams.find_one({"id": team_id}, {"_id": 0, "member_ids": 1, "is_public": 1})
    if team and team.get("is_public") is False and not (_is_member(team, user) or _is_staff(user)):
        raise HTTPException(404, "Team nicht gefunden.")
    info = {**info, "crown": "gold" if team_id == top_team_id(data) else None}
    return info
