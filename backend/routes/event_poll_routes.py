"""Abstimmungen am Event (#2612) und Ort-Pläne A/B/C (#2613).

- ``GET  /api/events/{event}/polls`` - die Abstimmungen, wie die Seite sie der Person zeigt (auch ohne Konto; die
  Event-Seite bekommt dieselbe Liste in ``polls``).
- ``PUT  /api/events/{event}/polls/{poll}/vote`` - abstimmen oder die Stimme ändern, nur als Angemeldete.
- ``/api/admin/events/{event}/polls`` - anlegen, ändern, beenden, löschen; die Verwaltung sieht nur Zahlen.

Logik in ``services/event_polls.py``.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user, get_optional_user, require_admin
from database import get_db
from services import event_polls
from services.access_links import validate_access_link
from services.permissions import is_confirmed_tournament_lead
from services.slug_utils import find_by_slug_or_history
from services.visibility import lead_can_see

router = APIRouter(prefix="/api/events", tags=["events"])
admin_router = APIRouter(prefix="/api/admin/events", tags=["events"])


class PollOptionIn(BaseModel):
    code: Optional[str] = Field(default=None, max_length=40)
    label: str = Field(default="", max_length=200)


class PollCreate(BaseModel):
    question: str = Field(default="", max_length=400)
    options: List[PollOptionIn] = Field(default_factory=list, max_length=event_polls.OPTION_MAX + 8)
    max_choices: int = 1
    closes_at: Optional[str] = Field(default=None, max_length=40)
    results_visibility: str = Field(default="live", max_length=20)
    # Wer abstimmen darf, erfährt von der neuen Abstimmung (nicht gespeichert).
    notify: bool = False


class PollUpdate(BaseModel):
    question: Optional[str] = Field(default=None, max_length=400)
    options: Optional[List[PollOptionIn]] = Field(default=None, max_length=event_polls.OPTION_MAX + 8)
    max_choices: Optional[int] = None
    closes_at: Optional[str] = Field(default=None, max_length=40)
    results_visibility: Optional[str] = Field(default=None, max_length=20)


class VoteIn(BaseModel):
    choices: List[str] = Field(default_factory=list, max_length=event_polls.OPTION_MAX)


def _raise(exc: Exception) -> None:
    status = getattr(exc, "status", 400)
    raise HTTPException(status_code=status, detail=getattr(exc, "detail", str(exc))) from exc


async def _event(event_id: str) -> dict:
    event, _ = await find_by_slug_or_history(get_db().events, event_id, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event nicht gefunden")
    return event


async def _visible_event(event_id: str, user: dict | None, access: str | None) -> dict:
    """Das Event, wie die Event-Seite es der Person zeigt - Entwurf und Sichtbarkeit wie dort."""
    event = await _event(event_id)
    has_access = bool(await validate_access_link(get_db(), access, "event", event["id"], user, "view"))
    if event.get("status") == "draft" and not (is_confirmed_tournament_lead(user) or has_access):
        raise HTTPException(status_code=404, detail="Event nicht gefunden")
    if not has_access and not await lead_can_see(user, event.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Event ist nicht sichtbar.")
    return event


# ---------------------------------------------------------------- Abstimmen

@router.get("/{event_id}/polls")
async def list_polls(event_id: str, access: str | None = None, user: dict | None = Depends(get_optional_user)):
    event = await _visible_event(event_id, user, access)
    return {"polls": await event_polls.polls_for_event(get_db(), event, user)}


@router.put("/{event_id}/polls/{poll_id}/vote")
async def vote(event_id: str, poll_id: str, body: VoteIn, access: str | None = None, me: dict = Depends(get_current_user)):
    event = await _visible_event(event_id, me, access)
    try:
        return await event_polls.cast(get_db(), event, poll_id, me, body.choices)
    except event_polls.PollError as exc:
        _raise(exc)


# ---------------------------------------------------------------- Verwaltung

@admin_router.get("/{event_id}/polls")
async def admin_list_polls(event_id: str, me: dict = Depends(require_admin())):
    return await event_polls.admin_polls(get_db(), await _event(event_id))


@admin_router.post("/{event_id}/polls")
async def admin_create_poll(event_id: str, body: PollCreate, me: dict = Depends(require_admin())):
    raw = body.model_dump()
    notify = bool(raw.pop("notify", False))
    try:
        return await event_polls.create_poll(get_db(), await _event(event_id), raw, me, notify=notify)
    except event_polls.PollError as exc:
        _raise(exc)


@admin_router.patch("/{event_id}/polls/{poll_id}")
async def admin_update_poll(event_id: str, poll_id: str, body: PollUpdate, me: dict = Depends(require_admin())):
    try:
        return await event_polls.update_poll(get_db(), await _event(event_id), poll_id, body.model_dump(exclude_unset=True), me)
    except event_polls.PollError as exc:
        _raise(exc)


@admin_router.post("/{event_id}/polls/{poll_id}/close")
async def admin_close_poll(event_id: str, poll_id: str, me: dict = Depends(require_admin())):
    try:
        return await event_polls.close_poll(get_db(), await _event(event_id), poll_id, me)
    except event_polls.PollError as exc:
        _raise(exc)


@admin_router.delete("/{event_id}/polls/{poll_id}")
async def admin_delete_poll(event_id: str, poll_id: str, me: dict = Depends(require_admin())):
    try:
        return await event_polls.delete_poll(get_db(), await _event(event_id), poll_id, me)
    except event_polls.PollError as exc:
        _raise(exc)
