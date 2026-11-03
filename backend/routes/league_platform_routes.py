"""Plattform je Season (docs/LIGA.md, B.3 „Plattform je Season“, #2270).

- ``GET /api/admin/leagues/seasons/{season_id}/platform``: Feld, erlaubte Plattformen, Crossplay, Eingabegerät, wählbare Felder des Spiels
  und was in jeder Liga N gilt (jede Zuständigkeit der Liga).
- ``PUT /api/admin/leagues/seasons/{season_id}/platform``: speichern (Zuständigkeit „Season konfigurieren“), Protokoll
  ``league.season.platform``. Wirkt sofort, ohne Übertragen. Die Abweichung einer Liga N läuft über ihre ``overrides``.

Die Logik steht in ``services/league_platform.py``, die Prüfung je Person in ``services/league_eligibility.py``.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from database import get_db
from services import league_platform
from services.league_permissions import ANY, require_league

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])


class PlatformBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform_field: Optional[str] = Field(default=None, max_length=80)
    allowed_platforms: List[str] = Field(default_factory=list, max_length=league_platform.MAX_ALLOWED)
    crossplay: Optional[bool] = None
    input_device: Optional[Literal["controller", "mouse_keyboard", "both"]] = None


async def _season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return season


@admin_router.get("/seasons/{season_id}/platform")
async def get_platform(season_id: str, _me: dict = Depends(require_league(ANY, via="season_id"))):
    db = get_db()
    return await league_platform.admin_view(db, await _season(db, season_id))


@admin_router.put("/seasons/{season_id}/platform")
async def put_platform(season_id: str, body: PlatformBody, me: dict = Depends(require_league("season", via="season_id"))):
    db = get_db()
    season = await _season(db, season_id)
    try:
        return await league_platform.save(db, season, body.model_dump(), me)
    except league_platform.PlatformProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None
