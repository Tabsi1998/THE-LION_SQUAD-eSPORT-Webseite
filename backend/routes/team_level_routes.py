"""Team level endpoints — must be registered BEFORE team_routes (/{team_id} catch)."""
from fastapi import APIRouter, HTTPException

from services.team_levels import get_all_team_levels, top_team_id

router = APIRouter(prefix="/api/teams", tags=["team-levels"])


@router.get("/levels")
async def all_team_levels():
    data = await get_all_team_levels()
    top_id = top_team_id(data)
    return {
        "levels": {
            tid: {"level": v["level"], "points": v["points"], "progress": v["progress"]}
            for tid, v in data.items()
        },
        "crowns": {top_id: "gold"} if top_id else {},
    }


@router.get("/{team_id}/level")
async def team_level_detail(team_id: str):
    data = await get_all_team_levels()
    info = data.get(team_id)
    if not info:
        raise HTTPException(404, "Team nicht gefunden.")
    info = {**info, "crown": "gold" if team_id == top_team_id(data) else None}
    return info
