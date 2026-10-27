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
    "consent_decisions.open_decision": "Mehrere offene Einwilligungsaufträge für dieselbe Entscheidung - sie sind Nachweise "
                                       "und werden nie gelöscht: die überzähligen von Hand auf status „superseded“ setzen.",
    "prize_pickups.fastlap_place_user": "Mehrere Fast-Lap-Gewinne für denselben Platz und dieselbe Person - unter Gewinne "
                                        "prüfen, welcher gilt (ausgegebene nie löschen), die anderen von Hand entfernen.",
    "season_points.fastlap_source_user": "Doppelte Saisonpunkte für dieselbe Fast-Lap-Strecke und Person - in der "
                                         "Jahreswertung prüfen und die überzählige Zeile von Hand entfernen.",
    # Shop (#1703): Bestellungen, Positionen und Ereignisse sind Nachweise, der Katalog ist eine Entscheidung der Finanzen.
    **{f"shop_{index}": "Doppelte Shop-Daten - Bestellungen, Positionen und Ereignisse sind Nachweise und werden nie "
                        "automatisch gelöscht: mit den Finanzen klären, welche Zeile gilt (docs/SHOP.md)."
       for index in ("orders.idempotency_key", "orders.printful_external_id", "order_items.order_position",
                     "order_events.order_event")},
    **{f"shop_{index}": "Doppelter Eintrag im Shop-Katalog - die Finanzen entscheiden, welcher gilt, und benennen den "
                        "anderen um (docs/SHOP.md)."
       for index in ("products.slug", "variants.sku", "designs.design_version", "printful_variants.provider_variant")},
    # Printful-Adapter (#1705): ein Claim belegt, dass etwas an Printful ging oder geht - nie automatisch löschen.
    **{f"shop_{index}": "Doppelter Claim zu einem Printful-Auftrag - in Printful nachsehen, welcher Auftrag gilt, und den "
                        "überzähligen Claim von Hand entfernen (docs/SHOP.md, Printful-Adapter)."
       for index in ("printful_drafts.external_id", "printful_confirmations.order",
                     "printful_confirmations.idempotency_key")},
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


async def _groups(db, collection: str, keys: Any, options: dict, order: list) -> list[tuple[dict, list]]:
    """Je Schlüssel mit mehr als einer Zeile: der Schlüssel und die ``_id`` aller Zeilen, die bleibende zuerst. Fehlt ein
    Feld, zählt es wie ``null`` - so sieht es auch der Index."""
    match = dict(options.get("partialFilterExpression") or {})
    pipeline: list[dict] = [{"$match": match}] if match else []
    pipeline += [
        {"$sort": dict(order)},
        {"$group": {"_id": {field: {"$ifNull": [f"${field}", None]} for field in _fields(keys)},
                    "ids": {"$push": "$_id"}, "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": 1}}},
    ]
    rows = await getattr(db, collection).aggregate(pipeline).to_list(None)
    return [(dict(row["_id"]), row["ids"]) for row in rows]


def _unchanged(doc: dict, key: dict, match: dict) -> dict:
    """Bedingung fürs Löschen: dieselbe Zeile mit genau dem Stand, den das Protokoll festhält - und noch im selben
    Schlüssel. Hat sie ein laufender Schreiber seitdem geändert, trifft die Bedingung nicht und die Zeile bleibt."""
    return {**match, **key, **doc}


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
                       "surplus": sum(len(ids) - 1 for _key_value, ids in groups),
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
        lines.append("Bei laufendem Betrieb möglich, besser in ruhiger Zeit: Eine Zeile, die sich inzwischen geändert hat, "
                     "bleibt stehen und steht im Protokoll unter „skipped“.")
    elif not open_auto:
        lines.append("Nichts automatisch zu bereinigen.")
    return "\n".join(lines) + "\n"


async def apply(db, actor: str, only: set[str] | None = None) -> dict:
    """Der ausdrückliche Lauf: überzählige Zeilen entfernen (nur ``auto``), dann den eindeutigen Index anlegen.

    Bei laufendem Betrieb möglich, besser in ruhiger Zeit. Gelöscht wird je Zeile und nur bedingt (``_unchanged``):
    Hat ein Schreiber eine Zeile zwischen Suche und Löschung geändert, oder ist die bleibende Zeile nicht mehr da bzw.
    nicht mehr im Schlüssel, bleibt sie stehen und steht unter ``skipped``. Dann scheitert höchstens der Index wieder,
    und der nächste Trockenlauf zeigt es."""
    started = now_utc()
    indexes, manual = [], []
    for collection, keys, name, options in _selected(only):
        index = _key(collection, name)
        if await _unique_active(db, collection, name):
            indexes.append({"index": index, "removed": 0, "skipped": [], "unique_active": True, "removed_documents": []})
            continue
        groups = await _groups(db, collection, keys, options, KEEP_ORDER.get(index, OLDEST))
        if index in MANUAL:
            manual.append({"index": index, "groups": len(groups), "surplus": sum(len(ids) - 1 for _k, ids in groups),
                           "rule": MANUAL[index]})
            continue
        target = getattr(db, collection)
        match = dict(options.get("partialFilterExpression") or {})
        removed_documents: list[dict] = []
        skipped: list = []
        for key, ids in groups:
            keep, surplus = ids[0], ids[1:]
            if not await target.find_one({**match, **key, "_id": keep}, {"_id": 1}):
                skipped += surplus  # die bleibende Zeile hat sich geändert - die Gruppe bleibt, wie sie ist
                continue
            documents = await target.find({**match, **key, "_id": {"$in": surplus}}).to_list(None)
            gone = set(surplus) - {doc["_id"] for doc in documents}
            skipped += [row_id for row_id in surplus if row_id in gone]
            for doc in documents:
                if (await target.delete_one(_unchanged(doc, key, match))).deleted_count:
                    removed_documents.append(doc)
                else:
                    skipped.append(doc["_id"])
        active = await database.unique_index(target, keys, name, **options)
        indexes.append({"index": index, "removed": len(removed_documents), "skipped": [str(row_id) for row_id in skipped],
                        "unique_active": active, "removed_documents": removed_documents})
    protocol = {"at": started.isoformat(), "finished_at": now_utc().isoformat(), "actor": actor,
                "indexes": indexes, "manual": manual}
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "ops.unique_duplicates.apply", "actor_id": None, "target_id": None,
        "data": {"actor": actor, "removed": {row["index"]: row["removed"] for row in indexes if row["removed"]},
                 "skipped": {row["index"]: len(row["skipped"]) for row in indexes if row["skipped"]},
                 "unique_active": [row["index"] for row in indexes if row["unique_active"]],
                 "manual": [row["index"] for row in manual]},
        "created_at": protocol["finished_at"],
    })
    return protocol


def protocol_json(protocol: dict) -> str:
    """Das Protokoll als JSON, das sich mit ``mongoimport --jsonArray`` bzw. ``json_util`` zurückspielen lässt."""
    return json_util.dumps(protocol, indent=2, ensure_ascii=False)
