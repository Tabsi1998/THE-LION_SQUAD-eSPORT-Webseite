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
                            ``paid``, ``payment_state``) - der Stand wird regelmäßig nachgelesen
- ``cancelled``             Buchung storniert, bevor ein Beleg entstand
- ``failed``                nach mehreren Versuchen aufgegeben (``note``), „Erneut versuchen“ startet neu

Mit Schreibzugriff (Teil 2, ``services/dolibarr_billing``) bringt der Job jeden Auftrag bis zum
Beleg: Geschäftspartner sicherstellen, Rechnung anlegen (nie doppelt: ``ref_ext``), Stand
zurücklesen. Ohne Schreibzugriff sortiert er nur ein. Kein GET, keine Veröffentlichung, kein
Profil-Update erzeugt einen Auftrag - nur die bestätigte Buchung mit Preis-Snapshot.

**Nach dem Beleg (#321):** Ein Beleg wird nie still ersetzt, gelöscht oder umgeschrieben. Wird die
Buchung storniert oder geändert, obwohl der Beleg existiert, bleibt der Auftrag ``invoiced`` und
bekommt einen **Prüffall** (``services/billing_cases``); ``booking_state`` sagt, dass die Buchung
weg ist. Zahlungen liest die Website nur (Dolibarr ist führend): ``payment_state`` ist die Sicht
darauf - offen, teilweise bezahlt, bezahlt, überfällig, Überzahlung, gutgeschrieben, aufgegeben.
**Erstattungen** sind kein Beleg und keine Gutschrift: Die Finanzverwaltung erfasst am Auftrag,
was tatsächlich zurücküberwiesen wurde (Betrag, Tag, Referenz), nie mehr als bezahlt ist.
"""
from __future__ import annotations

import logging
import re

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
# Zahlungsstand aus Dolibarr (#321) - fachlich, getrennt vom technischen Abgleich (`synced_at`, `sync_error`).
PAYMENT_STATE_LABELS = {
    "draft": "Entwurf",
    "open": "offen",
    "partial": "teilweise bezahlt",
    "paid": "bezahlt",
    "overdue": "überfällig",
    "overpaid": "Überzahlung",
    "credited": "gutgeschrieben",
    "abandoned": "aufgegeben",
}
SETTLED_STATES = ("paid", "credited", "abandoned")
MAX_REFUND_REFERENCE = 120
MAX_REASON = 500


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


def paid_cents(order: dict, payments: list[dict] | None = None) -> int:
    """Was laut Dolibarr an Geld gekommen ist: die Summe der gebuchten Zahlungen. Eine Gutschrift
    ist keine Zahlung. Kennt die Website die Zahlungen nicht (Recht fehlt), gilt Summe minus Rest."""
    payments = order.get("payments") if payments is None else payments
    if payments is not None:
        return sum(int(row.get("amount_cents") or 0) for row in payments)
    total = int(order.get("total_cents") or 0)
    remaining = order.get("remaining_cents")
    if remaining is None:
        return total if order.get("paid") else 0
    return max(0, total - int(remaining))


def refunded_cents(order: dict) -> int:
    return sum(int(row.get("amount_cents") or 0) for row in order.get("refunds") or [])


def credited_cents(order: dict) -> int:
    return sum(int(row.get("total_cents") or 0) for row in order.get("credit_notes") or [])


async def cancel_orders_for(db, *, kind: str, registration_id: str, reason: str) -> int:
    """Buchung storniert: Aufträge ohne Beleg zu. Ein angelegter Beleg bleibt - er wird zum Prüffall,
    die Buchung ist am Auftrag als weg vermerkt (#321)."""
    from services import billing_cases

    now = now_utc().isoformat()
    result = await db.billing_orders.update_many(
        {"kind": kind, "registration_id": registration_id, "status": {"$in": list(OPEN_STATUSES) + ["held"]}},
        {"$set": {"status": "cancelled", "cancel_reason": reason, "updated_at": now}},
    )
    count = int(result.modified_count)
    async for order in db.billing_orders.find({"kind": kind, "registration_id": registration_id, "status": "invoiced", "booking_state": {"$ne": "cancelled"}}, {"_id": 0}):
        await db.billing_orders.update_one({"id": order["id"]}, {"$set": {
            "booking_state": "cancelled", "booking_cancelled_at": now, "cancel_reason": reason, "paid_cents_at_cancel": paid_cents(order), "updated_at": now,
        }})
        await billing_cases.open_case(db, order, "cancelled_after_invoice", {"reason": reason, "invoice_ref": order.get("invoice_ref") or "", "paid_cents": paid_cents(order),
                                                                            "invoice_status": order.get("invoice_status")})
        count += 1
    return count


async def note_change_after_invoice(db, *, kind: str, registration_id: str, reason: str, new_total_cents: int) -> dict | None:
    """Begleitpersonen, Roster oder Positionen ändern sich, obwohl der Beleg schon existiert: der
    eingefrorene Preis bleibt, die Finanzverwaltung bekommt einen Prüffall mit alt und neu."""
    from services import billing_cases

    order = await db.billing_orders.find_one({"kind": kind, "registration_id": registration_id, "status": "invoiced"}, {"_id": 0})
    if not order:
        return None
    now = now_utc().isoformat()
    await db.billing_orders.update_one({"id": order["id"]}, {"$set": {"booking_changed_at": now, "booking_change": reason, "updated_at": now}})
    return await billing_cases.open_case(db, order, "changed_after_invoice", {
        "reason": reason, "invoiced_cents": int(order.get("total_cents") or 0), "new_total_cents": int(new_total_cents), "invoice_ref": order.get("invoice_ref") or "",
    })


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


async def sync_due(limit: int = 50, *, full: bool = False, order_ids: list[str] | None = None) -> dict:
    """Stand angelegter Belege nachlesen - nur mit Anbindung im Modus „live“. `full` liest alle
    Belege (auch bezahlte) neu: der tägliche Abgleich und „Alles abgleichen“."""
    from services.dolibarr_billing import sync_invoiced
    from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings

    db = get_db()
    settings = await load_settings(db)
    empty = {"looked": 0, "changed": 0, "paid": 0, "cases": 0, "errors": 0}
    if settings.get("mode") != "live":
        return empty
    try:
        client = DolibarrClient(settings)
    except DolibarrError:
        return empty
    return await sync_invoiced(db, settings, client, limit, full=full, order_ids=order_ids)


async def reconcile_due() -> dict:
    """Der tägliche Abgleich (#321): jeden Beleg neu lesen - auch bezahlte, damit eine spätere
    Gutschrift, Rückbuchung oder Löschung in Dolibarr nicht unbemerkt bleibt."""
    return await sync_due(500, full=True)


async def retry_order(db, order_id: str, actor_id: str) -> dict | None:
    """„Erneut versuchen“ für gescheiterte Aufträge - Zähler auf null, zurück auf neu."""
    await db.billing_orders.update_one({"id": order_id, "status": "failed"}, {"$set": {"status": "pending", "attempts": 0, "note": "", "retried_by": actor_id, "updated_at": now_utc().isoformat()}})
    return await db.billing_orders.find_one({"id": order_id}, {"_id": 0})


class RefundError(ValueError):
    """Eine Erstattung, die so nicht stimmt - der Text ist für die Finanzverwaltung."""


async def add_refund(db, order: dict, actor_id: str, *, amount_cents: int, paid_on: str, reference: str, reason: str) -> dict:
    """Rückzahlung erfassen, nachdem sie außerhalb der Website passiert ist (Überweisung, bar).
    Nie mehr als bezahlt, nie ohne Grund; kein Auslöser für irgendetwas in Dolibarr."""
    amount = int(amount_cents)
    if amount <= 0:
        raise RefundError("Der Betrag muss größer als null sein.")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(paid_on or "")):
        raise RefundError("Der Tag der Rückzahlung fehlt (JJJJ-MM-TT).")
    if not (reason or "").strip():
        raise RefundError("Ein Grund ist Pflicht (z. B. „Begleitperson entfallen, Gutschrift GA2026-0003“).")
    refundable = paid_cents(order) - refunded_cents(order)
    if amount > refundable:
        from services.pricing import format_cents
        raise RefundError(f"Erstattbar sind höchstens {format_cents(max(0, refundable), order.get('currency') or 'EUR')} (bezahlt abzüglich schon erstattet).")
    refund = {
        "id": new_id(), "amount_cents": amount, "paid_on": paid_on, "reference": (reference or "").strip()[:MAX_REFUND_REFERENCE],
        "reason": reason.strip()[:MAX_REASON], "recorded_by": actor_id, "recorded_at": now_utc().isoformat(),
    }
    await db.billing_orders.update_one({"id": order["id"]}, {"$push": {"refunds": refund}, "$set": {"updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "billing.refund.record", "target_id": order["id"], "actor_id": actor_id,
                                    "data": {"registration_id": order.get("registration_id"), "amount_cents": amount, "paid_on": paid_on, "reason": refund["reason"]},
                                    "created_at": now_utc().isoformat()})
    return refund


def _row_query(*, kind: str | None = None, source_id: str | None = None, user_ids: list[str] | None = None) -> dict:
    query: dict = {}
    if kind in ("event", "tournament"):
        query["kind"] = kind
    if source_id:
        query["source_id"] = source_id
    if user_ids is not None:
        query["user_id"] = {"$in": list(user_ids)}
    return query


async def overview(db, *, kind: str | None = None, source_id: str | None = None, user_ids: list[str] | None = None) -> dict:
    """Für die Finanzübersicht (#322): Zahlen je Status, die offenen Aufträge, die angelegten Belege
    mit Zahlungsstand, die offenen Prüffälle."""
    from services import billing_cases

    base = _row_query(kind=kind, source_id=source_id, user_ids=user_ids)
    by_status: dict[str, int] = {}
    async for row in db.billing_orders.aggregate([{"$match": base}, {"$group": {"_id": "$status", "n": {"$sum": 1}, "cents": {"$sum": "$total_cents"}}}]):
        by_status[row["_id"]] = {"count": int(row["n"]), "total_cents": int(row.get("cents") or 0)}
    open_orders = await db.billing_orders.find({**base, "status": {"$in": list(OPEN_STATUSES) + ["held", "failed"]}}, {"_id": 0, "snapshot": 0}).sort("created_at", 1).to_list(200)
    invoiced = await db.billing_orders.find({**base, "status": "invoiced"}, {"_id": 0, "snapshot": 0, "payments": 0}).sort("updated_at", -1).to_list(250)
    cases = await billing_cases.list_cases(db, "open")
    if base:
        cases = [case for case in cases if (not source_id or case.get("source_id") == source_id) and (kind not in ("event", "tournament") or case.get("source_kind") == kind)
                 and (user_ids is None or case.get("user_id") in user_ids)]
    return {"by_status": by_status, "labels": STATUS_LABELS, "payment_labels": PAYMENT_STATE_LABELS, "open": open_orders, "invoiced": invoiced,
            "cases": cases, "cases_open": await billing_cases.open_count(db)}


async def source_summary(db, kind: str, source_id: str) -> dict:
    """Die Zahlen einer Veranstaltung (#322), getrennt statt in einen Topf: gebucht, fakturiert,
    bezahlt, offen, gutgeschrieben, erstattet - jede Belegrevision nur einmal."""
    totals = {"booked_cents": 0, "invoiced_cents": 0, "paid_cents": 0, "open_cents": 0, "credited_cents": 0, "refunded_cents": 0,
              "orders": 0, "cancelled_orders": 0, "cases_open": 0}
    async for order in db.billing_orders.find({"kind": kind, "source_id": source_id}, {"_id": 0, "snapshot": 0}):
        totals["orders"] += 1
        if order.get("status") == "cancelled":
            totals["cancelled_orders"] += 1
            continue
        total = int(order.get("total_cents") or 0)
        if order.get("booking_state") != "cancelled":
            totals["booked_cents"] += total
        if order.get("status") == "invoiced":
            totals["invoiced_cents"] += total
            paid = paid_cents(order)
            totals["paid_cents"] += paid
            totals["credited_cents"] += credited_cents(order)
            if order.get("payment_state") in ("open", "partial", "overdue"):
                remaining = order.get("remaining_cents")
                totals["open_cents"] += max(0, int(remaining)) if remaining is not None else max(0, total - paid)
        totals["refunded_cents"] += refunded_cents(order)
    totals["cases_open"] = int(await db.billing_cases.count_documents({"source_kind": kind, "source_id": source_id, "status": "open"}))
    return totals


async def anonymize_user(db, user_id: str) -> int:
    """Kontolöschung (#322): Belege bleiben in Dolibarr (Aufbewahrung nach BAO), der Auftrag hier
    behält Betrag, Belegnummer und Zeitpunkte - aber keinen Namen und keine E-Mail mehr. Die
    Zuordnung Konto ↔ Geschäftspartner fällt weg."""
    now = now_utc().isoformat()
    result = await db.billing_orders.update_many({"user_id": user_id}, {"$set": {
        "snapshot.recipient.display_name": "Gelöschter User", "snapshot.recipient.email": None, "anonymized_at": now, "updated_at": now,
    }})
    await db.billing_customers.delete_many({"user_id": user_id})
    return int(result.modified_count)
