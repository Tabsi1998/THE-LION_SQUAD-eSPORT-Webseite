"""Game/Discipline routes."""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import require_admin
from models import GameCreate, GameUpdate, now_utc, new_id

router = APIRouter(prefix="/api/games", tags=["games"])


def _effective_identity_source(game: dict, by_id: dict[str, dict]) -> dict:
    if game.get("identity_source_game_id"):
        return by_id.get(game["identity_source_game_id"]) or game
    if game.get("inherit_player_ids") is not False and game.get("parent_game_id"):
        return by_id.get(game["parent_game_id"]) or game
    return game


def _merge_player_id_fields(source: dict, game: dict) -> list[dict]:
    merged: list[dict] = []
    seen = set()
    for field in (source.get("player_id_fields") or []) + (game.get("player_id_fields") or []):
        if not isinstance(field, dict) or not field.get("key") or field["key"] in seen:
            continue
        seen.add(field["key"])
        merged.append(field)
    return merged


def _game_display_name(game: dict, parent: dict | None = None) -> str:
    name = (game.get("name") or "").strip()
    parent_name = (parent or {}).get("name") or ""
    parent_name = parent_name.strip()
    if game.get("kind") != "edition" or not parent_name or not name:
        return name
    lower_name = name.lower()
    lower_parent = parent_name.lower()
    if lower_name == lower_parent or lower_name.startswith(f"{lower_parent}:"):
        return name
    return f"{parent_name}: {name}"


def _enrich_games(games: list[dict]) -> list[dict]:
    by_id = {game.get("id"): game for game in games if game.get("id")}
    for game in games:
        parent = by_id.get(game.get("parent_game_id"))
        source = _effective_identity_source(game, by_id)
        game["display_name"] = _game_display_name(game, parent)
        if parent:
            game["parent_game"] = {
                "id": parent.get("id"),
                "name": parent.get("name"),
                "display_name": parent.get("display_name") or _game_display_name(parent),
                "slug": parent.get("slug"),
                "short_name": parent.get("short_name"),
            }
        if source and source.get("id") != game.get("id"):
            game["identity_source_game"] = {
                "id": source.get("id"),
                "name": source.get("name"),
                "display_name": source.get("display_name") or _game_display_name(source, by_id.get(source.get("parent_game_id"))),
                "slug": source.get("slug"),
                "short_name": source.get("short_name"),
            }
        game["identity_game_slug"] = source.get("slug") or game.get("slug")
        game["identity_game_name"] = source.get("name") or game.get("name")
        game["effective_player_id_fields"] = _merge_player_id_fields(source, game)
    return games


@router.get("")
async def list_games():
    db = get_db()
    games = await db.games.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return sorted(_enrich_games(games), key=lambda game: (game.get("display_name") or game.get("name") or "").lower())


@router.get("/{slug_or_id}")
async def get_game(slug_or_id: str):
    db = get_db()
    game = await db.games.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    games = await db.games.find({}, {"_id": 0}).to_list(200)
    enriched = _enrich_games(games)
    return next((row for row in enriched if row.get("id") == game.get("id")), game)


@router.post("")
async def create_game(body: GameCreate, me: dict = Depends(require_admin())):
    db = get_db()
    slug = body.slug.strip().lower()
    if await db.games.find_one({"slug": slug}):
        raise HTTPException(status_code=409, detail="Slug bereits vergeben")
    doc = body.model_dump()
    doc["slug"] = slug
    if doc.get("parent_game_id") and not await db.games.find_one({"id": doc["parent_game_id"]}, {"id": 1}):
        raise HTTPException(status_code=404, detail="Hauptspiel nicht gefunden")
    if doc.get("identity_source_game_id") and not await db.games.find_one({"id": doc["identity_source_game_id"]}, {"id": 1}):
        raise HTTPException(status_code=404, detail="ID-Quelle nicht gefunden")
    doc["id"] = new_id()
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    await db.games.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/{game_id}")
@router.patch("/{game_id}")
async def update_game(game_id: str, body: GameUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {"short_name", "logo_url", "cover_url", "genre", "parent_game_id", "identity_source_game_id"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if "slug" in updates:
        updates["slug"] = updates["slug"].strip().lower()
        existing = await db.games.find_one({"slug": updates["slug"], "id": {"$ne": game_id}}, {"_id": 0, "id": 1})
        if existing:
            raise HTTPException(status_code=409, detail="Slug bereits vergeben")
    if updates.get("parent_game_id"):
        if updates["parent_game_id"] == game_id:
            raise HTTPException(status_code=400, detail="Ein Spiel kann nicht sein eigenes Hauptspiel sein")
        if not await db.games.find_one({"id": updates["parent_game_id"]}, {"id": 1}):
            raise HTTPException(status_code=404, detail="Hauptspiel nicht gefunden")
    if updates.get("identity_source_game_id"):
        if updates["identity_source_game_id"] == game_id:
            raise HTTPException(status_code=400, detail="Ein Spiel kann nicht seine eigene externe ID-Quelle sein")
        if not await db.games.find_one({"id": updates["identity_source_game_id"]}, {"id": 1}):
            raise HTTPException(status_code=404, detail="ID-Quelle nicht gefunden")
    updates["updated_at"] = now_utc().isoformat()
    await db.games.update_one({"id": game_id}, {"$set": updates})
    game = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    return game


@router.delete("/{game_id}")
async def delete_game(game_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.games.delete_one({"id": game_id})
    return {"ok": True}
