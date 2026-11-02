"""Wo ein Spiel verwendet wird und ob es archiviert ist (#2129, SP1 und SP2).

**Archiviert** (``games.status == "archived"``): Das Spiel steht beim Anlegen nicht mehr zur Wahl, alles Bestehende zeigt
und nutzt es weiter - Turniere, Liga, Profile, Co-Teams, Maps und ``GET /api/games``. Fehlt ``status``, ist es aktiv. Nur
das *neue Wählen* lehnt der Server ab (``chosen_is_archived``); ein unveränderter Wert bleibt gültig, damit kein anderes
Speichern daran hängen bleibt.

**Verwendung** (``usage``): Zählung je Art, mit der das Löschen abgelehnt wird (409) und die der Dialog vorab zeigt.
``modes`` zählt je Modus, was das Entfernen eines Modus berührt: Maps verlieren ihn (der Server bereinigt ``modes``),
gespeicherte Pools und Seasons behalten ihn - sie zeigen auf ihren Snapshot.
"""
from __future__ import annotations

from services.game_maps import DEFAULT_POOL_SCOPE, game_modes

ARCHIVED = "archived"
ARCHIVED_DETAIL = "Dieses Spiel ist archiviert und steht nicht mehr zur Wahl – bitte ein anderes wählen oder es zurückholen."
# Reihenfolge der Anzeige: Schlüssel, Einzahl, Mehrzahl.
USAGE_LABELS = (
    ("tournaments", "Turnier", "Turniere"),
    ("leagues", "Liga", "Ligen"),
    ("maps", "Map", "Maps"),
    ("pools", "Map-Pool", "Map-Pools"),
    ("editions", "Spielversion", "Spielversionen"),
    ("identity_sources", "Spiel mit dieser ID-Quelle", "Spiele mit dieser ID-Quelle"),
    ("teams", "Co-Team", "Co-Teams"),
    ("series", "Serie", "Serien"),
    ("references", "Referenz", "Referenzen"),
    ("name_links", "Namens-Zuordnung einer Serie", "Namens-Zuordnungen von Serien"),
    ("challenges", "Fast-Lap-Challenge", "Fast-Lap-Challenges"),
    ("servers", "Game-Server", "Game-Server"),
    ("stations", "Station", "Stationen"),
    ("profiles", "Profil mit Spieler-ID", "Profile mit Spieler-ID"),
)


def is_archived(game: dict | None) -> bool:
    return (game or {}).get("status") == ARCHIVED


async def chosen_is_archived(db, game_id: str | None, current: str | None = None) -> bool:
    """Wird hier gerade ein archiviertes Spiel neu gewählt? Ein unveränderter Wert zählt nie."""
    if not game_id or game_id == current:
        return False
    return is_archived(await db.games.find_one({"id": game_id}, {"_id": 0, "status": 1}))


def _latest_pools(rows: list[dict]) -> list[dict]:
    """Je Wettbewerb die neueste Version - nur wenn sie gilt (nicht „entfernt“)."""
    newest: dict[tuple, dict] = {}
    for row in rows:
        key = (row.get("scope"), row.get("scope_id"))
        if key not in newest or (row.get("version") or 0) > (newest[key].get("version") or 0):
            newest[key] = row
    return [row for row in newest.values() if not row.get("cleared")]


async def usage(db, game: dict) -> dict:
    """``{counts, total, text, modes}`` - siehe Modulkopf. Der eigene Standard-Pool zählt nicht: er gehört zum Spiel und
    geht mit ihm."""
    game_id = game["id"]
    pool_rows = await db.map_pools.find({"game_id": game_id, "scope": {"$ne": DEFAULT_POOL_SCOPE}},
                                        {"_id": 0, "scope": 1, "scope_id": 1, "version": 1, "cleared": 1, "modes.mode": 1}
                                        ).to_list(None)
    pools = _latest_pools(pool_rows)
    leagues = await db.leagues.find({"game_id": game_id}, {"_id": 0, "id": 1}).to_list(None)
    counts = {
        "tournaments": await db.tournaments.count_documents({"game_id": game_id}),
        "leagues": len(leagues),
        "maps": await db.game_maps.count_documents({"game_id": game_id}),
        "pools": len(pools),
        "editions": await db.games.count_documents({"parent_game_id": game_id}),
        "identity_sources": await db.games.count_documents({"identity_source_game_id": game_id}),
        "teams": await db.team_squads.count_documents({"game_id": game_id}),
        "series": await db.reference_lineages.count_documents({"game_id": game_id}),
        "references": await db.references.count_documents({"game_id": game_id}),
        "name_links": await db.reference_aliases.count_documents({"game_id": game_id}),
        "challenges": await db.f1_challenges.count_documents({"game_id": game_id}),
        "servers": await db.game_servers.count_documents({"game_id": game_id}),
        "stations": await db.stations.count_documents({"game_id": game_id}),
        "profiles": (await db.users.count_documents({f"game_ids.{game['slug']}": {"$exists": True}})
                     if game.get("slug") else 0),
    }
    seasons = await db.league_seasons.find({"league_id": {"$in": [row["id"] for row in leagues]}},
                                           {"_id": 0, "game_mode_order": 1}).to_list(None)
    maps = await db.game_maps.find({"game_id": game_id}, {"_id": 0, "modes": 1}).to_list(None)
    # Turniere und Phasen mit diesem Modus: Fällt er weg, planen sie mit dem ersten Modus des Spiels (``match_duration``).
    tournaments = await db.tournaments.find({"game_id": game_id}, {"_id": 0, "id": 1, "game_mode": 1}).to_list(None)
    stages = await db.tournament_stages.find({"tournament_id": {"$in": [row["id"] for row in tournaments]}},
                                             {"_id": 0, "settings.game_mode": 1}).to_list(None)
    modes = {
        mode["mode"]: {
            "label": mode["label"],
            "maps": sum(1 for row in maps if mode["mode"] in (row.get("modes") or [])),
            "pools": sum(1 for pool in pools if any(group.get("mode") == mode["mode"] for group in pool.get("modes") or [])),
            "seasons": sum(1 for season in seasons if mode["mode"] in (season.get("game_mode_order") or [])),
            "tournaments": sum(1 for row in tournaments if row.get("game_mode") == mode["mode"]),
            "stages": sum(1 for stage in stages if (stage.get("settings") or {}).get("game_mode") == mode["mode"]),
        }
        for mode in game_modes(game)
    }
    return {"counts": counts, "total": sum(counts.values()), "text": usage_text(counts), "modes": modes}


def usage_text(counts: dict) -> str:
    """„3 Turniere, 1 Liga, 12 Maps“ - nur was es gibt."""
    parts = []
    for key, one, many in USAGE_LABELS:
        count = counts.get(key) or 0
        if count:
            parts.append(f"{count} {one if count == 1 else many}")
    return ", ".join(parts)


def still_in_use(text: str) -> str:
    return f"Das Spiel wird noch verwendet: {text}. Archiviere es – dann steht es beim Anlegen nicht mehr zur Wahl, alles Bestehende zeigt es weiter."
