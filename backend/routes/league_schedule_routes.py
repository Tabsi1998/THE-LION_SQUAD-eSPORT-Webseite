"""Liga-Termine (docs/LIGA.md, „D.1 Termine“, #2194).

- ``GET|PUT /api/admin/leagues/seasons/{season_id}/schedule-rules``: 72-h-Regel, Verschiebung, Erinnerung und „überfällig“ je Season
  (Zuständigkeit „Season konfigurieren“). Das Speichern gilt sofort für alle nicht gesperrten Staffeln der Season.
- ``POST /api/matches/{match_id}/reschedule``: eine Seite beantragt eine Verschiebung, mit Grund.
- ``POST /api/matches/{match_id}/reschedule/{request_id}/decision``: die andere Seite stimmt zu oder lehnt ab, die eigene zieht zurück.

Die Logik steht in ``services/league_schedule.py``.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user
from database import get_db
from models import new_id, now_utc
from services import league_schedule
from routes.match_routes import (
    _acting_registration_for_match,
    _assert_match_visible,
    _find_match_any,
    _serialized_match_write,
)
from services.league_permissions import require_league

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])
router = APIRouter(prefix="/api/matches", tags=["matches"])

require_season = require_league("season", via="season_id")


class ScheduleRulesBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    home_rule: Optional[bool] = None
    home_rule_hours: Optional[int] = None
    reschedule_notice_hours: Optional[int] = None
    reschedule_max: Optional[int] = None
    reschedule_same_week: Optional[bool] = None
    result_reminder_hours: Optional[int] = None
    result_overdue_hours: Optional[int] = None


class RescheduleBody(BaseModel):
    scheduled_at: datetime
    reason: str = Field(default="", max_length=500)


class RescheduleDecisionBody(BaseModel):
    action: Literal["accept", "decline", "withdraw"]
    note: Optional[str] = Field(default=None, max_length=500)


async def _season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return season


def _raise(problem: league_schedule.ScheduleProblem):
    raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None


@admin_router.get("/seasons/{season_id}/schedule-rules")
async def get_schedule_rules(season_id: str, _me: dict = Depends(require_season)):
    db = get_db()
    season = await _season(db, season_id)
    stored = season.get("schedule_rules")
    return {"schedule_rules": league_schedule.normalize({k: v for k, v in stored.items() if k in league_schedule.DEFAULTS})
            if isinstance(stored, dict) else None,
            "active": isinstance(stored, dict), "defaults": dict(league_schedule.DEFAULTS),
            "staffeln": await db.tournaments.count_documents({"league_context.season_id": season_id})}


@admin_router.put("/seasons/{season_id}/schedule-rules")
async def put_schedule_rules(season_id: str, body: ScheduleRulesBody, me: dict = Depends(require_season)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        rules = league_schedule.normalize(body.model_dump(exclude_none=True))
    except league_schedule.ScheduleProblem as problem:
        _raise(problem)
    before = season.get("schedule_rules")
    now = now_utc().isoformat()
    if before != rules:
        await db.league_seasons.update_one({"id": season_id}, {"$set": {"schedule_rules": rules, "updated_at": now}})
    # Sofort auf die Staffeln - gesperrte bleiben, wie sie sind (dort nimmt sie das Übertragen nach dem Entsperren mit).
    staffeln = await db.tournaments.update_many(
        {"league_context.season_id": season_id, "locked_at": None, "schedule_rules": {"$ne": rules}},
        {"$set": {"schedule_rules": rules, "updated_at": now}})
    if before != rules:
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "league.season.schedule_rules", "target_id": season_id, "actor_id": me.get("id"),
            "data": {"from": before, "to": rules, "staffeln": staffeln.modified_count}, "created_at": now})
    return {"schedule_rules": rules, "active": True, "defaults": dict(league_schedule.DEFAULTS),
            "staffeln_updated": staffeln.modified_count}


async def _context(match_id: str, user: dict):
    db = get_db()
    match, collection = await _find_match_any(match_id)
    if collection != "matches_v2":
        raise HTTPException(status_code=409, detail=league_schedule.NO_RULES_DETAIL)
    await _assert_match_visible(match, user)
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "creation_key": 0, "billing": 0})
    if tournament and tournament.get("locked_at"):
        raise HTTPException(status_code=423, detail="Turnier ist gesperrt und kann nur noch angesehen werden.")
    return db, match, tournament, await _acting_registration_for_match(match, user)


@router.post("/{match_id}/reschedule")
async def request_reschedule(match_id: str, body: RescheduleBody, me: dict = Depends(get_current_user),
                             _mutation: None = Depends(_serialized_match_write)):
    db, match, tournament, acting_reg = await _context(match_id, me)
    try:
        return await league_schedule.request_reschedule(db, match, tournament, acting_reg, me, body.scheduled_at, body.reason)
    except league_schedule.ScheduleProblem as problem:
        _raise(problem)


@router.post("/{match_id}/reschedule/{request_id}/decision")
async def decide_reschedule(match_id: str, request_id: str, body: RescheduleDecisionBody,
                            me: dict = Depends(get_current_user), _mutation: None = Depends(_serialized_match_write)):
    db, match, tournament, acting_reg = await _context(match_id, me)
    try:
        return await league_schedule.decide_reschedule(db, match, tournament, acting_reg, me, request_id, body.action, body.note)
    except league_schedule.ScheduleProblem as problem:
        _raise(problem)
