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
from datetime import datetime, timedelta, timezone

from models import new_id, now_utc
from services.billing_orders import SETTLED_STATES
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


def tax_confirmed(settings: dict) -> bool:
    """Die Steuersätze je Profil hat jemand bewusst bestätigt (#322) - erst dann darf die Website
    Belege von selbst freigeben. Ohne Bestätigung bleibt es beim Entwurf zur Prüfung."""
    return bool(settings.get("tax_confirmed_at"))


def may_auto_validate(settings: dict) -> bool:
    return bool(settings.get("invoice_auto_validate")) and terms_complete(settings) and tax_confirmed(settings)


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

def _cents(value) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(round(float(value) * 100))
    except (TypeError, ValueError):
        return None


def _day(value) -> str:
    """Ein Dolibarr-Datum (Unix-Sekunden oder Text) als Wiener Tag, sonst leer."""
    if value in (None, "", 0, "0"):
        return ""
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).astimezone(CLUB_TZ).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OverflowError):
        return str(value)[:10]


def payment_state_for(invoice_status: str, total_cents: int | None, remaining_cents: int | None, due_on: str, *, credited_cents: int = 0, today: str | None = None) -> str:
    """Der fachliche Zahlungsstand eines Belegs (#321): offen, teilweise bezahlt, bezahlt,
    überfällig, Überzahlung, gutgeschrieben, aufgegeben - aus Summe, Rest und Zahlungsziel."""
    if invoice_status == "draft":
        return "draft"
    if invoice_status == "abandoned":
        return "abandoned"
    total = total_cents or 0
    if credited_cents and total and credited_cents >= total:
        return "credited"
    if remaining_cents is None:
        return "paid" if invoice_status == "paid" else "open"
    if remaining_cents < 0:
        return "overpaid"
    if remaining_cents == 0:
        return "paid"
    if remaining_cents < total:
        return "partial"
    today = today or datetime.now(CLUB_TZ).strftime("%Y-%m-%d")
    if due_on and due_on < today:
        return "overdue"
    return "open"


def _invoice_state(invoice: dict, *, credit_notes: list[dict] | None = None, today: str | None = None) -> dict:
    status = int(invoice.get("statut") if invoice.get("statut") is not None else invoice.get("status") or 0)
    paid = bool(int(invoice.get("paye") or 0)) or status == 2
    remaining = invoice.get("remaintopay")
    invoice_status = {0: "draft", 1: "validated", 2: "paid", 3: "abandoned"}.get(status, str(status))
    total_cents, remaining_cents = _cents(invoice.get("total_ttc")), _cents(remaining)
    notes = [{"id": int(row.get("id") or 0), "ref": row.get("ref") or "", "total_cents": abs(_cents(row.get("total_ttc")) or 0),
              "status": {0: "draft", 1: "validated", 2: "paid", 3: "abandoned"}.get(int(row.get("statut") or row.get("status") or 0), "draft")}
             for row in credit_notes or []]
    credited = sum(note["total_cents"] for note in notes if note["status"] != "draft")
    due_on = _day(invoice.get("date_lim_reglement"))
    return {
        "invoice_id": int(invoice["id"]),
        "invoice_ref": invoice.get("ref") or "",
        "invoice_status": invoice_status,
        "invoice_type": int(invoice.get("type") or 0),
        "paid": paid,
        "remaining": float(remaining) if remaining not in (None, "") else None,
        "total": float(invoice.get("total_ttc") or 0) if invoice.get("total_ttc") not in (None, "") else None,
        # Der Betrag laut Dolibarr - getrennt vom eingefrorenen Preis (`total_cents` am Auftrag), der nie mitgeht.
        "remote_total_cents": total_cents,
        "remaining_cents": remaining_cents,
        "due_on": due_on,
        "credit_notes": notes,
        "payment_state": payment_state_for(invoice_status, total_cents, remaining_cents, due_on, credited_cents=credited, today=today),
        "remote_socid": int(invoice.get("socid") or 0) or None,
    }


def payment_view(row: dict) -> dict:
    """Eine Zahlung aus Dolibarrs Liste - Betrag in Cent, Tag, Art, Referenz. Keine Bankdaten."""
    return {"amount_cents": _cents(row.get("amount")) or 0, "date": _day(row.get("date")) if str(row.get("date") or "").isdigit() else str(row.get("date") or "")[:10],
            "type": str(row.get("type") or ""), "ref": str(row.get("ref") or row.get("num") or "")[:60]}


async def _mark_invoiced(db, order: dict, state: dict, *, payments: list[dict] | None = None) -> None:
    now = now_utc().isoformat()
    fields = {key: value for key, value in state.items() if key != "remote_socid"}
    await db.billing_orders.update_one({"id": order["id"]}, {"$set": {
        "status": "invoiced", "note": "", **fields, "invoiced_at": order.get("invoiced_at") or now, "synced_at": now, "updated_at": now,
        **({"payments": payments} if payments is not None else {}),
        **({"paid_at": now} if state.get("paid") and not order.get("paid_at") else {}),
    }, "$unset": {"sync_error": "", "sync_error_at": ""}})
    billing_status = "paid" if state.get("paid") else "invoiced"
    collection = {"event": db.event_registrations, "tournament": db.tournament_registrations}.get(order.get("kind"))
    if collection is not None:
        await collection.update_one({"id": order["registration_id"]}, {"$set": {
            "billing_status": billing_status, "invoice_id": state["invoice_id"], "invoice_ref": state["invoice_ref"], "invoice_status": state["invoice_status"],
            "payment_state": state.get("payment_state"),
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
    # Freigeben nur mit vollständigen Konditionen (#370) und bestätigten Steuersätzen (#322) -
    # sonst bleibt der Beleg Entwurf zur Prüfung.
    if may_auto_validate(settings):
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


RESYNC_SETTLED_HOURS = 24


def _due_query(full: bool) -> dict:
    """Welche Belege der Abgleich jetzt liest: unbezahlte immer; bezahlte, gutgeschriebene und
    aufgegebene einmal am Tag (eine spätere Gutschrift oder Löschung darf nicht unbemerkt bleiben)."""
    if full:
        return {"status": "invoiced"}
    stale = (now_utc() - timedelta(hours=RESYNC_SETTLED_HOURS)).isoformat()
    return {"status": "invoiced", "$or": [
        {"payment_state": {"$nin": list(SETTLED_STATES)}},
        {"synced_at": {"$lt": stale}},
        {"synced_at": {"$exists": False}},
    ]}


async def _review_cases(db, order: dict, state: dict, payments: list[dict] | None) -> int:
    """Was Dolibarr sagt, mit dem Auftrag vergleichen - Abweichungen werden Prüffälle, aufgelöste
    Fälle schließen sich von selbst. Nichts wird zurückgeschrieben."""
    from services import billing_cases
    from services.billing_orders import paid_cents

    opened = 0
    total = int(order.get("total_cents") or 0)
    credited = sum(note["total_cents"] for note in state.get("credit_notes") or [] if note["status"] != "draft")
    # Betrag: der Beleg muss auf den eingefrorenen Preis lauten - eine Gutschrift dazu ist in Ordnung.
    if state.get("remote_total_cents") is not None and state["remote_total_cents"] != total and state["invoice_type"] == 0:
        opened += 1
        await billing_cases.open_case(db, order, "amount_mismatch", {"invoiced_cents": total, "remote_cents": state["remote_total_cents"], "invoice_ref": state["invoice_ref"]})
    else:
        await billing_cases.auto_resolve(db, order["id"], "amount_mismatch", "Der Betrag in Dolibarr stimmt wieder mit dem Auftrag überein.")
    if order.get("thirdparty_id") and state.get("remote_socid") and int(order["thirdparty_id"]) != int(state["remote_socid"]):
        opened += 1
        await billing_cases.open_case(db, order, "recipient_mismatch", {"expected": int(order["thirdparty_id"]), "remote": int(state["remote_socid"]), "invoice_ref": state["invoice_ref"]})
    else:
        await billing_cases.auto_resolve(db, order["id"], "recipient_mismatch", "Der Beleg hängt wieder am erwarteten Geschäftspartner.")
    if state.get("payment_state") == "overpaid":
        opened += 1
        await billing_cases.open_case(db, order, "overpaid", {"over_cents": -int(state.get("remaining_cents") or 0), "invoice_ref": state["invoice_ref"]})
    else:
        await billing_cases.auto_resolve(db, order["id"], "overpaid", "Die Überzahlung ist in Dolibarr ausgeglichen.")
    if order.get("booking_state") == "cancelled":
        paid_now = paid_cents({**order, **{k: v for k, v in state.items() if k != "remote_socid"}}, payments)
        if paid_now > int(order.get("paid_cents_at_cancel") or 0):
            opened += 1
            await billing_cases.open_case(db, order, "paid_after_cancel", {"paid_cents": paid_now, "invoice_ref": state["invoice_ref"]})
        # Dolibarr hat den Storno aufgelöst: Gutschrift über den ganzen Betrag oder Beleg aufgegeben.
        if state.get("invoice_status") == "abandoned":
            await billing_cases.auto_resolve(db, order["id"], "cancelled_after_invoice", "Der Beleg ist in Dolibarr aufgegeben.")
        elif credited and credited >= total:
            refs = ", ".join(note["ref"] for note in state.get("credit_notes") or [] if note["status"] != "draft") or "Gutschrift"
            await billing_cases.auto_resolve(db, order["id"], "cancelled_after_invoice", f"In Dolibarr gutgeschrieben ({refs}).")
    await billing_cases.auto_resolve(db, order["id"], "invoice_gone", "Der Beleg ist in Dolibarr wieder lesbar.")
    return opened


async def sync_one(db, settings: dict, client: DolibarrClient, order: dict, counts: dict | None = None) -> dict | None:
    """Einen Beleg samt Zahlungen und Gutschriften nachlesen. Nicht lesbar → sichtbar am Auftrag
    (`sync_error`), nie still; verschwunden → Prüffall. Gibt den Stand zurück, None ohne."""
    from services import billing_cases

    counts = counts if counts is not None else {"looked": 0, "changed": 0, "paid": 0, "cases": 0, "errors": 0}
    counts["looked"] += 1
    now = now_utc().isoformat()
    try:
        invoice = await client.invoice(int(order["invoice_id"]))
        notes = await client.credit_notes_of(int(order["invoice_id"]))
        try:
            payments: list[dict] | None = [payment_view(row) for row in await client.invoice_payments(int(order["invoice_id"]))]
        except DolibarrError as exc:
            if exc.kind not in ("forbidden", "unauthorized"):
                raise
            payments = None   # Zahlungen darf der Website-Benutzer nicht lesen: dann gilt Summe minus Rest.
    except DolibarrError as exc:
        counts["errors"] += 1
        await db.billing_orders.update_one({"id": order["id"]}, {"$set": {"sync_error": exc.kind, "sync_error_text": exc.text, "sync_error_at": now}})
        if exc.kind == "not_found":
            counts["cases"] += 1
            await billing_cases.open_case(db, order, "invoice_gone", {"invoice_ref": order.get("invoice_ref") or "", "invoice_id": order.get("invoice_id")})
        else:
            logger.warning("[billing] Stand von Beleg %s nicht lesbar: %s", order.get("invoice_id"), exc.kind)
        return None
    state = _invoice_state(invoice, credit_notes=notes)
    changed = any(state.get(key) != order.get(key) for key in ("invoice_status", "paid", "invoice_ref", "payment_state", "remaining_cents", "remote_total_cents")) \
        or (payments is not None and payments != (order.get("payments") or [])) or state["credit_notes"] != (order.get("credit_notes") or [])
    await _mark_invoiced(db, order, state, payments=payments)
    if changed:
        counts["changed"] += 1
        if state["paid"] and not order.get("paid"):
            counts["paid"] += 1
    counts["cases"] += await _review_cases(db, order, state, payments)
    return state


async def sync_invoiced(db, settings: dict, client: DolibarrClient, limit: int = 50, *, full: bool = False, order_ids: list[str] | None = None) -> dict:
    """Belege nachlesen: freigegeben? bezahlt? teilweise? gutgeschrieben? Dolibarr ist dafür führend."""
    counts = {"looked": 0, "changed": 0, "paid": 0, "cases": 0, "errors": 0}
    query = {"status": "invoiced", "id": {"$in": list(order_ids)}} if order_ids is not None else _due_query(full)
    rows = await db.billing_orders.find(query, {"_id": 0}).sort("synced_at", 1).to_list(limit)
    for order in rows:
        await sync_one(db, settings, client, order, counts)
    return counts
