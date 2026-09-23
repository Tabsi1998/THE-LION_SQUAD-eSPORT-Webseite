"""Finanzverwaltung (#322): Übersicht der Rechnungsaufträge, Freigabe, Prüffälle, Erstattungen, Abgleich.

Nur der Bereich „Finanzen“ (mit Zwei-Faktor). Kein Rechnungs- oder Sync-Dienst - der lebt in
``services/billing_orders`` und im Dolibarr-Adapter. Jede Aktion hier ist Lesen, eine Freigabe,
eine Zuordnung oder das Festhalten von etwas, das außerhalb passiert ist (Erstattung, erledigter
Prüffall) - mit Grund und Audit. Nichts hier erzeugt eine zweite Rechnungsidentität: „Erneut
versuchen“ und „Nachlesen“ prüfen zuerst, was Dolibarr schon hat.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import require_area
from database import get_db
from models import new_id, now_utc
from services import billing_cases, billing_orders, pricing
from services.dolibarr_billing import MAX_EXTRA_TEXT, assign_thirdparty, booking_facts, invoice_text_preview, service_view, sync_one, terms_complete
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings, write_capable

router = APIRouter(prefix="/api/admin/finance", tags=["finance"])


async def _names(db, rows: list[dict]) -> tuple[dict, dict]:
    """Namen der Angebote und Personen zu Aufträgen und Fällen - ohne zweite Abfrage je Zeile."""
    event_ids = sorted({row["source_id"] for row in rows if (row.get("kind") or row.get("source_kind")) == "event" and row.get("source_id")})
    tournament_ids = sorted({row["source_id"] for row in rows if (row.get("kind") or row.get("source_kind")) == "tournament" and row.get("source_id")})
    names = {}
    if event_ids:
        async for event in db.events.find({"id": {"$in": event_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1}):
            names[event["id"]] = {"name": event.get("name"), "slug": event.get("slug"), "kind": "event"}
    if tournament_ids:
        async for tournament in db.tournaments.find({"id": {"$in": tournament_ids}}, {"_id": 0, "id": 1, "title": 1, "slug": 1}):
            names[tournament["id"]] = {"name": f"Startgeld {tournament.get('title')}", "slug": tournament.get("slug"), "kind": "tournament"}
    user_ids = sorted({row["user_id"] for row in rows if row.get("user_id")})
    people = {}
    if user_ids:
        async for user in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}):
            people[user["id"]] = user.get("display_name") or user.get("username")
    return names, people


def _decorate(row: dict, names: dict, people: dict) -> dict:
    row["source"] = names.get(row.get("source_id"))
    row["person"] = people.get(row.get("user_id"))
    row["status_label"] = billing_orders.STATUS_LABELS.get(row.get("status"), row.get("status"))
    row["total"] = pricing.format_cents(int(row.get("total_cents") or 0), row.get("currency") or "EUR")
    if row.get("status") == "invoiced":
        row["payment_label"] = billing_orders.PAYMENT_STATE_LABELS.get(row.get("payment_state") or "", "")
        row["paid_cents"] = billing_orders.paid_cents(row)
        row["refunded_cents"] = billing_orders.refunded_cents(row)
        row["credited_cents"] = billing_orders.credited_cents(row)
    return row


async def _user_ids_matching(db, q: str) -> list[str]:
    pattern = re.compile(re.escape(q.strip()), re.IGNORECASE)
    ids = []
    async for user in db.users.find({"$or": [{"display_name": pattern}, {"username": pattern}]}, {"_id": 0, "id": 1}).limit(50):
        ids.append(user["id"])
    return ids


@router.get("/overview")
async def finance_overview(kind: str | None = Query(None), source: str | None = Query(None, max_length=80), q: str | None = Query(None, max_length=80),
                           me: dict = Depends(require_area("finance"))):
    db = get_db()
    settings = await load_settings(db)
    user_ids = await _user_ids_matching(db, q) if q and q.strip() else None
    data = await billing_orders.overview(db, kind=kind, source_id=source or None, user_ids=user_ids)
    names, people = await _names(db, data["open"] + data["invoiced"] + data["cases"])
    for row in data["open"] + data["invoiced"]:
        _decorate(row, names, people)
    for case in data["cases"]:
        case["source"] = names.get(case.get("source_id"))
        case["person"] = people.get(case.get("user_id"))
        case["total"] = pricing.format_cents(int(case.get("total_cents") or 0))
    # Rechnungstext vorab (#370): so kämen die Zeilen auf den Beleg - solange keiner existiert,
    # lässt sich je Auftrag ein Zusatztext ergänzen.
    for row in data["open"]:
        if row.get("invoice_id"):
            continue
        order = await db.billing_orders.find_one({"id": row["id"]}, {"_id": 0, "snapshot": 1, "kind": 1, "source_id": 1, "registration_id": 1, "invoice_extra_text": 1})
        if order:
            row["invoice_text"] = invoice_text_preview(order, settings, await booking_facts(db, order))
            row["extra_text"] = order.get("invoice_extra_text") or ""
    summary = await billing_orders.source_summary(db, kind if kind in ("event", "tournament") else next((row["kind"] for row in data["open"] + data["invoiced"]), "event"), source) if source else None
    return {
        **data,
        "summary": summary,
        "dolibarr": {"connected": settings.get("mode") != "off", "mode": settings.get("mode"), "write_capable": write_capable(settings),
                     "terms_complete": terms_complete(settings), "invoice_auto_validate": bool(settings.get("invoice_auto_validate"))},
        "tax_profiles": pricing.TAX_PROFILES,
        "price_bases": pricing.PRICE_BASE_LABELS,
    }


@router.get("/sources/{kind}/{source_id}")
async def source_summary(kind: str, source_id: str, me: dict = Depends(require_area("finance"))):
    """Die Zahlen einer Veranstaltung (#322): gebucht, fakturiert, bezahlt, offen, gutgeschrieben, erstattet."""
    if kind not in ("event", "tournament"):
        raise HTTPException(404, "Unbekannte Art.")
    return await billing_orders.source_summary(get_db(), kind, source_id)


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


# ---------------------------------------------------------------- Detail und Zeitleiste (#322)

def _timeline(order: dict, cases: list[dict], audit: list[dict], people: dict) -> list[dict]:
    """Was mit dem Auftrag passiert ist, in einer Reihe: Preis, Beleg, Zahlungen, Gutschriften,
    Storno, Erstattungen, Prüffälle, Freigaben - jedes Ereignis einmal, mit Zeitpunkt."""
    money = lambda cents: pricing.format_cents(int(cents or 0), order.get("currency") or "EUR")  # noqa: E731
    items = [{"at": order.get("created_at"), "kind": "order", "text": f"Auftrag angelegt – {money(order.get('total_cents'))} ({billing_orders.STATUS_LABELS.get('held') if order.get('timing') == 'manual' else 'zur Rechnung'})"}]
    if order.get("released_at"):
        items.append({"at": order["released_at"], "kind": "release", "text": f"Freigegeben von {people.get(order.get('released_by'), 'Finanzen')}"})
    if order.get("invoiced_at"):
        items.append({"at": order["invoiced_at"], "kind": "invoice", "text": f"Beleg in Dolibarr: {order.get('invoice_ref') or '–'}"})
    for payment in order.get("payments") or []:
        items.append({"at": payment.get("date") or order.get("synced_at"), "kind": "payment", "text": f"Zahlung {money(payment.get('amount_cents'))}" + (f" ({payment['type']})" if payment.get("type") else "") + (f" – {payment['ref']}" if payment.get("ref") else "")})
    for note in order.get("credit_notes") or []:
        items.append({"at": order.get("synced_at"), "kind": "credit", "text": f"Gutschrift {note.get('ref') or ''} über {money(note.get('total_cents'))}" + ("" if note.get("status") != "draft" else " (Entwurf)")})
    if order.get("booking_cancelled_at"):
        items.append({"at": order["booking_cancelled_at"], "kind": "cancel", "text": f"Buchung storniert: {order.get('cancel_reason') or ''}"})
    if order.get("booking_changed_at"):
        items.append({"at": order["booking_changed_at"], "kind": "change", "text": f"Buchung geändert: {order.get('booking_change') or ''}"})
    for refund in order.get("refunds") or []:
        items.append({"at": refund.get("recorded_at"), "kind": "refund", "text": f"Erstattung {money(refund.get('amount_cents'))} am {refund.get('paid_on')}" + (f" ({refund['reference']})" if refund.get("reference") else "") + f" – {refund.get('reason') or ''}"})
    for case in cases:
        items.append({"at": case.get("opened_at"), "kind": "case", "text": f"Prüffall: {case.get('label')}"})
        if case.get("status") == "resolved":
            who = "Abgleich" if case.get("auto") else people.get(case.get("resolved_by"), "Finanzen")
            items.append({"at": case.get("resolved_at"), "kind": "case_resolved", "text": f"Prüffall erledigt ({who}): {case.get('resolution') or ''}"})
    for entry in audit:
        action = str(entry.get("action") or "")
        if action in ("billing.order.release", "billing.refund.record", "billing.case.resolve"):
            continue   # steht schon oben, aus den Daten des Auftrags
        if action.startswith("billing.") or action.startswith("event.registration") or action.startswith("tournament.registration"):
            items.append({"at": entry.get("created_at"), "kind": "audit", "text": f"{action} – {people.get(entry.get('actor_id'), 'System')}"})
    if order.get("sync_error"):
        items.append({"at": order.get("sync_error_at"), "kind": "error", "text": f"Dolibarr nicht lesbar: {order.get('sync_error_text') or order['sync_error']}"})
    return sorted((item for item in items if item.get("at")), key=lambda item: str(item["at"]))


@router.get("/orders/{order_id}")
async def order_detail(order_id: str, me: dict = Depends(require_area("finance"))):
    db = get_db()
    order = await db.billing_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Auftrag nicht gefunden.")
    collection = {"event": db.event_registrations, "tournament": db.tournament_registrations}.get(order.get("kind"))
    registration = await collection.find_one({"id": order["registration_id"]}, {"_id": 0, "id": 1, "status": 1, "companion_count": 1, "seat_count": 1, "team_id": 1, "display_name": 1, "billing_status": 1}) if collection is not None else None
    cases = await billing_cases.cases_for_order(db, order_id)
    audit = await db.audit_logs.find({"$or": [{"target_id": order_id}, {"data.registration_id": order["registration_id"]}]}, {"_id": 0, "action": 1, "actor_id": 1, "created_at": 1, "data": 1}).sort("created_at", 1).to_list(80)
    actor_ids = {entry.get("actor_id") for entry in audit} | {case.get("resolved_by") for case in cases} | {order.get("released_by"), order.get("user_id")}
    names, people = await _names(db, [order])
    async for user in db.users.find({"id": {"$in": [a for a in actor_ids if a]}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}):
        people[user["id"]] = user.get("display_name") or user.get("username")
    _decorate(order, names, people)
    snapshot = order.pop("snapshot", None) or {}
    paid = billing_orders.paid_cents(order)
    return {
        "order": order,
        "positions": [{k: line.get(k) for k in ("key", "label", "quantity", "unit_cents", "total_cents", "basis", "tax_profile")} for line in snapshot.get("positions") or []],
        "registration": registration,
        "cases": cases,
        "timeline": _timeline(order, cases, audit, people),
        "sums": {"paid_cents": paid, "refunded_cents": billing_orders.refunded_cents(order), "credited_cents": billing_orders.credited_cents(order),
                 "refundable_cents": max(0, paid - billing_orders.refunded_cents(order))},
        "payment_labels": billing_orders.PAYMENT_STATE_LABELS,
    }


@router.post("/orders/{order_id}/resync")
async def resync_order(order_id: str, me: dict = Depends(require_area("finance"))):
    """Diesen Beleg jetzt in Dolibarr nachlesen - nur lesen, nie neu anlegen."""
    db = get_db()
    order = await db.billing_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Auftrag nicht gefunden.")
    if order.get("status") != "invoiced" or not order.get("invoice_id"):
        raise HTTPException(409, "Zu diesem Auftrag gibt es noch keinen Beleg.")
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        raise HTTPException(409, "Nachlesen geht nur im Modus „Live“.")
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        raise HTTPException(503, f"Dolibarr: {exc.text}")
    counts: dict = {"looked": 0, "changed": 0, "paid": 0, "cases": 0, "errors": 0}
    state = await sync_one(db, settings, client, order, counts)
    updated = await db.billing_orders.find_one({"id": order_id}, {"_id": 0, "snapshot": 0})
    return {"ok": state is not None, **counts, "order": updated}


class RefundRecord(BaseModel):
    amount_cents: int = Field(..., ge=1, le=100_000_000)
    paid_on: str = Field(..., min_length=10, max_length=10)
    reference: str = Field("", max_length=billing_orders.MAX_REFUND_REFERENCE)
    reason: str = Field(..., min_length=3, max_length=billing_orders.MAX_REASON)
    case_id: str | None = Field(None, max_length=64)


@router.post("/orders/{order_id}/refunds")
async def record_refund(order_id: str, body: RefundRecord, me: dict = Depends(require_area("finance"))):
    """Eine Rückzahlung festhalten, die außerhalb der Website passiert ist (#321): Betrag, Tag,
    Referenz, Grund. Nie mehr als bezahlt; optional erledigt sie den Prüffall dazu."""
    db = get_db()
    order = await db.billing_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Auftrag nicht gefunden.")
    if order.get("status") != "invoiced":
        raise HTTPException(409, "Erstattet wird nur, was über einen Beleg bezahlt wurde.")
    try:
        refund = await billing_orders.add_refund(db, order, me["id"], amount_cents=body.amount_cents, paid_on=body.paid_on, reference=body.reference, reason=body.reason)
    except billing_orders.RefundError as exc:
        raise HTTPException(400, str(exc))
    resolved = None
    if body.case_id:
        case = await db.billing_cases.find_one({"id": body.case_id, "order_id": order_id, "status": "open"}, {"_id": 0})
        if case:
            resolved = await billing_cases.resolve_case(db, case["id"], me["id"], f"Erstattung {pricing.format_cents(body.amount_cents)} am {body.paid_on}: {body.reason.strip()}")
    return {"ok": True, "refund": refund, "resolved_case": billing_cases.case_view(resolved) if resolved else None}


# ---------------------------------------------------------------- Prüffälle (#321)

@router.get("/cases")
async def list_cases(status: str = Query("open", pattern="^(open|resolved|all)$"), me: dict = Depends(require_area("finance"))):
    db = get_db()
    cases = await billing_cases.list_cases(db, status)
    names, people = await _names(db, cases)
    for case in cases:
        case["source"] = names.get(case.get("source_id"))
        case["person"] = people.get(case.get("user_id"))
        case["total"] = pricing.format_cents(int(case.get("total_cents") or 0))
    return {"cases": cases, "kinds": {kind: meta["label"] for kind, meta in billing_cases.KINDS.items()}}


class CaseResolution(BaseModel):
    reason: str = Field(..., min_length=3, max_length=billing_orders.MAX_REASON)


@router.post("/cases/{case_id}/resolve")
async def resolve_case(case_id: str, body: CaseResolution, me: dict = Depends(require_area("finance"))):
    """Erledigt mit Grund - z. B. „Gutschrift GA2026-0003 angelegt, 20 € am 24.09. überwiesen“."""
    db = get_db()
    case = await db.billing_cases.find_one({"id": case_id}, {"_id": 0})
    if not case:
        raise HTTPException(404, "Prüffall nicht gefunden.")
    if case.get("status") != "open":
        raise HTTPException(409, "Dieser Prüffall ist schon erledigt.")
    resolved = await billing_cases.resolve_case(db, case_id, me["id"], body.reason)
    await db.audit_logs.insert_one({"id": new_id(), "action": "billing.case.resolve", "target_id": case["order_id"], "actor_id": me["id"],
                                    "data": {"case_id": case_id, "kind": case.get("kind"), "reason": body.reason.strip()}, "created_at": now_utc().isoformat()})
    return {"ok": True, "case": billing_cases.case_view(resolved)}


# ---------------------------------------------------------------- Aufträge

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


@router.post("/reconcile")
async def reconcile_all(me: dict = Depends(require_area("finance"))):
    """Alles abgleichen (#321): jeden Beleg neu lesen, auch bezahlte - Abweichungen werden Prüffälle."""
    result = await billing_orders.reconcile_due()
    await get_db().audit_logs.insert_one({"id": new_id(), "action": "billing.reconcile", "target_id": "billing", "actor_id": me["id"], "data": result, "created_at": now_utc().isoformat()})
    return result


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
