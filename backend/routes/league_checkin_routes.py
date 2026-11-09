"""Liga-Check-in und Start (docs/LIGA.md, „D.2 Check-in und Start“, #1652).

- ``GET|PUT /api/admin/leagues/seasons/{season_id}/checkin-rules``: Fenster um den Termin, Mindestzahl Anwesender, Erinnerung je Season
  (Zuständigkeit „Season konfigurieren“, lesen jede Zuständigkeit). Das Speichern gilt sofort für alle nicht gesperrten Staffeln.
- ``POST /api/matches/{match_id}/checkin``: Captain oder Vertreter checken die eigene Seite mit den Anwesenden ein; die Liga-Leitung mit
  „Spiele betreuen“ trägt im Notfall eine Seite ein (``registration_id``, Grund, Befangenheit wie B.1).
- ``POST /api/matches/{match_id}/checkin/start``: Map 1 beginnt - eine Seite oder die Leitung, nur wenn beide eingecheckt sind.

Die Logik steht in ``services/match_flow.py``.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user
from database import get_db
from models import new_id, now_utc
from routes.match_routes import (
    _acting_registration_for_match,
    _assert_match_visible,
    _find_match_any,
    _serialized_match_write,
)
from services import match_flow
from services.league_permissions import ANY, require_league, require_no_conflict
from services.tournament_permissions import has_match_result_permission

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])
router = APIRouter(prefix="/api/matches", tags=["matches"])

require_season = require_league("season", via="season_id")
require_any_capability = require_league(ANY, via="season_id")


class CheckinRulesBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    opens_minutes_before: Optional[int] = None
    closes_minutes_after: Optional[int] = None
    min_present: Optional[int] = None
    remind_minutes_before_close: Optional[int] = None
    # #2313: Erinnerung an fehlende Angaben vor dem ersten Spiel. Die Grenzen (0 bis 168) prüft checkin_rules.normalize mit deutschem
    # Satz (422), wie bei den anderen Feldern.
    open_points_remind_hours: Optional[int] = None


class CheckinBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    present: list[str] = Field(default_factory=list, max_length=60)
    # Nur die Liga-Leitung: für welche Seite, mit Grund; Notausnahme des Superadmins bei Befangenheit (#2203).
    registration_id: Optional[str] = Field(default=None, max_length=120)
    reason: Optional[str] = Field(default=None, max_length=500)
    conflict_reason: Optional[str] = Field(default=None, max_length=500)


class StartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conflict_reason: Optional[str] = Field(default=None, max_length=500)


async def _season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return season


def _raise(problem: match_flow.FlowProblem):
    raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None


def _stored_rules(season: dict) -> dict | None:
    stored = season.get("checkin_rules")
    if not isinstance(stored, dict):
        return None
    try:
        return match_flow.normalize({key: value for key, value in stored.items() if key in match_flow.DEFAULTS})
    except match_flow.FlowProblem:
        return dict(match_flow.DEFAULTS)


@admin_router.get("/seasons/{season_id}/checkin-rules")
async def get_checkin_rules(season_id: str, _me: dict = Depends(require_any_capability)):
    db = get_db()
    season = await _season(db, season_id)
    rules = _stored_rules(season)
    return {"checkin_rules": rules, "active": rules is not None, "defaults": match_flow.defaults_for_season(season),
            "staffeln": await db.tournaments.count_documents({"league_context.season_id": season_id})}


@admin_router.put("/seasons/{season_id}/checkin-rules")
async def put_checkin_rules(season_id: str, body: CheckinRulesBody, me: dict = Depends(require_season)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        rules = match_flow.normalize({**match_flow.defaults_for_season(season), **body.model_dump(exclude_none=True)})
    except match_flow.FlowProblem as problem:
        _raise(problem)
    before = season.get("checkin_rules")
    now = now_utc().isoformat()
    if before != rules:
        await db.league_seasons.update_one({"id": season_id}, {"$set": {"checkin_rules": rules, "updated_at": now}})
    # Sofort auf die Staffeln - gesperrte bleiben, wie sie sind (dort nimmt sie das Übertragen nach dem Entsperren mit).
    staffeln = await db.tournaments.update_many(
        {"league_context.season_id": season_id, "locked_at": None, "checkin_rules": {"$ne": rules}},
        {"$set": {"checkin_rules": rules, "updated_at": now}})
    if before != rules:
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "league.season.checkin_rules", "target_id": season_id, "actor_id": me.get("id"),
            "data": {"from": before, "to": rules, "staffeln": staffeln.modified_count}, "created_at": now})
    return {"checkin_rules": rules, "active": True, "defaults": match_flow.defaults_for_season(season),
            "staffeln_updated": staffeln.modified_count}


async def _context(match_id: str, user: dict):
    db = get_db()
    match, collection = await _find_match_any(match_id)
    if collection != "matches_v2":
        raise HTTPException(status_code=409, detail=match_flow.NO_RULES_DETAIL)
    await _assert_match_visible(match, user)
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "creation_key": 0, "billing": 0})
    if tournament and tournament.get("locked_at"):
        raise HTTPException(status_code=423, detail="Turnier ist gesperrt und kann nur noch angesehen werden.")
    return db, match, tournament, await _acting_registration_for_match(match, user)


def _require_rules(tournament: dict | None) -> None:
    """Erst, wer handeln darf (403), dann, ob es hier einen Check-in gibt (409) - so antwortet die Rechte-Matrix gleich."""
    if not match_flow.rules_of(tournament):
        raise HTTPException(status_code=409, detail=match_flow.NO_RULES_DETAIL)


async def _as_lead(db, user: dict, match: dict, *, action: str, conflict_reason: str | None) -> None:
    """Die Liga-Leitung mit „Spiele betreuen“ - befangen nur als Notausnahme des Superadmins mit Grund (#2203)."""
    if not await has_match_result_permission(user, match, capability="matches"):
        raise HTTPException(status_code=403, detail=match_flow.NOT_A_SIDE_DETAIL)
    await require_no_conflict(db, user, match, action=action, conflict_reason=conflict_reason)


@router.post("/{match_id}/checkin")
async def check_in(match_id: str, body: CheckinBody, me: dict = Depends(get_current_user),
                   _mutation: None = Depends(_serialized_match_write)):
    db, match, tournament, acting_reg = await _context(match_id, me)
    if body.registration_id and body.registration_id != (acting_reg or {}).get("id"):
        # Für eine fremde Seite trägt nur die Leitung ein - Captains checken immer die eigene Seite ein.
        await _as_lead(db, me, match, action="checkin_lead", conflict_reason=body.conflict_reason)
        registration_id, via = body.registration_id, match_flow.LEAD
    elif acting_reg:
        registration_id, via = acting_reg["id"], match_flow.SIDE
    else:
        raise HTTPException(status_code=403, detail=match_flow.NOT_A_SIDE_DETAIL)
    _require_rules(tournament)
    setup = await match_flow.sides(db, match, tournament)
    try:
        return await match_flow.check_in(db, match, tournament, setup, registration_id=registration_id, present=body.present, user=me,
                                         via=via, reason=body.reason)
    except match_flow.FlowProblem as problem:
        _raise(problem)


@router.post("/{match_id}/checkin/start")
async def start_match(match_id: str, body: StartBody | None = None, me: dict = Depends(get_current_user),
                      _mutation: None = Depends(_serialized_match_write)):
    db, match, tournament, acting_reg = await _context(match_id, me)
    if acting_reg:
        registration_id, via = acting_reg["id"], match_flow.SIDE
    else:
        await _as_lead(db, me, match, action="checkin_start", conflict_reason=(body or StartBody()).conflict_reason)
        registration_id, via = None, match_flow.LEAD
    _require_rules(tournament)
    setup = await match_flow.sides(db, match, tournament)
    try:
        return await match_flow.start(db, match, tournament, setup, user=me, registration_id=registration_id, via=via)
    except match_flow.FlowProblem as problem:
        _raise(problem)
