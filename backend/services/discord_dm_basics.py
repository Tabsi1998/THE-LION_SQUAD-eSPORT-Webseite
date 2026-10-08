"""Was Direktnachrichten vom Bot (#567), das Server-Verzeichnis und die Begrüßung gemeinsam brauchen: die
Discord-Kennung eines verknüpften Kontos und das Ziel „dm“ im Versandprotokoll.

Ein Blatt ohne Importe aus ``services`` - ``discord_dm``, ``discord_guilds`` und ``discord_welcome`` nutzen es, ohne
dafür ``discord_dm`` zu importieren, das selbst den Bot braucht (sonst entstünde ein Import-Zyklus, #1408).
"""
from __future__ import annotations

DM_TARGET = "dm"


async def discord_link_id(db, user_id: str) -> str:
    """Die Discord-Kennung des verknüpften Kontos - oder leer."""
    link = await db.platform_links.find_one({"user_id": user_id, "platform": "discord"}, {"_id": 0, "external_id": 1})
    return str((link or {}).get("external_id") or "")
