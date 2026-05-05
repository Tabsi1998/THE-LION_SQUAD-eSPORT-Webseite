"""Achievement Engine v4 (Phase B Final) — Group-aware tiers + Admin CRUD support.

Backwards-compatible function names so existing route hooks keep firing.

Collections:
  - achievement_groups  (groups, public/private/special/negative)
  - achievements        (tier entries, group_code + level)
  - user_achievements   (per-user awards keyed by tier-code)

Public/profile listing rules:
  - Negative/fun groups stay hidden until a user has earned at least one tier
    in that group. Once earned, only the earned tiers are shown publicly.
  - Special manual-only tiers appear once awarded (or in catalog when group.public=True).
  - Within a public group, all tiers are listed; locked tiers are returned with
    a `locked=True` flag plus current/target progress so the UI can grey them out.
"""
import logging
from datetime import datetime, timezone
from database import get_db
from models import now_utc, new_id
from achievement_catalog import (
    ACHIEVEMENT_GROUPS, ACHIEVEMENT_TIERS, GROUP_BY_CODE, TIER_BY_CODE,
)

logger = logging.getLogger("tls.achievements")


# ---------------- Seed / Migration ----------------
async def seed_badges():
    """Seed groups + tiers; one-time wipe of legacy `badges` / `user_badges`."""
    db = get_db()
    legacy_marker = await db.settings.find_one({"id": "achievements_v4_migrated"})
    if not legacy_marker:
        try:
            await db.badges.drop()
            await db.user_badges.drop()
        except Exception:
            pass
        await db.settings.update_one(
            {"id": "achievements_v4_migrated"},
            {"$set": {"id": "achievements_v4_migrated", "migrated_at": now_utc().isoformat()}},
            upsert=True,
        )
        logger.info("[achievements] v4 migration complete — legacy collections dropped.")

    for g in ACHIEVEMENT_GROUPS:
        await db.achievement_groups.update_one(
            {"code": g["code"]},
            {"$set": {**g, "id": g["code"]},
             "$setOnInsert": {"created_at": now_utc().isoformat(), "is_admin_created": False}},
            upsert=True,
        )
    for t in ACHIEVEMENT_TIERS:
        await db.achievements.update_one(
            {"code": t["code"]},
            {"$set": {**t, "id": t["code"]},
             "$setOnInsert": {"created_at": now_utc().isoformat()}},
            upsert=True,
        )
    await db.user_achievements.create_index([("user_id", 1), ("tier_code", 1)], unique=True)
    await db.user_achievements.create_index([("user_id", 1), ("earned_at", -1)])
    await db.achievements.create_index([("group_code", 1), ("level", 1)])


# ---------------- Award ----------------
async def award_achievement(user_id: str, tier_code: str, context: dict | None = None,
                             awarded_by: str | None = None) -> bool:
    db = get_db()
    tier = await db.achievements.find_one({"code": tier_code}, {"_id": 0})
    if not tier:
        return False
    group = await db.achievement_groups.find_one({"code": tier["group_code"]}, {"_id": 0})
    if not group:
        return False
    existing = await db.user_achievements.find_one({"user_id": user_id, "tier_code": tier_code})
    if existing:
        return False
    doc = {
        "id": new_id(),
        "user_id": user_id,
        "tier_code": tier_code,
        "group_code": tier["group_code"],
        "level": tier["level"],
        "earned_at": now_utc().isoformat(),
        "context": context or {},
        "awarded_by": awarded_by,
    }
    await db.user_achievements.insert_one(doc)
    if not group.get("is_negative"):
        try:
            from discord_service import send_discord
            user = await db.users.find_one({"id": user_id},
                                            {"display_name": 1, "username": 1}) or {}
            level_color = {1: 0xCD7F32, 2: 0xC0C0C0, 3: 0xFFD700, 4: 0x29B6E8, 5: 0xFF3B30}
            level_name = {1: "Bronze", 2: "Silber", 3: "Gold", 4: "Platin", 5: "Special"}
            await send_discord(
                f"🏆 {group['name']} · {level_name.get(tier['level'], '?')}",
                f"**{user.get('display_name') or user.get('username') or 'Spieler'}** hat **{tier['name']}** freigeschaltet!\n_{tier.get('description','')}_",
                color=level_color.get(tier["level"], 0x29B6E8),
                fields=[{"name": "Punkte", "value": f"+{tier.get('points', 0)}", "inline": True}],
                event_key="achievement.awarded",
            )
        except Exception as e:
            logger.debug(f"Discord achievement trigger failed: {e}")
    return True


# Legacy alias used by older code/tests
async def award_badge(user_id: str, code: str, context: dict | None = None) -> bool:
    return await award_achievement(user_id, code, context=context)


BADGE_BY_CODE = TIER_BY_CODE


def _user_can_see_badge(group: dict, user: dict | None) -> bool:
    if group.get("is_negative"):
        return bool(user and user.get("role") in ("club_admin", "superadmin"))
    if not group.get("public", True):
        return bool(user and user.get("role") in ("club_admin", "superadmin"))
    return True


# ---------- Profile-Completeness (Phase C) ----------
PROFILE_FIELDS = [
    ("avatar_url", 1.0),
    ("banner_url", 0.6),
    ("bio", 1.0),
    ("country", 0.8),
    ("city", 0.6),
    ("birthdate", 0.6),
    ("main_platforms", 1.0),     # list, non-empty
    ("input_devices", 0.8),      # list
    ("favorite_games", 0.8),     # list
    ("discord_name", 0.8),
    ("twitch_channel", 0.6),
    ("privacy_public_profile", 0.4),  # explicit choice
]


def compute_profile_completeness(user: dict | None) -> int:
    """Return percent (0–100) of profile completeness using PROFILE_FIELDS weights."""
    if not user:
        return 0
    total = sum(w for _, w in PROFILE_FIELDS)
    score = 0.0
    for key, weight in PROFILE_FIELDS:
        v = user.get(key)
        if isinstance(v, list):
            if len(v) > 0:
                score += weight
        elif isinstance(v, bool):
            # privacy_public_profile counts when set (either true or false explicitly)
            if v is True or v is False:
                score += weight
        elif v not in (None, "", 0):
            score += weight
    return round(100 * score / total) if total else 0


# ---------------- Progress Counters ----------------
async def compute_user_progress(user_id: str) -> dict[str, int]:
    db = get_db()
    p: dict[str, int] = {}

    regs = await db.tournament_registrations.find({"user_id": user_id}, {"_id": 0, "tournament_id": 1, "id": 1}).to_list(2000)
    p["tournaments_registered"] = len(regs)
    reg_ids = {r["id"] for r in regs}
    tids = list({r["tournament_id"] for r in regs if r.get("tournament_id")})
    games = await db.tournaments.distinct("game_id", {"id": {"$in": tids}}) if tids else []
    p["distinct_games_registered"] = len([g for g in games if g])
    formats = await db.tournaments.distinct("format", {"id": {"$in": tids}}) if tids else []
    p["distinct_formats"] = len([f for f in formats if f])

    p["matches_played"] = await db.matches.count_documents({"$or": [{"winner_id": {"$in": list(reg_ids)}}, {"loser_id": {"$in": list(reg_ids)}}], "status": "completed"}) if reg_ids else 0
    p["matches_won"] = await db.matches.count_documents({"winner_id": {"$in": list(reg_ids)}, "status": "completed"}) if reg_ids else 0

    streak_max = 0
    if reg_ids:
        recent = await db.matches.find(
            {"status": "completed", "$or": [{"winner_id": {"$in": list(reg_ids)}}, {"loser_id": {"$in": list(reg_ids)}}]},
            {"_id": 0, "winner_id": 1, "loser_id": 1, "updated_at": 1},
        ).sort("updated_at", 1).to_list(2000)
        cur = 0
        for m in recent:
            if m.get("winner_id") in reg_ids:
                cur += 1
                streak_max = max(streak_max, cur)
            else:
                cur = 0
    p["match_streak_max"] = streak_max

    wins = podium = rank4 = 0
    for r in regs:
        if await db.matches.find_one({"tournament_id": r.get("tournament_id"), "winner_id": r["id"], "final_position": 1}):
            wins += 1
        if await db.matches.find_one({"tournament_id": r.get("tournament_id"), "winner_id": r["id"], "final_position": {"$lte": 3}}):
            podium += 1
        if await db.matches.find_one({"tournament_id": r.get("tournament_id"), "loser_id": r["id"], "final_position": 4}):
            rank4 += 1
    p["tournaments_won"] = wins
    p["podium_finishes"] = podium
    p["rank_4_count"] = rank4

    p["fastlap_valid_count"] = await db.f1_lap_times.count_documents({"user_id": user_id, "is_invalid": {"$ne": True}})
    distinct_tracks = await db.f1_lap_times.distinct("track_id", {"user_id": user_id, "is_invalid": {"$ne": True}})
    p["distinct_tracks"] = len([t for t in distinct_tracks if t])
    pole_count = 0
    for tid in distinct_tracks:
        if not tid:
            continue
        best = await db.f1_lap_times.find_one(
            {"track_id": tid, "is_invalid": {"$ne": True}},
            {"_id": 0, "user_id": 1, "time_ms": 1},
            sort=[("time_ms", 1)],
        )
        if best and best.get("user_id") == user_id:
            pole_count += 1
    p["pole_count"] = pole_count

    membership_days = 0
    m = await db.memberships.find_one({"user_id": user_id})
    if m and m.get("member_since") and m.get("member_status") in ("active", "honorary"):
        try:
            since = datetime.fromisoformat(m["member_since"].replace("Z", "+00:00"))
            if since.tzinfo is None:
                since = since.replace(tzinfo=timezone.utc)
            membership_days = max((datetime.now(timezone.utc) - since).days, 1)
        except (ValueError, TypeError):
            pass
    p["membership_days"] = membership_days

    if "event_registrations" in await db.list_collection_names():
        p["events_attended"] = await db.event_registrations.count_documents({"user_id": user_id, "checked_in": True})
    else:
        p["events_attended"] = 0

    season_rows = await db.season_points.find({"user_id": user_id}, {"_id": 0, "total_points": 1}).to_list(2000)
    p["season_points_total"] = int(sum(float(r.get("total_points") or 0) for r in season_rows))

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    plats = set()
    if user:
        for x in (user.get("main_platforms") or []):
            if x:
                plats.add(x)
        if user.get("main_platform"):
            plats.add(user["main_platform"])
    p["distinct_platforms"] = len(plats)

    # seasons_active — distinct seasons where user has any registration
    seasons_active = 0
    if tids:
        season_ids = await db.tournaments.distinct("season_id", {"id": {"$in": tids}, "season_id": {"$ne": None}})
        seasons_active = len([s for s in season_ids if s])
    p["seasons_active"] = seasons_active

    # profile_completeness — same scoring used by /api/users/me/profile-completeness
    p["profile_completeness"] = compute_profile_completeness(user) if user else 0

    user_awards = await db.user_achievements.find({"user_id": user_id}, {"_id": 0}).to_list(1000)
    p["achievements_unlocked"] = len(user_awards)
    award_codes = list({a.get("tier_code") for a in user_awards if a.get("tier_code")})
    if award_codes:
        award_tiers = await db.achievements.find({"code": {"$in": award_codes}}, {"_id": 0}).to_list(1000)
        award_groups = await db.achievement_groups.find({}, {"_id": 0, "code": 1, "is_negative": 1}).to_list(500)
        group_is_negative = {g["code"]: bool(g.get("is_negative")) for g in award_groups}
        p["achievement_points"] = sum(
            int(t.get("points") or 0)
            for t in award_tiers
            if not group_is_negative.get(t.get("group_code"), False)
        )
    else:
        p["achievement_points"] = 0

    teams = await db.teams.find({"members.user_id": user_id}, {"_id": 0, "id": 1, "founder_id": 1}).to_list(50)
    p["teams_founded"] = sum(1 for t in teams if t.get("founder_id") == user_id)
    p["team_days_max"] = 0

    p["best_season_rank_inv"] = 0
    p["best_championship_rank_inv"] = 0

    # Phase E + Discord-Counter: discord_messages comes from manually maintained counter
    p["discord_messages"] = (user or {}).get("discord_messages_count", 0)

    for k in [
        "checkins_in_a_row", "fast_registrations", "clutch_count",
        "dispute_free_matches", "long_matches_60", "long_matches_120",
        "matches_early", "matches_late", "sub_target_count",
        "afk_count", "no_show_count", "late_checkins", "ghost_count",
        "disputes_opened", "disputes_opened_season", "chat_warnings", "rage_quits",
        "hardware_incidents", "invalid_laps_session", "dnfs_season",
        "offroad_count", "reverse_lap_count", "slowest_lap_count", "unproven_laps",
        "team_no_show_count", "team_kills", "team_late_count", "team_member_churn",
        "zero_eight_losses", "long_warmup_count", "long_break_count", "loss_streak",
    ]:
        p.setdefault(k, 0)

    return p


# ---------------- Group-aware listing ----------------
def _color_for_level(level: int) -> str:
    return {1: "#CD7F32", 2: "#C0C0C0", 3: "#FFD700", 4: "#29B6E8", 5: "#FF3B30"}.get(level, "#CD7F32")


def _level_name(level: int) -> str:
    return {1: "Bronze", 2: "Silber", 3: "Gold", 4: "Platin", 5: "Special"}.get(level, "?")


def _safe_negative_description() -> str:
    return "Geheimes Fun-/Negative-Achievement freigeschaltet."


def _safe_negative_group_description() -> str:
    return "Freigeschaltete geheime Fun-/Negative-Achievements. Nicht freigeschaltete bleiben verborgen."


async def list_groups_for_user(user_id: str | None, viewer: dict | None) -> list[dict]:
    """Public/profile catalog with secret negative/fun awards after unlock."""
    db = get_db()
    is_admin = bool(viewer and viewer.get("role") in ("club_admin", "superadmin"))

    groups = await db.achievement_groups.find({}, {"_id": 0}).sort("sort_order", 1).to_list(500)
    tiers = await db.achievements.find({}, {"_id": 0}).sort("level", 1).to_list(2000)
    awards: list = []
    progress: dict = {}
    if user_id:
        awards = await db.user_achievements.find({"user_id": user_id}, {"_id": 0}).to_list(500)
        progress = await compute_user_progress(user_id)
    awarded_codes = {a["tier_code"]: a for a in awards}
    earned_group_codes = {a.get("group_code") for a in awards if a.get("group_code")}

    out = []
    for g in groups:
        is_negative = bool(g.get("is_negative"))
        if is_negative:
            if not user_id or g["code"] not in earned_group_codes:
                continue
        elif not g.get("public") and not is_admin:
            continue
        gtiers = [t for t in tiers if t.get("group_code") == g["code"]]
        if is_negative:
            gtiers = [t for t in gtiers if t["code"] in awarded_codes]
        gtiers.sort(key=lambda x: x.get("level", 0))
        out_tiers = []
        for t in gtiers:
            ck = t.get("condition_key")
            target = t.get("progress_target") or 0
            cur = progress.get(ck, 0) if ck else 0
            earned_doc = awarded_codes.get(t["code"])
            tier_payload = {
                **t,
                "level_name": _level_name(t.get("level", 1)),
                "level_color": _color_for_level(t.get("level", 1)),
                "earned": bool(earned_doc),
                "earned_at": earned_doc["earned_at"] if earned_doc else None,
                "current": min(cur, target) if target else cur,
                "target": target,
                "percent": (round(100 * min(cur, target) / target) if target else (100 if earned_doc else 0)),
                "manual_only": bool(t.get("manual_only")),
                "is_negative": is_negative,
                "secret": is_negative,
            }
            if is_negative:
                tier_payload.update({
                    "description": _safe_negative_description(),
                    "condition_key": None,
                    "progress_target": None,
                    "current": 0,
                    "target": 0,
                    "percent": 100,
                    "manual_only": True,
                })
            out_tiers.append(tier_payload)
        earned_levels = [t["level"] for t in out_tiers if t["earned"]]
        out.append({
            **g,
            "description": _safe_negative_group_description() if is_negative else g.get("description"),
            "tiers": out_tiers,
            "highest_earned_level": max(earned_levels) if earned_levels else 0,
            "tier_count": len(out_tiers),
            "earned_count": len(earned_levels),
        })
    return out


async def list_user_awards(user_id: str, viewer: dict | None) -> list[dict]:
    """Profile/public award list. Earned negative/fun awards are visible, but secret."""
    db = get_db()
    awards = await db.user_achievements.find({"user_id": user_id}, {"_id": 0}).sort("earned_at", -1).to_list(500)
    out = []
    for a in awards:
        t = await db.achievements.find_one({"code": a["tier_code"]}, {"_id": 0})
        if not t:
            continue
        g = await db.achievement_groups.find_one({"code": t["group_code"]}, {"_id": 0})
        if not g:
            continue
        is_negative = bool(g.get("is_negative"))
        out.append({
            **t,
            "description": _safe_negative_description() if is_negative else t.get("description"),
            "condition_key": None if is_negative else t.get("condition_key"),
            "progress_target": None if is_negative else t.get("progress_target"),
            "group_name": g["name"],
            "group_category": g["category"],
            "group_icon": g["icon"],
            "group_accent": g["accent_color"],
            "is_negative": is_negative,
            "secret": is_negative,
            "level_name": _level_name(t.get("level", 1)),
            "level_color": _color_for_level(t.get("level", 1)),
            "earned_at": a["earned_at"],
        })
    return out


# ---------------- Auto-eval ----------------
async def evaluate_user_progress(user_id: str) -> int:
    db = get_db()
    counters = await compute_user_progress(user_id)
    earned_codes = {a["tier_code"] async for a in db.user_achievements.find({"user_id": user_id})}
    new_count = 0
    tiers = await db.achievements.find({"manual_only": {"$ne": True}}, {"_id": 0}).to_list(2000)
    for t in tiers:
        if t["code"] in earned_codes:
            continue
        ck = t.get("condition_key")
        target = t.get("progress_target") or 0
        if not ck or not target:
            continue
        if counters.get(ck, 0) >= target:
            ok = await award_achievement(user_id, t["code"], {"auto_progress": True, "current": counters.get(ck), "target": target})
            if ok:
                new_count += 1
    return new_count


# ---------------- Hooks (preserve old function names) ----------------
async def evaluate_membership_badges(user_id: str):
    await evaluate_user_progress(user_id)


async def on_tournament_registered(user_id: str, tournament_id: str):
    await evaluate_user_progress(user_id)


async def on_checked_in(user_id: str, tournament_id: str):
    await evaluate_user_progress(user_id)


async def on_match_completed(winner_user_id: str, loser_user_id: str | None,
                              tournament_id: str, match_id: str):
    if winner_user_id:
        await evaluate_user_progress(winner_user_id)
    if loser_user_id:
        await evaluate_user_progress(loser_user_id)


async def on_tournament_completed(tournament_id: str, placements: list[dict]):
    for p in placements:
        uid = p.get("user_id")
        if uid:
            await evaluate_user_progress(uid)
            if p.get("rank") == 4:
                await award_achievement(uid, "neg_holzmedaille", {"tournament_id": tournament_id})


async def on_lap_submitted(user_id: str, challenge_id: str, track_id: str,
                            was_new_leader: bool, is_invalid: bool = False):
    db = get_db()
    if is_invalid:
        invalids = await db.f1_lap_times.count_documents(
            {"user_id": user_id, "challenge_id": challenge_id, "is_invalid": True}
        )
        if invalids >= 5:
            await award_achievement(user_id, "neg_invalid_lap",
                                    {"challenge_id": challenge_id, "invalids": invalids})
        return
    await evaluate_user_progress(user_id)


async def on_team_created(user_id: str, team_id: str):
    await evaluate_user_progress(user_id)


async def on_team_joined(user_id: str, team_id: str):
    await evaluate_user_progress(user_id)


# ---------- Phase B v4.1 — Negative incident trigger ----------
NEGATIVE_INCIDENTS = {
    "afk":              "neg_afk",
    "no_show":          "neg_no_show",
    "ghost":            "neg_ghost",
    "rage_quit":        "neg_rage_quit",
    "controller_throw": "neg_controller_throw",
    "chat_warning":     "neg_chat_warning",
    "dispute_open":     "neg_dispute",
    "team_no_show":     "neg_team_no_show",
    "wrong_lobby":       "neg_wrong_lobby",
    "mute_master":       "neg_mute_master",
    "screenshot_missing": "neg_screenshot_missing",
    "patchday_victim":   "neg_patchday_victim",
    "cable_chaos":       "neg_cable_chaos",
    "alt_tab_champion":  "neg_alt_tab_champion",
    "rulebook_speedrun": "neg_rulebook_speedrun",
    "start_sleep":       "neg_start_sleep",
    "setup_curse":       "neg_setup_curse",
    "capslock_captain":  "neg_capslock_captain",
}


async def trigger_negative_incident(user_id: str, incident_type: str,
                                     context: dict | None = None,
                                     awarded_by: str | None = None) -> str | None:
    """Public helper for hooks/admin endpoints to award a negative tier.

    Returns the awarded tier_code or None if the incident type is unknown.
    """
    code = NEGATIVE_INCIDENTS.get(incident_type)
    if not code:
        return None
    awarded = await award_achievement(user_id, code, context=context, awarded_by=awarded_by)
    return code if awarded else None


async def on_dispute_opened(user_id: str, match_id: str | None = None):
    await trigger_negative_incident(user_id, "dispute_open", {"match_id": match_id})


async def on_match_disconnect(user_id: str, match_id: str | None = None):
    await trigger_negative_incident(user_id, "rage_quit", {"match_id": match_id})


# ---------- Phase B v4.1 — Season completion hook ----------
async def on_season_completed(season_id: str) -> dict:
    """Award season_climber + championship_top tiers based on final standings.

    Pulls from `season_standings` if present, else from tournaments aggregation.
    Returns a summary {awarded: int, ranked: int}.
    """
    db = get_db()
    standings = await db.season_standings.find({"season_id": season_id}, {"_id": 0}).sort("rank", 1).to_list(500)
    if not standings:
        # Fallback: aggregate by tournament_registrations + matches
        return {"awarded": 0, "ranked": 0, "skipped": "no standings"}
    awarded_total = 0
    targets = [
        ("season_climber_p", 1), ("season_climber_g", 3),
        ("season_climber_s", 10), ("season_climber_b", 25),
    ]
    for s in standings:
        uid = s.get("user_id")
        rank = s.get("rank")
        if not uid or not rank:
            continue
        for code, max_rank in targets:
            if rank <= max_rank:
                if await award_achievement(uid, code,
                                            {"season_id": season_id, "rank": rank}):
                    awarded_total += 1
    return {"awarded": awarded_total, "ranked": len(standings)}
