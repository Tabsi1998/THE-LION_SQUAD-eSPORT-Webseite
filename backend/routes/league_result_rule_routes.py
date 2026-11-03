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
    # Einstellungen und Regeltext je Modus (#2271): fehlt das Feld, bleibt die Kopie der Season, wie sie ist.
    settings: Optional[Dict[str, Optional[Dict[str, Any]]]] = None


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
            "staffeln": staffeln,
            # Hat die Season Einstellungen je Modus übernommen (#2271)? Ältere Seasons nicht - dort gelten die des Spiels.
            "settings_held": isinstance(season.get("mode_settings"), dict)}


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
    held = season.get("mode_settings") if isinstance(season.get("mode_settings"), dict) else None
    try:
        rules = league_result_rules.clean_rules(body.rules, game, before)
        settings = league_result_rules.clean_settings(body.settings, game, held) if body.settings is not None else held
    except league_result_rules.RuleProblem as problem:
        raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None
    modes = sorted(key for key in set(before) | set(rules) if before.get(key) != rules.get(key))
    setting_modes = sorted(key for key in set(held or {}) | set(settings or {}) if (held or {}).get(key) != (settings or {}).get(key)) \
        if body.settings is not None else []
    changed = bool(modes) or "result_rules" not in season or bool(season.get("scores_required")) != body.scores_required \
        or "scores_required" not in season or bool(setting_modes) or (body.settings is not None and held is None)
    if changed:
        fields = {"result_rules": rules, "scores_required": body.scores_required, "updated_at": now_utc().isoformat()}
        if body.settings is not None:
            fields["mode_settings"] = settings
        await db.league_seasons.update_one({"id": season_id}, {"$set": fields})
        # Protokoll: welche Modi und ob Punkte Pflicht sind - nicht die Werte.
        await db.audit_logs.insert_one({"id": new_id(), "action": "league.season.result_rules", "actor_id": me.get("id"),
                                        "target_id": season_id, "data": {"modes": modes, "scores_required": body.scores_required,
                                                                         **({"settings_modes": setting_modes} if setting_modes else {})},
                                        "created_at": now_utc().isoformat()})
    view = await _view(db, {**season, "result_rules": rules, "scores_required": body.scores_required,
                            **({"mode_settings": settings} if settings is not None else {})}, game)
    return {**view, "changed": changed, "staffeln_to_sync": view["staffeln"] if changed else 0}
