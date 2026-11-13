"""Liga-Erinnerungen je Season (docs/LIGA.md, „E.5 Benachrichtigungen und Erinnerungen“, #1647).

- ``GET|PUT /api/admin/leagues/seasons/{season_id}/reminder-rules``: ein Schalter je Art, Zeiten mit Vorgabe, Discord ergänzend
  (Zuständigkeit „Season konfigurieren“, lesen jede Zuständigkeit). Das Speichern gilt sofort für alle nicht gesperrten Staffeln.

Die Regeln stehen in ``services/league_reminder_rules.py``, verschickt wird im Fristen-Job (``services/league_reminders.py``,
``league_schedule_sweep``) und im Veto-Job (``league_veto_sweep.nudge``).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from database import get_db
from models import new_id, now_utc
from services import league_reminder_rules as reminder_rules
from services.league_permissions import ANY, require_league

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])

require_season = require_league("season", via="season_id")
require_any_capability = require_league(ANY, via="season_id")


class ReminderRulesBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    upcoming: Optional[bool] = None
    upcoming_early_hours: Optional[int] = None
    upcoming_late_minutes: Optional[int] = None
    unscheduled: Optional[bool] = None
    unscheduled_week_percent: Optional[int] = None
    unscheduled_hours_before_default: Optional[int] = None
    result_missing: Optional[bool] = None
    veto_turn: Optional[bool] = None
    veto_idle_seconds: Optional[int] = None
    veto_min_left_seconds: Optional[int] = None
    discord: Optional[bool] = None


async def _season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return season


def _result_reminder_hours(season: dict) -> int:
    """Wann „Ergebnis fehlt“ kommt, steht in den Terminregeln - die Verwaltung zeigt es hier nur an."""
    from services import league_schedule

    stored = season.get("schedule_rules")
    if not isinstance(stored, dict):
        return int(league_schedule.DEFAULTS["result_reminder_hours"])
    try:
        rules = league_schedule.normalize({key: value for key, value in stored.items() if key in league_schedule.DEFAULTS})
    except league_schedule.ScheduleProblem:
        rules = dict(league_schedule.DEFAULTS)
    return int(rules["result_reminder_hours"])


def _veto_step_seconds(season: dict) -> int | None:
    """Die Zeit je Veto-Schritt der Season - ``None`` ohne Veto (dann gibt es nichts zu prüfen)."""
    veto = season.get("veto_rules")
    if not isinstance(veto, dict) or not veto.get("enabled"):
        return None
    try:
        return int(veto.get("step_seconds") or 60)
    except (TypeError, ValueError):
        return 60


async def _answer(db, season: dict, rules: dict | None, **extra) -> dict:
    return {"reminder_rules": rules, "active": rules is not None, "defaults": reminder_rules.defaults(),
            "result_reminder_hours": _result_reminder_hours(season), "veto_step_seconds": _veto_step_seconds(season),
            "staffeln": await db.tournaments.count_documents({"league_context.season_id": season["id"]}), **extra}


@admin_router.get("/seasons/{season_id}/reminder-rules")
async def get_reminder_rules(season_id: str, _me: dict = Depends(require_any_capability)):
    db = get_db()
    season = await _season(db, season_id)
    return await _answer(db, season, reminder_rules.stored(season))


@admin_router.put("/seasons/{season_id}/reminder-rules")
async def put_reminder_rules(season_id: str, body: ReminderRulesBody, me: dict = Depends(require_season)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        rules = reminder_rules.normalize({**(reminder_rules.stored(season) or {}), **body.model_dump(exclude_none=True)},
                                         step_seconds=_veto_step_seconds(season))
    except reminder_rules.ReminderProblem as problem:
        raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None
    field = reminder_rules.FIELD
    before = season.get(field)
    now = now_utc().isoformat()
    if before != rules:
        await db.league_seasons.update_one({"id": season_id}, {"$set": {field: rules, "updated_at": now}})
    # Sofort auf die Staffeln - gesperrte bleiben, wie sie sind (dort nimmt sie das Übertragen nach dem Entsperren mit).
    staffeln = await db.tournaments.update_many(
        {"league_context.season_id": season_id, "locked_at": None, field: {"$ne": rules}},
        {"$set": {field: rules, "updated_at": now}})
    if before != rules:
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "league.season.reminder_rules", "target_id": season_id, "actor_id": me.get("id"),
            "data": {"from": before, "to": rules, "staffeln": staffeln.modified_count}, "created_at": now})
    return await _answer(db, season, rules, staffeln_updated=staffeln.modified_count)
