"""User profile + admin user management routes."""
import os
import secrets
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_current_user, require_admin, require_super, hash_password, hash_token
from email_service import send_template
from services.membership_service import get_membership, derived_user_type, is_active_member
from models import AdminUserCreate, UserUpdate, RoleUpdate, UserSocialCreate, UserSocialUpdate, now_utc, new_id

router = APIRouter(prefix="/api/users", tags=["users"])


def _clean(u: dict) -> dict:
    u.pop("_id", None)
    u.pop("password_hash", None)
    return u


def _achievement_level(points: int) -> dict:
    points = max(int(points or 0), 0)
    # Gentle curve: first levels come fast, later levels need visible commitment.
    level = 1
    while points >= (level * level * 100):
        level += 1
    current_floor = (level - 1) * (level - 1) * 100
    next_floor = level * level * 100
    span = max(next_floor - current_floor, 1)
    progress = round(((points - current_floor) / span) * 100)
    return {
        "level": level,
        "points": points,
        "current_level_points": current_floor,
        "next_level_points": next_floor,
        "progress": max(0, min(progress, 100)),
        "title": f"Level {level}",
    }


USER_NULLABLE_FIELDS = {
    "display_name", "avatar_url", "banner_url", "bio", "first_name", "last_name",
    "nickname", "birth_date", "country", "state", "city", "favorite_games",
    "main_platform", "main_platforms", "preferred_role", "input_device",
    "input_devices", "gaming_subscriptions", "website", "discord_name",
    "discord_id", "switch_code", "steam_id", "epic_id", "psn_id", "xbox_id",
    "riot_id", "twitch_handle", "youtube_handle", "tiktok_handle",
    "instagram_handle", "x_handle", "nintendo_fc", "ea_id", "battlenet_id",
    "profile_visibility",
}


async def _attach_membership(user: dict) -> dict:
    """Annotate user dict with current membership info."""
    if not user:
        return user
    m = await get_membership(user["id"])
    user["membership"] = m
    user["is_club_member"] = is_active_member(m)
    user["user_type"] = derived_user_type(user, m)
    return user


async def _frontend_base_url() -> str:
    db = get_db()
    frontend = os.environ.get("FRONTEND_URL", "").strip().rstrip("/")
    if frontend:
        return frontend
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    domain = (branding.get("domain") or "").strip().rstrip("/")
    if not domain:
        return ""
    if not domain.startswith(("http://", "https://")):
        domain = "https://" + domain
    return domain


async def _create_invite_token(user_id: str) -> tuple[str, str]:
    db = get_db()
    token = secrets.token_urlsafe(32)
    await db.password_reset_tokens.insert_one({
        "id": new_id(),
        "token_hash": hash_token(token),
        "user_id": user_id,
        "purpose": "admin_invite",
        "used": False,
        "created_at": now_utc().isoformat(),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })
    base = await _frontend_base_url()
    return token, f"{base}/reset-password?token={token}&invite=1" if base else f"/reset-password?token={token}&invite=1"


async def _send_user_invite(user: dict, actor: dict) -> dict:
    token, invite_url = await _create_invite_token(user["id"])
    result = await send_template(
        "user_invite",
        user["email"],
        display_name=user.get("display_name") or user.get("username"),
        invite_url=invite_url,
        invited_by=actor.get("display_name") or actor.get("username") or actor.get("email") or "",
        dedupe_key=f"user_invite:{user['id']}:{token[:10]}",
        mail_meta={
            "kind": "user_invite",
            "user_id": user["id"],
            "username": user.get("username"),
            "display_name": user.get("display_name"),
            "invited_by": actor.get("id"),
        },
    )
    return {"invite_url": invite_url, "invite_email": result}


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


@router.post("")
async def admin_create_user(body: AdminUserCreate, me: dict = Depends(require_super())):
    db = get_db()
    username = body.username.strip()
    email = str(body.email).lower().strip()
    if await db.users.find_one({"$or": [{"username": username}, {"email": email}]}):
        raise HTTPException(status_code=409, detail="Username oder E-Mail bereits vergeben")
    user_id = new_id()
    manual_password = (body.password or "").strip()
    if not body.send_invite and len(manual_password) < 6:
        raise HTTPException(status_code=422, detail="Passwort muss mindestens 6 Zeichen haben, wenn keine Einladung gesendet wird.")
    password_setup_required = bool(body.send_invite)
    doc = {
        "id": user_id,
        "username": username,
        "email": email,
        "password_hash": "!pending_invite" if password_setup_required else hash_password(manual_password),
        "display_name": body.display_name or username,
        "role": body.role,
        "roles": [body.role],
        "user_type": "community_user",
        "is_active": body.is_active,
        "is_banned": False,
        "password_setup_required": password_setup_required,
        "invited_at": now_utc().isoformat() if password_setup_required else None,
        "privacy_public_profile": body.privacy_public_profile,
        "accepted_privacy": True,
        "accepted_terms": True,
        "newsletter_consent": False,
        "favorite_games": [],
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
        "created_by": me["id"],
    }
    await db.users.insert_one(doc)
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "user.create",
        "target_id": user_id,
        "actor_id": me["id"],
        "created_at": now_utc().isoformat(),
    })
    response = _clean(doc)
    if password_setup_required:
        invite = await _send_user_invite(doc, me)
        response.update(invite)
        await db.audit_logs.insert_one({
            "id": new_id(),
            "action": "user.invite",
            "target_id": user_id,
            "actor_id": me["id"],
            "created_at": now_utc().isoformat(),
        })
    return response


@router.post("/{user_id}/invite")
async def resend_user_invite(user_id: str, me: dict = Depends(require_super())):
    db = get_db()
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    invite = await _send_user_invite(user, me)
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"password_setup_required": True, "invited_at": now_utc().isoformat(), "updated_at": now_utc().isoformat()}},
    )
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "user.invite",
        "target_id": user_id,
        "actor_id": me["id"],
        "created_at": now_utc().isoformat(),
    })
    return {"ok": True, **invite}


@router.get("/public-list")
async def list_public_users():
    """Public listing of all users with public profile (community + members).

    Phase C: enriches each user with `profile_completeness`, `achievements_count`
    and `top_achievement` (highest tier earned, ignoring negatives).
    """
    db = get_db()
    users = await db.users.find(
        {"privacy_public_profile": True, "is_active": True, "is_banned": {"$ne": True}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(2000)
    if not users:
        return []
    user_ids = [u["id"] for u in users]
    # Memberships for is_club_member flag
    memberships = {m["user_id"]: m for m in await db.memberships.find(
        {"user_id": {"$in": user_ids}}, {"_id": 0}).to_list(2000)}
    # Achievements (excl. negative groups)
    neg_codes = [g["code"] async for g in db.achievement_groups.find(
        {"is_negative": True}, {"_id": 0, "code": 1})]
    awards = await db.user_achievements.find(
        {"user_id": {"$in": user_ids}, "group_code": {"$nin": neg_codes}},
        {"_id": 0}).to_list(20000)
    by_user: dict[str, list] = {}
    for a in awards:
        by_user.setdefault(a["user_id"], []).append(a)
    # Resolve tier metadata once
    tier_codes = list({a["tier_code"] for a in awards})
    tiers = {t["code"]: t for t in await db.achievements.find(
        {"code": {"$in": tier_codes}}, {"_id": 0}).to_list(2000)} if tier_codes else {}

    from badges import compute_profile_completeness, _level_name, _color_for_level

    out = []
    for u in users:
        score = compute_profile_completeness(u)
        ua = by_user.get(u["id"], [])
        top = None
        if ua:
            ua_sorted = sorted(ua, key=lambda a: (a.get("level", 0), tiers.get(a["tier_code"], {}).get("points", 0)), reverse=True)
            t = tiers.get(ua_sorted[0]["tier_code"])
            if t:
                top = {
                    "code": t["code"],
                    "name": t["name"],
                    "level": t["level"],
                    "level_name": _level_name(t["level"]),
                    "level_color": _color_for_level(t["level"]),
                    "points": t.get("points", 0),
                    "icon": t.get("icon"),
                }
        total_points = sum(tiers.get(a["tier_code"], {}).get("points", 0) for a in ua)
        out.append({
            "id": u["id"], "username": u["username"], "display_name": u.get("display_name"),
            "avatar_url": u.get("avatar_url"), "country": u.get("country"),
            "favorite_games": u.get("favorite_games"),
            "is_club_member": is_active_member(memberships.get(u["id"])),
            "user_type": derived_user_type(u, memberships.get(u["id"])),
            "created_at": u.get("created_at"),
            "profile_completeness": score,
            "achievements_count": len(ua),
            "top_achievement": top,
            "achievement_level": _achievement_level(total_points),
        })
    return out


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
        "id": u["id"],
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
    # Achievements v4 (group-aware) — flat list of awarded tiers
    user_id = u["id"]
    ua = await db.user_achievements.find({"user_id": user_id}, {"_id": 0})\
        .sort("earned_at", -1).to_list(500)
    tier_map = {t["code"]: t async for t in db.achievements.find({}, {"_id": 0})}
    group_map = {g["code"]: g async for g in db.achievement_groups.find({}, {"_id": 0})}
    badges = []
    for a in ua:
        t = tier_map.get(a["tier_code"])
        g = group_map.get(a.get("group_code")) if a.get("group_code") else None
        if not t:
            continue
        is_negative = bool(g and g.get("is_negative"))
        badges.append({
            **t,
            "description": "Geheimes Fun-/Negative-Achievement freigeschaltet." if is_negative else t.get("description"),
            "condition_key": None if is_negative else t.get("condition_key"),
            "progress_target": None if is_negative else t.get("progress_target"),
            "is_negative": is_negative,
            "secret": is_negative,
            "earned_at": a["earned_at"],
            "group_name": g["name"] if g else None,
            "group_category": g.get("category") if g else None,
            "group_accent": g.get("accent_color") if g else None,
        })
    total_points = sum(b.get("points", 0) for b in badges if not b.get("is_negative"))
    achievement_level = _achievement_level(total_points)
    # Tournament participation (only if public)
    tournaments = []
    f1_bests = []
    teams = []
    stats = {"tournaments": 0, "wins": 0, "top3": 0, "matches_played": 0, "matches_won": 0,
             "fast_laps": 0, "pole_positions": 0, "badges": len(badges), "points": total_points,
             "level": achievement_level["level"]}
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
        teams = await db.teams.find(
            {"$or": [{"id": {"$in": team_ids}}, {"member_ids": user_id}]},
            {"_id": 0},
        ).to_list(50)
    return {
        **base,
        "badges": badges,
        "stats": stats,
        "achievement_level": achievement_level,
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


@router.put("/me")
@router.patch("/me")
async def update_me(body: UserUpdate, me: dict = Depends(get_current_user)):
    db = get_db()
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in USER_NULLABLE_FIELDS}
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


@router.put("/me/socials/{social_id}")
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


@router.put("/{user_id}")
@router.patch("/{user_id}")
async def admin_update_user(user_id: str, body: UserUpdate,
                             me: dict = Depends(require_admin())):
    db = get_db()
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in USER_NULLABLE_FIELDS}
    updates["updated_at"] = now_utc().isoformat()
    await db.users.update_one({"id": user_id}, {"$set": updates})
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return u


@router.post("/{user_id}/ban")
async def ban_user(user_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.users.update_one({"id": user_id}, {"$set": {"is_banned": True, "updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "user.ban", "target_id": user_id,
                                     "actor_id": me["id"], "created_at": now_utc().isoformat()})
    return {"ok": True}


@router.post("/{user_id}/unban")
async def unban_user(user_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.users.update_one({"id": user_id}, {"$set": {"is_banned": False, "updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "user.unban", "target_id": user_id,
                                     "actor_id": me["id"], "created_at": now_utc().isoformat()})
    return {"ok": True}


@router.put("/{user_id}/role")
@router.post("/{user_id}/role")
async def set_role(user_id: str, body: RoleUpdate, me: dict = Depends(require_super())):
    db = get_db()
    await db.users.update_one({"id": user_id}, {"$set": {"role": body.role, "updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "user.role_change", "target_id": user_id,
                                     "actor_id": me["id"], "data": {"role": body.role},
                                     "created_at": now_utc().isoformat()})
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return u


@router.delete("/{user_id}")
async def delete_user(user_id: str, me: dict = Depends(require_super())):
    db = get_db()
    if user_id == me["id"]:
        raise HTTPException(status_code=400, detail="Du kannst deinen eigenen Benutzer nicht löschen")
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    regs = await db.tournament_registrations.find({"user_id": user_id}, {"_id": 0, "id": 1}).to_list(1000)
    reg_ids = [r["id"] for r in regs if r.get("id")]
    await db.users.delete_one({"id": user_id})
    await db.refresh_tokens.delete_many({"user_id": user_id})
    await db.login_attempts.delete_many({"identifier": user.get("email")})
    await db.memberships.delete_many({"user_id": user_id})
    await db.user_socials.delete_many({"user_id": user_id})
    await db.user_achievements.delete_many({"user_id": user_id})
    await db.tournament_registrations.delete_many({"user_id": user_id})
    if reg_ids:
        for field in ("participant_a_id", "participant_b_id", "winner_id", "loser_id"):
            await db.matches.update_many(
                {field: {"$in": reg_ids}},
                {"$set": {field: None, "status": "waiting_result", "updated_at": now_utc().isoformat()}},
            )
    await db.f1_lap_times.delete_many({"user_id": user_id})
    await db.team_members.delete_many({"user_id": user_id})
    await db.teams.update_many({}, {"$pull": {"member_ids": user_id, "co_leader_ids": user_id}})
    await db.teams.update_many({"leader_id": user_id}, {"$set": {"leader_id": None, "updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "user.delete",
        "target_id": user_id,
        "actor_id": me["id"],
        "data": {"email": user.get("email"), "username": user.get("username")},
        "created_at": now_utc().isoformat(),
    })
    return {"ok": True}
