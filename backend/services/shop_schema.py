"""Shop-Datenmodell anlegen, prüfen und zurücknehmen (#1703) - Migration 13 und ``scripts/shop_schema.py``.

Die Indizes selbst stehen an einer Stelle: ``database.AUDIT_UNIQUE_INDEXES`` und ``database.AUDIT_INDEXES`` (alle
Einträge der Sammlungen ``shop_*``). Damit legt sie jeder Start an, und die Prüfung „Eindeutige Indizes“ unter
Betrieb → Checks meldet einen fehlenden. Dieses Modul nimmt nur den Shop-Teil daraus:

1. ``plan`` - der Trockenlauf: welche Shop-Indizes fehlen, wie viele Zeilen je Shop-Sammlung. Liest nur.
2. ``apply`` - legt fehlende Indizes an (eindeutige über ``database.unique_index``, wie beim Start). Mehrfach
   aufrufbar; Migration 13 ruft es einmal und vermerkt das in ``schema_migrations``.
3. ``rollback`` - der Rückweg: entfernt die Shop-Indizes und trägt Migration 13 aus. Ohne ``apply=True`` nur der
   Bericht. Hat eine Shop-Sammlung Daten, verweigert er - Bestellungen werden nie von einem Werkzeug gelöscht.
   Danach die ältere Version einspielen (``scripts/rollback-release.sh``); läuft die neue weiter, legt der nächste
   Start die Indizes wieder an.

Die Sammlungen entstehen mit ihrer ersten Zeile; leere Sammlungen legt MongoDB nicht an, und der Rückweg entfernt
keine Sammlung.
"""
from __future__ import annotations

from typing import Any

import database

MIGRATION_VERSION = 13
MIGRATION_NAME = "shop_data_model"
COLLECTIONS = ("shop_products", "shop_variants", "shop_designs", "shop_design_profiles", "shop_design_colors",
               "shop_printful_variants", "shop_carts", "shop_orders", "shop_order_items", "shop_order_events",
               "shop_printful_drafts", "shop_printful_confirmations", "shop_gamertag_files")


def unique_indexes() -> list[tuple[str, Any, str, dict]]:
    return [row for row in database.AUDIT_UNIQUE_INDEXES if row[0] in COLLECTIONS]


def plain_indexes() -> list[tuple[str, Any]]:
    return [row for row in database.AUDIT_INDEXES if row[0] in COLLECTIONS]


def _plain_name(keys: Any) -> str:
    """Der Name, den MongoDB einem gewöhnlichen Index gibt (``user_id_1``, ``status_1_created_at_-1``)."""
    if isinstance(keys, str):
        return f"{keys}_1"
    return "_".join(f"{field}_{direction}" for field, direction in keys)


def _collection(db, name: str):
    if name not in COLLECTIONS:
        raise ValueError(f"keine Shop-Sammlung: {name}")
    return db.get_collection(name)


async def _existing(db) -> dict[str, set[str]]:
    present = set(await db.list_collection_names())
    out: dict[str, set[str]] = {}
    for name in COLLECTIONS:
        out[name] = set(await _collection(db, name).index_information()) if name in present else set()
    return out


async def plan(db) -> dict:
    """Trockenlauf: fehlende Indizes und Zeilen je Shop-Sammlung (nur Sammlungen mit Zeilen). Schreibt nichts."""
    existing = await _existing(db)
    present = set(await db.list_collection_names())
    documents = {}
    for name in COLLECTIONS:
        if name in present:
            count = await _collection(db, name).count_documents({})
            if count:
                documents[name] = count
    return {
        "missing_unique": sorted(f"{collection}.{name}" for collection, _keys, name, _options in unique_indexes()
                                 if f"{name}_unique" not in existing[collection]),
        "missing_plain": sorted(f"{collection}.{_plain_name(keys)}" for collection, keys in plain_indexes()
                                if _plain_name(keys) not in existing[collection]),
        "documents": documents,
    }


async def apply(db) -> str:
    """Fehlende Shop-Indizes anlegen. Die Sammlungen sind neu - ein eindeutiger Index, der trotzdem an Dubletten
    scheitert, steht wie beim Start als gewöhnlicher da und unter Betrieb → Checks."""
    ready = blocked = 0
    for collection, keys, name, options in unique_indexes():
        if await database.unique_index(_collection(db, collection), keys, name, **options):
            ready += 1
        else:
            blocked += 1
    for collection, keys in plain_indexes():
        await _collection(db, collection).create_index(keys)
        ready += 1
    return f"{ready} shop indexes ready, {blocked} blocked by duplicates"


async def rollback(db, *, apply: bool = False) -> dict:
    """Rückweg: Shop-Indizes entfernen und Migration 13 austragen - nur, solange keine Shop-Sammlung Daten hat."""
    existing = await _existing(db)
    blocked_by = (await plan(db))["documents"]
    drop = []
    for collection, _keys, name, _options in unique_indexes():
        drop += [f"{collection}.{index}" for index in (f"{name}_unique", f"{name}_plain")
                 if index in existing[collection]]
    for collection, keys in plain_indexes():
        if _plain_name(keys) in existing[collection]:
            drop.append(f"{collection}.{_plain_name(keys)}")
    report = {"applied": False, "drop": drop, "blocked_by": blocked_by}
    if not apply or blocked_by:
        return report
    for item in drop:
        collection, index = item.split(".", 1)
        await _collection(db, collection).drop_index(index)
    await db.schema_migrations.delete_many({"version": MIGRATION_VERSION, "name": MIGRATION_NAME})
    report["applied"] = True
    return report


async def migrate_shop_data_model(db) -> str:
    """Migration 13 (#1703): das Shop-Datenmodell - Indizes für Idempotenz, Katalog und Bestellungen."""
    return await apply(db)


def render_text(report: dict, *, way_back: dict | None = None) -> str:
    lines = ["Shop-Datenmodell (#1703, docs/SHOP.md)"]
    for index in report["missing_unique"]:
        lines.append(f"  fehlt   {index} (eindeutig)")
    for index in report["missing_plain"]:
        lines.append(f"  fehlt   {index}")
    if not report["missing_unique"] and not report["missing_plain"]:
        lines.append("  ok      alle Shop-Indizes vorhanden")
    for collection, count in sorted(report["documents"].items()):
        lines.append(f"  Daten   {collection}: {count} Zeilen")
    if way_back is not None:
        if way_back["blocked_by"]:
            lines.append("Rückweg verweigert: Shop-Sammlungen haben Daten - zuerst mit den Finanzen klären.")
        elif way_back["applied"]:
            lines.append(f"Rückweg ausgeführt: {len(way_back['drop'])} Indizes entfernt, "
                         f"Migration {MIGRATION_VERSION} ausgetragen.")
        else:
            lines.append(f"Rückweg (Trockenlauf): {len(way_back['drop'])} Indizes würden entfernt - "
                         "mit --anwenden ausführen.")
    return "\n".join(lines) + "\n"
