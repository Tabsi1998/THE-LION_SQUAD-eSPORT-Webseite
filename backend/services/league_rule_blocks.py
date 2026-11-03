"""Bausteine im Regelwerk der Liga (docs/LIGA.md, #1646): ``[[baustein:map_pool]]`` steht im Text, der Inhalt kommt aus den Daten der
Season und wird beim Veröffentlichen eingefroren.

Ein neuer Baustein ist ein Eintrag in ``BLOCKS``: Name für die Verwaltung und eine Funktion, die aus Liga und Season Markdown samt
Herkunft baut (die Sperrliste #2218 dazu eine Fassung ohne Bilder, ``text``). Mehr braucht es nicht - Web und PDF lesen das Markdown, der Vergleich und der Vorschlag
„Daten geändert“ auch. Werte stehen hier keine, nur der Weg zu den Daten.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Awaitable, Callable

from models import rule_time_limit_seconds
from services import game_maps, game_modes, map_pools, mode_icons
from services.markdown_text import text_cell

# Steht, wo ein Baustein zu einer Season gehört, die Seite aber keine hat oder die Season erst später dazukam.
NO_SEASON_HINT = "*Dieser Baustein gilt je Season - er steht auf den Regeln der jeweiligen Season.*"
NOT_FROZEN_HINT = "*Für diese Season noch nicht festgehalten.*"
# Symbol eines Modus (#2266): ein Markdown-Bild mit genau diesem Text vor dem Namen - nur in ``markdown`` (Web). Die Fassung ohne Bilder
# (``text``: PDF und Vergleich) hat es nicht. Veröffentlicht zählt die Mediathek es über ``frozen_images`` als Verwendung.
ICON_ALT = "Modus-Symbol"


# Namen aus Bibliothek oder Modus sind Text (Review #2218): ``text_cell`` maskiert die Steuerzeichen (Blatt-Modul ``markdown_text``).
_cell = text_cell


def _icon(url: str | None, images: bool) -> str:
    """Das Symbol als Markdown vor dem Namen - nur mit Bildern und nur Raster-Bilder aus dem eigenen Upload (das Regelwerk zeigt keine SVG)."""
    found = mode_icons.raster_icon(url) if images else None
    return f"![{ICON_ALT}]({found}) " if found else ""


def pool_table(doc: dict, *, images: bool = False) -> str:
    """Die Tabelle Modus → Maps eines Pools; ``images``: mit dem Symbol des Modus aus dem Snapshot (#2266)."""
    lines = ["| Modus | Maps |", "| --- | --- |"]
    for group in doc.get("modes") or []:
        names = ", ".join(_cell(item.get("name")) for item in group.get("maps") or [])
        lines.append(f"| {_icon(group.get('icon_url'), images)}{_cell(group.get('label') or map_pools.NO_MODE_LABEL)} | {names} |")
    return "\n".join(lines)


def duration(seconds) -> str:
    """Sekunden lesbar: volle Minuten als „10 Min.“, sonst „1:30 Min.“ bzw. „0:45 Min.“ (#2271)."""
    total = int(seconds or 0)
    minutes, rest = divmod(total, 60)
    return f"{minutes} Min." if not rest else f"{minutes}:{rest:02d} Min."


UNIT_WORDS = {"minutes": "Min.", "points": "Punkte"}


def setting_value(row: dict) -> str:
    """Der Wert einer Einstellung mit Einheit als Klartext (ohne Markdown) - wie Web und PDF ihn zeigen."""
    value, unit = row.get("value"), row.get("unit")
    if unit == "toggle":
        return "an" if value else "aus"
    if unit == "seconds":
        return duration(value)
    if unit in UNIT_WORDS:
        number = int(value) if isinstance(value, float) and value.is_integer() else value
        return f"{str(number).replace('.', ',')} {UNIT_WORDS[unit]}"
    return " ".join(str(value if value is not None else "").split())


async def _game(db, league: dict) -> dict | None:
    return await db.games.find_one({"id": league.get("game_id")}, {"_id": 0}) if league.get("game_id") else None


async def _map_pool(db, league: dict, season: dict) -> dict:
    doc = map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), league.get("game_id"))
    if not doc:
        return {"markdown": "*Für diese Season ist noch kein Map-Pool hinterlegt.*", "source": {"map_pool_id": None}}
    # Symbol aus dem Snapshot des Pools (#2266) - eingefroren wie der Name; ``text`` ohne Bilder für PDF und Vergleich.
    return {"markdown": pool_table(doc, images=True), "text": pool_table(doc),
            "source": {"map_pool_id": doc.get("id"), "map_pool_version": doc.get("version")}}


async def _mode_order(db, league: dict, season: dict) -> dict:
    order = [mode for mode in season.get("game_mode_order") or [] if mode]
    if not order:
        return {"markdown": "*Der Modus je Map ist frei wählbar.*", "source": {"game_mode_order": []}}
    game = await _game(db, league)
    labels = {row["mode"]: row["label"] for row in game_maps.game_modes(game)} if game else {}

    def render(images: bool) -> str:
        lines = [f"- Map {index}: {_icon(game_modes.icon_of(game, mode), images)}{_cell(labels.get(mode, mode))}"
                 for index, mode in enumerate(order, 1)]
        return "\n".join([*lines, "", "Bei mehr Maps beginnt die Folge von vorn."])

    return {"markdown": render(True), "text": render(False), "source": {"game_mode_order": order}}


def mode_settings_data(game: dict | None, season: dict) -> list[dict]:
    """Die Daten des Bausteins „Einstellungen je Modus“ (#2271) - Klartext, ohne Markdown und ohne Schutzzeichen: je Modus mit Angaben
    ``{mode, label, icon_url, time_limit_seconds, round_time_seconds, settings, rules_text}``. Aus der Kopie der Season, bei älteren Seasons
    ohne Kopie aus dem Spiel. Getrennt von der Darstellung (``render_mode_settings``), damit sich das Einfrieren später auf Daten umstellen
    lässt."""
    from services import league_result_rules

    held = season.get("mode_settings")
    entries = held if isinstance(held, dict) else league_result_rules.settings_of_game(game)
    rules = season.get("result_rules") if isinstance(season.get("result_rules"), dict) else league_result_rules.rules_of_game(game)
    labels = {row["mode"]: row["label"] for row in game_maps.game_modes(game)}
    out: list[dict] = []
    for key in dict.fromkeys([*labels, *entries, *rules]):
        entry = entries.get(key) or {}
        rule = rules.get(key) or {}
        row = {"mode": key, "label": labels.get(key, key), "icon_url": game_modes.icon_of(game, key),
               "time_limit_seconds": rule_time_limit_seconds(rule), "round_time_seconds": rule.get("round_time_seconds") or None,
               "settings": [{name: setting.get(name) for name in ("key", "label", "value", "unit", "group")} for setting in entry.get("settings") or []],
               "rules_text": [line.strip() for line in str(entry.get("rules_text") or "").splitlines() if line.strip()]}
        if row["time_limit_seconds"] or row["round_time_seconds"] or row["settings"] or row["rules_text"]:
            out.append(row)
    return out


NO_SETTINGS = "*Für die Modi sind keine Einstellungen hinterlegt.*"


def render_mode_settings(data: list[dict], *, images: bool) -> str:
    """Die Daten als Markdown: je Modus fett der Name (mit Symbol nur bei ``images``), die Zeiten als Liste, die Einstellungen als Tabelle
    Gruppe · Einstellung · Wert, der Regeltext als Zitat. Jeder Wert aus der Verwaltung geht durch ``text_cell``."""
    if not data:
        return NO_SETTINGS
    parts: list[str] = []
    for row in data:
        block = [f"{_icon(row.get('icon_url'), images)}**{_cell(row['label'])}**", ""]
        times = []
        if row.get("time_limit_seconds"):
            times.append(f"- Zeitlimit je Map: {duration(row['time_limit_seconds'])}")
        if row.get("round_time_seconds"):
            times.append(f"- Zeit je Runde: {duration(row['round_time_seconds'])}")
        if times:
            block += [*times, ""]
        if row.get("settings"):
            block += ["| Gruppe | Einstellung | Wert |", "| --- | --- | --- |"]
            block += [f"| {_cell(setting.get('group')) or '–'} | {_cell(setting.get('label'))} | {_cell(setting_value(setting))} |"
                      for setting in row["settings"]]
            block.append("")
        block += [f"> {_cell(line)}" for line in row.get("rules_text") or []]
        parts.append("\n".join(block).rstrip())
    return "\n\n".join(parts)


async def _mode_settings(db, league: dict, season: dict) -> dict:
    """Einstellungen je Modus (#2271): ``markdown`` mit Symbol fürs Web, ``text`` ohne Bilder für PDF und Vergleich."""
    data = mode_settings_data(await _game(db, league), season)
    return {"markdown": render_mode_settings(data, images=True), "text": render_mode_settings(data, images=False),
            "source": {"modes": [row["mode"] for row in data]}}


async def _loadout_bans(db, league: dict, season: dict) -> dict:
    """Die Sperrliste der Season (#2218): ``markdown`` mit Bildern fürs Web, ``text`` ohne Bilder für PDF und Vergleich."""
    from services import loadout_bans

    return loadout_bans.block(loadout_bans.valid_for(await loadout_bans.current(db, loadout_bans.SEASON, season["id"]),
                                                     league.get("game_id")))


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
    Block("loadout_bans", "Sperrliste", "Gesperrte Waffen, Aufsätze und Ausrüstung der Season, mit Bildern (Anlage A).", _loadout_bans),
    Block("mode_settings", "Einstellungen je Modus", "Zeitlimit, Zeit je Runde, Einstellungen und Regeltext je Modus aus der Season.",
          _mode_settings),
)}
# Ein Baustein kann eine zweite Fassung ohne Bilder liefern (``text``): Die nimmt das PDF und der Wort-Vergleich. Fehlt sie, gilt ``markdown``.
TEXT = "text"
_IMAGE = re.compile(r"!\[[^\]\n]*\]\(([^)\s]+)\)")


def frozen_images(frozen: dict | None) -> list[str]:
    """Die Bilder in eingefrorenen Bausteinen (#2218) - so weiß die Mediathek, dass eine veröffentlichte Fassung sie zeigt."""
    urls: list[str] = []
    for blocks_of_season in (frozen or {}).values():
        for row in (blocks_of_season or {}).values():
            for url in _IMAGE.findall(str((row or {}).get("markdown") or "")):
                if url not in urls:
                    urls.append(url)
    return urls


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
