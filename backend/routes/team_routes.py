"""Team routes."""
import secrets
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_current_user, require_admin
from models import TeamCreate, TeamUpdate, now_utc, new_id

router = APIRouter(prefix="/api/teams", tags=["teams"])


@router.get("")
async def list_teams(q: str | None = None):
    db = get_db()
    query = {}
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"tag": {"$regex": q, "$options": "i"}},
        ]
    teams = await db.teams.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return teams


@router.get("/{team_id}")
async def get_team(team_id: str):
    db = get_db()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    members = await db.users.find(
        {"id": {"$in": team.get("member_ids", [])}},
        {"_id": 0, "password_hash": 0, "email": 0},
    ).to_list(100)
    team["members"] = members
    team["leader"] = await db.users.find_one(
        {"id": team.get("leader_id")},
        {"_id": 0, "password_hash": 0, "email": 0},
    )
    return team


@router.post("")
async def create_team(body: TeamCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    if await db.teams.find_one({"tag": body.tag}):
        raise HTTPException(status_code=409, detail="Team-Tag bereits vergeben")
    team_id = new_id()
    doc = {
        "id": team_id,
        "name": body.name,
        "tag": body.tag,
        "description": body.description,
        "logo_url": body.logo_url,
        "discord_link": body.discord_link,
        "social_links": {},
        "leader_id": me["id"],
        "co_leader_ids": [],
        "member_ids": [me["id"]],
        "join_code": secrets.token_urlsafe(6),
        "is_public": True,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.teams.insert_one(doc)
    await db.team_members.update_one(
        {"team_id": team_id, "user_id": me["id"]},
        {"$set": {
            "team_id": team_id,
            "user_id": me["id"],
            "role": "leader",
            "joined_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    doc.pop("_id", None)
    try:
        from badges import on_team_created
        await on_team_created(me["id"], team_id)
    except Exception:
        pass
    return doc


@router.patch("/{team_id}")
async def update_team(team_id: str, body: TeamUpdate, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if team["leader_id"] != me["id"] and me["id"] not in team.get("co_leader_ids", []):
        if me["role"] not in ("moderator", "tournament_admin", "club_admin", "superadmin"):
            raise HTTPException(status_code=403, detail="Keine Berechtigung")
    if body.tag and body.tag != team.get("tag") and await db.teams.find_one({"tag": body.tag}):
        raise HTTPException(status_code=409, detail="Team-Tag bereits vergeben")
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    updates["updated_at"] = now_utc().isoformat()
    await db.teams.update_one({"id": team_id}, {"$set": updates})
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    return team


@router.post("/{team_id}/join")
async def join_team(team_id: str, body: dict, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if body.get("join_code") != team.get("join_code"):
        raise HTTPException(status_code=403, detail="Falscher Join-Code")
    if me["id"] in team.get("member_ids", []):
        return {"ok": True, "already_member": True}
    await db.teams.update_one({"id": team_id}, {"$addToSet": {"member_ids": me["id"]}})
    await db.team_members.update_one(
        {"team_id": team_id, "user_id": me["id"]},
        {"$set": {
            "team_id": team_id,
            "user_id": me["id"],
            "role": "member",
            "joined_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    try:
        from badges import on_team_joined
        await on_team_joined(me["id"], team_id)
    except Exception:
        pass
    return {"ok": True}


@router.post("/{team_id}/leave")
async def leave_team(team_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if team["leader_id"] == me["id"]:
        raise HTTPException(status_code=400, detail="Leader kann Team nicht verlassen")
    await db.teams.update_one({"id": team_id}, {"$pull": {"member_ids": me["id"], "co_leader_ids": me["id"]}})
    await db.team_members.delete_one({"team_id": team_id, "user_id": me["id"]})
    return {"ok": True}


@router.delete("/{team_id}")
async def delete_team(team_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if team["leader_id"] != me["id"] and me["role"] not in ("club_admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    await db.teams.delete_one({"id": team_id})
    await db.team_members.delete_many({"team_id": team_id})
    return {"ok": True}
