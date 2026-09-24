"""User profile + admin user management routes."""
import os
import secrets
import re
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_current_user, get_optional_user, require_club_admin, require_super, hash_token, require_area
from email_service import send_template
from services.competition_privacy import registration_match_snapshot
from services.competition_standings import registration_match_summary
from services.membership_service import get_membership, derived_user_type, is_active_member
from services.profile_references import empty_profile_references, personal_profile_references
from services.visibility import user_can_see
from services.notification_preferences import (
    DELIVERY_CHANNEL_PREFERENCES,
    OPTIONAL_EMAIL_PREFERENCES,
    preference_key,
    public_preferences_payload,
)
from services.query_filters import safe_regex
from models import (
    AreasUpdate,
    AdminUserCreate, UserUpdate, RoleUpdate, UserSocialCreate, UserSocialUpdate,
    now_utc, new_id,
)

router = APIRouter(prefix="/api/users", tags=["users"])

PRIVATE_AUTH_FIELDS = {
    "_id": 0,
    "password_hash": 0,
    "google_id": 0,
    "mfa_secret": 0,
    "mfa_pending_secret": 0,
    "mfa_pending_created_at": 0,
    "mfa_recovery_code_hashes": 0,
}


def _clean(u: dict) -> dict:
    for field in ("_id", "password_hash", "google_id", "mfa_secret", "mfa_pending_secret", "mfa_pending_created_at", "mfa_recovery_code_hashes"):
        u.pop(field, None)
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
    title = _achievement_level_title(level)
    return {
        "level": level,
        "points": points,
        "current_level_points": current_floor,
        "next_level_points": next_floor,
        "progress": max(0, min(progress, 100)),
        "title": title,
    }


def _achievement_level_title(level: int) -> str:
    if level >= 20:
        return "Legendär"
    if level >= 16:
        return "Champion"
    if level >= 12:
        return "Elite"
    if level >= 8:
        return "Veteran"
    if level >= 5:
        return "Pro"
    if level >= 3:
        return "Challenger"
    return "Rookie"


USER_NULLABLE_FIELDS = {
    "display_name", "avatar_url", "banner_url", "bio", "first_name", "last_name",
    "nickname", "birth_date", "gender", "country", "state", "city", "favorite_games",
    "main_platform", "main_platforms", "preferred_role", "input_device",
    "input_devices", "gaming_subscriptions", "website", "game_ids", "discord_name",
    "discord_id", "switch_code", "steam_id", "epic_id", "psn_id", "xbox_id",
    "riot_id", "twitch_handle", "youtube_handle", "tiktok_handle",
    "instagram_handle", "x_handle", "nintendo_fc", "ea_id", "battlenet_id",
    "faceit_handle", "startgg_handle", "roblox_handle", "osu_handle", "lichess_handle", "github_handle", "kick_handle", "reddit_handle", "spotify_handle",
    "threads_handle", "facebook_handle", "linkedin_handle", "snapchat_handle", "pinterest_handle", "telegram_handle", "wargaming_handle", "bungie_handle",
    "profile_visibility", "dm_privacy",
}


def _visibility_aliases(key: str) -> list[str]:
    source_key = {
        "discord": "discord_name",
        "twitch": "twitch_handle",
        "youtube": "youtube_handle",
        "instagram": "instagram_handle",
        "x": "x_handle",
        "steam": "steam_id",
        "epic": "epic_id",
        "psn": "psn_id",
        "xbox": "xbox_id",
        "nintendo": "nintendo_fc",
        "ea": "ea_id",
        "riot": "riot_id",
        "battlenet": "battlenet_id",
        "faceit": "faceit_handle",
        "startgg": "startgg_handle",
        "roblox": "roblox_handle",
        "osu": "osu_handle",
        "lichess": "lichess_handle",
        "github": "github_handle",
        "kick": "kick_handle",
        "reddit": "reddit_handle",
        "spotify": "spotify_handle",
        "threads": "threads_handle",
        "facebook": "facebook_handle",
        "linkedin": "linkedin_handle",
        "snapchat": "snapchat_handle",
        "pinterest": "pinterest_handle",
        "telegram": "telegram_handle",
        "wargaming": "wargaming_handle",
        "bungie": "bungie_handle",
    }.get(key, key)
    aliases = [key, source_key]
    if key == "birth_date":
        aliases += ["birthdate", "birthday"]
    return list(dict.fromkeys(aliases))


async def _viewer_context(db, viewer: dict | None, target_id: str) -> dict:
    """Wer da schaut - für die Stufen „Community“ (eingeloggt), „Verein“ (Mitglied oder Admin-Team),
    „Nur Admins“ (Admin-Team) und „Privat“ (nur die Person selbst). Einmal je Aufruf berechnet."""
    if not viewer:
        return {"self": False, "logged_in": False, "member": False, "admin": False}
    from services.membership_service import get_membership, is_active_member
    from services.permissions import areas_for
    from services.visibility import ADMIN_ROLES
    areas = await areas_for(viewer)
    admin = viewer.get("role") in ADMIN_ROLES or any(area in areas for area in ("tournaments", "content", "club", "finance", "system", "moderation"))
    member = bool(viewer.get("is_club_member")) or is_active_member(await get_membership(viewer["id"]))
    return {"self": viewer.get("id") == target_id, "logged_in": True, "member": member or admin, "admin": admin}


def _field_visible(user: dict, key: str, profile_public: bool, ctx: dict | None = None) -> bool:
    """Die Stufe eines Felds gegen den Betrachter: public → alle, community → eingeloggt, members →
    Vereinsmitglieder und Admin-Team, admins → Admin-Team, private → nur die Person selbst."""
    if key in (ctx or {}).get("off", ()):
        return False   # vom Verein abgehakt (#558): erscheint nirgends, auch nicht der Person selbst
    if not profile_public:
        return False
    ctx = ctx or {}
    if ctx.get("self"):
        return True
    visibility_map = user.get("profile_visibility") or {}
    visibility = next((visibility_map[a] for a in _visibility_aliases(key) if a in visibility_map), "public")
    if visibility == "public":
        return True
    if visibility == "community":
        return bool(ctx.get("logged_in"))
    if visibility == "members":
        return bool(ctx.get("member"))
    if visibility == "admins":
        return bool(ctx.get("admin"))
    return False


def _visible_field(user: dict, key: str, profile_public: bool, ctx: dict | None = None):
    if not _field_visible(user, key, profile_public, ctx):
        return None
    source_key = {
        "discord": "discord_name",
        "twitch": "twitch_handle",
        "youtube": "youtube_handle",
        "instagram": "instagram_handle",
        "x": "x_handle",
        "steam": "steam_id",
        "epic": "epic_id",
        "psn": "psn_id",
        "xbox": "xbox_id",
        "nintendo": "nintendo_fc",
        "ea": "ea_id",
        "riot": "riot_id",
        "battlenet": "battlenet_id",
        "faceit": "faceit_handle",
        "startgg": "startgg_handle",
        "roblox": "roblox_handle",
        "osu": "osu_handle",
        "lichess": "lichess_handle",
        "github": "github_handle",
        "kick": "kick_handle",
        "reddit": "reddit_handle",
        "spotify": "spotify_handle",
        "threads": "threads_handle",
        "facebook": "facebook_handle",
        "linkedin": "linkedin_handle",
        "snapchat": "snapchat_handle",
        "pinterest": "pinterest_handle",
        "telegram": "telegram_handle",
        "wargaming": "wargaming_handle",
        "bungie": "bungie_handle",
    }.get(key, key)
    return user.get(source_key)


def _normalize_twitch_handle(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    raw = raw.replace("\\", "/")
    if raw.startswith("@"):
        raw = raw[1:]
    parsed = urlparse(raw if raw.startswith(("http://", "https://")) else f"https://{raw}")
    host = (parsed.netloc or "").lower()
    if host in {"twitch.tv", "www.twitch.tv", "m.twitch.tv"}:
        parts = [p for p in parsed.path.split("/") if p]
        raw = parts[0] if parts else ""
    raw = raw.strip().lstrip("@").split("?")[0].split("#")[0]
    raw = re.sub(r"[^A-Za-z0-9_]", "", raw)
    return raw.lower()[:25] or None


def _normalize_social_updates(updates: dict) -> dict:
    if "twitch_handle" in updates:
        updates["twitch_handle"] = _normalize_twitch_handle(updates.get("twitch_handle"))
    return updates


def _normalize_notification_preferences(value) -> dict:
    if not isinstance(value, dict):
        return {}
    allowed = set(OPTIONAL_EMAIL_PREFERENCES) | set(DELIVERY_CHANNEL_PREFERENCES)
    allowed |= {
        preference_key(channel, topic)
        for channel in DELIVERY_CHANNEL_PREFERENCES
        for topic in OPTIONAL_EMAIL_PREFERENCES
    }
    return {key: bool(value[key]) for key in allowed if key in value}


async def _is_public_tournament(tournament: dict | None) -> bool:
    if not tournament:
        return False
    if tournament.get("status") == "draft" or tournament.get("is_public") is False:
        return False
    return await user_can_see(None, tournament.get("visibility") or "public")


async def _is_public_challenge(challenge: dict | None) -> bool:
    if not challenge:
        return False
    if challenge.get("status") == "draft":
        return False
    return await user_can_see(None, challenge.get("visibility") or "public")


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
                     user: dict = Depends(require_area("club"))):
    db = get_db()
    query = {}
    if q:
        pattern = safe_regex(q)
        query["$or"] = [
            {"username": {"$regex": pattern, "$options": "i"}},
            {"email": {"$regex": pattern, "$options": "i"}},
            {"display_name": {"$regex": pattern, "$options": "i"}},
        ]
    if role:
        query["role"] = role
    if user_type:
        query["user_type"] = user_type
    users = await db.users.find(query, PRIVATE_AUTH_FIELDS).to_list(500)
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


@router.get("/mention-search")
async def mention_search(
    q: str | None = None,
    scope: str | None = None,
    scope_id: str | None = None,
    me: dict = Depends(get_current_user),
):
    db = get_db()
    needle = (q or "").strip().lstrip("@")
    if len(needle) < 1:
        return []

    query: dict = {"is_active": True, "is_banned": {"$ne": True}}
    scope_key = (scope or "").strip().lower()
    staff = me.get("role") in ("moderator", "tournament_admin", "club_admin", "superadmin")

    if scope_key == "team":
        team = await db.teams.find_one({"id": scope_id}, {"_id": 0, "member_ids": 1, "leader_id": 1, "co_leader_ids": 1})
        if not team:
            raise HTTPException(status_code=404, detail="Team nicht gefunden")
        member_ids = team.get("member_ids") or []
        can_see = staff or me["id"] in member_ids or team.get("leader_id") == me["id"] or me["id"] in (team.get("co_leader_ids") or [])
        if not can_see:
            raise HTTPException(status_code=403, detail="Keine Berechtigung")
        query["id"] = {"$in": member_ids}
    elif scope_key == "tournament":
        tournament = await db.tournaments.find_one({"id": scope_id}, {"_id": 0, "id": 1})
        if not tournament:
            raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
        regs = await db.tournament_registrations.find(
            {"tournament_id": scope_id, "status": {"$in": ["approved", "checked_in"]}},
            {"_id": 0, "user_id": 1, "team_id": 1},
        ).to_list(1000)
        reg_user_ids = {row.get("user_id") for row in regs if row.get("user_id")}
        reg_team_ids = {row.get("team_id") for row in regs if row.get("team_id")}
        team_member_ids: set[str] = set()
        if reg_team_ids:
            team_rows = await db.teams.find(
                {"id": {"$in": list(reg_team_ids)}},
                {"_id": 0, "member_ids": 1},
            ).to_list(500)
            for team_row in team_rows:
                team_member_ids.update(team_row.get("member_ids") or [])
        staff_rows = await db.tournament_staff_assignments.find(
            {"tournament_id": scope_id, "is_active": {"$ne": False}},
            {"_id": 0, "user_id": 1},
        ).to_list(500)
        tournament_user_ids = reg_user_ids | team_member_ids | {row.get("user_id") for row in staff_rows if row.get("user_id")}
        if not staff and me["id"] not in tournament_user_ids:
            raise HTTPException(status_code=403, detail="Keine Berechtigung")
        query["id"] = {"$in": list(tournament_user_ids)}
    elif not staff:
        query["privacy_public_profile"] = True

    escaped = re.escape(needle)
    query["$or"] = [
        {"username": {"$regex": escaped, "$options": "i"}},
        {"display_name": {"$regex": escaped, "$options": "i"}},
    ]
    users = await db.users.find(
        query,
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    ).sort("username", 1).to_list(12)
    return users


@router.post("")
async def admin_create_user(body: AdminUserCreate, me: dict = Depends(require_super())):
    db = get_db()
    if not body.send_invite:
        raise HTTPException(422, "Administrativ angelegte Konten müssen per E-Mail eingeladen werden, damit die Person selbst Passwort und Einwilligungen festlegt.")
    username = body.username.strip()
    email = str(body.email).lower().strip()
    if await db.users.find_one({"$or": [{"username": username}, {"email": email}]}):
        raise HTTPException(status_code=409, detail="Username oder E-Mail bereits vergeben")
    user_id = new_id()
    password_setup_required = True
    doc = {
        "id": user_id,
        "username": username,
        "email": email,
        "password_hash": "!pending_invite",
        "display_name": body.display_name or username,
        "gender": body.gender,
        "role": body.role,
        "roles": [body.role],
        "user_type": "community_user",
        "is_active": body.is_active,
        "is_banned": False,
        "password_setup_required": password_setup_required,
        "invited_at": now_utc().isoformat() if password_setup_required else None,
        "privacy_public_profile": body.privacy_public_profile,
        "accepted_privacy": False,
        "accepted_terms": False,
        "consent_required": True,
        "newsletter_consent": False,
        "dm_privacy": "everyone",
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
async def list_public_users(
    q: str | None = None,
    limit: int = 2000,
    offset: int = 0,
    paged: bool = False,
):
    """Public listing of all users with public profile (community + members).

    Phase C: enriches each user with `profile_completeness`, `achievements_count`
    and `top_achievement` (highest tier earned, ignoring negatives).
    """
    db = get_db()
    query: dict = {"privacy_public_profile": True, "is_active": True, "is_banned": {"$ne": True}}
    needle = (q or "").strip()
    if needle:
        escaped = re.escape(needle)
        query["$or"] = [
            {"username": {"$regex": escaped, "$options": "i"}},
            {"display_name": {"$regex": escaped, "$options": "i"}},
        ]
    safe_limit = max(1, min(int(limit or 48), 2000 if not paged else 96))
    safe_offset = max(0, int(offset or 0))
    cursor = db.users.find(
        query,
        {"_id": 0},
    ).sort("created_at", -1)
    if paged:
        cursor = cursor.skip(safe_offset).limit(safe_limit)
    else:
        cursor = cursor.limit(safe_limit)
    total = await db.users.count_documents(query) if paged else 0
    users = await cursor.to_list(safe_limit)
    if not users:
        return {"items": [], "total": total, "limit": safe_limit, "offset": safe_offset} if paged else []
    if not paged:
        total = len(users)
    user_ids = [u["id"] for u in users]
    # Memberships for is_club_member flag
    memberships = {m["user_id"]: m for m in await db.memberships.find(
        {"user_id": {"$in": user_ids}}, {"_id": 0}).to_list(2000)}
    # Achievements (excl. negative groups)
    neg_codes = [g["code"] async for g in db.achievement_groups.find(
        {"is_negative": True}, {"_id": 0, "code": 1})]
    group_map = {g["code"]: g async for g in db.achievement_groups.find({}, {"_id": 0})}
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
                    "level_name": _level_name(t["level"], group_map.get(t.get("group_code"))),
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
    if paged:
        return {"items": out, "total": total, "limit": safe_limit, "offset": safe_offset}
    return out


@router.get("/public/{username}")
async def get_public_profile(username: str, viewer: dict | None = Depends(get_optional_user)):
    db = get_db()
    u = await db.users.find_one({"username": username}, {**PRIVATE_AUTH_FIELDS, "email": 0})
    if not u or u.get("is_active") is False or u.get("is_banned") is True:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    public = bool(u.get("privacy_public_profile"))
    # Die Stufen Community/Verein/Nur Admins/Privat gelten je Betrachter - nicht nur „öffentlich oder nichts“.
    ctx = await _viewer_context(db, viewer, u["id"])
    from services.platform_links import disabled_platforms
    ctx["off"] = disabled_platforms(await db.settings.find_one({"id": "branding"}, {"_id": 0, "disabled_platforms": 1}))
    # Membership data
    membership = await db.memberships.find_one({"user_id": u["id"]}, {"_id": 0})
    is_member = bool(membership and membership.get("member_status") in ("active", "honorary"))
    if not public:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    public_member = None
    if is_member:
        public_member = {
            "membership_type": membership.get("membership_type"),
            "member_since": membership.get("member_since"),
            "internal_role": membership.get("internal_role"),
            "member_number": membership.get("member_number") if membership.get("show_member_number_publicly") else None,
        }
    from services.platform_links import PLATFORMS as LINK_PLATFORMS, verified_platforms
    # Base profile (always visible)
    base = {
        "id": u["id"],
        "username": u["username"], "display_name": u.get("display_name"),
        "avatar_url": u.get("avatar_url"), "banner_url": u.get("banner_url"),
        "bio": u.get("bio") if public else None,
        "role": u.get("role"), "created_at": u.get("created_at"),
        "birth_date": _visible_field(u, "birth_date", public, ctx),
        "country": _visible_field(u, "country", public, ctx),
        "city": _visible_field(u, "city", public, ctx),
        "discord_name": _visible_field(u, "discord", public, ctx),
        "twitch_handle": _visible_field(u, "twitch", public, ctx),
        "youtube_handle": _visible_field(u, "youtube", public, ctx),
        "instagram_handle": _visible_field(u, "instagram", public, ctx),
        "x_handle": _visible_field(u, "x", public, ctx),
        "steam_id": _visible_field(u, "steam", public, ctx),
        "epic_id": _visible_field(u, "epic", public, ctx),
        "psn_id": _visible_field(u, "psn", public, ctx),
        "xbox_id": _visible_field(u, "xbox", public, ctx),
        "nintendo_fc": _visible_field(u, "nintendo", public, ctx),
        "ea_id": _visible_field(u, "ea", public, ctx),
        "riot_id": _visible_field(u, "riot", public, ctx),
        "battlenet_id": _visible_field(u, "battlenet", public, ctx),
        "faceit_handle": _visible_field(u, "faceit", public, ctx),
        "startgg_handle": _visible_field(u, "startgg", public, ctx),
        "roblox_handle": _visible_field(u, "roblox", public, ctx),
        "osu_handle": _visible_field(u, "osu", public, ctx),
        "lichess_handle": _visible_field(u, "lichess", public, ctx),
        "github_handle": _visible_field(u, "github", public, ctx),
        "kick_handle": _visible_field(u, "kick", public, ctx),
        "reddit_handle": _visible_field(u, "reddit", public, ctx),
        "spotify_handle": _visible_field(u, "spotify", public, ctx),
        "threads_handle": _visible_field(u, "threads", public, ctx),
        "facebook_handle": _visible_field(u, "facebook", public, ctx),
        "linkedin_handle": _visible_field(u, "linkedin", public, ctx),
        "snapchat_handle": _visible_field(u, "snapchat", public, ctx),
        "pinterest_handle": _visible_field(u, "pinterest", public, ctx),
        "telegram_handle": _visible_field(u, "telegram", public, ctx),
        "wargaming_handle": _visible_field(u, "wargaming", public, ctx),
        "bungie_handle": _visible_field(u, "bungie", public, ctx),
        "main_platform": _visible_field(u, "main_platform", public, ctx),
        "main_platforms": (u.get("main_platforms") or []) if _field_visible(u, "main_platforms", public, ctx) else [],
        "input_devices": (u.get("input_devices") or []) if _field_visible(u, "input_devices", public, ctx) else [],
        "gaming_subscriptions": _visible_field(u, "gaming_subscriptions", public, ctx),
        "favorite_games": (u.get("favorite_games") or []) if _field_visible(u, "favorite_games", public, ctx) else [],
        "website": _visible_field(u, "website", public, ctx),
        "show_twitch_embed": bool(u.get("show_twitch_embed")) if public else False,
        "privacy_public_profile": public,
        "is_club_member": is_member,
        "user_type": "club_member" if is_member else "community_user",
        "membership": public_member,
        # Verknüpfte Konten (#260): das Häkchen, nie die Plattform-Kennung.
        "verified_platforms": [p for p in verified_platforms(u) if _field_visible(u, LINK_PLATFORMS[p]["visibility"], public, ctx)],
    }
    # Die verknüpften Konten mit offizieller Adresse - nur die Plattformen, deren Feld sichtbar ist.
    from services.platform_links import linked_accounts
    base["linked_accounts"] = await linked_accounts(db, u["id"], base["verified_platforms"])
    if viewer:
        from services.friend_service import relationship_status
        base["relationship"] = await relationship_status(db, viewer.get("id"), u["id"])
        base["can_message"] = viewer.get("id") != u["id"]
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
    references = empty_profile_references()
    awards = []
    stats = {"tournaments": 0, "wins": 0, "top3": 0, "matches_played": 0, "matches_won": 0,
             "fast_laps": 0, "pole_positions": 0, "badges": len(badges), "points": total_points,
             "level": achievement_level["level"],
             "twitch_live_sessions": int(u.get("twitch_live_sessions_count") or 0),
             "twitch_stream_minutes": int(u.get("twitch_stream_minutes") or 0)}
    if public:
        references = await personal_profile_references(u, public_only=True)
        # Auszeichnungen (#230): Banner und Trophäen aus veröffentlichten Turnieren, nur öffentliche.
        from services.awards import awards_for_user
        awards = await awards_for_user(db, user_id, public_only=True)
        regs = await db.tournament_registrations.find({"user_id": user_id}, {"_id": 0}).to_list(200)
        t_ids = list({r["tournament_id"] for r in regs})
        tournaments_raw = await db.tournaments.find(
            {"id": {"$in": t_ids}}, {"_id": 0, "title": 1, "slug": 1, "game_id": 1, "format": 1,
             "status": 1, "start_date": 1, "id": 1, "visibility": 1, "is_public": 1}).to_list(200)
        t_map = {t["id"]: t for t in tournaments_raw if await _is_public_tournament(t)}
        game_ids = list({t.get("game_id") for t in t_map.values() if t.get("game_id")})
        games = await db.games.find(
            {"id": {"$in": game_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "kind": 1, "parent_game_id": 1, "short_name": 1}).to_list(200)
        parent_ids = list({g.get("parent_game_id") for g in games if g.get("parent_game_id")})
        parents = {}
        if parent_ids:
            parents = {g["id"]: g for g in await db.games.find({"id": {"$in": parent_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "short_name": 1}).to_list(200)}
        for g in games:
            parent = parents.get(g.get("parent_game_id"))
            name = (g.get("name") or "").strip()
            parent_name = ((parent or {}).get("name") or "").strip()
            if g.get("kind") == "edition" and parent_name and name and not name.lower().startswith(f"{parent_name.lower()}:") and name.lower() != parent_name.lower():
                g["display_name"] = f"{parent_name}: {name}"
            else:
                g["display_name"] = name
        g_map = {g["id"]: g for g in games}
        visible_reg_ids = []
        for r in regs:
            t = t_map.get(r["tournament_id"])
            if not t:
                continue
            visible_reg_ids.append(r["id"])
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
        # Match stats use the canonical projection so Stage/FFA results count too.
        canonical_matches = await registration_match_snapshot(db, visible_reg_ids, limit=500)
        match_summary = registration_match_summary(canonical_matches, set(visible_reg_ids))
        stats.update(match_summary)
        # F1 / Fast Lap
        from routes.f1_routes import _ms_to_time_str
        # Per track best
        all_laps = await db.f1_lap_times.find(
            {"user_id": user_id, "is_invalid": {"$ne": True}},
            {"_id": 0, "track_id": 1, "challenge_id": 1, "time_ms": 1,
             "penalty_seconds": 1, "created_at": 1}).to_list(2000)
        c_ids_f1_all = list({lap["challenge_id"] for lap in all_laps})
        challenges_raw = await db.f1_challenges.find(
            {"id": {"$in": c_ids_f1_all}},
            {"_id": 0, "id": 1, "title": 1, "slug": 1, "status": 1, "visibility": 1},
        ).to_list(200)
        chall_docs = {c["id"]: c for c in challenges_raw if await _is_public_challenge(c)}
        all_laps = [lap for lap in all_laps if lap.get("challenge_id") in chall_docs]
        stats["fast_laps"] = len(all_laps)
        best_per_track = {}
        for lap in all_laps:
            eff = lap["time_ms"] + int(lap.get("penalty_seconds", 0) * 1000)
            k = lap["track_id"]
            if k not in best_per_track or eff < best_per_track[k]["time_ms"]:
                best_per_track[k] = {"time_ms": eff, "challenge_id": lap["challenge_id"]}
        track_docs = {t["id"]: t for t in await db.f1_tracks.find(
            {"id": {"$in": list(best_per_track.keys())}},
            {"_id": 0, "id": 1, "name": 1, "country": 1}).to_list(200)}
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
                    effective_ms = ol["time_ms"] + int(ol.get("penalty_seconds", 0) * 1000)
                    if effective_ms < entry["time_ms"]:
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
        "references": references,
        "awards": awards,
        "featured_award": next((award for award in awards if award["id"] == u.get("featured_award_id")), None),
        "socials": socials,
    }


@router.get("/{user_id}")
async def get_user(user_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    u = await db.users.find_one({"id": user_id}, PRIVATE_AUTH_FIELDS)
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
    # Wortfilter (#417): Bio und Anzeigename werden vor dem Speichern geprüft.
    from services import word_filter
    for field in ("bio", "display_name"):
        if updates.get(field):
            await word_filter.screen_field(db, updates[field], kind=field, user_id=me["id"], ref_id=me["id"])
    updates = _normalize_social_updates(updates)
    if "notification_preferences" in updates:
        updates["notification_preferences"] = _normalize_notification_preferences(updates.get("notification_preferences"))
    if not updates:
        await _attach_membership(me)
        return me
    updates["updated_at"] = now_utc().isoformat()
    # Verknüpfte Konten (#260): wer das Feld von Hand ändert, verliert das Häkchen - der Text bleibt.
    # Verglichen wird mit dem gespeicherten Stand, nicht mit dem Sitzungsobjekt.
    from services.platform_links import changed_verified_platforms, unlink
    current = await db.users.find_one({"id": me["id"]}, {"_id": 0, "platform_verified": 1, "discord_name": 1, "twitch_handle": 1, "steam_id": 1}) or {}
    dropped = changed_verified_platforms(updates, current)
    await db.users.update_one({"id": me["id"]}, {"$set": updates})
    for platform in dropped:
        await unlink(db, me["id"], platform)
    u = await db.users.find_one({"id": me["id"]}, PRIVATE_AUTH_FIELDS)
    await _attach_membership(u)
    return u


@router.get("/me/level")
async def get_my_level(me: dict = Depends(get_current_user)):
    """Lightweight current achievement level for the logged-in user (level-up detection)."""
    db = get_db()
    neg_groups = {g["code"] async for g in db.achievement_groups.find({"is_negative": True}, {"_id": 0, "code": 1})}
    tiers = await db.achievements.find({}, {"_id": 0, "code": 1, "points": 1}).to_list(4000)
    points_map = {t["code"]: int(t.get("points", 0) or 0) for t in tiers}
    awards = await db.user_achievements.find(
        {"user_id": me["id"]}, {"_id": 0, "tier_code": 1, "group_code": 1}
    ).to_list(2000)
    total = sum(points_map.get(a["tier_code"], 0) for a in awards if a.get("group_code") not in neg_groups)
    return _achievement_level(total)


@router.get("/me/notification-preferences")
async def get_my_notification_preferences(me: dict = Depends(get_current_user)):
    db = get_db()
    user = await db.users.find_one({"id": me["id"]}, {"_id": 0})
    if not user:
        raise HTTPException(404, "Nutzer nicht gefunden.")
    return public_preferences_payload(user)


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
                             me: dict = Depends(require_area("club"))):
    db = get_db()
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in USER_NULLABLE_FIELDS}
    updates = _normalize_social_updates(updates)
    if "notification_preferences" in updates:
        updates["notification_preferences"] = _normalize_notification_preferences(updates.get("notification_preferences"))
    updates["updated_at"] = now_utc().isoformat()
    await db.users.update_one({"id": user_id}, {"$set": updates})
    u = await db.users.find_one({"id": user_id}, PRIVATE_AUTH_FIELDS)
    return u


@router.post("/{user_id}/ban")
async def ban_user(user_id: str, me: dict = Depends(require_area("club"))):
    db = get_db()
    await db.users.update_one({"id": user_id}, {"$set": {"is_banned": True, "updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "user.ban", "target_id": user_id,
                                     "actor_id": me["id"], "created_at": now_utc().isoformat()})
    return {"ok": True}


@router.post("/{user_id}/unban")
async def unban_user(user_id: str, me: dict = Depends(require_area("club"))):
    db = get_db()
    await db.users.update_one({"id": user_id}, {"$set": {"is_banned": False, "updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "user.unban", "target_id": user_id,
                                     "actor_id": me["id"], "created_at": now_utc().isoformat()})
    return {"ok": True}


@router.put("/{user_id}/role")
@router.post("/{user_id}/role")
async def set_role(user_id: str, body: RoleUpdate, me: dict = Depends(require_super())):
    db = get_db()
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"role": body.role, "roles": [body.role], "updated_at": now_utc().isoformat()}},
    )
    await db.audit_logs.insert_one({"id": new_id(), "action": "user.role_change", "target_id": user_id,
                                     "actor_id": me["id"], "data": {"role": body.role},
                                     "created_at": now_utc().isoformat()})
    u = await db.users.find_one({"id": user_id}, PRIVATE_AUTH_FIELDS)
    return u


@router.put("/{user_id}/areas")
async def set_areas(user_id: str, body: AreasUpdate, me: dict = Depends(require_super())):
    """Freigaben je Bereich (#287): nur Turnierleitung, Redaktion, Vereinsverwaltung; System bleibt an der Rolle."""
    from services.permissions import GRANTABLE_AREAS, clean_grants

    unknown = [a for a in body.areas if a not in GRANTABLE_AREAS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unbekannter Bereich: {', '.join(unknown)}. Erlaubt: {', '.join(GRANTABLE_AREAS)}.")
    areas = clean_grants(body.areas)
    db = get_db()
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "areas": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    await db.users.update_one({"id": user_id}, {"$set": {"areas": areas, "updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "user.areas_change", "target_id": user_id,
                                     "actor_id": me["id"], "data": {"areas": areas, "from": target.get("areas") or []},
                                     "created_at": now_utc().isoformat()})
    u = await db.users.find_one({"id": user_id}, PRIVATE_AUTH_FIELDS)
    return u


@router.delete("/{user_id}")
async def delete_user(user_id: str, me: dict = Depends(require_super())):
    db = get_db()
    if user_id == me["id"]:
        raise HTTPException(status_code=400, detail="Nutze für den eigenen Account die Datenschutzseite.")
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    if user.get("role") == "superadmin":
        raise HTTPException(403, "Andere Superadmins dürfen nicht anonymisiert werden.")
    from routes.dsgvo_routes import _anonymize_user_data
    await _anonymize_user_data(db, user_id, me["id"], "user.admin_anonymize")
    return {"ok": True, "anonymized": True}
