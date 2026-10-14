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

from pymongo.errors import DuplicateKeyError

from database import get_db
from models import now_utc, new_id
from achievement_catalog import (
    ACHIEVEMENT_GROUPS, ACHIEVEMENT_TIERS, TIER_BY_CODE,
    CONDITION_KEY_STATUS, apply_category_overrides, annotate_tier, material_color, material_name,
)
from services.membership_service import get_membership, is_active_member
from services import achievement_core
from services.achievement_core import NEGATIVE_INCIDENTS  # umgezogen (#1420), hier weiter erreichbar
from services.achievement_progress import (  # noqa: F401 - umgezogen (#1420), hier weiter erreichbar
    PROFILE_FIELDS,
    compute_profile_completeness,
    compute_user_progress,
)
from services import xp

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
            logger.warning("[achievements] Alte Sammlungen badges/user_badges nicht gelöscht", exc_info=True)
        await db.settings.update_one(
            {"id": "achievements_v4_migrated"},
            {"$set": {"id": "achievements_v4_migrated", "migrated_at": now_utc().isoformat()}},
            upsert=True,
        )
        logger.info("[achievements] v4 migration complete — legacy collections dropped.")

    for g in ACHIEVEMENT_GROUPS:
        g = apply_category_overrides(g)
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
    # Von Hand angelegte Stufen (Admin) bekommen Material und Rang nachgetragen (#611).
    async for t in db.achievements.find({"material": {"$exists": False}}, {"_id": 0}):
        group = await db.achievement_groups.find_one({"code": t.get("group_code")}, {"_id": 0})
        annotated = annotate_tier(t, group)
        await db.achievements.update_one({"code": t["code"]}, {"$set": {k: annotated[k] for k in ("material", "rank", "material_name", "material_color", "art", "how_to")}})
    await db.user_achievements.create_index([("user_id", 1), ("tier_code", 1)], unique=True)
    await db.user_achievements.create_index([("user_id", 1), ("earned_at", -1)])
    await db.achievements.create_index([("group_code", 1), ("level", 1)])
    await db.achievements.create_index([("group_code", 1), ("rank", 1)])
    await xp.ensure_indexes(db)
    # Erfolge II (#611): Vergaben mit Material versehen und die Abbildung alt → neu anwenden.
    try:
        from services.achievement_migration import run_all
        from services.achievement_counters import refresh as refresh_counters
        # Die Abbildung alt → neu wertet mit allen Zählern aus (alter Block plus Registry), nicht nur mit dem alten Block.
        result = await run_all(db, compute_progress=refresh_counters)
        if result["annotated"]["updated"] or result["mapping"]["groups"]:
            logger.info("[achievements] v2: %s", result)
    except Exception:  # noqa: BLE001 - ein Fehler hier darf den Start nicht stoppen
        logger.warning("[achievements] v2-Migration fehlgeschlagen", exc_info=True)


# ---------------- Award ----------------
async def can_award_tier_to_user(user_id: str, tier: dict | None) -> bool:
    """Return whether a tier can be awarded to the user under membership rules."""
    if not tier:
        return False
    if not tier.get("member_only"):
        return True
    return is_active_member(await get_membership(user_id))


async def award_achievement(user_id: str, tier_code: str, context: dict | None = None,
                             awarded_by: str | None = None) -> bool:
    db = get_db()
    tier = await db.achievements.find_one({"code": tier_code}, {"_id": 0})
    if not tier:
        return False
    group = await db.achievement_groups.find_one({"code": tier["group_code"]}, {"_id": 0})
    if not group:
        return False
    if not await can_award_tier_to_user(user_id, tier):
        return False
    existing = await db.user_achievements.find_one({"user_id": user_id, "tier_code": tier_code})
    if existing:
        return False
    doc = award_doc(user_id, tier, group, context=context, awarded_by=awarded_by)
    try:
        await db.user_achievements.insert_one(doc)
    except DuplicateKeyError:
        # concurrent evaluation already awarded this tier — not an error
        return False
    await after_award([user_id], tier, group, notify=(context or {}).get("notify") is not False)
    return True


def award_doc(user_id: str, tier: dict, group: dict, *, context: dict | None = None, awarded_by: str | None = None, earned_at: str | None = None) -> dict:
    """Eine Vergabe, wie sie in ``user_achievements`` steht - für die Einzelvergabe und die Massenvergabe (E10)."""
    annotated = annotate_tier(tier, group)
    return {
        "id": new_id(),
        "user_id": user_id,
        "tier_code": tier["code"],
        "group_code": tier["group_code"],
        "level": annotated["level"],
        "material": annotated["material"],
        "rank": annotated["rank"],
        "earned_at": earned_at or now_utc().isoformat(),
        "context": context or {},
        "awarded_by": awarded_by,
    }


async def after_award(user_ids: list[str], tier: dict, group: dict, *, notify: bool = True) -> None:
    """Was auf eine neue Vergabe folgt - für eine Person oder viele (Massenvergabe, E10): XP, die Schlange für
    Sammler und Co., die Kronen und die gebündelte Meldung. ``notify`` aus (Admin: „ohne Benachrichtigung“)
    lässt nur die Meldung weg. Negative Gruppen bringen nichts davon."""
    if group.get("is_negative") or not user_ids:
        return
    # XP (#617): jeder Erfolg bringt Punkte × 10 - einmal je Stufe, der Bezug ist der Stufen-Code. Viele auf
    # einmal (Massenvergabe) gebündelt in wenigen Schreibzügen.
    try:
        if len(user_ids) == 1:
            await xp.grant_achievement(user_ids[0], tier)
        else:
            await xp.grant_achievement_many(user_ids, tier)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"xp for achievement failed: {e}")
    # Sammler, Kategorie-Meister, Geheimnisträger (#616): über die Schlange, nicht im selben Lauf.
    try:
        from services.achievement_queue import request_evaluation
        await request_evaluation(user_ids, "award", sources={"achievement"})
    except Exception as e:  # noqa: BLE001
        logger.debug(f"queue after award failed: {e}")
    try:
        from services.crown_events import schedule_crown_sync
        schedule_crown_sync()
    except Exception as e:
        logger.debug(f"crown sync scheduling failed: {e}")
    if not notify:
        return
    # Gemeldet wird gebündelt und nur, was öffentlich sein darf (#301):
    # services/achievement_queue.py schickt eine Meldung je Person und Minute.
    try:
        from services.achievement_queue import note_awards
        await note_awards(user_ids, tier, group)
    except Exception as e:
        logger.debug(f"achievement announcement queue failed: {e}")


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


# ---------------- Group-aware listing ----------------
def _color_for_level(level: int) -> str:
    return {1: "#CD7F32", 2: "#C0C0C0", 3: "#FFD700", 4: "#29B6E8", 5: "#FF3B30"}.get(level, "#CD7F32")


def _level_name(level: int, group: dict | None = None) -> str:
    if int(level or 1) == 5:
        if group and group.get("is_negative"):
            return "Geheim"
        if group and (group.get("is_special") or group.get("category") == "special"):
            return "Sonderauszeichnung"
        return "Legendär"
    return {1: "Bronze", 2: "Silber", 3: "Gold", 4: "Platin"}.get(int(level or 1), "?")


def material_fields(tier: dict, group: dict | None = None) -> dict:
    """Erfolge II (#611): Material, Rang, Name und Farbe einer Stufe - alte Stufen werden abgeleitet.
    ``level_name``/``level_color`` folgen dem Material, ``level`` bleibt 1–5 für alte Clients."""
    annotated = annotate_tier(tier, group)
    name = material_name(annotated["material"])
    if annotated["material"] == "legendary" and group and (group.get("is_special") or group.get("category") == "special") and not tier.get("material"):
        name = _level_name(5, group)
    return {
        "material": annotated["material"], "rank": annotated["rank"], "material_name": annotated["material_name"],
        "material_color": annotated["material_color"], "level": annotated["level"],
        "level_name": name, "level_color": material_color(annotated["material"]),
        "art": annotated.get("art"), "how_to": annotated.get("how_to") or "",
    }


def _safe_negative_description() -> str:
    return "Geheimes Fun-/Negative-Achievement freigeschaltet."


def _safe_negative_group_description() -> str:
    return "Freigeschaltete geheime Fun-/Negative-Achievements. Nicht freigeschaltete bleiben verborgen."


async def list_groups_for_user(user_id: str | None, viewer: dict | None) -> list[dict]:
    """Public/profile catalog with secret negative/fun awards after unlock."""
    db = get_db()
    from services.permissions import is_confirmed_admin_role

    # Geheime und nicht öffentliche Gruppen zeigt der Katalog Club-Admin und Superadmin - mit bestätigter
    # Zwei-Faktor-Anmeldung (#1469).
    is_admin = is_confirmed_admin_role(viewer, ("club_admin", "superadmin"))

    groups = await db.achievement_groups.find({}, {"_id": 0}).sort("sort_order", 1).to_list(500)
    tiers = await db.achievements.find({}, {"_id": 0}).sort("rank", 1).to_list(2000)
    awards: list = []
    progress: dict = {}
    if user_id:
        awards = await db.user_achievements.find({"user_id": user_id}, {"_id": 0}).to_list(500)
        from services import achievement_counters
        progress = await achievement_counters.stats(user_id)
    awarded_codes = {a["tier_code"]: a for a in awards}
    earned_group_codes = {a.get("group_code") for a in awards if a.get("group_code")}

    out = []
    for g in groups:
        is_negative = bool(g.get("is_negative"))
        # Geheime Gruppen (#611) tauchen wie negative erst nach der ersten Freischaltung auf - Admins sehen alles.
        is_hidden = bool(g.get("hidden")) and not is_negative
        if is_negative:
            if not user_id or g["code"] not in earned_group_codes:
                continue
        elif is_hidden and not is_admin:
            if not user_id or g["code"] not in earned_group_codes:
                continue
        elif not g.get("public") and not is_admin:
            continue
        gtiers = [t for t in tiers if t.get("group_code") == g["code"]]
        if is_negative or (is_hidden and not is_admin):
            gtiers = [t for t in gtiers if t["code"] in awarded_codes]
        gtiers.sort(key=lambda x: (x.get("rank") or 0, x.get("level", 0)))
        out_tiers = []
        for t in gtiers:
            ck = t.get("condition_key")
            target = t.get("progress_target") or 0
            cur = progress.get(ck, 0) if ck else 0
            earned_doc = awarded_codes.get(t["code"])
            tier_payload = {
                **t,
                **material_fields(t, g),
                "earned": bool(earned_doc),
                "earned_at": earned_doc["earned_at"] if earned_doc else None,
                "silent": bool(earned_doc.get("silent")) if earned_doc else False,
                "current": min(cur, target) if target else cur,
                "target": target,
                "percent": (round(100 * min(cur, target) / target) if target else (100 if earned_doc else 0)),
                "manual_only": bool(t.get("manual_only")),
                "member_only": bool(t.get("member_only")),
                "condition_status": CONDITION_KEY_STATUS.get(ck) if ck else None,
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
        earned_ranks = [int(t.get("rank") or 0) for t in out_tiers if t["earned"]]
        out.append({
            **g,
            "hidden": is_hidden,
            "description": _safe_negative_group_description() if is_negative else g.get("description"),
            "tiers": out_tiers,
            "highest_earned_level": max(earned_levels) if earned_levels else 0,
            "highest_earned_rank": max(earned_ranks) if earned_ranks else 0,
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
            "award_id": a.get("id"),
            "description": _safe_negative_description() if is_negative else t.get("description"),
            "condition_key": None if is_negative else t.get("condition_key"),
            "progress_target": None if is_negative else t.get("progress_target"),
            "group_name": g["name"],
            "group_category": g["category"],
            "group_icon": g["icon"],
            "group_accent": g["accent_color"],
            "is_negative": is_negative,
            "secret": is_negative,
            "member_only": bool(t.get("member_only")),
            "condition_status": CONDITION_KEY_STATUS.get(t.get("condition_key")) if t.get("condition_key") else None,
            **material_fields(t, g),
            "earned_at": a["earned_at"],
            "silent": bool(a.get("silent")),
        })
    return out


# ---------------- Auto-eval ----------------
async def evaluate_user_progress(user_id: str, sources=None, legacy: bool = True) -> int:
    """Stufen prüfen und vergeben. Mit ``sources`` (#616) werden nur die betroffenen Zähler neu gerechnet
    und nur Stufen mit diesen Schlüsseln angesehen; ohne Quelle alles. ``legacy`` aus (#678, nur mit ``sources``):
    der alte Block bleibt liegen und nur die Stufen dieser Zähler werden geladen - leicht genug für jede Meldung."""
    db = get_db()
    from services import achievement_counters
    light = bool(sources) and not legacy
    counters = await achievement_counters.refresh(user_id, sources, legacy=not light)
    only_keys = None if not sources else (achievement_counters.keys_for_sources(sources) | (frozenset() if light else achievement_counters.LEGACY_KEYS))
    active_member = is_active_member(await get_membership(user_id))
    earned_codes = {a["tier_code"] async for a in db.user_achievements.find({"user_id": user_id})}
    new_count = 0
    query = {"manual_only": {"$ne": True}}
    if light:
        query["condition_key"] = {"$in": sorted(only_keys)}
    tiers = await db.achievements.find(query, {"_id": 0}).to_list(2000)
    # Mehrere Stufen auf einmal (#1296): eine Meldung „Level X erreicht“ mit dem erreichten Level, nicht eine je Aufstieg.
    async with xp.collected_level_ups():
        for t in tiers:
            if t["code"] in earned_codes:
                continue
            if t.get("member_only") and not active_member:
                continue
            ck = t.get("condition_key")
            target = t.get("progress_target") or 0
            if not ck or not target:
                continue
            if only_keys is not None and ck not in only_keys:
                continue
            if counters.get(ck, 0) >= target:
                ok = await award_achievement(user_id, t["code"], {"auto_progress": True, "current": counters.get(ck), "target": target})
                if ok:
                    new_count += 1
    return new_count


# ---------------- Hooks (preserve old function names) ----------------
async def evaluate_membership_badges(user_id: str):
    await evaluate_user_progress(user_id)


async def _xp(user_id: str | None, source: str, ref: str, **kwargs) -> None:
    """XP (#617) gutschreiben, ohne dass ein Fehler den Auslöser stört."""
    if not user_id:
        return
    try:
        await xp.grant(user_id, source, ref, **kwargs)
    except Exception:  # noqa: BLE001
        logger.debug("xp grant failed", exc_info=True)


async def on_tournament_registered(user_id: str, tournament_id: str):
    await _xp(user_id, "tournament_registered", tournament_id)
    await evaluate_user_progress(user_id, {"tournament"})


async def on_checked_in(user_id: str, tournament_id: str):
    await _xp(user_id, "checked_in", tournament_id)
    await evaluate_user_progress(user_id, {"tournament"})


async def on_match_completed(winner_user_id: str, loser_user_id: str | None,
                              tournament_id: str, match_id: str):
    if winner_user_id:
        await _xp(winner_user_id, "match_played", match_id)
        await _xp(winner_user_id, "match_won", match_id)
        await evaluate_user_progress(winner_user_id, {"match", "tournament"})
    if loser_user_id:
        await _xp(loser_user_id, "match_played", match_id)
        await evaluate_user_progress(loser_user_id, {"match", "tournament"})


async def on_tournament_completed(tournament_id: str, placements: list[dict]):
    for p in placements:
        uid = p.get("user_id")
        if uid:
            await _xp(uid, "tournament_completed", tournament_id)
            rank = p.get("rank")
            if rank in (1, 2, 3):
                await _xp(uid, f"podium_{rank}", tournament_id)
            await evaluate_user_progress(uid, {"tournament", "season"})
            if rank == 4:
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
    stamp = now_utc().isoformat()
    await _xp(user_id, "lap_valid", f"{challenge_id}:{track_id}:{stamp}")
    if was_new_leader:
        await _xp(user_id, "pole", f"{challenge_id}:{track_id}:{stamp}")
    await evaluate_user_progress(user_id, {"fastlap"})


async def on_team_created(user_id: str, team_id: str):
    await _xp(user_id, "team_joined", team_id)
    await evaluate_user_progress(user_id, {"team"})


async def on_team_joined(user_id: str, team_id: str):
    await _xp(user_id, "team_joined", team_id)
    await evaluate_user_progress(user_id, {"team"})


# ---------- Phase B v4.1 — Negative incident trigger ----------


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
    """Saison abgeschlossen (#613): die Rangliste wird festgeschrieben (``season_standings``, vorher hat sie niemand
    geschrieben), jede platzierte Person bekommt XP, dann werden die Saison-Zähler und -Stufen neu ausgewertet -
    Saisonspitze, Saisonmeister, Volle Saison und Aufsteiger kommen aus dem Katalog B, nicht mehr aus festen Stufen.
    Liefert {awarded, ranked}.
    """
    db = get_db()
    from services.season_ranks import write_standings
    standings = await write_standings(db, season_id)
    awarded_total = 0
    for s in standings:
        uid = s.get("user_id")
        if not uid:
            continue
        await _xp(uid, "season_completed", season_id)
        try:
            awarded_total += int(await evaluate_user_progress(uid, ["season"]) or 0)
        except Exception:  # noqa: BLE001 - eine Person hält die anderen nicht auf
            logger.warning("season evaluation failed for %s", uid, exc_info=True)
    return {"awarded": awarded_total, "ranked": len(standings)}


# Die Warteschlange (services/achievement_queue.py) und der nächtliche Abgleich (services/achievement_counters.py)
# werten über services/achievement_core.py aus, ohne dieses Modul zu importieren (#1420). Der Umweg über den
# Modulnamen hält ``badges.evaluate_user_progress`` austauschbar (Tests ersetzen die Auswertung dort).
async def _evaluate_registered(*args, **kwargs) -> int:
    return await evaluate_user_progress(*args, **kwargs)


achievement_core.register_evaluator(_evaluate_registered)
