"""Rechnungsaufträge (#317, Grundlage): dauerhaftes Postfach zwischen Buchung und Dolibarr.

Eine bestätigte, kostenpflichtige Buchung schreibt einen **Auftrag** in ``billing_orders`` - in
derselben Datenbank wie die Buchung, nie nur im Prozessspeicher. Ein Job sieht regelmäßig nach
und bringt jeden Auftrag einen Schritt weiter. Was er dafür braucht, sagt der Status:

- ``pending``               neu, noch nicht angesehen
- ``waiting_write_access``  Dolibarr ist angebunden, aber ohne Schreibzugriff (eigener Schlüssel fehlt)
- ``waiting_link``          die Person hat noch keinen Geschäftspartner in Dolibarr
- ``waiting_review``        in Dolibarr gibt es schon einen Geschäftspartner mit derselben E-Mail -
                            die Finanzverwaltung ordnet zu oder lässt neu anlegen
- ``held``                  Rechnungszeitpunkt „erst nach Freigabe“ - wartet auf die Finanzverwaltung
- ``invoiced``              Beleg in Dolibarr angelegt (``invoice_id``, ``invoice_ref``, ``invoice_status``,
                            ``paid``) - der Stand wird regelmäßig nachgelesen
- ``cancelled``             Buchung storniert, bevor ein Beleg entstand
- ``failed``                nach mehreren Versuchen aufgegeben (``note``), „Erneut versuchen“ startet neu

Mit Schreibzugriff (Teil 2, ``services/dolibarr_billing``) bringt der Job jeden Auftrag bis zum
Beleg: Geschäftspartner sicherstellen, Rechnung anlegen (nie doppelt: ``ref_ext``), Stand
zurücklesen. Ohne Schreibzugriff sortiert er nur ein. Kein GET, keine Veröffentlichung, kein
Profil-Update erzeugt einen Auftrag - nur die bestätigte Buchung mit Preis-Snapshot.
"""
from __future__ import annotations

import logging

from database import get_db
from models import new_id, now_utc

logger = logging.getLogger("tls.billing")

OPEN_STATUSES = ("pending", "waiting_write_access", "waiting_link", "waiting_review", "ready")
STATUS_LABELS = {
    "pending": "neu",
    "waiting_write_access": "wartet auf Schreibzugriff",
    "waiting_link": "wartet auf Geschäftspartner",
    "waiting_review": "Zuordnung prüfen",
    "ready": "bereit",
    "held": "wartet auf Freigabe",
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
    """Der Job: offene Aufträge einsortieren und - mit Schreibzugriff - bis zum Beleg bringen."""
    from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings, write_capable

    db = get_db()
    settings = await load_settings(db)
    connected = settings.get("mode") != "off"
    can_write = write_capable(settings)
    counts = {"looked": 0, "invoiced": 0, "waiting_write_access": 0, "waiting_link": 0, "waiting_review": 0, "not_connected": 0, "failed": 0, "pending": 0}
    orders = await db.billing_orders.find({"status": {"$in": ["pending", "waiting_write_access", "waiting_link", "ready"]}}, {"_id": 0}).sort("created_at", 1).to_list(limit)
    if not orders:
        return counts
    client = None
    if connected and can_write:
        try:
            client = DolibarrClient(settings)
        except DolibarrError:
            client = None
    for order in orders:
        counts["looked"] += 1
        if not connected:
            status, note = "waiting_write_access", "Die Mitgliederverwaltung ist nicht angebunden."
            counts["not_connected"] += 1
        elif not can_write or client is None:
            status, note = "waiting_write_access", "Für Rechnungen fehlt der Schreibzugriff (Einstellungen → Dolibarr → Schreibzugriff einschalten)."
            counts["waiting_write_access"] += 1
        else:
            from services.dolibarr_billing import process_order
            status = await process_order(db, settings, client, order)
            counts[status if status in counts else "pending"] += 1
            continue
        if status != order.get("status") or note != order.get("note"):
            await db.billing_orders.update_one({"id": order["id"]}, {"$set": {"status": status, "note": note, "updated_at": now_utc().isoformat()}})
    return counts


async def sync_due(limit: int = 50) -> dict:
    """Stand angelegter Belege nachlesen - nur mit Anbindung im Modus „live“."""
    from services.dolibarr_billing import sync_invoiced
    from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings

    db = get_db()
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return {"looked": 0, "changed": 0, "paid": 0}
    try:
        client = DolibarrClient(settings)
    except DolibarrError:
        return {"looked": 0, "changed": 0, "paid": 0}
    return await sync_invoiced(db, settings, client, limit)


async def retry_order(db, order_id: str, actor_id: str) -> dict | None:
    """„Erneut versuchen“ für gescheiterte Aufträge - Zähler auf null, zurück auf neu."""
    await db.billing_orders.update_one({"id": order_id, "status": "failed"}, {"$set": {"status": "pending", "attempts": 0, "note": "", "retried_by": actor_id, "updated_at": now_utc().isoformat()}})
    return await db.billing_orders.find_one({"id": order_id}, {"_id": 0})


async def overview(db) -> dict:
    """Für die Finanzübersicht (#322): Zahlen je Status und die offenen Aufträge."""
    by_status: dict[str, int] = {}
    async for row in db.billing_orders.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}, "cents": {"$sum": "$total_cents"}}}]):
        by_status[row["_id"]] = {"count": int(row["n"]), "total_cents": int(row.get("cents") or 0)}
    open_orders = await db.billing_orders.find({"status": {"$in": list(OPEN_STATUSES) + ["held", "failed"]}}, {"_id": 0, "snapshot": 0}).sort("created_at", 1).to_list(200)
    invoiced = await db.billing_orders.find({"status": "invoiced"}, {"_id": 0, "snapshot": 0}).sort("updated_at", -1).to_list(50)
    return {"by_status": by_status, "labels": STATUS_LABELS, "open": open_orders, "invoiced": invoiced}
