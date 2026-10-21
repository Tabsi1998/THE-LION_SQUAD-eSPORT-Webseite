"""Maps der Team-Liga (#1616 an #1931): Auswahl im Ergebnisblatt, Snapshot im gespeicherten Spiel, Statistik je Map.

- **Auswahl** (``choices``): Für das Ergebnisblatt einer Saison, deren Spur ein Spiel hat. Gilt ein Map-Pool der
  Saison (``map_pools``), steht er je Modus mit Name und Bild aus seinem Snapshot da; sonst die Vorgabe des Spiels (alle
  aktiven Maps je Modus aus der Bibliothek). Dazu je Map die weiteren Schreibweisen (``aliases``), über die das Blatt
  einen eingetippten oder eingefügten Namen zuordnet. Ohne Spiel ``None`` - dann bleibt der Freitext.
- **Snapshot** (``attach``): Eine Map im Blatt mit ``map_id`` muss zur Bibliothek des Spiels der Spur gehören - sonst
  das Problem ``map_unknown`` an der Map (wie die übrigen Prüfungen, mit ``match``, ``map``, ``map_field``). Das Bild
  wird beim Speichern ins Blatt geschrieben (``image_url``): aus dem Pool der Saison (Snapshot), sonst aus der
  Bibliothek.
  Der Name bleibt, wie er eingetragen wurde. So zeigt ein altes Spiel die Map wie damals - auch nach Umbenennen, neuem
  Bild oder Archivieren. Ein Bild, das der Browser schickt, übernimmt der Server nie (``team_league_sheet.map_entry``).
- **Statistik** (``map_stats``): je Map aus den eigenen Spielen der Saison (Veto aus ``team_league_page``): gebannt und
  gewählt (von uns, vom Gegner, ohne Angabe), Decider, gespielt, Siege, Unentschieden, Niederlagen. Maps mit Kennung
  zählen über die Kennung, Freitext über den Namen (ohne Groß/klein).
"""
from __future__ import annotations

from services import game_maps, map_pools

STAT_KEYS = ("played", "won", "drawn", "lost", "picked_own", "picked_opponent", "picked", "decider", "banned_own",
             "banned_opponent", "banned")
OUTCOME_KEYS = {"win": "won", "draw": "drawn", "loss": "lost"}


async def series_game(db, series: dict) -> tuple[dict, dict | None]:
    """Spur und Spiel einer Saison - ohne Spiel der Spur ``None``."""
    lineage = await db.reference_lineages.find_one({"id": series.get("lineage_id")}, {"_id": 0}) or {}
    game = await db.games.find_one({"id": lineage["game_id"]}, {"_id": 0}) if lineage.get("game_id") else None
    return lineage, game


def _choice(item: dict, aliases: dict[str, list[str]]) -> dict:
    return {"map_id": item.get("map_id"), "slug": item.get("slug"), "name": item.get("name"),
            "image_url": item.get("image_url"), "aliases": aliases.get(item.get("map_id") or "", [])}


async def choices(db, series: dict) -> dict | None:
    """Die Maps zur Auswahl im Ergebnisblatt (siehe Modulkopf) - ``{source, game, modes: [{mode, label, maps}]}``."""
    _lineage, game = await series_game(db, series)
    if not game:
        return None
    rows = await game_maps.maps_of(db, game["id"])
    aliases = {row["id"]: row.get("aliases") or [] for row in rows}
    pool = map_pools.valid_for(await map_pools.current(db, "reference_series", series["id"]), game["id"])
    if pool:
        modes = [{"mode": group.get("mode"), "label": group.get("label"),
                  "maps": [_choice(item, aliases) for item in group.get("maps") or []]}
                 for group in pool.get("modes") or []]
        return {"source": "pool", "game": map_pools.game_summary(game), "pool_version": pool.get("version"),
                "modes": modes}
    active = [row for row in rows if row.get("status") == "active"]
    groups = game_maps.game_modes(game) or [{"mode": None, "label": map_pools.NO_MODE_LABEL}]
    modes = []
    for group in groups:
        members = [row for row in active if group["mode"] is None or group["mode"] in (row.get("modes") or [])]
        if members:
            modes.append({"mode": group["mode"], "label": group["label"],
                          "maps": [_choice({**row, "map_id": row["id"]}, aliases) for row in members]})
    return {"source": "library", "game": map_pools.game_summary(game), "pool_version": None, "modes": modes}


async def attach(db, series: dict, resolution) -> None:
    """Kennungen der Maps prüfen und den Bild-Snapshot anhängen (siehe Modulkopf). Ändert ``resolution`` in place."""
    wanted = sorted({item["map_id"] for match in resolution.matches for item in match.get("maps") or []
                     if item.get("map_id")})
    if not wanted:
        return
    _lineage, game = await series_game(db, series)
    rows = {row["id"]: row for row in await db.game_maps.find({"id": {"$in": wanted}}, {"_id": 0}).to_list(None)}
    snapshots = await map_pools.map_lookup(db, "reference_series", series["id"])
    for match_index, match in enumerate(resolution.matches):
        for map_index, item in enumerate(match.get("maps") or []):
            map_id = item.get("map_id")
            if not map_id:
                continue
            row = rows.get(map_id)
            if not game or not row or row.get("game_id") != game["id"]:
                resolution.errors.append({
                    "code": "map_unknown", "rows": [], "match": match_index, "map": map_index, "map_field": "name",
                    "message": f"Spiel {match_index + 1}, Map {map_index + 1}: „{item.get('name')}“ gehört nicht zu "
                               "den Maps des Spiels dieser Serie - bitte aus der Auswahl wählen oder als Freitext."})
                continue
            image = (snapshots.get(map_id) or {}).get("image_url") or row.get("image_url")
            if image:
                item["image_url"] = image


def _key(step: dict) -> str:
    if step.get("map_id"):
        return f"id:{step['map_id']}"
    return "name:" + " ".join(str(step.get("name") or "").split()).casefold()


def map_stats(views: list[dict]) -> list[dict]:
    """Statistik je Map aus den eigenen Spielen (``views``: die Spiele aus ``team_league_page._match_view`` in der
    Reihenfolge der Spieltage). Name und Bild vom jüngsten Spiel. Meistgespielte zuerst."""
    stats: dict[str, dict] = {}
    for view in views:
        for step in view.get("veto") or []:
            if not str(step.get("name") or "").strip():
                continue
            entry = stats.setdefault(_key(step), {"map_id": step.get("map_id"), **{key: 0 for key in STAT_KEYS}})
            entry["name"] = step.get("name")
            entry["image_url"] = step.get("image_url") or entry.get("image_url")
            role, by = step.get("role"), step.get("by")
            if role in ("banned", "picked"):
                entry[f"{role}_{by}" if by in ("own", "opponent") else role] += 1
            elif role == "decider":
                entry["decider"] += 1
            if step.get("played"):
                entry["played"] += 1
                if step.get("outcome") in OUTCOME_KEYS:
                    entry[OUTCOME_KEYS[step["outcome"]]] += 1
    out = [{"name": entry.pop("name"), "image_url": entry.pop("image_url", None), **entry} for entry in stats.values()]
    out.sort(key=lambda item: (-item["played"], -item["won"], -(item["picked_own"] + item["picked_opponent"]),
                               str(item["name"] or "").casefold()))
    return out
