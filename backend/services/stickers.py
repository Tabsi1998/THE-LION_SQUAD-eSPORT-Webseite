"""Sticker für die Chats.

Zwei Quellen:
  - das mitgelieferte Startpaket aus Microsoft Fluent Emoji (3D, MIT-Lizenz).
    Die Bilder liegen unter backend/static/stickers, der Katalog daneben als
    JSON. Das Backend liefert sie aus - so gilt dieselbe Adresse im Web und in
    der App, auch wenn die App direkt mit der API spricht.
  - eigene Pakete aus dem Adminbereich (Löwe, Maskottchen, Vereinsmomente).
    Deren Bilder kommen über den normalen Upload.

Eine Nachricht speichert den Sticker aufgelöst: Name, Adresse, Größe. Schaltet
ein Admin später ein Paket ab oder löscht einen Sticker, bleiben alte
Nachrichten lesbar - neu senden lässt er sich dann nicht mehr.
"""
from __future__ import annotations

import functools
import json
import pathlib
import re

from fastapi import HTTPException

STICKER_ROOT = pathlib.Path(__file__).resolve().parents[1] / "static" / "stickers"
BUILTIN_CATALOG_PATH = pathlib.Path(__file__).resolve().parent / "sticker_catalog_fluent.json"
STICKER_PREVIEW_TEXT = "[Sticker]"
# Eigene Sticker nur aus dem eigenen Upload. Eine fremde Adresse würde beim
# Anzeigen jeden Chatteilnehmer bei Dritten abrufen lassen.
CUSTOM_STICKER_URL = re.compile(r"/api/static/uploads/[A-Za-z0-9][A-Za-z0-9_-]{0,150}\.(png|webp|jpg|jpeg)")
MAX_CUSTOM_PACKS = 30
MAX_STICKERS_PER_PACK = 120
MESSAGE_STICKER_FIELDS = ("id", "pack_id", "name", "url", "width", "height")


@functools.lru_cache(maxsize=1)
def builtin_catalog() -> dict:
    return json.loads(BUILTIN_CATALOG_PATH.read_text(encoding="utf-8"))


def builtin_source() -> dict:
    catalog = builtin_catalog()
    return {key: catalog.get(key) for key in ("source", "license", "license_url", "project_url")}


def builtin_pack_ids() -> set[str]:
    return {pack["id"] for pack in builtin_catalog()["packs"]}


def sticker_file_path(pack: str, filename: str) -> pathlib.Path | None:
    if not re.fullmatch(r"[a-z0-9-]{1,40}", pack or ""):
        return None
    if not re.fullmatch(r"[a-z0-9-]{1,80}\.(png|webp|txt)", filename or ""):
        return None
    path = STICKER_ROOT / pack / filename
    return path if path.is_file() else None


def public_custom_sticker(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "pack_id": doc["pack_id"],
        "name": doc.get("name") or "Sticker",
        "keywords": doc.get("keywords") or [],
        "url": doc["url"],
        "width": doc.get("width"),
        "height": doc.get("height"),
    }


async def _builtin_states(db) -> dict[str, bool]:
    rows = await db.sticker_builtin_packs.find({}, {"_id": 0}).to_list(100)
    return {row["id"]: row.get("active") is not False for row in rows}


async def list_sticker_packs(db, *, include_inactive: bool = False) -> list[dict]:
    """Eigene Pakete zuerst - den eigenen Löwen sucht man im Vereinschat öfter als ein Emoji."""
    query = {} if include_inactive else {"active": True}
    custom = await db.sticker_packs.find(query, {"_id": 0}).sort(
        [("sort_order", 1), ("created_at", 1)],
    ).to_list(MAX_CUSTOM_PACKS)
    by_pack: dict[str, list[dict]] = {}
    if custom:
        rows = await db.stickers.find(
            {"pack_id": {"$in": [pack["id"] for pack in custom]}}, {"_id": 0},
        ).sort([("sort_order", 1), ("created_at", 1)]).to_list(MAX_CUSTOM_PACKS * MAX_STICKERS_PER_PACK)
        for row in rows:
            by_pack.setdefault(row["pack_id"], []).append(public_custom_sticker(row))

    packs = []
    for pack in custom:
        stickers = by_pack.get(pack["id"], [])
        if not include_inactive and not stickers:
            continue
        packs.append({
            "id": pack["id"],
            "name": pack.get("name") or "Sticker",
            "builtin": False,
            "active": pack.get("active") is not False,
            "sort_order": pack.get("sort_order", 0),
            "stickers": stickers,
        })

    states = await _builtin_states(db)
    for index, pack in enumerate(builtin_catalog()["packs"]):
        active = states.get(pack["id"], True)
        if not active and not include_inactive:
            continue
        packs.append({
            "id": pack["id"],
            "name": pack["name"],
            "builtin": True,
            "active": active,
            "sort_order": index,
            "stickers": [{**sticker, "pack_id": pack["id"]} for sticker in pack["stickers"]],
        })
    return packs


def _message_sticker(sticker: dict) -> dict:
    return {key: sticker.get(key) for key in MESSAGE_STICKER_FIELDS}


async def resolve_sticker(db, sticker_id: str) -> dict | None:
    """Senden lässt sich nur ein Sticker aus einem Paket, das gerade angeboten wird."""
    for pack in builtin_catalog()["packs"]:
        for sticker in pack["stickers"]:
            if sticker["id"] == sticker_id:
                states = await _builtin_states(db)
                if not states.get(pack["id"], True):
                    return None
                return _message_sticker({**sticker, "pack_id": pack["id"]})
    doc = await db.stickers.find_one({"id": sticker_id}, {"_id": 0})
    if not doc:
        return None
    pack = await db.sticker_packs.find_one({"id": doc["pack_id"], "active": True}, {"_id": 0})
    return _message_sticker(doc) if pack else None


async def sticker_for_message(db, sticker_id: str | None, text: str, attachment_ids: list[str] | None) -> dict | None:
    """Der Sticker einer neuen Nachricht - wie im Messenger allein, ohne Text und Anhänge."""
    if not sticker_id:
        return None
    if text or attachment_ids:
        raise HTTPException(status_code=400, detail="Ein Sticker wird allein gesendet, ohne Text und Anhänge.")
    sticker = await resolve_sticker(db, sticker_id)
    if not sticker:
        raise HTTPException(status_code=400, detail="Diesen Sticker gibt es nicht mehr.")
    return sticker
