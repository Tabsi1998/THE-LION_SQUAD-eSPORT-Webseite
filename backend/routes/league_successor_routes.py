"""Neue Season aus der Vorgänger-Season in der Verwaltung (F.2, #1627, docs/LIGA.md „F.2 Neue Season aus dem Vorgänger“).

- ``GET  /api/admin/leagues/seasons/{season_id}/successor``: die Vorschau - was übernommen wird, je Liga N die Teams nach Auf- und
  Abstieg, wer herausfällt, und ob es schon eine neue Season aus dieser gibt.
- ``POST /api/admin/leagues/seasons/{season_id}/successor``: anlegen, mit Bestätigung und neuem Beginn. Ein zweites Anlegen findet die
  vorhandene Season (``replay``) - auch bei einem Doppelklick.

Zuständigkeit „Liga verwalten“ wie beim Anlegen einer Season (B.1). Logik in ``services/league_successor.py``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from database import get_db
from models import LeagueSuccessorCreate
from services import league_service as leagues
from services import league_successor
from services.change_events import publish_api_change
from services.league_permissions import require_league
from services.league_service import LeagueProblem

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])

require_manage = require_league(league_successor.CAPABILITY, via="season_id")


async def _season(db, season_id: str) -> dict:
    try:
        return await leagues.get_season(db, season_id)
    except LeagueProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None


@admin_router.get("/seasons/{season_id}/successor")
async def admin_successor_preview(season_id: str, _me: dict = Depends(require_manage)):
    db = get_db()
    return await league_successor.preview(db, await _season(db, season_id))


@admin_router.post("/seasons/{season_id}/successor")
async def admin_create_successor(season_id: str, body: LeagueSuccessorCreate, me: dict = Depends(require_manage)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        result = await league_successor.create(db, season, body.model_dump(), me)
    except (league_successor.SuccessorProblem, LeagueProblem) as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None
    await publish_api_change("POST", f"/api/admin/leagues/seasons/{result['season']['id']}", 200)
    doc = result["season"]
    return {"ok": True, "replay": result["replay"], "carried": result["carried"], "notified": result["notified"],
            "season": {"id": doc["id"], "name": doc.get("name"), "number": doc.get("number"), "slug": doc.get("slug")}}
