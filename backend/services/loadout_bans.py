"""Sperrlisten der Ausrüstung je Season (docs/LIGA.md, C.4 #2218) - nach dem Muster der Map-Pools (``services/map_pools.py``).

Alles ist erlaubt außer dem, was auf der Sperrliste steht. Eine Zeile sperrt einen Eintrag der Bibliothek (``kind: "item"``) oder - nur
bei Waffen - einzelne Aufsätze an einer sonst erlaubten Waffe (``kind: "attachments"``), je in allen Modi oder in den genannten.

**Snapshot und Versionen.** Jedes Speichern legt in ``loadout_bans`` eine neue, unveränderliche Version an, mit Namen und Bildern *von
damals*. Entfernen ist ebenfalls eine Version (``cleared``). Die Season ist die Vorlage (``league_season``), die Staffel trägt eine Kopie
(``tournament``), das Spiel hält beim ersten Festschreiben eines Ergebnisses seine Version fest (``matches_v2.loadout_ban_id``).

Das System prüft nicht, was im Spiel benutzt wird - Verstöße laufen über Protest und Strafe.
"""
from __future__ import annotations

import re
from typing import List, Literal, Optional

from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from models import GAME_MODES_MAX, new_id, now_utc
from services import game_equipment as library
from services import game_maps, game_modes
from services.game_equipment import ARCHIVED, ATTACHMENT, INACTIVE, WEAPON, EquipmentProblem
from services.league_rule_blocks import text_cell

SEASON, TOURNAMENT = "league_season", "tournament"
SCOPES = (SEASON, TOURNAMENT)
ITEM, ATTACHMENTS = "item", "attachments"
KINDS = (ITEM, ATTACHMENTS)
ENTRIES_MAX = 500
ATTACHMENTS_MAX = 200
ALL_MODES = "alle Modi"
CHANGED_MEANWHILE = "Die Sperrliste wurde inzwischen geändert - bitte neu laden."
EMPTY = "Bitte mindestens einen Eintrag sperren - oder die Sperrliste entfernen."
# Vermerk am Spiel: Kennung der Version oder ``None`` für „keine Liste“; fehlt das Feld, wurde nie gestempelt.
STAMP = "loadout_ban_id"
FINISHED = frozenset({"completed", "forfeit"})
SNAPSHOT_KEYS = ("item_id", "name", "category", "category_label", "role", "image_url")


class BanEntryIn(BaseModel):
    item_id: str = Field(min_length=1, max_length=64)
    kind: Literal["item", "attachments"] = ITEM
    modes: List[str] = Field(default_factory=list, max_length=GAME_MODES_MAX)
    attachment_ids: List[str] = Field(default_factory=list, max_length=ATTACHMENTS_MAX)


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


def _entry_view(entry: dict) -> dict:
    return {**{key: entry.get(key) for key in SNAPSHOT_KEYS}, "kind": entry.get("kind") or ITEM,
            "modes": list(entry.get("modes") or []), "mode_labels": list(entry.get("mode_labels") or []),
            "attachments": [{key: item.get(key) for key in ("item_id", "name", "image_url")} for item in entry.get("attachments") or []]}


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
    for entry in doc.get("entries") or []:
        snapshots.append(entry)
        snapshots.extend(entry.get("attachments") or [])
    ids = sorted({item.get("item_id") for item in snapshots if item.get("item_id")})
    rows = {row["id"]: row for row in await db.game_equipment.find({"id": {"$in": ids}}, {"_id": 0}).to_list(None)}
    out: list[str] = []
    for item in snapshots:
        row = rows.get(item.get("item_id"))
        changed = (not row or library.status_of(row) == ARCHIVED or row.get("name") != item.get("name")
                   or row.get("image_url") != item.get("image_url"))
        if changed and item.get("item_id") not in out:
            out.append(item.get("item_id"))
    return out


async def admin_entry(db, doc: dict | None, game_id: str | None, origin: str) -> dict | None:
    if not doc or doc.get("cleared"):
        return None
    return {**view(doc, origin, admin=True), "stale": doc.get("game_id") != game_id, "outdated_item_ids": await outdated_item_ids(db, doc)}


async def versions(db, scope: str, scope_id: str) -> list[dict]:
    rows = await db.loadout_bans.find({"scope": scope, "scope_id": scope_id}, {"_id": 0}).sort("version", -1).to_list(500)
    return [{"id": row.get("id"), "version": row.get("version"), "saved_at": row.get("created_at"), "saved_by": row.get("created_by"),
             "note": row.get("note"), "cleared": bool(row.get("cleared")), "entries": len(row.get("entries") or [])}
            for row in rows]


async def effective(db, tournament: dict | None, match: dict | None = None) -> dict | None:
    """Die Liste, die für ein Spiel gilt: die festgehaltene Version (auch „keine“, ``None``), sonst die der Staffel, sonst keine. Ein fertiges
    Spiel ohne Vermerk (vor C.4) zeigt keine Liste - die heutige galt damals nicht."""
    match = match or {}
    if STAMP in match:
        held = match.get(STAMP)
        doc = await db.loadout_bans.find_one({"id": held}, {"_id": 0}) if held else None
        return view(doc, "match") if doc and not doc.get("cleared") else None
    if match.get("status") in FINISHED or not tournament:
        return None
    return view(valid_for(await current(db, TOURNAMENT, tournament["id"]), tournament.get("game_id")), TOURNAMENT)


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


async def _snapshot(db, game: dict, body: LoadoutBansSave, previous: dict | None) -> list[dict]:
    if not body.entries:
        raise EquipmentProblem(EMPTY)
    categories = await library.categories_of(db, game["id"])
    by_key = {row["key"]: row for row in categories}
    order = {row["key"]: index for index, row in enumerate(categories)}
    ids = sorted({entry.item_id for entry in body.entries} | {item for entry in body.entries for item in entry.attachment_ids})
    rows = {row["id"]: row for row in await db.game_equipment.find({"id": {"$in": ids}, "game_id": game["id"]}, {"_id": 0}).to_list(None)}
    kept_modes, kept_rows, kept_attached = _kept(previous, game)
    seen: set = set()
    out: list[dict] = []
    for entry in body.entries:
        row = rows.get(entry.item_id)
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
                    "modes": modes, "mode_labels": labels, "attachments": []}
        if entry.kind == ATTACHMENTS:
            snapshot["attachments"] = _attachments(row, category, entry, rows, by_key, kept_attached)
        elif entry.attachment_ids:
            raise EquipmentProblem(f"„{row.get('name')}“: Aufsätze lassen sich nur an einer Waffe einzeln sperren.")
        out.append(snapshot)
    for snapshot in out:
        if snapshot["kind"] == ATTACHMENTS and any(other["kind"] == ITEM and other["item_id"] == snapshot["item_id"] and not other["modes"]
                                                   for other in out):
            raise EquipmentProblem(f"„{snapshot['name']}“ ist schon in allen Modi gesperrt - einzelne Aufsätze dazu braucht es nicht.")
    kind_order = {ITEM: 0, ATTACHMENTS: 1}
    return sorted(out, key=lambda row: (kind_order[row["kind"]], order.get(row["category"], len(order)), library.name_key(row["name"])))


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
        fits = item.get("weapon_ids") or []
        if fits and weapon["id"] not in fits:
            raise EquipmentProblem(f"Der Aufsatz „{item.get('name')}“ passt nicht zu „{weapon.get('name')}“.")
        problem = _status_problem(item, (weapon["id"], item_id) in kept_attached)
        if problem:
            raise EquipmentProblem(problem)
        out.append({"item_id": item["id"], "name": item.get("name"), "image_url": item.get("image_url")})
    return sorted(out, key=lambda row: library.name_key(row["name"]))


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

def _rows(doc: dict | None) -> dict:
    if not doc or doc.get("cleared"):
        return {}
    return {(entry.get("kind") or ITEM, entry.get("item_id")): entry for entry in doc.get("entries") or []}


def _short(entry: dict) -> dict:
    return {"kind": entry.get("kind") or ITEM, "item_id": entry.get("item_id"), "name": entry.get("name"),
            "category_label": entry.get("category_label"), "modes": list(entry.get("mode_labels") or []) or [ALL_MODES],
            "attachments": [item.get("name") for item in entry.get("attachments") or []]}


def _same(old: dict, new: dict) -> bool:
    return (sorted(old.get("modes") or []) == sorted(new.get("modes") or [])
            and sorted(item.get("item_id") for item in old.get("attachments") or [])
            == sorted(item.get("item_id") for item in new.get("attachments") or []))


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
    return sorted((key[0], key[1], tuple(sorted(entry.get("modes") or [])),
                   tuple(sorted(item.get("item_id") for item in entry.get("attachments") or [])))
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
    # Auch „keine Liste“ wird festgehalten (``None``) - eine später übertragene Liste gilt für dieses Spiel nicht.
    return {STAMP: doc["id"] if doc else None}


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
    return ", ".join(entry.get("mode_labels") or []) or ALL_MODES


def block(doc: dict | None) -> dict:
    """Markdown mit Bildern (Web) und ohne (PDF, Vergleich) samt Herkunft - aus genau dieser Version."""
    if not doc or doc.get("cleared"):
        return {"markdown": NO_LIST, "text": NO_LIST, "source": {"loadout_ban_id": None}}
    web, text = [INTRO], [INTRO]
    items = [entry for entry in doc.get("entries") or [] if (entry.get("kind") or ITEM) == ITEM]
    groups: dict[str, list[dict]] = {}
    for entry in items:
        groups.setdefault(entry.get("category_label") or "Ausrüstung", []).append(entry)
    for label, rows in groups.items():
        web += ["", f"**{_cell(label)}**", "", "| Bild | Name | Gilt in |", "| --- | --- | --- |"]
        web += [f"| {_image(row)} | {_cell(row.get('name'))} | {_cell(_where(row))} |" for row in rows]
        text += ["", f"**{_cell(label)}**", ""]
        text += [f"- {_cell(row.get('name'))} – gilt in: {_cell(_where(row))}" for row in rows]
    weapons = [entry for entry in doc.get("entries") or [] if entry.get("kind") == ATTACHMENTS]
    if weapons:
        web += ["", f"**{ATTACHMENTS_TITLE}**", "", "| Bild | Waffe | Gesperrte Aufsätze | Gilt in |", "| --- | --- | --- | --- |"]
        text += ["", f"**{ATTACHMENTS_TITLE}**", ""]
        for row in weapons:
            names = ", ".join(_cell(item.get("name")) for item in row.get("attachments") or [])
            web.append(f"| {_image(row)} | {_cell(row.get('name'))} | {names} | {_cell(_where(row))} |")
            text.append(f"- {_cell(row.get('name'))}: {names} – gilt in: {_cell(_where(row))}")
    return {"markdown": "\n".join(web), "text": "\n".join(text),
            "source": {"loadout_ban_id": doc.get("id"), "loadout_ban_version": doc.get("version")}}
