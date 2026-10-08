"""Rollen je Server (#629, Discord VI D6): die drei Vereinsrollen auf jedem Server, dazu Spiel-Rollen.

**Vereinsrollen** (Mitglied, Vorstand, Turnierleitung) gleicht der Bot auf dem Hauptserver und jedem eingeschalteten
Unterserver ab - überall, wo die verknüpfte Person ist. **Spiel-Rollen** wie „CoD-Spieler“ bekommt, wer ein Spielprofil
(Spieler-ID) für das Spiel hat oder in einem aktiven Team-Kader dieses Spiels steht: auf dem Server des Spiels und am
Hauptserver. Editionen zählen für ihr Hauptspiel - es gibt eine Rolle je Hauptspiel. Wer im Profil „Spiel-Rollen im
Discord“ ausschaltet, bekommt keine (und verliert sie beim nächsten Lauf).

Der Bot sucht Rollen über ihren Namen. Fehlt eine, steht sie als „fehlt“ beim Server - angelegt wird sie nur mit dem
Schalter „Fehlende Rollen anlegen“ am Server (Vorgabe aus); Spiel-Rollen nur, wenn jemand sie bekäme, und erwähnbar,
damit Meldungen sie später anpingen können. Der Bot fasst nur diese Rollen an - jede andere bleibt, wie sie ist.

Ein Lauf ändert höchstens ``SYNC_LIMIT`` Rollen über alle Server; der Rest kommt im nächsten Lauf. Der Stand je Server
steht am Server-Eintrag (``roles_sync``).
"""
from __future__ import annotations

from models import now_utc

ROLE_SUFFIX = "-Spieler"
GAME_FIELDS = {"_id": 0, "id": 1, "name": 1, "display_name": 1, "short_name": 1, "slug": 1, "parent_game_id": 1, "discord_guild_id": 1,
               "discord_role_name": 1}


def game_role_name(game: dict) -> str:
    """Der Rollenname eines Spiels: im Spielformular eingetragen, sonst „<Kurzname>-Spieler“."""
    own = str(game.get("discord_role_name") or "").strip()
    if own:
        return own[:100]
    return f"{game.get('short_name') or game.get('display_name') or game.get('name') or 'Spiel'}{ROLE_SUFFIX}"[:100]


def top_game(game_id: str, parents: dict[str, str | None]) -> str:
    """Das Hauptspiel einer Edition - ein Spiel ohne Hauptspiel ist es selbst."""
    return parents.get(game_id) or game_id


async def load_games(db) -> tuple[dict[str, dict], dict[str, str | None]]:
    games = await db.games.find({}, GAME_FIELDS).to_list(1000)
    return {game["id"]: game for game in games}, {game["id"]: game.get("parent_game_id") for game in games}


async def ping_role_name(db, item: dict | None) -> str | None:
    """Welche Spiel-Rolle eine Meldung anpingen würde (#629): die des Hauptspiels - ein MW3-Turnier ruft die
    „CoD-Spieler“. Ohne Spiel gibt es keine."""
    game_id = (item or {}).get("game_id")
    if not game_id:
        return None
    games, parents = await load_games(db)
    game = games.get(top_game(game_id, parents)) or games.get(game_id)
    return game_role_name(game) if game else None


async def game_holders(db, user_ids: list[str], games: dict[str, dict], parents: dict[str, str | None]) -> dict[str, set[str]]:
    """Spiel-Rollen je Person: Spielprofil mit mindestens einer ID oder aktiver Team-Kader des Spiels - ohne die, die
    „Spiel-Rollen im Discord“ ausgeschaltet haben. Ergebnis: Hauptspiel-IDs."""
    out: dict[str, set[str]] = {user_id: set() for user_id in user_ids}
    if not user_ids:
        return out
    by_slug = {game["slug"]: game["id"] for game in games.values() if game.get("slug")}
    users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "game_ids": 1, "discord_game_roles": 1}).to_list(len(user_ids) + 1)
    opted_out = {user["id"] for user in users if user.get("discord_game_roles") is False}
    for user in users:
        if user["id"] in opted_out:
            continue
        for slug, fields in (user.get("game_ids") or {}).items():
            if slug in by_slug and isinstance(fields, dict) and any(str(value or "").strip() for value in fields.values()):
                out[user["id"]].add(top_game(by_slug[slug], parents))
    squads = await db.team_squads.find({"status": {"$ne": "archived"}, "game_id": {"$nin": [None, ""]}, "member_ids": {"$in": user_ids}},
                                       {"_id": 0, "game_id": 1, "member_ids": 1}).to_list(5000)
    for squad in squads:
        if squad["game_id"] not in games:
            continue
        for user_id in squad.get("member_ids") or []:
            if user_id in out and user_id not in opted_out:
                out[user_id].add(top_game(squad["game_id"], parents))
    return out


async def targets(db, guild_ids: list[str], main_id: str = "") -> list[tuple[str, dict | None]]:
    """Wo abgeglichen wird: Hauptserver und jeder eingeschaltete Unterserver, auf dem der Bot ist. Ohne Verzeichnis
    (allererster Start) wie früher nur der Hauptserver - der eingetragene oder der erste."""
    from services.discord_guild_store import COLLECTION

    rows = {row["guild_id"]: row for row in await db[COLLECTION].find({}, {"_id": 0, "channel_list": 0}).to_list(500)}
    if not rows:
        pick = main_id if main_id in guild_ids else (guild_ids[0] if guild_ids else "")
        return [(pick, None)] if pick else []
    out = []
    for guild_id in guild_ids:
        row = rows.get(guild_id)
        if row and (row.get("role") == "main" or (row.get("enabled") and not row.get("left_at"))):
            out.append((guild_id, row))
    return sorted(out, key=lambda pair: (pair[1] or {}).get("role") != "main")


async def scope_games(db, row: dict | None, games: dict[str, dict], parents: dict[str, str | None]) -> set[str]:
    """Welche Spiel-Rollen auf diesem Server gelten: am Hauptserver alle Hauptspiele, auf einem Unterserver die Hauptspiele
    der Spiele, die dort zu Hause sind (eigene und geerbte)."""
    if row is None or row.get("role") == "main":
        return {game_id for game_id, game in games.items() if not game.get("parent_game_id")}
    from services.discord_guild_store import games_by_guild

    return {top_game(game["id"], parents) for game in (await games_by_guild(db)).get(str(row["guild_id"])) or []}


def role_names(club_names: dict[str, str], games: dict[str, dict], scope: set[str]) -> dict[tuple[str, str], str]:
    """Die verwalteten Rollen eines Servers: ``("club", key)`` für die drei Vereinsrollen, ``("game", id)`` je Spiel."""
    names = {("club", key): name for key, name in club_names.items()}
    names.update({("game", game_id): game_role_name(games[game_id]) for game_id in sorted(scope) if game_id in games})
    return names


def member_plan(current: set, wanted: set, available: set) -> tuple[set, set]:
    """Was der Bot bei einer Person ändert: hinzu, was sie bekommen soll und es auf dem Server gibt; weg, was sie hat und
    nicht (mehr) bekommen soll - nur innerhalb der verwalteten Rollen."""
    return (wanted - current) & available, current - wanted


async def record(db, guild_id: str, result: dict) -> None:
    from services.discord_guild_store import COLLECTION

    state = {"at": now_utc().isoformat(), "changes": int(result.get("changes") or 0), "errors": int(result.get("errors") or 0),
             "missing": list(result.get("missing") or []), "missing_games": list(result.get("missing_games") or []),
             "created": list(result.get("created") or []), "error": result.get("error") or None,
             "limited": bool(result.get("limited"))}
    await db[COLLECTION].update_one({"guild_id": str(guild_id)}, {"$set": {"roles_sync": state}})
