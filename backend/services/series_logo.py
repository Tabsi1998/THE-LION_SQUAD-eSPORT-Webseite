"""Logo je Spur und optional je Saison (#2014), etwa für Ligen wie eine Rennliga oder ein Saison-Logo „Season 2“.

- **Nur eigene Uploads:** Ein Logo kommt über den sicheren Logo-Upload (``/api/uploads/logo``) oder die Mediathek. Die
  Adresse muss eine eigene Upload-Adresse sein (``clean``) und die Datei muss in der Mediathek stehen (``check``) - eine
  fremde Adresse würde jede Person beim Ansehen bei Dritten anfragen lassen.
- **Erbe:** Die Saison zeigt ihr eigenes Logo, sonst das der Spur (``effective``); ohne beides ``None`` - dann bleibt es
  beim bisherigen Rückfall (Spiel-Logo bzw. Partner-Abzeichen).
- Gezeigt wird es wie hochgeladen, nie eingefärbt (Entscheidung zu #1321).
"""
from __future__ import annotations

import re

from fastapi import HTTPException

FIELD = "logo_url"
# SVG seit #1952: der Logo-Upload bereinigt es und legt die PNG-Fassung daneben (Teilen-Karte, App).
LOGO_URL = re.compile(r"/api/static/uploads/[A-Za-z0-9][A-Za-z0-9_-]{0,150}\.(png|webp|jpg|jpeg|svg)")
LOGO_REFUSED = "Logo bitte über „Hochladen“ oder die Mediathek wählen (SVG, PNG, JPG oder WebP)."
LOGO_MISSING = "Logo nicht in der Mediathek gefunden - bitte neu hochladen."


def clean(value) -> str | None:
    """Leer heißt kein Logo; sonst nur eine eigene Upload-Adresse (``ValueError`` für alles andere)."""
    text = str(value or "").strip()
    if not text:
        return None
    if not LOGO_URL.fullmatch(text):
        raise ValueError(LOGO_REFUSED)
    return text


async def check(db, value: str | None) -> None:
    """Die Datei muss über den Upload in die Mediathek gekommen sein - sonst 422."""
    if value and not await db.media_uploads.find_one({"url": value, "media_type": "image"}, {"_id": 1}):
        raise HTTPException(422, LOGO_MISSING)


def effective(lineage: dict | None, series: dict | None = None) -> str | None:
    """Das Logo, das gezeigt wird: das eigene der Saison, sonst das der Spur."""
    return (series or {}).get(FIELD) or (lineage or {}).get(FIELD) or None
