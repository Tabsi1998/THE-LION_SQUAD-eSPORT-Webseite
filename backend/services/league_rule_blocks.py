"""Bausteine im Regelwerk der Liga (docs/LIGA.md, #1646): ``[[baustein:map_pool]]`` steht im Text, der Inhalt kommt aus den Daten der
Season und wird beim Veröffentlichen eingefroren.

Ein neuer Baustein (die Waffenliste kommt mit #2218) ist ein Eintrag in ``BLOCKS``: Name für die Verwaltung und eine Funktion, die aus
Liga und Season Markdown samt Herkunft baut. Mehr braucht es nicht - Web und PDF lesen das Markdown, der Vergleich und der Vorschlag
„Daten geändert“ auch. Werte stehen hier keine, nur der Weg zu den Daten.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable

from models import rule_time_limit_seconds
from services import game_maps, game_modes, map_pools, mode_icons

# Steht, wo ein Baustein zu einer Season gehört, die Seite aber keine hat oder die Season erst später dazukam.
NO_SEASON_HINT = "*Dieser Baustein gilt je Season - er steht auf den Regeln der jeweiligen Season.*"
NOT_FROZEN_HINT = "*Für diese Season noch nicht festgehalten.*"
# Symbol eines Modus (#2266): ein Markdown-Bild mit genau diesem Text. Das Web zeigt es klein vor dem Namen, das PDF lässt es weg
# (``pdf_service.RULES_ICON_ALT``).
ICON_ALT = "Modus-Symbol"
# Zeichen, die Markdown im Web (``markdownLite``) innerhalb einer Zeile als Auszeichnung, Link oder Tabellenspalte liest - in Namen und
# Werten aus der Verwaltung werden sie zu gleich aussehenden, harmlosen Zeichen (#2271). Das PDF schreibt ∗ und ＋ wieder als * und +
# (``pdf_service._RULES_PDF_SUBSTITUTES``). Bis C.4 eine gemeinsame Lösung bringt (``services/markdown_text.py``).
_PLAIN = str.maketrans({"|": "/", "`": "'", "[": "(", "]": ")", "*": "∗", "~": "˜", "+": "＋"})


def _cell(value) -> str:
    """Ein Tabellenfeld: Ein senkrechter Strich im Namen zerlegte sonst die Spalten."""
    return " ".join(str(value or "").replace("|", "/").split())


def plain(value) -> str:
    """Text aus der Verwaltung als harmloser Markdown-Text: eine Zeile, keine Auszeichnung, kein Link, keine Tabellenspalte."""
    return " ".join(str(value or "").translate(_PLAIN).split())


def _icon(url: str | None) -> str:
    """Das Symbol als Markdown vor dem Namen - nur Raster-Bilder aus dem eigenen Upload (das Regelwerk zeigt keine SVG)."""
    found = mode_icons.raster_icon(url)
    return f"![{ICON_ALT}]({found}) " if found else ""


def duration(seconds) -> str:
    """Sekunden lesbar: volle Minuten als „10 Min.“, sonst „1:30 Min.“ bzw. „0:45 Min.“ (#2271)."""
    total = int(seconds or 0)
    minutes, rest = divmod(total, 60)
    return f"{minutes} Min." if not rest else f"{minutes}:{rest:02d} Min."


UNIT_WORDS = {"minutes": "Min.", "points": "Punkte"}


def setting_value(row: dict) -> str:
    """Der Wert einer Einstellung mit Einheit, wie Web und PDF ihn zeigen."""
    value, unit = row.get("value"), row.get("unit")
    if unit == "toggle":
        return "an" if value else "aus"
    if unit == "seconds":
        return duration(value)
    if unit in UNIT_WORDS:
        number = int(value) if isinstance(value, float) and value.is_integer() else value
        return f"{str(number).replace('.', ',')} {UNIT_WORDS[unit]}"
    return plain(value)


async def _game(db, league: dict) -> dict | None:
    return await db.games.find_one({"id": league.get("game_id")}, {"_id": 0}) if league.get("game_id") else None


async def _map_pool(db, league: dict, season: dict) -> dict:
    doc = map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), league.get("game_id"))
    if not doc:
        return {"markdown": "*Für diese Season ist noch kein Map-Pool hinterlegt.*", "source": {"map_pool_id": None}}
    lines = ["| Modus | Maps |", "| --- | --- |"]
    for group in doc.get("modes") or []:
        names = ", ".join(_cell(item.get("name")) for item in group.get("maps") or [])
        # Symbol aus dem Snapshot des Pools (#2266) - eingefroren wie der Name.
        lines.append(f"| {_icon(group.get('icon_url'))}{_cell(group.get('label') or map_pools.NO_MODE_LABEL)} | {names} |")
    return {"markdown": "\n".join(lines), "source": {"map_pool_id": doc.get("id"), "map_pool_version": doc.get("version")}}


async def _mode_order(db, league: dict, season: dict) -> dict:
    order = [mode for mode in season.get("game_mode_order") or [] if mode]
    if not order:
        return {"markdown": "*Der Modus je Map ist frei wählbar.*", "source": {"game_mode_order": []}}
    game = await _game(db, league)
    labels = {row["mode"]: row["label"] for row in game_maps.game_modes(game)} if game else {}
    lines = [f"- Map {index}: {_icon(game_modes.icon_of(game, mode))}{labels.get(mode, mode)}" for index, mode in enumerate(order, 1)]
    lines.append("")
    lines.append("Bei mehr Maps beginnt die Folge von vorn.")
    return {"markdown": "\n".join(lines), "source": {"game_mode_order": order}}


async def _mode_settings(db, league: dict, season: dict) -> dict:
    """Einstellungen je Modus (#2271): Zeitlimit und Zeit je Runde aus der Ergebnisregel, die freien Einstellungen als Tabelle (Gruppe,
    Einstellung, Wert) und der Regeltext - aus der Kopie der Season, bei älteren Seasons ohne Kopie aus dem Spiel."""
    from services import league_result_rules

    game = await _game(db, league)
    held = season.get("mode_settings")
    entries = held if isinstance(held, dict) else league_result_rules.settings_of_game(game)
    rules = season.get("result_rules") if isinstance(season.get("result_rules"), dict) else league_result_rules.rules_of_game(game)
    labels = {row["mode"]: row["label"] for row in game_maps.game_modes(game)}
    order = [*labels, *[key for key in [*entries, *rules] if key not in labels]]
    parts: list[str] = []
    for key in dict.fromkeys(order):
        entry = entries.get(key) or {}
        rule = rules.get(key) or {}
        times = []
        if rule_time_limit_seconds(rule):
            times.append(f"Zeitlimit je Map: {duration(rule_time_limit_seconds(rule))}")
        if rule.get("round_time_seconds"):
            times.append(f"Zeit je Runde: {duration(rule['round_time_seconds'])}")
        settings = entry.get("settings") or []
        text = [line for line in str(entry.get("rules_text") or "").splitlines() if line.strip()]
        if not (times or settings or text):
            continue
        block = [f"{_icon(game_modes.icon_of(game, key))}**{plain(labels.get(key, key))}**", ""]
        if times:
            block += [f"- {line}" for line in times] + [""]
        if settings:
            block += ["| Gruppe | Einstellung | Wert |", "| --- | --- | --- |"]
            block += [f"| {plain(row.get('group')) or '–'} | {plain(row.get('label'))} | {setting_value(row)} |" for row in settings]
            block.append("")
        block += [f"> {plain(line)}" for line in text]
        parts.append("\n".join(block).rstrip())
    if not parts:
        return {"markdown": "*Für die Modi sind keine Einstellungen hinterlegt.*", "source": {"modes": []}}
    return {"markdown": "\n\n".join(parts), "source": {"modes": [key for key in dict.fromkeys(order) if key in entries or key in rules]}}


@dataclass(frozen=True)
class Block:
    key: str
    label: str
    hint: str
    build: Callable[[object, dict, dict], Awaitable[dict]]

    @property
    def token(self) -> str:
        return f"[[baustein:{self.key}]]"


BLOCKS: dict[str, Block] = {block.key: block for block in (
    Block("map_pool", "Map-Pool", "Die Maps je Modus aus dem Map-Pool der Season.", _map_pool),
    Block("mode_order", "Modusfolge", "Die Modi je Map aus den Vorgaben der Season.", _mode_order),
    Block("mode_settings", "Einstellungen je Modus", "Zeitlimit, Zeit je Runde, Einstellungen und Regeltext je Modus aus der Season.",
          _mode_settings),
)}


def catalog() -> list[dict]:
    """Was die Verwaltung zum Einfügen anbietet."""
    return [{"key": block.key, "label": block.label, "hint": block.hint, "token": block.token} for block in BLOCKS.values()]


def unknown(keys: list[str]) -> list[str]:
    return [key for key in keys if key not in BLOCKS]


async def resolve(db, keys: list[str], league: dict, season: dict) -> dict[str, dict]:
    """Die Bausteine mit dem heutigen Stand der Daten: je Schlüssel ``{label, markdown, source}``."""
    out: dict[str, dict] = {}
    for key in keys:
        block = BLOCKS.get(key)
        if block:
            out[key] = {"label": block.label, **await block.build(db, league, season)}
    return out
