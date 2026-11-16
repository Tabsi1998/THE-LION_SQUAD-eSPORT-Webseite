"""Datei-Uploads unter den langsamen Anfragen (#2447) - ein Blatt-Modul ohne eigene Importe, damit ``ops_monitor`` (misst)
und ``ops_alerts`` (Einstellungen) beide darauf zugreifen, ohne sich gegenseitig zu importieren.

Ein Upload dauert so lange wie die Leitung des Hochladenden (der APK-Upload beim App-Release brauchte 47 s), das ist kein
Tempo-Problem. Die Middleware erkennt Uploads selbst (``multipart/form-data`` -> ``upload: true``); für ältere Einträge und
Sonderfälle gilt die Liste. ``DEFAULT_UPLOAD_ROUTES`` ist die Vorgabe, einstellbar unter Betrieb -> Alarme
(``ops_alerts`` ``upload_routes``).

Ein Eintrag ist ``/api/…`` oder ``METHODE /api/…``; ``*`` am Ende heißt „beginnt mit“. Ohne Methode gilt er nur für
``UPLOAD_METHODS`` (POST, PUT) - ein langsames GET derselben Route bleibt eine langsame Route. Zu breite Muster
(``/api/*``, ``/api/admin/*``) lehnt ``clean_upload_routes`` ab.
"""
from __future__ import annotations

DEFAULT_UPLOAD_ROUTES = (
    "/api/admin/app-releases",
    "/api/admin/shop/print-files/upload",
    "/api/admin/shop/designs/upload",
    "/api/admin/shop/designs/upload-pair",
    "/api/uploads/*",
)
UPLOAD_METHODS = frozenset({"POST", "PUT"})
METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE"})
MAX_ROUTES = 40
MAX_ROUTE_LENGTH = 200
# Muster, die fast alles träfen - dann verschwände jede langsame Route.
TOO_BROAD = frozenset({"/api/", "/api/admin/"})


def split_entry(entry: str) -> tuple[frozenset[str], str]:
    """``"PUT /api/x"`` -> ({PUT}, ``/api/x``); ohne Methode die Upload-Methoden."""
    text = str(entry or "").strip()
    head, _, rest = text.partition(" ")
    if rest and head.upper() in METHODS:
        return frozenset({head.upper()}), rest.strip()
    return UPLOAD_METHODS, text


def matches_upload_route(route: str, method: str, patterns) -> bool:
    method = str(method or "").upper()
    for entry in patterns or ():
        methods, pattern = split_entry(entry)
        if not pattern or method not in methods:
            continue
        if pattern.endswith("*") and route.startswith(pattern[:-1]):
            return True
        if route == pattern:
            return True
    return False


def is_upload(row: dict, patterns) -> bool:
    """Ein Datei-Upload: selbst erkannt oder auf der Liste (Methode beachtet)."""
    return bool(row.get("upload")) or matches_upload_route(str(row.get("route") or ""), str(row.get("method") or "POST"), patterns)


def clean_upload_routes(values) -> list[str]:
    """Prüft die Liste aus der Verwaltung. Bricht früh ab (höchstens ``MAX_ROUTES`` Zeilen), ohne Doppelte, linear."""
    if isinstance(values, str):
        values = values.splitlines()
    out: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        text = " ".join(str(value or "").split())
        if not text:
            continue
        if len(out) >= MAX_ROUTES:
            raise ValueError(f"Höchstens {MAX_ROUTES} Upload-Routen.")
        methods, route = split_entry(text)
        if (not route.startswith("/api/") or len(route) > MAX_ROUTE_LENGTH or " " in route or "*" in route[:-1]
                or (route.endswith("*") and route[:-1] in TOO_BROAD) or route in TOO_BROAD):
            raise ValueError(f"„{text[:60]}“ ist keine passende Route (/api/…, ohne Leerzeichen, * nur am Ende, nicht /api/* oder /api/admin/*).")
        normal = route if text == route else f"{next(iter(methods))} {route}"
        if normal not in seen:
            seen.add(normal)
            out.append(normal)
    return out
