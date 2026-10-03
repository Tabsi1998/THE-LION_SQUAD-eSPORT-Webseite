"""Ehrungen aus der Mitgliederakte (#848): die eigenen sehen und selbst entscheiden, ob sie aufs öffentliche Profil kommen."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from auth import get_current_user
from database import get_db
from models import new_id, now_utc
from services import dolibarr_honours
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api", tags=["honours"])


class HonoursPublic(BaseModel):
    on: bool


@router.get("/me/honours")
async def my_honours(user: dict = Depends(get_current_user)):
    """Alle eigenen Ehrungen mit dem Hinweis, welche der Verein freigibt - oder warum es hier keine gibt."""
    return await dolibarr_honours.overview(get_db(), user)


@router.put("/me/honours/public")
async def set_honours_public(body: HonoursPublic, request: Request, user: dict = Depends(get_current_user)):
    """Der Schalter des Mitglieds: freigegebene Ehrungen aufs öffentliche Profil - oder wieder herunter."""
    await enforce_rate_limit(request, "honours:public", limit=20, window_seconds=3600, subject=user["id"])
    db = get_db()
    view = await dolibarr_honours.set_public(db, user, body.on)
    await db.audit_logs.insert_one({"id": new_id(), "action": "profile.honours_public", "target_id": user["id"], "actor_id": user["id"],
                                    "data": {"on": body.on}, "created_at": now_utc().isoformat()})
    return view
