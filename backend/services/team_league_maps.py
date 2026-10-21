"""Maps der Team-Liga (#1616 an #1931): Auswahl im Ergebnisblatt, Snapshot im gespeicherten Spiel, Statistik je Map.

- **Auswahl** (``choices``): Für das Ergebnisblatt einer Saison, deren Spur ein Spiel hat. Gilt ein Map-Pool der
  Saison (``map_pools``), steht er je Modus mit Name und Bild aus seinem Snapshot da; sonst die Vorgabe des Spiels (alle
  aktiven Maps je Modus aus der Bibliothek). Dazu je Map die weiteren Schreibweisen (``aliases``), über die das Blatt
  einen eingetippten oder eingefügten Namen zuordnet. Ohne Spiel ``None`` - dann bleibt der Freitext.
- **Snapshot** (``attach``): Eine Map mit ``map_id`` kommt nur aus der Auswahl, die heute gilt - aus dem Map-Pool der
  Saison (mit ``mode`` genau aus diesem Modus, sonst aus irgendeinem), ohne Pool aus den aktiven Maps des Spiels (mit
  ``mode`` nur, wenn sie dafür freigegeben ist). Sonst das Problem ``map_unknown`` an der Map (wie die übrigen
  Prüfungen, mit ``match``, ``map``, ``map_field``). Name und Bild kommen nie aus der Eingabe, sondern aus dem Pool
  (Snapshot) bzw. der Bibliothek und werden beim Speichern ins Blatt geschrieben. Ausnahme: Steht genau diese Map an
  genau dieser Stelle schon im gespeicherten Blatt des Termins (auch im Entwurf daneben) - gleiche Begegnung (bei
  derselben Begegnung mehrmals im Blatt: die wievielte), gleiche Map-Nummer, gleiche Kennung, gleicher Modus
  (``place``) -, behält sie Name und Bild von damals, auch wenn sie
  inzwischen aus dem Pool gefallen, umbenannt oder archiviert ist. So zeigt ein altes Spiel die Map wie damals, und eine
  Map lässt sich nicht über ein altes Spiel woandershin einschleusen.
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


def _team(value) -> str:
    return " ".join(str(value or "").split()).casefold()


def pairings(matches: list[dict]) -> list[tuple]:
    """Je Spiel des Blatts seine Begegnung: Heim, Gast und die wievielte Begegnung dieser Teams im Blatt (0, 1 …) - so
    bleibt ein zweites Mal dieselbe Begegnung von der ersten unterscheidbar (dritte Runde #1616)."""
    seen: dict[tuple, int] = {}
    out = []
    for match in matches or []:
        teams = (_team(match.get("home")), _team(match.get("away")))
        out.append((*teams, seen.get(teams, 0)))
        seen[teams] = seen.get(teams, 0) + 1
    return out


def place(pairing: tuple, map_index: int, item: dict) -> tuple:
    """Die Stelle einer Map im Blatt: Begegnung (``pairings``), Map-Nummer, Kennung und Modus. Nur an genau derselben
    Stelle behält eine gespeicherte Map ihren Snapshot (Nachprüfung #1616)."""
    return (*pairing, map_index, item.get("map_id"), item.get("mode") or "")


def saved_maps(sheet: dict | None) -> dict[tuple, dict]:
    """Die Maps mit Kennung im gespeicherten Blatt eines Termins (auch im Entwurf daneben) - je Stelle (``place``) der
    gespeicherte Snapshot (Name, Bild)."""
    out: dict[tuple, dict] = {}
    for content in (sheet or {}, (sheet or {}).get("pending_draft") or {}):
        matches = content.get("matches") or []
        for pairing, match in zip(pairings(matches), matches):
            for map_index, item in enumerate(match.get("maps") or []):
                if item.get("map_id"):
                    out.setdefault(place(pairing, map_index, item),
                                   {"name": item.get("name"), "image_url": item.get("image_url")})
    return out


def _allowed(game: dict, pool: dict | None, rows: dict[str, dict], map_id: str, mode: str | None) -> tuple:
    """``(Snapshot, Grund)``: woher Name und Bild kommen - oder warum die Map nicht in die Auswahl passt."""
    modes = {item["mode"]: item["label"] for item in game_maps.game_modes(game)}
    label = modes.get(mode or "") or mode
    if pool:
        for group in pool.get("modes") or []:
            if mode and modes and group.get("mode") != mode:
                continue
            for item in group.get("maps") or []:
                if item.get("map_id") == map_id:
                    return {"name": item.get("name"), "image_url": item.get("image_url")}, None
        return None, (f"steht im Map-Pool der Saison nicht unter {label}" if mode and modes
                      else "steht nicht im Map-Pool der Saison")
    row = rows.get(map_id)
    if not row or row.get("game_id") != game["id"]:
        return None, "gehört nicht zu den Maps des Spiels dieser Serie"
    if row.get("status") != "active":
        return None, "ist archiviert"
    if mode and modes and mode not in (row.get("modes") or []):
        return None, f"ist für {label} nicht freigegeben"
    return {"name": row.get("name"), "image_url": row.get("image_url")}, None


async def attach(db, series: dict, resolution, sheet: dict | None = None) -> None:
    """Maps mit Kennung prüfen und Name und Bild als Snapshot setzen (siehe Modulkopf). ``sheet``: das gespeicherte
    Blatt dieses Termins - seine Maps behalten ihren Snapshot. Ändert ``resolution`` in place."""
    wanted = sorted({item["map_id"] for match in resolution.matches for item in match.get("maps") or []
                     if item.get("map_id")})
    if not wanted:
        return
    _lineage, game = await series_game(db, series)
    kept = saved_maps(sheet)
    rows = {row["id"]: row for row in await db.game_maps.find({"id": {"$in": wanted}}, {"_id": 0}).to_list(None)}
    pool = map_pools.valid_for(await map_pools.current(db, "reference_series", series["id"]), (game or {}).get("id"))
    for match_index, (pairing, match) in enumerate(zip(pairings(resolution.matches), resolution.matches)):
        for map_index, item in enumerate(match.get("maps") or []):
            map_id = item.get("map_id")
            if not map_id:
                continue
            snapshot, reason = kept.get(place(pairing, map_index, item)), None
            if not snapshot:
                snapshot, reason = _allowed(game, pool, rows, map_id, item.get("mode")) if game else (
                    None, "gehört zu keinem Spiel dieser Serie")
            if not snapshot:
                resolution.errors.append({
                    "code": "map_unknown", "rows": [], "match": match_index, "map": map_index, "map_field": "name",
                    "message": f"Spiel {match_index + 1}, Map {map_index + 1}: „{item.get('name')}“ {reason} - bitte "
                               "aus der Auswahl wählen oder als Freitext."})
                continue
            item["name"] = snapshot.get("name") or item.get("name")
            if snapshot.get("image_url"):
                item["image_url"] = snapshot["image_url"]
            else:
                item.pop("image_url", None)


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
