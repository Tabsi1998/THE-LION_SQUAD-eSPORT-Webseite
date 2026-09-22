"""Finanzverwaltung (#322): Übersicht der Rechnungsaufträge, Freigabe zurückgehaltener Aufträge.

Nur der Bereich „Finanzen“ (mit Zwei-Faktor). Kein Rechnungs- oder Sync-Dienst - der lebt in
``services/billing_orders`` und (Teil 2) im Dolibarr-Adapter.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from auth import require_area
from database import get_db
from models import new_id, now_utc
from pydantic import BaseModel, Field

from services import billing_orders, pricing
from services.dolibarr_billing import MAX_EXTRA_TEXT, assign_thirdparty, booking_facts, invoice_text_preview, service_view, terms_complete
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings, write_capable

router = APIRouter(prefix="/api/admin/finance", tags=["finance"])


@router.get("/overview")
async def finance_overview(me: dict = Depends(require_area("finance"))):
    db = get_db()
    settings = await load_settings(db)
    data = await billing_orders.overview(db)
    # Namen der Angebote dazu, damit die Liste ohne zweite Abfrage lesbar ist.
    event_ids = sorted({row["source_id"] for row in data["open"] + data["invoiced"] if row.get("kind") == "event"})
    tournament_ids = sorted({row["source_id"] for row in data["open"] + data["invoiced"] if row.get("kind") == "tournament"})
    names = {}
    if event_ids:
        async for event in db.events.find({"id": {"$in": event_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1}):
            names[event["id"]] = {"name": event.get("name"), "slug": event.get("slug"), "kind": "event"}
    if tournament_ids:
        async for tournament in db.tournaments.find({"id": {"$in": tournament_ids}}, {"_id": 0, "id": 1, "title": 1, "slug": 1}):
            names[tournament["id"]] = {"name": f"Startgeld {tournament.get('title')}", "slug": tournament.get("slug"), "kind": "tournament"}
    user_ids = sorted({row["user_id"] for row in data["open"] + data["invoiced"]})
    people = {}
    if user_ids:
        async for user in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}):
            people[user["id"]] = user.get("display_name") or user.get("username")
    for row in data["open"] + data["invoiced"]:
        row["source"] = names.get(row.get("source_id"))
        row["person"] = people.get(row.get("user_id"))
        row["status_label"] = billing_orders.STATUS_LABELS.get(row.get("status"), row.get("status"))
        row["total"] = pricing.format_cents(int(row.get("total_cents") or 0), row.get("currency") or "EUR")
    # Rechnungstext vorab (#370): so kämen die Zeilen auf den Beleg - solange keiner existiert,
    # lässt sich je Auftrag ein Zusatztext ergänzen.
    for row in data["open"]:
        if row.get("invoice_id"):
            continue
        order = await db.billing_orders.find_one({"id": row["id"]}, {"_id": 0, "snapshot": 1, "kind": 1, "source_id": 1, "registration_id": 1, "invoice_extra_text": 1})
        if order:
            row["invoice_text"] = invoice_text_preview(order, settings, await booking_facts(db, order))
            row["extra_text"] = order.get("invoice_extra_text") or ""
    return {
        **data,
        "dolibarr": {"connected": settings.get("mode") != "off", "mode": settings.get("mode"), "write_capable": write_capable(settings),
                     "terms_complete": terms_complete(settings), "invoice_auto_validate": bool(settings.get("invoice_auto_validate"))},
        "tax_profiles": pricing.TAX_PROFILES,
        "price_bases": pricing.PRICE_BASE_LABELS,
    }


@router.get("/dolibarr-services")
async def dolibarr_services(me: dict = Depends(require_area("finance"))):
    """Leistungen aus Dolibarr für die Auswahl im Event (z. B. „Kostenbeitrag 20,00 brutto“)."""
    db = get_db()
    settings = await load_settings(db)
    if settings.get("mode") == "off":
        return {"available": False, "reason": "not_connected", "services": []}
    try:
        client = DolibarrClient(settings)
        rows = await client.services()
    except DolibarrError as exc:
        return {"available": False, "reason": exc.kind, "reason_text": exc.text, "services": []}
    services = [view for view in (service_view(row) for row in rows) if view]
    return {"available": True, "services": services}


@router.post("/orders/{order_id}/release")
async def release_billing_order(order_id: str, me: dict = Depends(require_area("finance"))):
    """Rechnungszeitpunkt „bewusst später“ - hier gibt die Finanzverwaltung frei."""
    db = get_db()
    order = await db.billing_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Auftrag nicht gefunden.")
    if order.get("status") != "held":
        raise HTTPException(409, "Dieser Auftrag wartet nicht auf eine Freigabe.")
    updated = await billing_orders.release_order(db, order_id, me["id"])
    await db.audit_logs.insert_one({"id": new_id(), "action": "billing.order.release", "target_id": order_id, "actor_id": me["id"],
                                    "data": {"registration_id": order.get("registration_id"), "total_cents": order.get("total_cents")},
                                    "created_at": now_utc().isoformat()})
    return updated


class InvoiceExtraText(BaseModel):
    extra_text: str = Field("", max_length=MAX_EXTRA_TEXT)


@router.put("/orders/{order_id}/text")
async def set_invoice_extra_text(order_id: str, body: InvoiceExtraText, me: dict = Depends(require_area("finance"))):
    """Zusatztext für den Beleg (#370) - z. B. „inkl. Essen und Getränke“ - solange kein Beleg existiert.
    Kommt unter die erste Rechnungszeile und in die öffentliche Notiz."""
    db = get_db()
    order = await db.billing_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Auftrag nicht gefunden.")
    if order.get("invoice_id") or order.get("status") in ("invoiced", "cancelled"):
        raise HTTPException(409, "Der Beleg existiert schon – den Text bitte in Dolibarr ändern.")
    text = "\n".join(line.strip() for line in (body.extra_text or "").splitlines() if line.strip())
    await db.billing_orders.update_one({"id": order_id}, {"$set": {"invoice_extra_text": text, "updated_at": now_utc().isoformat()}})
    settings = await load_settings(db)
    order["invoice_extra_text"] = text
    return {"ok": True, "extra_text": text, "invoice_text": invoice_text_preview(order, settings, await booking_facts(db, order))}


@router.post("/orders/run")
async def run_billing_orders(me: dict = Depends(require_area("finance"))):
    """Jetzt statt in zwei Minuten: Aufträge ausführen und Belegstände nachlesen."""
    processed = await billing_orders.classify_due()
    synced = await billing_orders.sync_due()
    return {**processed, "synced": synced}


@router.post("/orders/{order_id}/retry")
async def retry_billing_order(order_id: str, me: dict = Depends(require_area("finance"))):
    db = get_db()
    order = await db.billing_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Auftrag nicht gefunden.")
    if order.get("status") != "failed":
        raise HTTPException(409, "Nur gescheiterte Aufträge werden neu gestartet.")
    await db.audit_logs.insert_one({"id": new_id(), "action": "billing.order.retry", "target_id": order_id, "actor_id": me["id"], "data": {}, "created_at": now_utc().isoformat()})
    return await billing_orders.retry_order(db, order_id, me["id"])


class ThirdpartyAssignment(BaseModel):
    thirdparty_id: int = Field(..., ge=1)


@router.post("/orders/{order_id}/thirdparty")
async def assign_order_thirdparty(order_id: str, body: ThirdpartyAssignment, me: dict = Depends(require_area("finance"))):
    """„Zuordnung prüfen“: die Finanzverwaltung nennt den Geschäftspartner (Nr. aus Dolibarr) - geprüft, dass es ihn gibt."""
    db = get_db()
    order = await db.billing_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Auftrag nicht gefunden.")
    if order.get("status") not in ("waiting_review", "waiting_link", "pending", "failed"):
        raise HTTPException(409, "Dieser Auftrag wartet nicht auf eine Zuordnung.")
    settings = await load_settings(db)
    try:
        client = DolibarrClient(settings)
        party = await assign_thirdparty(db, settings, client, order["user_id"], body.thirdparty_id, me["id"])
    except DolibarrError as exc:
        raise HTTPException(exc.status if exc.status in (401, 403, 404) else 503, f"Dolibarr: {exc.text}")
    await db.billing_orders.update_one({"id": order_id}, {"$set": {"status": "pending", "note": f"Geschäftspartner Nr. {party['id']} zugeordnet.", "updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "billing.thirdparty.assign", "target_id": order_id, "actor_id": me["id"],
                                    "data": {"user_id": order["user_id"], "thirdparty_id": party["id"]}, "created_at": now_utc().isoformat()})
    return {"ok": True, "thirdparty": party}


@router.post("/orders/{order_id}/new-thirdparty")
async def create_new_thirdparty_for_order(order_id: str, me: dict = Depends(require_area("finance"))):
    """„Zuordnung prüfen“, andere Antwort: trotz gleicher E-Mail bewusst einen neuen Geschäftspartner anlegen."""
    db = get_db()
    order = await db.billing_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Auftrag nicht gefunden.")
    if order.get("status") != "waiting_review":
        raise HTTPException(409, "Dieser Auftrag wartet nicht auf eine Zuordnung.")
    user = await db.users.find_one({"id": order["user_id"]}, {"_id": 0, "id": 1, "display_name": 1, "username": 1, "email": 1})
    if not user:
        raise HTTPException(404, "Konto nicht gefunden.")
    settings = await load_settings(db)
    try:
        client = DolibarrClient(settings)
        socid = await client.create_thirdparty(name=str(user.get("display_name") or user.get("username") or "Website-Konto"), email=user.get("email"),
                                               note=f"Angelegt von der Website für Konto {user['id']} (Freigabe durch {me['id']})")
        await assign_thirdparty(db, settings, client, user["id"], socid, me["id"])
    except DolibarrError as exc:
        raise HTTPException(503, f"Dolibarr: {exc.text}")
    await db.billing_orders.update_one({"id": order_id}, {"$set": {"status": "pending", "note": f"Neuer Geschäftspartner Nr. {socid} angelegt.", "updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "billing.thirdparty.create", "target_id": order_id, "actor_id": me["id"],
                                    "data": {"user_id": user["id"], "thirdparty_id": socid}, "created_at": now_utc().isoformat()})
    return {"ok": True, "thirdparty_id": socid}
