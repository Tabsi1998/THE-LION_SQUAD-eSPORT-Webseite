"""Bausteine im Regelwerk der Liga (docs/LIGA.md, #1646): ``[[baustein:map_pool]]`` steht im Text, der Inhalt kommt aus den Daten der
Season und wird beim Veröffentlichen eingefroren.

Ein Baustein ist ein Eintrag in ``BLOCKS``: Name für die Verwaltung, eine Funktion, die aus Liga und Season die Werte **strukturiert und im
Klartext** liefert (``{"source", "data"}``), und eine, die daraus beim Darstellen Markdown macht (``render(data, variant)``; ``text`` ohne
Bilder für PDF und Wort-Vergleich). Eingefroren wird ``data`` (Folge-Review #2218): Gespeicherte Fassungen und alle API-Felder tragen
Klartext, die Schutzzeichen für Namen (``markdown_text.text_cell``) entstehen nur beim Darstellen. Ältere Fassungen tragen statt ``data``
das fertige ``markdown`` (und ``text``) - das wird weiter gelesen, Schutzzeichen darin beim Lesen zurückgewandelt. Werte eines Titels
stehen hier keine, nur der Weg zu den Daten.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Awaitable, Callable

from services import game_maps, map_pools
from services.markdown_text import plain, text_cell

# Steht, wo ein Baustein zu einer Season gehört, die Seite aber keine hat oder die Season erst später dazukam.
NO_SEASON_HINT = "*Dieser Baustein gilt je Season - er steht auf den Regeln der jeweiligen Season.*"
NOT_FROZEN_HINT = "*Für diese Season noch nicht festgehalten.*"
NO_POOL = "*Für diese Season ist noch kein Map-Pool hinterlegt.*"
FREE_MODES = "*Der Modus je Map ist frei wählbar.*"
# Ein Baustein hat eine zweite Fassung ohne Bilder (``text``): Die nimmt das PDF und der Wort-Vergleich.
MARKDOWN, TEXT = "markdown", "text"

# Namen aus Bibliothek oder Modus sind Text (Review #2218): ``text_cell`` schützt die Steuerzeichen beim Darstellen.
_cell = text_cell


# ---------------------------------------------------------------- Map-Pool

def pool_data(doc: dict | None) -> dict:
    """Je Modus Name und Maps, im Klartext - ``rows`` leer heißt: kein Pool."""
    if not doc:
        return {"rows": []}
    return {"rows": [{"label": group.get("label") or map_pools.NO_MODE_LABEL,
                      "maps": [item.get("name") or "" for item in group.get("maps") or []]} for group in doc.get("modes") or []]}


def pool_table(data: dict, variant: str = MARKDOWN) -> str:
    """Die Tabelle Modus → Maps."""
    rows = data.get("rows") or []
    if not rows:
        return NO_POOL
    lines = ["| Modus | Maps |", "| --- | --- |"]
    lines += [f"| {_cell(row.get('label'))} | {', '.join(_cell(name) for name in row.get('maps') or [])} |" for row in rows]
    return "\n".join(lines)


async def _map_pool(db, league: dict, season: dict) -> dict:
    doc = map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), league.get("game_id"))
    source = {"map_pool_id": doc.get("id"), "map_pool_version": doc.get("version")} if doc else {"map_pool_id": None}
    return {"source": source, "data": pool_data(doc)}


# ---------------------------------------------------------------- Modusfolge

def _mode_order_text(data: dict, variant: str = MARKDOWN) -> str:
    labels = data.get("labels") or []
    if not labels:
        return FREE_MODES
    lines = [f"- Map {index}: {_cell(label)}" for index, label in enumerate(labels, 1)]
    return "\n".join([*lines, "", "Bei mehr Maps beginnt die Folge von vorn."])


async def _mode_order(db, league: dict, season: dict) -> dict:
    order = [mode for mode in season.get("game_mode_order") or [] if mode]
    game = await db.games.find_one({"id": league.get("game_id")}, {"_id": 0}) if order and league.get("game_id") else None
    labels = {row["mode"]: row["label"] for row in game_maps.game_modes(game)} if game else {}
    return {"source": {"game_mode_order": order}, "data": {"labels": [labels.get(mode, mode) for mode in order]}}


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
    Block("map_pool", "Map-Pool", "Die Maps je Modus aus dem Map-Pool der Season.", _map_pool, pool_table),
    Block("mode_order", "Modusfolge", "Die Modi je Map aus den Vorgaben der Season.", _mode_order, _mode_order_text),
    Block("loadout_bans", "Sperrliste", "Gesperrte Waffen, Aufsätze und Ausrüstung der Season, mit Bildern (Anlage A).", _loadout_bans,
          _loadout_text, _loadout_images),
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
