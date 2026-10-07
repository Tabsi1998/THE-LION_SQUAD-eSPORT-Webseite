"""Mitgliedsbeitrag offen nennen (#1251, Wahl des Betreibers: Variante A - aus Dolibarr).

„Mitglied werden“ zeigt die Mitgliedsarten für Personen mit Betrag, Zeitraum und Aufnahmegebühr - dieselben Felder wie
``dolibarr_applications.public_fee`` und dieselben Zahlen wie die Auswahl im Antrag. Gepflegt wird nur in Dolibarr; die
Website liest ``/vereine/membershipfees`` höchstens einmal je Stunde (öffentlicher Abruf, zwischengespeichert in
``dolibarr_public``). Antwortet Dolibarr nicht, bleibt der letzte bekannte Stand mit Datum stehen (``stale``); gibt es gar
keinen Stand oder ist die Anbindung aus, sagt die Seite „Die Beiträge nennen wir dir im Antrag“. Nie interne Felder.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from models import now_utc
from services.dolibarr_applications import public_fee
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings

logger = logging.getLogger("tls.dolibarr.fees")

COLLECTION = "dolibarr_public"
DOC_ID = "membership_fees"
TTL_SECONDS = 3600          # so lange gilt ein Stand als frisch
RETRY_SECONDS = 300         # nach einem Fehler erst wieder nach fünf Minuten fragen
WAIT_SECONDS = 5.0          # länger wartet ein Seitenaufruf nicht auf Dolibarr - sonst gilt der letzte Stand
_LOCK = asyncio.Lock()


def _age_seconds(value, now: datetime) -> float | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return (now - moment).total_seconds()


def person_fees(rows) -> list[dict]:
    """Nur Mitgliedsarten für Personen (wie im Antrag), in der Form von ``public_fee``."""
    return [public_fee(row) for row in rows or [] if isinstance(row, dict) and row.get("for") in ("natural", "both", None)]


async def refresh(db, client: DolibarrClient) -> dict:
    now = now_utc().isoformat()
    try:
        fees = person_fees(await client.membership_fees())
    except DolibarrError as exc:
        await db[COLLECTION].update_one({"id": DOC_ID}, {"$set": {"error": exc.kind, "error_at": now}, "$setOnInsert": {"id": DOC_ID}}, upsert=True)
        return {"ok": False, "kind": exc.kind}
    await db[COLLECTION].update_one({"id": DOC_ID}, {"$set": {"fees": fees, "fetched_at": now}, "$unset": {"error": "", "error_at": ""},
                                                      "$setOnInsert": {"id": DOC_ID}}, upsert=True)
    return {"ok": True, "fees": len(fees)}


async def public_fees(db, *, now: datetime | None = None) -> dict:
    """Die Beiträge für „Mitglied werden“ und den Antrag - frisch, der letzte Stand mit Datum oder gar nichts."""
    now = now or now_utc()
    settings = await load_settings(db)
    if settings.get("mode") == "off":
        return {"available": False, "fees": []}
    state = await db[COLLECTION].find_one({"id": DOC_ID}, {"_id": 0}) or {}
    age = _age_seconds(state.get("fetched_at"), now)
    error_age = _age_seconds(state.get("error_at"), now)
    due = age is None or age > TTL_SECONDS
    if due and (error_age is None or error_age > RETRY_SECONDS) and not _LOCK.locked():
        async with _LOCK:
            try:
                await asyncio.wait_for(refresh(db, DolibarrClient(settings)), timeout=WAIT_SECONDS)
            except (DolibarrError, asyncio.TimeoutError) as exc:   # unvollständige Anbindung oder zu langsam: wie ein Ausfall
                kind = exc.kind if isinstance(exc, DolibarrError) else "timeout"
                await db[COLLECTION].update_one({"id": DOC_ID}, {"$set": {"error": kind, "error_at": now.isoformat()}, "$setOnInsert": {"id": DOC_ID}}, upsert=True)
            except Exception as exc:  # noqa: BLE001 - die Seite „Mitglied werden“ darf nie an Dolibarr scheitern
                logger.warning("[fees] Beiträge nicht lesbar: %s", exc)
        state = await db[COLLECTION].find_one({"id": DOC_ID}, {"_id": 0}) or {}
    fees = state.get("fees")
    if not isinstance(fees, list):
        return {"available": False, "fees": []}
    age = _age_seconds(state.get("fetched_at"), now)
    stale = bool(state.get("error")) or age is None or age > 2 * TTL_SECONDS
    return {"available": True, "fees": fees, "as_of": state.get("fetched_at"), "stale": stale}


async def refresh_due() -> dict:
    """Der stündliche Job (mit Vereinsdaten und Vorstand): nur mit Anbindung."""
    from database import get_db

    db = get_db()
    settings = await load_settings(db)
    if settings.get("mode") == "off":
        return {"ok": False, "kind": "not_configured"}
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return {"ok": False, "kind": exc.kind}
    return await refresh(db, client)


def fee_by_id(fees: list[dict], type_id: int | None) -> dict | None:
    return next((fee for fee in fees or [] if type_id and int(fee.get("id") or 0) == int(type_id)), None)
