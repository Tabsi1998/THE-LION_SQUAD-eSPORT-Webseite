"""Badge / Achievement routes."""
from fastapi import APIRouter, HTTPException
from database import get_db

router = APIRouter(prefix="/api/badges", tags=["badges"])


@router.get("")
async def list_badges():
    db = get_db()
    badges = await db.badges.find({}, {"_id": 0}).to_list(200)
    # Sort tiers: platinum > gold > silver > bronze, then by name
    tier_order = {"platinum": 0, "gold": 1, "silver": 2, "bronze": 3}
    badges.sort(key=lambda b: (tier_order.get(b.get("tier"), 9), b.get("name", "")))
    # Add awarded counts
    for b in badges:
        b["awarded_count"] = await db.user_badges.count_documents({"badge_code": b["code"]})
    return badges


@router.get("/{code}")
async def get_badge(code: str):
    db = get_db()
    b = await db.badges.find_one({"code": code}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Badge nicht gefunden")
    # Holders (public)
    holders_raw = await db.user_badges.find({"badge_code": code}, {"_id": 0})\
        .sort("earned_at", -1).to_list(500)
    user_ids = [h["user_id"] for h in holders_raw]
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1,
         "privacy_public_profile": 1}).to_list(500)}
    holders = []
    for h in holders_raw:
        u = users.get(h["user_id"])
        if u:
            holders.append({
                "username": u.get("username"),
                "display_name": u.get("display_name"),
                "avatar_url": u.get("avatar_url"),
                "earned_at": h["earned_at"],
                "private": not u.get("privacy_public_profile"),
            })
    b["holders"] = holders
    b["awarded_count"] = len(holders)
    return b
