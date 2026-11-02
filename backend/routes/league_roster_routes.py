"""Liga-Kader mit Spiel-ID je Season (docs/LIGA.md, #2108) - Verwaltung und eigener Stand.

- ``GET /api/admin/leagues/seasons/{season_id}/roster``: Kaderübersicht je Co-Team mit ID-Stand (Liga-Recht „Kader prüfen“).
- ``POST /api/admin/leagues/seasons/{season_id}/roster/{user_id}/approve``: neue ID freigeben, mit Grund und Protokoll.
- ``PUT /api/admin/leagues/seasons/{season_id}/roster-settings``: Stichtag für neue Spieler (Vorgabe: keiner).
- ``POST /api/admin/leagues/seasons/{season_id}/roster/{user_id}/waive-wait``: Wartezeit aufheben, mit Grund und Protokoll (#2204).
- ``GET /api/admin/leagues/seasons/{season_id}/transfers``, ``POST …/{id}/approve``, ``…/reject``: Transfers entscheiden (#2204).
- ``GET /api/me/league-ids``: die eigene festgehaltene ID je laufender Season - für den Hinweis im Profil.
- ``GET /api/me/league-eligibility``: der eigene Stand je Season, ohne Datum (#2204).

Die Logik steht in ``services/league_roster.py``.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db
from services import league_eligibility, league_roster, league_transfers
from services.league_permissions import require_league
from services.mutation_lock import MutationLockBusy

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])
me_router = APIRouter(prefix="/api/me", tags=["leagues"])

require_roster = require_league("roster", via="season_id")


class RosterApproveBody(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class RosterSettingsBody(BaseModel):
    roster_deadline: Optional[str] = Field(default=None, max_length=10)


class WaiveWaitBody(BaseModel):
    squad_id: str = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=1, max_length=500)


async def _season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return season


@admin_router.get("/seasons/{season_id}/roster")
async def season_roster(season_id: str, _me: dict = Depends(require_roster)):
    db = get_db()
    return await league_roster.season_overview(db, await _season(db, season_id))


@admin_router.post("/seasons/{season_id}/roster/{user_id}/approve")
async def approve_roster_id(season_id: str, user_id: str, body: RosterApproveBody,
                            me: dict = Depends(require_roster)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        return await league_roster.approve(db, season, user_id, body.reason, me)
    except league_roster.LeagueRosterError as problem:
        raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None


@admin_router.post("/seasons/{season_id}/roster/{user_id}/waive-wait")
async def waive_wait(season_id: str, user_id: str, body: WaiveWaitBody, me: dict = Depends(require_roster)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        return await league_eligibility.waive_wait(db, season, user_id, body.squad_id, body.reason, me)
    except league_eligibility.EligibilityError as problem:
        raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None


@admin_router.put("/seasons/{season_id}/roster-settings")
async def roster_settings(season_id: str, body: RosterSettingsBody, me: dict = Depends(require_roster)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        return await league_roster.set_deadline(db, season, body.roster_deadline, me)
    except league_roster.LeagueRosterError as problem:
        raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None


class TransferDecisionBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


@admin_router.get("/seasons/{season_id}/transfers")
async def season_transfers(season_id: str, _me: dict = Depends(require_roster)):
    db = get_db()
    await _season(db, season_id)
    return {"items": await league_transfers.for_season(db, season_id)}


@admin_router.post("/seasons/{season_id}/transfers/{transfer_id}/approve")
async def approve_transfer(season_id: str, transfer_id: str, body: TransferDecisionBody, me: dict = Depends(require_roster)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        return await league_transfers.approve(db, season, transfer_id, body.reason, me)
    except league_eligibility.EligibilityError as problem:
        raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=league_transfers.BUSY) from None


@admin_router.post("/seasons/{season_id}/transfers/{transfer_id}/reject")
async def reject_transfer(season_id: str, transfer_id: str, body: TransferDecisionBody, me: dict = Depends(require_roster)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        return await league_transfers.reject(db, season, transfer_id, body.reason, me)
    except league_eligibility.EligibilityError as problem:
        raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None


@me_router.get("/league-eligibility")
async def my_league_eligibility(me: dict = Depends(get_current_user)):
    return {"items": await league_eligibility.my_status(get_db(), me)}


@me_router.get("/league-ids")
async def my_league_ids(me: dict = Depends(get_current_user)):
    return {"items": await league_roster.my_league_ids(get_db(), me)}
