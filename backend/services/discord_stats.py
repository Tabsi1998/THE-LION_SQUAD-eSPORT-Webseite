"""Statistik je Server (#631, Discord VI): Nachrichten, aktive verknüpfte Konten, Beitritte und Austritte - nur Zahlen.

Der Bot zählt auf jedem Server, auf dem er ist:

- ``discord_guild_stats`` - je Server und Vereinstag drei Zahlen: Nachrichten (von Menschen), Beitritte, Austritte.
  Keine Person, kein Inhalt.
- ``discord_guild_active`` - je Server und Tag, **welche verknüpften Konten** geschrieben haben: Für „aktive Konten“
  über 7 und 30 Tage muss man wissen, wer schon gezählt ist. Nur Konten, die ihr Discord selbst mit der Website
  verknüpft haben; nach ``KEEP_DAYS`` Tagen gelöscht (täglicher Lauf); steht in Auskunft und Löschung.

Nachrichten zählen nur, wenn „Nachrichten zählen“ an ist - derselbe Schalter wie für die Erfolge. Die Erfolge selbst
zählen weiter über alle Server zusammen (``users.discord_messages_count``): ein Zähler je Person, egal wo sie schreibt.
"""
from __future__ import annotations

from datetime import timedelta

from pymongo.errors import DuplicateKeyError

from models import now_utc

STATS = "discord_guild_stats"
ACTIVE = "discord_guild_active"
KEEP_DAYS = 35
WINDOWS = (7, 30)
SERIES_DAYS = 30


def day_of(moment=None) -> str:
    """Der Vereinstag (Wien) - derselbe wie beim Zählen für die Erfolge."""
    from services.discord_bot import club_day

    return club_day(moment)


async def _upsert(collection, key: dict, update: dict) -> None:
    """Zwei Nachrichten im selben Augenblick legen dieselbe Zeile an - die zweite versucht es einfach noch einmal."""
    try:
        await collection.update_one(key, update, upsert=True)
    except DuplicateKeyError:
        await collection.update_one(key, update, upsert=True)


async def note_message(db, guild_id, user_id: str | None = None, *, moment=None) -> None:
    """Eine Nachricht eines Menschen auf diesem Server: die Tageszahl steigt; ein verknüpftes Konto gilt heute als aktiv."""
    day = day_of(moment)
    await _upsert(db[STATS], {"guild_id": str(guild_id), "day": day}, {"$inc": {"messages": 1}})
    if user_id:
        await _upsert(db[ACTIVE], {"guild_id": str(guild_id), "day": day, "user_id": user_id}, {"$setOnInsert": {"created_at": now_utc().isoformat()}})


async def note_member(db, guild_id, joined: bool, *, moment=None) -> None:
    """Beitritt oder Austritt - nur die Zahl des Tages, nie wer."""
    await _upsert(db[STATS], {"guild_id": str(guild_id), "day": day_of(moment)}, {"$inc": {"joins" if joined else "leaves": 1}})


async def purge_old(db, *, now=None) -> int:
    """Wer wann aktiv war, wird nur für die 30-Tage-Zahl gebraucht - Älteres verschwindet."""
    cutoff = day_of((now or now_utc()) - timedelta(days=KEEP_DAYS))
    result = await db[ACTIVE].delete_many({"day": {"$lt": cutoff}})
    return int(getattr(result, "deleted_count", 0) or 0)


async def _active_counts(db, since: str) -> tuple[dict[str, int], int]:
    """Verschiedene verknüpfte Konten seit ``since``: je Server und über alle Server zusammen (jedes Konto einmal)."""
    per_guild: dict[str, int] = {}
    pipeline = [{"$match": {"day": {"$gte": since}}}, {"$group": {"_id": {"guild": "$guild_id", "user": "$user_id"}}},
                {"$group": {"_id": "$_id.guild", "count": {"$sum": 1}}}]
    async for row in db[ACTIVE].aggregate(pipeline):
        per_guild[str(row["_id"])] = int(row["count"])
    everyone = [{"$match": {"day": {"$gte": since}}}, {"$group": {"_id": "$user_id"}}, {"$count": "count"}]
    total = 0
    async for row in db[ACTIVE].aggregate(everyone):
        total = int(row["count"])
    return per_guild, total


def _empty() -> dict:
    return {str(days): 0 for days in WINDOWS}


async def overview(db, *, now=None) -> dict:
    """Je Server (sortiert wie das Verzeichnis): Nachrichten, aktive verknüpfte Konten, Beitritte und Austritte über 7
    und 30 Tage, dazu die Nachrichten der letzten 30 Tage als Reihe (ältester Tag zuerst). Verlassene Server fehlen."""
    from services import discord_guilds
    from services.discord_bot import bot_settings

    current = now or now_utc()
    days = [day_of(current - timedelta(days=offset)) for offset in range(SERIES_DAYS - 1, -1, -1)]   # ältester zuerst
    since = {window: days[-window] for window in WINDOWS}
    rows = await db[STATS].find({"day": {"$gte": days[0]}}, {"_id": 0}).to_list(20000)
    by_guild: dict[str, dict[str, dict]] = {}
    for row in rows:
        by_guild.setdefault(str(row.get("guild_id")), {})[str(row.get("day"))] = row
    active = {window: await _active_counts(db, since[window]) for window in WINDOWS}

    servers = []
    total = {"messages": _empty(), "joins": _empty(), "leaves": _empty(), "active": {str(window): active[window][1] for window in WINDOWS}}
    for guild in await discord_guilds.list_guilds(db):
        if guild.get("left_at"):
            continue
        guild_id = str(guild["guild_id"])
        own = by_guild.get(guild_id, {})
        entry = {"guild_id": guild_id, "name": guild.get("name") or "Server", "role": guild.get("role"), "enabled": bool(guild.get("enabled")),
                 "member_count": guild.get("member_count"), "messages": _empty(), "joins": _empty(), "leaves": _empty(),
                 "active": {str(window): active[window][0].get(guild_id, 0) for window in WINDOWS},
                 "series": [int((own.get(day) or {}).get("messages") or 0) for day in days]}
        for window in WINDOWS:
            for day in days[-window:]:
                for key in ("messages", "joins", "leaves"):
                    value = int((own.get(day) or {}).get(key) or 0)
                    entry[key][str(window)] += value
                    total[key][str(window)] += value
        servers.append(entry)
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    first = await db[STATS].find_one({}, {"_id": 0, "day": 1}, sort=[("day", 1)])
    return {"servers": servers, "total": total, "counting": bool(bot_settings(settings).get("count_messages")),
            "days": days, "since": (first or {}).get("day"), "keep_days": KEEP_DAYS}
