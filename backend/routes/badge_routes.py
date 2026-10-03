"""Achievement routes (Phase B v4) — group-aware listing, admin CRUD, manual award.

Public/User endpoints (prefix /api/achievements):
  GET  /api/achievements/groups            — full public catalog (no locked negative tiers)
  GET  /api/achievements/me                — my catalog with progress + earned
  GET  /api/achievements/user/{user_id}    — public profile achievements
  POST /api/achievements/evaluate          — re-evaluate (auto-award) for self
  PUT  /api/achievements/me/pins           — bis zu sechs eigene Erfolge anheften (#619)
  GET  /api/achievements/me/summary        — Dashboard-Kachel: Level, Als Nächstes, letzte Freischaltung
  GET  /api/achievements/overview          — Kategorien, Seltenheit, Geheim-Zähler, Woche, Laufband (#619)
  GET  /api/achievements/leaderboard       — Punkte (je Kategorie/Zeitraum) oder Level
  GET  /api/achievements/week, /recent     — Erfolg der Woche, neueste Freischaltungen
  GET  /api/achievements/award/{id}        — Daten einer öffentlichen Vergabe für die Teilen-Seite
  GET  /api/achievements/share/{id}.png    — Teilen-Karte 1200×630 (Pillow)

Admin endpoints (prefix /api/admin/achievements):
  GET    /groups                          — all groups (incl. negative)
  POST   /groups                          — create group
  PATCH  /groups/{code}
  DELETE /groups/{code}                   — only if not seeded (is_admin_created=true)
  GET    /tiers
  POST   /tiers
  PATCH  /tiers/{code}
  DELETE /tiers/{code}
  POST   /award                           — manual award {user_id, tier_code, note, earned_at?, silent?}
  DELETE /award                           — revoke {user_id, tier_code, note}
  POST   /award/bulk                      — Massenvergabe (E10, nur Vorstand/Superadmin)
  GET    /overview, /catalog/check, /catalog/export, POST /catalog/import, GET /events,
         /season/{id}/preview, /xp/caps, POST /xp/prestige-reset, GET /stats, /stats.csv   (E10)
  GET    /negative/awards                 — admin-only list of negative awards
"""
import logging
import re

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional
from database import get_db
from auth import get_optional_user, get_current_user, require_admin, require_area
from badges import (
    award_achievement, can_award_tier_to_user, list_groups_for_user, list_user_awards,
    evaluate_user_progress, trigger_negative_incident, on_season_completed,
    NEGATIVE_INCIDENTS,
)
from models import now_utc, new_id
from achievement_catalog import CATEGORIES, CONDITION_KEY_STATUS, MATERIALS, annotate_tier
from services import achievement_visibility as visibility
from services import xp


logger = logging.getLogger(__name__)

# ============ Public/User ============
router = APIRouter(prefix="/api/achievements", tags=["achievements"])
STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}


@router.get("/groups")
async def public_groups(viewer: dict | None = Depends(get_optional_user)):
    return await list_groups_for_user(None, viewer)


@router.get("/me")
async def my_achievements(user: dict = Depends(get_current_user)):
    """Der eigene Stand: Katalog mit Fortschritt, Vergaben, dazu (#619) „Als Nächstes“, die Zahl der
    geheimen Gruppen, die angehefteten Erfolge, der Schalter „Erfolge öffentlich“ und der Level-Stand."""
    db = get_db()
    groups = await list_groups_for_user(user["id"], user)
    awards = await list_user_awards(user["id"], user)
    stored = await db.users.find_one({"id": user["id"]}, {"_id": 0, "pinned_achievements": 1, "privacy_achievements_public": 1}) or {}
    return {
        "groups": groups, "awards": awards,
        "next_up": visibility.next_up(groups),
        "hidden": await visibility.hidden_summary(db, user["id"]),
        "pinned": visibility.pinned_awards(stored, awards),
        "pinned_codes": list(stored.get("pinned_achievements") or []),
        "privacy_achievements_public": visibility.achievements_public(stored),
        "level": await xp.own_view(user["id"]),
    }


@router.get("/me/summary")
async def my_summary(user: dict = Depends(get_current_user)):
    """Die Dashboard-Kachel „Deine Erfolge“ (#619): Level, „Als Nächstes“, letzte Freischaltung, Zähler."""
    groups = await list_groups_for_user(user["id"], user)
    awards = await list_user_awards(user["id"], user)
    return await visibility.my_summary(get_db(), user["id"], groups, awards)


class PinsBody(BaseModel):
    tier_codes: list[str] = Field(default_factory=list, max_length=12)


@router.put("/me/pins")
async def set_my_pins(body: PinsBody, user: dict = Depends(get_current_user)):
    """Bis zu sechs eigene Erfolge anheften (#619) - die Reihenfolge ist die Anzeige-Reihenfolge."""
    db = get_db()
    try:
        codes = await visibility.set_pins(db, user["id"], body.tier_codes)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    awards = await list_user_awards(user["id"], user)
    return {"pinned_codes": codes, "pinned": visibility.pinned_awards({"pinned_achievements": codes}, awards)}


@router.get("/user/{user_id}")
async def user_achievements(user_id: str, viewer: dict | None = Depends(get_optional_user)):
    """Erfolge einer anderen Person (#619): nur mit öffentlichem Profil und dem Schalter „Erfolge
    öffentlich“; die Verein-Kategorie sehen nur Mitglieder und das Admin-Team."""
    db = get_db()
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "privacy_public_profile": 1, "privacy_achievements_public": 1, "pinned_achievements": 1})
    if not user:
        raise HTTPException(404, "Nutzer nicht gefunden.")
    viewer_is_owner = bool(viewer and viewer.get("id") == user_id)
    viewer_is_staff = bool(viewer and viewer.get("role") in STAFF_ROLES)
    if not user.get("privacy_public_profile") and not (viewer_is_owner or viewer_is_staff):
        raise HTTPException(404, "Nutzer nicht gefunden.")
    if not visibility.achievements_public(user) and not (viewer_is_owner or viewer_is_staff):
        return {"groups": [], "awards": [], "pinned": [], "hidden": {"total": 0, "earned": 0}, "achievements_hidden": True}
    groups = await list_groups_for_user(user_id, viewer)
    awards = await list_user_awards(user_id, viewer)
    if not await visibility.viewer_sees_club(db, viewer, user_id):
        groups, awards = visibility.without_club(groups, awards)
    return {
        "groups": groups, "awards": awards,
        "pinned": visibility.pinned_awards(user, awards),
        "hidden": await visibility.hidden_summary(db, user_id),
        "achievements_hidden": False,
    }


@router.get("/overview")
async def achievements_overview(viewer: dict | None = Depends(get_optional_user)):
    """Alles für den Schaukasten (#619) in einem Aufruf: Kategorien mit dem Fortschritt der Community,
    Seltenheit je Gruppe und Stufe, die Zahl der geheimen Gruppen, der Erfolg der Woche, das Laufband."""
    db = get_db()
    rarity_data = await visibility.rarity(db)
    return {
        "categories": await visibility.category_overview(db, rarity_data=rarity_data),
        "rarity": {"base": rarity_data["base"], "members_base": rarity_data["members_base"], "groups": rarity_data["groups"],
                   "tiers": {code: row["percent"] for code, row in rarity_data["tiers"].items()}},
        "hidden": await visibility.hidden_summary(db, viewer["id"] if viewer else None),
        "week": await visibility.achievement_of_week(db),
        "recent": await visibility.recent_unlocks(db, 20),
    }


@router.get("/award/{award_id}")
async def shared_award(award_id: str):
    """Die Teilen-Seite (#619): die Daten einer öffentlichen Vergabe - 404, wenn sie nicht geteilt werden darf."""
    from services.achievement_share import share_payload
    payload = await share_payload(get_db(), award_id)
    if not payload:
        raise HTTPException(404, "Dieser Erfolg ist nicht öffentlich.")
    return payload


@router.get("/share/{award_id}.png")
async def shared_award_card(award_id: str):
    """Die Teilen-Karte (#619): 1200×630 als PNG, serverseitig gezeichnet (Pillow, ohne Browser)."""
    from fastapi.responses import Response
    from services.achievement_share import render_card, share_payload
    payload = await share_payload(get_db(), award_id)
    if not payload:
        raise HTTPException(404, "Dieser Erfolg ist nicht öffentlich.")
    return Response(content=render_card(payload), media_type="image/png",
                    headers={"Content-Disposition": f'inline; filename="achievement-{award_id}.png"'})


@router.get("/week")
async def achievement_of_week():
    """Der Erfolg der Woche (#619) - dieselbe Kachel für Web, App und Discord (E12)."""
    return await visibility.achievement_of_week(get_db())


@router.get("/recent")
async def recent_unlocks(limit: int = 20):
    """Die neuesten Freischaltungen öffentlicher Profile (#619) - das Laufband."""
    return await visibility.recent_unlocks(get_db(), limit)


@router.post("/evaluate")
async def evaluate_self(user: dict = Depends(get_current_user)):
    n = await evaluate_user_progress(user["id"])
    return {"newly_awarded": n}


@router.get("/leaderboard")
async def achievements_leaderboard(limit: int = 24, by: str = "points", category: str | None = None, period: str = "all",
                                   viewer: dict | None = Depends(get_optional_user)):
    """Rangliste nach Erfolgspunkten (ohne Negatives, nur öffentliche Profile) oder nach Level (#617);
    seit #619 wahlweise je Kategorie und Zeitraum (gesamt, Jahr, Saison, Monat)."""
    if by == "level":
        return await xp.leaderboard(limit)
    if category and category not in CATEGORIES:
        raise HTTPException(422, "Unbekannte Kategorie.")
    if period not in visibility.PERIODS:
        raise HTTPException(422, "Unbekannter Zeitraum.")
    return await visibility.leaderboard(get_db(), category=category or None, period=period, limit=limit)


@router.get("/crowns")
async def achievement_crowns():
    """Dynamic crowns: best three non-obsidian players get gold/silver/bronze,
    players at level 30+ get the obsidian crown. Transitions trigger notifications."""
    from services.crown_events import get_crowns
    return {"crowns": await get_crowns()}


# ============ Admin CRUD ============
admin_router = APIRouter(prefix="/api/admin/achievements", tags=["achievements-admin"])


# ---- Auswertung sofort (#301) ----
@admin_router.get("/evaluation")
async def evaluation_state(me: dict = Depends(require_area("content"))):
    from services.achievement_queue import queue_state
    return await queue_state()


@admin_router.post("/evaluation/all")
async def evaluate_everyone(me: dict = Depends(require_area("content"))):
    """Alle Konten vormerken; abgearbeitet wird im Hintergrund, 100 je halber Minute."""
    from services.achievement_queue import sweep
    result = await sweep(everyone=True)
    await _log(me, "evaluate_all", data=result if isinstance(result, dict) else {})
    return result


async def _log(me: dict, kind: str, **kwargs) -> None:
    """Jede Admin-Aktion ins Protokoll (E10) - Katalog-Änderungen, Vorfälle, Auswertungen."""
    from services import achievement_admin
    await achievement_admin.log_event(get_db(), kind, me, **kwargs)


# ---- Group CRUD ----
class GroupCreate(BaseModel):
    code: str = Field(min_length=2, max_length=80)
    name: str
    category: str = "special"
    icon: str = "trophy"
    accent_color: str = "#FF3B30"
    description: str = ""
    public: bool = True
    is_special: bool = True
    is_negative: bool = False
    hidden: bool = False
    how_to: str = ""
    art: Optional[str] = None
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
    hidden: Optional[bool] = None
    how_to: Optional[str] = None
    art: Optional[str] = None
    sort_order: Optional[int] = None


def _check_category(category: str | None) -> None:
    if category is not None and category not in CATEGORIES:
        raise HTTPException(400, f"Unbekannte Kategorie „{category}“ – erlaubt: {', '.join(CATEGORIES)}.")


def _check_material(material: str | None) -> None:
    if material is not None and material not in MATERIALS:
        raise HTTPException(400, f"Unbekanntes Material „{material}“ – erlaubt: {', '.join(MATERIALS)}.")


@admin_router.get("/groups")
async def admin_list_groups(me: dict = Depends(require_area("content"))):
    db = get_db()
    return await db.achievement_groups.find({}, {"_id": 0}).sort("sort_order", 1).to_list(500)


@admin_router.post("/groups")
async def admin_create_group(body: GroupCreate, me: dict = Depends(require_area("content"))):
    db = get_db()
    _check_category(body.category)
    if await db.achievement_groups.find_one({"code": body.code}):
        raise HTTPException(409, "Code bereits vergeben.")
    doc = {**body.model_dump(), "id": body.code, "is_admin_created": True,
           "created_at": now_utc().isoformat(), "created_by": me["id"]}
    await db.achievement_groups.insert_one(doc)
    doc.pop("_id", None)
    await _log(me, "group_create", data={"group": body.code, "name": body.name})
    return doc


@admin_router.put("/groups/{code}")
@admin_router.patch("/groups/{code}")
async def admin_patch_group(code: str, body: GroupPatch, me: dict = Depends(require_area("content"))):
    db = get_db()
    nullable_fields = {"description", "accent_color"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    _check_category(updates.get("category"))
    if not updates:
        raise HTTPException(400, "Keine Änderungen.")
    res = await db.achievement_groups.update_one({"code": code}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Group nicht gefunden.")
    saved = await db.achievement_groups.find_one({"code": code}, {"_id": 0})
    await _log(me, "group_update", data={"group": code, "name": saved.get("name"), "fields": sorted(updates)})
    return saved


@admin_router.delete("/groups/{code}")
async def admin_delete_group(code: str, me: dict = Depends(require_area("content"))):
    db = get_db()
    g = await db.achievement_groups.find_one({"code": code})
    if not g:
        raise HTTPException(404, "Group nicht gefunden.")
    if not g.get("is_admin_created"):
        raise HTTPException(400, "System-Group kann nicht gelöscht werden — deaktivieren via public=false.")
    await db.achievements.delete_many({"group_code": code})
    removed = await db.user_achievements.delete_many({"group_code": code})
    await db.achievement_groups.delete_one({"code": code})
    await _log(me, "group_delete", data={"group": code, "name": g.get("name"), "awards_removed": removed.deleted_count})
    return {"ok": True}


# ---- Tier CRUD ----
class TierCreate(BaseModel):
    code: str = Field(min_length=2, max_length=80)
    group_code: str
    # Erfolge II (#611): Material ist die Wahrheit, level (1–5) bleibt für alte Formulare.
    material: Optional[str] = None
    level: Optional[int] = Field(None, ge=1, le=5)
    name: str
    description: str = ""
    how_to: Optional[str] = None
    art: Optional[str] = None
    condition_key: Optional[str] = None
    progress_target: Optional[int] = None
    points: Optional[int] = None
    icon: Optional[str] = None
    manual_only: bool = False
    member_only: bool = False


class TierPatch(BaseModel):
    material: Optional[str] = None
    level: Optional[int] = None
    how_to: Optional[str] = None
    art: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    condition_key: Optional[str] = None
    progress_target: Optional[int] = None
    points: Optional[int] = None
    icon: Optional[str] = None
    manual_only: Optional[bool] = None
    member_only: Optional[bool] = None


@admin_router.get("/tiers")
async def admin_list_tiers(group_code: Optional[str] = None,
                            me: dict = Depends(require_area("content"))):
    db = get_db()
    q: dict = {}
    if group_code:
        q["group_code"] = group_code
    tiers = await db.achievements.find(q, {"_id": 0}).sort([("group_code", 1), ("rank", 1), ("level", 1)]).to_list(2000)
    for tier in tiers:
        key = tier.get("condition_key")
        tier["condition_status"] = CONDITION_KEY_STATUS.get(key) if key else None
    return tiers


@admin_router.post("/tiers")
async def admin_create_tier(body: TierCreate, me: dict = Depends(require_area("content"))):
    db = get_db()
    if not await db.achievement_groups.find_one({"code": body.group_code}):
        raise HTTPException(404, "Group nicht gefunden.")
    if await db.achievements.find_one({"code": body.code}):
        raise HTTPException(409, "Tier-Code bereits vergeben.")
    _check_material(body.material)
    group = await db.achievement_groups.find_one({"code": body.group_code}, {"_id": 0})
    raw = body.model_dump()
    if raw.get("points") is None:
        raw.pop("points")
    if raw.get("material") is None:
        raw.pop("material")
        raw["level"] = raw.get("level") or 1
    doc = annotate_tier(raw, group)
    if body.points is None:
        from achievement_catalog import material_points
        doc["points"] = material_points(doc["material"])
    doc.update({"id": body.code, "created_at": now_utc().isoformat()})
    await db.achievements.insert_one(doc)
    doc.pop("_id", None)
    await _log(me, "tier_create", tier_code=body.code, data={"group": body.group_code, "name": body.name})
    return doc


@admin_router.put("/tiers/{code}")
@admin_router.patch("/tiers/{code}")
async def admin_patch_tier(code: str, body: TierPatch, me: dict = Depends(require_area("content"))):
    db = get_db()
    nullable_fields = {"description", "condition_key", "progress_target", "icon"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    _check_material(updates.get("material"))
    if not updates:
        raise HTTPException(400, "Keine Änderungen.")
    current = await db.achievements.find_one({"code": code}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Tier nicht gefunden.")
    if updates.get("material") and updates["material"] != current.get("material"):
        await _check_ladder_move(db, current, updates["material"])
    if "material" in updates or "level" in updates:
        merged = {**current, **updates}
        if "material" not in updates:
            merged.pop("material", None)  # neues Level ohne Material: Material folgt dem Level
        group = await db.achievement_groups.find_one({"code": current.get("group_code")}, {"_id": 0})
        annotated = annotate_tier(merged, group)
        updates.update({k: annotated[k] for k in ("material", "rank", "material_name", "material_color", "level")})
    res = await db.achievements.update_one({"code": code}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Tier nicht gefunden.")
    saved = await db.achievements.find_one({"code": code}, {"_id": 0})
    await _log(me, "tier_update", tier_code=code, data={"group": current.get("group_code"), "fields": sorted(raw)})
    return saved


async def _check_ladder_move(db, current: dict, material: str) -> None:
    """Materialwechsel nur innerhalb der Leiter Holz bis Diamant und nur zwischen den Nachbarstufen der Gruppe -
    sonst stünde die Stufe über oder unter einer anderen, und die Ziele stiegen nicht mehr."""
    ladder = lambda m: m in MATERIALS and MATERIALS[m]["rank"] <= 7  # noqa: E731
    if not ladder(current.get("material")) or not ladder(material):
        raise HTTPException(400, "Das Material wechselt nur innerhalb der Leiter Holz bis Diamant.")
    own = MATERIALS[current["material"]]["rank"]
    ranks = [MATERIALS[t["material"]]["rank"] async for t in db.achievements.find({"group_code": current.get("group_code"), "code": {"$ne": current["code"]}}, {"_id": 0, "material": 1}) if t.get("material") in MATERIALS]
    lower = max((r for r in ranks if r < own), default=0)
    upper = min((r for r in ranks if r > own), default=8)
    if not lower < MATERIALS[material]["rank"] < upper:
        names = {m["rank"]: m["name"] for m in MATERIALS.values()}
        span = " und ".join(n for n in (names.get(lower), names.get(upper)) if n and n not in ("Legendär", "Geheim"))
        raise HTTPException(400, f"Das Material muss zwischen den Nachbarstufen bleiben ({span})." if span else "Das Material passt nicht in die Leiter.")


@admin_router.delete("/tiers/{code}")
async def admin_delete_tier(code: str, me: dict = Depends(require_area("content"))):
    db = get_db()
    tier = await db.achievements.find_one({"code": code}, {"_id": 0, "name": 1, "group_code": 1})
    res = await db.achievements.delete_one({"code": code})
    if res.deleted_count == 0:
        raise HTTPException(404, "Tier nicht gefunden.")
    removed = await db.user_achievements.delete_many({"tier_code": code})
    await _log(me, "tier_delete", data={"tier": code, "name": (tier or {}).get("name"), "group": (tier or {}).get("group_code"), "awards_removed": removed.deleted_count})
    return {"ok": True}


# ---- XP-Korrektur (#617) ----
class XpCorrection(BaseModel):
    user_id: str
    amount: int = Field(ge=-100000, le=100000)
    reason: str = Field(min_length=3, max_length=300)


@admin_router.post("/xp")
async def admin_xp_correction(body: XpCorrection, me: dict = Depends(require_area("content"))):
    """XP von Hand berichtigen - plus oder minus, immer mit Grund, immer im Protokoll."""
    from services import xp
    db = get_db()
    if not await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Nutzer nicht gefunden.")
    if body.amount == 0:
        raise HTTPException(400, "Null XP ändern nichts.")
    await _require_board(me)
    await xp.correct(body.user_id, body.amount, body.reason.strip(), me["id"])
    from services import achievement_admin
    await achievement_admin.log_event(db, "xp", me, user_id=body.user_id, note=body.reason.strip(), data={"amount": body.amount})
    return await xp.view(body.user_id)


# ---- Manual award/revoke (E10, #620: Datum wahlweise rückwirkend, „ohne Zeremonie“, Grund, Protokoll) ----
class AwardBody(BaseModel):
    user_id: str
    tier_code: str
    note: Optional[str] = None
    earned_at: Optional[str] = None
    silent: bool = False
    notify: bool = True


async def _is_board(me: dict) -> bool:
    """Massenvergabe, Import und XP-Eingriffe: nur Superadmin oder wer einen Vorstandsposten hält."""
    from services.permissions import is_board_holder
    return me.get("role") == "superadmin" or bool(await is_board_holder(get_db(), me.get("id")))


async def _require_board(me: dict) -> None:
    if not await _is_board(me):
        raise HTTPException(403, "Nur der Vorstand oder die Systemverwaltung darf das.")


@admin_router.post("/award")
async def admin_award(body: AwardBody, me: dict = Depends(require_area("content"))):
    from services import achievement_admin
    db = get_db()
    try:
        result = await achievement_admin.award_with_options(db, me, body.user_id, body.tier_code, note=body.note, earned_at=body.earned_at, silent=body.silent, notify=body.notify)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if result.get("newly_awarded"):
        await db.audit_logs.insert_one({
            "id": new_id(),
            "action": "achievement.manual_award",
            "actor_id": me["id"], "target_id": body.user_id,
            "data": {"tier_code": body.tier_code, "note": body.note, "earned_at": result.get("earned_at"), "silent": body.silent, "notify": body.notify},
            "created_at": now_utc().isoformat(),
        })
    return result


@admin_router.delete("/award")
async def admin_revoke(body: AwardBody, me: dict = Depends(require_area("content"))):
    from services import achievement_admin
    db = get_db()
    try:
        await achievement_admin.revoke_with_reason(db, me, body.user_id, body.tier_code, note=body.note)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    try:
        from services.crown_events import schedule_crown_sync
        schedule_crown_sync()
    except Exception:
        logger.warning("Crown sync could not be scheduled after revoking an achievement", exc_info=True)
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "achievement.manual_revoke",
        "actor_id": me["id"], "target_id": body.user_id,
        "data": {"tier_code": body.tier_code, "note": body.note},
        "created_at": now_utc().isoformat(),
    })
    return {"ok": True}


class BulkAwardBody(BaseModel):
    tier_code: str
    user_ids: list[str] = Field(default_factory=list, max_length=600)
    # Aus einer CSV-Liste: Benutzername, E-Mail oder Konto-ID je Zeile.
    names: list[str] = Field(default_factory=list, max_length=600)
    tournament_id: Optional[str] = None
    event_id: Optional[str] = None
    team_id: Optional[str] = None
    members: bool = False
    role: Optional[str] = None
    note: Optional[str] = None
    earned_at: Optional[str] = None
    silent: bool = False
    notify: bool = True
    dry_run: bool = False


@admin_router.post("/award/bulk")
async def admin_bulk_award(body: BulkAwardBody, me: dict = Depends(require_area("content"))):
    """Massenvergabe (E10): Liste, Turnier-/Event-Teilnehmer, Team, Mitglieder oder Rolle - bis 500 auf einmal."""
    await _require_board(me)
    from services import achievement_admin
    selection = {"user_ids": body.user_ids, "names": body.names, "tournament_id": body.tournament_id, "event_id": body.event_id, "team_id": body.team_id, "members": body.members, "role": body.role}
    try:
        return await achievement_admin.bulk_award(get_db(), me, body.tier_code, selection, note=body.note, earned_at=body.earned_at, silent=body.silent, notify=body.notify, dry_run=body.dry_run)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@admin_router.get("/events")
async def admin_events(limit: int = 100, kind: Optional[str] = None, user_id: Optional[str] = None, me: dict = Depends(require_area("content"))):
    """Das Protokoll (E10): Vergaben, Rücknahmen, Massenvergaben, XP, Prestige, Saison, Import."""
    from services import achievement_admin
    return await achievement_admin.list_events(get_db(), limit=limit, kind=kind, user_id=user_id)


@admin_router.get("/overview")
async def admin_overview(me: dict = Depends(require_area("content"))):
    from services import achievement_admin
    return await achievement_admin.overview(get_db())


@admin_router.get("/me")
async def admin_rights(me: dict = Depends(require_area("content"))):
    """Was diese Person im Erfolge-Admin darf: Massenvergabe, Import und XP-Eingriffe nur mit ``board``."""
    return {"board": await _is_board(me)}


@admin_router.get("/users/{user_id}/awards")
async def admin_user_awards(user_id: str, me: dict = Depends(require_area("content"))):
    """Alle Erfolge einer Person für die Rücknahme im Admin - mit Namen, Material, Datum, still und Notiz."""
    db = get_db()
    if not await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Nutzer nicht gefunden.")
    awards = await db.user_achievements.find({"user_id": user_id}, {"_id": 0}).sort("earned_at", -1).to_list(2000)
    tiers = {t["code"]: t async for t in db.achievements.find({"code": {"$in": [a["tier_code"] for a in awards]}}, {"_id": 0, "code": 1, "name": 1, "group_code": 1, "material": 1, "art": 1, "icon": 1})}
    groups = {g["code"]: g async for g in db.achievement_groups.find({"code": {"$in": list({a.get("group_code") for a in awards})}}, {"_id": 0, "code": 1, "name": 1, "is_negative": 1, "art": 1})}
    out = []
    for a in awards:
        tier = tiers.get(a["tier_code"], {})
        group = groups.get(a.get("group_code"), {})
        out.append({
            "tier_code": a["tier_code"], "tier_name": tier.get("name"), "group_name": group.get("name"), "material": a.get("material") or tier.get("material"),
            "art": tier.get("art") or group.get("art"), "icon": tier.get("icon"), "earned_at": a.get("earned_at"), "silent": bool(a.get("silent")),
            "note": (a.get("context") or {}).get("note"), "is_negative": bool(group.get("is_negative")),
        })
    return out


@admin_router.get("/catalog/check")
async def admin_catalog_check(me: dict = Depends(require_area("content"))):
    """Die Katalog-Prüfung (E10): dieselben Regeln wie der Test, auf dem Stand der Datenbank."""
    from services import achievement_admin
    return await achievement_admin.catalog_check(get_db())


@admin_router.get("/catalog/export")
async def admin_catalog_export(me: dict = Depends(require_area("content"))):
    from services import achievement_admin
    return await achievement_admin.export_catalog(get_db())


class CatalogImportBody(BaseModel):
    groups: list = Field(default_factory=list)
    tiers: list = Field(default_factory=list)
    dry_run: bool = False


@admin_router.post("/catalog/import")
async def admin_catalog_import(body: CatalogImportBody, me: dict = Depends(require_area("content"))):
    await _require_board(me)
    from services import achievement_admin
    try:
        return await achievement_admin.import_catalog(get_db(), {"groups": body.groups, "tiers": body.tiers}, me, dry_run=body.dry_run)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@admin_router.get("/season/{season_id}/preview")
async def admin_season_preview(season_id: str, me: dict = Depends(require_area("content"))):
    from services import achievement_admin
    try:
        return await achievement_admin.season_preview(get_db(), season_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc))


@admin_router.get("/xp/caps")
async def admin_xp_caps(user_id: str, me: dict = Depends(require_area("content"))):
    from services import achievement_admin
    db = get_db()
    if not await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Nutzer nicht gefunden.")
    return await achievement_admin.xp_caps(db, user_id)


class PrestigeResetBody(BaseModel):
    user_id: str
    reason: str = Field(min_length=3, max_length=300)


@admin_router.post("/xp/prestige-reset")
async def admin_prestige_reset(body: PrestigeResetBody, me: dict = Depends(require_area("content"))):
    await _require_board(me)
    from services import achievement_admin
    db = get_db()
    if not await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Nutzer nicht gefunden.")
    return await achievement_admin.prestige_reset(db, me, body.user_id, body.reason.strip())


@admin_router.get("/stats")
async def admin_stats(me: dict = Depends(require_area("content"))):
    from services import achievement_admin
    return await achievement_admin.stats(get_db())


@admin_router.get("/stats.csv")
async def admin_stats_csv(me: dict = Depends(require_area("content"))):
    from fastapi.responses import Response
    from services import achievement_admin
    data = await achievement_admin.stats(get_db())
    return Response(content=achievement_admin.stats_csv(data), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="achievements-statistik.csv"'})


@admin_router.get("/negative/awards")
async def admin_list_negative_awards(me: dict = Depends(require_area("content"))):
    """List all awarded negative achievements with user info — admin-only view."""
    db = get_db()
    neg_groups = [g["code"] async for g in db.achievement_groups.find({"is_negative": True}, {"_id": 0, "code": 1})]
    awards = await db.user_achievements.find({"group_code": {"$in": neg_groups}}, {"_id": 0}).sort("earned_at", -1).to_list(2000)
    user_ids = list({a["user_id"] for a in awards})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "email": 1}).to_list(500)}
    tiers_map = {t["code"]: t async for t in db.achievements.find({}, {"_id": 0, "code": 1, "name": 1, "group_code": 1, "icon": 1, "art": 1, "material": 1})}
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
            "art": t.get("art"), "icon": t.get("icon"), "material": t.get("material") or "hidden",
            "earned_at": a["earned_at"],
            "context": a.get("context", {}),
        })
    return out


@admin_router.get("/users/search")
async def admin_search_users(q: str = "", me: dict = Depends(require_area("content"))):
    """Quick user search for the admin manual-award picker."""
    db = get_db()
    query: dict = {}
    if q:
        rx = {"$regex": re.escape(q.strip()[:80]), "$options": "i"}
        query = {"$or": [{"username": rx}, {"display_name": rx}, {"email": rx}]}
    users = await db.users.find(
        query,
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "display_name": 1,
            "avatar_url": 1,
            "email": 1,
            "is_club_member": 1,
        },
    ).limit(20).to_list(20)
    return users


# ---- Phase B v4.1 — Negative incident trigger ----
class IncidentBody(BaseModel):
    user_id: str
    incident_type: str  # one of NEGATIVE_INCIDENTS keys
    note: Optional[str] = None
    match_id: Optional[str] = None


@admin_router.get("/incident-types")
async def admin_incident_types(me: dict = Depends(require_area("content"))):
    return [{"key": k, "tier_code": v} for k, v in NEGATIVE_INCIDENTS.items()]


@admin_router.post("/trigger-incident")
async def admin_trigger_incident(body: IncidentBody, me: dict = Depends(require_area("content"))):
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
    if code:
        await _log(me, "incident", user_id=body.user_id, tier_code=code, note=body.note, data={"incident_type": body.incident_type})
    return {"ok": True, "tier_code": code, "newly_awarded": bool(code)}


# ---- Phase B v4.1 — Season completion ----
@admin_router.post("/season/{season_id}/award")
async def admin_season_award(season_id: str, me: dict = Depends(require_area("content"))):
    db = get_db()
    season = await db.seasons.find_one({"id": season_id}, {"_id": 0, "id": 1, "status": 1})
    if not season:
        raise HTTPException(404, "Saison nicht gefunden.")
    if season.get("status") not in ("completed", "archived"):
        raise HTTPException(400, "Die Saison läuft noch. Abgeschlossen wird sie in der Jahreswertung – dabei werden die Saison-Erfolge von selbst vergeben.")
    result = await on_season_completed(season_id)
    from services import achievement_admin
    await achievement_admin.log_event(db, "season_award", me, data={"season_id": season_id, **result})
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "achievement.season_award",
        "actor_id": me["id"], "target_id": season_id,
        "data": result,
        "created_at": now_utc().isoformat(),
    })
    return result
