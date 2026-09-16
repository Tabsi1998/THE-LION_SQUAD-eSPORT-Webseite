"""Betriebssicht für den Adminbereich: Server-Fehler und langsame Anfragen (#233).

Bisher stand ein Serverfehler nur im Container-Log, und wie lange eine Route
braucht, wusste niemand. Jetzt sammelt eine Middleware beides:

- Jede unbehandelte Ausnahme und jede 5xx-Antwort wird zu einer Gruppe mit
  Fingerabdruck (Art, Route, Methode, oberste eigene Codezeile). Die Gruppe
  zählt, wann sie zuerst und zuletzt auftrat, und lässt sich als gelöst
  markieren; tritt sie wieder auf, ist sie wieder offen.
- Jede Anfrage über ``SLOW_REQUEST_MS`` (Standard 1 s) landet mit Route und
  Dauer in einer zweiten Sammlung.

Beides ohne Namen, E-Mail-Adressen oder Tokens; nach 30 Tagen räumt MongoDB
die Einträge über den TTL-Index selbst weg.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import traceback
from datetime import timedelta
from typing import Any

from starlette.routing import Match

from database import get_db
from models import new_id, now_utc

logger = logging.getLogger("tls.ops")

SLOW_REQUEST_MS = int(os.environ.get("SLOW_REQUEST_MS", "1000") or 1000)
RETENTION_DAYS = 30
STACK_LIMIT = 6000
MESSAGE_LIMIT = 500
# Gesundheitsprüfungen und der Änderungsstrom (der absichtlich offen bleibt)
# sagen nichts über das Tempo der Anwendung.
IGNORED_PATH_PREFIXES = ("/api/health", "/api/changes/stream")

_SECRET_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]+=*", re.IGNORECASE), "Bearer [redacted]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"), "[redacted-token]"),
    (re.compile(r"([?&](?:access_token|refresh_token|token|code|key|secret|password|email)=)[^&#\s]*", re.IGNORECASE), r"\1[redacted]"),
    (re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE), "[redacted-email]"),
]
_ID_SEGMENT = re.compile(r"/(?:[0-9a-f]{8,}|\d{3,})(?=/|$)", re.IGNORECASE)


def scrub_text(value: Any, limit: int = MESSAGE_LIMIT) -> str:
    """Tokens und E-Mail-Adressen raus, Länge begrenzt."""
    text = str(value or "")
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text[:limit]


def route_template(app: Any, scope: dict) -> str:
    """Der Routenpfad mit Platzhaltern (``/api/teams/{team_id}``) statt der Kennung.

    Starlette merkt sich die getroffene Route nicht im Scope; hier wird sie nur
    für Fehler und langsame Anfragen nachgeschlagen, nie für jede Anfrage.
    """
    path = str(scope.get("path") or "")
    router = getattr(app, "router", None)
    for route in getattr(router, "routes", []) or []:
        matches = getattr(route, "matches", None)
        if matches is None:
            continue
        try:
            match, _child = matches(scope)
        except Exception:  # noqa: BLE001 - eine fremde Route soll die Aufzeichnung nicht stoppen
            continue
        if match == Match.FULL and getattr(route, "path", None):
            return str(route.path)
    return _ID_SEGMENT.sub("/{id}", path) or "/"


def error_fingerprint(error_type: str, route: str, method: str, frame: str = "") -> str:
    raw = "|".join([error_type or "", route or "", (method or "").upper(), frame or ""])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def top_frame(exc: BaseException) -> str:
    """Die oberste Codezeile des eigenen Codes, damit gleiche Fehler zusammenfallen."""
    frames = traceback.extract_tb(exc.__traceback__)
    own = [frame for frame in frames if "site-packages" not in (frame.filename or "")]
    chosen = (own or frames)[-1:] or []
    if not chosen:
        return ""
    frame = chosen[0]
    return f"{os.path.basename(frame.filename or '')}:{frame.lineno}"


def _actor(request: Any) -> str:
    headers = getattr(request, "headers", {}) or {}
    cookies = getattr(request, "cookies", {}) or {}
    if headers.get("authorization") or any("token" in name or "session" in name for name in cookies):
        return "angemeldet"
    return "anonym"


def _expires_at():
    return now_utc() + timedelta(days=RETENTION_DAYS)


async def _upsert_error(app: Any, request: Any, *, error_type: str, message: str, stack: str, status_code: int, frame: str = "") -> str | None:
    try:
        route = route_template(app, request.scope)
        method = str(request.method or "GET").upper()
        fingerprint = error_fingerprint(error_type, route, method, frame)
        now_iso = now_utc().isoformat()
        db = get_db()
        outcome = await db.ops_errors.update_one(
            {"fingerprint": fingerprint},
            {
                "$setOnInsert": {"id": new_id(), "fingerprint": fingerprint, "first_seen_at": now_iso},
                "$set": {
                    "error_type": error_type[:120],
                    "message": scrub_text(message, MESSAGE_LIMIT),
                    "stack": scrub_text(stack, STACK_LIMIT),
                    "route": route[:200],
                    "method": method,
                    "status_code": int(status_code),
                    "actor": _actor(request),
                    "last_seen_at": now_iso,
                    "expires_at": _expires_at(),
                    "resolved_at": None,
                },
                "$inc": {"count": 1},
            },
            upsert=True,
        )
        if int(status_code) >= 500 and getattr(outcome, "upserted_id", None) is not None:
            # Eine neue 5xx-Gruppe meldet sich per Discord (#265) - im Hintergrund.
            from services.ops_alerts import schedule_error_alert

            group = await db.ops_errors.find_one({"fingerprint": fingerprint}, {"_id": 0, "stack": 0})
            if group:
                schedule_error_alert(db, group)
        return fingerprint
    except Exception as exc:  # noqa: BLE001 - die Aufzeichnung darf die Antwort nie verhindern
        logger.debug("[ops] error record failed: %s", type(exc).__name__)
        return None


def unwrap_exception(exc: BaseException) -> BaseException:
    """Starlette reicht Ausnahmen aus dem Anwendungscode als Gruppe mit einem
    Mitglied weiter; gemeint ist das Mitglied."""
    seen = 0
    while isinstance(exc, BaseExceptionGroup) and len(exc.exceptions) == 1 and seen < 5:
        exc = exc.exceptions[0]
        seen += 1
    return exc


def format_stack(exc: BaseException) -> str:
    """Nur diese Ausnahme ohne verkettete Vorgänger; bleibt sie zu lang, das Ende -
    dort stehen die eigenen Zeilen und die Meldung."""
    text = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__, chain=False))
    return text[-STACK_LIMIT:] if len(text) > STACK_LIMIT else text


async def record_exception(app: Any, request: Any, exc: BaseException, status_code: int = 500) -> str | None:
    """Eine unbehandelte Ausnahme als Gruppe festhalten."""
    exc = unwrap_exception(exc)
    stack = format_stack(exc)
    return await _upsert_error(
        app, request,
        error_type=type(exc).__name__,
        message=str(exc) or type(exc).__name__,
        stack=stack,
        status_code=status_code,
        frame=top_frame(exc),
    )


async def record_http_error(app: Any, request: Any, status_code: int) -> str | None:
    """Eine 5xx-Antwort ohne Ausnahme (etwa ein bewusstes 503)."""
    return await _upsert_error(
        app, request,
        error_type=f"HTTP {status_code}",
        message=f"Antwort {status_code}",
        stack="",
        status_code=status_code,
    )


async def record_slow_request(app: Any, request: Any, duration_ms: float, status_code: int) -> None:
    try:
        db = get_db()
        await db.ops_slow_requests.insert_one({
            "id": new_id(),
            "route": route_template(app, request.scope)[:200],
            "method": str(request.method or "GET").upper(),
            "status_code": int(status_code),
            "duration_ms": int(round(duration_ms)),
            "actor": _actor(request),
            "at": now_utc().isoformat(),
            "expires_at": _expires_at(),
        })
    except Exception as exc:  # noqa: BLE001
        logger.debug("[ops] slow record failed: %s", type(exc).__name__)


def should_watch(path: str) -> bool:
    return not any(path.startswith(prefix) for prefix in IGNORED_PATH_PREFIXES)


# ---------------------------------------------------------------- Lesen

def _since_iso(hours: int) -> str:
    return (now_utc() - timedelta(hours=hours)).isoformat()


async def errors_overview(db, status: str = "open", limit: int = 100) -> list[dict]:
    query: dict = {}
    if status == "open":
        query["resolved_at"] = None
    elif status == "resolved":
        query["resolved_at"] = {"$ne": None}
    rows = await db.ops_errors.find(query, {"_id": 0}).sort("last_seen_at", -1).to_list(max(1, min(int(limit), 500)))
    return rows


async def set_error_resolved(db, fingerprint: str, resolved: bool) -> dict | None:
    await db.ops_errors.update_one(
        {"fingerprint": fingerprint},
        {"$set": {"resolved_at": now_utc().isoformat() if resolved else None}},
    )
    return await db.ops_errors.find_one({"fingerprint": fingerprint}, {"_id": 0})


def _percentile(values: list[int], share: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round(share * (len(ordered) - 1)))))
    return ordered[index]


async def slow_overview(db, hours: int = 24, limit: int = 50) -> dict:
    """Die langsamsten Routen des Zeitraums - gerechnet in Python, damit es
    auch mit der In-Memory-Datenbank der Tests dasselbe Ergebnis ist."""
    rows = await db.ops_slow_requests.find({"at": {"$gte": _since_iso(hours)}}, {"_id": 0}).sort("at", -1).to_list(5000)
    buckets: dict[tuple[str, str], list[int]] = {}
    for row in rows:
        buckets.setdefault((row.get("method") or "GET", row.get("route") or "/"), []).append(int(row.get("duration_ms") or 0))
    routes = [
        {
            "method": method,
            "route": route,
            "count": len(durations),
            "avg_ms": int(sum(durations) / len(durations)),
            "max_ms": max(durations),
            "p95_ms": _percentile(durations, 0.95),
        }
        for (method, route), durations in buckets.items()
    ]
    routes.sort(key=lambda item: (-item["p95_ms"], -item["count"]))
    return {"hours": hours, "threshold_ms": SLOW_REQUEST_MS, "total": len(rows), "routes": routes[:limit], "recent": rows[:limit]}


async def ops_summary(db) -> dict:
    """Die Zahlen für die Tageszentrale."""
    since = _since_iso(24)
    open_groups = await db.ops_errors.count_documents({"resolved_at": None})
    recent_groups = await db.ops_errors.find({"last_seen_at": {"$gte": since}}, {"_id": 0, "count": 1, "route": 1, "error_type": 1, "last_seen_at": 1}).sort("last_seen_at", -1).to_list(200)
    slow_rows = await db.ops_slow_requests.find({"at": {"$gte": since}}, {"_id": 0, "route": 1, "duration_ms": 1}).to_list(5000)
    slowest = max(slow_rows, key=lambda row: int(row.get("duration_ms") or 0), default=None)
    from services.ops_checks import latest_checks_summary

    return {
        "open_error_groups": open_groups,
        "error_groups_24h": len(recent_groups),
        "slow_requests_24h": len(slow_rows),
        "slowest_route_24h": {"route": slowest.get("route"), "duration_ms": slowest.get("duration_ms")} if slowest else None,
        "threshold_ms": SLOW_REQUEST_MS,
        "checks": await latest_checks_summary(db),
    }
