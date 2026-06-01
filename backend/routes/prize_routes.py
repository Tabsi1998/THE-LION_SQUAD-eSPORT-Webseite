"""Phase 9: PrizePickup admin + user routes."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal

from database import get_db
from auth import require_admin, get_current_user
from models import now_utc, new_id
from services.prize_service import DEFAULT_PICKUP_WINDOW_DAYS, mark_ready, mark_picked_up

router = APIRouter(prefix="/api/prizes", tags=["prizes"])

PrizeStatus = Literal["pending", "ready", "picked_up", "expired"]


class PrizeUpdate(BaseModel):
    status: Optional[PrizeStatus] = None
    notes: Optional[str] = None
    pickup_deadline: Optional[str] = None
    prize_label: Optional[str] = None
    prize_value: Optional[str] = None


async def _hydrate_pickups(pickups: list[dict]) -> list[dict]:
    """Attach safe recipient context for admin and user prize views."""
    if not pickups:
        return pickups
    db = get_db()
    user_ids = list({p.get("user_id") for p in pickups if p.get("user_id")})
    team_ids = list({p.get("team_id") for p in pickups if p.get("team_id")})
    users = await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "display_name": 1, "username": 1, "email": 1, "avatar_url": 1},
    ).to_list(500) if user_ids else []
    teams = await db.teams.find(
        {"id": {"$in": team_ids}},
        {"_id": 0, "id": 1, "name": 1, "tag": 1, "logo_url": 1, "member_ids": 1},
    ).to_list(500) if team_ids else []
    user_map = {u["id"]: u for u in users}
    team_map = {t["id"]: t for t in teams}
    for p in pickups:
        user = user_map.get(p.get("user_id")) or {}
        team = team_map.get(p.get("team_id")) or {}
        if team:
            p["recipient_type"] = "team"
            p["recipient_label"] = team.get("tag") or team.get("name") or "Team"
            p["recipient_subtitle"] = team.get("name") or f"{len(team.get('member_ids') or [])} Mitglieder"
            p["recipient_url"] = f"/teams/{team.get('id')}"
            p["team"] = {k: team.get(k) for k in ("id", "name", "tag", "logo_url", "member_ids")}
        else:
            p["recipient_type"] = "user"
            p["recipient_label"] = user.get("display_name") or user.get("username") or "Unbekannter User"
            p["recipient_subtitle"] = user.get("email") or user.get("username") or ""
            p["recipient_url"] = f"/u/{user.get('username')}" if user.get("username") else None
        p["display_name"] = p["recipient_label"]
        p["email"] = user.get("email")
        if user:
            p["user"] = {k: user.get(k) for k in ("id", "display_name", "username", "avatar_url")}
    return pickups


@router.get("")
async def list_prizes(
    status: Optional[PrizeStatus] = None,
    tournament_id: Optional[str] = None,
    me: dict = Depends(require_admin()),
):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    if tournament_id:
        q["tournament_id"] = tournament_id
    pickups = await db.prize_pickups.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return await _hydrate_pickups(pickups)


@router.get("/me")
async def my_prizes(me: dict = Depends(get_current_user)):
    db = get_db()
    team_ids = [
        t["id"] for t in await db.teams.find(
            {"member_ids": me["id"]}, {"_id": 0, "id": 1}
        ).to_list(100)
    ]
    q = {"$or": [{"user_id": me["id"]}]}
    if team_ids:
        q["$or"].append({"team_id": {"$in": team_ids}})
    pickups = await db.prize_pickups.find(
        q, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return await _hydrate_pickups(pickups)


@router.get("/me/open-count")
async def my_open_prize_count(me: dict = Depends(get_current_user)):
    """Lightweight endpoint for dashboard hint badge."""
    db = get_db()
    team_ids = [
        t["id"] for t in await db.teams.find(
            {"member_ids": me["id"]}, {"_id": 0, "id": 1}
        ).to_list(100)
    ]
    q = {
        "$or": [{"user_id": me["id"]}],
        "status": {"$in": ["pending", "ready"]},
    }
    if team_ids:
        q["$or"].append({"team_id": {"$in": team_ids}})
    count = await db.prize_pickups.count_documents({
        **q,
    })
    return {"count": count}


@router.put("/{pickup_id}")
@router.patch("/{pickup_id}")
async def update_prize(pickup_id: str, body: PrizeUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    pickup = await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})
    if not pickup:
        raise HTTPException(status_code=404, detail="Gewinn nicht gefunden")
    new_status = body.status
    if new_status == "ready":
        return await mark_ready(pickup_id, me["id"]) or pickup
    if new_status == "picked_up":
        return await mark_picked_up(pickup_id, me["id"], body.notes or "") or pickup
    # generic patch
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        return pickup
    updates["updated_at"] = now_utc().isoformat()
    await db.prize_pickups.update_one({"id": pickup_id}, {"$set": updates})
    await db.audit_logs.insert_one({
        "id": new_id(), "actor_id": me["id"], "action": "prizes.update",
        "entity_id": pickup_id, "details": updates,
        "created_at": now_utc().isoformat(),
    })
    return await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})


@router.delete("/{pickup_id}")
async def delete_prize(pickup_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.prize_pickups.delete_one({"id": pickup_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Gewinn nicht gefunden")
    return {"ok": True}


class PrizeCreate(BaseModel):
    tournament_id: str
    user_id: str
    place: int
    prize_label: str
    prize_value: Optional[str] = ""
    pickup_deadline: Optional[str] = None


@router.post("")
async def create_prize_manually(body: PrizeCreate, me: dict = Depends(require_admin())):
    db = get_db()
    t = await db.tournaments.find_one({"id": body.tournament_id}, {"_id": 0}) or {}
    user = await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1})
    if not user:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    existing = await db.prize_pickups.find_one({
        "tournament_id": body.tournament_id,
        "user_id": body.user_id,
        "team_id": None,
        "place": body.place,
    })
    if existing:
        raise HTTPException(status_code=409, detail="Für diesen Benutzer und Platz existiert bereits ein Gewinn")
    deadline = body.pickup_deadline or (now_utc() + timedelta(days=DEFAULT_PICKUP_WINDOW_DAYS)).isoformat()
    doc = {
        "id": new_id(),
        "tournament_id": body.tournament_id,
        "tournament_title": t.get("title"),
        "tournament_slug": t.get("slug"),
        "user_id": body.user_id,
        "team_id": None,
        "place": body.place,
        "place_label": str(body.place),
        "prize_label": body.prize_label,
        "prize_value": body.prize_value or "",
        "status": "pending",
        "pickup_deadline": deadline,
        "ready_at": None,
        "picked_up_at": None,
        "picked_up_by": None,
        "notes": "",
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.prize_pickups.insert_one(doc)
    await db.audit_logs.insert_one({
        "id": new_id(), "actor_id": me["id"], "action": "prizes.create",
        "entity_id": doc["id"], "details": {"tournament_id": body.tournament_id, "user_id": body.user_id, "place": body.place},
        "created_at": now_utc().isoformat(),
    })
    return {k: v for k, v in doc.items() if k != "_id"}


@router.post("/auto-create/{tournament_id}")
async def auto_create(tournament_id: str, me: dict = Depends(require_admin())):
    """Manual trigger to (re)create pickups for a tournament — useful when
    results were corrected after publishing."""
    from services.prize_service import auto_create_for_tournament
    n = await auto_create_for_tournament(tournament_id)
    return {"created": n}


@router.post("/auto-create/fastlap/{challenge_id}")
async def auto_create_fastlap(challenge_id: str, me: dict = Depends(require_admin())):
    """Manual trigger to create pickups for a Fast-Lap challenge."""
    from services.prize_service import auto_create_for_f1_challenge
    n = await auto_create_for_f1_challenge(challenge_id)
    return {"created": n}
