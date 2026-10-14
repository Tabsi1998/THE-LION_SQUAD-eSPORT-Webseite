"""FFA-Läufe zusammenlegen (#1550): Vorschlag prüfen, bestätigen, ablehnen.

Im Modus „Vorschlag“ (Vorgabe, Entscheidung E13) liegt der Umbau als ``heat_rebuild_plan`` am Turnier; die
Turnierleitung bestätigt ihn hier mit einem Klick oder lehnt ihn ab. Rechte wie die anderen Strukturaktionen der
Turnierleitung (Organisation, Schiedsrichter oder Turnierleitung als Rolle), ein gesperrtes Turnier lehnt ab.
Die Prüfung selbst läuft von selbst nach dem Baubau und nach jedem Ergebnis (services/heat_rebuild); ``check`` stößt
sie von Hand an.
"""
from fastapi import Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from database import get_db
from routes.tournament_common import _ensure_tournament_unlocked, _resolve_tid, _serialized_tournament_write
from routes.tournament_router import router
from services.heat_rebuild import HeatRebuildError, confirm_heat_rebuild, evaluate_heat_rebuild, reject_heat_rebuild
from services.tournament_permissions import STRUCTURE_STAFF_ROLES, require_tournament_staff_permission


class HeatRebuildDecision(BaseModel):
    plan_id: str | None = None


async def _structure_staff_tournament(db, tid: str, me: dict) -> dict:
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES, "tournament")
    return await _ensure_tournament_unlocked(db, tid)


@router.post("/{tid}/heat-rebuild/check")
async def check_heat_rebuild(tid: str, me: dict = Depends(get_current_user),
                             _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _structure_staff_tournament(db, tid, me)
    try:
        return await evaluate_heat_rebuild(db, tid, actor_id=me.get("id"), trigger="manual")
    except HeatRebuildError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.post("/{tid}/heat-rebuild/confirm")
async def confirm_heat_rebuild_plan(tid: str, body: HeatRebuildDecision, me: dict = Depends(get_current_user),
                                    _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _structure_staff_tournament(db, tid, me)
    try:
        return await confirm_heat_rebuild(db, tournament, body.plan_id, actor_id=me.get("id"))
    except HeatRebuildError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.post("/{tid}/heat-rebuild/reject")
async def reject_heat_rebuild_plan(tid: str, body: HeatRebuildDecision, me: dict = Depends(get_current_user),
                                   _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _structure_staff_tournament(db, tid, me)
    try:
        return await reject_heat_rebuild(db, tournament, body.plan_id, actor_id=me.get("id"))
    except HeatRebuildError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
