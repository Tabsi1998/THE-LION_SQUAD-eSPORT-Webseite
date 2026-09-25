"""Discord als persönlicher Benachrichtigungskanal (#567).

Wer sein Discord-Konto verknüpft hat und den Kanal „Discord“ in den Benachrichtigungen einschaltet,
bekommt dieselben Benachrichtigungen wie In-App und Push als Direktnachricht vom Vereins-Bot -
Standard aus (Opt-in). Direktnachrichten erreichen nur Personen, die mit dem Bot einen Server
teilen und Direktnachrichten von Servermitgliedern erlauben; lehnt Discord eine ab (Forbidden),
bleibt es bei Push und In-App, die Website merkt sich den Fehlschlag je Person (Hinweis in den
Einstellungen mit Klickweg) und hält ihn im Versand-Log fest.

Nie in einer Direktnachricht: Nachrichtentexte anderer Personen (nur „du hast eine Nachricht“),
Moderation, Zahlungsdaten - was nicht per Push geht, geht auch nicht per Discord.
"""
from __future__ import annotations

import logging

from database import get_db
from models import new_id, now_utc

logger = logging.getLogger("tls-arena.discord.dm")
DM_TARGET = "dm"
# Moderation bleibt in App und Web - nie als Direktnachricht in einem fremden Dienst.
EXCLUDED_KINDS = {"moderation"}
# Nachrichten anderer Personen: nur der Hinweis, nie der Text.
PRIVATE_BODY_CATEGORIES = {"community_messages"}
PRIVATE_BODY_TEXT = "Öffne die Website oder die App, um sie zu lesen."
COLORS = {"achievement": 0xFFD700, "prize_pending": 0xFFD700, "f1_prize": 0xFFD700, "f1_prize_reminder": 0xFFD700}


def dm_content(notification: dict, category: str | None) -> dict:
    """Titel, Text und Link der Direktnachricht - ohne fremde Nachrichtentexte."""
    kind = str(notification.get("kind") or "")
    body = str(notification.get("body") or "")
    if category in PRIVATE_BODY_CATEGORIES:
        body = PRIVATE_BODY_TEXT
    return {"title": str(notification.get("title") or "LION")[:256], "description": body[:1000],
            "url": str(notification.get("url") or ""), "color": COLORS.get(kind, 0x29B6E8)}


async def discord_link_id(db, user_id: str) -> str:
    """Die Discord-Kennung des verknüpften Kontos - oder leer."""
    link = await db.platform_links.find_one({"user_id": user_id, "platform": "discord"}, {"_id": 0, "external_id": 1})
    return str((link or {}).get("external_id") or "")


async def dm_state(db, user: dict) -> dict:
    """Für die Einstellungen: verknüpft? Und steht nach einer abgelehnten Direktnachricht der Klickweg an?"""
    from discord_service import REASON_TEXTS

    blocked_at = user.get("discord_dm_blocked_at")
    return {"linked": bool(await discord_link_id(db, user["id"])), "blocked_at": blocked_at,
            "hint": REASON_TEXTS["dm_forbidden"] if blocked_at else None}


async def send_discord_dm_for_notification(notification: dict, category: str | None = None) -> int:
    """Eine Benachrichtigung als Direktnachricht: 1, wenn zugestellt, sonst 0 - mit Log und Merker."""
    from discord_service import REASON_TEXTS, build_embed
    from services.discord_bot import bot, bot_settings

    user_id = notification.get("user_id")
    kind = str(notification.get("kind") or "")
    if not user_id or kind in EXCLUDED_KINDS:
        return 0
    db = get_db()
    discord_id = await discord_link_id(db, user_id)
    if not discord_id:
        return 0
    content = dm_content(notification, category)
    log = {"id": new_id(), "channel": "discord", "target": DM_TARGET, "user_id": user_id, "event_key": f"notify.{kind}",
           "title": content["title"], "status": "skipped", "error": None, "reason": None,
           "notification_id": notification.get("id"), "created_at": now_utc().isoformat()}
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0, "bot_enabled": 1, "bot_token": 1}) or {}
    if not bot_settings(settings)["enabled"]:
        log["reason"], log["error"] = "bot_off", REASON_TEXTS["bot_off"]
        await db.email_logs.insert_one(log)
        return 0
    embed = await build_embed(content["title"], content["description"], color=content["color"], url=content["url"] or None)
    try:
        result = await bot.send_dm(discord_id, embed)
    except Exception as exc:  # noqa: BLE001 - ein Discord-Fehler darf die Benachrichtigung nicht aufhalten
        logger.warning("[discord-dm] %s", type(exc).__name__)
        result = {"ok": False, "reason": "error", "error": type(exc).__name__}
    if result.get("ok"):
        log["status"], log["message_id"] = "sent", result.get("message_id")
        await db.users.update_one({"id": user_id, "discord_dm_blocked_at": {"$exists": True}}, {"$unset": {"discord_dm_blocked_at": ""}})
    else:
        reason = result.get("reason") or "error"
        log["status"] = "skipped" if reason == "bot_offline" else "failed"
        log["reason"] = "dm_forbidden" if reason == "forbidden" else reason
        log["error"] = result.get("error") or REASON_TEXTS.get(log["reason"]) or reason
        if reason == "forbidden":
            await db.users.update_one({"id": user_id}, {"$set": {"discord_dm_blocked_at": now_utc().isoformat()}})
    await db.email_logs.insert_one(log)
    return 1 if result.get("ok") else 0
