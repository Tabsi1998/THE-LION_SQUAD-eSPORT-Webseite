"""Aufbau für die Tests der Sperrliste (docs/LIGA.md, C.4 #2218): eine Bibliothek im Spiel der Liga aus ``league_rules_world``.
Erfundene Namen.

Kategorien Waffen, Aufsätze, Perks. Waffen „Blitz 9“ (mit Bild) und „Donner 4“, Aufsätze „Rotpunkt“ (nur Blitz), „Griff“ (jede Waffe)
und „Lauf“ (nur Donner), Perk „Leise Sohlen“ (mit Bild).
"""
from __future__ import annotations

from league_start_world import ok

IMAGE = "/api/static/uploads/blitz-1.webp"
PERK_IMAGE = "/api/static/uploads/sohlen-2.png"
CATEGORIES = [{"label": "Waffen", "role": "weapon"}, {"label": "Aufsätze", "role": "attachment"}, {"label": "Perks", "role": "item"}]


async def add_library(flow, w: dict) -> dict:
    """Legt Kategorien und Einträge an und gibt die Einträge nach Namen zurück (``w["items"]``)."""
    flow.act_as(w["lead"])
    base = f"/api/games/{w['game']['id']}/equipment"
    cats = {row["label"]: row["key"] for row in ok(await flow.put(f"{base}/categories", json={"categories": CATEGORIES}))["categories"]}
    items: dict[str, dict] = {}

    async def add(category: str, name: str, **fields) -> None:
        items[name] = ok(await flow.post(base, json={"category": cats[category], "name": name, **fields}))

    await add("Waffen", "Blitz 9", image_url=IMAGE)
    await add("Waffen", "Donner 4")
    await add("Aufsätze", "Rotpunkt", weapon_ids=[items["Blitz 9"]["id"]])
    await add("Aufsätze", "Griff")
    await add("Aufsätze", "Lauf", weapon_ids=[items["Donner 4"]["id"]])
    await add("Perks", "Leise Sohlen", image_url=PERK_IMAGE)
    w.update(items=items, cats=cats, library_url=base)
    return items


def bans_url(w: dict) -> str:
    return f"/api/admin/leagues/seasons/{w['season']['id']}/loadout-bans"


def item(w: dict, name: str, modes=(), **extra) -> dict:
    return {"item_id": w["items"][name]["id"], "kind": "item", "modes": list(modes), **extra}


def attachments(w: dict, weapon: str, names, modes=()) -> dict:
    return {"item_id": w["items"][weapon]["id"], "kind": "attachments", "modes": list(modes),
            "attachment_ids": [w["items"][name]["id"] for name in names]}


async def save_bans(flow, w: dict, entries: list[dict], **extra):
    flow.act_as(w["lead"])
    return await flow.put(bans_url(w), json={"entries": entries, **extra})


STANDARD = ("Blitz 9", "Leise Sohlen")


def standard(w: dict) -> list[dict]:
    """Blitz 9 ganz gesperrt, Leise Sohlen nur in „Suchen“, an Donner 4 die Aufsätze Lauf und Griff."""
    return [item(w, "Blitz 9"), item(w, "Leise Sohlen", ["suchen"]), attachments(w, "Donner 4", ["Lauf", "Griff"])]
