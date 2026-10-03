"""„Deine Rechnung ist da“ (#841): sobald ein Beleg freigegeben ist - gleich beim Anlegen oder später von Hand in
Dolibarr, dann merkt es der Abgleich -, erfährt es die Person, die angemeldet hat: im Postfach (Web und App), per Push
und per Mail, mit Vorgang, Betrag, Zahlungsziel und dem Weg zum PDF im Konto.

- **Einmal je Beleg:** ausgelöst nur vom Übergang „noch nicht freigegeben → freigegeben“ (Belege, die schon vor dem
  Update freigegeben waren, bleiben still); der Merker am Auftrag wird gesetzt, bevor etwas rausgeht.
- **Erst mit PDF:** die Meldung wartet, bis das PDF da ist (#840) - höchstens ``PDF_GRACE_HOURS``; danach kommt sie
  trotzdem, der Download im Konto baut ein fehlendes PDF selbst.
- **Nie für Entwürfe, nie nach einer Abmeldung, nie für Gutschriften.**
- **Nur an die Person selbst:** das PDF hängt nie an der Mail (es bleibt hinter der Anmeldung), und Discord ist kein
  Weg dafür - Beträge gehören nicht in einen fremden Dienst. Die Benachrichtigungs-Einstellungen („Rechnungen“) gelten.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from models import now_utc

logger = logging.getLogger("tls.billing.notice")

KIND = "invoice_ready"
CATEGORY = "billing_updates"
NOTICE_STATES = ("validated", "paid")
PDF_GRACE_HOURS = 2


def euro(cents: int | None) -> str:
    """„1.234,50 €“ - so, wie es auf der Rechnung steht."""
    value = (int(cents or 0)) / 100
    return f"{value:,.2f}".replace(",", "#").replace(".", ",").replace("#", ".") + " €"


def day_text(day: str) -> str:
    """„2026-10-17“ → „17.10.2026“; sonst leer."""
    parts = str(day or "").split("-")
    return f"{parts[2]}.{parts[1]}.{parts[0]}" if len(parts) == 3 and all(parts) else ""


def invoice_path(invoice_id: int) -> str:
    """Der Weg zum Beleg im Konto - die Rechnungsliste öffnet ihn gleich (Web: das PDF, App: der Beleg)."""
    return f"/profile?tab=invoices&invoice=d-{int(invoice_id)}"


def notice_text(source: str, state: dict, order: dict) -> dict:
    """Titel und Text der Meldung - „Weihnachtsfeier: 40,00 €, zahlbar bis 17.10.2026.“"""
    cents = state.get("remote_total_cents") if state.get("remote_total_cents") is not None else order.get("total_cents")
    amount = euro(cents)
    due = day_text(state.get("due_on") or "")
    paid = state.get("invoice_status") == "paid" or state.get("payment_state") == "paid"
    if paid:
        body = f"{source}: {amount} – schon bezahlt, danke!"
    elif due:
        body = f"{source}: {amount}, zahlbar bis {due}."
    else:
        body = f"{source}: {amount}."
    return {"title": "Deine Rechnung ist da", "body": body, "amount": amount, "due_on": due, "paid": paid}


async def mark_due(db, order_id: str, previous_status: str | None, state: dict) -> bool:
    """Den Übergang zur Freigabe vormerken - nur, wenn der Beleg vorher noch nicht freigegeben war."""
    if previous_status in NOTICE_STATES or state.get("invoice_status") not in NOTICE_STATES:
        return False
    result = await db.billing_orders.update_one(
        {"id": order_id, "invoice_notice_due_at": {"$exists": False}, "invoice_notice_at": {"$exists": False}},
        {"$set": {"invoice_notice_due_at": now_utc().isoformat()}},
    )
    return result.modified_count == 1


async def send_due(db, order_id: str, state: dict | None = None) -> bool:
    """Eine vorgemerkte Meldung schicken, sobald alles passt. `True`, wenn sie jetzt rausging."""
    from services.dolibarr_billing import booking_facts, source_label
    from services.notification_preferences import send_user_template
    from services.user_notifications import build_public_url, create_user_notification

    order = await db.billing_orders.find_one({"id": order_id}, {"_id": 0})
    if not order or not order.get("invoice_notice_due_at") or order.get("invoice_notice_at"):
        return False
    state = state or order
    if state.get("invoice_status") not in NOTICE_STATES or int(state.get("invoice_type") or 0) != 0:
        return False
    if order.get("booking_state") == "cancelled":
        return False
    if not order.get("pdf_built_at"):
        waited = now_utc() - timedelta(hours=PDF_GRACE_HOURS)
        if str(order["invoice_notice_due_at"]) > waited.isoformat():
            return False   # das PDF kommt mit dem nächsten Abgleich - so lange wartet die Meldung
    # Erst der Merker, dann der Versand: ein zweiter Lauf zur selben Zeit schickt nichts doppelt.
    claimed = await db.billing_orders.update_one(
        {"id": order_id, "invoice_notice_at": {"$exists": False}},
        {"$set": {"invoice_notice_at": now_utc().isoformat()}},
    )
    if claimed.modified_count != 1:
        return False
    user = await db.users.find_one({"id": order.get("user_id")}, {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1,
                                                                   "notification_preferences": 1, "newsletter_consent": 1, "is_active": 1})
    if not user or user.get("is_active") is False:
        return False
    invoice_id = int(state.get("invoice_id") or order.get("invoice_id"))
    source = source_label(await booking_facts(db, order))
    text = notice_text(source, state, order)
    path = invoice_path(invoice_id)
    await create_user_notification(user["id"], text["title"], text["body"], path, kind=KIND,
                                   meta={"category": CATEGORY, "dedupe_key": f"invoice:{invoice_id}", "invoice_key": f"d-{invoice_id}", "order_id": order_id})
    try:
        await send_user_template(
            user, KIND, category=CATEGORY,
            dedupe_key=f"{KIND}:{invoice_id}",
            mail_meta={"kind": KIND, "user_id": user["id"], "order_id": order_id},
            display_name=user.get("display_name") or user.get("username") or "",
            source=source, amount=text["amount"], due_on=text["due_on"], paid="ja" if text["paid"] else "",
            url=await build_public_url(path), preferences_url=await build_public_url("/profile?tab=notifications"),
        )
    except Exception as exc:  # die Meldung im Postfach steht schon - eine Mail, die nicht in die Warteschlange kommt, ist kein Abbruch
        logger.warning("[billing] Mail zu Beleg %s nicht eingereiht: %s", invoice_id, exc)
    return True
