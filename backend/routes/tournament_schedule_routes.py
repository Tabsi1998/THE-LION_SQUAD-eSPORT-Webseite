"""Spielplan planen und übernehmen (#1552).

„Planen“ zeigt, was der Planer schreiben würde - Zeit und Station je Spiel, dazu Warnungen - und schreibt nichts.
„Übernehmen“ braucht den Fingerabdruck der gesehenen Vorschau, rechnet den Plan unter dem Turnier-Lock noch einmal
und schreibt alles auf einmal; hat sich der Plan seither geändert, kommt 409 statt eines anderen Plans als gezeigt.
"""
from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db
from services.match_scheduler import apply_plan, plan_for_tournament
from services.tournament_permissions import STATION_ASSIGN_ROLES, require_tournament_staff_permission
from routes.tournament_common import _ensure_tournament_unlocked, _resolve_tid, _serialized_tournament_write
from routes.tournament_router import router


class SchedulePlanApply(BaseModel):
    # Pflicht: Übernehmen gibt es nur zu einer gesehenen Vorschau.
    fingerprint: str = Field(min_length=1)


async def _planning_tournament(db, tid: str, me: dict) -> dict:
    await require_tournament_staff_permission(me, tid, STATION_ASSIGN_ROLES, "tournament")
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    return tournament


@router.post("/{tid}/schedule/plan")
async def preview_schedule_plan(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _planning_tournament(db, tid, me)
    return await plan_for_tournament(db, tournament)


@router.post("/{tid}/schedule/apply")
async def apply_schedule_plan(tid: str, body: SchedulePlanApply, me: dict = Depends(get_current_user),
                              _mutation: str = Depends(_serialized_tournament_write)):
    # Unter dem Turnier-Lock: Plan rechnen, Fingerabdruck prüfen, schreiben - keine zweite Planung dazwischen.
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _planning_tournament(db, tid, me)
    await _ensure_tournament_unlocked(db, tid)
    plan = await plan_for_tournament(db, tournament)
    if body.fingerprint != plan["fingerprint"]:
        raise HTTPException(status_code=409, detail="Der Plan hat sich inzwischen geändert - bitte noch einmal Planen.")
    result = await apply_plan(db, tournament, plan)
    return {**result, "assignments": plan["assignments"], "fingerprint": plan["fingerprint"]}
