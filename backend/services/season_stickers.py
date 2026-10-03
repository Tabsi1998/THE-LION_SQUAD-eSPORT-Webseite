"""Saison-Sticker (Nikolaus X3 #736, Vereinsgeburtstag S13 #644): einer je Person und Jahr aus dem Saison-Paket der
Saison (``services/stickers.py``, Sammlung ``user_stickers``).

Welcher, sagt der Zufall aus Saison, Person und Jahr; wer aus früheren Jahren schon welche hat, bekommt einen, den er
noch nicht hat. Danach steht er im Chat unter dem Namen des Pakets. Ist das Paket im Admin abgeschaltet, wird nichts
verschenkt. Zwei Klicks gleichzeitig (zwei Geräte) vergeben nichts doppelt - der Index auf Person, Saison und Jahr
lässt nur den ersten durch.
"""
from __future__ import annotations

import hashlib

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services.stickers import USER_STICKERS, builtin_pack_active, owned_sticker_ids, seasonal_pack


def season_year(season: dict) -> int:
    """Das Jahr der Gabe: aus dem Beginn des Fensters (auch bei einer erzwungenen Saison)."""
    return int(str(season.get("starts_at") or "0")[:4] or 0)


def pick_sticker(stickers: list[dict], season_key: str, user_id: str, year: int, owned: set[str]) -> dict:
    """Ein Sticker für diese Person in diesem Jahr - zuerst einer, den sie noch nicht hat. Fest aus Saison, Person und
    Jahr, damit ein zweiter Klick (oder ein zweites Gerät) nichts anderes würfelt."""
    candidates = [sticker for sticker in stickers if sticker["id"] not in owned] or stickers
    digest = hashlib.sha256(f"{season_key}:{user_id}:{year}".encode("utf-8")).hexdigest()
    return candidates[int(digest[:8], 16) % len(candidates)]


def public_sticker(pack: dict, sticker_id: str) -> dict | None:
    sticker = next((entry for entry in pack["stickers"] if entry["id"] == sticker_id), None)
    if not sticker:
        return None
    return {"id": sticker["id"], "pack_id": pack["id"], "pack_name": pack["name"], "name": sticker["name"], "url": sticker["url"], "width": sticker.get("width"), "height": sticker.get("height")}


async def given(db, season_key: str, user_id: str, year: int) -> dict | None:
    return await db[USER_STICKERS].find_one({"user_id": user_id, "source": season_key, "year": year}, {"_id": 0})


async def gift_state(db, season_key: str, user_id: str, year: int) -> dict:
    """Schon geschenkt - und was? ``{"given": bool, "sticker": … | None}``."""
    gift = await given(db, season_key, user_id, year)
    pack = seasonal_pack(season_key)
    return {"given": bool(gift), "sticker": public_sticker(pack, gift["sticker_id"]) if gift and pack else None}


def preview_gift(season_key: str, user_id: str, year: int) -> dict:
    """Vorschau (nur mit Token, nur für diese Person): der Sticker, den sie bekäme - ohne etwas zu vergeben."""
    pack = seasonal_pack(season_key)
    if not pack:
        return {"year": year, "sticker": None, "new": False, "preview": True}
    sticker = pick_sticker(pack["stickers"], season_key, user_id, year, set())
    return {"year": year, "sticker": public_sticker(pack, sticker["id"]), "new": True, "preview": True}


async def give(db, season_key: str, user_id: str, year: int) -> dict:
    """Schenken: beim ersten Mal im Jahr ein neuer Sticker (``new``), danach derselbe noch einmal."""
    pack = seasonal_pack(season_key)
    if not pack or not await builtin_pack_active(db, pack["id"]):
        # Im Admin abgeschaltet: verschenkt wird nichts.
        return {"year": year, "sticker": None, "new": False}
    gift = await given(db, season_key, user_id, year)
    if gift:
        return {"year": year, "sticker": public_sticker(pack, gift["sticker_id"]), "new": False}
    sticker = pick_sticker(pack["stickers"], season_key, user_id, year, await owned_sticker_ids(db, user_id))
    doc = {"id": new_id(), "user_id": user_id, "sticker_id": sticker["id"], "pack_id": pack["id"], "source": season_key, "year": year, "created_at": now_utc().isoformat()}
    try:
        await db[USER_STICKERS].insert_one(dict(doc))
    except DuplicateKeyError:
        gift = await given(db, season_key, user_id, year)
        return {"year": year, "sticker": public_sticker(pack, gift["sticker_id"]) if gift else None, "new": False}
    return {"year": year, "sticker": public_sticker(pack, sticker["id"]), "new": True}
