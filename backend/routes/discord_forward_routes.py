"""Weitergabe und Statistik im Admin (#631): Ankündigungen folgen, Mitteilung verteilen, Zahlen je Server."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from auth import require_club_admin
from database import get_db
from services import discord_distribute, discord_follow, discord_stats

router = APIRouter(prefix="/api/settings/discord", tags=["discord-forward"])


@router.get("/stats")
async def discord_server_stats(me: dict = Depends(require_club_admin())):
    """Je Server: Nachrichten, aktive verknüpfte Konten, Beitritte und Austritte über 7 und 30 Tage - nur Zahlen."""
    return await discord_stats.overview(get_db())


@router.get("/forward")
async def discord_forward_overview(me: dict = Depends(require_club_admin())):
    """Sammelkanal am Hauptserver und je Unterserver: Ankündigungskanäle, Quelle, Stand."""
    return await discord_follow.overview(get_db())


@router.put("/forward")
async def set_discord_forward(body: dict = Body(...), me: dict = Depends(require_club_admin())):
    from routes.settings_routes import _audit_settings_change

    db = get_db()
    try:
        await discord_follow.set_collector(db, (body or {}).get("channel_id"))
    except discord_follow.FollowError as exc:
        raise HTTPException(400, str(exc))
    await _audit_settings_change(db, "settings.discord.forward.update", "discord", me["id"], ["forward.channel_id"])
    return await discord_follow.overview(db)


@router.post("/forward/{guild_id}")
async def follow_discord_guild(guild_id: str, body: dict = Body(default={}), me: dict = Depends(require_club_admin())):
    """Dem Ankündigungskanal dieses Unterservers folgen - in den Sammelkanal. Ohne Erfolg kommt der Grund in Worten."""
    from routes.settings_routes import _audit_settings_change

    db = get_db()
    try:
        result = await discord_follow.setup(db, guild_id, (body or {}).get("source_channel_id"))
    except LookupError:
        raise HTTPException(404, "Diesen Server kennt die Website nicht.")
    except discord_follow.FollowError as exc:
        raise HTTPException(400, str(exc))
    if result.get("ok"):
        await _audit_settings_change(db, "settings.discord.forward.follow", "discord", me["id"], [f"guilds.{guild_id}.forward"])
    return result


@router.get("/distribute")
async def discord_distribute_options(me: dict = Depends(require_club_admin())):
    """Was das Formular „Mitteilung verteilen“ braucht: die Server, die Ziele, die Grenzen."""
    servers = await discord_distribute.servers(get_db())
    return {"servers": [{"guild_id": str(row["guild_id"]), "name": row.get("name") or "Server", "main": row.get("role") == "main"} for row in servers],
            "targets": [{"key": key, "label": label} for key, label in discord_distribute.TARGET_CHOICES],
            "max_text": discord_distribute.MAX_TEXT, "default_title": discord_distribute.DEFAULT_TITLE}


@router.post("/distribute")
async def distribute_discord_message(body: dict = Body(...), me: dict = Depends(require_club_admin())):
    """Eine Mitteilung an mehrere Server. Mit ``preview: true`` nur die Liste „geht an …“ - gesendet wird erst ohne."""
    db = get_db()
    body = body or {}
    wanted = dict(text=body.get("text"), target=str(body.get("target") or "community"), guild_ids=body.get("guild_ids") or None, title=body.get("title"))
    author = me.get("display_name") or me.get("username") or ""
    try:
        if body.get("preview"):
            return {"preview": True, **await discord_distribute.plan(db, **wanted), "footer": discord_distribute.footer_text(author)}
        return await discord_distribute.send(db, **wanted, author=author, actor_id=me["id"], via="admin")
    except discord_distribute.DistributeError as exc:
        raise HTTPException(400, str(exc))
