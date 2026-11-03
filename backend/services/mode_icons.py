"""Symbol je Spielmodus (#2266, Vertrag in docs/LIGA.md C.1): ein quadratisches Bild aus dem eigenen Upload, ``games.match_modes[].icon_url``.

- Nur Adressen aus dem eigenen Upload (``/api/static/uploads/…``) - eine fremde Adresse ließe jede Person beim Ansehen bei Dritten anfragen.
- Jede Datei braucht ihren Eintrag in der Mediathek (``media_uploads``), wie Bilder im Regelwerk (#2230).
- Ohne Medienrolle nur eigene Bilder (``media_scope: "user"`` und eigene ``owner_id``); SVG nur mit Medienrolle - wie Logos (#1952).
- Was das Spiel schon trägt, bleibt speicherbar (``kept``): Ein anderes Speichern scheitert nie an einem Symbol, das jemand anderes
  gesetzt hat.

Pool-Versionen halten das Symbol als Schnappschuss wie den Namen (``services/map_pools.py``), die Mediathek zählt beides als Verwendung
(``services/media_audit.py``).
"""
from __future__ import annotations

import re

from services.media_formats import UPLOAD_URL_VERSION, bare_upload_url
from services.permissions import ADMIN_MEDIA_ROLES, is_confirmed_admin_role

ICON_URL = re.compile(r"/api/static/uploads/[A-Za-z0-9][A-Za-z0-9_.-]{0,150}\.(png|webp|jpg|jpeg|svg)" + UPLOAD_URL_VERSION)
# Raster-Bilder: nur diese zeigt das Regelwerk (Markdown-Bilder im Regelwerk sind PNG, JPG oder WebP).
RASTER_ICON_URL = re.compile(r"/api/static/uploads/[A-Za-z0-9][A-Za-z0-9_.-]{0,150}\.(png|webp|jpg|jpeg)" + UPLOAD_URL_VERSION)
REFUSED = "Modus „{label}“: Symbol bitte über „Hochladen“ oder „Aus Bibliothek“ wählen (PNG, JPG oder WebP)."
NOT_OWN = "Modus „{label}“: Als Symbol gehen nur eigene Bilder aus deiner Bibliothek."
SVG_REFUSED = "Modus „{label}“: SVG als Symbol nur mit Medienrechten – bitte als PNG hochladen."
UNKNOWN = "Modus „{label}“: Dieses Bild kennt die Mediathek nicht – bitte neu hochladen."


class IconProblem(ValueError):
    """Ein Symbol, das nicht passt - die Route macht daraus 422."""


def icons_of(game: dict | None) -> set[str]:
    """Die Symbole, die das Spiel schon trägt."""
    modes = (game or {}).get("match_modes")
    return {str(mode["icon_url"]) for mode in modes or [] if isinstance(mode, dict) and mode.get("icon_url")} if isinstance(modes, list) else set()


def _filename(url: str) -> str:
    return bare_upload_url(url).rsplit("/", 1)[-1]


async def check(db, modes: list[dict] | None, user: dict | None, kept: set[str] | None = None) -> None:
    """Prüft die Symbole einer Modusliste (Einträge wie ``GameMatchMode.model_dump()``). ``IconProblem`` mit deutschem Satz."""
    kept = kept or set()
    wanted = [(mode.get("label") or mode.get("mode") or "", str(mode["icon_url"])) for mode in modes or []
              if isinstance(mode, dict) and mode.get("icon_url") and str(mode["icon_url"]) not in kept]
    if not wanted:
        return
    for label, url in wanted:
        if not ICON_URL.fullmatch(url):
            raise IconProblem(REFUSED.format(label=label))
    names = sorted({_filename(url) for _label, url in wanted})
    rows = await db.media_uploads.find({"$or": [{"filename": {"$in": names}}, {"raster_filename": {"$in": names}}]},
                                       {"_id": 0, "filename": 1, "raster_filename": 1, "media_scope": 1, "owner_id": 1}).to_list(None)
    media_role = is_confirmed_admin_role(user or {}, ADMIN_MEDIA_ROLES)
    for label, url in wanted:
        name = _filename(url)
        entries = [row for row in rows if name in (row.get("filename"), row.get("raster_filename"))]
        if not entries:
            raise IconProblem(UNKNOWN.format(label=label))
        if name.lower().endswith(".svg") and not media_role:
            raise IconProblem(SVG_REFUSED.format(label=label))
        if not media_role and not any(row.get("media_scope") == "user" and str(row.get("owner_id")) == str((user or {}).get("id"))
                                      for row in entries):
            raise IconProblem(NOT_OWN.format(label=label))


def raster_icon(url: str | None) -> str | None:
    """Das Symbol, wenn es ein Raster-Bild ist - sonst ``None`` (Regelwerk)."""
    text = str(url or "")
    return text if text and RASTER_ICON_URL.fullmatch(text) else None
