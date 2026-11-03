"""Ausrüstungs-Bibliothek je Spiel (docs/LIGA.md, C.4 #2218) - nach dem Muster der Maps (``services/game_maps.py``).

**Kategorien** stehen je Spiel in ``game_equipment_categories`` (eine Zeile je Spiel): Kennung (ändert sich nie), Name und Rolle.
Die Rolle ist das Einzige, was der Code kennt: ``weapon`` kann Aufsätze haben, ``attachment`` passt zu Waffen, ``item`` ist die übrige
Ausrüstung. Welche Kategorien ein Spiel hat, stellt die Verwaltung ein - kein Wert eines Titels steht hier.

**Einträge** (``game_equipment``) gehören genau einem Spiel und einer Kategorie: Name (je Kategorie einmal), Bild nur aus dem eigenen
Upload, Notiz, Zustand wie bei Maps (aktiv, inaktiv, archiviert) und bei Aufsätzen die Waffen, zu denen sie passen (leer: zu jeder).
Was eine Season sperrt, steht als Snapshot in ``loadout_bans`` (``services/loadout_bans.py``): Umbenennen, neues Bild oder Archivieren
ändert keine gespeicherte Version. Gelöscht wird nur, was in keiner Version steht.
"""
from __future__ import annotations

import unicodedata
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from models import now_utc
from services import game_maps, uploads_inventory
from services.permissions import ADMIN_MEDIA_ROLES, is_confirmed_admin_role
from services.slug_utils import slugify

# Grenzen gegen unkontrollierte Datenmengen - keine feste Zahl eines Spiels.
ITEMS_PER_GAME_MAX = 1000
CATEGORIES_MAX = 20
NAME_MAX = 80
LABEL_MAX = 40
KEY_MAX = 40
NOTE_MAX = 500
WEAPON, ATTACHMENT, ITEM = "weapon", "attachment", "item"
ROLES = (WEAPON, ATTACHMENT, ITEM)
ROLE_WORDS = {WEAPON: "Waffe", ATTACHMENT: "Aufsatz", ITEM: "Ausrüstung"}
ACTIVE, INACTIVE, ARCHIVED = game_maps.ACTIVE, game_maps.INACTIVE, game_maps.ARCHIVED
STATUS_WORDS = game_maps.STATUS_WORDS
# Vorschlag für ein Spiel ohne Kategorien - nur Gattungsbegriffe, gespeichert erst auf Knopfdruck.
SUGGESTED_CATEGORIES = (
    {"label": "Waffen", "role": WEAPON},
    {"label": "Aufsätze", "role": ATTACHMENT},
    {"label": "Perks", "role": ITEM},
    {"label": "Ausrüstung", "role": ITEM},
    {"label": "Abschussserien", "role": ITEM},
)
PUBLIC_FIELDS = ("id", "game_id", "category", "name", "image_url", "note", "weapon_ids", "status", "archived_at",
                 "created_at", "created_by", "updated_at", "updated_by")


class EquipmentProblem(ValueError):
    """Eine Eingabe, die nicht passt - die Route macht daraus 422 bzw. 409 (``status``)."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


def _text(value) -> str:
    return " ".join(str(value or "").split())


def name_key(value) -> str:
    """Gleich ist, was ohne Groß und klein und mit zusammengefasstem Leerraum gleich ist."""
    return unicodedata.normalize("NFKC", _text(value)).casefold()


def status_of(row: dict | None) -> str:
    value = (row or {}).get("status")
    return value if value in (INACTIVE, ARCHIVED) else ACTIVE


# ---------------------------------------------------------------- Eingaben

class CategoryIn(BaseModel):
    key: Optional[str] = Field(default=None, max_length=KEY_MAX)
    label: str = Field(min_length=1, max_length=LABEL_MAX)
    role: Literal["weapon", "attachment", "item"]

    @field_validator("label", mode="before")
    @classmethod
    def _label(cls, value):
        return _text(value)


class CategoriesSave(BaseModel):
    categories: List[CategoryIn] = Field(default_factory=list, max_length=CATEGORIES_MAX * 2)


class EquipmentCreate(BaseModel):
    category: str = Field(min_length=1, max_length=KEY_MAX)
    name: str = Field(min_length=1, max_length=NAME_MAX)
    image_url: Optional[str] = Field(default=None, max_length=300)
    note: Optional[str] = Field(default=None, max_length=NOTE_MAX)
    weapon_ids: List[str] = Field(default_factory=list, max_length=ITEMS_PER_GAME_MAX)

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, value):
        return _text(value)

    @field_validator("note", mode="before")
    @classmethod
    def _note(cls, value):
        return _text(value) or None


class EquipmentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=NAME_MAX)
    image_url: Optional[str] = Field(default=None, max_length=300)
    note: Optional[str] = Field(default=None, max_length=NOTE_MAX)
    weapon_ids: Optional[List[str]] = Field(default=None, max_length=ITEMS_PER_GAME_MAX)
    status: Optional[Literal["active", "inactive", "archived"]] = None

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, value):
        return None if value is None else _text(value)

    @field_validator("note", mode="before")
    @classmethod
    def _note(cls, value):
        return _text(value) or None


class EquipmentImport(BaseModel):
    source_game_id: str = Field(min_length=1, max_length=80)
    item_ids: List[str] = Field(min_length=1, max_length=ITEMS_PER_GAME_MAX)


# ---------------------------------------------------------------- Kategorien

async def categories_of(db, game_id: str) -> list[dict]:
    """Die Kategorien eines Spiels in ihrer Reihenfolge, je ``{key, label, role}`` - leer, wenn noch keine gespeichert sind."""
    row = await db.game_equipment_categories.find_one({"game_id": game_id}, {"_id": 0, "categories": 1})
    out = []
    for item in (row or {}).get("categories") or []:
        if isinstance(item, dict) and item.get("key") and item.get("role") in ROLES:
            out.append({"key": item["key"], "label": item.get("label") or item["key"], "role": item["role"]})
    return out


def role_of(categories: list[dict], key: str | None) -> str | None:
    return next((row["role"] for row in categories if row["key"] == key), None)


def _new_key(label: str, taken: set[str]) -> str:
    base = slugify(label, fallback="kategorie", max_length=KEY_MAX - 3)
    key, number = base, 2
    while key in taken:
        key, number = f"{base}-{number}", number + 1
    return key


async def save_categories(db, game: dict, body: CategoriesSave, user: dict) -> list[dict]:
    """Die Kategorien eines Spiels neu setzen. Ohne Kennung bekommt ein Name, den es schon gibt, dessen Kennung; sonst ist es eine neue.
    Eine Kategorie mit Einträgen lässt sich nicht entfernen und ihre Rolle nicht ändern (409)."""
    current = await categories_of(db, game["id"])
    by_key = {row["key"]: row for row in current}
    by_label = {name_key(row["label"]): row["key"] for row in current}
    wanted: list[dict] = []
    used_keys: set[str] = set()
    labels: set[str] = set()
    for item in body.categories:
        label = _text(item.label)
        if not label:
            raise EquipmentProblem("Jede Kategorie braucht einen Namen.")
        if name_key(label) in labels:
            raise EquipmentProblem(f"Die Kategorie „{label}“ steht zweimal in der Liste.")
        labels.add(name_key(label))
        key = (item.key or "").strip() or None
        if key and key not in by_key:
            raise EquipmentProblem("Eine der Kategorien gibt es nicht mehr - bitte neu laden.", 409)
        if not key:
            adopted = by_label.get(name_key(label))
            key = adopted if adopted and adopted not in used_keys else None
        if key in used_keys:
            raise EquipmentProblem(f"Die Kategorie „{label}“ steht zweimal in der Liste.")
        if not key:
            key = _new_key(label, set(by_key) | used_keys)
        used_keys.add(key)
        wanted.append({"key": key, "label": label, "role": item.role})
    if len(wanted) > CATEGORIES_MAX:
        raise EquipmentProblem(f"Höchstens {CATEGORIES_MAX} Kategorien je Spiel.")
    counts = await category_counts(db, game["id"])
    for row in current:
        after = next((item for item in wanted if item["key"] == row["key"]), None)
        count = counts.get(row["key"], 0)
        if not after and count:
            raise EquipmentProblem(f"Die Kategorie „{row['label']}“ hat noch {_entries(count)} und lässt sich nicht entfernen. "
                                   "Archivierte zählen mit.", 409)
        if after and after["role"] != row["role"] and count:
            raise EquipmentProblem(f"Die Kategorie „{row['label']}“ hat schon Einträge - ihre Art lässt sich nicht mehr ändern.", 409)
    now = now_utc().isoformat()
    await db.game_equipment_categories.update_one(
        {"game_id": game["id"]},
        {"$set": {"categories": wanted, "updated_at": now, "updated_by": user["id"]}, "$setOnInsert": {"game_id": game["id"]}},
        upsert=True)
    return wanted


def _entries(count: int) -> str:
    return "1 Eintrag" if count == 1 else f"{count} Einträge"


async def category_counts(db, game_id: str) -> dict[str, int]:
    out: dict[str, int] = {}
    async for row in db.game_equipment.find({"game_id": game_id}, {"_id": 0, "category": 1}):
        out[row.get("category")] = out.get(row.get("category"), 0) + 1
    return out


# ---------------------------------------------------------------- Einträge lesen

def public_item(doc: dict) -> dict:
    return {**{key: doc.get(key) for key in PUBLIC_FIELDS}, "weapon_ids": list(doc.get("weapon_ids") or []),
            "status": status_of(doc)}


async def items_of(db, game_id: str, *, usable_only: bool = False, categories: list[dict] | None = None) -> list[dict]:
    """Die Einträge eines Spiels, sortiert nach Kategorie und Name. ``usable_only``: ohne archivierte (die Bibliothek des Editors)."""
    query: dict = {"game_id": game_id}
    if usable_only:
        query["status"] = {"$ne": ARCHIVED}
    rows = await db.game_equipment.find(query, {"_id": 0}).to_list(ITEMS_PER_GAME_MAX + 50)
    order = {row["key"]: index for index, row in enumerate(categories if categories is not None else await categories_of(db, game_id))}
    return sorted(rows, key=lambda row: (order.get(row.get("category"), len(order)), name_key(row.get("name"))))


async def usage_counts(db, game_id: str) -> dict[str, int]:
    """In wie vielen Versionen einer Sperrliste ein Eintrag steht - als Eintrag oder als Aufsatz an einer Waffe."""
    counts: dict[str, int] = {}
    async for doc in db.loadout_bans.find({"game_id": game_id}, {"_id": 0, "entries.item_id": 1, "entries.attachments.item_id": 1}):
        seen = set()
        for entry in doc.get("entries") or []:
            seen.add(entry.get("item_id"))
            seen.update(item.get("item_id") for item in entry.get("attachments") or [])
        for item_id in seen:
            if item_id:
                counts[item_id] = counts.get(item_id, 0) + 1
    return counts


# ---------------------------------------------------------------- Einträge schreiben

def _clean_image(value) -> str | None:
    try:
        return game_maps.clean_image(value)
    except game_maps.MapProblem as problem:
        raise EquipmentProblem(problem.message) from None


IMAGE_UNKNOWN = "Das Bild steht nicht in der Mediathek – bitte über „Hochladen“ oder die Mediathek wählen."
IMAGE_NOT_OWN = "Ohne Medienrechte gehen nur eigene hochgeladene Bilder – bitte über „Hochladen“ wählen."


def _file_of(url: str | None) -> str | None:
    return uploads_inventory.upload_filename(str(url or "")) if url else None


async def checked_image(db, value, user: dict | None, *, kept=()) -> str | None:
    """Das Bild eines Eintrags - dieselbe Prüfung wie im Regelwerk (#2230): eigener Upload mit Eintrag in der Mediathek, und ohne Medienrolle
    nur eigene (``media_scope: "user"``). ``kept``: Adressen, die der Eintrag schon trägt bzw. aus der Quelle mitbringt - für sie zählt nur
    der Eintrag in der Mediathek, nicht, wem er gehört."""
    image = _clean_image(value)
    name = _file_of(image)
    if not name:
        return image
    rows = await db.media_uploads.find({"$or": [{"filename": name}, {"raster_filename": name}]},
                                       {"_id": 0, "media_scope": 1, "owner_id": 1}).to_list(None)
    if not rows:
        raise EquipmentProblem(IMAGE_UNKNOWN)
    kept_names = {_file_of(url) for url in kept if url}
    if user is None or name in kept_names or is_confirmed_admin_role(user, ADMIN_MEDIA_ROLES):
        return image
    if not any(row.get("media_scope") == "user" and str(row.get("owner_id")) == str(user.get("id")) for row in rows):
        raise EquipmentProblem(IMAGE_NOT_OWN)
    return image


async def _clean_weapons(db, game: dict, categories: list[dict], role: str | None, ids: list[str] | None) -> list[str]:
    """Die Waffen eines Aufsatzes: jede einmal, nur Waffen dieses Spiels. Andere Arten tragen keine (422, wenn doch)."""
    wanted = list(dict.fromkeys(str(value or "").strip() for value in ids or [] if str(value or "").strip()))
    if role != ATTACHMENT:
        if wanted:
            raise EquipmentProblem("Nur Aufsätze werden Waffen zugeordnet.")
        return []
    if not wanted:
        return []
    weapon_keys = [row["key"] for row in categories if row["role"] == WEAPON]
    found = {row["id"] for row in await db.game_equipment.find(
        {"id": {"$in": wanted}, "game_id": game["id"], "category": {"$in": weapon_keys}}, {"_id": 0, "id": 1}).to_list(None)}
    if any(value not in found for value in wanted):
        raise EquipmentProblem("Eine der gewählten Waffen gehört nicht zu diesem Spiel.")
    return wanted


def _taken(name: str, label: str) -> EquipmentProblem:
    return EquipmentProblem(f"„{name}“ gibt es in {label} schon.", 409)


async def _check_name(db, game_id: str, category: dict, name: str, current_id: str | None = None) -> None:
    other = await db.game_equipment.find_one({"game_id": game_id, "category": category["key"], "name_key": name_key(name)},
                                             {"_id": 0, "id": 1})
    if other and other.get("id") != current_id:
        raise _taken(name, category["label"])


async def create(db, game: dict, body: EquipmentCreate, user: dict, new_id: str, *, categories: list[dict] | None = None,
                 kept=()) -> dict:
    """``kept``: Bilder, die der Eintrag aus einer Quelle mitbringt (Import) - sie brauchen nur ihren Eintrag in der Mediathek."""
    categories = categories if categories is not None else await categories_of(db, game["id"])
    category = next((row for row in categories if row["key"] == body.category), None)
    if not category:
        raise EquipmentProblem("Diese Kategorie gibt es in diesem Spiel nicht - bitte neu laden.")
    if await db.game_equipment.count_documents({"game_id": game["id"]}) >= ITEMS_PER_GAME_MAX:
        raise EquipmentProblem(f"Höchstens {ITEMS_PER_GAME_MAX} Einträge je Spiel - archivierte zählen mit.")
    image = await checked_image(db, body.image_url, user, kept=kept)
    weapons = await _clean_weapons(db, game, categories, category["role"], body.weapon_ids)
    await _check_name(db, game["id"], category, body.name)
    now = now_utc().isoformat()
    doc = {"id": new_id, "game_id": game["id"], "category": category["key"], "name": body.name, "name_key": name_key(body.name),
           "image_url": image, "note": body.note, "weapon_ids": weapons, "status": ACTIVE, "archived_at": None,
           "created_at": now, "created_by": user["id"], "updated_at": now, "updated_by": user["id"]}
    try:
        await db.game_equipment.insert_one(dict(doc))
    except DuplicateKeyError:
        # Gleichzeitig angelegt: der eindeutige Index (Spiel, Kategorie, Name) entscheidet - 409, nie 500.
        raise _taken(body.name, category["label"]) from None
    return public_item(doc)


async def update(db, game: dict, current: dict, body: EquipmentUpdate, user: dict) -> dict:
    raw = body.model_dump(exclude_unset=True)
    categories = await categories_of(db, game["id"])
    category = next((row for row in categories if row["key"] == current.get("category")),
                    {"key": current.get("category"), "label": "dieser Kategorie", "role": None})
    updates: dict = {}
    if raw.get("name") and raw["name"] != current.get("name"):
        await _check_name(db, game["id"], category, raw["name"], current["id"])
        updates.update({"name": raw["name"], "name_key": name_key(raw["name"])})
    if "image_url" in raw:
        updates["image_url"] = await checked_image(db, raw["image_url"], user,
                                                   kept=[current.get("image_url"), *(current.get("image_history") or [])])
        old = current.get("image_url")
        if old and old != updates["image_url"]:
            # Frühere Bilder bleiben verwendet (Mediathek): gespeicherte Sperrlisten zeigen den Eintrag wie damals.
            updates["image_history"] = list(dict.fromkeys([*(current.get("image_history") or []), old]))
    if "note" in raw:
        updates["note"] = raw["note"]
    if raw.get("weapon_ids") is not None:
        updates["weapon_ids"] = await _clean_weapons(db, game, categories, category.get("role"), raw["weapon_ids"])
    status = raw.get("status")
    if status and status != status_of(current):
        updates["status"] = status
        updates["archived_at"] = now_utc().isoformat() if status == ARCHIVED else None
    updates.update({"updated_at": now_utc().isoformat(), "updated_by": user["id"]})
    try:
        await db.game_equipment.update_one({"id": current["id"], "game_id": game["id"]}, {"$set": updates})
    except DuplicateKeyError:
        raise _taken(updates.get("name") or current.get("name") or "", category["label"]) from None
    return public_item({**current, **updates})


async def delete(db, game: dict, current: dict) -> None:
    """Nur, was in keiner Version einer Sperrliste steht - sonst archivieren. Eine Waffe fällt aus den Zuordnungen der Aufsätze."""
    if (await usage_counts(db, game["id"])).get(current["id"]):
        raise EquipmentProblem("Dieser Eintrag steht in einer gespeicherten Sperrliste - bitte archivieren statt löschen.", 409)
    await db.game_equipment.delete_one({"id": current["id"], "game_id": game["id"]})
    await db.game_equipment.update_many({"game_id": game["id"], "weapon_ids": current["id"]},
                                        {"$pull": {"weapon_ids": current["id"]}})


# ---------------------------------------------------------------- Aufsätze ohne Waffe (Obmann, 03.11.: ohne Zuordnung passt keiner)

def without_weapon(items: list[dict], categories: list[dict]) -> list[dict]:
    """Aktive und inaktive Aufsätze ohne zugeordnete Waffe - sie passen zu keiner Waffe; die Verwaltung weist darauf hin."""
    keys = {row["key"] for row in categories if row["role"] == ATTACHMENT}
    return [{"id": row["id"], "name": row.get("name")} for row in items
            if row.get("category") in keys and status_of(row) != ARCHIVED and not row.get("weapon_ids")]


async def assign_weapons(db, game: dict, weapon_ids: list[str], user: dict) -> int:
    """Sammelaktion wie „Maps ohne Modus“: Alle nicht archivierten Aufsätze ohne Waffe bekommen die gewählten Waffen - wie viele es waren."""
    categories = await categories_of(db, game["id"])
    weapons = await _clean_weapons(db, game, categories, ATTACHMENT, weapon_ids)
    if not weapons:
        raise EquipmentProblem("Bitte mindestens eine Waffe wählen.")
    ids = [row["id"] for row in without_weapon(await items_of(db, game["id"], categories=categories), categories)]
    if ids:
        await db.game_equipment.update_many({"id": {"$in": ids}, "game_id": game["id"]},
                                            {"$set": {"weapon_ids": weapons, "updated_at": now_utc().isoformat(), "updated_by": user["id"]}})
    return len(ids)


class EquipmentWeapons(BaseModel):
    weapon_ids: List[str] = Field(default_factory=list, max_length=ITEMS_PER_GAME_MAX)


# ---------------------------------------------------------------- Aus einer anderen Spielversion übernehmen

def _target_category(source_cat: dict | None, targets: list[dict]) -> dict | None:
    """Gleiche Kennung oder gleicher Name - die Rolle muss passen."""
    if not source_cat:
        return None
    for row in targets:
        if row["key"] == source_cat["key"] and row["role"] == source_cat["role"]:
            return row
    for row in targets:
        if name_key(row["label"]) == name_key(source_cat["label"]) and row["role"] == source_cat["role"]:
            return row
    return None


async def import_candidates(db, game: dict, source: dict) -> list[dict]:
    """Was sich aus ``source`` übernehmen lässt: die aktiven Einträge mit Kategorie und ``exists``, wenn das Ziel sie dort schon hat."""
    source_cats = await categories_of(db, source["id"])
    target_cats = await categories_of(db, game["id"])
    taken = {(row.get("category"), row.get("name_key")) for row in await db.game_equipment.find(
        {"game_id": game["id"]}, {"_id": 0, "category": 1, "name_key": 1}).to_list(None)}
    out = []
    for row in await items_of(db, source["id"], categories=source_cats):
        if status_of(row) != ACTIVE:
            continue
        source_cat = next((cat for cat in source_cats if cat["key"] == row.get("category")), None)
        target = _target_category(source_cat, target_cats)
        out.append({"id": row["id"], "name": row.get("name"), "image_url": row.get("image_url"),
                    "category_label": (source_cat or {}).get("label"), "role": (source_cat or {}).get("role"),
                    "exists": bool(target and (target["key"], name_key(row.get("name"))) in taken)})
    return out


async def import_items(db, game: dict, source: dict, item_ids: list[str], user: dict, make_id) -> dict:
    """Einträge aus einer anderen Spielversion als eigene dieses Spiels: fehlende Kategorien kommen mit Name und Rolle dazu, Aufsätze
    bekommen die Waffen gleichen Namens im Ziel, das Bild wird mitverwendet. Was nicht geht, steht mit Grund in ``skipped``."""
    wanted = set(item_ids)
    source_cats = await categories_of(db, source["id"])
    rows = [row for row in await items_of(db, source["id"], categories=source_cats)
            if row["id"] in wanted and status_of(row) == ACTIVE]
    target_cats = await categories_of(db, game["id"])
    missing = []
    for row in rows:
        source_cat = next((cat for cat in source_cats if cat["key"] == row.get("category")), None)
        if source_cat and not _target_category(source_cat, target_cats) and source_cat not in missing:
            missing.append(source_cat)
    if missing and len(target_cats) + len(missing) <= CATEGORIES_MAX:
        body = CategoriesSave(categories=[CategoryIn(**row) for row in target_cats] +
                              [CategoryIn(label=row["label"], role=row["role"]) for row in missing])
        target_cats = await save_categories(db, game, body, user)
    source_names = {row["id"]: row.get("name") for row in await db.game_equipment.find(
        {"game_id": source["id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    created: list[dict] = []
    skipped: list[dict] = []
    # Waffen zuerst: Aufsätze finden ihre Waffe dann schon im Ziel.
    ordered = sorted(rows, key=lambda row: role_of(source_cats, row.get("category")) == ATTACHMENT)
    for row in ordered:
        source_cat = next((cat for cat in source_cats if cat["key"] == row.get("category")), None)
        target = _target_category(source_cat, target_cats)
        if not target:
            skipped.append({"id": row["id"], "name": row.get("name"), "reason": "Für diese Kategorie ist kein Platz mehr."})
            continue
        weapons: list[str] = []
        if target["role"] == ATTACHMENT and row.get("weapon_ids"):
            names = {name_key(source_names.get(weapon_id)) for weapon_id in row["weapon_ids"] if source_names.get(weapon_id)}
            weapon_keys = [cat["key"] for cat in target_cats if cat["role"] == WEAPON]
            weapons = [found["id"] for found in await db.game_equipment.find(
                {"game_id": game["id"], "category": {"$in": weapon_keys}, "name_key": {"$in": sorted(names)}},
                {"_id": 0, "id": 1}).to_list(None)]
            # Ohne seine Waffen im Ziel kommt der Aufsatz ohne Zuordnung: Er passt dann zu keiner, die Bibliothek weist darauf hin.
        body = EquipmentCreate(category=target["key"], name=row.get("name"), image_url=row.get("image_url"), note=row.get("note"),
                               weapon_ids=weapons)
        try:
            # Das Bild der Quelle braucht seinen Eintrag in der Mediathek; wem es gehört, zählt nicht - es steht schon in der Bibliothek.
            created.append(await create(db, game, body, user, make_id(), categories=target_cats, kept=[row.get("image_url")]))
        except EquipmentProblem as problem:
            skipped.append({"id": row["id"], "name": row.get("name"), "reason": problem.message})
    return {"created": created, "skipped": skipped, "categories": target_cats}
