"""Rückmeldung nach Turnier oder Event (#1196) - nur für den Verein, ohne Namen.

- ``GET  /api/feedback/open``                          was du gerade bewerten kannst (auch als Zeile in „Offene Aktionen“)
- ``POST /api/feedback/{kind}/{target_id}``            Sterne, Stichworte, ein Satz - einmal je Turnier bzw. Event
- ``POST /api/feedback/{kind}/{target_id}/decline``    „Lieber nicht“ - dann fragt niemand mehr
- ``GET  /api/admin/feedback/{kind}/{target_id}``      Auswertung für die Turnierleitung (Schnitt, Stichworte, Sätze)
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from auth import get_current_user, require_area
from database import get_db
from services import feedback

router = APIRouter(prefix="/api/feedback", tags=["feedback"])
admin_router = APIRouter(prefix="/api/admin/feedback", tags=["feedback"])

Kind = Literal["tournament", "event"]


class FeedbackBody(BaseModel):
    stars: int = Field(ge=1, le=5)
    tags: list[str] = Field(default_factory=list, max_length=len(feedback.TAGS))
    text: str = Field(default="", max_length=feedback.TEXT_MAX)


@router.get("/open")
async def open_feedback(me: dict = Depends(get_current_user)):
    return {"items": await feedback.open_prompts(get_db(), me), "tags": list(feedback.TAGS), "text_max": feedback.TEXT_MAX}


@router.post("/{kind}/{target_id}")
async def give_feedback(kind: Kind, target_id: str, body: FeedbackBody, me: dict = Depends(get_current_user)):
    return await feedback.submit(get_db(), me, kind, target_id, stars=body.stars, tags=body.tags, text=body.text)


@router.post("/{kind}/{target_id}/decline")
async def decline_feedback(kind: Kind, target_id: str, me: dict = Depends(get_current_user)):
    return await feedback.decline(get_db(), me, kind, target_id)


@admin_router.get("/{kind}/{target_id}")
async def feedback_summary(kind: Kind, target_id: str, _admin: dict = Depends(require_area("tournaments"))):
    """Turniere und Events gehören zur Turnierleitung - dort steht der Reiter „Rückmeldungen“."""
    return await feedback.summary(get_db(), kind, target_id)
