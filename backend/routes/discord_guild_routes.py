"""Server-Verzeichnis im Admin (#624): Liste, Haupt/Unter, Ein/Aus, Einladungslink, Notiz, Gesundheitsprüfung, Test."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from auth import require_club_admin
from database import get_db
from services import discord_guilds

router = APIRouter(prefix="/api/settings/discord/guilds", tags=["discord-guilds"])


@router.get("")
async def list_discord_guilds(me: dict = Depends(require_club_admin())):
    from services.discord_bot import bot, read_state

    db = get_db()
    state = await read_state(db)
    guilds = await discord_guilds.list_guilds(db)
    # Umgekehrte Sicht (#626): welche Spiele auf diesem Server zu Hause sind - eigene und geerbte.
    games = await discord_guilds.games_by_guild(db)
    for row in guilds:
        row["games"] = games.get(row["guild_id"], [])
    return {"guilds": guilds, "connected": bot.connected_guild_ids() is not None,
            "bot_invite_url": discord_guilds.bot_invite_url(state.get("application_id"))}


@router.patch("/{guild_id}")
async def update_discord_guild(guild_id: str, body: dict = Body(...), me: dict = Depends(require_club_admin())):
    from routes.settings_routes import _audit_settings_change

    db = get_db()
    try:
        row = await discord_guilds.update_guild(db, guild_id, body or {})
    except LookupError:
        raise HTTPException(404, "Diesen Server kennt die Website nicht.")
    except discord_guilds.GuildError as exc:
        raise HTTPException(400, str(exc))
    await _audit_settings_change(db, "settings.discord.guild.update", "discord", me["id"], [f"guilds.{guild_id}.{key}" for key in sorted(body or {})])
    return row


@router.get("/{guild_id}/channels")
async def discord_guild_channels(guild_id: str, me: dict = Depends(require_club_admin())):
    """Die Textkanäle dieses Servers für die Kanalwahl je Ziel (#625) - offline die zuletzt gesehene Liste."""
    from services.discord_bot import bot

    if not await get_db()[discord_guilds.COLLECTION].find_one({"guild_id": guild_id}, {"_id": 0, "guild_id": 1}):
        raise HTTPException(404, "Diesen Server kennt die Website nicht.")
    return await bot.list_channels(guild_id)


@router.post("/{guild_id}/invite")
async def create_discord_guild_invite(guild_id: str, me: dict = Depends(require_club_admin())):
    """Einladungslink vom Bot erzeugen lassen (unbegrenzt gültig) und am Server merken."""
    from discord_service import REASON_TEXTS
    from services.discord_bot import bot

    db = get_db()
    if not await db[discord_guilds.COLLECTION].find_one({"guild_id": guild_id}, {"_id": 0, "guild_id": 1}):
        raise HTTPException(404, "Diesen Server kennt die Website nicht.")
    result = await bot.create_invite(guild_id)
    if not result.get("ok"):
        reason = result.get("reason") or "error"
        texts = {"forbidden": "Der Bot darf auf diesem Server keine Einladung erstellen – Recht „Einladung erstellen“ geben.",
                 "unknown_guild": "Der Bot ist nicht auf diesem Server."}
        return {"ok": False, "reason": reason, "error": texts.get(reason) or REASON_TEXTS.get(reason) or result.get("error") or reason}
    await discord_guilds.update_guild(db, guild_id, {"invite_url": result["url"]})
    return {"ok": True, "url": result["url"]}


@router.post("/{guild_id}/health")
async def check_discord_guild(guild_id: str, me: dict = Depends(require_club_admin())):
    from services.discord_bot import bot

    try:
        return await discord_guilds.health(get_db(), guild_id, connected_ids=bot.connected_guild_ids())
    except LookupError:
        raise HTTPException(404, "Diesen Server kennt die Website nicht.")


@router.post("/{guild_id}/test")
async def test_discord_guild(guild_id: str, body: dict = Body(default={}), me: dict = Depends(require_club_admin())):
    """Testnachricht: am Hauptserver in den privaten Testkanal; am Unterserver in seinen Systemkanal - öffentlich, darum nur mit Bestätigung."""
    db = get_db()
    try:
        return await discord_guilds.send_test(db, guild_id, confirmed=bool((body or {}).get("confirm")))
    except LookupError:
        raise HTTPException(404, "Diesen Server kennt die Website nicht.")
    except discord_guilds.GuildError as exc:
        raise HTTPException(409, str(exc))
