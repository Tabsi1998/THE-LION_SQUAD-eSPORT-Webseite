"""Öffentliche Adresse der Druckdateien für Printful (#1708) - die einzige öffentliche Shop-Route.

Printful holt Druckdateien ohne Anmeldung über eine Adresse. Deshalb ist diese Route bewusst öffentlich und in Regel 3
von ``scripts/check-code-patterns.py`` ausdrücklich freigegeben (``PUBLIC_SHOP_ROUTES``, mit Begründung und Test).
Der Schutz:

- Je Version ein eigener Zufallsschlüssel mit 256 Bit (``secrets.token_urlsafe(32)``) - nicht erratbar, nicht
  ableitbar aus Design, Version oder Prüfsumme.
- Name und Schlüssel müssen genau passen (``<design>-v<version>.png``); alles andere - auch ein abgeschalteter oder
  unbekannter Schlüssel - ist dieselbe 404. Es gibt keine Liste, keinen Index und keine Aufzählung.
- Ausgeliefert wird nur die fertige, neu kodierte Druckdatei als ``image/png`` mit ``nosniff``; nie ein Original.
- Unabhängig von der Shop-Stufe: Printful braucht die Datei auch für Testentwürfe (#2062) und bestehende Bestellungen.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from database import get_db
from services import shop_designs, shop_print_files

# Als Text, nicht als Konstante: Regel 3 liest das Präfix aus dem Quelltext (shop_designs.PUBLIC_PREFIX ist dasselbe).
router = APIRouter(prefix="/api/shop/print-files", tags=["shop"])

NOT_FOUND = "Diese Datei gibt es nicht."
HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
}


@router.get("/{public_id}/{filename}")
async def print_file(public_id: str, filename: str):
    db = get_db()
    path = await shop_designs.public_file(db, public_id, filename)
    if path is None:  # erzeugte bzw. hochgeladene Druckdateien je Produkt und Bestellung (#2069)
        path = await shop_print_files.public_file(db, public_id, filename)
    if path is None:
        raise HTTPException(404, NOT_FOUND)
    return FileResponse(path, media_type="image/png",
                        headers={**HEADERS, "Content-Disposition": f'inline; filename="{filename}"'})
