"""Öffentliche Annahme für Web Vitals (#265), Fehler aus Website und App (#1657) und der Stand für die Statusseite.

Der Browser schickt am Ende eines Besuchs ein paar Messwerte per
``sendBeacon``. Keine Anmeldung, keine Cookies; die Adresse des Absenders
dient nur der Drosselung und wird nicht gespeichert.

Fehler (#1657): Website und App melden ohne Anmeldung - sonst fehlten gerade die Fehler, die Gäste sehen. Höchstens
``CLIENT_ERROR_MAX_BYTES`` je Meldung und ``CLIENT_ERROR_RATE_LIMIT`` je Adresse und Minute; gespeichert wird nur, was
``ops_error_scrub`` übrig lässt (Fehlerart, Code-Stellen, Seite als Vorlage, Version). Felder wie ``message`` werden
nicht einmal gelesen.
"""
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, ValidationError

from database import get_db
from services.ops_monitor import error_settings, record_client_error
from services.ops_vitals import MAX_ENTRIES, clean_batch, store_vitals
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/ops", tags=["ops"])

VITALS_RATE_LIMIT = 30  # Sendungen je Adresse und Minute - ein Besuch braucht eine
CLIENT_ERROR_RATE_LIMIT = 20  # Meldungen je Adresse und Minute - der Browser schickt selbst höchstens 12
CLIENT_ERROR_MAX_BYTES = 16 * 1024


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


class ClientErrorBody(BaseModel):
    """Was Website und App schicken dürfen. Alles andere (etwa ``message``) fällt weg."""

    source: Literal["web", "app"] = "web"
    # Kein Text erzwungen: ein Objekt oder eine Zahl wird bei der Bereinigung zu „Error“.
    error_type: str | int | float | bool | dict | list | None = "Error"
    stack: str = Field(default="", max_length=CLIENT_ERROR_MAX_BYTES)
    route: str = Field(default="/", max_length=1000)
    version: str = Field(default="", max_length=200)


async def _read_limited(request: Request, limit: int) -> bytes:
    """Den Körper lesen, aber nie mehr als ``limit`` Bytes - auch ohne oder mit falscher Längenangabe."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(status_code=413, detail="Meldung zu groß")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise HTTPException(status_code=413, detail="Meldung zu groß")
    return bytes(body)


@router.post("/client-errors", status_code=202)
async def receive_client_error(request: Request, response: Response):
    # Ab Werk aus (#1657): Der Web-Melder fragt den Schalter nicht ab (Start-Bündel), er sendet - der Server verwirft.
    settings = await error_settings(get_db())
    if not settings.get("client_errors_enabled"):
        return Response(status_code=204, headers={"Cache-Control": "no-store"})
    await enforce_rate_limit(request, "ops:client-errors", limit=CLIENT_ERROR_RATE_LIMIT, window_seconds=60)
    raw = await _read_limited(request, CLIENT_ERROR_MAX_BYTES)
    try:
        body = ClientErrorBody.model_validate_json(raw)
    except ValidationError as exc:
        # Kaputtes JSON ist ein 400, ein falscher Wert (etwa eine unbekannte Quelle) ein 422.
        broken = any(error.get("type") == "json_invalid" for error in exc.errors())
        raise HTTPException(status_code=400 if broken else 422, detail="Ungültige Meldung") from None
    fingerprint = await record_client_error(get_db(), source=body.source, error_type=body.error_type, stack=body.stack,
                                            route=body.route, version=body.version, settings=settings)
    response.headers["Cache-Control"] = "no-store"
    return {"ok": fingerprint is not None, "id": fingerprint}


@router.get("/status")
async def public_status_view(response: Response):
    """Für die Statusseite ``/status`` (#1657): nur „ok“ oder „disturbance“ und wann zuletzt geprüft wurde."""
    from services.ops_reachability import public_status

    response.headers["Cache-Control"] = "no-store"
    return await public_status(get_db())
