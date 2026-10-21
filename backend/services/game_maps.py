"""Map-Bibliothek je Spiel bzw. Spielversion (#1616).

Eine Map (``game_maps``) gehört genau einem Spiel: stabile Kennung ``id``, Slug eindeutig je Spiel, Name, optional ein
Bild aus dem eigenen Upload, Notiz und externe Kennung, Reihenfolge, aktiv oder archiviert. ``modes`` sind die
Kennungen aus ``games.match_modes[].mode`` - dieselben Modi wie für die Dauer (#1554), kein zweites Modussystem. Eine
Map kann in mehreren Modi freigegeben sein und in anderen nicht (M:N).

Was ein Wettbewerb daraus wählt, steht als Snapshot in ``map_pools`` (``services/map_pools.py``). Deshalb ändern
Umbenennen, neues Bild oder Archivieren nie einen gespeicherten Pool. Gelöscht wird nur eine Map, die in keiner
Pool-Version steht - sonst archivieren. Eine neue Spielversion erbt keine Maps von selbst; gleiche Namen in zwei Spielen
sind zwei verschiedene Maps.
"""
from __future__ import annotations

import re
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from models import GAME_MODES_MAX, now_utc
from services.slug_utils import slugify

# Grenze gegen unkontrollierte Datenmengen - keine feste Kartenzahl eines Spiels.
MAPS_PER_GAME_MAX = 200
NAME_MAX = 80
SLUG_MAX = 80
# Bilder nur aus dem eigenen Upload: eine fremde Adresse ließe jede Person beim Ansehen bei Dritten anfragen.
IMAGE_URL = re.compile(r"/api/static/uploads/[A-Za-z0-9][A-Za-z0-9_.-]{0,150}\.(png|webp|jpg|jpeg)")
IMAGE_REFUSED = "Bild bitte über „Hochladen“ oder die Mediathek wählen (PNG, JPG oder WebP)."
STATUSES = ("active", "archived")
SLUG_TAKEN = "Der Slug „{slug}“ ist in diesem Spiel schon vergeben."
# Was eine Map nach außen zeigt - Verwaltung und Pools lesen dieselben Felder.
PUBLIC_FIELDS = ("id", "game_id", "slug", "name", "aliases", "image_url", "note", "external_ref", "order", "status",
                 "modes", "archived_at", "created_at", "created_by", "updated_at", "updated_by")
# Weitere Schreibweisen (#1616 an #1931), etwa der englische Name beim Veranstalter: das Ergebnisblatt der Team-Liga
# ordnet einen eingetippten oder eingefügten Namen darüber der Map zu.
ALIASES_MAX = 10


def _text(value) -> str:
    return " ".join(str(value or "").split())


def _optional_text(value):
    text = _text(value)
    return text or None


def clean_aliases(values, name: str | None = None) -> list[str]:
    """Schreibweisen ohne Leerraum am Rand, jede einmal (ohne Groß/klein), ohne den Namen selbst."""
    out: list[str] = []
    seen = {_text(name).casefold()} if name else set()
    for value in values or []:
        text = _text(value)[:NAME_MAX]
        if text and text.casefold() not in seen:
            seen.add(text.casefold())
            out.append(text)
    return out[:ALIASES_MAX]


class GameMapCreate(BaseModel):
    name: str = Field(min_length=1, max_length=NAME_MAX)
    slug: Optional[str] = Field(default=None, max_length=SLUG_MAX)
    aliases: List[str] = Field(default_factory=list, max_length=ALIASES_MAX * 2)
    image_url: Optional[str] = Field(default=None, max_length=300)
    note: Optional[str] = Field(default=None, max_length=500)
    external_ref: Optional[str] = Field(default=None, max_length=120)
    modes: List[str] = Field(default_factory=list, max_length=GAME_MODES_MAX)

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, value):
        return _text(value)

    @field_validator("note", "external_ref", "slug", mode="before")
    @classmethod
    def _optional(cls, value):
        return _optional_text(value)


class GameMapUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=NAME_MAX)
    slug: Optional[str] = Field(default=None, max_length=SLUG_MAX)
    aliases: Optional[List[str]] = Field(default=None, max_length=ALIASES_MAX * 2)
    image_url: Optional[str] = Field(default=None, max_length=300)
    note: Optional[str] = Field(default=None, max_length=500)
    external_ref: Optional[str] = Field(default=None, max_length=120)
    modes: Optional[List[str]] = Field(default=None, max_length=GAME_MODES_MAX)
    status: Optional[Literal["active", "archived"]] = None

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, value):
        return None if value is None else _text(value)

    @field_validator("note", "external_ref", "slug", mode="before")
    @classmethod
    def _optional(cls, value):
        return _optional_text(value)


class GameMapOrder(BaseModel):
    ids: List[str] = Field(min_length=1, max_length=MAPS_PER_GAME_MAX)


class MapProblem(ValueError):
    """Eine Eingabe, die nicht passt - die Route macht daraus 422 bzw. 409 (``status``)."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


def game_modes(game: dict | None) -> list[dict]:
    """Die Modi eines Spiels als ``{mode, label}`` in ihrer Reihenfolge - Kaputtes fällt still heraus."""
    modes = (game or {}).get("match_modes")
    if not isinstance(modes, list):
        return []
    return [{"mode": mode["mode"], "label": mode.get("label") or mode["mode"]}
            for mode in modes if isinstance(mode, dict) and mode.get("mode")]


def clean_modes(game: dict, modes: list[str] | None) -> list[str]:
    """Die Modus-Kennungen einer Map: jede einmal, in der Reihenfolge des Spiels; eine unbekannte ist ein Fehler."""
    known = [mode["mode"] for mode in game_modes(game)]
    wanted = [str(mode or "").strip() for mode in modes or [] if str(mode or "").strip()]
    unknown = [mode for mode in wanted if mode not in known]
    if unknown:
        raise MapProblem(f"Unbekannter Modus für {game.get('name') or 'dieses Spiel'}: {', '.join(unknown)}.")
    return [mode for mode in known if mode in wanted]


def clean_image(value) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if not IMAGE_URL.fullmatch(text):
        raise MapProblem(IMAGE_REFUSED)
    return text


def name_key(value) -> str:
    return _text(value).casefold()


def public_map(doc: dict) -> dict:
    return {**{key: doc.get(key) for key in PUBLIC_FIELDS}, "aliases": doc.get("aliases") or []}


async def maps_of(db, game_id: str, *, active_only: bool = False) -> list[dict]:
    query = {"game_id": game_id}
    if active_only:
        query["status"] = "active"
    rows = await db.game_maps.find(query, {"_id": 0}).to_list(MAPS_PER_GAME_MAX + 50)
    return sorted(rows, key=lambda row: (row.get("order") or 0, name_key(row.get("name"))))


async def usage_counts(db, game_id: str) -> dict[str, int]:
    """In wie vielen Pool-Versionen eine Map steht - danach richtet sich, ob sie gelöscht werden darf."""
    counts: dict[str, int] = {}
    async for pool in db.map_pools.find({"game_id": game_id}, {"_id": 0, "modes": 1}):
        seen = {item.get("map_id") for group in pool.get("modes") or [] for item in group.get("maps") or []}
        for map_id in seen:
            if map_id:
                counts[map_id] = counts.get(map_id, 0) + 1
    return counts


async def _check_unique(db, game_id: str, *, name: str | None = None, slug: str | None = None,
                        current_id: str | None = None) -> None:
    others = [row for row in await db.game_maps.find({"game_id": game_id}, {"_id": 0, "id": 1, "name": 1, "slug": 1})
              .to_list(MAPS_PER_GAME_MAX + 50) if row.get("id") != current_id]
    if name is not None and any(name_key(row.get("name")) == name_key(name) for row in others):
        raise MapProblem(f"Die Map „{name}“ gibt es in diesem Spiel schon.", 409)
    if slug is not None and any(row.get("slug") == slug for row in others):
        raise MapProblem(SLUG_TAKEN.format(slug=slug), 409)


async def create(db, game: dict, body: GameMapCreate, user: dict, new_id: str) -> dict:
    count = await db.game_maps.count_documents({"game_id": game["id"]})
    if count >= MAPS_PER_GAME_MAX:
        raise MapProblem(f"Höchstens {MAPS_PER_GAME_MAX} Maps je Spiel - archivierte zählen mit.")
    slug = slugify(body.slug or body.name, fallback="map", max_length=SLUG_MAX)
    await _check_unique(db, game["id"], name=body.name, slug=slug)
    last = await db.game_maps.find_one({"game_id": game["id"]}, {"_id": 0, "order": 1}, sort=[("order", -1)])
    now = now_utc().isoformat()
    doc = {
        "id": new_id, "game_id": game["id"], "slug": slug, "name": body.name,
        "aliases": clean_aliases(body.aliases, body.name), "image_url": clean_image(body.image_url), "note": body.note,
        "external_ref": body.external_ref, "modes": clean_modes(game, body.modes),
        "order": int((last or {}).get("order") or 0) + 1, "status": "active", "archived_at": None,
        "created_at": now, "created_by": user["id"], "updated_at": now, "updated_by": user["id"],
    }
    try:
        await db.game_maps.insert_one(dict(doc))
    except DuplicateKeyError:
        # Gleichzeitig angelegt: der eindeutige Index (game_id, slug) aus database.py entscheidet - 409, nie 500.
        raise MapProblem(SLUG_TAKEN.format(slug=slug), 409) from None
    return public_map(doc)


async def update(db, game: dict, current: dict, body: GameMapUpdate, user: dict) -> dict:
    raw = body.model_dump(exclude_unset=True)
    updates: dict = {}
    if raw.get("name") is not None and raw["name"] != current.get("name"):
        await _check_unique(db, game["id"], name=raw["name"], current_id=current["id"])
        updates["name"] = raw["name"]
    if raw.get("slug"):
        slug = slugify(raw["slug"], fallback="map", max_length=SLUG_MAX)
        if slug != current.get("slug"):
            await _check_unique(db, game["id"], slug=slug, current_id=current["id"])
            updates["slug"] = slug
    if "image_url" in raw:
        updates["image_url"] = clean_image(raw["image_url"])
    for key in ("note", "external_ref"):
        if key in raw:
            updates[key] = raw[key]
    if raw.get("modes") is not None:
        updates["modes"] = clean_modes(game, raw["modes"])
    if raw.get("aliases") is not None:
        updates["aliases"] = clean_aliases(raw["aliases"], updates.get("name") or current.get("name"))
    status = raw.get("status")
    if status and status != current.get("status"):
        updates["status"] = status
        updates["archived_at"] = now_utc().isoformat() if status == "archived" else None
    updates.update({"updated_at": now_utc().isoformat(), "updated_by": user["id"]})
    try:
        await db.game_maps.update_one({"id": current["id"]}, {"$set": updates})
    except DuplicateKeyError:
        raise MapProblem(SLUG_TAKEN.format(slug=updates.get("slug") or current.get("slug")), 409) from None
    return public_map({**current, **updates})


async def reorder(db, game: dict, ids: list[str], user: dict) -> list[dict]:
    rows = await maps_of(db, game["id"])
    known = {row["id"] for row in rows}
    wanted = list(dict.fromkeys(ids))
    if any(map_id not in known for map_id in wanted):
        raise MapProblem("Eine der Maps gehört nicht zu diesem Spiel.")
    # Nicht genannte Maps bleiben dahinter in ihrer bisherigen Reihenfolge.
    ordered = wanted + [row["id"] for row in rows if row["id"] not in wanted]
    now = now_utc().isoformat()
    for index, map_id in enumerate(ordered, start=1):
        await db.game_maps.update_one({"id": map_id},
                                      {"$set": {"order": index, "updated_at": now, "updated_by": user["id"]}})
    return [public_map(row) for row in await maps_of(db, game["id"])]


async def delete(db, game: dict, current: dict) -> None:
    used = (await usage_counts(db, game["id"])).get(current["id"], 0)
    if used:
        raise MapProblem("Diese Map steht in einem gespeicherten Map-Pool - bitte archivieren statt löschen.", 409)
    await db.game_maps.delete_one({"id": current["id"]})
