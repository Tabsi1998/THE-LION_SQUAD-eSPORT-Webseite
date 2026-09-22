"""Rechnungsaufträge (#317, Grundlage): dauerhaftes Postfach zwischen Buchung und Dolibarr.

Eine bestätigte, kostenpflichtige Buchung schreibt einen **Auftrag** in ``billing_orders`` - in
derselben Datenbank wie die Buchung, nie nur im Prozessspeicher. Ein Job sieht regelmäßig nach
und bringt jeden Auftrag einen Schritt weiter. Was er dafür braucht, sagt der Status:

- ``pending``               neu, noch nicht angesehen
- ``waiting_write_access``  Dolibarr ist angebunden, aber ohne Schreibzugriff (eigener Schlüssel fehlt)
- ``waiting_link``          die Person hat noch keinen Geschäftspartner in Dolibarr
- ``ready``                 alles da - die Rechnung kann angelegt werden (Teil 2, #317)
- ``invoiced``              Beleg in Dolibarr angelegt (``invoice_id``, ``invoice_ref``)
- ``cancelled``             Buchung storniert, bevor ein Beleg entstand
- ``failed``                dauerhaft gescheitert (``error``), sichtbar in der Finanzübersicht

Der Job legt in diesem Teil **keine** Belege an: Er sortiert die Aufträge ein, damit die
Finanzübersicht zeigt, was fehlt. Kein GET, keine Veröffentlichung, kein Profil-Update erzeugt
einen Auftrag - nur die bestätigte Buchung mit Preis-Snapshot.
"""
from __future__ import annotations

import logging

from database import get_db
from models import new_id, now_utc

logger = logging.getLogger("tls.billing")

OPEN_STATUSES = ("pending", "waiting_write_access", "waiting_link", "ready")
STATUS_LABELS = {
    "pending": "neu",
    "waiting_write_access": "wartet auf Schreibzugriff",
    "waiting_link": "wartet auf Geschäftspartner",
    "ready": "bereit",
    "invoiced": "Rechnung angelegt",
    "cancelled": "storniert",
    "failed": "gescheitert",
}


async def create_order(db, *, kind: str, source_id: str, registration_id: str, user_id: str, snapshot: dict, timing: str) -> dict | None:
    """Ein Auftrag je Buchung. Gibt es schon einen offenen oder erledigten, bleibt er."""
    if int(snapshot.get("total_cents") or 0) <= 0:
        return None
    existing = await db.billing_orders.find_one({"kind": kind, "registration_id": registration_id, "status": {"$nin": ["cancelled", "failed"]}}, {"_id": 0})
    if existing:
        return existing
    order = {
        "id": new_id(),
        "kind": kind,
        "source_id": source_id,
        "registration_id": registration_id,
        "user_id": user_id,
        "snapshot": snapshot,
        "total_cents": int(snapshot["total_cents"]),
        "currency": snapshot.get("currency") or "EUR",
        "timing": timing,                      # on_confirm | manual
        "status": "pending" if timing == "on_confirm" else "held",
        "attempts": 0,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.billing_orders.insert_one(order)
    order.pop("_id", None)
    return order


async def cancel_orders_for(db, *, kind: str, registration_id: str, reason: str) -> int:
    """Buchung storniert, bevor ein Beleg entstand: Auftrag zu. Ein angelegter Beleg bleibt (Storno = #321)."""
    result = await db.billing_orders.update_many(
        {"kind": kind, "registration_id": registration_id, "status": {"$in": list(OPEN_STATUSES) + ["held"]}},
        {"$set": {"status": "cancelled", "cancel_reason": reason, "updated_at": now_utc().isoformat()}},
    )
    return int(result.modified_count)


async def release_order(db, order_id: str, actor_id: str) -> dict | None:
    """Rechnungszeitpunkt „bewusst später“: die Freigabe durch die Finanzverwaltung."""
    await db.billing_orders.update_one({"id": order_id, "status": "held"}, {"$set": {"status": "pending", "released_by": actor_id, "released_at": now_utc().isoformat(), "updated_at": now_utc().isoformat()}})
    return await db.billing_orders.find_one({"id": order_id}, {"_id": 0})


async def classify_due(limit: int = 100) -> dict:
    """Der Job: jeden offenen Auftrag einsortieren. Legt in diesem Teil keine Belege an."""
    from services.dolibarr_client import load_settings, write_capable
    from services.dolibarr_links import verified_link

    db = get_db()
    settings = await load_settings(db)
    connected = settings.get("mode") != "off"
    can_write = write_capable(settings)
    counts = {"looked": 0, "ready": 0, "waiting_write_access": 0, "waiting_link": 0, "not_connected": 0}
    orders = await db.billing_orders.find({"status": {"$in": ["pending", "waiting_write_access", "waiting_link"]}}, {"_id": 0}).sort("created_at", 1).to_list(limit)
    for order in orders:
        counts["looked"] += 1
        if not connected:
            status, note = "waiting_write_access", "Die Mitgliederverwaltung ist nicht angebunden."
            counts["not_connected"] += 1
        elif not can_write:
            status, note = "waiting_write_access", "Für Rechnungen fehlt der Schreibzugriff (eigener API-Schlüssel unter Einstellungen → Dolibarr)."
            counts["waiting_write_access"] += 1
        else:
            link = await verified_link(db, settings, order["user_id"])
            if not link or not link.get("thirdparty_id"):
                status, note = "waiting_link", "Die Person hat noch keinen Geschäftspartner in Dolibarr."
                counts["waiting_link"] += 1
            else:
                status, note = "ready", ""
                counts["ready"] += 1
        if status != order.get("status") or note != order.get("note"):
            await db.billing_orders.update_one({"id": order["id"]}, {"$set": {"status": status, "note": note, "updated_at": now_utc().isoformat()}})
    return counts


async def overview(db) -> dict:
    """Für die Finanzübersicht (#322): Zahlen je Status und die offenen Aufträge."""
    by_status: dict[str, int] = {}
    async for row in db.billing_orders.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}, "cents": {"$sum": "$total_cents"}}}]):
        by_status[row["_id"]] = {"count": int(row["n"]), "total_cents": int(row.get("cents") or 0)}
    open_orders = await db.billing_orders.find({"status": {"$in": list(OPEN_STATUSES) + ["held", "failed"]}}, {"_id": 0, "snapshot": 0}).sort("created_at", 1).to_list(200)
    return {"by_status": by_status, "labels": STATUS_LABELS, "open": open_orders}
