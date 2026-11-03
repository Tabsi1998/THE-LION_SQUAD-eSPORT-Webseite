"""Map-Pool einer Liga-Season gegen Reihenfolge und Wiederholungsregel prüfen (#2207, Paket C.2 - Vertrag in docs/LIGA.md).

- ``max_maps``: die längste Serie der Season - das größte Best of aus Season und aktiven Liga N.
- ``requirements``: wie viele Maps ein Pool je Modus mindestens braucht. Abgeleitet aus ``game_mode_order`` (zyklisch wie beim
  Melden) und ``map_repeat``, je Modus überschreibbar mit ``pool_min_maps`` der Season.
- ``pool_problems``: was am Pool zu klein ist (Text für Warnung beim Speichern und Problem in der Prüfung).
- ``order_length_problem``: die Reihenfolge muss leer oder genau ``max_maps`` lang sein.
- ``affected_seasons``: wo eine Map gerade in einem geltenden Pool steht - für die Warnung beim Deaktivieren und Archivieren.

Kein Wert eines Titels steht hier. Alle Zahlen kommen aus der Season.
"""
from __future__ import annotations

from itertools import combinations

from services import game_maps, map_pools

ORDER_RUNNING_HINT = "Die Season läuft schon - gespeichert wird trotzdem, damit nichts Bestehendes bricht."
OPEN_SEASON_STATUSES = ("draft", "active")
STATUS_TEXT = {"draft": "Entwurf", "active": "läuft"}


def max_maps(season: dict, divisions: list[dict]) -> int:
    """Die größte Mapzahl einer Serie der Season: Best of der Season und aller aktiven Liga N mit eigenem Best of."""
    values = [int(season.get("best_of") or 1)]
    for division in divisions or []:
        if (division.get("status") or "active") != "active":
            continue
        own = (division.get("overrides") or {}).get("best_of")
        if own:
            values.append(int(own))
    return max(values)


def mode_positions(order: list, length: int) -> dict:
    """Wie oft jeder Modus in den ersten ``length`` Positionen steht - zyklisch wie beim Melden."""
    order = [mode for mode in order or [] if mode]
    counts: dict = {}
    if not order:
        return counts
    for position in range(length):
        mode = order[position % len(order)]
        counts[mode] = counts.get(mode, 0) + 1
    return counts


def _overrides(season: dict) -> dict:
    return {row.get("mode"): int(row.get("min_maps") or 1) for row in season.get("pool_min_maps") or [] if isinstance(row, dict)}


def _have(pool: dict | None) -> dict:
    return {group.get("mode"): [item.get("map_id") for item in group.get("maps") or []] for group in (pool or {}).get("modes") or []}


def requirements(season: dict, divisions: list[dict], pool: dict | None, game: dict | None) -> dict:
    """``{max_maps, rows: [{mode, label, derived, override, needed, have}], total: {kind, needed, have} | None}``.

    Mit Reihenfolge je Modus der Reihenfolge, ohne Reihenfolge je Modus des Pools (abgeleitet 1). ``total`` ist die Bedingung über
    alle Modi, wenn die Reihenfolge frei ist (``pairs``: Paare aus Modus und Map, ``maps``: verschiedene Maps)."""
    length = max_maps(season, divisions)
    repeat = season.get("map_repeat") or "other_mode"
    order = [mode for mode in season.get("game_mode_order") or [] if mode]
    labels = {mode["mode"]: mode["label"] for mode in game_maps.game_modes(game)}
    have = _have(pool)
    for group in (pool or {}).get("modes") or []:
        labels.setdefault(group.get("mode"), group.get("label"))
    overrides = _overrides(season)
    counts = mode_positions(order, length)
    keys = list(counts) if order else list(dict.fromkeys([*have, *overrides]))
    rows = []
    for mode in keys:
        derived = 1 if repeat == "always" or not order else counts[mode]
        override = overrides.get(mode)
        rows.append({"mode": mode, "label": labels.get(mode) or (map_pools.NO_MODE_LABEL if mode is None else mode),
                     "derived": derived, "override": override, "needed": override if override is not None else derived,
                     "have": len(have.get(mode) or [])})
    total = None
    if not order and repeat != "always":
        if repeat == "never":
            count = len({map_id for ids in have.values() for map_id in ids})
            total = {"kind": "maps", "needed": length, "have": count}
        else:
            total = {"kind": "pairs", "needed": length, "have": sum(len(ids) for ids in have.values())}
    return {"max_maps": length, "rows": rows, "total": total, "repeat": repeat, "ordered": bool(order)}


def pool_problems(season: dict, divisions: list[dict], pool: dict | None, game: dict | None) -> list[str]:
    """Was der Pool für Reihenfolge und Wiederholungsregel zu wenig hat - deutsche Sätze, leer wenn alles reicht. Ohne Pool: leer
    (das meldet die Prüfung eigens)."""
    if not pool:
        return []
    need = requirements(season, divisions, pool, game)
    out = []
    for row in need["rows"]:
        if row["have"] < row["needed"]:
            out.append(f"{row['label']} braucht mindestens {row['needed']} {'Map' if row['needed'] == 1 else 'Maps'} im Pool, "
                       f"hat {row['have']}.")
    total = need["total"]
    if total and total["have"] < total["needed"]:
        what = "verschiedene Maps" if total["kind"] == "maps" else "Maps (über alle Modi gezählt)"
        out.append(f"Für eine Serie mit {total['needed']} Maps braucht der Pool mindestens {total['needed']} {what}, hat {total['have']}.")
    if need["repeat"] == "never" and need["ordered"]:
        out += _never_problems(need["rows"], _have(pool))
    return out


def _never_problems(rows: list[dict], have: dict) -> list[str]:
    """Bei „jede Map nur einmal je Serie“ dürfen sich Modi keine Map teilen: Für jede Gruppe von Modi (zwei und mehr) müssen genug
    verschiedene Maps da sein (Satz von Hall). Einzelne Modi prüft schon die Zeile je Modus."""
    out = []
    for size in range(2, len(rows) + 1):
        for subset in combinations(rows, size):
            needed = sum(row["needed"] for row in subset)
            maps = {map_id for row in subset for map_id in have.get(row["mode"]) or []}
            if len(maps) < needed:
                names = " und ".join(row["label"] for row in subset)
                out.append(f"{names} brauchen zusammen {needed} verschiedene Maps, weil jede Map nur einmal je Serie läuft – "
                           f"der Pool hat {len(maps)}.")
                return out
    return out


def order_length_problem(order: list | None, length: int) -> str | None:
    """Die Reihenfolge ist leer (frei) oder genau so lang wie die längste Serie."""
    order = [mode for mode in order or [] if mode]
    if not order or len(order) == length:
        return None
    return (f"Modus je Map: Die Reihenfolge hat {len(order)} {'Eintrag' if len(order) == 1 else 'Einträge'}, die längste Serie "
            f"der Season hat {length} Maps (Best of {length}). Bitte für jede Map einen Modus wählen – oder alle frei lassen.")


def season_running(season: dict) -> bool:
    return (season.get("status") or "draft") != "draft"


async def divisions_of(db, season_id: str) -> list[dict]:
    return await db.league_divisions.find({"season_id": season_id}, {"_id": 0}).to_list(100)


async def affected_seasons(db, game_id: str, map_id: str) -> list[dict]:
    """Seasons im Entwurf oder laufend, in deren geltendem Pool (Season oder eine ihrer Staffeln) die Map steht."""
    leagues = {row["id"]: row for row in await db.leagues.find({"game_id": game_id}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    if not leagues:
        return []
    seasons = await db.league_seasons.find(
        {"league_id": {"$in": sorted(leagues)}, "status": {"$in": [*OPEN_SEASON_STATUSES, None]}},
        {"_id": 0, "id": 1, "name": 1, "league_id": 1, "status": 1}).to_list(None)
    out = []
    for season in seasons:
        pool = map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), game_id)
        in_season = bool(pool) and any(item.get("map_id") == map_id for group in pool.get("modes") or [] for item in group.get("maps") or [])
        staffeln = 0
        for row in await db.tournaments.find({"league_context.season_id": season["id"]}, {"_id": 0, "id": 1, "game_id": 1}).to_list(None):
            own = map_pools.valid_for(await map_pools.current(db, "tournament", row["id"]), game_id)
            if own and any(item.get("map_id") == map_id for group in own.get("modes") or [] for item in group.get("maps") or []):
                staffeln += 1
        if in_season or staffeln:
            status = season.get("status") or "draft"
            out.append({"season_id": season["id"], "season_name": season.get("name"), "league_id": season["league_id"],
                        "league_name": leagues[season["league_id"]].get("name"), "status": status,
                        "status_text": STATUS_TEXT.get(status, status), "in_season_pool": in_season, "staffeln": staffeln})
    return sorted(out, key=lambda row: (str(row["league_name"] or ""), str(row["season_name"] or "")))


def affected_warning(name: str, status: str, seasons: list[dict]) -> str | None:
    if not seasons or status not in (game_maps.INACTIVE, game_maps.ARCHIVED):
        return None
    names = ", ".join(f"{row['league_name']} {row['season_name']} ({row['status_text']})" for row in seasons)
    return (f"„{name}“ ist jetzt {game_maps.STATUS_WORDS[status]}, steht aber noch im Map-Pool von {names}. Der Pool gilt "
            "unverändert weiter – zum Sperren dort „Map aus dem Pool nehmen“.")
