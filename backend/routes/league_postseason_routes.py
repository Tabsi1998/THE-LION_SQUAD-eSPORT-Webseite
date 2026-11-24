"""Playoffs und Relegation in der Verwaltung (#2404, docs/LIGA.md „F.6 Playoffs und Relegation“).

- ``GET  /api/admin/leagues/seasons/{season_id}/postseason``: das Cockpit - Einstellungen, je Liga N die Vorschau der Setzung, die
  Paarungen, die Wochen, der Stand der Staffeln und was dem Anlegen noch entgegensteht. Jede Zuständigkeit der Liga.
- ``PUT  /api/admin/leagues/seasons/{season_id}/postseason``: die Vorlage der Season. ``PUT …/divisions/{division_id}/postseason``:
  die Abweichung einer Liga N (leer: wie die Season). Zuständigkeit „Season konfigurieren“.
- ``POST /api/admin/leagues/seasons/{season_id}/postseason/playoffs`` bzw. ``…/relegation``: die Staffel anlegen, mit Bestätigung und
  dem Fingerabdruck der Vorschau. Ein zweiter Aufruf findet die vorhandene Staffel. Nie mit dem eigenen Team in der Liga N.
- ``POST /api/admin/leagues/seasons/{season_id}/postseason/{tournament_id}/reseed``: Setzliste neu berechnen, mit Grund - nur solange
  kein Playoff-Spiel gespielt ist.

Logik in ``services/league_postseason.py``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from database import get_db
from services import league_postseason
from services.change_events import publish_api_change
from services.league_permissions import ANY, require_league
from services.league_scope import ONLY_LEAGUE, PLAYOFF, RELEGATION
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])

require_season = require_league(league_postseason.CAPABILITY, via="season_id")
require_division = require_league(league_postseason.CAPABILITY, via="division_id")


class RoundBestOf(BaseModel):
    model_config = ConfigDict(extra="forbid")

    round: int
    best_of: int


class PlayoffSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    per_staffel: int | None = None
    format: str | None = Field(default=None, max_length=20)
    seeding: str | None = Field(default=None, max_length=20)
    best_of: int | None = None
    best_of_rounds: list[RoundBestOf] = Field(default_factory=list, max_length=8)
    third_place: bool = False
    home: str | None = Field(default=None, max_length=20)
    start_date: str | None = Field(default=None, max_length=10)


class RelegationSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    best_of: int | None = None
    start_date: str | None = Field(default=None, max_length=10)


class SeasonPostseasonBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    playoffs: PlayoffSettings | None = None
    relegation: RelegationSettings | None = None
    champion_source: str | None = Field(default=None, max_length=20)
    reopen_guard: str | None = Field(default=None, max_length=20)


class DivisionPostseasonBody(BaseModel):
    """Die Abweichung einer Liga N: nur die Teile, die sie selbst trägt - ein fehlender Teil heißt „wie die Season“."""
    model_config = ConfigDict(extra="forbid")

    playoffs: PlayoffSettings | None = None
    relegation: RelegationSettings | None = None


class CreateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    division_id: str = Field(max_length=80)
    stamp: str = Field(default="", max_length=40)
    confirm: bool = False
    conflict_reason: str | None = Field(default=None, max_length=500)


class ReseedBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stamp: str = Field(default="", max_length=40)
    confirm: bool = False
    reason: str = Field(default="", max_length=500)
    conflict_reason: str | None = Field(default=None, max_length=500)


def _refuse(problem) -> HTTPException:
    return HTTPException(status_code=problem.status, detail=problem.message)


async def _season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return season


def _summary(tournament: dict) -> dict:
    return {"tournament_id": tournament["id"], "slug": tournament.get("slug"), "title": tournament.get("title"), "status": tournament.get("status")}


@admin_router.get("/seasons/{season_id}/postseason")
async def admin_postseason(season_id: str, me: dict = Depends(require_league(ANY, via="season_id"))):
    db = get_db()
    return await league_postseason.overview(db, await _season(db, season_id), me)


@admin_router.put("/seasons/{season_id}/postseason")
async def admin_save_postseason(season_id: str, body: SeasonPostseasonBody, me: dict = Depends(require_season)):
    db = get_db()
    try:
        saved = await league_postseason.save_season(db, await _season(db, season_id), body.model_dump(), me)
    except league_postseason.rules.PostseasonProblem as problem:
        raise _refuse(problem) from None
    await publish_api_change("PUT", f"/api/admin/leagues/seasons/{season_id}", 200)
    return {"ok": True, "settings": saved}


@admin_router.put("/divisions/{division_id}/postseason")
async def admin_save_division_postseason(division_id: str, body: DivisionPostseasonBody, me: dict = Depends(require_division)):
    db = get_db()
    division = await db.league_divisions.find_one({"id": division_id}, {"_id": 0})
    if not division:
        raise HTTPException(status_code=404, detail="Liga nicht gefunden.")
    try:
        saved = await league_postseason.save_division(db, division, body.model_dump(exclude_none=True), me)
    except league_postseason.rules.PostseasonProblem as problem:
        raise _refuse(problem) from None
    await publish_api_change("PUT", f"/api/admin/leagues/seasons/{division['season_id']}", 200)
    return {"ok": True, "settings": saved}


async def _create(season_id: str, kind: str, body: CreateBody, me: dict) -> dict:
    db = get_db()
    try:
        result = await league_postseason.create(db, await _season(db, season_id), kind, body.model_dump(), me)
    except league_postseason.rules.PostseasonProblem as problem:
        raise _refuse(problem) from None
    tournament = result["tournament"]
    await publish_api_change("POST", f"/api/tournaments/{tournament['id']}", 200)
    return {"ok": True, "replay": result["replay"], "tournament": _summary(tournament)}


@admin_router.post("/seasons/{season_id}/postseason/playoffs")
async def admin_create_playoffs(season_id: str, body: CreateBody, me: dict = Depends(require_season)):
    return await _create(season_id, PLAYOFF, body, me)


@admin_router.post("/seasons/{season_id}/postseason/relegation")
async def admin_create_relegation(season_id: str, body: CreateBody, me: dict = Depends(require_season)):
    return await _create(season_id, RELEGATION, body, me)


@admin_router.post("/seasons/{season_id}/postseason/{tournament_id}/reseed")
async def admin_reseed_playoffs(season_id: str, tournament_id: str, body: ReseedBody, me: dict = Depends(require_season)):
    db = get_db()
    tournament = await db.tournaments.find_one({"id": tournament_id, "league_context.season_id": season_id, **ONLY_LEAGUE}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Staffel nicht gefunden.")
    try:
        async with mutation_lock(db, tournament_write_resource(tournament_id)):
            result = await league_postseason.reseed(db, tournament, body.model_dump(), me)
    except league_postseason.rules.PostseasonProblem as problem:
        raise _refuse(problem) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=league_postseason.BUSY) from None
    await publish_api_change("POST", f"/api/tournaments/{tournament_id}", 200)
    return {"ok": True, "redrawn": result["redrawn"], "tournament": _summary(result["tournament"])}
