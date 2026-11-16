"""Datei-Uploads unter den langsamen Anfragen (#2447) - ein Blatt-Modul ohne eigene Importe, damit ``ops_monitor`` (misst)
und ``ops_alerts`` (Einstellungen) beide darauf zugreifen, ohne sich gegenseitig zu importieren.

Ein Upload dauert so lange wie die Leitung des Hochladenden (der APK-Upload beim App-Release brauchte 47 s), das ist kein
Tempo-Problem. Die Middleware erkennt Uploads selbst (``multipart/form-data`` -> ``upload: true``); für ältere Einträge und
Sonderfälle gilt die Liste. ``DEFAULT_UPLOAD_ROUTES`` ist die Vorgabe, einstellbar unter Betrieb -> Alarme
(``ops_alerts`` ``upload_routes``); ``*`` am Ende heißt „beginnt mit“.
"""
from __future__ import annotations

DEFAULT_UPLOAD_ROUTES = (
    "/api/admin/app-releases",
    "/api/admin/shop/print-files/upload",
    "/api/admin/shop/designs/upload",
    "/api/admin/shop/designs/upload-pair",
    "/api/uploads/*",
)


def matches_upload_route(route: str, patterns) -> bool:
    for pattern in patterns or ():
        pattern = str(pattern or "").strip()
        if not pattern:
            continue
        if pattern.endswith("*") and route.startswith(pattern[:-1]):
            return True
        if route == pattern:
            return True
    return False


def is_upload(row: dict, patterns) -> bool:
    """Ein Datei-Upload: selbst erkannt oder auf der Liste."""
    return bool(row.get("upload")) or matches_upload_route(str(row.get("route") or ""), patterns)
