"""Plattform je Season (docs/LIGA.md, B.3 „Plattform je Season“, #2270).

- ``GET /api/admin/leagues/seasons/{season_id}/platform``: Angaben der Season, wählbare Felder des Spiels (Felder mit Auswahl) und was
  in jeder Liga N gilt (jede Zuständigkeit der Liga).

Gespeichert wird mit den übrigen Angaben des Reiters „Anmeldung und Kader“ über ``PATCH /api/admin/leagues/seasons/{id}`` (Prüfung in
``league_platform.clean_season``, Protokoll ``league.season.platform``), die Abweichung einer Liga N über ihre ``overrides``. Die Logik
steht in ``services/league_platform.py``, die Prüfung je Person in ``services/league_eligibility.py``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from database import get_db
from services import league_platform
from services.league_permissions import ANY, require_league

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])


@admin_router.get("/seasons/{season_id}/platform")
async def get_platform(season_id: str, _me: dict = Depends(require_league(ANY, via="season_id"))):
    db = get_db()
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return await league_platform.admin_view(db, season)
