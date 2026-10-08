"""Die gespeicherten Discord-Server (#624) und welcher Server zu einem Spiel gehört (#626) - nur Datenbank.

Ein Blatt ohne Importe aus ``services``: Das Server-Verzeichnis (``discord_guilds``) und die Discord-Module, die nur
Sammlung und Spiel → Server brauchen (Befehle, Einbettungen, Rollen, Routing, Termine, Bot), nutzen es, ohne dafür
das Verzeichnis zu importieren - das selbst den Bot braucht (sonst entstünde ein Import-Zyklus, #1408).
"""
from __future__ import annotations

COLLECTION = "discord_guilds"
GAME_FIELDS = {"_id": 0, "id": 1, "name": 1, "display_name": 1, "short_name": 1, "slug": 1, "discord_guild_id": 1, "parent_game_id": 1, "kind": 1}


def _usable(row: dict | None) -> bool:
    return bool(row) and bool(row.get("enabled")) and not row.get("left_at")


async def guild_for_game(db, game: dict | None) -> dict | None:
    """Der Server eines Spiels (#626): eigenes Feld → Hauptspiel → Hauptserver. Ausgeschaltete oder verlassene Server
    zählen nicht - dann gilt die nächste Stufe. ``inherited_from``: None (eigenes Feld), die ID des Hauptspiels oder „main“."""
    visited: set = set()
    current = game
    while current and current.get("id") not in visited:
        visited.add(current.get("id"))
        guild_id = str(current.get("discord_guild_id") or "")
        if guild_id:
            row = await db[COLLECTION].find_one({"guild_id": guild_id}, {"_id": 0, "channel_list": 0})
            if _usable(row):
                return {**row, "inherited_from": None if current is game else current.get("id")}
        parent_id = current.get("parent_game_id")
        current = await db.games.find_one({"id": parent_id}, GAME_FIELDS) if parent_id else None
    main = await db[COLLECTION].find_one({"role": "main"}, {"_id": 0, "channel_list": 0})
    return {**main, "inherited_from": "main"} if main else None


async def games_by_guild(db) -> dict[str, list[dict]]:
    """Die umgekehrte Sicht für den Reiter „Server“: je Server die Spiele - eigene und geerbte (Editionen)."""
    games = await db.games.find({}, GAME_FIELDS).to_list(500)
    by_id = {game["id"]: game for game in games}
    out: dict[str, list[dict]] = {}
    for game in games:
        own = str(game.get("discord_guild_id") or "")
        inherited = False
        if not own and game.get("parent_game_id"):
            own = str((by_id.get(game["parent_game_id"]) or {}).get("discord_guild_id") or "")
            inherited = bool(own)
        if own:
            out.setdefault(own, []).append({"id": game["id"], "name": game.get("display_name") or game.get("name"), "slug": game.get("slug"), "inherited": inherited})
    for rows in out.values():
        rows.sort(key=lambda row: (row["inherited"], str(row["name"] or "").lower()))
    return out
