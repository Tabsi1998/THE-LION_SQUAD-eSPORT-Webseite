"""Badge / Achievement routes — audience-aware (Phase 6)."""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_optional_user, get_current_user, require_admin
from badges import _user_can_see_badge, award_badge, BADGE_BY_CODE
from models import now_utc, new_id

router = APIRouter(prefix="/api/badges", tags=["badges"])

TIER_ORDER = {"platinum": 0, "gold": 1, "silver": 2, "bronze": 3}


@router.get("")
async def list_badges(user: dict | None = Depends(get_optional_user)):
    db = get_db()
    badges = await db.badges.find({}, {"_id": 0}).to_list(500)
    badges.sort(key=lambda b: (TIER_ORDER.get(b.get("tier"), 9), b.get("name", "")))
    out = []
    for b in badges:
        # Hide secret + audience-mismatch from catalog (still visible if user *holds* it)
        if not _user_can_see_badge(b, user):
            # Show as ??? if user is logged in and has earned it
            if user:
                held = await db.user_badges.find_one({"user_id": user["id"], "badge_code": b["code"]})
                if not held:
                    continue
            else:
                continue
        b["awarded_count"] = await db.user_badges.count_documents({"badge_code": b["code"]})
        out.append(b)
    return out


@router.get("/me")
async def list_my_badges(user: dict = Depends(get_current_user)):
    """Return all badges the calling user has earned (incl. negative + secret)."""
    db = get_db()
    earned = await db.user_badges.find({"user_id": user["id"]}, {"_id": 0}).sort("earned_at", -1).to_list(500)
    codes = [e["badge_code"] for e in earned]
    badges = {b["code"]: b for b in await db.badges.find({"code": {"$in": codes}}, {"_id": 0}).to_list(500)}
    out = []
    for e in earned:
        b = badges.get(e["badge_code"])
        if b:
            out.append({**b, "earned_at": e["earned_at"], "context": e.get("context", {})})
    return out


@router.get("/user/{user_id}")
async def list_user_badges(user_id: str, viewer: dict | None = Depends(get_optional_user)):
    """Public endpoint for showcasing a user's badges. Hides negative for viewers."""
    db = get_db()
    earned = await db.user_badges.find({"user_id": user_id}, {"_id": 0}).sort("earned_at", -1).to_list(500)
    codes = [e["badge_code"] for e in earned]
    badges = {b["code"]: b for b in await db.badges.find({"code": {"$in": codes}}, {"_id": 0}).to_list(500)}
    out = []
    is_self = viewer and viewer.get("id") == user_id
    for e in earned:
        b = badges.get(e["badge_code"])
        if not b:
            continue
        # Negative badges visible only to self (or admins)
        if b.get("negative") and not is_self and not (viewer and viewer.get("role") in ("club_admin", "superadmin")):
            continue
        # Members-only badges hidden from anonymous viewers (catalog rule)
        if b.get("audience") == "members_only" and not viewer:
            continue
        out.append({**b, "earned_at": e["earned_at"]})
    return out


@router.get("/{code}")
async def get_badge(code: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    b = await db.badges.find_one({"code": code}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Badge nicht gefunden")
    # Hide details if not visible to user (unless they hold it)
    if not _user_can_see_badge(b, user):
        if not user or not await db.user_badges.find_one({"user_id": user["id"], "badge_code": code}):
            raise HTTPException(404, "Badge nicht gefunden")
    holders_raw = await db.user_badges.find({"badge_code": code}, {"_id": 0}).sort("earned_at", -1).to_list(500)
    user_ids = [h["user_id"] for h in holders_raw]
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1,
         "privacy_public_profile": 1}).to_list(500)}
    holders = []
    # Negative/secret holders are private (hidden from catalog) — show count only
    show_holders = not (b.get("negative") or b.get("secret"))
    if show_holders:
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
    b["awarded_count"] = len(holders_raw)
    return b


# ---------- Admin: manual award & revoke (Phase 6) ----------
@router.post("/admin/award")
async def admin_award(body: dict, me: dict = Depends(require_admin())):
    """Manually award a badge (e.g. 'ehrenloewe' / Hall of Fame)."""
    user_id = body.get("user_id")
    code = body.get("code")
    if not user_id or not code:
        raise HTTPException(400, "user_id und code erforderlich.")
    if code not in BADGE_BY_CODE:
        raise HTTPException(404, "Unbekannter Badge-Code.")
    db = get_db()
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
    if not user:
        raise HTTPException(404, "Nutzer nicht gefunden.")
    awarded = await award_badge(user_id, code, {"manual": True, "by": me["id"], "note": body.get("note")})
    if not awarded:
        # Either already held or membership requirement missing
        existing = await db.user_badges.find_one({"user_id": user_id, "badge_code": code})
        if existing:
            return {"ok": True, "already_awarded": True}
        raise HTTPException(400, "Vergabe nicht möglich (z. B. Mitgliedschaft erforderlich).")
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "badge.manual_award",
        "actor_id": me["id"],
        "target_id": user_id,
        "data": {"code": code, "note": body.get("note")},
        "created_at": now_utc().isoformat(),
    })
    return {"ok": True, "newly_awarded": True}


@router.delete("/admin/revoke")
async def admin_revoke(body: dict, me: dict = Depends(require_admin())):
    user_id = body.get("user_id")
    code = body.get("code")
    if not user_id or not code:
        raise HTTPException(400, "user_id und code erforderlich.")
    db = get_db()
    res = await db.user_badges.delete_one({"user_id": user_id, "badge_code": code})
    if res.deleted_count == 0:
        raise HTTPException(404, "Badge nicht vergeben.")
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "badge.manual_revoke",
        "actor_id": me["id"],
        "target_id": user_id,
        "data": {"code": code},
        "created_at": now_utc().isoformat(),
    })
    return {"ok": True}
