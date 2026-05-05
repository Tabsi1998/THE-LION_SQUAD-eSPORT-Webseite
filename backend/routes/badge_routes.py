"""Achievement routes (Phase B v4) — group-aware listing, admin CRUD, manual award.

Public/User endpoints (prefix /api/achievements):
  GET  /api/achievements/groups            — full public catalog (no locked negative tiers)
  GET  /api/achievements/me                — my catalog with progress + earned
  GET  /api/achievements/user/{user_id}    — public profile achievements
  POST /api/achievements/evaluate          — re-evaluate (auto-award) for self

Admin endpoints (prefix /api/admin/achievements):
  GET    /groups                          — all groups (incl. negative)
  POST   /groups                          — create group
  PATCH  /groups/{code}
  DELETE /groups/{code}                   — only if not seeded (is_admin_created=true)
  GET    /tiers
  POST   /tiers
  PATCH  /tiers/{code}
  DELETE /tiers/{code}
  POST   /award                           — manual award {user_id, tier_code, note}
  DELETE /award                           — revoke {user_id, tier_code}
  GET    /negative/awards                 — admin-only list of negative awards
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, Literal
from database import get_db
from auth import get_optional_user, get_current_user, require_admin
from badges import (
    award_achievement, list_groups_for_user, list_user_awards,
    evaluate_user_progress, trigger_negative_incident, on_season_completed,
    NEGATIVE_INCIDENTS,
)
from models import now_utc, new_id

# ============ Public/User ============
router = APIRouter(prefix="/api/achievements", tags=["achievements"])


@router.get("/groups")
async def public_groups(viewer: dict | None = Depends(get_optional_user)):
    return await list_groups_for_user(None, viewer)


@router.get("/me")
async def my_achievements(user: dict = Depends(get_current_user)):
    groups = await list_groups_for_user(user["id"], user)
    awards = await list_user_awards(user["id"], user)
    return {"groups": groups, "awards": awards}


@router.get("/user/{user_id}")
async def user_achievements(user_id: str, viewer: dict | None = Depends(get_optional_user)):
    db = get_db()
    if not await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Nutzer nicht gefunden.")
    groups = await list_groups_for_user(user_id, viewer)
    awards = await list_user_awards(user_id, viewer)
    return {"groups": groups, "awards": awards}


@router.post("/evaluate")
async def evaluate_self(user: dict = Depends(get_current_user)):
    n = await evaluate_user_progress(user["id"])
    return {"newly_awarded": n}


# ============ Admin CRUD ============
admin_router = APIRouter(prefix="/api/admin/achievements", tags=["achievements-admin"])


# ---- Group CRUD ----
class GroupCreate(BaseModel):
    code: str = Field(min_length=2, max_length=80)
    name: str
    category: Literal["match", "tournament", "fastlap", "club", "special", "negative"] = "special"
    icon: str = "trophy"
    accent_color: str = "#FF3B30"
    description: str = ""
    public: bool = True
    is_special: bool = True
    is_negative: bool = False
    sort_order: int = 600


class GroupPatch(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    icon: Optional[str] = None
    accent_color: Optional[str] = None
    description: Optional[str] = None
    public: Optional[bool] = None
    is_special: Optional[bool] = None
    is_negative: Optional[bool] = None
    sort_order: Optional[int] = None


@admin_router.get("/groups")
async def admin_list_groups(me: dict = Depends(require_admin())):
    db = get_db()
    return await db.achievement_groups.find({}, {"_id": 0}).sort("sort_order", 1).to_list(500)


@admin_router.post("/groups")
async def admin_create_group(body: GroupCreate, me: dict = Depends(require_admin())):
    db = get_db()
    if await db.achievement_groups.find_one({"code": body.code}):
        raise HTTPException(409, "Code bereits vergeben.")
    doc = {**body.model_dump(), "id": body.code, "is_admin_created": True,
           "created_at": now_utc().isoformat(), "created_by": me["id"]}
    await db.achievement_groups.insert_one(doc)
    doc.pop("_id", None)
    return doc


@admin_router.patch("/groups/{code}")
async def admin_patch_group(code: str, body: GroupPatch, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {"description", "accent_color"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if not updates:
        raise HTTPException(400, "Keine Änderungen.")
    res = await db.achievement_groups.update_one({"code": code}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Group nicht gefunden.")
    return await db.achievement_groups.find_one({"code": code}, {"_id": 0})


@admin_router.delete("/groups/{code}")
async def admin_delete_group(code: str, me: dict = Depends(require_admin())):
    db = get_db()
    g = await db.achievement_groups.find_one({"code": code})
    if not g:
        raise HTTPException(404, "Group nicht gefunden.")
    if not g.get("is_admin_created"):
        raise HTTPException(400, "System-Group kann nicht gelöscht werden — deaktivieren via public=false.")
    await db.achievements.delete_many({"group_code": code})
    await db.user_achievements.delete_many({"group_code": code})
    await db.achievement_groups.delete_one({"code": code})
    return {"ok": True}


# ---- Tier CRUD ----
class TierCreate(BaseModel):
    code: str = Field(min_length=2, max_length=80)
    group_code: str
    level: int = Field(ge=1, le=5)
    name: str
    description: str = ""
    condition_key: Optional[str] = None
    progress_target: Optional[int] = None
    points: int = 10
    icon: Optional[str] = None
    manual_only: bool = False


class TierPatch(BaseModel):
    level: Optional[int] = None
    name: Optional[str] = None
    description: Optional[str] = None
    condition_key: Optional[str] = None
    progress_target: Optional[int] = None
    points: Optional[int] = None
    icon: Optional[str] = None
    manual_only: Optional[bool] = None


@admin_router.get("/tiers")
async def admin_list_tiers(group_code: Optional[str] = None,
                            me: dict = Depends(require_admin())):
    db = get_db()
    q: dict = {}
    if group_code:
        q["group_code"] = group_code
    return await db.achievements.find(q, {"_id": 0}).sort([("group_code", 1), ("level", 1)]).to_list(2000)


@admin_router.post("/tiers")
async def admin_create_tier(body: TierCreate, me: dict = Depends(require_admin())):
    db = get_db()
    if not await db.achievement_groups.find_one({"code": body.group_code}):
        raise HTTPException(404, "Group nicht gefunden.")
    if await db.achievements.find_one({"code": body.code}):
        raise HTTPException(409, "Tier-Code bereits vergeben.")
    doc = {**body.model_dump(), "id": body.code, "created_at": now_utc().isoformat()}
    await db.achievements.insert_one(doc)
    doc.pop("_id", None)
    return doc


@admin_router.patch("/tiers/{code}")
async def admin_patch_tier(code: str, body: TierPatch, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {"description", "condition_key", "progress_target", "icon"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if not updates:
        raise HTTPException(400, "Keine Änderungen.")
    res = await db.achievements.update_one({"code": code}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Tier nicht gefunden.")
    return await db.achievements.find_one({"code": code}, {"_id": 0})


@admin_router.delete("/tiers/{code}")
async def admin_delete_tier(code: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.achievements.delete_one({"code": code})
    if res.deleted_count == 0:
        raise HTTPException(404, "Tier nicht gefunden.")
    await db.user_achievements.delete_many({"tier_code": code})
    return {"ok": True}


# ---- Manual award/revoke ----
class AwardBody(BaseModel):
    user_id: str
    tier_code: str
    note: Optional[str] = None


@admin_router.post("/award")
async def admin_award(body: AwardBody, me: dict = Depends(require_admin())):
    db = get_db()
    if not await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Nutzer nicht gefunden.")
    if not await db.achievements.find_one({"code": body.tier_code}):
        raise HTTPException(404, "Tier nicht gefunden.")
    awarded = await award_achievement(body.user_id, body.tier_code,
                                       context={"manual": True, "by": me["id"], "note": body.note},
                                       awarded_by=me["id"])
    if not awarded:
        return {"ok": True, "already_awarded": True}
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "achievement.manual_award",
        "actor_id": me["id"], "target_id": body.user_id,
        "data": {"tier_code": body.tier_code, "note": body.note},
        "created_at": now_utc().isoformat(),
    })
    return {"ok": True, "newly_awarded": True}


@admin_router.delete("/award")
async def admin_revoke(body: AwardBody, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.user_achievements.delete_one({"user_id": body.user_id, "tier_code": body.tier_code})
    if res.deleted_count == 0:
        raise HTTPException(404, "Nicht vergeben.")
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "achievement.manual_revoke",
        "actor_id": me["id"], "target_id": body.user_id,
        "data": {"tier_code": body.tier_code, "note": body.note},
        "created_at": now_utc().isoformat(),
    })
    return {"ok": True}


@admin_router.get("/negative/awards")
async def admin_list_negative_awards(me: dict = Depends(require_admin())):
    """List all awarded negative achievements with user info — admin-only view."""
    db = get_db()
    neg_groups = [g["code"] async for g in db.achievement_groups.find({"is_negative": True}, {"_id": 0, "code": 1})]
    awards = await db.user_achievements.find({"group_code": {"$in": neg_groups}}, {"_id": 0}).sort("earned_at", -1).to_list(2000)
    user_ids = list({a["user_id"] for a in awards})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "email": 1}).to_list(500)}
    tiers_map = {t["code"]: t async for t in db.achievements.find({}, {"_id": 0, "code": 1, "name": 1, "group_code": 1, "icon": 1})}
    out = []
    for a in awards:
        u = users.get(a["user_id"])
        t = tiers_map.get(a["tier_code"], {})
        out.append({
            "user_id": a["user_id"],
            "username": u.get("username") if u else None,
            "display_name": u.get("display_name") if u else None,
            "tier_code": a["tier_code"],
            "tier_name": t.get("name"),
            "group_code": a.get("group_code"),
            "earned_at": a["earned_at"],
            "context": a.get("context", {}),
        })
    return out


@admin_router.get("/users/search")
async def admin_search_users(q: str = "", me: dict = Depends(require_admin())):
    """Quick user search for the admin manual-award picker."""
    db = get_db()
    query: dict = {}
    if q:
        rx = {"$regex": q.strip(), "$options": "i"}
        query = {"$or": [{"username": rx}, {"display_name": rx}, {"email": rx}]}
    users = await db.users.find(query, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "email": 1}).limit(20).to_list(20)
    return users


# ---- Phase B v4.1 — Negative incident trigger ----
class IncidentBody(BaseModel):
    user_id: str
    incident_type: str  # one of NEGATIVE_INCIDENTS keys
    note: Optional[str] = None
    match_id: Optional[str] = None


@admin_router.get("/incident-types")
async def admin_incident_types(me: dict = Depends(require_admin())):
    return [{"key": k, "tier_code": v} for k, v in NEGATIVE_INCIDENTS.items()]


@admin_router.post("/trigger-incident")
async def admin_trigger_incident(body: IncidentBody, me: dict = Depends(require_admin())):
    db = get_db()
    if body.incident_type not in NEGATIVE_INCIDENTS:
        raise HTTPException(400, f"Unbekannter Vorfall-Typ. Erlaubt: {sorted(NEGATIVE_INCIDENTS.keys())}")
    if not await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Nutzer nicht gefunden.")
    code = await trigger_negative_incident(
        body.user_id, body.incident_type,
        context={"manual": True, "by": me["id"], "note": body.note, "match_id": body.match_id},
        awarded_by=me["id"],
    )
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "achievement.negative_trigger",
        "actor_id": me["id"], "target_id": body.user_id,
        "data": {"incident_type": body.incident_type, "tier_code": code, "note": body.note},
        "created_at": now_utc().isoformat(),
    })
    return {"ok": True, "tier_code": code, "newly_awarded": bool(code)}


# ---- Phase B v4.1 — Season completion ----
@admin_router.post("/season/{season_id}/award")
async def admin_season_award(season_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    if not await db.seasons.find_one({"id": season_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Saison nicht gefunden.")
    result = await on_season_completed(season_id)
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "achievement.season_award",
        "actor_id": me["id"], "target_id": season_id,
        "data": result,
        "created_at": now_utc().isoformat(),
    })
    return result
