"""Rechnungsauftrag nach einem Abbruch ohne Zutun nachholen (#1042).

Anmeldung, Preis und Auftrag werden nacheinander gespeichert. Bricht es nach dem Preis ab, holt seit #1490/#1491 die
Wiederholung derselben Anmeldung den Auftrag nach (``tournament_fees.repair_order``, ``event_registration.repair_order``).
Nur wiederholt nicht jede: wer angemeldet ist, meldet sich nicht noch einmal an, und Freigabe oder Nachrücken durch die
Verwaltung kennt keine Wiederholung. Darum sieht der Rechnungs-Job (``scheduler._safe_billing_orders``) vor dem
Einsortieren nach: jede verbindliche Anmeldung mit eingefrorenem Preis, zu dem es keinen Auftrag gibt, bekommt ihn über
dieselbe ``repair_order`` - genau einmal, der eindeutige ``booking_key`` fängt auch ein Rennen mit der Anmeldung ab.

Ohne eingefrorenen Preis friert der Job nichts ein: ein Preis entsteht nur mit der Zusage der zahlenden Person.
Ausgelassen werden auch Anmeldungen zu abgesagten oder gelöschten Events und Turnieren - und alte Preise ohne Hash:
ohne ``booking_key`` könnten zwei Läufe gleichzeitig je einen Auftrag anlegen. Sie zählen als ``needs_review`` und
stehen im Log; nachgeholt werden sie von Hand oder über die Wiederholung der Anmeldung.
"""
from __future__ import annotations

import logging

from services import billing_orders, event_registration, tournament_fees

logger = logging.getLogger("tls.billing")

BATCH = 200
OPEN_BILLING = [None, "pending"]
CLOSED_PARENTS = {"cancelled"}


def _candidates(statuses) -> dict:
    return {"status": {"$in": list(statuses)}, "billing_status": {"$in": OPEN_BILLING}, "price_snapshot.total_cents": {"$gt": 0}}


async def _missing(db, kind: str, rows: list[dict], counts: dict) -> list[dict]:
    """Die Anmeldungen dieser Charge, zu deren eingefrorenem Preis kein Auftrag besteht (auch kein stornierter).

    Ein Preis ohne Hash hat keinen ``booking_key`` - ohne ihn ist das Nachholen nicht sicher genau einmal. Er wird
    nicht geraten, sondern als ``needs_review`` gezählt und gemeldet."""
    keys = {row["id"]: billing_orders.booking_key(kind, row["id"], row.get("price_snapshot")) for row in rows}
    for row_id, key in keys.items():
        if not key:
            counts["needs_review"] += 1
            logger.warning("Rechnungsauftrag nicht nachgeholt: Preis ohne Hash, Nacharbeit nötig (%s %s)", kind, row_id)
    known = {order["booking_key"] async for order in db.billing_orders.find(
        {"booking_key": {"$in": [key for key in keys.values() if key]}}, {"_id": 0, "booking_key": 1})}
    return [row for row in rows if keys[row["id"]] and keys[row["id"]] not in known]


async def _repair_kind(db, kind: str, collection, parents, statuses, parent_field: str, repair, counts: dict) -> None:
    cursor = collection.find(_candidates(statuses), {"_id": 0}).sort("id", 1)
    batch: list[dict] = []

    async def flush():
        counts["looked"] += len(batch)
        for row in await _missing(db, kind, batch, counts):
            parent = await parents.find_one({"id": row.get(parent_field)}, {"_id": 0, "id": 1, "billing": 1, "status": 1})
            if not parent or parent.get("status") in CLOSED_PARENTS:
                # Gelöscht oder abgesagt: keine Rechnung im Nachhinein.
                counts["skipped"] += 1
                continue
            try:
                if await repair(db, parent, row):
                    counts["repaired"] += 1
            except Exception:  # noqa: BLE001 - eine Anmeldung hält die anderen nicht auf; der nächste Lauf versucht es wieder
                counts["errors"] += 1
                logger.warning("Rechnungsauftrag konnte nicht nachgeholt werden (%s %s)", kind, row.get("id"), exc_info=True)
        batch.clear()

    async for row in cursor:
        batch.append(row)
        if len(batch) >= BATCH:
            await flush()
    if batch:
        await flush()


async def _repair_event(db, event: dict, registration: dict):
    return await event_registration.repair_order(db, event, registration)


async def _repair_tournament(db, tournament: dict, registration: dict):
    return await tournament_fees.repair_order(db, registration, tournament, actor=None)


async def repair_missing_orders(db) -> dict:
    """Jeden eingefrorenen Preis ohne Auftrag nachholen - Event-Anmeldungen und Turnier-Startgelder."""
    counts = {"looked": 0, "repaired": 0, "errors": 0, "skipped": 0, "needs_review": 0}
    await _repair_kind(db, "event", db.event_registrations, db.events, event_registration.ACTIVE_STATUSES, "event_id",
                       _repair_event, counts)
    await _repair_kind(db, "tournament", db.tournament_registrations, db.tournaments, tournament_fees.BILLABLE_STATUSES,
                       "tournament_id", _repair_tournament, counts)
    return counts
