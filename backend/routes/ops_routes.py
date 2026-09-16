"""Öffentliche Annahme für Web Vitals (#265).

Der Browser schickt am Ende eines Besuchs ein paar Messwerte per
``sendBeacon``. Keine Anmeldung, keine Cookies; die Adresse des Absenders
dient nur der Drosselung und wird nicht gespeichert.
"""
from fastapi import APIRouter, HTTPException, Request, Response

from database import get_db
from services.ops_vitals import MAX_ENTRIES, clean_batch, store_vitals
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/ops", tags=["ops"])

VITALS_RATE_LIMIT = 30  # Sendungen je Adresse und Minute - ein Besuch braucht eine


@router.post("/vitals", status_code=202)
async def receive_vitals(request: Request, response: Response):
    await enforce_rate_limit(request, "ops:vitals", limit=VITALS_RATE_LIMIT, window_seconds=60)
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001 - kaputtes JSON ist ein 400, kein 500
        raise HTTPException(status_code=400, detail="Ungültige Messwerte")
    if not isinstance(payload, (dict, list)):
        raise HTTPException(status_code=400, detail="Ungültige Messwerte")
    entries = clean_batch(payload)
    stored = await store_vitals(get_db(), entries)
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True, "stored": stored, "limit": MAX_ENTRIES}
