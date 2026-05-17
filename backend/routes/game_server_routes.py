"""Community game server directory and admin maintenance."""
import os
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_optional_user, require_admin
from database import get_db
from models import new_id, now_utc
from services.slug_utils import slug_source_for_update, slugify, unique_slug


ServerVisibility = Literal["public", "community", "members", "internal"]
ServerStatus = Literal["online", "offline", "maintenance", "planned"]
ServerSyncProvider = Literal["manual", "auto_public", "minecraft", "steam_a2s", "rcon"]
ServerSecretKind = Literal["none", "password", "invite_code", "whitelist", "discord"]

router = APIRouter(prefix="/api/game-servers", tags=["game-servers"])


DEMO_GAME_SERVERS = [
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

DEMO_GAME_SERVER_SLUGS = {item["slug"] for item in DEMO_GAME_SERVERS}


def _slugify(value: str) -> str:
    return slugify(value, fallback=f"server-{new_id()[:8]}", max_length=80)


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


async def _game_lookup(db, game_ids: list[str]) -> dict[str, dict]:
    if not game_ids:
        return {}
    games = await db.games.find(
        {"id": {"$in": game_ids}},
        {"_id": 0, "id": 1, "slug": 1, "name": 1, "short_name": 1, "logo_url": 1},
    ).to_list(500)
    return {game["id"]: game for game in games}


def _public_doc(server: dict, game: dict | None = None, include_admin_fields: bool = False) -> dict:
    hidden = {
        "_id", "access_secret",
        "amp_password", "amp_session_id", "amp_url", "amp_username", "amp_instance_name", "amp_module",
    }
    if not include_admin_fields:
        hidden.update({"query_host", "query_port", "rcon_port", "last_sync_error"})
    doc = {k: v for k, v in server.items() if k not in hidden}
    if server.get("access_secret"):
        doc["has_access_secret"] = True
        doc["access_secret_masked"] = "••••••"
    if game:
        doc["game"] = game
    return doc


def _maintenance_active(server: dict) -> bool:
    if server.get("status") != "maintenance":
        return False
    until = server.get("maintenance_until")
    if not until:
        return True
    try:
        dt = datetime.fromisoformat(str(until).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt > datetime.now(timezone.utc)
    except ValueError:
        return True


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
    access_secret_kind: ServerSecretKind = "none"
    access_secret: Optional[str] = Field(default=None, max_length=300)
    access_label: Optional[str] = Field(default=None, max_length=80)
    server_icon_url: Optional[str] = Field(default=None, max_length=300)
    map_url: Optional[str] = Field(default=None, max_length=300)
    external_status_url: Optional[str] = Field(default=None, max_length=300)
    password_hint: Optional[str] = Field(default=None, max_length=180)
    rules_url: Optional[str] = Field(default=None, max_length=300)
    map_name: Optional[str] = Field(default=None, max_length=120)
    version: Optional[str] = Field(default=None, max_length=80)
    maintenance_note: Optional[str] = Field(default=None, max_length=300)
    maintenance_until: Optional[str] = None
    site_banner_enabled: bool = False
    player_count: int = Field(default=0, ge=0)
    max_players: Optional[int] = Field(default=None, ge=0)
    player_names: list[str] = Field(default_factory=list)
    sync_provider: ServerSyncProvider = "manual"
    query_host: Optional[str] = Field(default=None, max_length=180)
    query_port: Optional[int] = Field(default=None, ge=1, le=65535)
    rcon_port: Optional[int] = Field(default=None, ge=1, le=65535)
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
    access_secret_kind: Optional[ServerSecretKind] = None
    access_secret: Optional[str] = Field(default=None, max_length=300)
    access_label: Optional[str] = Field(default=None, max_length=80)
    server_icon_url: Optional[str] = Field(default=None, max_length=300)
    map_url: Optional[str] = Field(default=None, max_length=300)
    external_status_url: Optional[str] = Field(default=None, max_length=300)
    password_hint: Optional[str] = Field(default=None, max_length=180)
    rules_url: Optional[str] = Field(default=None, max_length=300)
    map_name: Optional[str] = Field(default=None, max_length=120)
    version: Optional[str] = Field(default=None, max_length=80)
    maintenance_note: Optional[str] = Field(default=None, max_length=300)
    maintenance_until: Optional[str] = None
    site_banner_enabled: Optional[bool] = None
    player_count: Optional[int] = Field(default=None, ge=0)
    max_players: Optional[int] = Field(default=None, ge=0)
    player_names: Optional[list[str]] = None
    sync_provider: Optional[ServerSyncProvider] = None
    query_host: Optional[str] = Field(default=None, max_length=180)
    query_port: Optional[int] = Field(default=None, ge=1, le=65535)
    rcon_port: Optional[int] = Field(default=None, ge=1, le=65535)
    last_sync_error: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


async def seed_demo_game_servers():
    seed_values = {"1", "true", "yes", "on"}
    if (
        os.environ.get("SEED_GAME_SERVERS", "").lower() not in seed_values
        and os.environ.get("SEED_DEMO", "").lower() not in seed_values
    ):
        return
    db = get_db()
    for index, item in enumerate(DEMO_GAME_SERVERS):
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
                "sync_provider": "auto_public",
                "seeded_default": True,
                "sort_order": index * 10,
                **item,
            }},
            upsert=True,
        )
        await db.game_servers.update_many(
            {"slug": item["slug"], "created_by": {"$exists": False}, "sync_provider": {"$in": [None, "", "manual"]}},
            {"$set": {"sync_provider": "auto_public"}},
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
    return [_public_doc(row, game_by_id.get(row.get("game_id")), include_admin_fields=True) for row in rows]


@router.get("/{server_id}/access")
async def get_game_server_access(server_id: str, me: dict | None = Depends(get_optional_user)):
    db = get_db()
    server = await db.game_servers.find_one({"id": server_id}, {"_id": 0})
    if not server:
        raise HTTPException(404, "Server nicht gefunden.")
    if not _can_view(server, me):
        raise HTTPException(403, "Kein Zugriff auf diesen Server.")
    if not server.get("access_secret") or (server.get("access_secret_kind") or "none") == "none":
        raise HTTPException(404, "Kein Zugang hinterlegt.")
    return {
        "kind": server.get("access_secret_kind") or "password",
        "label": server.get("access_label"),
        "access_secret": server.get("access_secret"),
    }


@router.get("/{server_id}/diagnostics")
async def diagnose_game_server_route(server_id: str, me: dict = Depends(require_admin())):
    from services.game_server_status import diagnose_game_server
    db = get_db()
    server = await db.game_servers.find_one({"id": server_id}, {"_id": 0})
    if not server:
        raise HTTPException(404, "Server nicht gefunden.")
    return await diagnose_game_server(server)


@router.post("")
async def create_game_server(body: GameServerPayload, me: dict = Depends(require_admin())):
    db = get_db()
    data = body.model_dump()
    data["slug"] = await unique_slug(db.game_servers, data.get("slug") or data["name"], fallback="server", max_length=80)
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
        "access_secret", "access_label", "server_icon_url", "map_url", "external_status_url",
        "rules_url", "map_name", "version", "maintenance_note", "maintenance_until",
        "max_players", "query_host", "query_port", "rcon_port", "last_sync_error",
    }
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    slug_source = slug_source_for_update(raw, existing, "name", fallback="server")
    if slug_source is not None:
        updates["slug"] = await unique_slug(db.game_servers, slug_source, current_id=server_id, fallback="server", max_length=80)
    if not updates:
        raise HTTPException(400, "Keine Änderungen.")
    updates["updated_at"] = now_utc().isoformat()
    await db.game_servers.update_one({"id": server_id}, {"$set": updates})
    return await db.game_servers.find_one({"id": server_id}, {"_id": 0})


async def _sync_one(db, server: dict) -> dict:
    from services.game_server_status import GameServerProbeError, probe_game_server, summarize_probe_failure
    try:
        result = await probe_game_server(server)
        updates = {
            "last_sync_at": now_utc().isoformat(),
            "last_sync_error": None,
            "last_sync_note": result.get("sync_note"),
            "updated_at": now_utc().isoformat(),
        }
        locked_status = "maintenance" if _maintenance_active(server) else "planned" if server.get("status") == "planned" else None
        if locked_status:
            updates["status"] = locked_status
        for key in ("status", "player_count", "max_players", "player_names", "map_name", "version", "game_name", "detected_sync_provider"):
            if key in result and result[key] is not None:
                if key == "status" and locked_status:
                    continue
                updates[key] = result[key]
        await db.game_servers.update_one({"id": server["id"]}, {"$set": updates})
        synced = await db.game_servers.find_one({"id": server["id"]}, {"_id": 0})
        return {"ok": True, "server": _public_doc(synced, include_admin_fields=True)}
    except GameServerProbeError as exc:
        error = str(exc)
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    updates = {
        "last_sync_at": now_utc().isoformat(),
        "last_sync_error": None,
        "last_sync_note": f"Sync konnte den Server vom Webserver aus nicht erreichen. Letzter Status bleibt erhalten. {summarize_probe_failure(error)}",
        "updated_at": now_utc().isoformat(),
    }
    if not server.get("last_sync_at") and not _maintenance_active(server) and server.get("status") != "planned":
        updates["status"] = "offline"
        updates["player_count"] = 0
        updates["player_names"] = []
    await db.game_servers.update_one(
        {"id": server["id"]},
        {"$set": updates},
    )
    synced = await db.game_servers.find_one({"id": server["id"]}, {"_id": 0})
    return {"ok": False, "error": error, "server": _public_doc(synced, include_admin_fields=True)}


@router.post("/sync")
async def sync_all_game_servers(me: dict = Depends(require_admin())):
    return await sync_configured_game_servers()


async def sync_configured_game_servers() -> dict:
    db = get_db()
    servers = await db.game_servers.find(
        {"is_active": {"$ne": False}, "sync_provider": {"$nin": [None, "", "manual"]}},
        {"_id": 0},
    ).to_list(100)
    results = [await _sync_one(db, server) for server in servers]
    return {
        "ok": all(item.get("ok") for item in results),
        "processed": len(results),
        "failed": sum(1 for item in results if not item.get("ok")),
        "results": results,
    }


@router.post("/{server_id}/sync")
async def sync_game_server(server_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    server = await db.game_servers.find_one({"id": server_id}, {"_id": 0})
    if not server:
        raise HTTPException(404, "Server nicht gefunden.")
    return await _sync_one(db, server)


@router.post("/{server_id}/touch")
async def touch_game_server(server_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.game_servers.update_one(
        {"id": server_id},
        {"$set": {"last_sync_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(), "last_sync_error": None, "last_sync_note": None}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Server nicht gefunden.")
    return await db.game_servers.find_one({"id": server_id}, {"_id": 0})


@router.delete("/seeded-defaults")
async def delete_seeded_default_game_servers(me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.game_servers.delete_many({
        "slug": {"$in": sorted(DEMO_GAME_SERVER_SLUGS)},
        "created_by": {"$exists": False},
    })
    return {"ok": True, "deleted": res.deleted_count}


@router.delete("/{server_id}")
async def delete_game_server(server_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.game_servers.delete_one({"id": server_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Server nicht gefunden.")
    return {"ok": True}
