"""Einladung zum Mitgliedsantrag (#507): Vorstand lädt ein, zieht zurück, sieht den Stand; das Konto sieht seine Einladung."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user, require_area
from database import get_db
from services import membership_invitations as invitations

router = APIRouter(prefix="/api", tags=["membership-invitations"])


class InvitationBody(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    note: str | None = Field(None, max_length=500)


@router.post("/admin/membership-invitations")
async def create_membership_invitation(body: InvitationBody, me: dict = Depends(require_area("club"))):
    try:
        return await invitations.create_invitation(get_db(), body.user_id, me, body.note or "")
    except invitations.InvitationError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail)


@router.get("/admin/membership-invitations")
async def list_membership_invitations(status: str | None = None, me: dict = Depends(require_area("club"))):
    if status and status not in (invitations.OPEN, invitations.APPLIED, invitations.WITHDRAWN, invitations.EXPIRED):
        raise HTTPException(status_code=400, detail="Unbekannter Stand.")
    return await invitations.list_invitations(get_db(), status)


@router.post("/admin/membership-invitations/{invitation_id}/withdraw")
async def withdraw_membership_invitation(invitation_id: str, me: dict = Depends(require_area("club"))):
    doc = await invitations.withdraw(get_db(), invitation_id, me.get("id"))
    if not doc:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden.")
    return doc


@router.get("/membership/invitation/me")
async def my_membership_invitation(me: dict = Depends(get_current_user)):
    return invitations.own_view(await invitations.open_invitation_for(get_db(), me["id"]))
