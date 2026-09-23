"""Discord-Bot im Admin (#302): Stand, Rollenabgleich jetzt, Neustart. Der Token selbst wird über
``PUT /api/settings/discord`` gepflegt und verlässt den Server nie."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from auth import require_area
from database import get_db
from services import discord_bot

router = APIRouter(prefix="/api/settings/discord/bot", tags=["discord-bot"])


@router.get("/status")
async def bot_status(me: dict = Depends(require_area("club", "system"))):
    db = get_db()
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    links = await discord_bot.linked_discord_ids(db)
    return {**discord_bot.bot_settings(settings), **await discord_bot.read_state(db), **discord_bot.bot.status(), "linked_count": len(links)}


@router.post("/sync")
async def bot_sync_roles(me: dict = Depends(require_area("club", "system"))):
    """Rollen jetzt abgleichen statt in zehn Minuten."""
    return await discord_bot.bot.sync_roles()


@router.post("/restart")
async def bot_restart(me: dict = Depends(require_area("system"))):
    running = await discord_bot.bot.apply_settings()
    return {"ok": True, "running": running}
