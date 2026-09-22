"""Eigene Rechnungen (#296): nur für das angemeldete Konto, nur über den Lesedienst.

Kein Admin sieht hier fremde Belege - die Vereinsverwaltung hat Dolibarr selbst. Die Rechnungs-ID
steht nie im Klartext einer fremden Anfrage gegenüber: Wer nicht zugeordnet ist, bekommt eine
leere Liste; wer einen fremden Schlüssel rät, bekommt 404 wie bei einem unbekannten.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from auth import get_current_user
from database import get_db
from models import new_id, now_utc
from services.dolibarr_client import DolibarrError
from services.dolibarr_invoices import InvoiceAccessError, invoice_pdf, list_invoices, payment_target
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/account/invoices", tags=["invoices"])


@router.get("")
async def my_invoices(user: dict = Depends(get_current_user)):
    return await list_invoices(user)


@router.get("/{key}/pdf")
async def my_invoice_pdf(key: str, request: Request, user: dict = Depends(get_current_user)):
    await enforce_rate_limit(request, "invoices:pdf", limit=60, window_seconds=600, subject=user["id"])
    try:
        pdf = await invoice_pdf(user, key)
    except InvoiceAccessError:
        raise HTTPException(404, "Beleg nicht gefunden.")
    except DolibarrError as exc:
        raise HTTPException(503, f"Die Mitgliederverwaltung antwortet gerade nicht: {exc.text}")
    disposition = "attachment" if request.query_params.get("download") == "1" else "inline"
    return Response(
        content=pdf["content"],
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="{pdf["filename"]}"',
            "X-Content-SHA256": pdf["sha256"],
            # Persönliches Dokument: kein Cache im Browser, kein Cache im Proxy, kein Service Worker.
            "Cache-Control": "private, no-store",
            "X-Robots-Tag": "noindex",
        },
    )


@router.post("/{key}/pay")
async def pay_my_invoice(key: str, request: Request, user: dict = Depends(get_current_user)):
    """Zahlungsziel im Moment des Klicks - frisch aus Dolibarr und geprüft. Die Seite wechselt der Browser selbst:
    Eine Weiterleitung würde der API-Client als fremden Aufruf verfolgen und an CORS scheitern."""
    await enforce_rate_limit(request, "invoices:pay", limit=20, window_seconds=600, subject=user["id"])
    db = get_db()
    try:
        target = await payment_target(user, key, db)
    except InvoiceAccessError:
        raise HTTPException(404, "Beleg nicht gefunden.")
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    except DolibarrError as exc:
        raise HTTPException(503, f"Die Mitgliederverwaltung antwortet gerade nicht: {exc.text}")
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "invoice.pay_redirect", "actor_id": user["id"],
        "target_id": key, "data": {}, "created_at": now_utc().isoformat(),
    })
    return {"url": target}
