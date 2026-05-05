"""Membership routes — admin can mark users as official club members."""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_current_user, require_admin, get_optional_user
from services.membership_service import (
    upsert_membership, get_membership, get_user_with_membership,
    is_active_member, derived_user_type, VALID_STATUSES, VALID_TYPES,
    ACTIVE_STATUSES,
)
from models import (
    MembershipUpdate, MemberBenefitCreate, MemberBenefitUpdate, now_utc, new_id,
)
from email_service import send_template

router = APIRouter(prefix="/api/membership", tags=["membership"])


# ---------- Helpers ----------
async def _audit(actor_id: str, action: str, target_id: str, data: dict | None = None):
    db = get_db()
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": action,
        "actor_id": actor_id,
        "target_id": target_id,
        "data": data or {},
        "created_at": now_utc().isoformat(),
    })


# ---------- Public meta ----------
@router.get("/meta")
async def membership_meta():
    """Public: list of valid status / membership types for forms."""
    return {
        "statuses": sorted(VALID_STATUSES),
        "types": sorted(VALID_TYPES),
    }


# ---------- Self ----------
@router.get("/me")
async def my_membership(user: dict = Depends(get_current_user)):
    """Return logged-in user's membership record (or None)."""
    m = await get_membership(user["id"])
    return {
        "user_id": user["id"],
        "membership": m,
        "is_active_member": is_active_member(m),
        "user_type": derived_user_type(user, m),
    }


# ---------- Admin: list memberships ----------
@router.get("")
async def list_memberships(
    status: str | None = None,
    membership_type: str | None = None,
    q: str | None = None,
    me: dict = Depends(require_admin()),
):
    db = get_db()
    query = {}
    if status:
        query["member_status"] = status
    if membership_type:
        query["membership_type"] = membership_type
    cursor = db.memberships.find(query, {"_id": 0}).sort("created_at", -1)
    memberships = await cursor.to_list(1000)
    user_ids = [m["user_id"] for m in memberships]
    user_map = {
        u["id"]: u for u in await db.users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "password_hash": 0},
        ).to_list(2000)
    }
    out = []
    for m in memberships:
        user = user_map.get(m["user_id"])
        if not user:
            continue
        if q:
            blob = " ".join([
                user.get("username") or "",
                user.get("email") or "",
                user.get("display_name") or "",
                m.get("member_number") or "",
            ]).lower()
            if q.lower() not in blob:
                continue
        out.append({"membership": m, "user": user})
    return out


# ---------- Admin: get/update/upgrade a user's membership ----------
@router.get("/user/{user_id}")
async def get_user_membership(user_id: str, me: dict = Depends(require_admin())):
    user = await get_user_with_membership(user_id)
    if not user:
        raise HTTPException(404, "Benutzer nicht gefunden.")
    return user


@router.put("/user/{user_id}")
async def update_user_membership(
    user_id: str,
    body: MembershipUpdate,
    me: dict = Depends(require_admin()),
):
    db = get_db()
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(404, "Benutzer nicht gefunden.")
    payload = body.model_dump(exclude_unset=True)
    try:
        m = await upsert_membership(user_id=user_id, actor_id=me["id"], **payload)
    except ValueError as e:
        raise HTTPException(400, str(e))

    await _audit(me["id"], "membership.update", user_id, payload)

    # Fire emails based on transitions
    new_status = payload.get("member_status")
    if new_status == "active":
        await send_template(
            "membership_activated",
            user["email"],
            display_name=user.get("display_name") or user.get("username"),
            member_number=m.get("member_number") or "",
        )
        # Phase 6: Auto-award members-only badges
        try:
            from badges import evaluate_membership_badges
            await evaluate_membership_badges(user_id)
        except Exception:
            pass
    elif new_status == "blocked":
        await send_template(
            "membership_blocked",
            user["email"],
            display_name=user.get("display_name") or user.get("username"),
        )
    elif new_status in ("inactive", "former"):
        await send_template(
            "membership_deactivated",
            user["email"],
            display_name=user.get("display_name") or user.get("username"),
        )

    user["membership"] = m
    user["user_type"] = derived_user_type(user, m)
    user["is_club_member"] = is_active_member(m)
    return user


# ---------- Member benefits ----------
@router.get("/benefits")
async def list_benefits(user: dict | None = Depends(get_optional_user)):
    """Public: only returns active benefits visible to the calling user."""
    db = get_db()
    cursor = db.member_benefits.find({"is_active": True}, {"_id": 0}).sort("order_index", 1)
    benefits = await cursor.to_list(500)
    if not user:
        return []
    m = await get_membership(user["id"])
    if not is_active_member(m):
        return []
    user_type = m.get("membership_type")
    out = []
    for b in benefits:
        allowed = b.get("visible_for_membership_types") or []
        if not allowed or (user_type and user_type in allowed):
            out.append(b)
    return out


@router.get("/benefits/all")
async def list_all_benefits(me: dict = Depends(require_admin())):
    db = get_db()
    cursor = db.member_benefits.find({}, {"_id": 0}).sort("order_index", 1)
    return await cursor.to_list(500)


@router.post("/benefits")
async def create_benefit(body: MemberBenefitCreate, me: dict = Depends(require_admin())):
    db = get_db()
    doc = {
        "id": new_id(),
        **body.model_dump(),
        "created_at": now_utc().isoformat(),
        "created_by": me["id"],
    }
    await db.member_benefits.insert_one(doc)
    await _audit(me["id"], "benefit.create", doc["id"], {"title": doc["title"]})
    doc.pop("_id", None)
    return doc


@router.patch("/benefits/{benefit_id}")
async def update_benefit(
    benefit_id: str, body: MemberBenefitUpdate, me: dict = Depends(require_admin()),
):
    db = get_db()
    nullable_fields = {
        "description", "category", "image_url", "link_url", "valid_from", "valid_until",
    }
    raw = body.model_dump(exclude_unset=True)
    update = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if not update:
        raise HTTPException(400, "Keine Änderungen.")
    update["updated_at"] = now_utc().isoformat()
    res = await db.member_benefits.update_one({"id": benefit_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Vorteil nicht gefunden.")
    await _audit(me["id"], "benefit.update", benefit_id, update)
    doc = await db.member_benefits.find_one({"id": benefit_id}, {"_id": 0})
    return doc


@router.delete("/benefits/{benefit_id}")
async def delete_benefit(benefit_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.member_benefits.delete_one({"id": benefit_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Vorteil nicht gefunden.")
    await _audit(me["id"], "benefit.delete", benefit_id)
    return {"ok": True}


# ---------- Public members directory ----------
@router.get("/public")
async def public_members_directory():
    """Public: list of active club members (only those with public profile)."""
    db = get_db()
    memberships = await db.memberships.find(
        {"member_status": {"$in": ["active", "honorary"]}}, {"_id": 0}
    ).to_list(2000)
    user_ids = [m["user_id"] for m in memberships]
    users = await db.users.find(
        {"id": {"$in": user_ids}, "is_active": True, "is_banned": {"$ne": True},
         "privacy_public_profile": True},
        {"_id": 0, "password_hash": 0, "email": 0},
    ).to_list(2000)
    user_map = {u["id"]: u for u in users}
    out = []
    for m in memberships:
        u = user_map.get(m["user_id"])
        if not u:
            continue
        out.append({
            "username": u["username"],
            "display_name": u.get("display_name"),
            "avatar_url": u.get("avatar_url"),
            "country": u.get("country"),
            "favorite_games": u.get("favorite_games") or [],
            "membership_type": m.get("membership_type"),
            "member_since": m.get("member_since"),
            "internal_role": m.get("internal_role"),
            "member_number": m.get("member_number") if m.get("show_member_number_publicly") else None,
        })
    out.sort(key=lambda x: (x.get("member_since") or ""))
    return out
