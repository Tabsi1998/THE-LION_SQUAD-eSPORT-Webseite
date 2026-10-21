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
import time
import unicodedata
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
    """Schreibweisen ohne Leerraum am Rand, jede einmal (ohne Groß/klein), ohne den Namen selbst. Zu lang oder zu
    viele: ``MapProblem`` (422) - gekürzt wird nie still."""
    out: list[str] = []
    seen = {_text(name).casefold()} if name else set()
    for value in values or []:
        text = _text(value)
        if len(text) > NAME_MAX:
            raise MapProblem(f"Eine weitere Schreibweise hat höchstens {NAME_MAX} Zeichen: „{text[:30]}…“.")
        if text and text.casefold() not in seen:
            seen.add(text.casefold())
            out.append(text)
    if len(out) > ALIASES_MAX:
        raise MapProblem(f"Höchstens {ALIASES_MAX} weitere Schreibweisen je Map.")
    return out


def loose_key(value) -> str:
    """Schlüssel wie im Ergebnisblatt (``teamKey``): ohne Akzente, klein, nur Buchstaben und Ziffern - „Nebel-Werk“,
    „nebel werk“ und „nebelwerk“ sind gleich."""
    text = unicodedata.normalize("NFKD", _text(value))
    return "".join(char.lower() for char in text if not unicodedata.combining(char) and char.isalnum())


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


def _spelling_taken(text: str, owner: str) -> MapProblem:
    return MapProblem(f"„{text}“ führt schon zur Map „{owner}“ - jede Schreibweise nur einmal je Spiel.", 409)


def spelling_keys(name, slug, aliases) -> dict[str, str]:
    """Die Schlüssel (``loose_key``) von Name, Slug und weiteren Schreibweisen einer Map - je Schlüssel der erste
    Text."""
    out: dict[str, str] = {}
    for text in (name, slug, *(aliases or [])):
        key = loose_key(text)
        if key:
            out.setdefault(key, str(text))
    return out


async def _check_unique(db, game_id: str, *, name: str | None = None, slug: str | None = None,
                        spellings: list | None = None, current_id: str | None = None) -> None:
    """Freundliche Prüfung vorab: Name und Slug wörtlich, dazu ``spellings`` (Name, Slug, Schreibweisen) gegen Name,
    Slug und Schreibweisen der anderen Maps, so wie das Ergebnisblatt zuordnet (``loose_key``). Verbindlich und atomar
    entscheidet danach ``reserve_keys`` über den eindeutigen Index."""
    others = [row for row in await db.game_maps.find(
        {"game_id": game_id}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "aliases": 1})
        .to_list(MAPS_PER_GAME_MAX + 50) if row.get("id") != current_id]
    if name is not None and any(name_key(row.get("name")) == name_key(name) for row in others):
        raise MapProblem(f"Die Map „{name}“ gibt es in diesem Spiel schon.", 409)
    if slug is not None and any(row.get("slug") == slug for row in others):
        raise MapProblem(SLUG_TAKEN.format(slug=slug), 409)
    taken: dict[str, str] = {}
    for row in others:
        for key in spelling_keys(row.get("name"), row.get("slug"), row.get("aliases")):
            taken.setdefault(key, row.get("name") or "")
    for text in spellings or []:
        owner = taken.get(loose_key(text))
        if owner:
            raise _spelling_taken(str(text), owner)


async def release_keys(db, game_id: str, map_id: str, *, keep=None, only=None) -> None:
    """Schlüssel einer Map freigeben - alle, alle außer ``keep`` oder nur ``only``."""
    query: dict = {"game_id": game_id, "map_id": map_id}
    if keep is not None:
        query["key"] = {"$nin": sorted(keep)}
    if only is not None:
        query["key"] = {"$in": sorted(only)}
    await db.game_map_keys.delete_many(query)


TAKE_ATTEMPTS = 3
# So lange gilt ein frisch belegter Schlüssel als in Arbeit (die Map wird gerade angelegt oder umbenannt), auch wenn
# ihn noch keine Map führt - erst danach darf ihn eine andere Map als verwaist übernehmen.
KEY_FRESH_SECONDS = 120


async def _take_key(db, game_id: str, map_id: str, key: str) -> str | None:
    """Einen Schlüssel für ``map_id`` belegen. ``None``: belegt. Sonst der Name der Map, die ihn führt.

    Selbstheilend (dritte Runde #1616): gehört der Schlüssel einer Map, die es nicht mehr gibt oder die ihn nicht mehr
    führt (Name, Slug, Schreibweise) - etwa nach einem Abbruch beim Löschen, Umbenennen oder Freigeben -, wird er
    übernommen, sobald er nicht mehr frisch ist (``KEY_FRESH_SECONDS``). Das Übernehmen ist ein bedingtes Umschreiben
    auf genau den alten, nicht mehr frischen Eintrag, das Neuanlegen geht über den eindeutigen Index; ändert sich
    dazwischen etwas, wird neu geprüft."""
    for _attempt in range(TAKE_ATTEMPTS):
        now = time.time()
        other = await db.game_map_keys.find_one({"game_id": game_id, "key": key}, {"_id": 0, "map_id": 1, "at": 1})
        if not other:
            try:
                await db.game_map_keys.insert_one({"game_id": game_id, "key": key, "map_id": map_id, "at": now})
                return None
            except DuplicateKeyError:
                continue
        owner = await db.game_maps.find_one({"id": other.get("map_id"), "game_id": game_id},
                                            {"_id": 0, "name": 1, "slug": 1, "aliases": 1})
        if owner and key in spelling_keys(owner.get("name"), owner.get("slug"), owner.get("aliases")):
            return owner.get("name") or "einer anderen Map"
        stale = now - KEY_FRESH_SECONDS
        if (other.get("at") or 0) > stale:
            return (owner or {}).get("name") or "einer anderen Map"
        taken = await db.game_map_keys.find_one_and_update(
            {"game_id": game_id, "key": key, "map_id": other.get("map_id"),
             "$or": [{"at": {"$exists": False}}, {"at": {"$lte": stale}}]},
            {"$set": {"map_id": map_id, "at": now}})
        if taken:
            return None
    return "einer anderen Map"


async def reserve_keys(db, game_id: str, map_id: str, spellings: dict[str, str]) -> list[str]:
    """Die Schlüssel (``spelling_keys``) einer Map belegen - atomar über den eindeutigen Index (game_id, key) in
    ``game_map_keys``: zwei gleichzeitige Anfragen bekommen dieselbe Schreibweise nie beide. Führt eine andere Map einen
    Schlüssel: ``MapProblem`` 409; verwaiste Schlüssel werden übernommen (``_take_key``). Die schon eigenen werden
    zuerst aufgefrischt, damit sie keiner übernimmt, solange diese Map sie gerade (wieder) bekommt. Scheitert der Aufruf
    - aus welchem Grund auch immer -, wird zurückgenommen, was er belegt hat. Liefert die neu belegten Schlüssel."""
    mine = {"game_id": game_id, "map_id": map_id}
    await db.game_map_keys.update_many({**mine, "key": {"$in": sorted(spellings)}}, {"$set": {"at": time.time()}})
    owned = {row["key"] async for row in db.game_map_keys.find(mine, {"_id": 0, "key": 1})}
    added: list[str] = []
    done = False
    try:
        for key in sorted(set(spellings) - owned):
            owner = await _take_key(db, game_id, map_id, key)
            if owner:
                raise _spelling_taken(spellings[key], owner)
            added.append(key)
        done = True
        return added
    finally:
        if not done and added:
            await release_keys(db, game_id, map_id, only=added)


async def create(db, game: dict, body: GameMapCreate, user: dict, new_id: str) -> dict:
    count = await db.game_maps.count_documents({"game_id": game["id"]})
    if count >= MAPS_PER_GAME_MAX:
        raise MapProblem(f"Höchstens {MAPS_PER_GAME_MAX} Maps je Spiel - archivierte zählen mit.")
    slug = slugify(body.slug or body.name, fallback="map", max_length=SLUG_MAX)
    aliases = clean_aliases(body.aliases, body.name)
    image, modes = clean_image(body.image_url), clean_modes(game, body.modes)
    await _check_unique(db, game["id"], name=body.name, slug=slug, spellings=[body.name, slug, *aliases])
    last = await db.game_maps.find_one({"game_id": game["id"]}, {"_id": 0, "order": 1}, sort=[("order", -1)])
    now = now_utc().isoformat()
    doc = {
        "id": new_id, "game_id": game["id"], "slug": slug, "name": body.name,
        "aliases": aliases, "image_url": image, "note": body.note, "external_ref": body.external_ref, "modes": modes,
        "order": int((last or {}).get("order") or 0) + 1, "status": "active", "archived_at": None,
        "created_at": now, "created_by": user["id"], "updated_at": now, "updated_by": user["id"],
    }
    # Erst die Schreibweisen belegen (atomar), dann die Map anlegen - scheitert das, werden sie wieder frei.
    added = await reserve_keys(db, game["id"], new_id, spelling_keys(body.name, slug, aliases))
    try:
        await db.game_maps.insert_one(dict(doc))
    except DuplicateKeyError:
        # Gleichzeitig angelegt: der eindeutige Index (game_id, slug) aus database.py entscheidet - 409, nie 500.
        await release_keys(db, game["id"], new_id, only=added)
        raise MapProblem(SLUG_TAKEN.format(slug=slug), 409) from None
    except Exception:
        await release_keys(db, game["id"], new_id, only=added)
        raise
    return public_map(doc)


async def update(db, game: dict, current: dict, body: GameMapUpdate, user: dict) -> dict:
    raw = body.model_dump(exclude_unset=True)
    updates: dict = {}
    if raw.get("name") is not None and raw["name"] != current.get("name"):
        updates["name"] = raw["name"]
    if raw.get("slug"):
        slug = slugify(raw["slug"], fallback="map", max_length=SLUG_MAX)
        if slug != current.get("slug"):
            updates["slug"] = slug
    if "image_url" in raw:
        updates["image_url"] = clean_image(raw["image_url"])
        old = current.get("image_url")
        if old and old != updates["image_url"]:
            # Frühere Bilder bleiben verwendet (Mediathek): gespeicherte Spiele zeigen die Map wie damals.
            updates["image_history"] = list(dict.fromkeys([*(current.get("image_history") or []), old]))
    for key in ("note", "external_ref"):
        if key in raw:
            updates[key] = raw[key]
    if raw.get("modes") is not None:
        updates["modes"] = clean_modes(game, raw["modes"])
    if raw.get("aliases") is not None:
        updates["aliases"] = clean_aliases(raw["aliases"], updates.get("name") or current.get("name"))
    # Name, Slug und Schreibweisen nach der Änderung: dieselbe Prüfung wie beim Anlegen - auch beim Umbenennen und bei
    # einem neuen Slug (Nachprüfung #1616) -, dann atomar belegen.
    name = updates.get("name", current.get("name"))
    slug_now = updates.get("slug", current.get("slug"))
    aliases = updates.get("aliases", current.get("aliases") or [])
    await _check_unique(db, game["id"], name=updates.get("name"), slug=updates.get("slug"),
                        spellings=[name, slug_now, *aliases], current_id=current["id"])
    spellings = spelling_keys(name, slug_now, aliases)
    added = await reserve_keys(db, game["id"], current["id"], spellings)
    status = raw.get("status")
    if status and status != current.get("status"):
        updates["status"] = status
        updates["archived_at"] = now_utc().isoformat() if status == "archived" else None
    updates.update({"updated_at": now_utc().isoformat(), "updated_by": user["id"]})
    try:
        await db.game_maps.update_one({"id": current["id"]}, {"$set": updates})
    except DuplicateKeyError:
        await release_keys(db, game["id"], current["id"], only=added)
        raise MapProblem(SLUG_TAKEN.format(slug=updates.get("slug") or current.get("slug")), 409) from None
    except Exception:
        await release_keys(db, game["id"], current["id"], only=added)
        raise
    await release_keys(db, game["id"], current["id"], keep=set(spellings))
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


async def in_results(db, map_id: str) -> bool:
    """Steht die Map in einem gespeicherten Ergebnisblatt der Team-Liga (Blatt, Entwurf daneben oder alter Stand)?
    Über die Indizes aus database.py - nur beim Löschen gefragt."""
    query = {"$or": [{"matches.maps.map_id": map_id}, {"pending_draft.matches.maps.map_id": map_id}]}
    if await db.reference_round_results.find_one(query, {"_id": 1}):
        return True
    return bool(await db.reference_round_result_revisions.find_one({"content.matches.maps.map_id": map_id}, {"_id": 1}))


async def delete(db, game: dict, current: dict) -> None:
    used = (await usage_counts(db, game["id"])).get(current["id"], 0)
    if used:
        raise MapProblem("Diese Map steht in einem gespeicherten Map-Pool - bitte archivieren statt löschen.", 409)
    if await in_results(db, current["id"]):
        raise MapProblem("Diese Map steht in einem gespeicherten Spiel - bitte archivieren statt löschen.", 409)
    await db.game_maps.delete_one({"id": current["id"]})
    await release_keys(db, game["id"], current["id"])
