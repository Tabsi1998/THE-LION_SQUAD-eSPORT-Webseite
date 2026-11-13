"""Auszeichnungen (#230): eigene Banner und Trophäen, Profilbanner wählen, Nachtragen für alte Turniere."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user, require_area
from database import get_db
from models import new_id, now_utc
from services.awards import awards_for_user, feature_award_for_user, rebuild_all_awards

router = APIRouter(prefix="/api", tags=["awards"])


@router.get("/me/awards")
async def my_awards(user: dict = Depends(get_current_user)):
    db = get_db()
    awards = await awards_for_user(db, user["id"], public_only=False)
    me = await db.users.find_one({"id": user["id"]}, {"_id": 0, "featured_award_id": 1, "featured_title_award_id": 1}) or {}
    return {"awards": awards, "featured_award_id": me.get("featured_award_id"), "featured_title_award_id": me.get("featured_title_award_id")}


@router.post("/me/awards/{award_id}/feature")
async def feature_award(award_id: str, slot: Literal["banner", "title"] = "banner", user: dict = Depends(get_current_user)):
    """Diese Auszeichnung als Profilbanner zeigen - nur eine eigene. ``slot=title``: als Titel neben dem Namen (F.4, nur Art „Titel“)."""
    chosen = await feature_award_for_user(get_db(), user["id"], award_id, slot)
    if not chosen:
        raise HTTPException(404, "Auszeichnung nicht gefunden." if slot == "banner" else "Titel nicht gefunden.")
    return {"ok": True, "featured_award": chosen, "slot": slot}


@router.delete("/me/awards/feature")
async def unfeature_award(slot: Literal["banner", "title"] = "banner", user: dict = Depends(get_current_user)):
    await feature_award_for_user(get_db(), user["id"], None, slot)
    return {"ok": True, "featured_award": None, "slot": slot}


@router.post("/admin/awards/rebuild")
async def rebuild_awards(me: dict = Depends(require_area("system"))):
    """Für alle Turniere mit veröffentlichten Ergebnissen nachtragen - idempotent. Ein Wartungsgriff (#2112): nur System,
    mit Protokoll."""
    db = get_db()
    result = await rebuild_all_awards(db)
    await db.audit_logs.insert_one({"id": new_id(), "action": "awards.rebuild", "actor_id": me["id"], "target_id": "tournament_awards",
                                    "data": result, "created_at": now_utc().isoformat()})
    return result
