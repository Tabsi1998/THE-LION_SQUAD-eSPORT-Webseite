"""Rechnungen aus Buchungen in Dolibarr anlegen (#316, #317) und ihren Stand zurücklesen (#321, Anfang).

Ablauf je Auftrag (``billing_orders``, Status ``pending``/``ready``/``waiting_*``):

1. **Geschäftspartner** finden oder anlegen (``ensure_thirdparty``):
   - Mitglied mit bestätigter Zuordnung → der am Mitglied verknüpfte Geschäftspartner (``fk_soc``);
     fehlt er, wird einer angelegt und die Nummer an der Zuordnung gemerkt.
   - Nicht-Mitglied → eigene Sammlung ``billing_customers`` (Konto ↔ Geschäftspartner je Installation).
   - Gibt es in Dolibarr schon einen Geschäftspartner mit derselben E-Mail, den niemand zugeordnet hat,
     wird **nicht** still übernommen: Auftrag wartet auf die Finanzverwaltung (``waiting_review``).
2. **Beleg** anlegen (``create_invoice_for``): erst nachsehen, ob es zu diesem Auftrag schon einen Beleg
   gibt (``ref_ext`` = Auftragskennung) - nach einem Abbruch zwischen Anlegen und Speichern entsteht so
   keine zweite Rechnung. Neue Belege sind **Entwürfe**, außer die Einstellung „gleich freigeben“ ist an.
3. **Stand zurücklesen** (``sync_invoiced``): Nummer, Status, bezahlt/offen aus Dolibarr in Auftrag und
   Anmeldung. Dolibarr ist führend für den Beleg; die Website für die Buchung.

Kein Löschen, keine Zahlungen buchen, keine zweite Rechnung für denselben Auftrag.
"""
from __future__ import annotations

import logging
import time

from models import new_id, now_utc
from services.dolibarr_client import DolibarrClient, DolibarrError, instance_key
from services.dolibarr_links import verified_link

logger = logging.getLogger("tls.billing.dolibarr")

MAX_ATTEMPTS = 5
# Steuersätze je Profil (Österreich). Eine Einstellung `tax_rates` in den Dolibarr-Einstellungen
# überschreibt sie; „none“ ist immer 0.
DEFAULT_TAX_RATES = {"none": 0.0, "standard": 20.0, "reduced": 10.0}


class Waiting(Exception):
    """Der Auftrag kann jetzt nicht weiter - der Status sagt, was fehlt."""

    def __init__(self, status: str, note: str):
        self.status = status
        self.note = note
        super().__init__(note)


def ref_ext_for(order: dict) -> str:
    return f"tls-{order['id']}"


def tax_rate_for(settings: dict, profile: str) -> float:
    rates = {**DEFAULT_TAX_RATES, **{k: float(v) for k, v in (settings.get("tax_rates") or {}).items() if k in DEFAULT_TAX_RATES}}
    rates["none"] = 0.0
    return rates.get(profile or "none", 0.0)


def invoice_lines(snapshot: dict, settings: dict) -> list[dict]:
    """Positionen des Snapshots als Dolibarr-Rechnungszeilen. Beträge sind Brutto; ohne Steuer ist
    netto = brutto. Mit Steuerprofil wird der Nettopreis auf sechs Stellen gerechnet - Dolibarr
    rundet den Bruttobetrag selbst, deshalb bleibt der Entwurf zur Prüfung."""
    lines = []
    for line in snapshot.get("positions") or []:
        gross = int(line.get("unit_cents") or 0) / 100
        rate = tax_rate_for(settings, line.get("tax_profile") or "none")
        net = gross if rate == 0 else round(gross / (1 + rate / 100), 6)
        desc = line.get("label") or "Position"
        if line.get("description"):
            desc = f"{desc} – {line['description']}"
        entry = {"desc": desc[:255], "subprice": net, "qty": int(line.get("quantity") or 1), "tva_tx": rate, "product_type": 1}
        if line.get("dolibarr_product_id"):
            entry["fk_product"] = int(line["dolibarr_product_id"])
        lines.append(entry)
    return lines


def invoice_payload(order: dict, socid: int, settings: dict, *, source_name: str, person: str) -> dict:
    snapshot = order.get("snapshot") or {}
    return {
        "socid": int(socid),
        "type": 0,
        "date": int(time.time()),
        "ref_ext": ref_ext_for(order),
        "note_public": f"Anmeldung: {source_name} – {person}"[:255],
        "lines": invoice_lines(snapshot, settings),
    }


# ---------------------------------------------------------------- Leistungen aus Dolibarr

def service_view(product: dict) -> dict | None:
    """Was das Event-Formular von einer Dolibarr-Leistung braucht: Nummer, Name, Bruttopreis in Cent, Steuerprofil."""
    try:
        product_id = int(product.get("id"))
    except (TypeError, ValueError):
        return None
    status = product.get("status")
    if product_id < 1 or (status is not None and str(status) == "0"):
        return None   # nicht verkaufbar
    rate = float(product.get("tva_tx") or 0)
    ttc = product.get("price_ttc")
    if ttc in (None, ""):
        ht = float(product.get("price") or 0)
        ttc = ht * (1 + rate / 100)
    cents = int(round(float(ttc) * 100))
    profile = "none" if rate == 0 else next((name for name, value in DEFAULT_TAX_RATES.items() if name != "none" and abs(value - rate) < 0.01), "standard")
    return {
        "id": product_id,
        "ref": str(product.get("ref") or ""),
        "label": str(product.get("label") or product.get("ref") or f"Leistung {product_id}"),
        "description": str(product.get("description") or "").strip()[:500],
        "amount_cents": max(0, cents),
        "tax_rate": rate,
        "tax_profile": profile,
    }


# ---------------------------------------------------------------- Geschäftspartner

async def customer_for_user(db, settings: dict, user_id: str) -> dict | None:
    return await db.billing_customers.find_one({"user_id": user_id, "instance": instance_key(settings)}, {"_id": 0})


async def remember_customer(db, settings: dict, user_id: str, thirdparty_id: int, source: str, actor_id: str | None = None) -> None:
    await db.billing_customers.update_one(
        {"user_id": user_id, "instance": instance_key(settings)},
        {"$set": {"thirdparty_id": int(thirdparty_id), "source": source, "confirmed_by": actor_id, "updated_at": now_utc().isoformat()},
         "$setOnInsert": {"id": new_id(), "user_id": user_id, "instance": instance_key(settings), "created_at": now_utc().isoformat()}},
        upsert=True,
    )


async def ensure_thirdparty(db, settings: dict, client: DolibarrClient, user: dict) -> int:
    """Der Geschäftspartner der Person - gefunden, am Mitglied gelesen oder neu angelegt. Sonst `Waiting`."""
    link = await verified_link(db, settings, user["id"])
    if link and link.get("thirdparty_id"):
        return int(link["thirdparty_id"])
    known = await customer_for_user(db, settings, user["id"])
    if known and known.get("thirdparty_id"):
        return int(known["thirdparty_id"])
    if link and link.get("member_id"):
        member = await client.core_member(int(link["member_id"]))
        socid = int(member.get("fk_soc") or member.get("socid") or 0)
        if socid > 0:
            await db.dolibarr_links.update_one({"id": link["id"]}, {"$set": {"thirdparty_id": socid, "thirdparty_source": "member", "updated_at": now_utc().isoformat()}})
            return socid
    email = str(user.get("email") or "").strip()
    if email:
        clashes = await client.thirdparties_by_email(email)
        if clashes:
            ids = ", ".join(str(row.get("id")) for row in clashes[:3])
            raise Waiting("waiting_review", f"In Dolibarr gibt es schon einen Geschäftspartner mit dieser E-Mail (Nr. {ids}). Bitte in der Finanzübersicht zuordnen oder neu anlegen lassen.")
    name = str(user.get("display_name") or user.get("username") or "Website-Konto").strip()
    socid = await client.create_thirdparty(name=name, email=email or None, note=f"Angelegt von der Website für Konto {user['id']}")
    if link:
        await db.dolibarr_links.update_one({"id": link["id"]}, {"$set": {"thirdparty_id": socid, "thirdparty_source": "created", "updated_at": now_utc().isoformat()}})
    else:
        await remember_customer(db, settings, user["id"], socid, "created")
    return socid


async def assign_thirdparty(db, settings: dict, client: DolibarrClient, user_id: str, thirdparty_id: int, actor_id: str) -> dict:
    """Finanzverwaltung ordnet einen bestehenden Geschäftspartner zu - nach Prüfung, dass es ihn gibt."""
    party = await client.thirdparty(thirdparty_id)
    link = await verified_link(db, settings, user_id)
    if link:
        await db.dolibarr_links.update_one({"id": link["id"]}, {"$set": {"thirdparty_id": int(thirdparty_id), "thirdparty_source": "admin", "updated_at": now_utc().isoformat()}})
    else:
        await remember_customer(db, settings, user_id, int(thirdparty_id), "admin", actor_id)
    return {"id": int(party["id"]), "name": party.get("name")}


# ---------------------------------------------------------------- Belege

def _invoice_state(invoice: dict) -> dict:
    status = int(invoice.get("statut") if invoice.get("statut") is not None else invoice.get("status") or 0)
    paid = bool(int(invoice.get("paye") or 0)) or status == 2
    remaining = invoice.get("remaintopay")
    return {
        "invoice_id": int(invoice["id"]),
        "invoice_ref": invoice.get("ref") or "",
        "invoice_status": {0: "draft", 1: "validated", 2: "paid", 3: "abandoned"}.get(status, str(status)),
        "paid": paid,
        "remaining": float(remaining) if remaining not in (None, "") else None,
        "total": float(invoice.get("total_ttc") or 0) if invoice.get("total_ttc") not in (None, "") else None,
    }


async def _mark_invoiced(db, order: dict, state: dict) -> None:
    now = now_utc().isoformat()
    await db.billing_orders.update_one({"id": order["id"]}, {"$set": {
        "status": "invoiced", "note": "", **state, "invoiced_at": order.get("invoiced_at") or now, "updated_at": now,
        **({"paid_at": now} if state.get("paid") and not order.get("paid_at") else {}),
    }})
    billing_status = "paid" if state.get("paid") else "invoiced"
    if order.get("kind") == "event":
        await db.event_registrations.update_one({"id": order["registration_id"]}, {"$set": {
            "billing_status": billing_status, "invoice_id": state["invoice_id"], "invoice_ref": state["invoice_ref"], "invoice_status": state["invoice_status"],
        }})


async def create_invoice_for(db, settings: dict, client: DolibarrClient, order: dict) -> dict:
    """Der Beleg zu einem Auftrag - vorhandenen übernehmen, sonst anlegen. Gibt den Stand zurück."""
    user = await db.users.find_one({"id": order["user_id"]}, {"_id": 0, "id": 1, "display_name": 1, "username": 1, "email": 1})
    if not user:
        raise Waiting("failed", "Das Konto der Person gibt es nicht mehr.")
    socid = await ensure_thirdparty(db, settings, client, user)
    existing = await client.invoices_by_ref_ext(ref_ext_for(order))
    if existing:
        invoice = await client.invoice(int(existing[0]["id"]))
        return _invoice_state(invoice)
    source_name = order.get("source_name") or ""
    if order.get("kind") == "event" and not source_name:
        event = await db.events.find_one({"id": order["source_id"]}, {"_id": 0, "name": 1})
        source_name = (event or {}).get("name") or "Event"
    payload = invoice_payload(order, socid, settings, source_name=source_name, person=user.get("display_name") or user.get("username") or "")
    invoice_id = await client.create_invoice(payload)
    # Sofort merken: Ab hier gibt es den Beleg - ein Abbruch darf keinen zweiten erzeugen.
    await db.billing_orders.update_one({"id": order["id"]}, {"$set": {"invoice_id": invoice_id, "thirdparty_id": socid, "updated_at": now_utc().isoformat()}})
    if settings.get("invoice_auto_validate"):
        await client.validate_invoice(invoice_id)
    invoice = await client.invoice(invoice_id)
    return _invoice_state(invoice)


async def process_order(db, settings: dict, client: DolibarrClient, order: dict) -> str:
    """Einen Auftrag bis zum Beleg bringen. Gibt den neuen Status zurück."""
    try:
        state = await create_invoice_for(db, settings, client, order)
    except Waiting as waiting:
        await db.billing_orders.update_one({"id": order["id"]}, {"$set": {"status": waiting.status, "note": waiting.note, "updated_at": now_utc().isoformat()}})
        return waiting.status
    except DolibarrError as exc:
        attempts = int(order.get("attempts") or 0) + 1
        status = "failed" if attempts >= MAX_ATTEMPTS else "pending"
        note = f"Dolibarr: {exc.text}" + ("" if status == "pending" else f" – nach {attempts} Versuchen aufgegeben; „Erneut versuchen“ startet neu.")
        await db.billing_orders.update_one({"id": order["id"]}, {"$set": {"status": status, "note": note, "attempts": attempts, "last_error": exc.kind, "updated_at": now_utc().isoformat()}})
        logger.warning("[billing] Auftrag %s: %s (%s)", order["id"], exc.kind, attempts)
        return status
    await _mark_invoiced(db, order, state)
    return "invoiced"


async def sync_invoiced(db, settings: dict, client: DolibarrClient, limit: int = 50) -> dict:
    """Offene Belege nachlesen: freigegeben? bezahlt? Dolibarr ist dafür führend."""
    counts = {"looked": 0, "changed": 0, "paid": 0}
    rows = await db.billing_orders.find({"status": "invoiced", "paid": {"$ne": True}}, {"_id": 0}).sort("updated_at", 1).to_list(limit)
    for order in rows:
        counts["looked"] += 1
        try:
            state = _invoice_state(await client.invoice(int(order["invoice_id"])))
        except DolibarrError as exc:
            logger.warning("[billing] Stand von Beleg %s nicht lesbar: %s", order.get("invoice_id"), exc.kind)
            continue
        if state["invoice_status"] != order.get("invoice_status") or state["paid"] != bool(order.get("paid")) or state["invoice_ref"] != order.get("invoice_ref"):
            await _mark_invoiced(db, order, state)
            counts["changed"] += 1
            if state["paid"]:
                counts["paid"] += 1
    return counts
