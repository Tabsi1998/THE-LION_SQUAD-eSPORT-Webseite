"""Game/Discipline routes."""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import require_admin
from models import GameCreate, GameUpdate, now_utc, new_id

router = APIRouter(prefix="/api/games", tags=["games"])


@router.get("")
async def list_games():
    db = get_db()
    games = await db.games.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return games


@router.get("/{slug_or_id}")
async def get_game(slug_or_id: str):
    db = get_db()
    game = await db.games.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    return game


@router.post("")
async def create_game(body: GameCreate, me: dict = Depends(require_admin())):
    db = get_db()
    slug = body.slug.strip().lower()
    if await db.games.find_one({"slug": slug}):
        raise HTTPException(status_code=409, detail="Slug bereits vergeben")
    doc = body.model_dump()
    doc["slug"] = slug
    doc["id"] = new_id()
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    await db.games.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/{game_id}")
async def update_game(game_id: str, body: GameUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "slug" in updates:
        updates["slug"] = updates["slug"].strip().lower()
        existing = await db.games.find_one({"slug": updates["slug"], "id": {"$ne": game_id}}, {"_id": 0, "id": 1})
        if existing:
            raise HTTPException(status_code=409, detail="Slug bereits vergeben")
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
