"""Ergebnisregeln der Season (docs/LIGA.md, Abschnitt „C.3 Ergebnisregeln“, #1617).

- ``GET /api/admin/leagues/seasons/{season_id}/result-rules``: je Modus die Regel der Season neben der des Spiels, dazu die
  Punktepflicht (jede Zuständigkeit der Liga).
- ``PUT /api/admin/leagues/seasons/{season_id}/result-rules``: die festgehaltene Kopie ersetzen (Recht „Season konfigurieren“).
  Bestehende Staffeln übernehmen sie über „Vorgaben auf Staffeln übertragen“.

Die Logik steht in ``services/league_result_rules.py``.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import get_db
from models import new_id, now_utc
from services import league_result_rules
from services.league_permissions import ANY, require_league
from services.league_scope import ONLY_LEAGUE

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])


class ResultRulesBody(BaseModel):
    scores_required: bool = False
    rules: Dict[str, Optional[Dict[str, Any]]] = {}


async def _season_and_game(db, season_id: str) -> tuple[dict, dict | None]:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "game_id": 1}) or {}
    game = await db.games.find_one({"id": league.get("game_id")}, {"_id": 0}) if league.get("game_id") else None
    return season, game


async def _view(db, season: dict, game: dict | None) -> dict:
    staffeln = await db.tournaments.count_documents({"league_context.season_id": season["id"], **ONLY_LEAGUE})
    return {"scores_required": bool(season.get("scores_required")), "rules": league_result_rules.overview(season, game),
            "staffeln": staffeln}


@admin_router.get("/seasons/{season_id}/result-rules")
async def season_result_rules(season_id: str, _me: dict = Depends(require_league(ANY, via="season_id"))):
    db = get_db()
    season, game = await _season_and_game(db, season_id)
    return await _view(db, season, game)


@admin_router.put("/seasons/{season_id}/result-rules")
async def save_season_result_rules(season_id: str, body: ResultRulesBody,
                                   me: dict = Depends(require_league("season", via="season_id"))):
    db = get_db()
    season, game = await _season_and_game(db, season_id)
    before = season.get("result_rules") or {}
    try:
        rules = league_result_rules.clean_rules(body.rules, game, before)
    except league_result_rules.RuleProblem as problem:
        raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None
    modes = sorted(key for key in set(before) | set(rules) if before.get(key) != rules.get(key))
    changed = bool(modes) or "result_rules" not in season or bool(season.get("scores_required")) != body.scores_required \
        or "scores_required" not in season
    if changed:
        await db.league_seasons.update_one({"id": season_id}, {"$set": {
            "result_rules": rules, "scores_required": body.scores_required, "updated_at": now_utc().isoformat()}})
        # Protokoll: welche Modi und ob Punkte Pflicht sind - nicht die Werte.
        await db.audit_logs.insert_one({"id": new_id(), "action": "league.season.result_rules", "actor_id": me.get("id"),
                                        "target_id": season_id, "data": {"modes": modes, "scores_required": body.scores_required},
                                        "created_at": now_utc().isoformat()})
    view = await _view(db, {**season, "result_rules": rules, "scores_required": body.scores_required}, game)
    return {**view, "changed": changed, "staffeln_to_sync": view["staffeln"] if changed else 0}
