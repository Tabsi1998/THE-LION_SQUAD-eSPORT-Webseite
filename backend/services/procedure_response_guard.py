"""Wächter für jede JSON-Antwort der API (#1619, E.2, Nr. 133/137): Liga-Verfahren verlassen den Server nur gekürzt.

Ein Spiel-Datensatz trägt in ``disputes[]`` die Verfahren samt MOSS-Anforderungen, Entschuldigungsgründen, Zuständiger und Fristen.
Vollständig darf das nur die nicht befangene Leitung mit „Proteste“ oder „Ergebnisse“ sehen. Statt jede Route einzeln daran zu
erinnern, läuft **jede** JSON-Antwort unter ``/api/`` hier durch: Enthält sie kein ``"disputes"``, geht sie unverändert weiter (ein
Byte-Vergleich). Sonst kürzt ``league_procedures.guard`` jedes Spiel darin für die Person der Anfrage. Neue Routen sind damit von
selbst abgedeckt - eine vergessene Zeile in einer Route öffnet nichts mehr.

Die Person kommt aus der Anfrage, über dieselbe Abhängigkeit wie in den Routen (``auth.get_optional_user``, in Tests deren
Ersatz). Lässt sie sich nicht bestimmen, gilt die Anfrage als nicht angemeldet - es wird also gekürzt.
"""
from __future__ import annotations

import inspect
import json
import logging

from starlette.responses import Response

logger = logging.getLogger("tls.procedure_guard")

MARKER = b'"disputes"'


async def _user_of(request) -> dict | None:
    from auth import get_optional_user

    provider = request.app.dependency_overrides.get(get_optional_user, get_optional_user)
    try:
        if "request" in inspect.signature(provider).parameters:
            return await provider(request)
        return await provider()
    except Exception:  # noqa: BLE001 - ohne erkennbare Person wird gekürzt, nie durchgelassen
        return None


def _rebuilt(response, body: bytes) -> Response:
    """Dieselbe Antwort mit diesem Inhalt: Status, Kopfzeilen (auch mehrere ``Set-Cookie``) und Hintergrundaufgabe bleiben."""
    out = Response(content=body, status_code=response.status_code, background=response.background)
    out.raw_headers = [(key, value) for key, value in response.raw_headers if key.lower() != b"content-length"]
    out.raw_headers.append((b"content-length", str(len(body)).encode("latin-1")))
    return out


async def guard_response(request, call_next):
    """Als ``@app.middleware("http")`` eingehängt (server.py)."""
    response = await call_next(request)
    if not request.url.path.startswith("/api/") or "application/json" not in (response.headers.get("content-type") or ""):
        return response
    body = b"".join([chunk async for chunk in response.body_iterator])
    if MARKER not in body:
        return _rebuilt(response, body)
    try:
        payload = json.loads(body)
    except ValueError:
        return _rebuilt(response, body)
    from database import get_db
    from services import league_procedures

    guarded = await league_procedures.guard(get_db(), payload, await _user_of(request))
    if guarded is payload or guarded == payload:
        return _rebuilt(response, body)
    return _rebuilt(response, json.dumps(guarded, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
