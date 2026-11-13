"""Rechnungsaufträge (#317, Grundlage): dauerhaftes Postfach zwischen Buchung und Dolibarr.

Eine bestätigte, kostenpflichtige Buchung schreibt einen **Auftrag** in ``billing_orders`` - in
derselben Datenbank wie die Buchung, nie nur im Prozessspeicher. Ein Job sieht regelmäßig nach
und bringt jeden Auftrag einen Schritt weiter. Was er dafür braucht, sagt der Status:

- ``pending``               neu, noch nicht angesehen
- ``waiting_write_access``  Dolibarr ist angebunden, aber ohne Schreibzugriff (eigener Schlüssel fehlt)
- ``waiting_link``          die Person hat noch keinen Geschäftspartner in Dolibarr
- ``waiting_review``        in Dolibarr gibt es schon einen Geschäftspartner mit derselben E-Mail -
                            die Finanzverwaltung ordnet zu oder lässt neu anlegen
- ``held``                  Rechnungszeitpunkt „erst nach Freigabe“ oder der Entwurf wurde in Dolibarr gelöscht
                            (``removed_invoices``, #2226) - wartet auf die Finanzverwaltung
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
darauf - offen, teilweise bezahlt, bezahlt, bezahlt mit Abzug, überfällig, Überzahlung, gutgeschrieben, aufgegeben.
**Erstattungen** sind kein Beleg und keine Gutschrift: Die Finanzverwaltung erfasst am Auftrag,
was tatsächlich zurücküberwiesen wurde (Betrag, Tag, Referenz), nie mehr als bezahlt ist.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

from pymongo.errors import DuplicateKeyError

from database import get_db
from models import new_id, now_utc
from services.billing_amounts import credited_cents, invoice_fields, own_registration, paid_cents, refunded_cents, waived_cents

logger = logging.getLogger("tls.billing")

OPEN_STATUSES = ("pending", "waiting_write_access", "waiting_link", "waiting_review", "ready")
# Die Belegfelder einer Anmeldung, wenn ihr alter Beleg nicht mehr gilt und ein neuer Auftrag kommt (#2184).
INVOICE_LINK_CLEARED = {"invoice_id": None, "invoice_ref": None, "invoice_status": None, "payment_state": None}
# Ein Beleg, der in Dolibarr noch gilt (#2184): nicht voll gutgeschrieben und nicht aufgegeben.
INVOICE_STILL_VALID = {"payment_state": {"$nin": ["credited", "abandoned"]}, "invoice_status": {"$ne": "abandoned"}}
# Ein Auftrag, der nichts mehr trägt: Buchung storniert und der Beleg gutgeschrieben oder aufgegeben - er hält keine neue Buchung auf.
SETTLED_AFTER_CANCEL = {"booking_state": "cancelled", "$or": [{"payment_state": {"$in": ["credited", "abandoned"]}}, {"invoice_status": "abandoned"}]}
# Der Grund im Prüffall der Finanzverwaltung, wenn eine beendete Anmeldung trotz Beleg zurückkommt (#2127, #2184) - für Events
# und Turniere (#2368) derselbe.
REBOOKED_SELF = "Nach Storno selbst neu angemeldet"
REBOOKED_BY_LEAD = "Anmeldung wieder aktiviert"
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
    "paid_reduced": "bezahlt mit Abzug",
    "overdue": "überfällig",
    "overpaid": "Überzahlung",
    "credited": "gutgeschrieben",
    "abandoned": "aufgegeben",
}
# Grund des Abschlusses in Dolibarr (`close_code`, #2226) als Klartext - nur für die Verwaltung, wie die Anmerkung (`close_note`).
CLOSE_REASONS = {
    "discount_vat": "Skonto oder Nachlass",
    "badcustomer": "Zahlungsausfall",
    "product_returned": "Leistung zurückgegeben",
    "bankcharge": "Bankspesen",
    "withholdingtax": "Quellensteuer",
    "other": "Sonstiger Grund",
    "abandon": "Aufgegeben",
    "replaced": "Durch einen anderen Beleg ersetzt",
}
MAX_REFUND_REFERENCE = 120
MAX_REASON = 500


def close_reason(order: dict) -> str | None:
    """Der Grund als Satz; ein Code, den die Website nicht kennt, wird nicht roh gezeigt. Ohne Code keiner."""
    code = order.get("close_code")
    return CLOSE_REASONS.get(code, "Grund in Dolibarr nachsehen") if code else None


def booking_key(kind: str, registration_id: str, snapshot: dict | None) -> str | None:
    """Ein eingefrorener Preis ergibt höchstens einen Auftrag (#1184): Art, Buchung und der Hash des Snapshots. Ein neuer
    Preis (nach Storno neu bestätigt) hat einen neuen Hash und damit seinen eigenen Auftrag. Der eindeutige Index steht in
    database.AUDIT_UNIQUE_INDEXES."""
    digest = (snapshot or {}).get("hash")
    return f"{kind}:{registration_id}:{digest}" if digest else None


async def create_order(db, *, kind: str, source_id: str, registration_id: str, user_id: str, snapshot: dict, timing: str) -> dict | None:
    """Ein Auftrag je Buchung. Gibt es schon einen offenen oder erledigten, bleibt er.

    Idempotent (#1184): derselbe eingefrorene Preis legt auch bei Wiederholung oder gleichzeitigen Anfragen nur einen
    Auftrag an - der eindeutige ``booking_key`` fängt das Rennen ab, dann gilt der vorhandene Auftrag."""
    if int(snapshot.get("total_cents") or 0) <= 0:
        return None
    key = booking_key(kind, registration_id, snapshot)
    if key:
        same = await db.billing_orders.find_one({"booking_key": key}, {"_id": 0})
        if same:
            return same
    # Ein stornierter Auftrag einer anderen zahlenden Person hält keine neue Buchung auf (#2368: ein anderes Teammitglied übernimmt
    # die Turnier-Anmeldung und zahlt selbst) - bei Events zahlt immer die angemeldete Person, dort ändert sich nichts.
    existing = await db.billing_orders.find_one({"kind": kind, "registration_id": registration_id, "status": {"$nin": ["cancelled", "failed"]},
                                                 "$nor": [SETTLED_AFTER_CANCEL, {"booking_state": "cancelled", "user_id": {"$ne": user_id}}]}, {"_id": 0})
    if existing:
        return existing
    order = {
        "id": new_id(),
        **({"booking_key": key} if key else {}),
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
    try:
        await db.billing_orders.insert_one(order)
    except DuplicateKeyError:
        same = await db.billing_orders.find_one({"booking_key": key}, {"_id": 0}) if key else None
        if same:
            return same
        raise
    order.pop("_id", None)
    return order


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
    credit_draft: bool | None = None
    async for order in db.billing_orders.find({"kind": kind, "registration_id": registration_id, "status": "invoiced", "booking_state": {"$ne": "cancelled"}}, {"_id": 0}):
        if credit_draft is None:
            # Gutschrift-Entwurf bei Abmeldung (#843): nur vormerken - Dolibarr fragt der Abgleich, nicht die Abmeldung.
            switch = await db.settings.find_one({"id": "dolibarr"}, {"_id": 0, "credit_note_draft_on_cancel": 1}) or {}
            credit_draft = bool(switch.get("credit_note_draft_on_cancel"))
        await db.billing_orders.update_one({"id": order["id"]}, {"$set": {
            "booking_state": "cancelled", "booking_cancelled_at": now, "cancel_reason": reason, "paid_cents_at_cancel": paid_cents(order), "updated_at": now,
            **({"credit_note_due_at": now} if credit_draft and not order.get("credit_note_id") else {}),
        }, "$push": {"booking_events": {"state": "cancelled", "at": now, "reason": reason}}})
        await billing_cases.open_case(db, order, "cancelled_after_invoice", {"reason": reason, "invoice_ref": order.get("invoice_ref") or "", "paid_cents": paid_cents(order),
                                                                            "invoice_status": order.get("invoice_status")})
        count += 1
    return count


async def note_change_after_invoice(db, order: dict | None, *, reason: str, new_total_cents: int) -> dict | None:
    """Begleitpersonen, Roster oder Positionen ändern sich, obwohl der Beleg schon existiert: der
    eingefrorene Preis bleibt, die Finanzverwaltung bekommt einen Prüffall mit alt und neu. Am übergebenen Auftrag (#2184) -
    eine Anmeldung kann mehrere haben (ein alter, gutgeschriebener und der aktuelle), gesucht wird hier nichts."""
    from services import billing_cases

    if not order:
        return None
    order = await db.billing_orders.find_one({"id": order["id"], "status": "invoiced"}, {"_id": 0})
    if not order:
        return None
    now = now_utc().isoformat()
    await db.billing_orders.update_one({"id": order["id"]}, {"$set": {"booking_changed_at": now, "booking_change": reason, "updated_at": now}})
    return await billing_cases.open_case(db, order, "changed_after_invoice", {
        "reason": reason, "invoiced_cents": int(order.get("total_cents") or 0), "new_total_cents": int(new_total_cents), "invoice_ref": order.get("invoice_ref") or "",
    })


async def invoiced_order(db, *, kind: str, registration_id: str) -> dict | None:
    """Der Auftrag, zu dem es in Dolibarr einen gültigen Beleg gibt - Entwurf, freigegeben, bezahlt, auch mit Abzug. Ein in Dolibarr
    gelöschter Entwurf (#2226) zählt nicht mehr: Sein Auftrag wartet oder ist zu. Ein voll gutgeschriebener oder aufgegebener
    Beleg auch nicht (#2184): Wer danach zurückkommt, bekommt einen neuen Auftrag zum aktuellen Preis."""
    return await db.billing_orders.find_one({"kind": kind, "registration_id": registration_id, "status": "invoiced", **INVOICE_STILL_VALID}, {"_id": 0},
                                            sort=[("created_at", -1)])


def _own_order_filter(kind: str, registration: dict) -> dict:
    """Der Auftrag, zu dem die Anmeldung gerade gehört: derselbe eingefrorene Preis (#2184). Die Kennung bestimmt ihn eindeutig -
    auch wenn sein Beleg inzwischen gutgeschrieben ist. Ohne Kennung (Altdaten) alle Aufträge der Anmeldung."""
    digest = (registration.get("price_snapshot") or {}).get("hash")
    return {"kind": kind, "registration_id": registration["id"], "status": "invoiced", **({"snapshot.hash": digest} if digest else {})}


async def current_invoiced_order(db, *, kind: str, registration: dict) -> dict | None:
    """Der Auftrag mit Beleg, zu dem die Anmeldung gerade gehört - nicht ein alter derselben Anmeldung (#2184). Mit Preis-Kennung
    genau dieser, auch voll gutgeschrieben (die Finanzverwaltung soll die Änderung sehen); ohne Kennung (Altdaten) der jüngste gültige."""
    query = _own_order_filter(kind, registration)
    if "snapshot.hash" not in query:
        query.update(INVOICE_STILL_VALID)
    return await db.billing_orders.find_one(query, {"_id": 0}, sort=[("created_at", -1)])


async def booking_cancelled_with_invoice(db, *, kind: str, registration: dict) -> bool:
    """Ist die Buchung am Auftrag der Anmeldung storniert, obwohl der Beleg existiert? Das entscheidet über die Rückkehr (#2184) -
    nicht der Stand der Anmeldung, den der Abgleich zwischendurch wieder auf den des Belegs setzt. Gefragt wird nur der Auftrag,
    zu dem die Anmeldung gehört: Ein alter, gutgeschriebener bleibt für immer „storniert“, nachdem es einen neuen gibt. Ist der
    eigene Beleg inzwischen gutgeschrieben, zählt die Rückkehr trotzdem - dann mit neuem Preis (``invoiced_order`` findet ihn nicht)."""
    return await db.billing_orders.find_one({**_own_order_filter(kind, registration), "booking_state": "cancelled"}, {"_id": 0, "id": 1}) is not None


def rebooked_fields(order: dict) -> dict:
    """Nach einem Storno wieder dabei, obwohl der Beleg schon existiert (#2127 Leitung, #2184 selbst neu angemeldet): Die
    Anmeldung bekommt keinen neuen Preis, sondern wieder den des Belegs und seinen Stand - wie nach dem nächsten Abgleich.
    Den Prüffall dazu öffnet ``note_change_after_invoice``; ein zweiter Auftrag entsteht nicht."""
    return {**({"price_snapshot": order["snapshot"]} if order.get("snapshot") else {}), **invoice_fields(order)}


async def rebook_after_invoice(db, order: dict, *, reason: str, new_total_cents: int) -> bool:
    """Die stornierte Buchung ist zurück (#2184): Am Auftrag gilt sie wieder als gebucht - ohne das bliebe der Auftrag
    „storniert“, ein vorgemerkter Gutschrift-Entwurf entstünde trotzdem, eine Zahlung würde zur „Zahlung auf stornierte
    Buchung“, und ein gelöschter Entwurf beendete den Auftrag. Ein schon angelegter Gutschrift-Entwurf bleibt (die
    Finanzverwaltung entscheidet), der Fall „Storniert, Beleg existiert“ ebenso. Dazu der Prüffall mit alt und neu.

    Vergleichen und Setzen in einem Zug: Gilt der Beleg inzwischen nicht mehr (der Abgleich hat dazwischen eine volle
    Gutschrift, ein Aufgeben oder einen gelöschten Entwurf gelesen), gibt es ``False`` - der Aufrufer friert dann einen neuen
    Preis mit eigenem Auftrag ein. Ist die Buchung schon zurück, ist das kein Fehler (``True``)."""
    now = now_utc().isoformat()
    # Altaufträge kennen nur den letzten Storno (``booking_cancelled_at``): Er kommt zuerst in den Verlauf, sonst überschriebe ihn
    # der nächste Storno.
    legacy = await db.billing_orders.find_one({"id": order["id"], "booking_events": {"$exists": False}, "booking_cancelled_at": {"$exists": True}},
                                              {"_id": 0, "booking_cancelled_at": 1, "cancel_reason": 1})
    if legacy:
        await db.billing_orders.update_one({"id": order["id"], "booking_events": {"$exists": False}}, {"$set": {"booking_events": [
            {"state": "cancelled", "at": legacy["booking_cancelled_at"], "reason": legacy.get("cancel_reason") or ""}]}})
    # Der Verlauf behält den Storno (``booking_cancelled_at``, ``booking_events``) und bekommt die Rückkehr dazu.
    restored = await db.billing_orders.update_one({"id": order["id"], "status": "invoiced", "booking_state": "cancelled", **INVOICE_STILL_VALID}, {
        "$set": {"updated_at": now}, "$unset": {"booking_state": "", "paid_cents_at_cancel": ""},
        "$push": {"booking_events": {"state": "restored", "at": now, "reason": reason}}})
    if restored.modified_count != 1:
        already = await db.billing_orders.find_one({"id": order["id"], "status": "invoiced", "booking_state": {"$ne": "cancelled"}, **INVOICE_STILL_VALID},
                                                   {"_id": 0, "id": 1})
        if not already:
            return False
    await db.billing_orders.update_one(
        {"id": order["id"], "credit_note_due_at": {"$exists": True}, "credit_note_id": {"$exists": False}, "credit_note_claim_at": {"$exists": False}},
        {"$unset": {"credit_note_due_at": ""}})
    # Läuft gerade ein Gutschrift-Lauf (Merker gesetzt), geht die Rückkehr nicht still durch: Der Lauf liest diesen Merker nach dem
    # Anlegen und meldet einen Entwurf, der trotz Rückkehr entstand, als Prüffall (``dolibarr_billing.draft_credit_note``).
    await db.billing_orders.update_one({"id": order["id"], "credit_note_claim_at": {"$exists": True}, "credit_note_id": {"$exists": False}},
                                       {"$set": {"credit_note_returned_at": now}})
    # Liegt der Gutschrift-Entwurf der Website schon in Dolibarr, öffnet die Rückkehr den Fall selbst - so ist jede Reihenfolge
    # mit dem Gutschrift-Lauf abgedeckt, auch eine Rückkehr Tage nach dem Anlegen.
    credit = await db.billing_orders.find_one({"id": order["id"], "credit_note_id": {"$exists": True}, "credit_note_source": "website"},
                                              {"_id": 0, "credit_note_id": 1, "credit_note_ref": 1, "credit_note_created_at": 1, "credit_notes": 1, "synced_at": 1})
    if credit and await _credit_draft_still_open(db, order["id"], credit):
        from services.dolibarr_billing import credit_after_return_case

        await credit_after_return_case(db, order, credit.get("credit_note_ref") or "", now)
    await note_change_after_invoice(db, order, reason=reason, new_total_cents=new_total_cents)
    return True


async def _credit_draft_still_open(db, order_id: str, credit: dict) -> bool:
    """Gibt es zum Website-Entwurf noch etwas zu tun (#2184)? Nur solange er laut zuletzt gelesenem Stand Entwurf ist (gelöscht oder
    freigegeben: nein) und die Finanzverwaltung den Fall dazu nicht schon erledigt hat - sonst öffnete jede weitere Rückkehr ihn neu."""
    note = next((row for row in credit.get("credit_notes") or [] if int(row.get("id") or 0) == int(credit["credit_note_id"])), None)
    if note is not None and note.get("status") != "draft":
        return False
    if note is None and str(credit.get("synced_at") or "") > str(credit.get("credit_note_created_at") or ""):
        return False   # seit dem Anlegen gelesen und nicht mehr da: in Dolibarr gelöscht
    done = await db.billing_cases.find_one({"order_id": order_id, "kind": "credit_after_return", "status": "resolved",
                                            "detail.credit_note_ref": credit.get("credit_note_ref") or ""}, {"_id": 0, "id": 1})
    return done is None


async def release_order(db, order_id: str, actor_id: str) -> dict | None:
    """Rechnungszeitpunkt „bewusst später“: die Freigabe durch die Finanzverwaltung."""
    await db.billing_orders.update_one({"id": order_id, "status": "held"}, {"$set": {"status": "pending", "released_by": actor_id, "released_at": now_utc().isoformat(), "updated_at": now_utc().isoformat()}})
    return await db.billing_orders.find_one({"id": order_id}, {"_id": 0})


async def waits_after_removed_draft(db, *, kind: str, registration_id: str) -> bool:
    """Wartet die Anmeldung darauf, dass die Finanzverwaltung über einen gelöschten Entwurf entscheidet (#2226)?"""
    return await db.billing_orders.find_one({"kind": kind, "registration_id": registration_id, "status": "held", "removed_invoices": {"$exists": True}}, {"_id": 0, "id": 1}) is not None


async def dismiss_removed(db, order: dict, actor_id: str) -> bool:
    """Der Entwurf ist in Dolibarr gelöscht (#2226), und es soll keine neue Rechnung geben: Der Auftrag ist zu Ende,
    die Anmeldung bleibt, ihr Preis zählt nicht mehr. ``False``: Der Auftrag wartet nicht mehr, dann ändert sich nichts."""
    now = now_utc().isoformat()
    done = await db.billing_orders.update_one({"id": order["id"], "status": "held"}, {"$set": {
        "status": "cancelled", "cancel_reason": "Entwurf in Dolibarr gelöscht, keine neue Rechnung", "note": "", "updated_at": now}})
    if done.modified_count != 1:
        return False
    collection ={"event": db.event_registrations, "tournament": db.tournament_registrations}.get(order.get("kind"))
    if collection is not None:
        await collection.update_one(own_registration(order), {"$set": {"billing_status": "cancelled"}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "billing.order.dismiss", "target_id": order["id"], "actor_id": actor_id,
                                    "data": {"registration_id": order.get("registration_id"), "total_cents": order.get("total_cents")}, "created_at": now})
    return True


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
            status, note = "waiting_write_access", "Für Rechnungen fehlt der Schreibzugriff – Stand und Rechnungsangaben unter Finanzübersicht → Rechnungsangaben."
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
    counts = await sync_invoiced(db, settings, client, limit, full=full, order_ids=order_ids)
    # Vorgemerkte Gutschrift-Entwürfe (#843) - nur mit Schalter und Schreibzugriff.
    from services.dolibarr_billing import draft_credit_notes_due
    counts["credit_drafts"] = await draft_credit_notes_due(db, settings, client)
    return counts


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


REFUND_ATTEMPTS = 5


def _same_money(order: dict) -> dict:
    """Bedingung „Zahlungen und Erstattungen sind noch die, die ich gelesen habe“ (#1034): ``money_rev`` steigt bei
    jedem Abgleich der Zahlungen und jeder Erstattung. Aufträge von vorher haben das Feld nicht - sie gelten als 0."""
    rev = int(order.get("money_rev") or 0)
    return {"money_rev": rev} if rev else {"money_rev": {"$in": [None, 0]}}


async def add_refund(db, order: dict, actor_id: str, *, amount_cents: int, paid_on: str, reference: str, reason: str,
                     request_id: str | None = None) -> dict:
    """Rückzahlung erfassen, nachdem sie außerhalb der Website passiert ist (Überweisung, bar).
    Nie mehr als bezahlt, nie ohne Grund; kein Auslöser für irgendetwas in Dolibarr.

    Gleichzeitig und wiederholt sicher (#1034): Geschrieben wird nur, wenn seit dem Lesen weder eine andere
    Erstattung dazukam noch der Abgleich die Zahlungen geändert hat - sonst neu lesen und neu rechnen. Kommt dieselbe Erfassung (``request_id``) ein zweites Mal an, gilt
    der schon gespeicherte Eintrag."""
    amount = int(amount_cents)
    if amount <= 0:
        raise RefundError("Der Betrag muss größer als null sein.")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(paid_on or "")):
        raise RefundError("Der Tag der Rückzahlung fehlt (JJJJ-MM-TT).")
    if not (reason or "").strip():
        raise RefundError("Ein Grund ist Pflicht (z. B. „Begleitperson entfallen, Gutschrift GA2026-0003“).")
    request_id = (request_id or "").strip()[:64] or None
    for _ in range(REFUND_ATTEMPTS):
        if request_id:
            earlier = next((row for row in order.get("refunds") or [] if row.get("request_id") == request_id), None)
            if earlier:
                return earlier
        refundable = paid_cents(order) - refunded_cents(order)
        if amount > refundable:
            from services.pricing import format_cents
            raise RefundError(f"Erstattbar sind höchstens {format_cents(max(0, refundable), order.get('currency') or 'EUR')} (bezahlt abzüglich schon erstattet).")
        refund = {
            "id": new_id(), "amount_cents": amount, "paid_on": paid_on, "reference": (reference or "").strip()[:MAX_REFUND_REFERENCE],
            "reason": reason.strip()[:MAX_REASON], "recorded_by": actor_id, "recorded_at": now_utc().isoformat(),
            **({"request_id": request_id} if request_id else {}),
        }
        written = await db.billing_orders.update_one({"id": order["id"], **_same_money(order)},
                                                     {"$push": {"refunds": refund}, "$set": {"updated_at": now_utc().isoformat()},
                                                      "$inc": {"money_rev": 1}})
        if written.modified_count:
            break
        order = await db.billing_orders.find_one({"id": order["id"]}, {"_id": 0})
        if not order:
            raise RefundError("Der Auftrag ist nicht mehr da.")
    else:
        raise RefundError("Gerade wurden mehrere Erstattungen gleichzeitig erfasst. Bitte neu laden und nochmals prüfen.")
    await db.audit_logs.insert_one({"id": new_id(), "action": "billing.refund.record", "target_id": order["id"], "actor_id": actor_id,
                                    "data": {"registration_id": order.get("registration_id"), "amount_cents": amount, "paid_on": paid_on, "reason": refund["reason"]},
                                    "created_at": now_utc().isoformat()})
    return refund


# Wo Belege hängen (#842): drei Blicke für den Kassier - mit Zahl in Finanzen und in der Tageszentrale.
ATTENTION = {"pdf_missing": "PDF fehlt", "draft_old": "Entwurf seit mehr als 7 Tagen", "overdue": "überfällig"}
DRAFT_DAYS = 7
# Was nicht mehr offen ist, ist nie überfällig - auch wenn das Zahlungsziel vorbei ist.
NOT_OPEN_STATES = ("paid", "paid_reduced", "credited", "abandoned", "overpaid")


def attention_query(name: str, now=None) -> dict:
    """Die Abfrage je Blick: „PDF fehlt“ (freigegeben, PDF nicht bestätigt - #840), „Entwurf seit mehr als 7 Tagen“
    (noch nicht freigegeben), „überfällig“ (Zahlungsziel vor heute, Rest offen - nach dem Wiener Tag, frisch gerechnet,
    auch wenn der Abgleich den Stand noch nicht neu geschrieben hat)."""
    moment = now or now_utc()
    if name == "pdf_missing":
        from services.dolibarr_billing import missing_pdf_query
        return missing_pdf_query()
    if name == "draft_old":
        return {"status": "invoiced", "invoice_status": "draft", "invoiced_at": {"$lt": (moment - timedelta(days=DRAFT_DAYS)).isoformat()}}
    if name == "overdue":
        from services.dolibarr_policy import CLUB_TZ
        today = moment.astimezone(CLUB_TZ).strftime("%Y-%m-%d")
        return {"status": "invoiced", "invoice_status": "validated", "due_on": {"$gt": "", "$lt": today},
                "payment_state": {"$nin": list(NOT_OPEN_STATES)}, "$or": [{"remaining_cents": {"$gt": 0}}, {"remaining_cents": None}]}
    raise ValueError(f"unbekannter Blick: {name}")


async def attention_counts(db, base: dict | None = None, now=None) -> dict:
    """Wie viele Belege je Blick hängen - in der Auswahl `base` (Art, Veranstaltung, Person)."""
    return {name: int(await db.billing_orders.count_documents({**(base or {}), **attention_query(name, now)})) for name in ATTENTION}


def _row_query(*, kind: str | None = None, source_id: str | None = None, user_ids: list[str] | None = None) -> dict:
    query: dict = {}
    if kind in ("event", "tournament"):
        query["kind"] = kind
    if source_id:
        query["source_id"] = source_id
    if user_ids is not None:
        query["user_id"] = {"$in": list(user_ids)}
    return query


def invoiced_row_query(*, kind: str | None = None, source_id: str | None = None, user_ids: list[str] | None = None, attention: str | None = None) -> dict:
    base = _row_query(kind=kind, source_id=source_id, user_ids=user_ids)
    return {**base, **attention_query(attention)} if attention in ATTENTION else {**base, "status": "invoiced"}


# So viele Zeilen zeigt die Übersicht (#2131): die Seite nennt „N von M“, vollständig ist der Export.
OPEN_LIST_LIMIT = 200
INVOICED_LIST_LIMIT = 250


async def overview(db, *, kind: str | None = None, source_id: str | None = None, user_ids: list[str] | None = None, attention: str | None = None) -> dict:
    """Für die Finanzübersicht (#322): Zahlen je Status, die offenen Aufträge, die angelegten Belege
    mit Zahlungsstand, die offenen Prüffälle. `attention` (#842) zeigt nur die Belege eines Blicks."""
    from services import billing_cases

    base = _row_query(kind=kind, source_id=source_id, user_ids=user_ids)
    by_status: dict[str, int] = {}
    async for row in db.billing_orders.aggregate([{"$match": base}, {"$group": {"_id": "$status", "n": {"$sum": 1}, "cents": {"$sum": "$total_cents"}}}]):
        by_status[row["_id"]] = {"count": int(row["n"]), "total_cents": int(row.get("cents") or 0)}
    open_query = {**base, "status": {"$in": list(OPEN_STATUSES) + ["held", "failed"]}}
    open_orders = await db.billing_orders.find(open_query, {"_id": 0, "snapshot": 0}).sort("created_at", 1).limit(OPEN_LIST_LIMIT).to_list(OPEN_LIST_LIMIT)
    invoiced_query = invoiced_row_query(kind=kind, source_id=source_id, user_ids=user_ids, attention=attention)
    # Mit den Zahlungen: ohne sie wäre „bezahlt“ nur Summe minus Rest, und eine Gutschrift zählte als Zahlung. Die Route nimmt sie nach dem Rechnen wieder heraus.
    invoiced = await db.billing_orders.find(invoiced_query, {"_id": 0, "snapshot": 0}).sort("updated_at", -1).limit(INVOICED_LIST_LIMIT).to_list(INVOICED_LIST_LIMIT)
    # Kachel und Liste (#2131) lesen dieselbe Auswahl; die Liste kürzt, der Zähler nicht.
    selection = {"kind": kind, "source_id": source_id, "user_ids": user_ids}
    cases = await billing_cases.list_cases(db, "open", **selection)
    return {"by_status": by_status, "labels": STATUS_LABELS, "payment_labels": PAYMENT_STATE_LABELS, "open": open_orders, "invoiced": invoiced,
            "open_total": int(await db.billing_orders.count_documents(open_query)), "invoiced_total": int(await db.billing_orders.count_documents(invoiced_query)),
            "cases": cases, "cases_open": await billing_cases.count_cases(db, "open", **selection), "cases_resolved": await billing_cases.count_cases(db, "resolved", **selection),
            "attention": await attention_counts(db, base), "attention_labels": ATTENTION, "attention_active": attention if attention in ATTENTION else ""}


def export_period(date_from: str | None, date_to: str | None) -> dict:
    """Der Zeitraum eines Exports als Bedingung auf den Beleg: von 00:00 bis einschließlich 24:00 nach der Wiener Uhr.
    Ohne Angaben keine Bedingung. ValueError bei einem Tag, den es nicht gibt, oder „von“ nach „bis“."""
    from services.dolibarr_policy import CLUB_TZ

    def day_start(text: str) -> datetime:
        return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=CLUB_TZ)

    start = day_start(date_from) if date_from else None
    end = day_start(date_to) if date_to else None
    if start and end and start > end:
        raise ValueError("Der Zeitraum beginnt nach seinem Ende.")
    period: dict = {}
    try:
        if start:
            period["$gte"] = start.astimezone(timezone.utc).isoformat()
        if end:
            # Rechnen mit Zone heißt Wanduhr: der nächste Wiener Mitternacht, auch am Tag der Zeitumstellung (23 oder 25 Stunden).
            period["$lt"] = (end + timedelta(days=1)).astimezone(timezone.utc).isoformat()
    except OverflowError as exc:
        # Am Rand des Kalenders (Jahr 1, Jahr 9999) läuft die Umrechnung über.
        raise ValueError("Der Zeitraum liegt außerhalb des Kalenders.") from exc
    return {"invoiced_at": period} if period else {}


async def export_rows(db, *, kind: str | None = None, source_id: str | None = None, user_ids: list[str] | None = None, attention: str | None = None,
                      date_from: str | None = None, date_to: str | None = None) -> list[dict]:
    """Alle Belege der Auswahl für den Export (#2131) - ohne die Grenze der Liste, nach dem Tag des Anlegens sortiert."""
    selection = invoiced_row_query(kind=kind, source_id=source_id, user_ids=user_ids, attention=attention)
    period = export_period(date_from, date_to)
    # Mit $and: „Entwurf alt“ fragt selbst nach dem Tag des Anlegens - der Zeitraum kommt dazu, statt ihn zu ersetzen.
    query = {"$and": [selection, period]} if period else selection
    return await db.billing_orders.find(query, {"_id": 0, "snapshot": 0}).sort([("invoiced_at", 1), ("invoice_ref", 1)]).to_list(None)


async def source_summary(db, kind: str, source_id: str) -> dict:
    """Die Zahlen einer Veranstaltung (#322), getrennt statt in einen Topf: gebucht, fakturiert,
    bezahlt, offen, gutgeschrieben, erlassen, erstattet - jede Belegrevision nur einmal."""
    totals = {"booked_cents": 0, "invoiced_cents": 0, "paid_cents": 0, "open_cents": 0, "credited_cents": 0, "waived_cents": 0, "refunded_cents": 0,
              "orders": 0, "cancelled_orders": 0, "cases_open": 0}
    async for order in db.billing_orders.find({"kind": kind, "source_id": source_id}, {"_id": 0, "snapshot": 0}):
        if order.get("status") == "held" and order.get("removed_invoices"):
            continue   # Entwurf in Dolibarr gelöscht (#2226): zählt erst wieder, wenn neu abgerechnet wird.
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
            totals["waived_cents"] += waived_cents(order)
            if order.get("payment_state") in ("open", "partial", "overdue"):
                remaining = order.get("remaining_cents")
                totals["open_cents"] += max(0, int(remaining)) if remaining is not None else max(0, total - paid)
        totals["refunded_cents"] += refunded_cents(order)
    totals["cases_open"] = int(await db.billing_cases.count_documents({"source_kind": kind, "source_id": source_id, "status": "open"}))
    return totals


async def anonymize_user(db, user_id: str) -> int:
    """Kontolöschung (#322): Belege bleiben in Dolibarr (Aufbewahrung nach BAO), der Auftrag hier
    behält Betrag, Belegnummer und Zeitpunkte - aber keinen Namen, keine E-Mail und keine Anmerkung
    zum Abschluss (freier Text, #2226) mehr. Die Zuordnung Konto ↔ Geschäftspartner fällt weg."""
    now = now_utc().isoformat()
    result = await db.billing_orders.update_many({"user_id": user_id}, {"$set": {
        "snapshot.recipient.display_name": "Gelöschter User", "snapshot.recipient.email": None, "anonymized_at": now, "updated_at": now,
    }, "$unset": {"close_note": ""}})
    await db.billing_customers.delete_many({"user_id": user_id})
    return int(result.modified_count)
