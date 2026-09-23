"""Auszeichnungen (#230): eigene Banner und Trophäen, Profilbanner wählen, Nachtragen für alte Turniere."""
from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user, require_area
from database import get_db
from services.awards import awards_for_user, feature_award_for_user, rebuild_all_awards

router = APIRouter(prefix="/api", tags=["awards"])


@router.get("/me/awards")
async def my_awards(user: dict = Depends(get_current_user)):
    db = get_db()
    awards = await awards_for_user(db, user["id"], public_only=False)
    me = await db.users.find_one({"id": user["id"]}, {"_id": 0, "featured_award_id": 1}) or {}
    return {"awards": awards, "featured_award_id": me.get("featured_award_id")}


@router.post("/me/awards/{award_id}/feature")
async def feature_award(award_id: str, user: dict = Depends(get_current_user)):
    """Diese Auszeichnung als Profilbanner zeigen - nur eine eigene."""
    chosen = await feature_award_for_user(get_db(), user["id"], award_id)
    if not chosen:
        raise HTTPException(404, "Auszeichnung nicht gefunden.")
    return {"ok": True, "featured_award": chosen}


@router.delete("/me/awards/feature")
async def unfeature_award(user: dict = Depends(get_current_user)):
    await feature_award_for_user(get_db(), user["id"], None)
    return {"ok": True, "featured_award": None}


@router.post("/admin/awards/rebuild")
async def rebuild_awards(me: dict = Depends(require_area("tournaments"))):
    """Für alle Turniere mit veröffentlichten Ergebnissen nachtragen - idempotent."""
    return await rebuild_all_awards(get_db())
