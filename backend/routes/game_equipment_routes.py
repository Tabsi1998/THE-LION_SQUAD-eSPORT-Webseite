"""Ausrüstungs-Bibliothek je Spiel (docs/LIGA.md, C.4 #2218) - Verwaltung der Spiele (Bereich Turnierleitung, wie die Maps).

Lesen und Schreiben nur in der Verwaltung; öffentlich erscheint ein Eintrag nur über die Sperrliste einer Season, als Snapshot. Logik in
``services/game_equipment.py``. Jede Änderung steht im Protokoll (``game.equipment.*``), ohne Werte aus der Anfrage.
"""
from fastapi import APIRouter, Depends, HTTPException

from auth import require_admin
from database import get_db
from models import new_id, now_utc
from routes.game_routes import _enrich_games
from services import game_equipment, game_modes
from services.game_equipment import (CategoriesSave, EquipmentCreate, EquipmentImport, EquipmentProblem, EquipmentUpdate)

router = APIRouter(prefix="/api/games", tags=["game-equipment"])


async def _game(db, game_id: str) -> dict:
    game = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    return game


async def _item(db, game: dict, item_id: str) -> dict:
    found = await db.game_equipment.find_one({"id": item_id, "game_id": game["id"]}, {"_id": 0})
    if not found:
        raise HTTPException(status_code=404, detail="Eintrag nicht gefunden")
    return found


def _refuse(problem: EquipmentProblem) -> HTTPException:
    return HTTPException(status_code=problem.status, detail=problem.message)


async def _audit(db, action: str, me: dict, target_id: str, data: dict | None = None) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": me.get("id"), "target_id": target_id,
                                    "data": data or {}, "created_at": now_utc().isoformat()})


@router.get("/{game_id}/equipment")
async def list_game_equipment(game_id: str, me: dict = Depends(require_admin())):
    """Kategorien und alle Einträge des Spiels (auch archivierte), je mit ``in_lists``: in wie vielen Versionen einer Sperrliste."""
    db = get_db()
    game = await _game(db, game_id)
    categories = await game_equipment.categories_of(db, game["id"])
    used = await game_equipment.usage_counts(db, game["id"])
    counts = await game_equipment.category_counts(db, game["id"])
    return {
        "game": {"id": game["id"], "name": game.get("name"), "slug": game.get("slug"), "modes": game_modes.entries(game)},
        "categories": [{**row, "count": counts.get(row["key"], 0)} for row in categories],
        "items": [{**game_equipment.public_item(row), "in_lists": used.get(row["id"], 0)}
                  for row in await game_equipment.items_of(db, game["id"], categories=categories)],
        "limit": game_equipment.ITEMS_PER_GAME_MAX,
        "categories_limit": game_equipment.CATEGORIES_MAX,
        "suggested_categories": [dict(row) for row in game_equipment.SUGGESTED_CATEGORIES],
    }


@router.put("/{game_id}/equipment/categories")
async def save_equipment_categories(game_id: str, body: CategoriesSave, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    try:
        saved = await game_equipment.save_categories(db, game, body, me)
    except EquipmentProblem as problem:
        raise _refuse(problem) from None
    await _audit(db, "game.equipment.categories", me, game["id"], {"keys": [row["key"] for row in saved]})
    return {"categories": saved}


@router.get("/{game_id}/equipment/import-sources")
async def equipment_import_sources(game_id: str, me: dict = Depends(require_admin())):
    """Die anderen Spiele mit aktiven Einträgen; Hauptspiel und Versionen derselben Reihe zuerst."""
    db = get_db()
    game = await _game(db, game_id)
    family = game.get("parent_game_id") or game["id"]
    rows = []
    for other in _enrich_games(await db.games.find({}, {"_id": 0}).to_list(500)):
        if other["id"] == game["id"]:
            continue
        count = await db.game_equipment.count_documents({"game_id": other["id"], "status": {"$nin": ["inactive", "archived"]}})
        if count:
            related = family in (other["id"], other.get("parent_game_id"))
            rows.append({"id": other["id"], "name": other.get("display_name") or other.get("name"), "items": count, "related": related})
    return sorted(rows, key=lambda row: (not row["related"], str(row["name"]).casefold()))


@router.get("/{game_id}/equipment/import-sources/{source_id}")
async def equipment_import_candidates(game_id: str, source_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    source = await _game(db, source_id)
    return {"source": {"id": source["id"], "name": source.get("name")},
            "items": await game_equipment.import_candidates(db, game, source)}


@router.post("/{game_id}/equipment/import")
async def import_game_equipment(game_id: str, body: EquipmentImport, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    if body.source_game_id == game["id"]:
        raise HTTPException(status_code=422, detail="Bitte ein anderes Spiel als Quelle wählen.")
    source = await _game(db, body.source_game_id)
    try:
        result = await game_equipment.import_items(db, game, source, body.item_ids, me, new_id)
    except EquipmentProblem as problem:
        raise _refuse(problem) from None
    await _audit(db, "game.equipment.import", me, game["id"], {"source_game_id": source["id"], "created": len(result["created"]),
                                                               "skipped": len(result["skipped"])})
    return result


@router.post("/{game_id}/equipment")
async def create_game_equipment(game_id: str, body: EquipmentCreate, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    try:
        doc = await game_equipment.create(db, game, body, me, new_id())
    except EquipmentProblem as problem:
        raise _refuse(problem) from None
    await _audit(db, "game.equipment.create", me, doc["id"], {"game_id": game["id"], "category": doc["category"]})
    return {**doc, "in_lists": 0}


@router.patch("/{game_id}/equipment/{item_id}")
async def update_game_equipment(game_id: str, item_id: str, body: EquipmentUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    current = await _item(db, game, item_id)
    try:
        saved = await game_equipment.update(db, game, current, body, me)
    except EquipmentProblem as problem:
        raise _refuse(problem) from None
    await _audit(db, "game.equipment.update", me, current["id"],
                 {"game_id": game["id"], "fields": sorted(body.model_dump(exclude_unset=True))})
    return {**saved, "in_lists": (await game_equipment.usage_counts(db, game["id"])).get(current["id"], 0)}


@router.delete("/{game_id}/equipment/{item_id}")
async def delete_game_equipment(game_id: str, item_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    current = await _item(db, game, item_id)
    try:
        await game_equipment.delete(db, game, current)
    except EquipmentProblem as problem:
        raise _refuse(problem) from None
    await _audit(db, "game.equipment.delete", me, current["id"], {"game_id": game["id"], "category": current.get("category")})
    return {"ok": True}
