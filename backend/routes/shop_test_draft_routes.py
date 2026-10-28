"""Testentwurf an Printful (#2062) - Verwaltung → Finanzen → Shop → Testentwurf.

Wie alle Shop-Adminrouten nur der Bereich „Finanzen“ mit Zwei-Faktor (``require_area("finance")``, Regel 3 in
``scripts/check-code-patterns.py``). Senden und Löschen brauchen zusätzlich die Stufe ab „Nur Admins (Test)“ und einen
lesbaren Printful-Schlüssel (``shop_config.require_printful_drafts``) - der Notschalter spielt keine Rolle, ein Entwurf
kostet nichts. **Bestätigen gibt es hier nicht**: keine Route, und ``printful_client.confirm_order`` lehnt einen
Testentwurf ab. Je Konto gedrosselt (``shop_test_drafts.limits``). Fehlertexte sind feste Sätze - nie ein Stacktrace,
nie, was Printful intern meldet (das steht gekürzt im Protokoll des Testentwurfs).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import require_area
from database import get_db
from services import shop_test_drafts
from services.printful_client import PrintfulClient
from services.rate_limit import enforce_rate_limit
from services.shop_common import ShopConflict, ShopError
from services.shop_config import PrintfulDraftsBlocked, PrintfulKeyMissing
from services.shop_fulfillment import ERROR_TEXTS, FulfillmentError, FulfillmentInvalid, FulfillmentTransient

router = APIRouter(prefix="/api/admin/shop/test-drafts", tags=["shop"])

BUSY = "Zu viele Anfragen an den Testentwurf. Bitte warte noch {wait}."
NO_KEY = "Kein lesbarer Printful-Schlüssel hinterlegt (Shop → Einstellungen)."


class Address(BaseModel):
    model_config = {"extra": "forbid"}

    name: str = Field("", max_length=120)
    street: str = Field("", max_length=120)
    street2: str = Field("", max_length=120)
    zip: str = Field("", max_length=12)
    city: str = Field("", max_length=80)
    country: str = Field("AT", max_length=2)


class PreviewRequest(BaseModel):
    model_config = {"extra": "forbid"}

    product_id: str = Field(..., min_length=1, max_length=64)
    variant_id: str = Field(..., min_length=1, max_length=64)
    gamertag: str = Field("", max_length=200)
    address: Address


class SendRequest(BaseModel):
    model_config = {"extra": "forbid"}

    idempotency_key: str = Field(..., min_length=8, max_length=128)


def _refused(exc: Exception) -> HTTPException:
    """Eigene Klartexte statt Ausnahme-Interna: Shop-Fehler sind feste deutsche Sätze, Printful-Fehler über die
    Tabelle der Ursachen."""
    if isinstance(exc, LookupError):
        return HTTPException(404, "Nicht gefunden.")
    if isinstance(exc, PrintfulKeyMissing):
        return HTTPException(409, NO_KEY)
    if isinstance(exc, PrintfulDraftsBlocked):
        return HTTPException(409, "Testentwürfe an Printful erst ab der Stufe „Nur Admins (Test)“ und mit hinterlegtem "
                                  "Schlüssel (Shop → Einstellungen).")
    if isinstance(exc, ShopConflict):
        return HTTPException(409, str(exc))
    if isinstance(exc, ShopError):
        return HTTPException(400, str(exc))
    if isinstance(exc, FulfillmentError):
        text = ERROR_TEXTS.get(exc.reason, ERROR_TEXTS["unexpected"])
        if isinstance(exc, FulfillmentTransient):
            return HTTPException(503, f"Printful: {text}. Bitte gleich noch einmal versuchen.")
        if isinstance(exc, FulfillmentInvalid):
            return HTTPException(409, f"Printful: {text}. Einzelheiten stehen im Protokoll des Testentwurfs.")
        return HTTPException(502, f"Printful: {text}.")
    return HTTPException(400, "Das hat nicht geklappt.")


async def _provider(db) -> PrintfulClient:
    try:
        return await PrintfulClient.from_db(db)
    except FulfillmentError as exc:
        raise HTTPException(409, NO_KEY) from exc


async def _limit(request: Request, me: dict, bucket: str, key: str) -> None:
    settings = shop_test_drafts.limits()
    await enforce_rate_limit(request, f"shop:test-draft:{bucket}", limit=settings[key],
                             window_seconds=settings["window_seconds"], subject=me["id"], message=BUSY)


@router.get("")
async def overview(me: dict = Depends(require_area("finance"))):
    """Zugang, Produkte mit Varianten, Vereinsadresse, Gamertag-Regeln und die gesendeten Testentwürfe."""
    return await shop_test_drafts.overview(get_db())


@router.post("/preview")
async def preview(body: PreviewRequest, request: Request, me: dict = Depends(require_area("finance"))):
    """Druckdateien wie bei einer Bestellung erzeugen und genau zeigen, was gesendet würde - mit Kostenschätzung von
    Printful. Bei Printful wird nichts gespeichert."""
    await _limit(request, me, "preview", "preview_limit")
    db = get_db()
    try:
        provider = await _provider(db)
        return await shop_test_drafts.preview(db, product_id=body.product_id, variant_id=body.variant_id,
                                              gamertag=body.gamertag, address=body.address.model_dump(),
                                              actor_id=me["id"], provider=provider)
    except (ShopError, LookupError, FulfillmentError) as exc:
        raise _refused(exc) from exc


@router.get("/{draft_id}")
async def detail(draft_id: str, me: dict = Depends(require_area("finance"))):
    """Ein Testentwurf mit aktuellem Stand und letzter Ursache - etwa nach einem gescheiterten Senden."""
    try:
        return await shop_test_drafts.get_view(get_db(), draft_id)
    except LookupError as exc:
        raise _refused(exc) from exc


@router.post("/{draft_id}/send")
async def send(draft_id: str, body: SendRequest, request: Request, me: dict = Depends(require_area("finance"))):
    """„Als Entwurf an Printful senden“ - nie bestätigt, nie bezahlt. Derselbe Idempotenzschlüssel noch einmal liefert
    dasselbe Ergebnis."""
    await _limit(request, me, "send", "send_limit")
    db = get_db()
    try:
        provider = await _provider(db)
        return await shop_test_drafts.send(db, draft_id, idempotency_key=body.idempotency_key, actor_id=me["id"],
                                           provider=provider)
    except (ShopError, LookupError, FulfillmentError) as exc:
        raise _refused(exc) from exc


@router.post("/{draft_id}/recheck")
async def recheck(draft_id: str, request: Request, me: dict = Depends(require_area("finance"))):
    """„Bei Printful nachsehen“ (#2138): den gesendeten Entwurf neu lesen und neu abgleichen - ändert bei Printful
    nichts."""
    await _limit(request, me, "preview", "preview_limit")
    db = get_db()
    try:
        provider = await _provider(db)
        return await shop_test_drafts.recheck(db, draft_id, actor_id=me["id"], provider=provider)
    except (ShopError, LookupError, FulfillmentError) as exc:
        raise _refused(exc) from exc


@router.post("/{draft_id}/delete")
async def delete(draft_id: str, request: Request, me: dict = Depends(require_area("finance"))):
    """„Entwurf bei Printful löschen“ - nur, solange er ein Entwurf ist."""
    await _limit(request, me, "send", "send_limit")
    db = get_db()
    try:
        provider = await _provider(db)
        return await shop_test_drafts.delete(db, draft_id, actor_id=me["id"], provider=provider)
    except (ShopError, LookupError, FulfillmentError) as exc:
        raise _refused(exc) from exc
