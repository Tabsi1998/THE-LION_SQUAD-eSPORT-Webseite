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

**Konditionen und Texte (#370):** Jeder Beleg trägt Zahlungsziel, Zahlungsart und Bankkonto aus den
Dolibarr-Einstellungen (``invoice_terms``) - ohne die drei bleibt er Entwurf, auch wenn „gleich
freigeben“ an ist. Jede Zeile nennt den Vorgang (Event oder Turnier mit Datum, Personen und
Begleitpersonen, Team), damit die Rechnung für den Kunden lesbar ist und nicht nur „Leistung“.
Die Finanzverwaltung kann je Auftrag einen Zusatztext ergänzen, solange kein Beleg existiert.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime

from models import new_id, now_utc
from services.dolibarr_client import DolibarrClient, DolibarrError, instance_key
from services.dolibarr_links import verified_link
from services.dolibarr_policy import CLUB_TZ

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


# ---------------------------------------------------------------- Konditionen (#370)

TERM_FIELDS = ("invoice_payment_term_id", "invoice_payment_mode_id", "invoice_bank_account_id")
# Dolibarrs Wörterbuch-Codes für die Vorgaben des Vereins: 30 Tage, Banküberweisung.
DEFAULT_TERM_CODE = "30D"
DEFAULT_MODE_CODE = "VIR"
MAX_DESC = 1000
MAX_EXTRA_TEXT = 500


def invoice_terms(settings: dict) -> dict:
    """Zahlungsziel, Zahlungsart, Bankkonto - als Dolibarr-Felder des Belegs. Nur gesetzte Werte."""
    def number(key: str) -> int | None:
        try:
            value = int(settings.get(key) or 0)
        except (TypeError, ValueError):
            return None
        return value if value > 0 else None
    term, mode, account = (number(key) for key in TERM_FIELDS)
    payload = {}
    if term:
        payload["cond_reglement_id"] = term
    if mode:
        payload["mode_reglement_id"] = mode
    if account:
        payload["fk_account"] = account
    return payload


def terms_complete(settings: dict) -> bool:
    """Ohne die drei Konditionen wird kein Beleg automatisch freigegeben (#370)."""
    return len(invoice_terms(settings)) == 3


# ---------------------------------------------------------------- Texte (#370)

def _club_date(value) -> str:
    """„31.10.2026“ am Wiener Tag - oder leer."""
    if not value:
        return ""
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return ""
    if moment.tzinfo is not None:
        moment = moment.astimezone(CLUB_TZ)
    return moment.strftime("%d.%m.%Y")


async def booking_facts(db, order: dict) -> dict:
    """Was vom Vorgang auf die Rechnung gehört: Name und Datum des Events oder Turniers, die Person,
    Personen und Begleitpersonen (Event), Team und Spielerzahl (Turnier)."""
    snapshot = order.get("snapshot") or {}
    recipient = snapshot.get("recipient") or {}
    facts = {"kind": order.get("kind"), "name": "", "date": "", "person": recipient.get("display_name") or "",
             "seats": 1, "companions": 0, "team": "", "players": 0}
    if order.get("kind") == "event":
        event = await db.events.find_one({"id": order.get("source_id")}, {"_id": 0, "name": 1, "start_date": 1})
        registration = await db.event_registrations.find_one({"id": order.get("registration_id")}, {"_id": 0, "companion_count": 1, "seat_count": 1})
        facts["name"] = (event or {}).get("name") or "Event"
        facts["date"] = _club_date((event or {}).get("start_date"))
        companions = max(0, int((registration or {}).get("companion_count") or 0))
        facts["companions"] = companions
        facts["seats"] = max(1, int((registration or {}).get("seat_count") or (1 + companions)))
    elif order.get("kind") == "tournament":
        tournament = await db.tournaments.find_one({"id": order.get("source_id")}, {"_id": 0, "title": 1, "start_date": 1})
        facts["name"] = (tournament or {}).get("title") or "Turnier"
        facts["date"] = _club_date((tournament or {}).get("start_date"))
        facts["team"] = (snapshot.get("source") or {}).get("display_name") or ""
        per_person = [int(line.get("quantity") or 1) for line in snapshot.get("positions") or [] if line.get("basis") == "per_person"]
        facts["players"] = max(per_person) if per_person else 0
    return facts


def source_label(facts: dict) -> str:
    """„Startgeld Herbst-Cup – Team Lions“ oder „Vereinsausflug“ - der Vorgang in einem Wort."""
    if facts.get("kind") == "tournament":
        return f"Startgeld {facts.get('name') or 'Turnier'}" + (f" – {facts['team']}" if facts.get("team") else "")
    return facts.get("name") or "Event"


def line_context(facts: dict, line: dict) -> str:
    """Der Satz unter der Position, der die Rechnung lesbar macht:
    „Vereinsausflug am 31.10.2026 – 2 Personen (Paula Muster + 1 Begleitperson)“."""
    head = facts.get("name") or ""
    if facts.get("date"):
        head = f"{head} am {facts['date']}"
    quantity = int(line.get("quantity") or 1)
    per_person = line.get("basis") == "per_person"
    person = facts.get("person") or ""
    if facts.get("kind") == "tournament":
        team = f"Team {facts['team']}" if facts.get("team") else person
        who = f"{team}, {quantity} Spieler" if per_person and quantity > 1 else team
    elif per_person and quantity > 1:
        companions = int(facts.get("companions") or 0)
        extra = f" + {companions} Begleitperson{'' if companions == 1 else 'en'}" if companions else ""
        who = f"{quantity} Personen ({person}{extra})" if person else f"{quantity} Personen"
    else:
        who = person
    return f"{head} – {who}" if who else head


def invoice_lines(snapshot: dict, settings: dict, facts: dict | None = None, extra_text: str = "") -> list[dict]:
    """Positionen des Snapshots als Dolibarr-Rechnungszeilen. Beträge sind Brutto; ohne Steuer ist
    netto = brutto. Mit Steuerprofil wird der Nettopreis auf sechs Stellen gerechnet - Dolibarr
    rundet den Bruttobetrag selbst, deshalb bleibt der Entwurf zur Prüfung.

    Jede Zeile: Bezeichnung – Beschreibung, darunter der Vorgang (#370); der Zusatztext der
    Finanzverwaltung steht unter der ersten Zeile."""
    lines = []
    for index, line in enumerate(snapshot.get("positions") or []):
        gross = int(line.get("unit_cents") or 0) / 100
        rate = tax_rate_for(settings, line.get("tax_profile") or "none")
        net = gross if rate == 0 else round(gross / (1 + rate / 100), 6)
        desc = line.get("label") or "Position"
        if line.get("description"):
            desc = f"{desc} – {line['description']}"
        if facts:
            context = line_context(facts, line)
            if context:
                desc = f"{desc}\n{context}"
        if index == 0 and (extra_text or "").strip():
            desc = f"{desc}\n{extra_text.strip()}"
        entry = {"desc": desc[:MAX_DESC], "subprice": net, "qty": int(line.get("quantity") or 1), "tva_tx": rate, "product_type": 1}
        if line.get("dolibarr_product_id"):
            entry["fk_product"] = int(line["dolibarr_product_id"])
        lines.append(entry)
    return lines


def invoice_text_preview(order: dict, settings: dict, facts: dict) -> list[str]:
    """Die Zeilentexte, wie sie auf den Beleg kämen - für die Finanzübersicht vor dem Anlegen."""
    return [line["desc"] for line in invoice_lines(order.get("snapshot") or {}, settings, facts, order.get("invoice_extra_text") or "")]


def invoice_payload(order: dict, socid: int, settings: dict, *, facts: dict, person: str) -> dict:
    snapshot = order.get("snapshot") or {}
    note = f"Anmeldung: {source_label(facts)} – {person}"
    if (order.get("invoice_extra_text") or "").strip():
        note = f"{note}\n{order['invoice_extra_text'].strip()}"
    return {
        "socid": int(socid),
        "type": 0,
        "date": int(time.time()),
        "ref_ext": ref_ext_for(order),
        "note_public": note[:MAX_DESC],
        "lines": invoice_lines(snapshot, settings, facts, order.get("invoice_extra_text") or ""),
        **invoice_terms(settings),
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
    collection = {"event": db.event_registrations, "tournament": db.tournament_registrations}.get(order.get("kind"))
    if collection is not None:
        await collection.update_one({"id": order["registration_id"]}, {"$set": {
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
    facts = await booking_facts(db, order)
    if not facts.get("person"):
        facts["person"] = user.get("display_name") or user.get("username") or ""
    payload = invoice_payload(order, socid, settings, facts=facts, person=user.get("display_name") or user.get("username") or "")
    invoice_id = await client.create_invoice(payload)
    # Sofort merken: Ab hier gibt es den Beleg - ein Abbruch darf keinen zweiten erzeugen.
    await db.billing_orders.update_one({"id": order["id"]}, {"$set": {"invoice_id": invoice_id, "thirdparty_id": socid, "updated_at": now_utc().isoformat()}})
    # Freigeben nur mit vollständigen Konditionen (#370) - sonst bleibt der Beleg Entwurf zur Prüfung.
    if settings.get("invoice_auto_validate") and terms_complete(settings):
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
