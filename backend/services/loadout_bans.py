"""Sperrlisten der Ausrüstung je Season (docs/LIGA.md, C.4 #2218) - nach dem Muster der Map-Pools (``services/map_pools.py``).

Alles ist erlaubt außer dem, was auf der Sperrliste steht. Eine Zeile sperrt einen Eintrag der Bibliothek (``kind: "item"``) oder - nur
bei Waffen - einzelne Aufsätze an einer sonst erlaubten Waffe (``kind: "attachments"``), je in allen Modi oder in den genannten.

**Snapshot und Versionen.** Jedes Speichern legt in ``loadout_bans`` eine neue, unveränderliche Version an, mit Namen und Bildern *von
damals*. Entfernen ist ebenfalls eine Version (``cleared``). Die Season ist die Vorlage (``league_season``), die Staffel trägt eine Kopie
(``tournament``), das Spiel hält beim ersten Festschreiben eines Ergebnisses seine Version fest (``matches_v2.loadout_ban_id``).

**Ganze Klasse** (#2287): ``kind: "class"`` sperrt eine Unterkategorie mit allen Einträgen, auch später angelegten. Die Version hält
Klasse und Einträge von damals fest (``items``); zur Laufzeit (Ligaseite, offene Spiele, Regelwerk-Baustein) gelten die Einträge, die
heute in der Klasse stehen (``class_members``). Ein neuer Eintrag ändert so den Baustein, und das Regelwerk meldet „muss freigegeben
werden“.

Das System prüft nicht, was im Spiel benutzt wird - Verstöße laufen über Protest und Strafe.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from models import GAME_MODES_MAX, new_id, now_utc
from services import game_equipment as library
from services import game_maps, game_modes
from services.game_equipment import ARCHIVED, ATTACHMENT, INACTIVE, WEAPON, EquipmentProblem
from services.markdown_text import text_cell

SEASON, TOURNAMENT = "league_season", "tournament"
SCOPES = (SEASON, TOURNAMENT)
ITEM, ATTACHMENTS, CLASS = "item", "attachments", "class"
KINDS = (ITEM, ATTACHMENTS, CLASS)
ENTRIES_MAX = 500
ATTACHMENTS_MAX = 200
ALL_MODES = "alle Modi"
CHANGED_MEANWHILE = "Die Sperrliste wurde inzwischen geändert - bitte neu laden."
EMPTY = "Bitte mindestens einen Eintrag sperren - oder die Sperrliste entfernen."
# Vermerk am Spiel: Kennung der Version oder ``None`` für „keine Liste“; fehlt das Feld, wurde nie gestempelt.
STAMP = "loadout_ban_id"
FINISHED = frozenset({"completed", "forfeit"})
SNAPSHOT_KEYS = ("item_id", "name", "category", "category_label", "role", "image_url", "subcategory", "subcategory_label",
                 "subcategory_icon_url")


class BanEntryIn(BaseModel):
    """Eine Zeile: ``item_id`` bei ``item`` und ``attachments``, ``subcategory`` bei ``class`` (#2287)."""
    item_id: Optional[str] = Field(default=None, max_length=64)
    subcategory: Optional[str] = Field(default=None, max_length=library.KEY_MAX)
    kind: Literal["item", "attachments", "class"] = ITEM
    modes: List[str] = Field(default_factory=list, max_length=GAME_MODES_MAX)
    attachment_ids: List[str] = Field(default_factory=list, max_length=ATTACHMENTS_MAX)
    # Modi je Aufsatz an der Waffe (#2299): Kennung des Aufsatzes → Modi; fehlt oder leer = die Modi der Zeile.
    attachment_modes: Dict[str, List[str]] = Field(default_factory=dict)

    @field_validator("attachment_modes")
    @classmethod
    def _attachment_modes_size(cls, value: dict) -> dict:
        if len(value) > ATTACHMENTS_MAX or any(len(key) > 64 or len(modes) > GAME_MODES_MAX for key, modes in value.items()):
            raise ValueError("Zu viele Angaben bei den Modi je Aufsatz.")
        return value


class LoadoutBansSave(BaseModel):
    """Ein neuer Stand. ``expected_version`` schützt vor gleichzeitigem Überschreiben (409) - 0 heißt „bisher keine Liste“."""
    entries: List[BanEntryIn] = Field(default_factory=list, max_length=ENTRIES_MAX)
    note: Optional[str] = Field(default=None, max_length=300)
    expected_version: Optional[int] = Field(default=None, ge=0)


# ---------------------------------------------------------------- Lesen

async def latest(db, scope: str, scope_id: str) -> dict | None:
    return await db.loadout_bans.find_one({"scope": scope, "scope_id": scope_id}, {"_id": 0}, sort=[("version", -1)])


async def current(db, scope: str, scope_id: str) -> dict | None:
    """Die geltende Liste: die neueste Version, wenn sie nicht „entfernt“ ist."""
    doc = await latest(db, scope, scope_id)
    return doc if doc and not doc.get("cleared") else None


def valid_for(doc: dict | None, game_id: str | None) -> dict | None:
    """Eine Liste gilt nur für das Spiel, für das sie gewählt wurde."""
    return doc if doc and game_id and doc.get("game_id") == game_id else None


def _small(items) -> list[dict]:
    return [{key: item.get(key) for key in ("item_id", "name", "image_url")} for item in items or []]


def _small_attachments(items) -> list[dict]:
    """Aufsätze an einer Waffe - eigene Modi (#2299) nur, wenn gesetzt."""
    out = []
    for item, small in zip(items or [], _small(items)):
        if item.get("modes") or item.get("mode_labels"):
            small.update(modes=list(item.get("modes") or []), mode_labels=list(item.get("mode_labels") or []))
        out.append(small)
    return out


def _entry_view(entry: dict) -> dict:
    out = {**{key: entry.get(key) for key in SNAPSHOT_KEYS}, "kind": entry.get("kind") or ITEM,
           "modes": list(entry.get("modes") or []), "mode_labels": list(entry.get("mode_labels") or []),
           "attachments": _small_attachments(entry.get("attachments"))}
    if out["kind"] == CLASS:
        out["items"] = _small(entry.get("items"))
    return out


def view(doc: dict | None, origin: str | None = None, *, admin: bool = False) -> dict | None:
    """Der Lesevertrag ``{id, version, origin, game_id, saved_at, entries[]}``; die Verwaltung bekommt ``saved_by`` und ``note``."""
    if not doc or doc.get("cleared"):
        return None
    out = {"id": doc.get("id"), "version": doc.get("version"), "origin": origin or doc.get("scope"), "game_id": doc.get("game_id"),
           "saved_at": doc.get("created_at"), "entries": [_entry_view(entry) for entry in doc.get("entries") or []]}
    if admin:
        out.update({"saved_by": doc.get("created_by"), "note": doc.get("note")})
    return out


async def outdated_item_ids(db, doc: dict | None) -> list[str]:
    """Einträge der Liste, die sich in der Bibliothek seither geändert haben (Name, Bild, archiviert, gelöscht) - die Verwaltung bietet
    dann an, neu zu speichern."""
    if not doc:
        return []
    snapshots = []
    tops = set()
    for entry in doc.get("entries") or []:
        # Eine ganze Klasse (#2287) zeigt ihre Einträge von heute - sie veraltet nicht.
        if (entry.get("kind") or ITEM) == CLASS:
            continue
        snapshots.append(entry)
        tops.add(id(entry))
        snapshots.extend(entry.get("attachments") or [])
    ids = sorted({item.get("item_id") for item in snapshots if item.get("item_id")})
    rows = {row["id"]: row for row in await db.game_equipment.find({"id": {"$in": ids}}, {"_id": 0}).to_list(None)}
    out: list[str] = []
    for item in snapshots:
        row = rows.get(item.get("item_id"))
        changed = (not row or library.status_of(row) == ARCHIVED or row.get("name") != item.get("name")
                   or row.get("image_url") != item.get("image_url"))
        # Neu zugeordnete Unterkategorie (#2287): Neu speichern übernimmt sie in Liste und Regelwerk.
        if row and id(item) in tops and (row.get("subcategory") or None) != (item.get("subcategory") or None):
            changed = True
        if changed and item.get("item_id") not in out:
            out.append(item.get("item_id"))
    return out


async def class_members(db, doc: dict | None) -> dict[str, list[dict]]:
    """Je ganz gesperrter Klasse die Einträge, die **heute** in ihr stehen (nicht archiviert), nach Namen - ``{}`` ohne Klassenzeile."""
    keys = sorted({entry.get("subcategory") for entry in (doc or {}).get("entries") or []
                   if entry.get("kind") == CLASS and entry.get("subcategory")})
    if not keys or not doc or doc.get("cleared"):
        return {}
    out: dict[str, list[dict]] = {key: [] for key in keys}
    rows = await db.game_equipment.find({"game_id": doc.get("game_id"), "subcategory": {"$in": keys}, "status": {"$ne": ARCHIVED}},
                                        {"_id": 0, "id": 1, "name": 1, "image_url": 1, "subcategory": 1}).to_list(None)
    for row in sorted(rows, key=lambda row: library.name_key(row.get("name"))):
        out[row["subcategory"]].append({"item_id": row["id"], "name": row.get("name"), "image_url": row.get("image_url")})
    return out


def _with_members(out: dict | None, members: dict[str, list[dict]]) -> dict | None:
    for entry in (out or {}).get("entries") or []:
        if entry.get("kind") == CLASS and entry.get("subcategory") in members:
            entry["items"] = [dict(item) for item in members[entry["subcategory"]]]
    return out


async def live_view(db, doc: dict | None, origin: str | None = None, *, admin: bool = False) -> dict | None:
    """Wie ``view``, nur dass eine ganz gesperrte Klasse die Einträge von heute nennt - „Klasse gesperrt“ heißt: alle, auch neue."""
    return _with_members(view(doc, origin, admin=admin), await class_members(db, doc))


async def admin_entry(db, doc: dict | None, game_id: str | None, origin: str) -> dict | None:
    if not doc or doc.get("cleared"):
        return None
    members = await class_members(db, doc)
    new_items = []
    for entry in doc.get("entries") or []:
        if entry.get("kind") != CLASS:
            continue
        held = {item.get("item_id") for item in entry.get("items") or []}
        names = [item["name"] for item in members.get(entry.get("subcategory"), []) if item["item_id"] not in held]
        if names:
            new_items.append({"subcategory": entry.get("subcategory"), "label": entry.get("subcategory_label"), "names": names})
    return {**_with_members(view(doc, origin, admin=True), members), "stale": doc.get("game_id") != game_id,
            "outdated_item_ids": await outdated_item_ids(db, doc), "class_new_items": new_items}


async def versions(db, scope: str, scope_id: str) -> list[dict]:
    rows = await db.loadout_bans.find({"scope": scope, "scope_id": scope_id}, {"_id": 0}).sort("version", -1).to_list(500)
    return [{"id": row.get("id"), "version": row.get("version"), "saved_at": row.get("created_at"), "saved_by": row.get("created_by"),
             "note": row.get("note"), "cleared": bool(row.get("cleared")), "entries": len(row.get("entries") or [])}
            for row in rows]


async def effective(db, tournament: dict | None, match: dict | None = None) -> dict | None:
    """Die Liste, die für ein Spiel gilt: die festgehaltene Version (auch „keine“, ``None``), sonst die der Staffel, sonst keine. Ein fertiges
    Spiel ohne Vermerk (vor C.4) zeigt keine Liste - die heutige galt damals nicht."""
    doc, held = await effective_doc(db, tournament, match)
    if held:
        # Festgehalten: auch eine ganze Klasse mit ihren Einträgen von damals (#2287).
        return view(doc, "match")
    return await live_view(db, doc, TOURNAMENT)


def knows_list(match: dict | None) -> bool:
    """Lässt sich für dieses Spiel sagen, welche Liste gilt? Nicht bei einem fertigen Spiel ohne Vermerk (vor C.4)."""
    match = match or {}
    return STAMP in match or match.get("status") not in FINISHED


async def effective_doc(db, tournament: dict | None, match: dict | None = None) -> tuple[dict | None, bool]:
    """Die Version, die für ein Spiel gilt (oder ``None``), und ob sie am Spiel festgehalten ist - dieselbe Regel wie ``effective``."""
    match = match or {}
    if STAMP in match:
        held = match.get(STAMP)
        doc = await db.loadout_bans.find_one({"id": held}, {"_id": 0}) if held else None
        return (doc if doc and not doc.get("cleared") else None), True
    if not knows_list(match) or not tournament:
        return None, False
    return valid_for(await current(db, TOURNAMENT, tournament["id"]), tournament.get("game_id")), False


# ---------------------------------------------------------------- Schreiben

def _kept(previous: dict | None, game: dict) -> tuple[set, set, set]:
    """Was die geltende Version derselben Liste schon hat: Modi, Zeilen (Art, Eintrag) und Aufsätze je Waffe - inaktiv bleibt dort erlaubt."""
    if not previous or previous.get("cleared") or previous.get("game_id") != game.get("id"):
        return set(), set(), set()
    modes, rows, attached = set(), set(), set()
    for entry in previous.get("entries") or []:
        modes.update(entry.get("modes") or [])
        rows.add((entry.get("kind") or ITEM, entry.get("item_id")))
        attached.update((entry.get("item_id"), item.get("item_id")) for item in entry.get("attachments") or [])
        for item in entry.get("attachments") or []:
            modes.update(item.get("modes") or [])
    return modes, rows, attached


def _status_problem(row: dict, allowed_inactive: bool) -> str | None:
    status = library.status_of(row)
    if status == ARCHIVED:
        return f"„{row.get('name')}“ ist archiviert und kommt auf keine neue Sperrliste."
    if status == INACTIVE and not allowed_inactive:
        return f"„{row.get('name')}“ ist inaktiv und kommt nicht neu auf die Sperrliste. In der Bibliothek lässt er sich wieder aktivieren."
    return None


def _clean_modes(game: dict, modes: list[str], kept_modes: set) -> tuple[list[str], list[str]]:
    known = game_maps.game_modes(game)
    keys = [row["mode"] for row in known]
    wanted = [str(mode or "").strip() for mode in modes if str(mode or "").strip()]
    unknown = [mode for mode in wanted if mode not in keys]
    if unknown:
        raise EquipmentProblem(f"Unbekannter Modus für {game.get('name') or 'dieses Spiel'}: {', '.join(unknown)}.")
    problem = game_modes.choice_problem(game, wanted, kept_modes)
    if problem:
        raise EquipmentProblem(problem)
    ordered = [mode for mode in keys if mode in wanted]
    labels = {row["mode"]: row["label"] for row in known}
    return ordered, [labels[mode] for mode in ordered]


def _sub_fields(row: dict, subs: dict) -> dict:
    """Unterkategorie eines Eintrags als Schnappschuss (#2287) - nur, wenn es sie in seiner Kategorie gibt."""
    found = subs.get(row.get("subcategory") or "")
    if not found or found[0]["key"] != row.get("category"):
        return {"subcategory": None, "subcategory_label": None, "subcategory_icon_url": None}
    return {"subcategory": found[1]["key"], "subcategory_label": found[1]["label"], "subcategory_icon_url": found[1].get("icon_url")}


async def _class_snapshot(db, game: dict, entry: BanEntryIn, subs: dict, kept_modes: set) -> dict:
    found = subs.get(str(entry.subcategory or "").strip())
    if not entry.subcategory or not found:
        raise EquipmentProblem("Eine Unterkategorie gehört nicht zu diesem Spiel - bitte neu laden.")
    category, sub, _index = found
    modes, labels = _clean_modes(game, entry.modes, kept_modes)
    rows = await db.game_equipment.find({"game_id": game["id"], "category": category["key"], "subcategory": sub["key"],
                                         "status": {"$ne": ARCHIVED}}, {"_id": 0, "id": 1, "name": 1, "image_url": 1}).to_list(None)
    items = [{"item_id": row["id"], "name": row.get("name"), "image_url": row.get("image_url")}
             for row in sorted(rows, key=lambda row: library.name_key(row.get("name")))]
    return {"kind": CLASS, "item_id": None, "name": sub["label"], "category": category["key"], "category_label": category["label"],
            "role": category["role"], "subcategory": sub["key"], "subcategory_label": sub["label"], "subcategory_icon_url": None,
            "image_url": sub.get("icon_url"), "modes": modes, "mode_labels": labels, "items": items, "attachments": []}


def _class_conflicts(out: list[dict], rows: dict) -> None:
    """Eine einzelne Zeile in einer Klasse, die in allen Modi ganz gesperrt ist, braucht es nicht (422) - auch keine Aufsätze an einer
    Waffe dieser Klasse und keinen Aufsatz, dessen Klasse ganz gesperrt ist."""
    full = {row["subcategory"]: row["subcategory_label"] for row in out if row["kind"] == CLASS and not row["modes"]}
    if not full:
        return
    for snapshot in out:
        if snapshot["kind"] == CLASS:
            continue
        if snapshot.get("subcategory") in full:
            label = full[snapshot["subcategory"]]
            raise EquipmentProblem(f"„{snapshot['name']}“ gehört zu „{label}“, die schon in allen Modi ganz gesperrt ist - "
                                   "einzeln braucht es das nicht.")
        for item in snapshot.get("attachments") or []:
            klass = (rows.get(item["item_id"]) or {}).get("subcategory")
            if klass in full:
                raise EquipmentProblem(f"Der Aufsatz „{item['name']}“ ist mit seiner Klasse „{full[klass]}“ schon in allen Modi gesperrt.")


async def _snapshot(db, game: dict, body: LoadoutBansSave, previous: dict | None) -> list[dict]:
    if not body.entries:
        raise EquipmentProblem(EMPTY)
    categories = await library.categories_of(db, game["id"])
    by_key = {row["key"]: row for row in categories}
    order = {row["key"]: index for index, row in enumerate(categories)}
    subs = library.subcategory_index(categories)
    ids = sorted({entry.item_id for entry in body.entries if entry.item_id}
                 | {item for entry in body.entries for item in entry.attachment_ids})
    rows = {row["id"]: row for row in await db.game_equipment.find({"id": {"$in": ids}, "game_id": game["id"]}, {"_id": 0}).to_list(None)}
    kept_modes, kept_rows, kept_attached = _kept(previous, game)
    seen: set = set()
    out: list[dict] = []
    for entry in body.entries:
        if entry.kind == CLASS:
            snapshot = await _class_snapshot(db, game, entry, subs, kept_modes)
            if (CLASS, snapshot["subcategory"]) in seen:
                raise EquipmentProblem(f"Die Klasse „{snapshot['name']}“ steht zweimal auf der Sperrliste.")
            seen.add((CLASS, snapshot["subcategory"]))
            out.append(snapshot)
            continue
        row = rows.get(entry.item_id or "")
        category = by_key.get((row or {}).get("category"))
        if not row or not category:
            raise EquipmentProblem("Ein Eintrag gehört nicht zu diesem Spiel - bitte neu laden.")
        if (entry.kind, entry.item_id) in seen:
            raise EquipmentProblem(f"„{row.get('name')}“ steht zweimal auf der Sperrliste.")
        seen.add((entry.kind, entry.item_id))
        problem = _status_problem(row, (entry.kind, entry.item_id) in kept_rows)
        if problem:
            raise EquipmentProblem(problem)
        modes, labels = _clean_modes(game, entry.modes, kept_modes)
        snapshot = {"kind": entry.kind, "item_id": row["id"], "name": row.get("name"), "category": category["key"],
                    "category_label": category["label"], "role": category["role"], "image_url": row.get("image_url"),
                    **_sub_fields(row, subs), "modes": modes, "mode_labels": labels, "attachments": []}
        if entry.kind == ATTACHMENTS:
            snapshot["attachments"] = _attachments(row, category, entry, rows, by_key, kept_attached)
            _attachment_modes(game, entry, snapshot["attachments"], kept_modes)
        elif entry.attachment_ids or entry.attachment_modes:
            raise EquipmentProblem(f"„{row.get('name')}“: Aufsätze lassen sich nur an einer Waffe einzeln sperren.")
        out.append(snapshot)
    for snapshot in out:
        if snapshot["kind"] == ATTACHMENTS and any(other["kind"] == ITEM and other["item_id"] == snapshot["item_id"] and not other["modes"]
                                                   for other in out):
            raise EquipmentProblem(f"„{snapshot['name']}“ ist schon in allen Modi gesperrt - einzelne Aufsätze dazu braucht es nicht.")
    _class_conflicts(out, rows)

    def sort_key(row: dict) -> tuple:
        # Eingesehen wird in der Reihenfolge der Bibliothek: Kategorie, darin erst ohne Unterkategorie, dann die Unterkategorien, je
        # Klasse zuerst die ganze Klasse; Aufsätze an Waffen zuletzt.
        found = subs.get(row.get("subcategory") or "")
        return (1 if row["kind"] == ATTACHMENTS else 0, order.get(row["category"], len(order)), found[2] if found else -1,
                0 if row["kind"] == CLASS else 1, library.name_key(row["name"]))

    return sorted(out, key=sort_key)


def _attachments(weapon: dict, category: dict, entry: BanEntryIn, rows: dict, by_key: dict, kept_attached: set) -> list[dict]:
    if category["role"] != WEAPON:
        raise EquipmentProblem(f"„{weapon.get('name')}“ ist keine Waffe - Aufsätze lassen sich nur an Waffen einzeln sperren.")
    wanted = list(dict.fromkeys(entry.attachment_ids))
    if not wanted:
        raise EquipmentProblem(f"Bitte für „{weapon.get('name')}“ mindestens einen Aufsatz wählen.")
    out = []
    for item_id in wanted:
        item = rows.get(item_id)
        if not item or (by_key.get(item.get("category")) or {}).get("role") != ATTACHMENT:
            raise EquipmentProblem(f"Bei „{weapon.get('name')}“ steht etwas, das kein Aufsatz dieses Spiels ist.")
        # Ein Aufsatz passt nur zu den Waffen und Waffenklassen (#2287), denen er zugeordnet ist - ohne Zuordnung zu keiner
        # (Obmann, 03.11.).
        if not item.get("weapon_ids") and not item.get("weapon_class_ids"):
            raise EquipmentProblem(f"Der Aufsatz „{item.get('name')}“ ist keiner Waffe zugeordnet – bitte in der Bibliothek erst die Waffen wählen.")
        if not library.fits(item, weapon):
            raise EquipmentProblem(f"Der Aufsatz „{item.get('name')}“ passt nicht zu „{weapon.get('name')}“.")
        problem = _status_problem(item, (weapon["id"], item_id) in kept_attached)
        if problem:
            raise EquipmentProblem(problem)
        out.append({"item_id": item["id"], "name": item.get("name"), "image_url": item.get("image_url")})
    return sorted(out, key=lambda row: library.name_key(row["name"]))


def _attachment_modes(game: dict, entry: BanEntryIn, snapshots: list[dict], kept_modes: set) -> None:
    """Modi je Aufsatz (#2299) an den Schnappschuss - nur für Aufsätze der Zeile und nur, wenn welche gewählt sind."""
    chosen = {snapshot["item_id"] for snapshot in snapshots}
    if any(key not in chosen for key in entry.attachment_modes):
        raise EquipmentProblem("Modi stehen bei einem Aufsatz, der an dieser Waffe nicht gesperrt ist - bitte neu laden.")
    for snapshot in snapshots:
        wanted = entry.attachment_modes.get(snapshot["item_id"]) or []
        if wanted:
            modes, labels = _clean_modes(game, wanted, kept_modes)
            if modes:
                snapshot.update(modes=modes, mode_labels=labels)


def _current_version(previous: dict | None) -> int:
    return int(previous.get("version") or 0) if previous and not previous.get("cleared") else 0


async def _write(db, *, previous: dict | None, scope: str, scope_id: str, game_id: str | None, user: dict, entries: list[dict],
                 cleared: bool, note: str | None, tournament_id: str | None) -> dict:
    """Die nächste Version nach ``previous`` - der eindeutige Index (scope, scope_id, version) macht gleichzeitiges Speichern zu 409."""
    doc = {"id": new_id(), "scope": scope, "scope_id": scope_id, "tournament_id": tournament_id, "game_id": game_id,
           "version": int((previous or {}).get("version") or 0) + 1, "cleared": cleared, "entries": entries,
           "note": " ".join(str(note or "").split()) or None, "created_at": now_utc().isoformat(), "created_by": user["id"]}
    try:
        await db.loadout_bans.insert_one(dict(doc))
    except DuplicateKeyError:
        raise EquipmentProblem(CHANGED_MEANWHILE, 409) from None
    return doc


async def save(db, *, scope: str, scope_id: str, game: dict | None, body: LoadoutBansSave, user: dict,
               tournament_id: str | None = None) -> dict:
    if not game:
        raise EquipmentProblem("Ohne Spiel gibt es keine Sperrliste - erst ein Spiel wählen.")
    previous = await latest(db, scope, scope_id)
    if body.expected_version is not None and _current_version(previous) != body.expected_version:
        raise EquipmentProblem(CHANGED_MEANWHILE, 409)
    entries = await _snapshot(db, game, body, previous)
    return await _write(db, previous=previous, scope=scope, scope_id=scope_id, game_id=game["id"], user=user, entries=entries,
                        cleared=False, note=body.note, tournament_id=tournament_id)


async def copy_version(db, source: dict, *, scope: str, scope_id: str, user: dict, tournament_id: str | None = None,
                       note: str | None = None) -> dict:
    """Eine vorhandene Version als neue Version einer anderen Liste - genau dieselben Zeilen samt Namen und Bildern von damals."""
    previous = await latest(db, scope, scope_id)
    entries = [{**entry, "modes": list(entry.get("modes") or []), "mode_labels": list(entry.get("mode_labels") or []),
                "attachments": [dict(item) for item in entry.get("attachments") or []]} for entry in source.get("entries") or []]
    return await _write(db, previous=previous, scope=scope, scope_id=scope_id, game_id=source.get("game_id"), user=user,
                        entries=entries, cleared=False, note=note, tournament_id=tournament_id)


async def clear(db, *, scope: str, scope_id: str, user: dict, tournament_id: str | None = None) -> dict | None:
    previous = await latest(db, scope, scope_id)
    if not _current_version(previous):
        return None
    return await _write(db, previous=previous, scope=scope, scope_id=scope_id, game_id=(previous or {}).get("game_id"), user=user,
                        entries=[], cleared=True, note=None, tournament_id=tournament_id)


# ---------------------------------------------------------------- Vergleich

def _row_key(entry: dict) -> tuple:
    """Eine Zeile ist ihr Eintrag je Art - eine ganze Klasse (#2287) ist ihre Unterkategorie."""
    kind = entry.get("kind") or ITEM
    return (kind, entry.get("subcategory") if kind == CLASS else entry.get("item_id"))


def _rows(doc: dict | None) -> dict:
    if not doc or doc.get("cleared"):
        return {}
    return {_row_key(entry): entry for entry in doc.get("entries") or []}


def _attachment_name(item: dict) -> str:
    """Name eines Aufsatzes im Vergleich - mit eigenen Modi (#2299) in Klammern."""
    labels = item.get("mode_labels") or []
    return f"{item.get('name')} (in {', '.join(labels)})" if labels else item.get("name")


def _short(entry: dict) -> dict:
    return {"kind": entry.get("kind") or ITEM, "item_id": entry.get("item_id"), "subcategory": entry.get("subcategory"),
            "name": entry.get("name"), "category_label": entry.get("category_label"), "subcategory_label": entry.get("subcategory_label"),
            "modes": list(entry.get("mode_labels") or []) or [ALL_MODES],
            "attachments": [_attachment_name(item) for item in entry.get("attachments") or []]}


def _effective_attachments(entry: dict) -> list:
    """Je Aufsatz die Modi, die gelten (#2299: eigene, sonst die der Zeile) - so zählt nur die Wirkung, nicht die Schreibweise."""
    row = list(entry.get("modes") or [])
    return sorted((item.get("item_id"), tuple(sorted(item.get("modes") or row))) for item in entry.get("attachments") or [])


def _same(old: dict, new: dict) -> bool:
    if (new.get("kind") or ITEM) == ATTACHMENTS:
        return _effective_attachments(old) == _effective_attachments(new)
    return sorted(old.get("modes") or []) == sorted(new.get("modes") or [])


def compare(base: dict | None, target: dict | None) -> dict:
    """Zwei Versionen gegenübergestellt: hinzu, weg, geändert (andere Modi oder Aufsätze). Die Reihenfolge zählt nicht."""
    old, new = _rows(base), _rows(target)
    added = [_short(entry) for key, entry in new.items() if key not in old]
    removed = [_short(entry) for key, entry in old.items() if key not in new]
    changed = [{**_short(entry), "before": _short(old[key])} for key, entry in new.items() if key in old and not _same(old[key], entry)]

    def head(doc: dict | None) -> dict | None:
        return {"id": doc.get("id"), "version": doc.get("version"), "saved_at": doc.get("created_at"),
                "cleared": bool(doc.get("cleared"))} if doc else None

    return {"base": head(base), "target": head(target), "added": added, "removed": removed, "changed": changed,
            "same": not (added or removed or changed)}


# ---------------------------------------------------------------- Season → Staffel → Spiel

async def copy_to_staffel(db, season: dict, tournament: dict, user: dict) -> None:
    """Beim Anlegen einer Staffel: die geltende Liste der Season als eigene Version (unter der Pool-Sperre der Season)."""
    doc = valid_for(await current(db, SEASON, season["id"]), tournament.get("game_id"))
    if doc:
        await copy_version(db, doc, scope=TOURNAMENT, scope_id=tournament["id"], user=user, tournament_id=tournament["id"],
                           note=f"Aus {season.get('name')} übernommen")


def _rows_key(doc: dict | None) -> list:
    """Was eine Liste sperrt - Aufsätze an einer Waffe mit ihren geltenden Modi (#2299)."""
    return sorted((key[0], key[1], () if key[0] == ATTACHMENTS else tuple(sorted(entry.get("modes") or [])),
                   tuple(_effective_attachments(entry)))
                  for key, entry in _rows(doc).items())


SYNC_LABEL = "Sperrliste"


async def sync_staffel(db, tournament: dict, season: dict, user: dict, *, locked: bool, has_result: bool, applied: list,
                       skipped: list, changed: list) -> None:
    """Liste der Season → Staffel, wie beim Map-Pool: Eine neue Liste geht immer (Spiele mit festgehaltener Version behalten ihre). Hat die
    Season keine mehr, fällt die Kopie der Staffel nur vor dem ersten Ergebnis und nicht gesperrt weg."""
    group = "loadout_bans"
    source = await current(db, SEASON, season["id"])
    own = await current(db, TOURNAMENT, tournament["id"])
    if source and source.get("game_id") == tournament.get("game_id"):
        if _rows_key(source) != _rows_key(own) or (own or {}).get("game_id") != source.get("game_id"):
            await copy_version(db, source, scope=TOURNAMENT, scope_id=tournament["id"], user=user, tournament_id=tournament["id"],
                               note=f"Aus {season.get('name')} übernommen")
            changed.append(group)
        applied.append(group)
        return
    if source:
        skipped.append({"group": group, "label": SYNC_LABEL,
                        "reason": "Die Staffel hat ein anderes Spiel als die Sperrliste der Season - ihre Liste bleibt."})
        return
    if not own:
        return
    if locked or has_result:
        reason = "Die Staffel ist gesperrt." if locked else "Es gibt schon ein Ergebnis."
        skipped.append({"group": group, "label": SYNC_LABEL, "reason": f"Die Season hat keine Sperrliste mehr, die Staffel behält ihre: {reason}"})
        return
    await clear(db, scope=TOURNAMENT, scope_id=tournament["id"], user=user, tournament_id=tournament["id"])
    changed.append(group)
    applied.append(group)


async def match_stamp(db, match: dict) -> dict:
    """Das Feld fürs Festschreiben eines Ergebnisses einer Staffel: die Liste, die gerade gilt, oder ``None`` für „keine“ - leer bei anderen
    Formaten und wenn das Spiel schon einen Vermerk hat (eine Korrektur ändert nicht, was galt)."""
    if STAMP in match or not match.get("tournament_id"):
        return {}
    tournament = await db.tournaments.find_one({"id": match["tournament_id"]}, {"_id": 0, "id": 1, "game_id": 1, "league_context": 1})
    if not tournament or not tournament.get("league_context"):
        return {}
    # Fehler gehen hier nicht still verloren (Review C.4): Ein fehlender Vermerk ließe später eine andere Liste gelten.
    doc = valid_for(await current(db, TOURNAMENT, tournament["id"]), tournament.get("game_id"))
    # Erlaubte Ausrüstung (#2287): was in diesem Moment erlaubt ist, als Schnappschuss - ein späterer Eintrag ändert das Spiel nicht mehr.
    allowed = await public_allowed(db, tournament.get("game_id"), doc, await season_of(db, tournament))
    # Auch „keine Liste“ wird festgehalten (``None``) - eine später übertragene Liste gilt für dieses Spiel nicht.
    return {STAMP: doc["id"] if doc else None, ALLOWED_STAMP: await hold_allowed(db, tournament.get("game_id"), allowed) if allowed else None}


# Erlaubte Ausrüstung am Spiel (#2287, Codex Runde 1): je Inhalt eine Zeile in ``loadout_allowed`` (Kennung = Fingerabdruck), viele Spiele
# teilen sie. Das Spiel trägt nur die Kennung; unveränderlich wie eine Version der Sperrliste.
ALLOWED_STAMP = "loadout_allowed_id"


async def hold_allowed(db, game_id: str | None, data: dict) -> str:
    key = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    try:
        await db.loadout_allowed.update_one({"id": key}, {"$setOnInsert": {"id": key, "game_id": game_id, "data": data,
                                                                          "created_at": now_utc().isoformat()}}, upsert=True)
    except DuplicateKeyError:
        # Gleichzeitig angelegt (Codex Runde 2): derselbe Inhalt, dieselbe Kennung - die vorhandene Zeile gilt.
        if not await db.loadout_allowed.find_one({"id": key}, {"_id": 0, "id": 1}):
            raise
    return key


async def match_allowed(db, tournament: dict | None, match: dict | None) -> dict | None:
    """Die erlaubte Ausrüstung eines Spiels: nach dem Ergebnis der Schnappschuss von damals, sonst aus der Liste, die gilt, und der Bibliothek
    von heute. Ältere Spiele mit Vermerk, aber ohne Schnappschuss, rechnen wie bisher; ein fertiges Spiel von vor C.4 zeigt nichts."""
    match = match or {}
    if ALLOWED_STAMP in match:
        held = match.get(ALLOWED_STAMP)
        row = await db.loadout_allowed.find_one({"id": held}, {"_id": 0, "data": 1}) if held else None
        return (row or {}).get("data")
    if not knows_list(match):
        return None
    doc, _held = await effective_doc(db, tournament, match)
    return await public_allowed(db, (tournament or {}).get("game_id"), doc, await season_of(db, tournament))


# ---------------------------------------------------------------- Regelwerk-Baustein

NO_LIST = "*Für diese Season ist keine Sperrliste hinterlegt – alles ist erlaubt.*"
INTRO = "*Gesperrt ist nur, was hier steht – alles andere ist erlaubt.*"
ATTACHMENTS_TITLE = "Aufsätze an erlaubten Waffen"


def _cell(value) -> str:
    """Ein Name als Text im Markdown - Steuerzeichen maskiert, damit kein Name zum Link oder zur Formatierung wird (Review C.4)."""
    return text_cell(value)


def _alt(value) -> str:
    """Der Bildtext: ohne eckige Klammern und Backslash (sie beendeten das Bild im Markdown); er wird nie formatiert, nur angezeigt."""
    return re.sub(r"[\[\]\\|]", "", " ".join(str(value or "").split())) or "Bild"


def _image(entry: dict) -> str:
    return f"![{_alt(entry.get('name'))}]({entry['image_url']})" if entry.get("image_url") else "–"


def _where(entry: dict) -> str:
    return ", ".join(entry.get("modes") or []) or ALL_MODES


def _weapons_data(doc: dict) -> list[dict]:
    return [{"name": entry.get("name") or "", "image_url": entry.get("image_url"), "modes": list(entry.get("mode_labels") or []),
             "attachments": [item.get("name") or "" for item in entry.get("attachments") or []]}
            for entry in doc.get("entries") or [] if entry.get("kind") == ATTACHMENTS]


def block_data(doc: dict | None) -> dict:
    """Der Baustein bis #2287 (Sperren), strukturiert im Klartext: ``{"list": bool, "groups": [{label, entries: [{name, image_url,
    modes}]}], "weapons": [{name, image_url, attachments, modes}]}`` - ``modes`` sind die Namen der Modi, leer = alle. So bleiben ältere
    eingefrorene Fassungen lesbar; neu gebaut wird er nur noch für ein Spiel ohne Bibliothek (``allowed_data``)."""
    if not doc or doc.get("cleared"):
        return {"list": False, "groups": [], "weapons": []}
    groups: list[dict] = []
    for entry in doc.get("entries") or []:
        if (entry.get("kind") or ITEM) != ITEM:
            continue
        label = entry.get("category_label") or "Ausrüstung"
        group = next((row for row in groups if row["label"] == label), None)
        if group is None:
            group = {"label": label, "entries": []}
            groups.append(group)
        group["entries"].append({"name": entry.get("name") or "", "image_url": entry.get("image_url"),
                                 "modes": list(entry.get("mode_labels") or [])})
    return {"list": True, "groups": groups, "weapons": _weapons_data(doc)}


# ---------------------------------------------------------------- Erlaubte Ausrüstung (#2287, Nr. 99)

def _merge_modes(old: list, new: list) -> list:
    """Zwei Sperren desselben Eintrags: leer heißt alle Modi."""
    return [] if not old or not new else [*old, *(mode for mode in new if mode not in old)]


def _mode_pairs(row: dict) -> list[tuple[str, str]]:
    """Die Modi einer Sperre als (Kennung, Name). Ohne passende Kennungen (Altbestand, erfundene Daten) zählt der Name als Kennung."""
    keys, labels = list(row.get("modes") or []), list(row.get("mode_labels") or [])
    if len(keys) != len(labels):
        keys = labels
    return list(zip(keys, labels))


def _attachment_pairs(item: dict, row_pairs: list) -> list:
    """Modi eines Aufsatzes an seiner Waffe (#2299): eigene, wenn gesetzt, sonst die der Zeile."""
    return _mode_pairs(item) if item.get("modes") or item.get("mode_labels") else row_pairs


def _bans_of(doc: dict | None) -> tuple[dict, dict, dict]:
    """Die Sperren einer Version: je Eintrag und je Klasse die Modi (leer = alle), je Aufsatz die Waffen, an denen er gesperrt ist - Modi als
    (Kennung, Name)."""
    items: dict[str, list] = {}
    classes: dict[str, list] = {}
    at_weapons: dict[str, list[dict]] = {}
    if not doc or doc.get("cleared"):
        return items, classes, at_weapons
    for entry in doc.get("entries") or []:
        kind = entry.get("kind") or ITEM
        modes = _mode_pairs(entry)
        if kind == CLASS and entry.get("subcategory"):
            classes[entry["subcategory"]] = _merge_modes(classes[entry["subcategory"]], modes) if entry["subcategory"] in classes else modes
        elif kind == ITEM and entry.get("item_id"):
            items[entry["item_id"]] = _merge_modes(items[entry["item_id"]], modes) if entry["item_id"] in items else modes
        elif kind == ATTACHMENTS:
            for item in entry.get("attachments") or []:
                at_weapons.setdefault(item.get("item_id"), []).append({"id": entry.get("item_id"), "name": entry.get("name") or "",
                                                                       "modes": _attachment_pairs(item, modes)})
    return items, classes, at_weapons


def _restriction(pairs: list, season: list) -> dict:
    """``not_in`` (Namen der gesperrten Modi) und - #2298 - ``only_in``, wenn der Eintrag in **mehr** Modi der Season gesperrt ist als
    erlaubt: die erlaubten Modi der Season. Gleichstand, keine Modi der Season oder kein erlaubter mehr: nur ``not_in``."""
    out: dict = {"not_in": [label for _key, label in pairs]}
    if pairs and season:
        banned = {key for key, _label in pairs}
        inside = [key for key, _label in season if key in banned]
        allowed = [label for key, label in season if key not in banned]
        if allowed and len(inside) > len(allowed):
            out["only_in"] = allowed
    return out


def _combined(*parts) -> list | None:
    """Mehrere Sperren desselben Eintrags zusammen: ``None`` = keine, ``[]`` = alle Modi."""
    out = None
    for pairs in parts:
        if pairs is not None:
            out = list(pairs) if out is None else _merge_modes(out, pairs)
    return out


class _Usability:
    """Wo ein Aufsatz wirklich gespielt werden kann (Codex Runde 1, Nr. 81): an einer aktiven Waffe, die er trifft (Waffe oder Klasse), die
    nicht ganz gesperrt ist und an der er selbst nicht in allen Modi gesperrt ist. Ohne so eine Waffe ist er praktisch nicht erlaubt."""

    def __init__(self, categories: list[dict], active: list[dict], bans: tuple[dict, dict, dict]):
        item_bans, class_bans, self.at_weapons = bans
        weapon_keys = {row["key"] for row in categories if row["role"] == WEAPON}
        self.attachment_keys = {row["key"] for row in categories if row["role"] == ATTACHMENT}
        self.open = [row for row in active if row.get("category") in weapon_keys
                     and item_bans.get(row["id"]) != [] and class_bans.get(row.get("subcategory") or "") != []]

    def is_attachment(self, row: dict) -> bool:
        return row.get("category") in self.attachment_keys

    def reason(self, row: dict) -> str | None:
        """``None``: an mindestens einer erlaubten Waffe spielbar - sonst der Grund in Worten."""
        if not row.get("weapon_ids") and not row.get("weapon_class_ids"):
            return "keiner Waffe zugeordnet"
        fitting = [weapon for weapon in self.open if library.fits(row, weapon)]
        if not fitting:
            return "passt nur zu gesperrten Waffen"
        blocked = {weapon["id"] for weapon in self.at_weapons.get(row["id"], []) if not weapon["modes"]}
        return None if any(weapon["id"] not in blocked for weapon in fitting) else "an jeder passenden Waffe gesperrt"


def _active(items: list[dict]) -> list[dict]:
    return sorted((row for row in items if library.status_of(row) == library.ACTIVE), key=lambda row: library.name_key(row.get("name")))


def unusable_attachments(categories: list[dict], items: list[dict], doc: dict | None) -> list[dict]:
    """Aktive Aufsätze, die nach der Liste an keiner erlaubten Waffe passen - sie fehlen in der erlaubten Ausrüstung; die Verwaltung nennt sie
    (``[{id, name, reason}]``)."""
    active = _active(items)
    usability = _Usability(categories, active, _bans_of(doc))
    item_bans = _bans_of(doc)[0]
    out = []
    for row in active:
        if not usability.is_attachment(row) or item_bans.get(row["id"]) == []:
            continue
        reason = usability.reason(row)
        if reason:
            out.append({"id": row["id"], "name": row.get("name") or "", "reason": reason})
    return out


LAYOUT = 4
# Fassungen der erlaubten Ausrüstung: 3 (#2287, Aufsätze als eigene Liste mit „nicht an …“) bleibt eingefroren lesbar, 4 (#2299) ist neu.
LAYOUTS = (3, LAYOUT)


def _slot_index(categories: list[dict]) -> dict:
    """Je Kategorie der Art Aufsatz und Unterkategorie (Slot) die Stelle in der Bibliothek, ohne Unterkategorie zuerst."""
    out = {}
    attachment_cats = [category for category in categories if category["role"] == ATTACHMENT]
    for cat_index, category in enumerate(attachment_cats):
        none_label = category["label"] if len(attachment_cats) > 1 else None
        out[(category["key"], None)] = ((cat_index, -1), {"label": none_label})
        for sub_index, sub in enumerate(category.get("subcategories") or []):
            out[(category["key"], sub["key"])] = ((cat_index, sub_index), sub)
    return out


def _weapon_attachments(weapon: dict, attachments: list[dict], slots: dict, bans: tuple, season: list) -> dict | None:
    """Die Aufsätze einer erlaubten Waffe (#2299): ``{count, banned, groups}`` - ``None``, wenn keiner passt."""
    item_bans, class_bans, at_weapons = bans
    fitting = [row for row in attachments if library.fits(row, weapon)]
    if not fitting:
        return None
    banned, groups = [], {}
    for row in fitting:
        sub_key = row.get("subcategory") if (row.get("category"), row.get("subcategory")) in slots else None
        klass = class_bans.get(sub_key) if sub_key else None
        here = [found["modes"] for found in at_weapons.get(row["id"], []) if found["id"] == weapon["id"]]
        pairs = _combined(klass, item_bans.get(row["id"]), *here)
        if pairs == []:
            banned.append(row.get("name") or "")
            continue
        position, sub = slots[(row.get("category"), sub_key)]
        group = groups.get(position)
        if group is None:
            group = {"label": sub.get("label")}
            if sub_key and sub.get("icon_url"):
                group["icon_url"] = sub["icon_url"]
            group.update(_restriction(klass or [], season))
            group["entries"] = []
            groups[position] = group
        group["entries"].append({"name": row.get("name") or "", "image_url": row.get("image_url"), **_restriction(pairs or [], season)})
    return {"count": len(fitting), "banned": banned, "groups": [groups[key] for key in sorted(groups)]}


def allowed_block(categories: list[dict], items: list[dict], doc: dict | None, season_modes: list | None = None) -> dict:
    """Die erlaubte Ausrüstung (Fabian, 04.11., Nr. 99; Aufsätze je Waffe #2299): je Kategorie und Unterkategorie die **aktiven** Einträge
    der Bibliothek ohne die Sperren der Version. Strukturiert im Klartext, so wird eingefroren:

    ``{"list", "layout": 4, "categories": [{label, role, sections: [{label | None, icon_url?, state, not_in, only_in?, banned, entries:
    [{name, image_url, not_in, only_in?, attachments?}]}]}]}`` - ``state``: ``all`` (alle erlaubt), ``some`` (mit Einschränkungen oder
    einzeln gesperrten) oder ``banned`` (ganze Klasse nicht erlaubt, dann nur ``banned``: die Namen der Einträge, die darunter fallen).
    ``not_in``: Modi, in denen ein Eintrag (bzw. die ganze Klasse) nicht erlaubt ist; ``only_in`` (#2298): die erlaubten Modi der Season,
    wenn das kürzer ist (``season_modes``: ``[(Kennung, Name)]``). Kategorien der Art Aufsatz entfallen - die Aufsätze stehen an der Waffe
    (``_weapon_attachments``). Inaktive und archivierte Einträge fehlen, leere Unterkategorien entfallen."""
    bans = _bans_of(doc)
    item_bans, class_bans, _at_weapons = bans
    season = list(season_modes or [])
    active = _active(items)
    attachment_keys = {row["key"] for row in categories if row["role"] == ATTACHMENT}
    attachments = [row for row in active if row.get("category") in attachment_keys]
    slots = _slot_index(categories)
    out = []
    for category in categories:
        if category["role"] == ATTACHMENT:
            continue
        subs = category.get("subcategories") or []
        known = {sub["key"] for sub in subs}
        members = [row for row in active if row.get("category") == category["key"]]
        groups = [(None, [row for row in members if row.get("subcategory") not in known])]
        groups += [(sub, [row for row in members if row.get("subcategory") == sub["key"]]) for sub in subs]
        sections = []
        for sub, rows in groups:
            klass = class_bans.get(sub["key"]) if sub else None
            section: dict = {"label": sub["label"] if sub else None}
            if sub and sub.get("icon_url"):
                section["icon_url"] = sub["icon_url"]
            if sub and klass == []:
                # Ganze Klasse gesperrt: eine kurze Zeile, die Namen nur zum Mitlesen - ein neuer Eintrag ändert so den Baustein.
                sections.append({**section, "state": "banned", "not_in": [], "banned": [row.get("name") or "" for row in rows], "entries": []})
                continue
            entries, blocked = [], 0
            for row in rows:
                own = item_bans.get(row["id"])
                if own == []:
                    blocked += 1
                    continue
                entry = {"name": row.get("name") or "", "image_url": row.get("image_url"),
                         **_restriction(_combined(klass, own) or [], season)}
                if category["role"] == WEAPON:
                    fitted = _weapon_attachments(row, attachments, slots, bans, season)
                    if fitted:
                        entry["attachments"] = fitted
                entries.append(entry)
            if not entries:
                if sub and rows:
                    sections.append({**section, "state": "banned", "not_in": [], "banned": [row.get("name") or "" for row in rows],
                                     "entries": []})
                continue
            free = not klass and not blocked and not any(entry["not_in"] for entry in entries)
            sections.append({**section, "state": "all" if free else "some", **_restriction(klass or [], season), "banned": [],
                             "entries": entries})
        if sections:
            out.append({"label": category["label"], "role": category["role"], "sections": sections})
    return {"list": bool(doc and not doc.get("cleared")), "layout": LAYOUT, "categories": out}


async def season_mode_pairs(db, game_id: str | None, season: dict | None) -> list[tuple[str, str]]:
    """Die Modi der Season (#2298) als (Kennung, Name): dieselbe Regel wie der Baustein „Modi der Season“ - geltender Pool, dann
    Modusfolge, sonst die nicht archivierten Modi des Spiels."""
    if not season or not game_id:
        return []
    from services import map_pools

    game = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        return []
    pool = map_pools.valid_for(await map_pools.current(db, SEASON, season["id"]), game_id)
    labels = {row["mode"]: row["label"] for row in game_maps.game_modes(game)}
    return [(key, labels.get(key, key)) for key in game_modes.season_mode_keys(season, game, pool)]


async def season_of(db, tournament: dict | None) -> dict | None:
    """Die Season einer Staffel - für die Modi der Season auf der Matchseite."""
    season_id = ((tournament or {}).get("league_context") or {}).get("season_id")
    return await db.league_seasons.find_one({"id": season_id}, {"_id": 0}) if season_id else None


async def allowed_data(db, game_id: str | None, doc: dict | None, season: dict | None = None) -> dict:
    """Der Baustein mit dem heutigen Stand der Bibliothek. Ohne Bibliothek (keine aktiven Einträge) bleibt er wie bisher - ohne Liste der
    Satz „alles ist erlaubt“. ``season``: ihre Modi entscheiden „nur in …“ (#2298)."""
    if not game_id:
        return block_data(doc)
    rows = await db.game_equipment.find({"game_id": game_id, "status": {"$nin": [library.INACTIVE, library.ARCHIVED]}},
                                        {"_id": 0, "id": 1, "category": 1, "subcategory": 1, "name": 1, "image_url": 1, "status": 1,
                                         "weapon_ids": 1, "weapon_class_ids": 1}).to_list(library.ITEMS_PER_GAME_MAX + 50)
    if not rows:
        return block_data(doc)
    return allowed_block(await library.categories_of(db, game_id), rows, doc, await season_mode_pairs(db, game_id, season))


async def public_allowed(db, game_id: str | None, doc: dict | None, season: dict | None = None) -> dict | None:
    """Für Liga- und Matchseite: dieselbe Sicht wie das Regelwerk - ``None``, wenn das Spiel keine Bibliothek hat."""
    data = await allowed_data(db, game_id, doc, season)
    return data if data.get("layout") in LAYOUTS else None


def block_source(doc: dict | None) -> dict:
    if not doc or doc.get("cleared"):
        return {"loadout_ban_id": None}
    return {"loadout_ban_id": doc.get("id"), "loadout_ban_version": doc.get("version")}


def render_block(data: dict, variant: str = "markdown") -> str:
    """Markdown fürs Darstellen: ``markdown`` mit Bildern (Web), ``text`` ohne (PDF, Vergleich). Namen als Bausteinwerte geschützt
    (``text_cell``) - das ist nur Darstellungs-Zwischenformat, gespeichert wird ``block_data``."""
    if data.get("layout") in LAYOUTS:
        return _render_allowed(data, variant)
    if not data.get("list"):
        return NO_LIST
    web = variant != "text"
    lines = [INTRO]
    for group in data.get("groups") or []:
        lines += ["", f"**{_cell(group.get('label'))}**", ""]
        if web:
            lines += ["| Bild | Name | Gilt in |", "| --- | --- | --- |"]
            lines += [f"| {_image(row)} | {_cell(row.get('name'))} | {_cell(_where(row))} |" for row in group.get("entries") or []]
        else:
            lines += [f"- {_cell(row.get('name'))} – gilt in: {_cell(_where(row))}" for row in group.get("entries") or []]
    weapons = data.get("weapons") or []
    if weapons:
        lines += ["", f"**{ATTACHMENTS_TITLE}**", ""]
        if web:
            lines += ["| Bild | Waffe | Gesperrte Aufsätze | Gilt in |", "| --- | --- | --- | --- |"]
        for row in weapons:
            names = ", ".join(_cell(name) for name in row.get("attachments") or [])
            lines.append(f"| {_image(row)} | {_cell(row.get('name'))} | {names} | {_cell(_where(row))} |" if web
                         else f"- {_cell(row.get('name'))}: {names} – gilt in: {_cell(_where(row))}")
    return "\n".join(lines)


# Erlaubte Ausrüstung (#2287): feste Bildtexte, an denen das Web die Karten und das Symbol der Klasse erkennt (``rules.css``).
CARD_ALT = "Ausrüstung"
CLASS_ICON_ALT = "Klassen-Symbol"
ALLOWED_INTRO = "*Erlaubt ist die Ausrüstung, die hier steht – Einschränkungen stehen beim Eintrag.*"
ALLOWED_NO_LIST = "*Für diese Season ist nichts gesperrt – erlaubt ist die ganze Ausrüstung, die hier steht.*"
ALLOWED_EMPTY = "*Zurzeit ist keine Ausrüstung erlaubt.*"
ALL_ALLOWED = "alle erlaubt"
NOT_ALLOWED = "nicht erlaubt"
NO_SUBCATEGORY = "–"


def _weapon_text(weapon: dict) -> str:
    modes = weapon.get("modes") or []
    return f"{weapon.get('name') or ''} (in {', '.join(modes)})" if modes else weapon.get("name") or ""


def modes_text(entry: dict) -> str:
    """Der Modus-Hinweis (#2298): „nur in …“, wenn ``only_in`` steht, sonst „nicht in …“ - leer ohne Einschränkung."""
    if entry.get("only_in"):
        return f"nur in {', '.join(entry['only_in'])}"
    return f"nicht in {', '.join(entry['not_in'])}" if entry.get("not_in") else ""


def restriction_parts(entry: dict) -> list[str]:
    """Die Einschränkungen eines erlaubten Eintrags als Klartext: „nicht in Suchen“ bzw. „nur in Suchen“ (#2298), in Fassungen mit
    ``layout: 3`` auch „nicht an Blitz 9, Donner 4 (in Suchen)“."""
    parts = []
    if modes_text(entry):
        parts.append(modes_text(entry))
    if entry.get("not_at"):
        parts.append(f"nicht an {', '.join(_weapon_text(weapon) for weapon in entry['not_at'])}")
    return parts


def _own_parts(entry: dict, section: dict) -> list[str]:
    """Was die Karte selbst sagt: ohne die Einschränkung, die schon für die ganze Klasse im Kopf steht."""
    if section.get("not_in") and entry.get("not_in") == section.get("not_in"):
        return restriction_parts({**entry, "not_in": [], "only_in": []})
    return restriction_parts(entry)


ALL_ATTACHMENTS = "alle passenden Aufsätze erlaubt"
NO_ATTACHMENTS = "keine Aufsätze erlaubt"


def attachments_text(attachments: dict) -> str:
    """Der Satz zu den Aufsätzen einer Waffe (#2299, PDF und Regelwerk im Web): „alle passenden Aufsätze erlaubt“, mit Ausnahmen „…, außer:
    A, B, C (nur in Suchen)“ - ganz gesperrte ohne, nur in Modi gesperrte mit ihrem Hinweis. Namen geschützt (``text_cell``)."""
    parts = [_cell(name) for name in attachments.get("banned") or []]
    if not any(group.get("entries") for group in attachments.get("groups") or []):
        return f"{NO_ATTACHMENTS} ({', '.join(parts)})" if parts else NO_ATTACHMENTS
    for group in attachments.get("groups") or []:
        for entry in group.get("entries") or []:
            note = "; ".join(restriction_parts(entry))
            if note:
                parts.append(f"{_cell(entry.get('name'))} ({_cell(note)})")
    return f"{ALL_ATTACHMENTS}, außer: {', '.join(parts)}" if parts else ALL_ATTACHMENTS


def _allowed_card(entry: dict, section: dict) -> str:
    image = f"![{CARD_ALT}]({entry['image_url']}) " if entry.get("image_url") else ""
    parts = _own_parts(entry, section)
    note = f" *{_cell(' · '.join(parts))}*" if parts else ""
    # Aufsätze je Waffe (#2299): Das Regelwerk im Web kann nicht aufklappen (``markdownLite`` kennt kein ``<details>``) - der Satz steht
    # ohne Auszeichnung unter Name und Hinweis (``rules.css``).
    tail = f" {attachments_text(entry['attachments'])}" if entry.get("attachments") else ""
    # Der Name als Marke (``++…++``, im Web ``<u>``, Codex Runde 1): So erkennt das Web jede Kartenliste, auch ohne ein einziges Bild, und
    # stellt alle Kategorien gleich dar (``rules.css``).
    return f"- {image}++{_cell(entry.get('name'))}++{note}{tail}"


def _allowed_head(section: dict, variant: str = "markdown") -> str:
    icon = f"![{CLASS_ICON_ALT}]({section['icon_url']}) " if section.get("icon_url") and variant != "text" else ""
    head = f"{icon}*{_cell(section.get('label'))}*"
    if section.get("state") == "banned":
        names = ", ".join(_cell(name) for name in section.get("banned") or [])
        return f"{head} · **{NOT_ALLOWED}**" + (f" ({names})" if names else "")
    if section.get("state") == "all":
        return f"{head} · {ALL_ALLOWED}"
    if modes_text(section):
        return f"{head} · {_cell(modes_text(section))}"
    return head


def _weapon_lines(category: dict) -> list[str]:
    """PDF und Vergleich (#2299): Waffen als Liste - je Unterkategorie die Kopfzeile, je Waffe eine Zeile mit dem Satz zu den Aufsätzen."""
    lines = ["", f"**{_cell(category.get('label'))}**"]
    for section in category.get("sections") or []:
        lines.append("")
        if section.get("label"):
            lines.append(_allowed_head(section, "text"))
        for entry in section.get("entries") or []:
            parts = _own_parts(entry, section)
            line = f"- {_cell(entry.get('name'))}" + (f" ({_cell('; '.join(parts))})" if parts else "")
            if entry.get("attachments"):
                line += f" – {attachments_text(entry['attachments'])}"
            lines.append(line)
    return lines


def _allowed_rows(category: dict) -> list[str]:
    """PDF und Vergleich: je Unterkategorie und Einschränkung eine Zeile Kategorie · Unterkategorie · Erlaubt · Einschränkungen."""
    lines = []
    for section in category.get("sections") or []:
        start = f"| {_cell(category.get('label'))} | {_cell(section.get('label')) if section.get('label') else NO_SUBCATEGORY} | "
        if section.get("state") == "banned":
            names = ", ".join(_cell(name) for name in section.get("banned") or [])
            lines.append(f"{start}{NOT_ALLOWED}{f' ({names})' if names else ''} | – |")
            continue
        entries = section.get("entries") or []
        groups: dict[str, list[str]] = {}
        for entry in entries:
            groups.setdefault("; ".join(restriction_parts(entry)), []).append(_cell(entry.get("name")))
        whole = section.get("state") == "all" or (len(groups) == 1 and section.get("not_in"))
        for text, names in groups.items():
            prefix = "alle: " if whole and len(names) == len(entries) else ""
            lines.append(f"{start}{prefix}{', '.join(names)} | {_cell(text) or '–'} |")
    return lines


def _render_allowed(data: dict, variant: str) -> str:
    categories = data.get("categories") or []
    lines = [ALLOWED_INTRO if data.get("list") else ALLOWED_NO_LIST]
    if not categories:
        return "\n".join([*lines, "", ALLOWED_EMPTY])
    if variant != "text":
        for category in categories:
            lines += ["", f"**{_cell(category.get('label'))}**"]
            for section in category.get("sections") or []:
                lines.append("")
                if section.get("label"):
                    lines.append(_allowed_head(section))
                lines += [_allowed_card(entry, section) for entry in section.get("entries") or []]
        return "\n".join(lines)
    # Waffen (``role``, erst ab layout 4) als Liste je Waffe, alles andere als Tabelle - ältere Fassungen sind ganz Tabelle.
    table: list[str] = []
    for category in categories:
        if category.get("role") == WEAPON:
            if table:
                lines += ["", *TABLE_HEAD, *table]
                table = []
            lines += _weapon_lines(category)
        else:
            table += _allowed_rows(category)
    if table:
        lines += ["", *TABLE_HEAD, *table]
    return "\n".join(lines)


TABLE_HEAD = ("| Kategorie | Unterkategorie | Erlaubt | Einschränkungen |", "| --- | --- | --- | --- |")


def block_images(data: dict) -> list[str]:
    if data.get("layout") in LAYOUTS:
        urls = []
        for category in data.get("categories") or []:
            for section in category.get("sections") or []:
                urls.append(section.get("icon_url"))
                for row in section.get("entries") or []:
                    urls.append(row.get("image_url"))
                    for group in (row.get("attachments") or {}).get("groups") or []:
                        urls.append(group.get("icon_url"))
                        urls += [item.get("image_url") for item in group.get("entries") or []]
        return list(dict.fromkeys(url for url in urls if url))
    rows = [row for group in data.get("groups") or [] for row in group.get("entries") or []] + list(data.get("weapons") or [])
    return [row["image_url"] for row in rows if row.get("image_url")]
