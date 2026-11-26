"""Startrechte für die nächste Season (#1627, docs/LIGA.md „F.2a Startrechte für die nächste Season“).

- ``GET  /api/admin/leagues/seasons/{season_id}/start-rights``: Einstellung und Übersicht - je übernommenem Co-Team der Stand mit
  Frist, frei gewordene Plätze mit Vorschlag (jede Zuständigkeit der Liga).
- ``PUT  …/start-rights``: die Einstellung der Season (Zuständigkeit „Season konfigurieren“); ``active: false`` nimmt sie weg.
- ``POST …/start-rights/{application_id}/accept``: Zusage für das Team eintragen, mit Grund (Zuständigkeit ``applications``).
- ``POST …/start-rights/{application_id}/fill``: Nachrücken auslösen, mit Grund (Zuständigkeit ``applications``).
- ``POST /api/me/league-applications/{application_id}/start-right``: Captain oder Vertreter sagt zu (``accept``) bzw. lehnt das
  Nachrücken ab (``decline``) - derselbe Antrag und dieselben Rechte wie Anmelden und Abmelden (B.4).

Die Logik steht in ``services/league_start_rights.py``. Ohne die Einstellung ``start_rights`` an der Season gibt es nichts davon.
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user
from database import get_db
from services import league_applications as applications
from services import league_start_rights as start_rights
from services.change_events import publish_api_change
from services.league_permissions import ANY, require_league

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])
me_router = APIRouter(prefix="/api/me", tags=["league-applications"])

require_any_capability = require_league(ANY, via="season_id")
require_season = require_league("season", via="season_id")
require_applications = require_league("applications", via="season_id")


class StartRightsBody(BaseModel):
    """Die Einstellung je Season. Werte prüft ``league_start_rights.normalize`` (deutsche Meldung)."""
    model_config = ConfigDict(extra="forbid")

    active: bool = True
    mode: Optional[str] = Field(default=None, max_length=20)
    accept_days: Optional[int] = None
    successor: Optional[str] = Field(default=None, max_length=20)
    remind_hours: Optional[int] = None
    announce: Optional[bool] = None
    # Rückfrage (Entscheidung 26.11.): Ausschalten oder Umschalten auf „automatisch“ lässt offene Startrechte als zugesagt gelten -
    # nur mit dieser Bestätigung, sonst 409 mit der Zahl.
    confirm_open: bool = False


class StartRightAcceptBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(default="", max_length=500)
    conflict_reason: Optional[str] = Field(default=None, max_length=500)


class StartRightFillBody(StartRightAcceptBody):
    candidate_id: str = Field(min_length=1, max_length=80)


class StartRightAnswerBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["accept", "decline"]


async def _season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return season


async def _call(coroutine):
    try:
        return await coroutine
    except start_rights.StartRightProblem as problem:
        raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None


@admin_router.get("/seasons/{season_id}/start-rights")
async def get_start_rights(season_id: str, me: dict = Depends(require_any_capability)):
    db = get_db()
    return await start_rights.overview(db, await _season(db, season_id), me)


@admin_router.put("/seasons/{season_id}/start-rights")
async def put_start_rights(season_id: str, body: StartRightsBody, me: dict = Depends(require_season)):
    db = get_db()
    await _call(start_rights.save_settings(db, await _season(db, season_id), body.model_dump(), me))
    await publish_api_change("PUT", f"/api/admin/leagues/seasons/{season_id}", 200)
    return await start_rights.overview(db, await _season(db, season_id), me)


@admin_router.post("/seasons/{season_id}/start-rights/{application_id}/accept")
async def accept_start_right(season_id: str, application_id: str, body: StartRightAcceptBody, me: dict = Depends(require_applications)):
    db = get_db()
    season = await _season(db, season_id)
    await _call(start_rights.accept_for(db, season, application_id, me, body.reason, body.conflict_reason))
    await publish_api_change("POST", f"/api/admin/leagues/seasons/{season_id}", 200)
    return await _call(start_rights.row_of(db, season, application_id, me))


@admin_router.post("/seasons/{season_id}/start-rights/{application_id}/fill")
async def fill_start_right(season_id: str, application_id: str, body: StartRightFillBody, me: dict = Depends(require_applications)):
    db = get_db()
    season = await _season(db, season_id)
    await _call(start_rights.fill(db, season, application_id, body.candidate_id, me, body.reason, body.conflict_reason))
    await publish_api_change("POST", f"/api/admin/leagues/seasons/{season_id}", 200)
    return await _call(start_rights.row_of(db, season, body.candidate_id, me))


@me_router.post("/league-applications/{application_id}/start-right")
async def answer_start_right(application_id: str, body: StartRightAnswerBody, me: dict = Depends(get_current_user)):
    """Zusagen bzw. das Nachrücken ablehnen - auch, solange die neue Season noch nicht veröffentlicht ist (wie Abmelden, F.2)."""
    db = get_db()
    done = await _call(start_rights.accept(db, application_id, me) if body.action == "accept" else start_rights.decline(db, application_id, me))
    return {**await applications.team_answer(db, done), "replay": bool(done.get("replay"))}
