"""Saisonabschluss in der Verwaltung (F.1, #1645, docs/LIGA.md „F.1 Saisonabschluss“).

- ``GET  /api/admin/leagues/seasons/{season_id}/closing``: das Cockpit - je Staffel Sperrgründe mit Link, Vorschau bzw. Endstand,
  Gleichstand auf Platz 1, Verlauf der Fassungen. Jede Zuständigkeit der Liga.
- ``POST /api/admin/leagues/staffeln/{tournament_id}/close``: abschließen, mit Bestätigung - Zuständigkeit „Season
  konfigurieren“, nie mit dem eigenen Team in der Staffel (Befangenheit, B.1). Gleichzeitiges Abschließen: einer gewinnt, 409.
- ``POST /api/admin/leagues/staffeln/{tournament_id}/reopen``: wieder öffnen, mit Pflichtgrund, durch eine zweite Person (Nr. 155).
- ``GET  /api/admin/leagues/staffeln/{tournament_id}/final-tables/{version}``: eine Fassung aus dem Verlauf mit ihrer Tabelle.

Den Gleichstand auf Platz 1 entscheidet die Leitung über ``PUT …/staffeln/{tid}/table-decision`` (E.1). Logik in
``services/league_final.py``.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from database import get_db
from services import league_cross_decisions, league_cross_zones, league_final
from services.change_events import publish_api_change
from services.league_permissions import ANY, require_league
from services.league_scope import ONLY_LEAGUE
from services.log_safe import log_safe
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])
logger = logging.getLogger("tls.league_final_routes")

require_close = require_league(league_final.CLOSE_CAPABILITY, via="tournament_id")


class CloseBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm: bool = False
    conflict_reason: str | None = Field(default=None, max_length=500)


class ReopenBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(max_length=500)
    # Notausnahme des Superadmins, der selbst abgeschlossen hat (Nr. 155).
    emergency_reason: str | None = Field(default=None, max_length=500)
    conflict_reason: str | None = Field(default=None, max_length=500)


class ZoneDecisionBody(BaseModel):
    """Entscheid der Leitung bei Gleichstand über Staffeln hinweg (#1627): welche der Gleichen den Platz bekommen."""
    model_config = ConfigDict(extra="forbid")

    kind: str = Field(max_length=20)
    registration_ids: list[str] = Field(max_length=32)
    # ``playoff`` (Entscheidungsspiel) oder ``lead`` (Entscheid der Leitung) - kein Los (Nr. 156).
    method: str | None = Field(default=None, max_length=20)
    reason: str = Field(default="", max_length=500)
    conflict_reason: str | None = Field(default=None, max_length=500)


class ZoneDecisionClear(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(default="", max_length=500)
    # Notausnahme des Superadmins beim eigenen Team - wie beim Entscheiden.
    conflict_reason: str | None = Field(default=None, max_length=500)


def _refuse(problem: league_final.FinalProblem) -> HTTPException:
    return HTTPException(status_code=problem.status, detail=problem.message)


async def _staffel(db, tournament_id: str) -> dict:
    tournament = await db.tournaments.find_one({"id": tournament_id, **ONLY_LEAGUE}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Staffel nicht gefunden.")
    return tournament


async def _published(tournament_id: str) -> None:
    """Website und TV lesen die Tabelle neu - sie ist jetzt der Endstand bzw. wieder gerechnet."""
    await publish_api_change("PUT", f"/api/tournaments/{tournament_id}/standings", 200)


@admin_router.get("/seasons/{season_id}/closing")
async def admin_season_closing(season_id: str, me: dict = Depends(require_league(ANY, via="season_id"))):
    db = get_db()
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return await league_final.season_overview(db, season, me)


@admin_router.post("/staffeln/{tournament_id}/close")
async def admin_close_staffel(tournament_id: str, body: CloseBody, me: dict = Depends(require_close)):
    db = get_db()
    if not body.confirm:
        raise HTTPException(status_code=422, detail="Bitte den Abschluss bestätigen.")
    try:
        async with mutation_lock(db, tournament_write_resource(tournament_id)):
            result = await league_final.close(db, await _staffel(db, tournament_id), me, conflict_reason=body.conflict_reason)
    except league_final.FinalProblem as problem:
        raise _refuse(problem) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=league_final.BUSY) from None
    await _published(tournament_id)
    final = result["final"]
    # Saisonende-Moment (#1639): Bestätigt dieser Abschluss den Endstand der ganzen Season, entstehen die Momente für Aufstieg, Abstieg
    # und Meister. Der Abschluss steht; ein Fehler hier hält ihn nicht auf.
    await _moments_follow(db, final.get("season_id"), tournament_id)
    return {"ok": True, "version": final["version"], "closed_at": final["closed_at"],
            "champion": (final.get("champion") or {}).get("display_name"), "season_status": result["season_status"]}


@admin_router.post("/staffeln/{tournament_id}/reopen")
async def admin_reopen_staffel(tournament_id: str, body: ReopenBody, me: dict = Depends(require_close)):
    db = get_db()
    try:
        async with mutation_lock(db, tournament_write_resource(tournament_id)):
            result = await league_final.reopen(db, await _staffel(db, tournament_id), me, body.reason,
                                               conflict_reason=body.conflict_reason, emergency_reason=body.emergency_reason)
    except league_final.FinalProblem as problem:
        raise _refuse(problem) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=league_final.BUSY) from None
    await _published(tournament_id)
    # Saisonende-Moment (#1639): Der Endstand steht nicht mehr fest - die Momente der Season ruhen.
    await _moments_follow(db, result["final"].get("season_id"), tournament_id)
    return {"ok": True, "version": result["final"]["version"], "season_status": result["season_status"]}


@admin_router.get("/staffeln/{tournament_id}/final-tables/{version}")
async def admin_final_table_version(tournament_id: str, version: int, _me: dict = Depends(require_league(ANY, via="tournament_id"))):
    db = get_db()
    await _staffel(db, tournament_id)
    try:
        return await league_final.version_view(db, tournament_id, version)
    except league_final.FinalProblem as problem:
        raise _refuse(problem) from None


# ---------------------------------------------------------------- Plätze über Staffeln hinweg (#1627)

require_zone_decision = require_league("results", via="division_id")


async def _moments_follow(db, season_id: str | None, ref: str) -> None:
    """Nach einem Schritt, der den Endstand ändert (Abschluss, Wiederöffnen, Entscheid über Staffeln hinweg): der Saisonende-Moment
    (``league_moments.sync``). Der Schritt steht; ein Fehler hier hält ihn nicht auf."""
    from services import league_moments

    try:
        await league_moments.sync(db, season_id)
    except Exception:  # noqa: BLE001 - siehe oben
        logger.warning("[league_final] Saisonende-Moment nach Änderung des Endstands nicht nachgezogen: %s", log_safe(ref), exc_info=True)


async def _division_season(db, division_id: str) -> str | None:
    division = await db.league_divisions.find_one({"id": division_id}, {"_id": 0, "season_id": 1})
    return (division or {}).get("season_id")


@admin_router.put("/divisions/{division_id}/zone-decision")
async def admin_set_zone_decision(division_id: str, body: ZoneDecisionBody, me: dict = Depends(require_zone_decision)):
    """Gleichstand an der Grenze des Vergleichs über Staffeln hinweg entscheiden - ``results``, mit Art und Grund, nie über das eigene
    Team (Befangenheit wie beim Gleichstand in der Tabelle)."""
    try:
        decision = await league_cross_decisions.decide(get_db(), division_id, body.model_dump(), me)
    except league_cross_zones.CrossProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None
    # Ein Entscheid nach dem letzten Abschluss ändert, wer auf- oder absteigt (#1639): der Moment zieht ruhig nach.
    await _moments_follow(get_db(), await _division_season(get_db(), division_id), division_id)
    return {"ok": True, "decision": {key: decision[key] for key in ("id", "registration_ids", "method", "reason", "at")}}


@admin_router.delete("/divisions/{division_id}/zone-decision/{kind}")
async def admin_clear_zone_decision(division_id: str, kind: str, body: ZoneDecisionClear, me: dict = Depends(require_zone_decision)):
    try:
        await league_cross_decisions.clear(get_db(), division_id, kind, body.reason, me, conflict_reason=body.conflict_reason)
    except league_cross_zones.CrossProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None
    await _moments_follow(get_db(), await _division_season(get_db(), division_id), division_id)
    return {"ok": True}
