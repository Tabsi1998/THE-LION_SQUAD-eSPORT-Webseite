"""Größenlimit am Eingang für einzelne Upload-Routen (#1708, nach Codex-Prüfung).

FastAPI liest ein Formular ganz ein (bei Dateien in eine Zwischendatei), bevor die Route läuft - ein Limit in der Route
greift also erst, wenn die Datei schon auf der Platte liegt. Diese ASGI-Middleware greift vorher:

- Sagt ``Content-Length`` schon zu viel, kommt sofort 413; vom Körper wird nichts gelesen.
- Ohne oder mit falscher Angabe zählt sie beim Lesen mit und bricht ab, sobald es zu viel wird (413).

Die Grenzen stehen je Pfad als Funktion, damit sie den aktuellen Wert des Dienstes lesen (Tests setzen ihn klein).
nginx begrenzt dieselbe Route zusätzlich (``frontend/nginx.conf``).
"""
from __future__ import annotations

from typing import Callable

from fastapi import HTTPException
from starlette.responses import JSONResponse

UPLOAD_METHODS = {"POST", "PUT", "PATCH"}
Limit = Callable[[], tuple[int, str]]  # -> (Bytes, Text der Absage)


class BodySizeLimit:
    def __init__(self, app, limits: dict[str, Limit]):
        self.app = app
        self.limits = dict(limits)

    async def __call__(self, scope, receive, send):
        rule = self.limits.get(scope.get("path", "")) if scope["type"] == "http" else None
        if rule is None or scope.get("method") not in UPLOAD_METHODS:
            await self.app(scope, receive, send)
            return
        limit, detail = rule()
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > limit):
            refused = JSONResponse({"detail": detail}, status_code=413, headers={"Connection": "close"})
            await refused(scope, receive, send)
            return

        seen = 0
        started = False

        async def counted():
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    # FastAPI reicht eine HTTPException aus dem Lesen des Körpers unverändert weiter (sonst 400).
                    raise HTTPException(413, detail)
            return message

        async def watched(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counted, watched)
        except HTTPException as exc:
            if exc.status_code != 413 or started:
                raise
            await JSONResponse({"detail": exc.detail}, status_code=413, headers={"Connection": "close"})(
                scope, receive, send)
