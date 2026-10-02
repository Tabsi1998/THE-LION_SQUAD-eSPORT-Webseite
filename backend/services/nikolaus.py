"""Der Nikolausstiefel (Jahreszeiten II S8, X3 #736).

Am 6. Dezember liegt für jede angemeldete Person ein Sticker im Stiefel - einer je Person und Jahr, aus dem
Saison-Paket „Vom Nikolaus“ (``services/stickers.py``). Welcher, sagt der Zufall aus Person und Jahr; wer aus früheren
Jahren schon welche hat, bekommt einen, den er noch nicht hat. Danach steht er im Chat unter „Vom Nikolaus“.

Ob der Nikolaus gerade da ist, entscheidet dieselbe Rechnung wie für Web und App (``seasons.active`` mit den
Einstellungen aus dem Admin): ausgeschaltet kein Stiefel, erzwungen auch an einem anderen Tag. Ist das Paket im Admin
abgeschaltet, bleibt der Stiefel leer - der Gruß kommt trotzdem.
"""
from __future__ import annotations

import hashlib

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services.stickers import USER_STICKERS, builtin_pack_active, owned_sticker_ids, seasonal_pack

SEASON = "nikolaus"


def season_year(season: dict) -> int:
    """Das Jahr des Stiefels: aus dem Beginn des Fensters (auch bei einer erzwungenen Saison)."""
    return int(str(season.get("starts_at") or "0")[:4] or 0)


def pick_sticker(stickers: list[dict], user_id: str, year: int, owned: set[str]) -> dict:
    """Ein Sticker für diese Person in diesem Jahr - zuerst einer, den sie noch nicht hat. Fest aus Person und Jahr,
    damit ein zweiter Klick (oder ein zweites Gerät) nichts anderes würfelt."""
    candidates = [sticker for sticker in stickers if sticker["id"] not in owned] or stickers
    digest = hashlib.sha256(f"{SEASON}:{user_id}:{year}".encode("utf-8")).hexdigest()
    return candidates[int(digest[:8], 16) % len(candidates)]


def _public(pack: dict, sticker_id: str) -> dict | None:
    sticker = next((entry for entry in pack["stickers"] if entry["id"] == sticker_id), None)
    if not sticker:
        return None
    return {"id": sticker["id"], "pack_id": pack["id"], "pack_name": pack["name"], "name": sticker["name"], "url": sticker["url"], "width": sticker.get("width"), "height": sticker.get("height")}


async def _gift(db, user_id: str, year: int) -> dict | None:
    return await db[USER_STICKERS].find_one({"user_id": user_id, "source": SEASON, "year": year}, {"_id": 0})


async def boot_state(db, user: dict, season: dict | None) -> dict:
    """Was der Stiefel für diese Person gerade ist: da oder nicht, schon geöffnet, und was drin war."""
    if not season:
        return {"active": False, "opened": False, "sticker": None}
    year = season_year(season)
    gift = await _gift(db, user["id"], year)
    pack = seasonal_pack(SEASON)
    sticker = _public(pack, gift["sticker_id"]) if gift and pack else None
    return {"active": True, "year": year, "opened": bool(gift), "sticker": sticker}


def preview_open(user: dict, season: dict) -> dict:
    """Vorschau (nur mit Token, nur für diese Person): der Stiefel geht auf und zeigt den Sticker, den sie bekäme -
    ohne etwas zu vergeben oder zu speichern; beliebig oft."""
    year = season_year(season)
    pack = seasonal_pack(SEASON)
    if not pack:
        return {"year": year, "sticker": None, "new": False, "preview": True}
    sticker = pick_sticker(pack["stickers"], user["id"], year, set())
    return {"year": year, "sticker": _public(pack, sticker["id"]), "new": True, "preview": True}


async def open_boot(db, user: dict, season: dict) -> dict:
    """Den Stiefel öffnen: beim ersten Mal im Jahr ein neuer Sticker (``new``), danach derselbe noch einmal."""
    year = season_year(season)
    pack = seasonal_pack(SEASON)
    if not pack or not await builtin_pack_active(db, pack["id"]):
        # Im Admin abgeschaltet: der Stiefel bleibt leer, verschenkt wird nichts.
        return {"year": year, "sticker": None, "new": False}
    gift = await _gift(db, user["id"], year)
    if gift:
        return {"year": year, "sticker": _public(pack, gift["sticker_id"]), "new": False}
    sticker = pick_sticker(pack["stickers"], user["id"], year, await owned_sticker_ids(db, user["id"]))
    doc = {"id": new_id(), "user_id": user["id"], "sticker_id": sticker["id"], "pack_id": pack["id"], "source": SEASON, "year": year, "created_at": now_utc().isoformat()}
    try:
        await db[USER_STICKERS].insert_one(dict(doc))
    except DuplicateKeyError:
        # Zwei Klicks gleichzeitig (zwei Geräte): der erste gewinnt, beide sehen denselben Sticker.
        gift = await _gift(db, user["id"], year)
        return {"year": year, "sticker": _public(pack, gift["sticker_id"]) if gift else None, "new": False}
    return {"year": year, "sticker": _public(pack, sticker["id"]), "new": True}
