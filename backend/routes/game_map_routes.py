"""Map-Bibliothek je Spiel (#1616) - Verwaltung der Spiele (Bereich Turnierleitung, wie ``game_routes``).

Lesen und Schreiben nur in der Verwaltung; öffentlich erscheinen Maps nur über die Pools eines Wettbewerbs
(``map_pool_routes``), als Snapshot. Logik in ``services/game_maps.py``.
"""
from fastapi import APIRouter, Depends, HTTPException

from auth import require_admin
from database import get_db
from models import new_id
from services import game_maps
from services.game_maps import GameMapCreate, GameMapOrder, GameMapUpdate, MapProblem

router = APIRouter(prefix="/api/games", tags=["game-maps"])


async def _game(db, game_id: str) -> dict:
    game = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    return game


async def _map(db, game: dict, map_id: str) -> dict:
    found = await db.game_maps.find_one({"id": map_id, "game_id": game["id"]}, {"_id": 0})
    if not found:
        raise HTTPException(status_code=404, detail="Map nicht gefunden")
    return found


def _refuse(problem: MapProblem) -> HTTPException:
    return HTTPException(status_code=problem.status, detail=problem.message)


@router.get("/{game_id}/maps")
async def list_game_maps(game_id: str, me: dict = Depends(require_admin())):
    """Alle Maps des Spiels (auch archivierte) mit den Modi des Spiels und wie oft jede in einem Pool steht."""
    db = get_db()
    game = await _game(db, game_id)
    used = await game_maps.usage_counts(db, game["id"])
    return {
        "game": {"id": game["id"], "name": game.get("name"), "slug": game.get("slug"), "kind": game.get("kind"),
                 "modes": game_maps.game_modes(game)},
        "maps": [{**game_maps.public_map(row), "in_pools": used.get(row["id"], 0)}
                 for row in await game_maps.maps_of(db, game["id"])],
        "limit": game_maps.MAPS_PER_GAME_MAX,
    }


@router.post("/{game_id}/maps")
async def create_game_map(game_id: str, body: GameMapCreate, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    try:
        return await game_maps.create(db, game, body, me, new_id())
    except MapProblem as problem:
        raise _refuse(problem) from None


@router.put("/{game_id}/maps/order")
async def order_game_maps(game_id: str, body: GameMapOrder, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    try:
        return {"maps": await game_maps.reorder(db, game, body.ids, me)}
    except MapProblem as problem:
        raise _refuse(problem) from None


@router.patch("/{game_id}/maps/{map_id}")
async def update_game_map(game_id: str, map_id: str, body: GameMapUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    current = await _map(db, game, map_id)
    try:
        return await game_maps.update(db, game, current, body, me)
    except MapProblem as problem:
        raise _refuse(problem) from None


@router.delete("/{game_id}/maps/{map_id}")
async def delete_game_map(game_id: str, map_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    current = await _map(db, game, map_id)
    try:
        await game_maps.delete(db, game, current)
    except MapProblem as problem:
        raise _refuse(problem) from None
    return {"ok": True}
