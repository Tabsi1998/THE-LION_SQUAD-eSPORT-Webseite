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
"""
from __future__ import annotations

import base64
import binascii
import hashlib
from datetime import timedelta
from urllib.parse import urlsplit

from database import get_db
from models import now_utc
from services.dolibarr_client import DolibarrClient, DolibarrError, PAGE_LIMIT, load_settings
from services.dolibarr_links import verified_link

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


def summarize(invoices: list[dict]) -> dict:
    """Offen ist, was Dolibarr als Rest nennt - Gutschriften zählen nicht als Forderung."""
    open_rows = [row for row in invoices if row["status"] in PAYABLE_STATUSES and row["type"] != "credit_note"]
    return {
        "count": len(invoices),
        "open_count": len(open_rows),
        "open_total": round(sum(float(row.get("remaining") or 0) for row in open_rows), 2),
        "overdue_count": sum(1 for row in open_rows if row["overdue"]),
    }


async def _member_for(db, user: dict) -> tuple[dict, dict]:
    settings = await load_settings(db)
    if settings["mode"] != "live":
        raise InvoiceAccessError()
    link = await verified_link(db, settings, user["id"])
    if not link or not link.get("member_id"):
        raise InvoiceAccessError()
    return settings, link


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


async def list_invoices(user: dict, db=None) -> dict:
    """Alle eigenen Belege, neueste zuerst. Ohne Zuordnung: `connected: False`, keine Fehlermeldung."""
    db = db if db is not None else get_db()
    try:
        settings, link = await _member_for(db, user)
    except InvoiceAccessError:
        return {"connected": False, "available": True, "invoices": [], "summary": summarize([]), "currency": "EUR"}
    try:
        raw = await _fetch_all(DolibarrClient(settings), link["member_id"])
    except DolibarrError as exc:
        cached = await db.dolibarr_invoice_cache.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
        invoices = cached.get("invoices") or []
        for row in invoices:
            row["can_pay"] = False   # bezahlt wird nur gegen einen frischen Stand
        return {
            "connected": True, "available": False, "reason": exc.kind, "reason_text": exc.text,
            "as_of": cached.get("as_of"), "invoices": invoices, "summary": summarize(invoices), "currency": "EUR",
        }
    invoices = [view_invoice(row, settings) for row in raw]
    now = now_utc()
    await db.dolibarr_invoice_cache.update_one(
        {"user_id": user["id"]},
        {"$set": {"user_id": user["id"], "as_of": now.isoformat(), "invoices": invoices, "expires_at": now + timedelta(days=CACHE_DAYS)}},
        upsert=True,
    )
    return {"connected": True, "available": True, "as_of": now.isoformat(), "invoices": invoices,
            "summary": summarize(invoices), "currency": "EUR"}


async def invoice_pdf(user: dict, key: str, db=None) -> dict:
    """PDF eines eigenen Belegs: Bytes wie geliefert, Dateiname, SHA-256."""
    db = db if db is not None else get_db()
    invoice_id = parse_invoice_key(key)
    settings, link = await _member_for(db, user)
    try:
        payload = await DolibarrClient(settings).member_invoice_pdf(link["member_id"], invoice_id)
    except DolibarrError as exc:
        if exc.kind == "not_found":
            raise InvoiceAccessError() from exc
        raise
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


async def payment_target(user: dict, key: str, db=None) -> str:
    """Zahlungslink im Moment des Klicks: frisch gelesen, eigener Beleg, noch offen, zulässiges Ziel."""
    db = db if db is not None else get_db()
    invoice_id = parse_invoice_key(key)
    settings, link = await _member_for(db, user)
    raw = await _fetch_all(DolibarrClient(settings), link["member_id"])
    match = next((row for row in raw if int(row.get("id") or 0) == invoice_id), None)
    if not match:
        raise InvoiceAccessError()
    if not view_invoice(match, settings)["can_pay"]:
        raise ValueError("Dieser Beleg lässt sich nicht (mehr) online bezahlen.")
    return str(match["payment_url"]).strip()


async def forget_cache(db, user_id: str) -> None:
    await db.dolibarr_invoice_cache.delete_many({"user_id": user_id})
