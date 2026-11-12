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

from services import game_id_keys
from services.game_maps import DEFAULT_POOL_SCOPE, game_modes

ARCHIVED = "archived"
ARCHIVED_DETAIL = "Dieses Spiel ist archiviert und steht nicht mehr zur Wahl – bitte ein anderes wählen oder es zurückholen."
# Reihenfolge der Anzeige: Schlüssel, Einzahl, Mehrzahl.
USAGE_LABELS = (
    ("tournaments", "Turnier", "Turniere"),
    ("leagues", "Liga", "Ligen"),
    ("maps", "Map", "Maps"),
    ("pools", "Map-Pool", "Map-Pools"),
    ("equipment", "Ausrüstungs-Eintrag", "Ausrüstungs-Einträge"),
    ("editions", "Spielversion", "Spielversionen"),
    ("identity_sources", "Spiel mit dieser ID-Quelle", "Spiele mit dieser ID-Quelle"),
    ("teams", "Co-Team", "Co-Teams"),
    ("series", "Serie", "Serien"),
    ("references", "Referenz", "Referenzen"),
    ("name_links", "Namens-Zuordnung einer Serie", "Namens-Zuordnungen von Serien"),
    ("challenges", "Fast-Lap-Challenge", "Fast-Lap-Challenges"),
    ("servers", "Game-Server", "Game-Server"),
    ("stations", "Station", "Stationen"),
    ("profiles", "Person mit Spieler-ID", "Personen mit Spieler-ID"),
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
        # Ausrüstung (#2218): wie Maps - erst sie entfernen, dann das Spiel.
        "equipment": await db.game_equipment.count_documents({"game_id": game_id}),
        "editions": await db.games.count_documents({"parent_game_id": game_id}),
        "identity_sources": await db.games.count_documents({"identity_source_game_id": game_id}),
        "teams": await db.team_squads.count_documents({"game_id": game_id}),
        "series": await db.reference_lineages.count_documents({"game_id": game_id}),
        "references": await db.references.count_documents({"game_id": game_id}),
        "name_links": await db.reference_aliases.count_documents({"game_id": game_id}),
        "challenges": await db.f1_challenges.count_documents({"game_id": game_id}),
        "servers": await db.game_servers.count_documents({"game_id": game_id}),
        "stations": await db.stations.count_documents({"game_id": game_id}),
        # Wer eine Spiel-ID an diesem Spiel hat (#2249): Profil unter dem eigenen Slug und dort, wo die ID-Quelle die eigenen
        # Schlüssel speichert, dazu der Liga-Kader - anonymisierte Konten nicht.
        "profiles": await game_id_keys.deletion_people(db, game),
    }
    seasons = await db.league_seasons.find({"league_id": {"$in": [row["id"] for row in leagues]}},
                                           {"_id": 0, "game_mode_order": 1}).to_list(None)
    maps = await db.game_maps.find({"game_id": game_id}, {"_id": 0, "modes": 1}).to_list(None)
    # Turniere und Phasen mit diesem Modus: Fällt er weg, planen sie mit dem ersten Modus des Spiels (``match_duration``).
    tournaments = await db.tournaments.find({"game_id": game_id}, {"_id": 0, "id": 1, "game_mode": 1}).to_list(None)
    stages = await db.tournament_stages.find({"tournament_id": {"$in": [row["id"] for row in tournaments]}},
                                             {"_id": 0, "settings.game_mode": 1}).to_list(None)
    lasting = await mode_usage(db, game)
    modes = {
        mode["mode"]: {
            "label": mode["label"],
            "maps": sum(1 for row in maps if mode["mode"] in (row.get("modes") or [])),
            "pools": sum(1 for pool in pools if any(group.get("mode") == mode["mode"] for group in pool.get("modes") or [])),
            "seasons": sum(1 for season in seasons if mode["mode"] in (season.get("game_mode_order") or [])),
            "tournaments": sum(1 for row in tournaments if row.get("game_mode") == mode["mode"]),
            "stages": sum(1 for stage in stages if (stage.get("settings") or {}).get("game_mode") == mode["mode"]),
            **{key: lasting[mode["mode"]][key] for key in ("pool_versions", "staffeln", "matches", "references", "in_use")},
        }
        for mode in game_modes(game)
    }
    # Je ID-Feld, wie viele Personen darunter schon eine ID haben (#2249) - die Rückfrage vor dem Entfernen nennt die Zahl.
    id_fields = await game_id_keys.usage_by_key(db, game)
    return {"counts": counts, "total": sum(counts.values()), "text": usage_text(counts), "modes": modes, "id_fields": id_fields}


# Was einen Modus „verwendet“ (#2206, C.1): Dann lässt er sich nur noch deaktivieren oder archivieren, nicht entfernen.
# Die Zuordnung an Maps zählt nicht - sie ist Bibliothek, kein Wettbewerb, und wird beim Entfernen bereinigt.
MODE_USE_LABELS = (
    ("pool_versions", "Map-Pool-Version", "Map-Pool-Versionen"),
    ("seasons", "Season", "Seasons"),
    ("staffeln", "Staffel", "Staffeln"),
    ("tournaments", "Turnier", "Turniere"),
    ("stages", "Phase", "Phasen"),
    ("matches", "Spiel", "Spiele"),
    ("references", "Ergebnisblatt", "Ergebnisblätter"),
)


def _count_in(keys: set[str], found: dict[str, int], values) -> None:
    for key in {value for value in values if value in keys}:
        found[key] += 1


def _game_modes_of(rows) -> list:
    """Die Modi in ``games[]`` - Liste von Spielen mit ``mode``."""
    return [game.get("mode") for game in rows or [] if isinstance(game, dict)]


async def mode_usage(db, game: dict, keys=None) -> dict[str, dict]:
    """Je Modus (Vorgabe: alle des Spiels), wo er verwendet wird, und ``in_use``. Gezählt werden: jede Version eines
    Map-Pools des Spiels (außer dem Standard-Pool), ``game_mode_order`` von Seasons und Staffeln, ``game_mode`` von
    Turnieren, ``settings.game_mode`` von Phasen, ``games[]``, Meldungen und gehaltene Ergebnisse von Spielen und die
    Ergebnisblätter der Referenz-Serien des Spiels (auch Entwurf und alte Stände)."""
    game_id = game["id"]
    wanted = sorted({str(key) for key in (keys if keys is not None else [mode["mode"] for mode in game_modes(game)]) if key})
    found = {key: {name: 0 for name, _one, _many in MODE_USE_LABELS} for key in wanted}
    if not wanted:
        return {}
    keys_set = set(wanted)

    def bump(name: str, values) -> None:
        counter = {key: 0 for key in wanted}
        _count_in(keys_set, counter, values)
        for key, count in counter.items():
            found[key][name] += count

    async for pool in db.map_pools.find({"game_id": game_id, "scope": {"$ne": DEFAULT_POOL_SCOPE}, "modes.mode": {"$in": wanted}},
                                        {"_id": 0, "modes.mode": 1}):
        bump("pool_versions", [group.get("mode") for group in pool.get("modes") or []])
    leagues = [row["id"] for row in await db.leagues.find({"game_id": game_id}, {"_id": 0, "id": 1}).to_list(None)]
    if leagues:
        async for season in db.league_seasons.find({"league_id": {"$in": leagues}, "game_mode_order": {"$in": wanted}},
                                                   {"_id": 0, "game_mode_order": 1}):
            bump("seasons", season.get("game_mode_order") or [])
    tournaments = await db.tournaments.find({"game_id": game_id}, {"_id": 0, "id": 1, "game_mode": 1, "game_mode_order": 1}).to_list(None)
    for row in tournaments:
        bump("staffeln", row.get("game_mode_order") or [])
        bump("tournaments", [row.get("game_mode")])
    tournament_ids = [row["id"] for row in tournaments if row.get("id")]
    if tournament_ids:
        async for stage in db.tournament_stages.find({"tournament_id": {"$in": tournament_ids}, "settings.game_mode": {"$in": wanted}},
                                                     {"_id": 0, "settings.game_mode": 1}):
            bump("stages", [(stage.get("settings") or {}).get("game_mode")])
        query = {"tournament_id": {"$in": tournament_ids},
                 "$or": [{"games.mode": {"$in": wanted}}, {"reports.games.mode": {"$in": wanted}},
                         {"pending_result.games.mode": {"$in": wanted}}]}
        async for match in db.matches_v2.find(query, {"_id": 0, "games.mode": 1, "reports.games.mode": 1, "pending_result.games.mode": 1}):
            values = _game_modes_of(match.get("games"))
            for report in match.get("reports") or []:
                values += _game_modes_of((report or {}).get("games"))
            values += _game_modes_of((match.get("pending_result") or {}).get("games"))
            bump("matches", values)
    lineages = [row["id"] for row in await db.reference_lineages.find({"game_id": game_id}, {"_id": 0, "id": 1}).to_list(None)]
    series = [row["id"] for row in await db.reference_series.find({"lineage_id": {"$in": lineages}}, {"_id": 0, "id": 1}).to_list(None)] if lineages else []
    if series:
        sheet_query = {"series_id": {"$in": series},
                       "$or": [{"matches.maps.mode": {"$in": wanted}}, {"pending_draft.matches.maps.mode": {"$in": wanted}}]}
        async for sheet in db.reference_round_results.find(sheet_query, {"_id": 0, "matches.maps.mode": 1, "pending_draft.matches.maps.mode": 1}):
            values = [item.get("mode") for content in (sheet, sheet.get("pending_draft") or {})
                      for match in content.get("matches") or [] for item in (match or {}).get("maps") or []]
            bump("references", values)
        async for revision in db.reference_round_result_revisions.find(
                {"series_id": {"$in": series}, "content.matches.maps.mode": {"$in": wanted}}, {"_id": 0, "content.matches.maps.mode": 1}):
            bump("references", [item.get("mode") for match in (revision.get("content") or {}).get("matches") or []
                                for item in (match or {}).get("maps") or []])
    for counts in found.values():
        counts["in_use"] = any(counts[name] for name, _one, _many in MODE_USE_LABELS)
    return found


def mode_in_use_text(label: str, counts: dict) -> str:
    """409 beim Entfernen eines verwendeten Modus - mit Zählung und dem Weg, der bleibt."""
    parts = []
    for key, one, many in MODE_USE_LABELS:
        count = counts.get(key) or 0
        if count:
            parts.append(f"{count} {one if count == 1 else many}")
    return (f"Der Modus „{label}“ wird verwendet ({', '.join(parts)}). Entfernen geht nicht – stell ihn auf "
            "„inaktiv“ oder „archiviert“.")


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
