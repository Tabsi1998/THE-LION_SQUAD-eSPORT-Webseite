"""Einlass bei der Generalversammlung (#845): Mitgliedskarte scannen oder Mitgliedsnummer eintippen, Rücknahme mit Grund.

Nur die Vereinsverwaltung (Bereich „Verein“) kommt hierher; ob die scannende Person am Tag im Vorstand ist, entscheidet
das Vereinsmodul bei jedem Einlass selbst.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import require_area
from database import get_db
from models import new_id, now_utc
from services import dolibarr_admission
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/admin/admission", tags=["admission"])


class ScanBody(BaseModel):
    code: str = Field("", max_length=300)
    number: str = Field("", max_length=40)


class UndoBody(BaseModel):
    member_id: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=200)


async def _audit(me: dict, action: str, meeting_id: int, data: dict) -> None:
    await get_db().audit_logs.insert_one({"id": new_id(), "action": action, "target_id": str(meeting_id), "actor_id": me["id"],
                                          "data": data, "created_at": now_utc().isoformat()})


@router.get("")
async def admission_overview(me: dict = Depends(require_area("club"))):
    """Die Generalversammlungen von heute, ihre letzten Zahlen und die letzten Einlässe - oder warum es nicht geht."""
    try:
        return await dolibarr_admission.overview(get_db(), me)
    except dolibarr_admission.AdmissionError as exc:
        raise HTTPException(exc.status, exc.detail) from exc


@router.post("/{meeting_id}/scan")
async def admission_scan(meeting_id: int, body: ScanBody, request: Request, me: dict = Depends(require_area("club"))):
    await enforce_rate_limit(request, "admission:scan", limit=600, window_seconds=3600, subject=me["id"])
    if not (body.code or body.number):
        raise HTTPException(400, "Karte scannen oder Mitgliedsnummer eintragen.")
    try:
        result = await dolibarr_admission.admit(get_db(), me, meeting_id, code=body.code, number=body.number)
    except dolibarr_admission.AdmissionError as exc:
        raise HTTPException(exc.status, exc.detail) from exc
    await _audit(me, "meeting.admission", meeting_id, {"member_id": result["admission"]["member_id"], "via": "card" if body.code else "number",
                                                       "already": result["already"]})
    return result


@router.post("/{meeting_id}/undo")
async def admission_undo(meeting_id: int, body: UndoBody, request: Request, me: dict = Depends(require_area("club"))):
    await enforce_rate_limit(request, "admission:undo", limit=60, window_seconds=3600, subject=me["id"])
    try:
        result = await dolibarr_admission.undo(get_db(), me, meeting_id, body.member_id, body.reason)
    except dolibarr_admission.AdmissionError as exc:
        raise HTTPException(exc.status, exc.detail) from exc
    await _audit(me, "meeting.admission_undo", meeting_id, {"member_id": body.member_id, "reason": body.reason})
    return result
