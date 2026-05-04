"""User profile + admin user management routes."""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_current_user, require_admin, require_super
from models import UserUpdate, RoleUpdate, now_utc

router = APIRouter(prefix="/api/users", tags=["users"])


def _clean(u: dict) -> dict:
    u.pop("_id", None)
    u.pop("password_hash", None)
    return u


@router.get("")
async def list_users(q: str | None = None, role: str | None = None,
                     user: dict = Depends(require_admin())):
    db = get_db()
    query = {}
    if q:
        query["$or"] = [
            {"username": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
            {"display_name": {"$regex": q, "$options": "i"}},
        ]
    if role:
        query["role"] = role
    users = await db.users.find(query, {"password_hash": 0, "_id": 0}).to_list(500)
    return users


@router.get("/public/{username}")
async def get_public_profile(username: str):
    db = get_db()
    u = await db.users.find_one({"username": username}, {"_id": 0, "password_hash": 0, "email": 0})
    if not u:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    if not u.get("privacy_public_profile"):
        return {"username": u["username"], "display_name": u.get("display_name"),
                "avatar_url": u.get("avatar_url"), "privacy_public_profile": False}
    return u


@router.get("/{user_id}")
async def get_user(user_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    # Hide email for non-admins if not own
    if me["id"] != user_id and me["role"] not in ("moderator", "tournament_admin", "club_admin", "superadmin"):
        u.pop("email", None)
    return u


@router.patch("/me")
async def update_me(body: UserUpdate, me: dict = Depends(get_current_user)):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        return me
    updates["updated_at"] = now_utc().isoformat()
    await db.users.update_one({"id": me["id"]}, {"$set": updates})
    u = await db.users.find_one({"id": me["id"]}, {"_id": 0, "password_hash": 0})
    return u


@router.patch("/{user_id}")
async def admin_update_user(user_id: str, body: UserUpdate,
                             me: dict = Depends(require_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    updates["updated_at"] = now_utc().isoformat()
    await db.users.update_one({"id": user_id}, {"$set": updates})
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return u


@router.post("/{user_id}/ban")
async def ban_user(user_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.users.update_one({"id": user_id}, {"$set": {"is_banned": True, "updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({"action": "user.ban", "target_id": user_id,
                                     "actor_id": me["id"], "created_at": now_utc().isoformat()})
    return {"ok": True}


@router.post("/{user_id}/unban")
async def unban_user(user_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.users.update_one({"id": user_id}, {"$set": {"is_banned": False, "updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({"action": "user.unban", "target_id": user_id,
                                     "actor_id": me["id"], "created_at": now_utc().isoformat()})
    return {"ok": True}


@router.post("/{user_id}/role")
async def set_role(user_id: str, body: RoleUpdate, me: dict = Depends(require_super())):
    db = get_db()
    await db.users.update_one({"id": user_id}, {"$set": {"role": body.role, "updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({"action": "user.role_change", "target_id": user_id,
                                     "actor_id": me["id"], "data": {"role": body.role},
                                     "created_at": now_utc().isoformat()})
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return u
