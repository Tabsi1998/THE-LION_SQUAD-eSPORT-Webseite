"""Verbindungstest zu Printful (#1706): ein einziger lesender Aufruf, ``GET /stores`` mit dem hinterlegten Schlüssel.

Bewusst klein und ohne den Adapter aus #1705: feste Adresse (keine Eingabe bestimmt, wohin es geht), nur lesen, kurze
Zeitgrenze. Der Schlüssel steht nur im Kopf der Anfrage - nie in der Antwort, im Ergebnis oder in einem Log. Der Adapter
(#1705) übernimmt diesen Test später; dann fällt dieses Modul weg. Tests ersetzen ``TRANSPORT`` durch einen httpx-Mock.
"""
from __future__ import annotations

import httpx

API_BASE = "https://api.printful.com"
TIMEOUT_SECONDS = 10.0
TRANSPORT: httpx.AsyncBaseTransport | None = None  # nur Tests setzen einen Mock


async def probe(api_key: str) -> dict:
    """Liefert ``{"ok": bool, "detail": str}``. Wirft nie - jede Ursache wird zu einem verständlichen Satz."""
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=TIMEOUT_SECONDS, transport=TRANSPORT,
                                     follow_redirects=False) as client:
            response = await client.get("/stores", headers={"Authorization": f"Bearer {api_key}"})
    except httpx.TimeoutException:
        return {"ok": False, "detail": "Printful antwortet nicht (Zeitüberschreitung)."}
    except httpx.HTTPError:
        return {"ok": False, "detail": "Printful ist nicht erreichbar (Netzwerk)."}
    if response.status_code in (401, 403):
        return {"ok": False, "detail": f"Printful hat den Schlüssel abgelehnt ({response.status_code})."}
    if response.status_code != 200:
        return {"ok": False, "detail": f"Printful antwortet mit {response.status_code}."}
    try:
        stores = response.json().get("result")
    except (ValueError, AttributeError):
        stores = None
    if not isinstance(stores, list):
        return {"ok": False, "detail": "Printful antwortet, aber nicht wie erwartet."}
    count = len(stores)
    return {"ok": True, "detail": f"Verbindung steht: {count} Store{'s' if count != 1 else ''} sichtbar."}
