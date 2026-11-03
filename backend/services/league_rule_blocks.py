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

from services import game_maps, map_pools

# Steht, wo ein Baustein zu einer Season gehört, die Seite aber keine hat oder die Season erst später dazukam.
NO_SEASON_HINT = "*Dieser Baustein gilt je Season - er steht auf den Regeln der jeweiligen Season.*"
NOT_FROZEN_HINT = "*Für diese Season noch nicht festgehalten.*"


def _cell(value) -> str:
    """Ein Tabellenfeld: Ein senkrechter Strich im Namen zerlegte sonst die Spalten."""
    return " ".join(str(value or "").replace("|", "/").split())


async def _map_pool(db, league: dict, season: dict) -> dict:
    doc = map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), league.get("game_id"))
    if not doc:
        return {"markdown": "*Für diese Season ist noch kein Map-Pool hinterlegt.*", "source": {"map_pool_id": None}}
    lines = ["| Modus | Maps |", "| --- | --- |"]
    for group in doc.get("modes") or []:
        names = ", ".join(_cell(item.get("name")) for item in group.get("maps") or [])
        lines.append(f"| {_cell(group.get('label') or map_pools.NO_MODE_LABEL)} | {names} |")
    return {"markdown": "\n".join(lines), "source": {"map_pool_id": doc.get("id"), "map_pool_version": doc.get("version")}}


async def _mode_order(db, league: dict, season: dict) -> dict:
    order = [mode for mode in season.get("game_mode_order") or [] if mode]
    if not order:
        return {"markdown": "*Der Modus je Map ist frei wählbar.*", "source": {"game_mode_order": []}}
    game = await db.games.find_one({"id": league.get("game_id")}, {"_id": 0}) if league.get("game_id") else None
    labels = {row["mode"]: row["label"] for row in game_maps.game_modes(game)} if game else {}
    lines = [f"- Map {index}: {labels.get(mode, mode)}" for index, mode in enumerate(order, 1)]
    lines.append("")
    lines.append("Bei mehr Maps beginnt die Folge von vorn.")
    return {"markdown": "\n".join(lines), "source": {"game_mode_order": order}}


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
