"""Ankündigungen weitergeben (#631, Discord VI): Unterserver → Sammelkanal am Hauptserver, mit Discords eigenem „Folgen“.

Der Bot kopiert nichts. Discord kann das selbst: Wer einem **Ankündigungskanal** folgt, bekommt jede dort
veröffentlichte Nachricht in einen eigenen Kanal gespiegelt - mit Herkunft, ohne dass ein Bot mitliest. Hier wird
das nur eingerichtet und gezeigt:

- Der **Sammelkanal** liegt am Hauptserver (``settings.discord.forward.channel_id``).
- Je eingeschaltetem Unterserver wählt der Admin die **Quelle** - einen Kanal vom Typ „Ankündigung“ - und klickt
  „Einrichten“: Der Bot folgt dem Kanal (``TextChannel.follow``). Dafür braucht er im Sammelkanal „Webhooks verwalten“.
- Fehlt das Recht oder gibt es keinen Ankündigungskanal, steht da in Worten, was zu tun ist - samt dem Weg von Hand
  (Kanal → „Folgen“ → Sammelkanal), der ohne jedes Bot-Recht geht.

Der Stand kommt von Discord: die Folge-Webhooks im Sammelkanal. Folgt jemand von Hand, gilt das genauso als eingerichtet.
"""
from __future__ import annotations

from models import now_utc

MANUAL = ("Von Hand geht es immer: im Discord den Ankündigungskanal öffnen → oben „Folgen“ → als Ziel den Hauptserver und "
          "den Sammelkanal wählen. Dafür braucht die Person am Hauptserver „Webhooks verwalten“.")
STATE_TEXTS = {
    "followed": "Eingerichtet – was dort veröffentlicht wird, erscheint im Sammelkanal.",
    "ready": "Noch nicht eingerichtet.",
    "no_collector": "Erst oben den Sammelkanal am Hauptserver wählen.",
    "no_news_channel": ("Auf diesem Server gibt es keinen Ankündigungskanal. Servereinstellungen → „Community aktivieren“, dann "
                        "Kanal bearbeiten → Übersicht → „Ankündigungskanal“."),
    "no_webhook_right": ("Dem Bot fehlt im Sammelkanal das Recht „Webhooks verwalten“ – er kann weder nachsehen noch einrichten. "
                         "Kanal bearbeiten → Berechtigungen → Rolle des Bots → „Webhooks verwalten“. " + MANUAL),
    "offline": "Der Bot ist nicht verbunden – der Stand kommt, sobald er online ist.",
    "unknown": "Der Stand lässt sich gerade nicht lesen.",
}
FOLLOW_ERRORS = {
    "bot_offline": STATE_TEXTS["offline"],
    "forbidden": STATE_TEXTS["no_webhook_right"],
    "not_news": "Dieser Kanal ist kein Ankündigungskanal – folgen lässt sich nur einem Kanal vom Typ „Ankündigung“.",
    "unknown_channel": "Kanal nicht gefunden – gelöscht, oder der Bot sieht ihn nicht.",
}


class FollowError(ValueError):
    """Ein Wunsch, der so nicht geht - der Text sagt warum."""


async def collector_id(db) -> str:
    doc = await db.settings.find_one({"id": "discord"}, {"_id": 0, "forward": 1}) or {}
    return str((doc.get("forward") or {}).get("channel_id") or "")


async def set_collector(db, channel_id) -> str:
    """Den Sammelkanal am Hauptserver wählen (oder mit leerem Wert abwählen)."""
    from discord_service import channel_id_valid

    value = str(channel_id or "").strip()
    if value and not channel_id_valid(value):
        raise FollowError("Das ist keine Kanal-ID.")
    await db.settings.update_one({"id": "discord"}, {"$set": {"forward.channel_id": value, "forward.updated_at": now_utc().isoformat()},
                                                     "$setOnInsert": {"id": "discord"}}, upsert=True)
    return value


def _news(channels: list[dict]) -> list[dict]:
    return [{"id": row["id"], "name": row.get("name") or "", "category": row.get("category") or ""} for row in channels or [] if row.get("news")]


async def overview(db) -> dict:
    """Der Sammelkanal, je eingeschaltetem Unterserver seine Ankündigungskanäle, die gewählte Quelle und der Stand."""
    from services import discord_guilds
    from services.discord_bot import bot

    collector = await collector_id(db)
    online = bot.connected_guild_ids() is not None
    main_channels = (await bot.list_channels()).get("channels") or []
    chosen = next((row for row in main_channels if row.get("id") == collector), None)
    followed: dict[str, str] = {}
    lookup = "no_collector"
    if collector:
        seen = await bot.followed_sources(collector)
        if seen.get("ok"):
            followed, lookup = seen.get("sources") or {}, "ok"
        else:
            lookup = {"bot_offline": "offline", "forbidden": "no_webhook_right"}.get(str(seen.get("reason")), "unknown")
    servers = []
    for guild in await discord_guilds.list_guilds(db):
        if guild.get("role") == "main" or guild.get("left_at") or not guild.get("enabled"):
            continue
        guild_id = str(guild["guild_id"])
        news = _news((await bot.list_channels(guild_id)).get("channels") or [])
        stored = guild.get("forward") or {}
        source = str(stored.get("source_channel_id") or "")
        live = next((row["id"] for row in news if row["id"] in followed), "")
        if live:
            state, source = "followed", live
        elif lookup != "ok":
            state = lookup
        elif not news:
            state = "no_news_channel"
        else:
            state = "ready"
        servers.append({"guild_id": guild_id, "name": guild.get("name") or "Server", "news_channels": news,
                        "source_channel_id": source if any(row["id"] == source for row in news) else "",
                        "state": state, "text": STATE_TEXTS[state], "followed_at": stored.get("followed_at") if state == "followed" else None,
                        "can_setup": state == "ready"})
    return {"online": online, "collector": {"channel_id": collector, "name": (chosen or {}).get("name") or "",
                                            "can_webhooks": bool((chosen or {}).get("can_webhooks")) if chosen else None},
            "channels": [{"id": row["id"], "name": row.get("name") or "", "category": row.get("category") or "", "can_webhooks": bool(row.get("can_webhooks"))}
                         for row in main_channels],
            "servers": servers, "manual": MANUAL}


async def setup(db, guild_id: str, source_channel_id: str) -> dict:
    """Dem Ankündigungskanal dieses Unterservers folgen - in den Sammelkanal. Kein Erfolg ohne Grund in Worten."""
    from services.discord_bot import bot

    guild = await db.discord_guilds.find_one({"guild_id": str(guild_id)}, {"_id": 0})
    if not guild:
        raise LookupError(guild_id)
    if guild.get("role") == "main":
        raise FollowError("Der Hauptserver ist das Ziel – gefolgt wird den Ankündigungskanälen der Unterserver.")
    if guild.get("left_at") or not guild.get("enabled"):
        raise FollowError("Dieser Server ist ausgeschaltet oder der Bot ist nicht mehr dort.")
    collector = await collector_id(db)
    if not collector:
        raise FollowError(STATE_TEXTS["no_collector"])
    source = str(source_channel_id or "").strip()
    news = _news((await bot.list_channels(str(guild_id))).get("channels") or [])
    if not any(row["id"] == source for row in news):
        raise FollowError(FOLLOW_ERRORS["not_news"])
    result = await bot.follow_channel(source, collector)
    if not result.get("ok"):
        reason = str(result.get("reason") or "error")
        return {"ok": False, "reason": reason, "error": FOLLOW_ERRORS.get(reason) or result.get("error") or "Discord hat das Folgen abgelehnt."}
    stamp = now_utc().isoformat()
    await db.discord_guilds.update_one({"guild_id": str(guild_id)}, {"$set": {"forward": {"source_channel_id": source, "followed_at": stamp,
                                                                                    "webhook_id": result.get("webhook_id")}}})
    return {"ok": True, "source_channel_id": source, "followed_at": stamp}
