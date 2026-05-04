"""User profile + admin user management routes."""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_current_user, require_admin, require_super
from services.membership_service import get_membership, derived_user_type, is_active_member
from models import UserUpdate, RoleUpdate, UserSocialCreate, UserSocialUpdate, now_utc, new_id

router = APIRouter(prefix="/api/users", tags=["users"])


def _clean(u: dict) -> dict:
    u.pop("_id", None)
    u.pop("password_hash", None)
    return u


async def _attach_membership(user: dict) -> dict:
    """Annotate user dict with current membership info."""
    if not user:
        return user
    m = await get_membership(user["id"])
    user["membership"] = m
    user["is_club_member"] = is_active_member(m)
    user["user_type"] = derived_user_type(user, m)
    return user


@router.get("")
async def list_users(q: str | None = None, role: str | None = None,
                     user_type: str | None = None,
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
    if user_type:
        query["user_type"] = user_type
    users = await db.users.find(query, {"password_hash": 0, "_id": 0}).to_list(500)
    # Bulk fetch memberships
    user_ids = [u["id"] for u in users]
    members = {
        m["user_id"]: m for m in await db.memberships.find(
            {"user_id": {"$in": user_ids}}, {"_id": 0}
        ).to_list(2000)
    }
    for u in users:
        m = members.get(u["id"])
        u["membership"] = m
        u["is_club_member"] = is_active_member(m)
        u["user_type"] = derived_user_type(u, m)
    return users


@router.get("/public-list")
async def list_public_users():
    """Public listing of all users with public profile (community + members)."""
    db = get_db()
    users = await db.users.find(
        {"privacy_public_profile": True, "is_active": True, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1,
         "country": 1, "favorite_games": 1, "is_club_member": 1, "user_type": 1,
         "created_at": 1},
    ).sort("created_at", -1).to_list(2000)
    return users


@router.get("/public/{username}")
async def get_public_profile(username: str):
    db = get_db()
    u = await db.users.find_one({"username": username}, {"_id": 0, "password_hash": 0, "email": 0})
    if not u:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    public = bool(u.get("privacy_public_profile"))
    # Membership data
    membership = await db.memberships.find_one({"user_id": u["id"]}, {"_id": 0})
    is_member = bool(membership and membership.get("member_status") in ("active", "honorary"))
    public_member = None
    if is_member:
        public_member = {
            "membership_type": membership.get("membership_type"),
            "member_since": membership.get("member_since"),
            "internal_role": membership.get("internal_role"),
            "member_number": membership.get("member_number") if membership.get("show_member_number_publicly") else None,
        }
    # Base profile (always visible)
    base = {
        "username": u["username"], "display_name": u.get("display_name"),
        "avatar_url": u.get("avatar_url"), "banner_url": u.get("banner_url"),
        "bio": u.get("bio") if public else None,
        "role": u.get("role"), "created_at": u.get("created_at"),
        "country": u.get("country") if public else None,
        "city": u.get("city") if public else None,
        "discord_name": u.get("discord_name") if public else None,
        "twitch_handle": u.get("twitch_handle") if public else None,
        "youtube_handle": u.get("youtube_handle") if public else None,
        "instagram_handle": u.get("instagram_handle") if public else None,
        "x_handle": u.get("x_handle") if public else None,
        "main_platform": u.get("main_platform") if public else None,
        "main_platforms": u.get("main_platforms") or [],
        "input_devices": u.get("input_devices") or [],
        "gaming_subscriptions": u.get("gaming_subscriptions") if public else None,
        "favorite_games": u.get("favorite_games") or [],
        "website": u.get("website") if public else None,
        "show_twitch_embed": bool(u.get("show_twitch_embed")) if public else False,
        "privacy_public_profile": public,
        "is_club_member": is_member,
        "user_type": "club_member" if is_member else "community_user",
        "membership": public_member,
    }
    # Public socials (separately stored UserSocial entries with visibility=public)
    socials = await db.user_socials.find(
        {"user_id": u["id"], "visibility": "public"},
        {"_id": 0, "platform": 1, "value": 1, "url": 1},
    ).to_list(50)
    # Badges (always visible – they're achievements)
    user_id = u["id"]
    ub = await db.user_badges.find({"user_id": user_id}, {"_id": 0})\
        .sort("earned_at", -1).to_list(200)
    catalog = {b["code"]: b async for b in db.badges.find({}, {"_id": 0})}
    badges = []
    for b in ub:
        meta = catalog.get(b["badge_code"])
        if meta:
            badges.append({**meta, "earned_at": b["earned_at"], "context": b.get("context", {})})
    total_points = sum(b.get("points", 0) for b in badges)
    # Tournament participation (only if public)
    tournaments = []
    f1_bests = []
    teams = []
    stats = {"tournaments": 0, "wins": 0, "top3": 0, "matches_played": 0, "matches_won": 0,
             "fast_laps": 0, "pole_positions": 0, "badges": len(badges), "points": total_points}
    if public:
        regs = await db.tournament_registrations.find({"user_id": user_id}, {"_id": 0}).to_list(200)
        t_ids = list({r["tournament_id"] for r in regs})
        t_map = {t["id"]: t for t in await db.tournaments.find(
            {"id": {"$in": t_ids}}, {"_id": 0, "title": 1, "slug": 1, "game_id": 1, "format": 1,
             "status": 1, "start_date": 1, "id": 1}).to_list(200)}
        game_ids = list({t.get("game_id") for t in t_map.values() if t.get("game_id")})
        g_map = {g["id"]: g for g in await db.games.find(
            {"id": {"$in": game_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1}).to_list(200)}
        for r in regs:
            t = t_map.get(r["tournament_id"])
            if not t:
                continue
            final_pos = r.get("final_position")
            tournaments.append({
                "id": t["id"], "slug": t.get("slug"), "title": t.get("title"),
                "status": t.get("status"), "start_date": t.get("start_date"),
                "game": g_map.get(t.get("game_id")),
                "final_position": final_pos, "registration_status": r.get("status"),
            })
            stats["tournaments"] += 1
            if final_pos == 1:
                stats["wins"] += 1
            if final_pos and final_pos <= 3:
                stats["top3"] += 1
        # Match stats — look up by registration_id
        reg_ids = [r["id"] for r in regs]
        matches = await db.matches.find(
            {"$or": [{"participant_a_id": {"$in": reg_ids}},
                     {"participant_b_id": {"$in": reg_ids}}],
             "status": "completed"}, {"_id": 0}).to_list(500)
        for m in matches:
            stats["matches_played"] += 1
            if m.get("winner_id") in reg_ids:
                stats["matches_won"] += 1
        # F1 / Fast Lap
        from routes.f1_routes import _ms_to_time_str
        lap_count = await db.f1_lap_times.count_documents(
            {"user_id": user_id, "is_invalid": {"$ne": True}})
        stats["fast_laps"] = lap_count
        # Per track best
        all_laps = await db.f1_lap_times.find(
            {"user_id": user_id, "is_invalid": {"$ne": True}},
            {"_id": 0, "track_id": 1, "challenge_id": 1, "time_ms": 1,
             "penalty_seconds": 1, "created_at": 1}).to_list(2000)
        best_per_track = {}
        for lap in all_laps:
            eff = lap["time_ms"] + int(lap.get("penalty_seconds", 0) * 1000)
            k = lap["track_id"]
            if k not in best_per_track or eff < best_per_track[k]["time_ms"]:
                best_per_track[k] = {"time_ms": eff, "challenge_id": lap["challenge_id"]}
        c_ids_f1 = list({v["challenge_id"] for v in best_per_track.values()})
        track_docs = {t["id"]: t for t in await db.f1_tracks.find(
            {"id": {"$in": list(best_per_track.keys())}},
            {"_id": 0, "id": 1, "name": 1, "country": 1}).to_list(200)}
        chall_docs = {c["id"]: c for c in await db.f1_challenges.find(
            {"id": {"$in": c_ids_f1}}, {"_id": 0, "id": 1, "title": 1, "slug": 1}).to_list(200)}
        for tid, entry in best_per_track.items():
            tr = track_docs.get(tid)
            ch = chall_docs.get(entry["challenge_id"])
            if tr:
                # Check if this user is currently P1 on this track
                better = await db.f1_lap_times.count_documents({
                    "track_id": tid, "is_invalid": {"$ne": True},
                    "user_id": {"$ne": user_id},
                })
                # Count how many distinct users beat this time on this track
                is_p1 = True
                other_best = await db.f1_lap_times.find(
                    {"track_id": tid, "is_invalid": {"$ne": True}, "user_id": {"$ne": user_id}},
                    {"_id": 0, "user_id": 1, "time_ms": 1, "penalty_seconds": 1}).to_list(5000)
                for ol in other_best:
                    oeff = ol["time_ms"] + int(ol.get("penalty_seconds", 0) * 1000)
                    if oeff < entry["time_ms"]:
                        is_p1 = False
                        break
                if is_p1:
                    stats["pole_positions"] += 1
                f1_bests.append({
                    "track": tr, "challenge": ch,
                    "time_ms": entry["time_ms"],
                    "time_str": _ms_to_time_str(entry["time_ms"]),
                    "is_leader": is_p1,
                })
        f1_bests.sort(key=lambda x: x["time_ms"])
        # Teams
        team_ids = [tm["team_id"] for tm in await db.team_members.find(
            {"user_id": user_id}, {"_id": 0}).to_list(50)]
        teams = await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0}).to_list(50)
    return {
        **base,
        "badges": badges,
        "stats": stats,
        "tournaments": tournaments,
        "f1_bests": f1_bests,
        "teams": teams,
        "socials": socials,
    }


@router.get("/{user_id}")
async def get_user(user_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    # Hide email for non-admins if not own
    if me["id"] != user_id and me["role"] not in ("moderator", "tournament_admin", "club_admin", "superadmin"):
        u.pop("email", None)
    await _attach_membership(u)
    return u


@router.patch("/me")
async def update_me(body: UserUpdate, me: dict = Depends(get_current_user)):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        await _attach_membership(me)
        return me
    updates["updated_at"] = now_utc().isoformat()
    await db.users.update_one({"id": me["id"]}, {"$set": updates})
    u = await db.users.find_one({"id": me["id"]}, {"_id": 0, "password_hash": 0})
    await _attach_membership(u)
    return u


# ---------- User socials ----------
@router.get("/me/socials")
async def list_my_socials(me: dict = Depends(get_current_user)):
    db = get_db()
    rows = await db.user_socials.find({"user_id": me["id"]}, {"_id": 0}).to_list(50)
    return rows


@router.post("/me/socials")
async def add_my_social(body: UserSocialCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    existing = await db.user_socials.find_one({"user_id": me["id"], "platform": body.platform})
    if existing:
        raise HTTPException(409, "Plattform bereits verknüpft.")
    doc = {
        "id": new_id(), "user_id": me["id"],
        **body.model_dump(),
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.user_socials.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/me/socials/{social_id}")
async def update_my_social(social_id: str, body: UserSocialUpdate, me: dict = Depends(get_current_user)):
    db = get_db()
    update = body.model_dump(exclude_unset=True)
    update["updated_at"] = now_utc().isoformat()
    res = await db.user_socials.update_one({"id": social_id, "user_id": me["id"]}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Eintrag nicht gefunden.")
    return await db.user_socials.find_one({"id": social_id}, {"_id": 0})


@router.delete("/me/socials/{social_id}")
async def delete_my_social(social_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    res = await db.user_socials.delete_one({"id": social_id, "user_id": me["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Eintrag nicht gefunden.")
    return {"ok": True}


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
