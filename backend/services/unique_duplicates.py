"""Altdubletten vor eindeutigen Indizes kontrolliert bereinigen (#1043).

Scheitert ein eindeutiger Index aus ``database.AUDIT_UNIQUE_INDEXES`` beim Start an alten Dubletten, legt der Start
einen gewöhnlichen an (#930) und Betrieb → Checks zeigt ihn gelb. Bereinigt wird **nie automatisch**, sondern mit
``scripts/unique_index_duplicates.py``:

1. ``plan`` - der Trockenlauf: je fehlendem Index die Zahl der Gruppen und der überzähligen Zeilen. Liest nur und
   nennt keine Schlüssel (das wären Kennungen von Personen).
2. ``apply`` - der ausdrückliche Lauf: je Gruppe bleibt eine Zeile, die anderen gehen; das Protokoll enthält jede
   entfernte Zeile vollständig, damit sie sich zurückspielen lässt. Danach wird der eindeutige Index gleich angelegt.
   Ins Adminprotokoll kommen nur die Zahlen.

Welche Zeile bleibt: die älteste (kleinste ``_id``). Die Anwendung liest mit ``find_one`` und schreibt mit
``update_one`` - beide treffen bei gleichem Schlüssel die zuerst angelegte Zeile; die späteren hat seitdem niemand
gelesen. Für Verknüpfungen je Person und Plattform gilt dieselbe Regel wie beim Start (#1027): die zuletzt verknüpfte.

Wo die Wahl eine fachliche Entscheidung ist, löscht das Werkzeug nie (``MANUAL``): Es meldet die Gruppen, und
jemand entscheidet von Hand.
"""
from __future__ import annotations

from typing import Any

from bson import json_util

import database
from models import new_id, now_utc

# Index -> warum hier ein Mensch entscheidet.
MANUAL = {
    "platform_links.platform_external": "Ein fremdes Konto steht bei mehreren Personen - wem es gehört, ist eine "
                                        "Entscheidung; die Personen fragen und die falsche Verknüpfung im Admin lösen.",
    "billing_orders.booking_key": "Mehrere Rechnungsaufträge für dieselbe Buchung - mit der Buchhaltung klären, welcher "
                                  "gilt, und die anderen im Finanzbereich stornieren.",
}
# Index -> Reihenfolge, deren erste Zeile bleibt (sonst die älteste).
KEEP_ORDER = {
    "platform_links.user_platform": [("linked_at", -1), ("_id", -1)],
}
OLDEST = [("_id", 1)]


def _key(collection: str, name: str) -> str:
    return f"{collection}.{name}"


def known_indexes() -> list[str]:
    return [_key(collection, name) for collection, _keys, name, _options in database.AUDIT_UNIQUE_INDEXES]


def _fields(keys: Any) -> list[str]:
    return [keys] if isinstance(keys, str) else [field for field, _direction in keys]


def rule(index: str) -> str:
    if index in MANUAL:
        return MANUAL[index]
    if index in KEEP_ORDER:
        return "die zuletzt verknüpfte Zeile bleibt, wie beim Start (#1027)"
    return "die älteste Zeile bleibt - die liest und beschreibt die Anwendung"


async def _groups(db, collection: str, keys: Any, options: dict, order: list) -> list[list]:
    """Je Schlüssel mit mehr als einer Zeile die ``_id`` aller Zeilen, die bleibende zuerst. Fehlt ein Feld, zählt es wie
    ``null`` - so sieht es auch der Index."""
    match = dict(options.get("partialFilterExpression") or {})
    pipeline: list[dict] = [{"$match": match}] if match else []
    pipeline += [
        {"$sort": dict(order)},
        {"$group": {"_id": {field: {"$ifNull": [f"${field}", None]} for field in _fields(keys)},
                    "ids": {"$push": "$_id"}, "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": 1}}},
    ]
    rows = await getattr(db, collection).aggregate(pipeline).to_list(None)
    return [row["ids"] for row in rows]


async def _unique_active(db, collection: str, name: str) -> bool:
    return f"{name}_unique" in await getattr(db, collection).index_information()


def _selected(only: set[str] | None):
    for collection, keys, name, options in database.AUDIT_UNIQUE_INDEXES:
        if only is None or _key(collection, name) in only:
            yield collection, keys, name, options


async def plan(db, only: set[str] | None = None) -> list[dict]:
    """Der Trockenlauf: liest nur. Indizes, die schon eindeutig sind, können keine Dubletten haben."""
    report = []
    for collection, keys, name, options in _selected(only):
        index = _key(collection, name)
        active = await _unique_active(db, collection, name)
        groups = [] if active else await _groups(db, collection, keys, options, KEEP_ORDER.get(index, OLDEST))
        report.append({"index": index, "unique_active": active, "groups": len(groups),
                       "surplus": sum(len(ids) - 1 for ids in groups),
                       "mode": "manual" if index in MANUAL else "auto", "rule": rule(index)})
    return report


def render_text(report: list[dict], applied: bool = False) -> str:
    """Bericht für die Konsole - nur Zahlen und Regeln, keine Schlüssel."""
    lines = ["Eindeutige Indizes und Altdubletten (#1043)", ""]
    if not applied:
        lines += ["Trockenlauf - nichts wurde geändert.", ""]
    open_auto = 0
    for row in report:
        if row["unique_active"]:
            lines.append(f"  ok      {row['index']}: eindeutig")
            continue
        if not row["groups"]:
            lines.append(f"  frei    {row['index']}: keine Dubletten mehr - der eindeutige Index kommt beim nächsten Start "
                         "oder mit --anwenden")
            continue
        tag = "HAND" if row["mode"] == "manual" else "DUBLETTE"
        lines.append(f"  {tag:<8}{row['index']}: {row['groups']} Gruppen, {row['surplus']} überzählige Zeilen")
        lines.append(f"          Regel: {row['rule']}")
        if row["mode"] == "auto":
            open_auto += row["surplus"]
    lines.append("")
    if open_auto and not applied:
        lines.append(f"Mit --anwenden werden {open_auto} Zeilen entfernt; das Protokoll (JSON auf stdout) enthält jede "
                     "entfernte Zeile. Vorher eine Sicherung ziehen (BACKUP_RESTORE.md).")
    elif not open_auto:
        lines.append("Nichts automatisch zu bereinigen.")
    return "\n".join(lines) + "\n"


async def apply(db, actor: str, only: set[str] | None = None) -> dict:
    """Der ausdrückliche Lauf: überzählige Zeilen entfernen (nur ``auto``), dann den eindeutigen Index anlegen.

    Gelöscht wird je Zeile über ihre ``_id`` - was zwischen Suche und Löschung neu hinzukommt, bleibt unberührt; dann
    scheitert höchstens der Index wieder und der nächste Trockenlauf zeigt es."""
    started = now_utc()
    indexes, manual = [], []
    for collection, keys, name, options in _selected(only):
        index = _key(collection, name)
        if await _unique_active(db, collection, name):
            indexes.append({"index": index, "removed": 0, "unique_active": True, "removed_documents": []})
            continue
        groups = await _groups(db, collection, keys, options, KEEP_ORDER.get(index, OLDEST))
        if index in MANUAL:
            manual.append({"index": index, "groups": len(groups), "surplus": sum(len(ids) - 1 for ids in groups),
                           "rule": MANUAL[index]})
            continue
        target = getattr(db, collection)
        surplus = [row_id for ids in groups for row_id in ids[1:]]
        documents = await target.find({"_id": {"$in": surplus}}).to_list(None) if surplus else []
        removed = (await target.delete_many({"_id": {"$in": surplus}})).deleted_count if surplus else 0
        active = await database.unique_index(target, keys, name, **options)
        indexes.append({"index": index, "removed": removed, "unique_active": active,
                        "removed_documents": documents})
    protocol = {"at": started.isoformat(), "finished_at": now_utc().isoformat(), "actor": actor,
                "indexes": indexes, "manual": manual}
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "ops.unique_duplicates.apply", "actor_id": None, "target_id": None,
        "data": {"actor": actor, "removed": {row["index"]: row["removed"] for row in indexes if row["removed"]},
                 "unique_active": [row["index"] for row in indexes if row["unique_active"]],
                 "manual": [row["index"] for row in manual]},
        "created_at": protocol["finished_at"],
    })
    return protocol


def protocol_json(protocol: dict) -> str:
    """Das Protokoll als JSON, das sich mit ``mongoimport --jsonArray`` bzw. ``json_util`` zurückspielen lässt."""
    return json_util.dumps(protocol, indent=2, ensure_ascii=False)
