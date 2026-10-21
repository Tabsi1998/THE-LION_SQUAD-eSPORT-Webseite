"""Map-Pools je Wettbewerb (#1616): Turnier, Phase und Saison einer Referenzen-Serie. Logik und Lesevertrag in
``services/map_pools.py``.

- Öffentlich: ``GET /api/map-pools/tournaments/{tid}`` - dieselbe Sichtbarkeit wie Turnierbaum und Phasen. Die Saison
  einer Serie liefert ihren Pool auf der Serienseite (``map_pool`` in ``/api/reference-series/public/...``).
- Turnier und Phase schreiben nur Turnierleitung und Strukturrollen des Turniers (wie Phasen), nicht in einem
  gesperrten Turnier, nacheinander unter der Turniersperre.
- Saison: lesen Vorstand und Captains der Saison (für das Ergebnisblatt), schreiben nur der Vorstand.
"""
from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user, get_optional_user
from database import get_db
from models import new_id, now_utc
from routes.tournament_common import (
    _audit_tournament_action,
    _ensure_tournament_unlocked,
    _get_visible_tournament,
    _resolve_tid,
    _serialized_tournament_write,
)
from services import map_pools
from services.game_maps import MapProblem
from services.map_pools import MapPoolSave
from services.reference_series_access import SeriesAccess, require_series_editor
from services.tournament_permissions import STRUCTURE_STAFF_ROLES, require_tournament_staff_permission

router = APIRouter(prefix="/api/map-pools", tags=["map-pools"])


def _refuse(problem: MapProblem) -> HTTPException:
    return HTTPException(status_code=problem.status, detail=problem.message)


# ---------------------------------------------------------------- Turnier und Phase

@router.get("/tournaments/{tid}")
async def tournament_map_pools(tid: str, user: dict | None = Depends(get_optional_user)):
    tid = await _resolve_tid(tid)
    tournament = await _get_visible_tournament(tid, user)
    return await map_pools.tournament_overview(get_db(), tournament)


@router.get("/tournaments/{tid}/admin")
async def tournament_map_pools_admin(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    return await map_pools.tournament_overview(db, tournament, admin=True)


async def _writable(db, tid: str, me: dict) -> dict:
    tournament = await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    return tournament


async def _stage(db, tid: str, stage_id: str) -> dict:
    stage = await db.tournament_stages.find_one({"id": stage_id, "tournament_id": tid}, {"_id": 0, "id": 1})
    if not stage:
        raise HTTPException(status_code=404, detail="Phase nicht gefunden")
    return stage


async def _save_for_tournament(db, tournament: dict, scope: str, scope_id: str, body: MapPoolSave, me: dict) -> dict:
    game = await db.games.find_one({"id": tournament.get("game_id")}, {"_id": 0}) if tournament.get("game_id") else None
    try:
        doc = await map_pools.save(db, scope=scope, scope_id=scope_id, game=game, body=body, user=me,
                                   tournament_id=tournament["id"])
    except MapProblem as problem:
        raise _refuse(problem) from None
    await _audit_tournament_action(db, "tournament.map_pool.save", me.get("id"), tournament["id"],
                                   {"scope": scope, "scope_id": scope_id, "version": doc["version"],
                                    "pool_id": doc["id"]})
    return map_pools.saved_view(doc, scope, admin=True)


async def _clear_for_tournament(db, tournament: dict, scope: str, scope_id: str, me: dict) -> dict:
    doc = await map_pools.clear(db, scope=scope, scope_id=scope_id, user=me, tournament_id=tournament["id"])
    if doc:
        await _audit_tournament_action(db, "tournament.map_pool.clear", me.get("id"), tournament["id"],
                                       {"scope": scope, "scope_id": scope_id, "version": doc["version"]})
    return {"ok": True}


@router.put("/tournaments/{tid}")
async def save_tournament_map_pool(tid: str, body: MapPoolSave, me: dict = Depends(get_current_user),
                                   _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tournament = await _writable(db, await _resolve_tid(tid), me)
    return await _save_for_tournament(db, tournament, "tournament", tournament["id"], body, me)


@router.delete("/tournaments/{tid}")
async def clear_tournament_map_pool(tid: str, me: dict = Depends(get_current_user),
                                    _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tournament = await _writable(db, await _resolve_tid(tid), me)
    return await _clear_for_tournament(db, tournament, "tournament", tournament["id"], me)


@router.put("/tournaments/{tid}/stages/{stage_id}")
async def save_stage_map_pool(tid: str, stage_id: str, body: MapPoolSave, me: dict = Depends(get_current_user),
                              _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tournament = await _writable(db, await _resolve_tid(tid), me)
    stage = await _stage(db, tournament["id"], stage_id)
    return await _save_for_tournament(db, tournament, "stage", stage["id"], body, me)


@router.delete("/tournaments/{tid}/stages/{stage_id}")
async def clear_stage_map_pool(tid: str, stage_id: str, me: dict = Depends(get_current_user),
                               _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tournament = await _writable(db, await _resolve_tid(tid), me)
    stage = await _stage(db, tournament["id"], stage_id)
    return await _clear_for_tournament(db, tournament, "stage", stage["id"], me)


# ---------------------------------------------------------------- Saison einer Referenzen-Serie

async def _series_game(db, series: dict) -> tuple[dict, dict | None]:
    lineage = await db.reference_lineages.find_one({"id": series.get("lineage_id")}, {"_id": 0}) or {}
    game = await db.games.find_one({"id": lineage["game_id"]}, {"_id": 0}) if lineage.get("game_id") else None
    return lineage, game


@router.get("/reference-series/{series_id}")
async def series_map_pool(series_id: str, access: SeriesAccess = Depends(require_series_editor)):
    """Für die Verwaltung der Saison und das Ergebnisblatt: Spiel, Bibliothek, Pool. Captains lesen ohne Vermerke."""
    db = get_db()
    lineage, game = await _series_game(db, access.series)
    own = await map_pools.current(db, "reference_series", access.series_id)
    game_id = (game or {}).get("id")
    pool = (await map_pools.admin_entry(db, own, game_id, "reference_series") if access.is_board
            else map_pools.view(map_pools.valid_for(own, game_id), "reference_series"))
    previous = await map_pools.previous_series_pool(db, lineage, access.series) if access.is_board and game else None
    return {"game": map_pools.game_summary(game), "library": await map_pools.library(db, game), "pool": pool,
            "previous": previous}


async def _audit_series(db, me: dict, series_id: str, action: str, doc: dict) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": me["id"], "target_id": series_id,
                                    "data": {"version": doc["version"], "pool_id": doc["id"]},
                                    "created_at": now_utc().isoformat()})


@router.put("/reference-series/{series_id}")
async def save_series_map_pool(series_id: str, body: MapPoolSave,
                               access: SeriesAccess = Depends(require_series_editor)):
    access.require_board()
    db = get_db()
    _lineage, game = await _series_game(db, access.series)
    try:
        doc = await map_pools.save(db, scope="reference_series", scope_id=access.series_id, game=game, body=body,
                                   user=access.user)
    except MapProblem as problem:
        raise _refuse(problem) from None
    await _audit_series(db, access.user, access.series_id, "reference_series.map_pool.save", doc)
    return map_pools.saved_view(doc, "reference_series", admin=True)


@router.delete("/reference-series/{series_id}")
async def clear_series_map_pool(series_id: str, access: SeriesAccess = Depends(require_series_editor)):
    access.require_board()
    db = get_db()
    doc = await map_pools.clear(db, scope="reference_series", scope_id=access.series_id, user=access.user)
    if doc:
        await _audit_series(db, access.user, access.series_id, "reference_series.map_pool.clear", doc)
    return {"ok": True}
