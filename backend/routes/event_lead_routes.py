"""Anmeldungen & Einlass (#1372): die Arbeitsseite der Turnierleitung unter /events/<slug>/leitung.

Nur mit dem Bereich Turnierleitung (Rolle oder Freigabe) - wie Liste und Ändern der Anmeldungen bisher. Der Vorstand,
die Moderation und Angemeldete bekommen 403. Geändert wird über ``PATCH /api/events/{id}/registrations/{rid}``;
die Logik steht in ``services/event_lead.py``.
"""
import re

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from auth import require_admin
from database import get_db
from services import event_lead
from services.event_lead import LeadError
from services.slug_utils import find_by_slug_or_history

router = APIRouter(prefix="/api/events", tags=["events"])


class EventLeadMessage(BaseModel):
    text: str = Field(max_length=4000)
    # Die Empfängerzahl, die die Leitung in der Vorschau gesehen und bestätigt hat - ohne sie geht nichts hinaus.
    confirm_count: int = Field(ge=0)


class EventLeadWalkIn(BaseModel):
    display_name: str = Field(max_length=80)
    companion_count: int = Field(default=0, ge=0, le=20)


async def _event(slug_or_id: str) -> dict:
    event, _ = await find_by_slug_or_history(get_db().events, slug_or_id, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event nicht gefunden")
    return event


@router.get("/{slug_or_id}/lead")
async def event_lead_view(slug_or_id: str, response: Response, q: str = "", filter: str = "open",
                          me: dict = Depends(require_admin())):
    # Namen und Notizen der Angemeldeten: nie in einem gemeinsamen Zwischenspeicher.
    response.headers["Cache-Control"] = "private, no-store"
    event = await _event(slug_or_id)
    try:
        return await event_lead.lead_view(get_db(), event, query=q[:100], filter_key=filter)
    except LeadError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail)


@router.get("/{slug_or_id}/lead/export.csv")
async def event_lead_export(slug_or_id: str, filter: str = "all", me: dict = Depends(require_admin())):
    """Die Teilnehmerliste als CSV (#2127, EV16) - dieselben Rechte wie die Seite, jeder Abruf steht im Protokoll."""
    event = await _event(slug_or_id)
    try:
        text = await event_lead.export_csv(get_db(), event, me, filter_key=filter)
    except LeadError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail)
    name = re.sub(r"[^a-z0-9-]+", "-", str(event.get("slug") or event["id"]).lower()).strip("-") or "event"
    return Response(content="﻿" + text, media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="anmeldungen-{name}.csv"',
        "Cache-Control": "private, no-store",
    })


@router.get("/{slug_or_id}/lead/registrations/{registration_id}")
async def event_lead_registration(slug_or_id: str, registration_id: str, response: Response, me: dict = Depends(require_admin())):
    """Eine Anmeldung mit Notizen - die Liste trägt nur den Merker „hat Notiz“."""
    response.headers["Cache-Control"] = "private, no-store"
    event = await _event(slug_or_id)
    try:
        return await event_lead.registration_detail(get_db(), event, registration_id)
    except LeadError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail)


@router.post("/{slug_or_id}/lead/walk-in")
async def event_lead_walk_in(slug_or_id: str, body: EventLeadWalkIn, me: dict = Depends(require_admin())):
    """„Person an der Tür hinzufügen“ (#2127, EV17): ohne Konto und ohne Preis, gleich eingecheckt, mit Protokoll."""
    event = await _event(slug_or_id)
    try:
        return await event_lead.add_walk_in(get_db(), event, me, display_name=body.display_name, companion_count=body.companion_count)
    except LeadError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail)


@router.post("/{slug_or_id}/lead/message")
async def event_lead_message(slug_or_id: str, body: EventLeadMessage, me: dict = Depends(require_admin())):
    event = await _event(slug_or_id)
    try:
        return await event_lead.send_message(get_db(), event, me, text=body.text, confirm_count=body.confirm_count)
    except LeadError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail)
