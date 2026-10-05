"""Öffentliche Events aus Dolibarr als Vorschlag unter Admin → Events (#850): übernehmen, ausblenden, Unterschiede klären.

Nur wer Events pflegt (Bereich „Turniere“, wie die Event-Seiten selbst). Die Website legt nie von selbst etwas an.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_admin
from database import get_db
from models import new_id, now_utc
from services import dolibarr_events

router = APIRouter(prefix="/api/admin/event-suggestions", tags=["events"])


class SettleBody(BaseModel):
    field: Literal["day", "end_day", "place", "status"]
    take: bool


async def _audit(me: dict, action: str, dolibarr_id: int, data: dict | None = None) -> None:
    await get_db().audit_logs.insert_one({"id": new_id(), "action": action, "target_id": str(dolibarr_id), "actor_id": me["id"],
                                          "data": data or {}, "created_at": now_utc().isoformat()})


@router.get("")
async def suggestions(me: dict = Depends(require_admin())):
    return await dolibarr_events.overview(get_db())


@router.post("/refresh")
async def refresh(me: dict = Depends(require_admin())):
    db = get_db()
    result = await dolibarr_events.refresh(db)
    return {**result, "view": await dolibarr_events.overview(db)}


@router.post("/{dolibarr_id}/adopt")
async def adopt(dolibarr_id: int, me: dict = Depends(require_admin())):
    try:
        result = await dolibarr_events.adopt(get_db(), me, dolibarr_id)
    except dolibarr_events.SuggestionError as exc:
        raise HTTPException(exc.status, exc.detail) from exc
    await _audit(me, "event.dolibarr_adopt", dolibarr_id, {"event_id": result["event_id"]})
    return result


@router.post("/{dolibarr_id}/dismiss")
async def dismiss(dolibarr_id: int, me: dict = Depends(require_admin())):
    try:
        view = await dolibarr_events.dismiss(get_db(), dolibarr_id)
    except dolibarr_events.SuggestionError as exc:
        raise HTTPException(exc.status, exc.detail) from exc
    await _audit(me, "event.dolibarr_dismiss", dolibarr_id)
    return view


@router.post("/{dolibarr_id}/settle")
async def settle(dolibarr_id: int, body: SettleBody, me: dict = Depends(require_admin())):
    try:
        view = await dolibarr_events.settle(get_db(), dolibarr_id, body.field, take=body.take)
    except dolibarr_events.SuggestionError as exc:
        raise HTTPException(exc.status, exc.detail) from exc
    await _audit(me, "event.dolibarr_settle", dolibarr_id, {"field": body.field, "take": body.take})
    return view
