"""Phase 9: PrizePickup admin + user routes."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal

from database import get_db
from auth import require_admin, get_current_user
from models import now_utc, new_id
from services.prize_service import mark_ready, mark_picked_up

router = APIRouter(prefix="/api/prizes", tags=["prizes"])

PrizeStatus = Literal["pending", "ready", "picked_up", "expired"]


class PrizeUpdate(BaseModel):
    status: Optional[PrizeStatus] = None
    notes: Optional[str] = None
    pickup_deadline: Optional[str] = None
    prize_label: Optional[str] = None
    prize_value: Optional[str] = None


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
    # Hydrate display_name
    user_ids = list({p.get("user_id") for p in pickups if p.get("user_id")})
    users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1, "email": 1}).to_list(500)
    umap = {u["id"]: u for u in users}
    for p in pickups:
        u = umap.get(p.get("user_id")) or {}
        p["display_name"] = u.get("display_name") or u.get("username") or "—"
        p["email"] = u.get("email")
    return pickups


@router.get("/me")
async def my_prizes(me: dict = Depends(get_current_user)):
    db = get_db()
    pickups = await db.prize_pickups.find(
        {"user_id": me["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return pickups


@router.get("/me/open-count")
async def my_open_prize_count(me: dict = Depends(get_current_user)):
    """Lightweight endpoint for dashboard hint badge."""
    db = get_db()
    count = await db.prize_pickups.count_documents({
        "user_id": me["id"],
        "status": {"$in": ["pending", "ready"]},
    })
    return {"count": count}


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
        "pickup_deadline": body.pickup_deadline,
        "ready_at": None,
        "picked_up_at": None,
        "picked_up_by": None,
        "notes": "",
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.prize_pickups.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.post("/auto-create/{tournament_id}")
async def auto_create(tournament_id: str, me: dict = Depends(require_admin())):
    """Manual trigger to (re)create pickups for a tournament — useful when
    results were corrected after publishing."""
    from services.prize_service import auto_create_for_tournament
    n = await auto_create_for_tournament(tournament_id)
    return {"created": n}
