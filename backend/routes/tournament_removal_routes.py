"""Disqualifikation und Austritt (#1553): Vorschlag, Bestätigung, Ablehnung.

Beides immer mit Bestätigung der Turnierleitung (Entscheidung zu E12/E14): der erste Aufruf rechnet den Umbauplan und
legt ihn als ``participant_removal_plan`` an das Turnier (wie der Lauf-Umbau ``heat_rebuild_plan``), der zweite mit
``plan_id`` wendet ihn an - nur, wenn er noch derselbe ist. Rechte wie die anderen Strukturaktionen (Organisation,
Schiedsrichter, Turnierleitung als Rolle), serialisiert über die Turnier-Schreibsperre, ein gesperrtes Turnier lehnt ab.
"""
from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db
from routes.tournament_common import _ensure_tournament_unlocked, _resolve_tid, _serialized_tournament_write
from routes.tournament_router import router
from services.tournament_events import (
    REMOVAL_KINDS,
    TournamentEventError,
    confirm_removal,
    propose_removal,
    reject_removal,
)
from services.tournament_permissions import STRUCTURE_STAFF_ROLES, require_tournament_staff_permission


class RemovalRequest(BaseModel):
    kind: str
    reason: str | None = Field(default=None, max_length=300)
    plan_id: str | None = None


class RemovalDecision(BaseModel):
    plan_id: str | None = None


async def _structure_staff(db, tid: str, reg_id: str, me: dict) -> tuple[dict, dict]:
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES, "tournament")
    tournament = await _ensure_tournament_unlocked(db, tid)
    registration = await db.tournament_registrations.find_one({"id": reg_id, "tournament_id": tid}, {"_id": 0})
    if not registration:
        raise HTTPException(status_code=404, detail="Anmeldung nicht gefunden")
    return tournament, registration


@router.post("/{tid}/registrations/{reg_id}/removal")
async def remove_participant(tid: str, reg_id: str, body: RemovalRequest, me: dict = Depends(get_current_user),
                             _mutation_tid: str = Depends(_serialized_tournament_write)):
    """Ohne ``plan_id``: den Umbauplan vorschlagen. Mit ``plan_id``: den Vorschlag anwenden."""
    if body.kind not in REMOVAL_KINDS:
        raise HTTPException(status_code=422, detail="Art muss 'withdrawn' (Austritt) oder 'disqualified' (Disqualifikation) sein.")
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament, registration = await _structure_staff(db, tid, reg_id, me)
    try:
        if body.plan_id:
            return await confirm_removal(db, tournament, registration, body.plan_id, kind=body.kind, actor_id=me.get("id"),
                                         reason=body.reason)
        return await propose_removal(db, tournament, registration, kind=body.kind, reason=body.reason, actor_id=me.get("id"))
    except TournamentEventError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.post("/{tid}/registrations/{reg_id}/removal/reject")
async def reject_participant_removal(tid: str, reg_id: str, body: RemovalDecision, me: dict = Depends(get_current_user),
                                     _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament, _registration = await _structure_staff(db, tid, reg_id, me)
    try:
        return await reject_removal(db, tournament, body.plan_id, actor_id=me.get("id"))
    except TournamentEventError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
