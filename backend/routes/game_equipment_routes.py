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
from services.mutation_lock import MutationLockBusy, game_equipment_resource, mutation_lock
from services.game_equipment import (CategoriesSave, EquipmentCreate, EquipmentImport, EquipmentMove, EquipmentProblem,
                                     EquipmentUpdate, EquipmentWeapons, SubcategoriesSave)

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


BUSY = "Die Ausrüstung dieses Spiels wird gerade bearbeitet – bitte gleich noch einmal."


async def _locked(db, game: dict, action):
    """Schreiben unter der Sperre der Bibliothek (#2287, Codex Runde 1): Entfernen einer Unterkategorie, Verschieben, Anlegen, Ändern,
    Übernehmen und eine Klassensperre laufen nacheinander - geprüft wird erst unter der Sperre, also gegen den Stand, der gilt."""
    try:
        async with mutation_lock(db, game_equipment_resource(game["id"])):
            return await action()
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=BUSY) from None
    except EquipmentProblem as problem:
        raise _refuse(problem) from None


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
    items = await game_equipment.items_of(db, game["id"], categories=categories)
    return {
        "game": {"id": game["id"], "name": game.get("name"), "slug": game.get("slug"), "modes": game_modes.entries(game)},
        "categories": [{**row, "count": counts.get(row["key"], 0)} for row in categories],
        "items": [{**game_equipment.public_item(row), "in_lists": used.get(row["id"], 0)} for row in items],
        # Ohne Waffe passt ein Aufsatz zu keiner (Obmann, 03.11.) - die Verwaltung weist darauf hin wie bei Maps ohne Modus.
        "attachments_without_weapon": game_equipment.without_weapon(items, categories),
        "limit": game_equipment.ITEMS_PER_GAME_MAX,
        "categories_limit": game_equipment.CATEGORIES_MAX,
        "suggested_categories": [dict(row) for row in game_equipment.SUGGESTED_CATEGORIES],
        # Unterkategorien (#2287): je Kennung die Zahl der Einträge, Grenze und Vorschlag je Art.
        "subcategory_counts": await game_equipment.subcategory_counts(db, game["id"]),
        "subcategories_limit": game_equipment.SUBCATEGORIES_MAX,
        "suggested_subcategories": {role: list(words) for role, words in game_equipment.SUGGESTED_SUBCATEGORIES.items()},
    }


@router.put("/{game_id}/equipment/categories")
async def save_equipment_categories(game_id: str, body: CategoriesSave, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    saved = await _locked(db, game, lambda: game_equipment.save_categories(db, game, body, me))
    await _audit(db, "game.equipment.categories", me, game["id"], {"keys": [row["key"] for row in saved]})
    return {"categories": saved}


@router.put("/{game_id}/equipment/categories/{category_key}/subcategories")
async def save_equipment_subcategories(game_id: str, category_key: str, body: SubcategoriesSave, me: dict = Depends(require_admin())):
    """Unterkategorien einer Kategorie (#2287): anlegen, umbenennen, ordnen, entfernen - die ganze Liste auf einmal."""
    db = get_db()
    game = await _game(db, game_id)
    saved = await _locked(db, game, lambda: game_equipment.save_subcategories(db, game, category_key, body, me))
    await _audit(db, "game.equipment.subcategories", me, game["id"],
                 {"category": category_key, "keys": [row["key"] for row in saved]})
    return {"category": category_key, "subcategories": saved}


@router.post("/{game_id}/equipment/move")
async def move_game_equipment(game_id: str, body: EquipmentMove, me: dict = Depends(require_admin())):
    """Mehrere Einträge einer Kategorie in eine Unterkategorie verschieben (#2287); ``subcategory: null`` = ohne."""
    db = get_db()
    game = await _game(db, game_id)
    updated = await _locked(db, game, lambda: game_equipment.move_items(db, game, body, me))
    await _audit(db, "game.equipment.move", me, game["id"], {"items": updated})
    return {"updated": updated}


@router.post("/{game_id}/equipment/assign-weapons")
async def assign_equipment_weapons(game_id: str, body: EquipmentWeapons, me: dict = Depends(require_admin())):
    """Sammelaktion: Aufsätze ohne Waffe bekommen die gewählten Waffen und Waffenklassen (wie „Maps ohne Modus“)."""
    db = get_db()
    game = await _game(db, game_id)
    updated = await _locked(db, game, lambda: game_equipment.assign_weapons(db, game, body.weapon_ids, me, body.weapon_class_ids))
    await _audit(db, "game.equipment.assign_weapons", me, game["id"],
                 {"weapons": len(body.weapon_ids), "classes": len(body.weapon_class_ids), "updated": updated})
    return {"updated": updated}


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
    result = await _locked(db, game, lambda: game_equipment.import_items(db, game, source, body.item_ids, me, new_id))
    await _audit(db, "game.equipment.import", me, game["id"], {"source_game_id": source["id"], "created": len(result["created"]),
                                                               "skipped": len(result["skipped"])})
    return result


@router.post("/{game_id}/equipment")
async def create_game_equipment(game_id: str, body: EquipmentCreate, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    doc = await _locked(db, game, lambda: game_equipment.create(db, game, body, me, new_id()))
    await _audit(db, "game.equipment.create", me, doc["id"], {"game_id": game["id"], "category": doc["category"]})
    return {**doc, "in_lists": 0}


@router.patch("/{game_id}/equipment/{item_id}")
async def update_game_equipment(game_id: str, item_id: str, body: EquipmentUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    game = await _game(db, game_id)
    current = await _item(db, game, item_id)
    saved = await _locked(db, game, lambda: game_equipment.update(db, game, current, body, me))
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
