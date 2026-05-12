"""Community game server directory and admin maintenance."""
import re
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_optional_user, require_admin
from database import get_db
from models import new_id, now_utc


ServerVisibility = Literal["public", "community", "members", "internal"]
ServerStatus = Literal["online", "offline", "maintenance", "planned"]

router = APIRouter(prefix="/api/game-servers", tags=["game-servers"])


DEFAULT_GAME_SERVERS = [
    {"name": "THE LION SQUAD (Minecraft Survival)", "game_name": "Minecraft", "slug": "minecraft-survival", "status": "online", "visibility": "public", "address": "gameserver.lionsquad.at:25565", "max_players": 100, "sort_order": 10},
    {"name": "THE LION SQUAD eSPORTS (Assetto Corsa Competizione)", "game_name": "Assetto Corsa Competizione", "slug": "assetto-corsa-competizione", "status": "offline", "visibility": "public", "address": "gameserver.lionsquad.at:9231", "sort_order": 20},
    {"name": "THE LION SQUAD (Rust)", "game_name": "Rust", "slug": "rust", "status": "online", "visibility": "community", "address": "gameserver.lionsquad.at:28015", "max_players": 100, "sort_order": 30},
    {"name": "THE LION SQUAD eSPORTS (7 Days To Die)", "game_name": "7 Days To Die", "slug": "7-days-to-die", "status": "online", "visibility": "community", "address": "gameserver.lionsquad.at:26900", "max_players": 8, "sort_order": 40},
    {"name": "THE LION SQUAD (Palworld)", "game_name": "Palworld", "slug": "palworld", "status": "online", "visibility": "community", "address": "gameserver.lionsquad.at:8211", "max_players": 32, "sort_order": 50},
    {"name": "THE LION SQUAD eSPORT (Windrose)", "game_name": "Windrose", "slug": "windrose", "status": "online", "visibility": "members", "address": "gameserver.lionsquad.at:7779", "max_players": 8, "sort_order": 60},
    {"name": "THE LION SQUAD eSPORTS (Core Keeper)", "game_name": "Core Keeper", "slug": "core-keeper", "status": "online", "visibility": "members", "address": "gameserver.lionsquad.at:27016", "max_players": 10, "sort_order": 70},
    {"name": "THE LION SQUAD (ARK)", "game_name": "ARK", "slug": "ark", "status": "offline", "visibility": "members", "address": "gameserver.lionsquad.at:7777", "sort_order": 80},
    {"name": "THE LION SQUAD (Satisfactory)", "game_name": "Satisfactory", "slug": "satisfactory", "status": "offline", "visibility": "members", "address": "gameserver.lionsquad.at:7778", "sort_order": 90},
]


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return slug[:80] or f"server-{new_id()[:8]}"


def _is_admin(user: dict | None) -> bool:
    return bool(user and user.get("role") in {"moderator", "tournament_admin", "club_admin", "superadmin"})


def _can_view(server: dict, user: dict | None) -> bool:
    if server.get("is_active") is False:
        return False
    visibility = server.get("visibility") or "public"
    if visibility == "internal":
        return False
    if visibility == "public":
        return True
    if visibility == "community":
        return bool(user)
    if visibility == "members":
        return bool(user and (user.get("is_club_member") or _is_admin(user)))
    return False


async def _unique_slug(db, base: str, current_id: str | None = None) -> str:
    slug = _slugify(base)
    candidate = slug
    i = 2
    while True:
        query = {"slug": candidate}
        if current_id:
            query["id"] = {"$ne": current_id}
        if not await db.game_servers.find_one(query, {"_id": 1}):
            return candidate
        candidate = f"{slug}-{i}"
        i += 1


async def _game_lookup(db, game_ids: list[str]) -> dict[str, dict]:
    if not game_ids:
        return {}
    games = await db.games.find(
        {"id": {"$in": game_ids}},
        {"_id": 0, "id": 1, "slug": 1, "name": 1, "short_name": 1, "logo_url": 1},
    ).to_list(500)
    return {game["id"]: game for game in games}


def _public_doc(server: dict, game: dict | None = None) -> dict:
    doc = {k: v for k, v in server.items() if k not in {"_id", "amp_url", "amp_username", "amp_password", "amp_session_id"}}
    if game:
        doc["game"] = game
    return doc


class GameServerPayload(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    slug: Optional[str] = Field(default=None, max_length=90)
    game_id: Optional[str] = None
    game_name: Optional[str] = Field(default=None, max_length=120)
    description: Optional[str] = None
    status: ServerStatus = "offline"
    visibility: ServerVisibility = "community"
    address: Optional[str] = Field(default=None, max_length=180)
    connect_url: Optional[str] = Field(default=None, max_length=300)
    password_hint: Optional[str] = Field(default=None, max_length=180)
    rules_url: Optional[str] = Field(default=None, max_length=300)
    map_name: Optional[str] = Field(default=None, max_length=120)
    version: Optional[str] = Field(default=None, max_length=80)
    player_count: int = Field(default=0, ge=0)
    max_players: Optional[int] = Field(default=None, ge=0)
    player_names: list[str] = Field(default_factory=list)
    amp_instance_name: Optional[str] = Field(default=None, max_length=180)
    amp_module: Optional[str] = Field(default=None, max_length=80)
    amp_url: Optional[str] = Field(default=None, max_length=300)
    last_sync_error: Optional[str] = None
    is_active: bool = True
    sort_order: int = 100


class GameServerPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    slug: Optional[str] = Field(default=None, max_length=90)
    game_id: Optional[str] = None
    game_name: Optional[str] = Field(default=None, max_length=120)
    description: Optional[str] = None
    status: Optional[ServerStatus] = None
    visibility: Optional[ServerVisibility] = None
    address: Optional[str] = Field(default=None, max_length=180)
    connect_url: Optional[str] = Field(default=None, max_length=300)
    password_hint: Optional[str] = Field(default=None, max_length=180)
    rules_url: Optional[str] = Field(default=None, max_length=300)
    map_name: Optional[str] = Field(default=None, max_length=120)
    version: Optional[str] = Field(default=None, max_length=80)
    player_count: Optional[int] = Field(default=None, ge=0)
    max_players: Optional[int] = Field(default=None, ge=0)
    player_names: Optional[list[str]] = None
    amp_instance_name: Optional[str] = Field(default=None, max_length=180)
    amp_module: Optional[str] = Field(default=None, max_length=80)
    amp_url: Optional[str] = Field(default=None, max_length=300)
    last_sync_error: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


async def seed_default_game_servers():
    db = get_db()
    for index, item in enumerate(DEFAULT_GAME_SERVERS):
        await db.game_servers.update_one(
            {"slug": item["slug"]},
            {"$setOnInsert": {
                "id": new_id(),
                "description": "",
                "player_count": 0,
                "player_names": [],
                "is_active": True,
                "created_at": now_utc().isoformat(),
                "updated_at": now_utc().isoformat(),
                "last_sync_at": None,
                "sort_order": index * 10,
                **item,
            }},
            upsert=True,
        )


@router.get("")
async def list_game_servers(me: dict | None = Depends(get_optional_user)):
    db = get_db()
    rows = await db.game_servers.find({}, {"_id": 0}).sort([("sort_order", 1), ("name", 1)]).to_list(500)
    visible = [row for row in rows if _can_view(row, me)]
    game_by_id = await _game_lookup(db, [row.get("game_id") for row in visible if row.get("game_id")])
    items = [_public_doc(row, game_by_id.get(row.get("game_id"))) for row in visible]
    summary = {
        "total": len(items),
        "online": sum(1 for row in items if row.get("status") == "online"),
        "public": sum(1 for row in items if row.get("visibility") == "public"),
        "community": sum(1 for row in items if row.get("visibility") == "community"),
        "members": sum(1 for row in items if row.get("visibility") == "members"),
        "players_online": sum(int(row.get("player_count") or 0) for row in items if row.get("status") == "online"),
    }
    return {"items": items, "summary": summary}


@router.get("/admin")
async def admin_list_game_servers(me: dict = Depends(require_admin())):
    db = get_db()
    rows = await db.game_servers.find({}, {"_id": 0}).sort([("sort_order", 1), ("name", 1)]).to_list(500)
    game_by_id = await _game_lookup(db, [row.get("game_id") for row in rows if row.get("game_id")])
    return [_public_doc(row, game_by_id.get(row.get("game_id"))) for row in rows]


@router.post("")
async def create_game_server(body: GameServerPayload, me: dict = Depends(require_admin())):
    db = get_db()
    data = body.model_dump()
    data["slug"] = await _unique_slug(db, data.get("slug") or data["name"])
    now = now_utc().isoformat()
    doc = {
        **data,
        "id": new_id(),
        "created_at": now,
        "updated_at": now,
        "last_sync_at": None,
        "created_by": me["id"],
    }
    await db.game_servers.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/{server_id}")
@router.patch("/{server_id}")
async def update_game_server(server_id: str, body: GameServerPatch, me: dict = Depends(require_admin())):
    db = get_db()
    existing = await db.game_servers.find_one({"id": server_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Server nicht gefunden.")
    nullable_fields = {
        "game_id", "game_name", "description", "address", "connect_url", "password_hint",
        "rules_url", "map_name", "version", "max_players", "amp_instance_name",
        "amp_module", "amp_url", "last_sync_error",
    }
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if "slug" in updates:
        updates["slug"] = await _unique_slug(db, updates.get("slug") or existing.get("name") or server_id, server_id)
    if "name" in updates and not updates.get("slug") and not existing.get("slug"):
        updates["slug"] = await _unique_slug(db, updates["name"], server_id)
    if not updates:
        raise HTTPException(400, "Keine Änderungen.")
    updates["updated_at"] = now_utc().isoformat()
    await db.game_servers.update_one({"id": server_id}, {"$set": updates})
    return await db.game_servers.find_one({"id": server_id}, {"_id": 0})


@router.post("/{server_id}/touch")
async def touch_game_server(server_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.game_servers.update_one(
        {"id": server_id},
        {"$set": {"last_sync_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(), "last_sync_error": None}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Server nicht gefunden.")
    return await db.game_servers.find_one({"id": server_id}, {"_id": 0})


@router.delete("/{server_id}")
async def delete_game_server(server_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.game_servers.delete_one({"id": server_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Server nicht gefunden.")
    return {"ok": True}
