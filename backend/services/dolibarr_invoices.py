"""Eigene Rechnungen aus Dolibarr (#296): Liste, PDF, Zahlungsweg - ein Lesedienst für alle Stellen.

Wer was sieht, entscheidet allein die **bestätigte Zuordnung** des angemeldeten Kontos
(services/dolibarr_links.py): Die Mitglieds-ID kommt nie aus der Anfrage, sondern aus der Zuordnung
des Nutzers. Das Vereinsmodul prüft zusätzlich selbst, dass eine Rechnung zum Geschäftspartner
dieses Mitglieds gehört, und antwortet sonst mit 404 - dieselbe Antwort wie für eine unbekannte
Rechnung, damit niemand erfährt, ob es eine fremde gibt.

- Eine beendete Mitgliedschaft nimmt niemandem seine alten Belege: es zählt die Zuordnung, nicht
  der Status.
- PDFs werden durchgereicht und nie gespeichert (sie tragen Name und Anschrift). Die Bytes bleiben,
  wie Dolibarr sie liefert; der SHA-256 geht im Header mit.
- Der Zahlungslink kommt aus Dolibarr und wird erst im Moment des Klicks frisch nachgelesen und
  geprüft: eigener Beleg, noch offen, https, Host der Dolibarr-Installation. Kein offener Redirect.
- Fällt Dolibarr aus, steht das da - mit dem letzten verlässlichen Stand und seinem Zeitpunkt.
  „Keine Rechnungen“ oder „unbezahlt“ wird daraus nie.
- Nicht-Mitglieder (#320) sehen genau die Belege ihrer eigenen Vorgänge (``billing_orders`` mit
  Beleg) - einzeln nachgelesen über Dolibarrs Kern-API, nie „alle Rechnungen des
  Geschäftspartners“: den kann eine Familie teilen. Das PDF kommt über die Dokument-API; einen
  Online-Zahlungsweg kennt der Kern nicht, bezahlt wird per Überweisung laut Rechnung.
- Jeder Beleg trägt seine Quelle: Mitgliedsbeitrag, Event oder Turnier mit dem Vorgang dahinter.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from database import get_db
from models import now_utc
from services.dolibarr_billing import booking_facts, source_label
from services.dolibarr_client import DolibarrClient, DolibarrError, PAGE_LIMIT, load_settings
from services.dolibarr_links import verified_link
from services.dolibarr_policy import CLUB_TZ

MAX_PAGES = 30                      # 3000 Belege - weit über allem, was ein Mitglied je hat
MAX_PDF_BYTES = 25 * 1024 * 1024
CACHE_DAYS = 14

TYPE_LABELS = {"standard": "Rechnung", "replacement": "Ersatzrechnung", "credit_note": "Gutschrift", "deposit": "Anzahlungsrechnung"}
STATUS_LABELS = {"open": "offen", "overdue": "überfällig", "paid": "bezahlt", "abandoned": "aufgegeben"}
PAYABLE_STATUSES = ("open", "overdue")


class InvoiceAccessError(Exception):
    """Kein Zugriff oder nicht vorhanden - nach außen dieselbe Antwort."""


def invoice_key(invoice_id: int) -> str:
    return f"d-{int(invoice_id)}"


def parse_invoice_key(key: str) -> int:
    if not key.startswith("d-") or not key[2:].isdigit() or len(key) > 14:
        raise InvoiceAccessError()
    return int(key[2:])


def payment_url_allowed(url: str | None, settings: dict) -> bool:
    """Nur https und nur der Host der eigenen Dolibarr-Installation."""
    target = urlsplit(str(url or "").strip())
    base = urlsplit(str(settings.get("base_url") or ""))
    if target.scheme != "https" or not target.hostname or not base.hostname:
        return False
    return target.hostname.lower() == base.hostname.lower() and not target.username and not target.password


def view_invoice(raw: dict, settings: dict) -> dict:
    kind = raw.get("type") or "standard"
    status = raw.get("status") or "open"
    payable = status in PAYABLE_STATUSES and kind != "credit_note" and payment_url_allowed(raw.get("payment_url"), settings)
    return {
        "key": invoice_key(raw["id"]),
        "ref": raw.get("ref") or "",
        "type": kind,
        "type_label": TYPE_LABELS.get(kind, "Beleg"),
        "date": raw.get("date") or None,
        "due_date": raw.get("due_date") or None,
        "total": raw.get("total"),
        "remaining": raw.get("remaining"),
        "status": status,
        "status_label": STATUS_LABELS.get(status, status),
        "overdue": bool(raw.get("overdue")),
        "is_fee": bool(raw.get("fee")),
        # Der Link selbst bleibt am Server; die Oberfläche fragt ihn im Moment des Klicks ab.
        "can_pay": payable,
    }


# ---------------------------------------------------------------- Kern-API und Quelle (#320)

CORE_TYPES = {"0": "standard", "1": "replacement", "2": "credit_note", "3": "deposit"}
SOURCE_LABELS = {"club": "Verein", "event": "Event", "tournament": "Turnier", "other": "Sonstiges"}
MAX_ORDERS = 500


def _iso_date(value) -> str | None:
    """Dolibarrs Kern liefert Zeitstempel; das Vereinsmodul ISO-Tage. Hier kommt immer ein Tag raus."""
    if value in (None, "", 0, "0"):
        return None
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
        return datetime.fromtimestamp(int(value), tz=timezone.utc).astimezone(CLUB_TZ).strftime("%Y-%m-%d")
    return str(value)[:10]


def view_core_invoice(raw: dict, settings: dict, today: str | None = None) -> dict | None:
    """Ein Beleg aus Dolibarrs Kern-API in derselben Form wie aus dem Vereinsmodul (#320).

    Entwürfe gibt es nach außen nicht (None); einen Online-Zahlungsweg kennt der Kern nicht."""
    status_raw = raw.get("statut") if raw.get("statut") not in (None, "") else raw.get("status")
    statut = int(status_raw or 0)
    if statut == 0:
        return None
    kind = CORE_TYPES.get(str(raw.get("type") if raw.get("type") is not None else "0"), "standard")
    due = _iso_date(raw.get("date_lim_reglement"))
    paid = bool(int(raw.get("paye") or 0)) or statut == 2
    total = raw.get("total_ttc")
    remaining = raw.get("remaintopay")
    if statut == 3:
        status = "abandoned"
    elif paid:
        status = "paid"
    else:
        today = today or now_utc().astimezone(CLUB_TZ).strftime("%Y-%m-%d")
        status = "overdue" if due and due < today else "open"
    row = {
        "id": int(raw["id"]), "ref": raw.get("ref") or "", "type": kind, "date": _iso_date(raw.get("date")), "due_date": due,
        "total": float(total) if total not in (None, "") else None,
        "remaining": float(remaining) if remaining not in (None, "") else (0.0 if paid else None),
        "status": status, "overdue": status == "overdue", "payment_url": "", "fee": False,
    }
    return view_invoice(row, settings)


async def _order_context(db, user_id: str) -> dict[int, dict]:
    """Die eigenen Vorgänge mit Beleg: Woher ein Beleg kommt (Event, Turnier) und wofür.

    Nur ausdrücklich diesem Konto zugeordnete Einzelbelege - nie ein Geschäftspartner im Ganzen."""
    context: dict[int, dict] = {}
    rows = await db.billing_orders.find({"user_id": user_id, "invoice_id": {"$nin": [None, "", 0]}}, {"_id": 0}).to_list(MAX_ORDERS)
    for order in rows:
        facts = await booking_facts(db, order)
        kind = facts.get("kind") if facts.get("kind") in ("event", "tournament") else "other"
        context[int(order["invoice_id"])] = {
            "source": kind,
            "source_label": source_label(facts) if kind != "other" else SOURCE_LABELS["other"],
            "booking": {"name": facts.get("name") or "", "date": facts.get("date") or "", "seats": int(facts.get("seats") or 1),
                        "companions": int(facts.get("companions") or 0), "team": facts.get("team") or "", "players": int(facts.get("players") or 0)},
            "registration_id": order.get("registration_id") or "",
        }
    return context


def _with_context(rows: list[dict], context: dict[int, dict]) -> list[dict]:
    for row in rows:
        ctx = context.get(parse_invoice_key(row["key"]))
        if ctx:
            row.update({"source": ctx["source"], "source_label": ctx["source_label"], "booking": ctx["booking"], "registration_id": ctx["registration_id"]})
        else:
            row.update({"source": "club", "source_label": "Mitgliedsbeitrag" if row.get("is_fee") else SOURCE_LABELS["club"], "booking": None, "registration_id": ""})
    return rows


def _sources(rows: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        source = row.get("source") or "other"
        counts[source] = counts.get(source, 0) + 1
    return counts


def _pdf_payload(payload: dict, invoice_id: int) -> dict:
    try:
        content = base64.b64decode(str(payload.get("content") or ""), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise DolibarrError("invalid_response", 200) from exc
    if not content.startswith(b"%PDF") or len(content) > MAX_PDF_BYTES:
        raise DolibarrError("invalid_response", 200)
    filename = "".join(ch for ch in str(payload.get("filename") or "") if ch.isalnum() or ch in "._-") or f"rechnung-{invoice_id}.pdf"
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"
    return {"content": content, "filename": filename, "sha256": hashlib.sha256(content).hexdigest()}


def summarize(invoices: list[dict]) -> dict:
    """Offen ist, was Dolibarr als Rest nennt - Gutschriften zählen nicht als Forderung."""
    open_rows = [row for row in invoices if row["status"] in PAYABLE_STATUSES and row["type"] != "credit_note"]
    return {
        "count": len(invoices),
        "open_count": len(open_rows),
        "open_total": round(sum(float(row.get("remaining") or 0) for row in open_rows), 2),
        "overdue_count": sum(1 for row in open_rows if row["overdue"]),
    }


async def _access(db, user: dict) -> tuple[dict, int | None]:
    """Einstellungen und - wenn bestätigt zugeordnet - die Mitglieds-ID. Ohne Live-Betrieb gibt es nichts."""
    settings = await load_settings(db)
    if settings["mode"] != "live":
        raise InvoiceAccessError()
    link = await verified_link(db, settings, user["id"])
    member_id = int(link["member_id"]) if link and link.get("member_id") else None
    return settings, member_id


async def _fetch_all(client: DolibarrClient, member_id: int) -> list[dict]:
    rows: list[dict] = []
    for page in range(MAX_PAGES):
        batch = await client.member_invoices(member_id, page=page)
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < PAGE_LIMIT:
            break
    return rows


def _sorted(invoices: list[dict]) -> list[dict]:
    return sorted(invoices, key=lambda row: (row.get("date") or "", parse_invoice_key(row["key"])), reverse=True)


async def list_invoices(user: dict, db=None) -> dict:
    """Alle eigenen Belege, neueste zuerst: die des Mitglieds über das Vereinsmodul, dazu die
    Einzelbelege eigener Vorgänge (#320). Ohne Zuordnung und ohne Vorgang: `connected: False`."""
    db = db if db is not None else get_db()
    empty = {"connected": False, "available": True, "invoices": [], "summary": summarize([]), "currency": "EUR", "member": False, "sources": {}}
    try:
        settings, member_id = await _access(db, user)
    except InvoiceAccessError:
        return empty
    context = await _order_context(db, user["id"])
    if member_id is None and not context:
        return empty
    client = DolibarrClient(settings)
    try:
        invoices = [view_invoice(row, settings) for row in (await _fetch_all(client, member_id) if member_id else [])]
        seen = {parse_invoice_key(row["key"]) for row in invoices}
        for invoice_id in context:
            if invoice_id in seen:
                continue
            try:
                core = await client.invoice(invoice_id)
            except DolibarrError as exc:
                if exc.kind == "not_found":
                    continue   # in Dolibarr gelöscht - dann gibt es den Beleg nicht mehr
                raise
            row = view_core_invoice(core, settings)
            if row:
                invoices.append(row)
    except DolibarrError as exc:
        cached = await db.dolibarr_invoice_cache.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
        invoices = cached.get("invoices") or []
        for row in invoices:
            row["can_pay"] = False   # bezahlt wird nur gegen einen frischen Stand
        return {
            "connected": True, "available": False, "reason": exc.kind, "reason_text": exc.text,
            "as_of": cached.get("as_of"), "invoices": invoices, "summary": summarize(invoices), "currency": "EUR",
            "member": member_id is not None, "sources": _sources(invoices),
        }
    invoices = _sorted(_with_context(invoices, context))
    now = now_utc()
    await db.dolibarr_invoice_cache.update_one(
        {"user_id": user["id"]},
        {"$set": {"user_id": user["id"], "as_of": now.isoformat(), "invoices": invoices, "expires_at": now + timedelta(days=CACHE_DAYS)}},
        upsert=True,
    )
    return {"connected": True, "available": True, "as_of": now.isoformat(), "invoices": invoices,
            "summary": summarize(invoices), "currency": "EUR", "member": member_id is not None, "sources": _sources(invoices)}


async def invoice_pdf(user: dict, key: str, db=None) -> dict:
    """PDF eines eigenen Belegs: Bytes wie geliefert, Dateiname, SHA-256.

    Erst über das Mitglied (das Vereinsmodul prüft die Zugehörigkeit), sonst über den eigenen
    Vorgang und Dolibarrs Dokument-API - für Belege ohne Mitglied (#320)."""
    db = db if db is not None else get_db()
    invoice_id = parse_invoice_key(key)
    settings, member_id = await _access(db, user)
    client = DolibarrClient(settings)
    if member_id is not None:
        try:
            return _pdf_payload(await client.member_invoice_pdf(member_id, invoice_id), invoice_id)
        except DolibarrError as exc:
            if exc.kind != "not_found":
                raise
    if invoice_id not in await _order_context(db, user["id"]):
        raise InvoiceAccessError()
    try:
        core = await client.invoice(invoice_id)
        if view_core_invoice(core, settings) is None:
            raise InvoiceAccessError()   # Entwurf: nach außen nicht vorhanden
        payload = await client.invoice_document(str(core.get("ref") or ""))
    except DolibarrError as exc:
        if exc.kind == "not_found":
            raise InvoiceAccessError() from exc
        raise
    return _pdf_payload(payload, invoice_id)


async def payment_target(user: dict, key: str, db=None) -> str:
    """Zahlungslink im Moment des Klicks: frisch gelesen, eigener Beleg, noch offen, zulässiges Ziel."""
    db = db if db is not None else get_db()
    invoice_id = parse_invoice_key(key)
    settings, member_id = await _access(db, user)
    if member_id is not None:
        raw = await _fetch_all(DolibarrClient(settings), member_id)
        match = next((row for row in raw if int(row.get("id") or 0) == invoice_id), None)
        if match:
            if not view_invoice(match, settings)["can_pay"]:
                raise ValueError("Dieser Beleg lässt sich nicht (mehr) online bezahlen.")
            return str(match["payment_url"]).strip()
    if invoice_id in await _order_context(db, user["id"]):
        raise ValueError("Für diesen Beleg gibt es keinen Online-Zahlungsweg – bitte überweisen, die Bankdaten stehen auf der Rechnung.")
    raise InvoiceAccessError()


async def forget_cache(db, user_id: str) -> None:
    await db.dolibarr_invoice_cache.delete_many({"user_id": user_id})
