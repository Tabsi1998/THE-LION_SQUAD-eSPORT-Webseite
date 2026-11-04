"""Bausteine im Regelwerk der Liga (docs/LIGA.md, #1646): ``[[baustein:map_pool]]`` steht im Text, der Inhalt kommt aus den Daten der
Season und wird beim Veröffentlichen eingefroren.

Ein Baustein ist ein Eintrag in ``BLOCKS``: Name für die Verwaltung, eine Funktion, die aus Liga und Season die Werte **strukturiert und im
Klartext** liefert (``{"source", "data"}``), und eine, die daraus beim Darstellen Markdown macht (``render(data, variant)``; ``text`` ohne
Bilder für PDF und Wort-Vergleich). Eingefroren wird ``data`` (Folge-Review #2218): Gespeicherte Fassungen und alle API-Felder tragen
Klartext, die Schutzzeichen für Namen (``markdown_text.text_cell``) entstehen nur beim Darstellen. Ältere Fassungen tragen statt ``data``
das fertige ``markdown`` (und ``text``) - das wird weiter gelesen, Schutzzeichen darin beim Lesen zurückgewandelt. Werte eines Titels
stehen hier keine, nur der Weg zu den Daten.

Symbol eines Modus (#2266): Map-Pool, Modusfolge und „Einstellungen je Modus“ (#2271) tragen es in ``data`` (nur wenn gesetzt); nur die
Fassung ``markdown`` (Web) zeigt es, ``text`` (PDF, Vergleich) nicht. ``images`` meldet es der Mediathek.

Die Bausteine aus den Einstellungen (#2269: Modi, Spielformat, Tabelle, Termine, Spielberechtigung) stehen in ``league_rule_facts`` und
sind hier nur registriert.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Awaitable, Callable

from models import rule_time_limit_seconds
from services import game_maps, game_modes, league_rule_facts as facts, map_pools, mode_icons
from services.league_rule_facts import ICON_ALT, MARKDOWN, TEXT, duration, icon_markdown  # noqa: F401 - weiter von hier gelesen
from services.markdown_text import plain, text_cell

# Steht, wo ein Baustein zu einer Season gehört, die Seite aber keine hat oder die Season erst später dazukam.
NO_SEASON_HINT = "*Dieser Baustein gilt je Season - er steht auf den Regeln der jeweiligen Season.*"
NOT_FROZEN_HINT = "*Für diese Season noch nicht festgehalten.*"
NO_POOL = "*Für diese Season ist noch kein Map-Pool hinterlegt.*"
FREE_MODES = "*Der Modus je Map ist frei wählbar.*"
NO_SETTINGS = "*Für die Modi sind keine Einstellungen hinterlegt.*"

# Namen aus Bibliothek oder Modus sind Text (Review #2218): ``text_cell`` schützt die Steuerzeichen beim Darstellen.
_cell = text_cell
# Das Symbol vor dem Namen (#2266) - dieselbe Regel wie in den Bausteinen aus den Einstellungen.
_icon = icon_markdown


def _with_icon(row: dict, url: str | None) -> dict:
    """``icon_url`` nur, wenn gesetzt - ohne Symbol bleiben die Daten wie vor #2266."""
    return {**row, "icon_url": url} if url else row


def _icons(rows) -> list[str]:
    """Die Raster-Symbole in den Daten - dieselben, die ``markdown`` zeigt."""
    urls: list[str] = []
    for row in rows or []:
        url = mode_icons.raster_icon(row.get("icon_url"))
        if url and url not in urls:
            urls.append(url)
    return urls


# ---------------------------------------------------------------- Map-Pool

def pool_data(doc: dict | None) -> dict:
    """Je Modus Name, Symbol aus dem Snapshot (#2266) und Maps, im Klartext - ``rows`` leer heißt: kein Pool."""
    if not doc:
        return {"rows": []}
    return {"rows": [_with_icon({"label": group.get("label") or map_pools.NO_MODE_LABEL,
                                 "maps": [item.get("name") or "" for item in group.get("maps") or []]}, group.get("icon_url"))
                     for group in doc.get("modes") or []]}


def pool_table(data: dict, variant: str = MARKDOWN) -> str:
    """Die Tabelle Modus → Maps."""
    rows = data.get("rows") or []
    if not rows:
        return NO_POOL
    lines = ["| Modus | Maps |", "| --- | --- |"]
    lines += [f"| {_icon(row.get('icon_url'), variant)}{_cell(row.get('label'))} | {', '.join(_cell(name) for name in row.get('maps') or [])} |"
              for row in rows]
    return "\n".join(lines)


async def _map_pool(db, league: dict, season: dict) -> dict:
    doc = map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), league.get("game_id"))
    source = {"map_pool_id": doc.get("id"), "map_pool_version": doc.get("version")} if doc else {"map_pool_id": None}
    return {"source": source, "data": pool_data(doc)}


def _pool_images(data: dict) -> list[str]:
    return _icons(data.get("rows"))


# ---------------------------------------------------------------- Modusfolge

def _mode_order_text(data: dict, variant: str = MARKDOWN) -> str:
    labels = data.get("labels") or []
    if not labels:
        return FREE_MODES
    icons = data.get("icons") or []
    lines = [f"- Map {index}: {_icon(icons[index - 1] if index <= len(icons) else None, variant)}{_cell(label)}"
             for index, label in enumerate(labels, 1)]
    return "\n".join([*lines, "", "Bei mehr Maps beginnt die Folge von vorn."])


async def _mode_order(db, league: dict, season: dict) -> dict:
    order = [mode for mode in season.get("game_mode_order") or [] if mode]
    game = await db.games.find_one({"id": league.get("game_id")}, {"_id": 0}) if order and league.get("game_id") else None
    labels = {row["mode"]: row["label"] for row in game_maps.game_modes(game)} if game else {}
    data: dict = {"labels": [labels.get(mode, mode) for mode in order]}
    icons = [game_modes.icon_of(game, mode) or "" for mode in order]
    # Symbole (#2266) je Position, nur wenn eines gesetzt ist - ohne bleiben die Daten wie vorher.
    if any(icons):
        data["icons"] = icons
    return {"source": {"game_mode_order": order}, "data": data}


def _mode_order_images(data: dict) -> list[str]:
    return _icons({"icon_url": url} for url in data.get("icons") or [])


# ---------------------------------------------------------------- Einstellungen je Modus (#2271)

def mode_settings_data(game: dict | None, season: dict) -> dict:
    """Die Daten des Bausteins - Klartext, ohne Markdown und ohne Schutzzeichen: ``rows`` je Modus mit Angaben ``{mode, label, icon_url?,
    time_limit_seconds, round_time_seconds, settings, rules_text}``. Aus der Kopie der Season, bei älteren Seasons ohne Kopie aus dem Spiel."""
    from services import league_result_rules

    # Bereinigt gelesen (Zeichen des Zwischenformats fallen weg, auch im Altbestand).
    held = league_result_rules.held_settings(season)
    entries = held if held is not None else league_result_rules.settings_of_game(game)
    rules = season.get("result_rules") if isinstance(season.get("result_rules"), dict) else league_result_rules.rules_of_game(game)
    labels = {row["mode"]: row["label"] for row in game_maps.game_modes(game)}
    rows: list[dict] = []
    for key in dict.fromkeys([*labels, *entries, *rules]):
        entry = entries.get(key) or {}
        rule = rules.get(key) or {}
        row = {"mode": key, "label": labels.get(key, key),
               "time_limit_seconds": rule_time_limit_seconds(rule), "round_time_seconds": rule.get("round_time_seconds") or None,
               "settings": [{name: setting.get(name) for name in ("key", "label", "value", "unit", "group")} for setting in entry.get("settings") or []],
               "rules_text": [line.strip() for line in str(entry.get("rules_text") or "").splitlines() if line.strip()]}
        if row["time_limit_seconds"] or row["round_time_seconds"] or row["settings"] or row["rules_text"]:
            rows.append(_with_icon(row, game_modes.icon_of(game, key)))
    return {"rows": rows}


UNIT_WORDS = {"minutes": "Min.", "points": "Punkte"}


def setting_value(row: dict) -> str:
    """Der Wert einer Einstellung mit Einheit als Klartext - wie Web und PDF ihn zeigen."""
    value, unit = row.get("value"), row.get("unit")
    if unit == "toggle":
        return "an" if value else "aus"
    if unit == "seconds":
        return duration(value)
    if unit in UNIT_WORDS:
        number = int(value) if isinstance(value, float) and value.is_integer() else value
        return f"{str(number).replace('.', ',')} {UNIT_WORDS[unit]}"
    return " ".join(str(value if value is not None else "").split())


def render_mode_settings(data: dict, variant: str = MARKDOWN) -> str:
    """Je Modus fett der Name (mit Symbol nur in ``markdown``), die Zeiten als Liste, die Einstellungen als Tabelle Gruppe · Einstellung · Wert,
    der Regeltext als Zitat. Jeder Wert aus der Verwaltung geht durch ``text_cell``."""
    rows = data.get("rows") or []
    if not rows:
        return NO_SETTINGS
    parts: list[str] = []
    for row in rows:
        block = [f"{_icon(row.get('icon_url'), variant)}**{_cell(row.get('label'))}**", ""]
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
    game = await db.games.find_one({"id": league.get("game_id")}, {"_id": 0}) if league.get("game_id") else None
    data = mode_settings_data(game, season)
    return {"source": {"modes": [row["mode"] for row in data["rows"]]}, "data": data}


def _mode_settings_images(data: dict) -> list[str]:
    return _icons(data.get("rows"))


# ---------------------------------------------------------------- Sperrliste (#2218)

async def _loadout_bans(db, league: dict, season: dict) -> dict:
    from services import loadout_bans

    doc = loadout_bans.valid_for(await loadout_bans.current(db, loadout_bans.SEASON, season["id"]), league.get("game_id"))
    return {"source": loadout_bans.block_source(doc), "data": loadout_bans.block_data(doc)}


def _loadout_text(data: dict, variant: str = MARKDOWN) -> str:
    from services import loadout_bans

    return loadout_bans.render_block(data, variant)


def _loadout_images(data: dict) -> list[str]:
    from services import loadout_bans

    return loadout_bans.block_images(data)


# ---------------------------------------------------------------- Verzeichnis

@dataclass(frozen=True)
class Block:
    key: str
    label: str
    hint: str
    build: Callable[[object, dict, dict], Awaitable[dict]]
    render: Callable[[dict, str], str]
    images: Callable[[dict], list[str]] = lambda _data: []

    @property
    def token(self) -> str:
        return f"[[baustein:{self.key}]]"


BLOCKS: dict[str, Block] = {block.key: block for block in (
    Block("map_pool", "Map-Pool", "Die Maps je Modus aus dem Map-Pool der Season.", _map_pool, pool_table, _pool_images),
    Block("mode_order", "Modusfolge", "Die Modi je Map aus den Vorgaben der Season.", _mode_order, _mode_order_text, _mode_order_images),
    Block("loadout_bans", "Sperrliste", "Gesperrte Waffen, Aufsätze und Ausrüstung der Season, mit Bildern (Anlage A).", _loadout_bans,
          _loadout_text, _loadout_images),
    Block("mode_settings", "Einstellungen je Modus", "Zeitlimit, Zeit je Runde, Einstellungen und Regeltext je Modus aus der Season.",
          _mode_settings, render_mode_settings, _mode_settings_images),
    # Aus den Einstellungen der Season (#2269) - Daten und Darstellung in league_rule_facts.
    Block("modes", "Modi der Season", "Je Modus Symbol, Ergebnisregel in Klartext (Ziel, Runden, Zeit, Verlängerung, Remis) und Spieler je Seite.",
          facts.build_modes, facts.render_modes, facts.modes_images),
    Block("format", "Spielformat", "Best of, Teamgröße, Mindest- und Höchstkader, Map-Wiederholung, Teilnehmerliste - mit Abweichungen je Liga N.",
          facts.build_format, facts.render_format),
    Block("table", "Tabelle und Wertung", "Punkte, Remis, Reihenfolge bei Punktgleichheit, kampflos, beide nicht erschienen, Ausscheiden (E.1).",
          facts.build_table, facts.render_table),
    Block("schedule", "Termine", "Spielwochen, Standardtermin, Sperrzeiten, Antwortfrist, 72-h-Regel, Verschiebungen und Fristen (D.1).",
          facts.build_schedule, facts.render_schedule),
    Block("eligibility", "Spielberechtigung", "Zulassung, Mindestalter, Spiel-IDs, ein Co-Team je Season, Wartezeit, Stichtag und Transferfenster (B.3).",
          facts.build_eligibility, facts.render_eligibility),
)}
_IMAGE = re.compile(r"!\[[^\]\n]*\]\(([^)\s]+)\)")


def value(key: str, row: dict | None, variant: str = MARKDOWN) -> str:
    """Ein Baustein zum Darstellen (Markdown mit geschützten Namen). Neu eingefroren: aus ``data``; ältere Fassungen: das gespeicherte
    ``markdown`` bzw. ``text``."""
    row = row or {}
    block = BLOCKS.get(key)
    if "data" in row and block:
        return block.render(row.get("data") or {}, variant)
    stored = row.get(variant) if row.get(variant) is not None else row.get(MARKDOWN)
    return str(stored or "")


def plain_value(key: str, row: dict | None, variant: str = TEXT) -> str:
    """Derselbe Baustein als Klartext - für API-Felder und den Wort-Vergleich."""
    return plain(value(key, row, variant))


def frozen_images(frozen: dict | None) -> list[str]:
    """Die Bilder in eingefrorenen Bausteinen (#2218) - so weiß die Mediathek, dass eine veröffentlichte Fassung sie zeigt."""
    urls: list[str] = []
    for blocks_of_season in (frozen or {}).values():
        for key, row in (blocks_of_season or {}).items():
            block = BLOCKS.get(key)
            row = row or {}
            found = block.images(row.get("data") or {}) if block and "data" in row else _IMAGE.findall(str(row.get(MARKDOWN) or ""))
            for url in found:
                if url not in urls:
                    urls.append(url)
    return urls


def catalog() -> list[dict]:
    """Was die Verwaltung zum Einfügen anbietet."""
    return [{"key": block.key, "label": block.label, "hint": block.hint, "token": block.token} for block in BLOCKS.values()]


def unknown(keys: list[str]) -> list[str]:
    return [key for key in keys if key not in BLOCKS]


async def resolve(db, keys: list[str], league: dict, season: dict) -> dict[str, dict]:
    """Die Bausteine mit dem heutigen Stand der Daten: je Schlüssel ``{label, source, data}`` - Klartext, so wird eingefroren."""
    out: dict[str, dict] = {}
    for key in keys:
        block = BLOCKS.get(key)
        if block:
            out[key] = {"label": block.label, **await block.build(db, league, season)}
    return out
