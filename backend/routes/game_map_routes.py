"""Map-Bibliothek je Spiel (#1616) - Verwaltung der Spiele (Bereich Turnierleitung, wie ``game_routes``).

Lesen und Schreiben nur in der Verwaltung; öffentlich erscheinen Maps nur über die Pools eines Wettbewerbs
(``map_pool_routes``), als Snapshot. Logik in ``services/game_maps.py``.
"""
from fastapi import APIRouter, Depends, HTTPException

from auth import require_admin
from database import get_db
from models import new_id
from routes.game_routes import _enrich_games
from services import game_maps, game_modes, map_pools
from services.game_maps import DEFAULT_POOL_SCOPE, GameMapCreate, GameMapImport, GameMapModes, GameMapOrder, GameMapUpdate, MapProblem
from services.map_pools import MapPoolSave

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
                 "modes": game_modes.entries(game)},
        "maps": [{**game_maps.public_map(row), "in_pools": used.get(row["id"], 0)}
                 for row in await game_maps.maps_of(db, game["id"])],
        "limit": game_maps.MAPS_PER_GAME_MAX,
        "default_pool": await map_pools.admin_entry(db, await map_pools.current(db, DEFAULT_POOL_SCOPE, game["id"]), game["id"],
                                                    DEFAULT_POOL_SCOPE),
    }


# ---------------------------------------------------------------- Standard-Pool (#2129, SP3)

@router.put("/{game_id}/default-pool")
async def save_default_pool(game_id: str, body: MapPoolSave, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    try:
        doc = await map_pools.save(db, scope=DEFAULT_POOL_SCOPE, scope_id=game["id"], game=game, body=body, user=me)
    except MapProblem as problem:
        raise _refuse(problem) from None
    return map_pools.saved_view(doc, DEFAULT_POOL_SCOPE, admin=True)


@router.delete("/{game_id}/default-pool")
async def clear_default_pool(game_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    try:
        await map_pools.clear(db, scope=DEFAULT_POOL_SCOPE, scope_id=game["id"], user=me)
    except MapProblem as problem:
        raise _refuse(problem) from None
    return {"ok": True}


# ---------------------------------------------------------------- Aus einer anderen Spielversion übernehmen (#2129, SP4)

@router.get("/{game_id}/maps/import-sources")
async def map_import_sources(game_id: str, me: dict = Depends(require_admin())):
    """Die anderen Spiele mit aktiven Maps; Hauptspiel und Versionen derselben Reihe zuerst. Auch archivierte: gerade die
    alte Version ist die übliche Quelle."""
    db = get_db()
    game = await _game(db, game_id)
    games = _enrich_games(await db.games.find({}, {"_id": 0}).to_list(500))
    family = game.get("parent_game_id") or game["id"]
    rows = []
    for other in games:
        if other["id"] == game["id"]:
            continue
        count = await db.game_maps.count_documents({"game_id": other["id"], "status": "active"})
        if count:
            related = family in (other["id"], other.get("parent_game_id"))
            rows.append({"id": other["id"], "name": other.get("display_name") or other.get("name"), "maps": count, "related": related})
    return sorted(rows, key=lambda row: (not row["related"], str(row["name"]).casefold()))


@router.get("/{game_id}/maps/import-sources/{source_id}")
async def map_import_candidates(game_id: str, source_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    source = await _game(db, source_id)
    return {"source": {"id": source["id"], "name": source.get("name")},
            "maps": await game_maps.import_candidates(db, game, source)}


@router.post("/{game_id}/maps/import")
async def import_game_maps(game_id: str, body: GameMapImport, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    if body.source_game_id == game["id"]:
        raise HTTPException(status_code=422, detail="Bitte ein anderes Spiel als Quelle wählen.")
    source = await _game(db, body.source_game_id)
    return await game_maps.import_maps(db, game, source, body.map_ids, me, new_id)


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


@router.post("/{game_id}/maps/assign-modes")
async def assign_game_map_modes(game_id: str, body: GameMapModes, me: dict = Depends(require_admin())):
    """Sammelaktion (#2129): die aktiven Maps ohne Modus bekommen die gewählten Modi."""
    db = get_db()
    game = await _game(db, game_id)
    try:
        return {"updated": await game_maps.assign_modes(db, game, body.modes, me)}
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
