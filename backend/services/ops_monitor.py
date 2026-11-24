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
import time
import traceback
from datetime import timedelta
from typing import Any

from starlette.routing import Match

from database import get_db
from models import new_id, now_utc
from services.log_safe import log_safe
from services.ops_error_scrub import clean_error_type, clean_version, client_frames, client_route, server_frames, server_route_fallback
from services.ops_upload_routes import is_upload

logger = logging.getLogger("tls.ops")

SLOW_REQUEST_MS = int(os.environ.get("SLOW_REQUEST_MS", "1000") or 1000)
# Stand der Website an jeder Fehlergruppe (#1657) - wie VITE_APP_VERSION im Web, aus derselben APP_VERSION der .env.
APP_VERSION = os.environ.get("APP_VERSION", "")
RETENTION_DAYS = 30
STACK_LIMIT = 6000
MESSAGE_LIMIT = 500
# Gesundheitsprüfungen und der Änderungsstrom (der absichtlich offen bleibt)
# sagen nichts über das Tempo der Anwendung.
IGNORED_PATH_PREFIXES = ("/api/health", "/api/changes/stream")
# Datei-Uploads (#2447) zählen nicht als langsam - Vorgabe und Regel in ``ops_upload_routes``.

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
    return hashlib.sha1(raw.encode("utf-8"), usedforsecurity=False).hexdigest()[:16]


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


async def _error_settings(db) -> dict:
    from services.ops_alerts import load_alert_settings

    try:
        return await load_alert_settings(db)
    except Exception:  # noqa: BLE001 - ohne Einstellungen gelten die Vorgaben
        from services.ops_alerts import merge_settings

        return merge_settings(None)


async def upsert_group(db, *, fingerprint: str, fields: dict, status_code: int = 0) -> str | None:
    """Eine Fehlergruppe zählen (#233, #1657) - für Server, Website und App derselbe Weg.

    ``fields`` sind schon bereinigt (``ops_error_scrub``): Quelle, Fehlerart, Stelle, Route, Version. Eine Meldung wird
    nie gespeichert; eine alte aus der Zeit vor #1657 fällt beim nächsten Auftreten weg. Das Ablaufdatum folgt der
    Aufbewahrung unter Betrieb → Alarme. Danach: Häufung im Zeitfenster zählen und - einmal je Fenster - melden."""
    try:
        settings = await _error_settings(db)
        current = now_utc()
        now_iso = current.isoformat()
        outcome = await db.ops_errors.update_one(
            {"fingerprint": fingerprint},
            {
                "$setOnInsert": {"id": new_id(), "fingerprint": fingerprint, "first_seen_at": now_iso},
                "$set": {
                    **fields,
                    "status_code": int(status_code),
                    "last_seen_at": now_iso,
                    "expires_at": current + timedelta(days=int(settings["retention_days"]["ops_errors"])),
                    "resolved_at": None,
                    "resolved_by": None,
                },
                "$unset": {"message": ""},
                "$inc": {"count": 1},
            },
            upsert=True,
        )
        from services.ops_alerts import schedule_error_alert, schedule_spike_alert

        if int(status_code) >= 500 and getattr(outcome, "upserted_id", None) is not None:
            # Eine neue 5xx-Gruppe meldet sich per Discord (#265) - im Hintergrund.
            group = await db.ops_errors.find_one({"fingerprint": fingerprint}, {"_id": 0})
            if group:
                schedule_error_alert(db, group)
        spike = await _count_in_window(db, fingerprint, current, settings)
        if spike:
            schedule_spike_alert(db, spike["group"], spike["count"], spike["window_minutes"])
        return fingerprint
    except Exception as exc:  # noqa: BLE001 - die Aufzeichnung darf die Antwort nie verhindern
        logger.debug("[ops] error record failed: %s", type(exc).__name__)
        return None


async def _count_in_window(db, fingerprint: str, current, settings: dict) -> dict | None:
    """Häufung (#1657): Auftreten je festem Zeitfenster (``window_started_at``, ``window_count``). Erreicht ein Fenster die
    Schwelle, holt sich genau ein Lauf das Fenster (``spike_window``) - nur er meldet. Zwei Läufe am Fensterwechsel können
    ein Auftreten verlieren; für eine Warnung reicht das."""
    from pymongo import ReturnDocument

    window_minutes = int(settings["spike_window_minutes"])
    threshold = int(settings["spike_threshold"])
    row = await db.ops_errors.find_one({"fingerprint": fingerprint}, {"_id": 0, "window_started_at": 1}) or {}
    started = row.get("window_started_at")
    if not started or started < (current - timedelta(minutes=window_minutes)).isoformat():
        started = current.isoformat()
        await db.ops_errors.update_one({"fingerprint": fingerprint, "window_started_at": row.get("window_started_at")},
                                       {"$set": {"window_started_at": started, "window_count": 1}})
        count = 1
    else:
        after = await db.ops_errors.find_one_and_update({"fingerprint": fingerprint}, {"$inc": {"window_count": 1}},
                                                        projection={"_id": 0, "window_count": 1}, return_document=ReturnDocument.AFTER)
        count = int((after or {}).get("window_count") or 0)
    if count < threshold:
        return None
    claimed = await db.ops_errors.update_one({"fingerprint": fingerprint, "spike_window": {"$ne": started}}, {"$set": {"spike_window": started}})
    if not getattr(claimed, "modified_count", 0):
        return None
    group = await db.ops_errors.find_one({"fingerprint": fingerprint}, {"_id": 0})
    return {"group": group or {"fingerprint": fingerprint}, "count": count, "window_minutes": window_minutes}


def _server_route(app: Any, scope: dict) -> str:
    route = route_template(app, scope)
    return route if "{" in route or not any(char.isdigit() for char in route) else server_route_fallback(str(scope.get("path") or "/"))


async def _upsert_error(app: Any, request: Any, *, error_type: str, stack: str, status_code: int, frame: str = "") -> str | None:
    try:
        route = _server_route(app, request.scope)
        method = str(request.method or "GET").upper()
    except Exception as exc:  # noqa: BLE001
        logger.debug("[ops] error record failed: %s", type(exc).__name__)
        return None
    fields = {
        "source": "server",
        "error_type": clean_error_type(error_type),
        "stack": stack[:STACK_LIMIT],
        "route": route[:200],
        "method": method,
        "version": clean_version(APP_VERSION),
        "actor": _actor(request),
    }
    return await upsert_group(get_db(), fingerprint=error_fingerprint(error_type, route, method, frame), fields=fields, status_code=status_code)


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
    dort stehen die eigenen Zeilen und die Meldung. Nur fürs Container-Log - gespeichert werden die Stellen
    (``server_frames``)."""
    text = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__, chain=False))
    return text[-STACK_LIMIT:] if len(text) > STACK_LIMIT else text


async def record_exception(app: Any, request: Any, exc: BaseException, status_code: int = 500) -> str | None:
    """Eine unbehandelte Ausnahme als Gruppe festhalten - Art, Stellen, Route, Version; nie die Meldung (#1657)."""
    exc = unwrap_exception(exc)
    return await _upsert_error(
        app, request,
        error_type=type(exc).__name__,
        stack=server_frames(exc),
        status_code=status_code,
        frame=top_frame(exc),
    )


async def record_http_error(app: Any, request: Any, status_code: int) -> str | None:
    """Eine 5xx-Antwort ohne Ausnahme (etwa ein bewusstes 503)."""
    return await _upsert_error(
        app, request,
        error_type=f"HTTP {status_code}",
        stack="",
        status_code=status_code,
    )


CLIENT_SOURCES = ("web", "app")


def client_fingerprint(source: str, error_type: str, route: str, frames: str) -> str:
    """Gleiche Art, gleiche Seite, gleiche oberste Stelle - eine Gruppe. Der Hash der Bausteine fällt vorher weg
    (``ops_error_scrub``), so bleibt die Gruppe über Deploys hinweg dieselbe, solange die Zeile gleich ist."""
    first = frames.split("\n", 1)[0] if frames else ""
    return error_fingerprint(f"{source}:{error_type}", route, "", first)


async def record_client_error(db, *, source: str, error_type: str, stack: str, route: str, version: str) -> str | None:
    """Ein Fehler aus Website oder App (#1657) - bereinigt wie ein Serverfehler, in derselben Liste."""
    if source not in CLIENT_SOURCES:
        return None
    kind = clean_error_type(error_type)
    frames = client_frames(stack)
    page = client_route(route)
    fields = {"source": source, "error_type": kind, "stack": frames, "route": page, "method": "", "version": clean_version(version)}
    return await upsert_group(db, fingerprint=client_fingerprint(source, kind, page, frames), fields=fields)


def is_multipart(request: Any) -> bool:
    headers = getattr(request, "headers", {}) or {}
    return str(headers.get("content-type") or "").lower().startswith("multipart/form-data")


async def upload_routes(db) -> list[str]:
    from services.ops_alerts import load_alert_settings

    return list((await load_alert_settings(db)).get("upload_routes") or [])


async def record_slow_request(app: Any, request: Any, duration_ms: float, status_code: int) -> None:
    try:
        db = get_db()
        await db.ops_slow_requests.insert_one({
            "upload": is_multipart(request),
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


# Starlettes ``BaseHTTPMiddleware`` wirft das, wenn von innen keine Antwort kam - etwa weil die Verbindung schon weg war.
NO_RESPONSE_MESSAGE = "No response returned."


def is_client_abort(exc: BaseException, *, client_gone: bool) -> bool:
    """Ein Abbruch durch den Client (#2446) ist kein Serverfehler.

    ``ClientDisconnect`` sagt das selbst. „No response returned.“ zählt nur als Abbruch, wenn die Verbindung wirklich
    getrennt war (``client_gone``) - ohne Trennung ist es ein echter Fehler im Code und bleibt eine Gruppe. Jede andere
    Ausnahme bleibt ein Serverfehler, auch wenn der Client inzwischen weg ist."""
    from starlette.requests import ClientDisconnect

    exc = unwrap_exception(exc)
    if isinstance(exc, ClientDisconnect):
        return True
    return client_gone and isinstance(exc, RuntimeError) and str(exc) == NO_RESPONSE_MESSAGE


class OpsMonitorMiddleware:
    """Die Betriebssicht als äußerste Middleware (server.py), als reine ASGI-Middleware (#2446).

    Zählt unbehandelte Ausnahmen - auch solche, die erst nach Beginn der Antwort im Körper auftreten - und 5xx-Antworten
    als Gruppe (außer der Schreibpause, ``maintenance.MARKER_HEADER``; eine schon gezählte 5xx nicht doppelt) und
    Anfragen über ``SLOW_REQUEST_MS`` - gemessen bis zum Beginn der Antwort. Andere Scopes (WebSocket, lifespan) gehen
    unverändert durch.
    Neu: Sie sieht, ob der Client die Verbindung getrennt hat (``http.disconnect`` beim Lesen, ``OSError`` beim Senden).
    Ein solcher Abbruch wird nicht gezählt und nicht weitergeworfen - es gibt niemanden mehr, dem man antworten könnte."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        from starlette.requests import ClientDisconnect, Request

        request = Request(scope)
        path = request.url.path
        if not path.startswith("/api/") or not should_watch(path):
            await self.app(scope, receive, send)
            return
        app = scope.get("app")
        started = time.perf_counter()
        client_gone = False
        response_started = False
        recorded_5xx = False

        async def watched_receive():
            nonlocal client_gone
            message = await receive()
            if message.get("type") == "http.disconnect":
                client_gone = True
            return message

        async def watched_send(message):
            nonlocal client_gone, response_started, recorded_5xx
            if message.get("type") == "http.response.start" and not response_started:
                response_started = True
                recorded_5xx = await _observe_response(app, request, message, (time.perf_counter() - started) * 1000)
            try:
                await send(message)
            except OSError as exc:  # uvicorn: Verbindung beim Senden schon zu
                client_gone = True
                raise ClientDisconnect() from exc

        try:
            await self.app(scope, watched_receive, watched_send)
        except Exception as exc:
            if is_client_abort(exc, client_gone=client_gone):
                if client_gone:
                    logger.debug("[ops] client left during the request route=%s", log_safe(route_template(app, scope)))
                    return
                raise
            # Aufzeichnung darf nie die Antwort verhindern - die Ausnahme geht nach dem Festhalten unverändert weiter.
            # Auch nach Beginn der Antwort (ein Streaming- oder Datei-Körper bricht ab): Dann kann Starlette keine 500
            # mehr senden, der Fehler wäre sonst unsichtbar. Wurde die Antwort schon als 5xx gezählt, nicht doppelt.
            if not recorded_5xx:
                await record_exception(app, request, exc)
            raise


async def _observe_response(app: Any, request: Any, message: dict, duration_ms: float) -> bool:
    """Beginn der Antwort: 5xx (außer Schreibpause) als Gruppe, langsame Anfragen. ``True``, wenn eine 5xx gezählt wurde."""
    from starlette.datastructures import Headers

    from services import maintenance

    status_code = int(message.get("status") or 0)
    recorded = False
    # Die Schreibpause fürs Backup (#1009) ist gewollt und kein Serverfehler.
    if status_code >= 500 and maintenance.MARKER_HEADER not in Headers(raw=message.get("headers") or []):
        await record_http_error(app, request, status_code)
        recorded = True
    if duration_ms >= SLOW_REQUEST_MS:
        await record_slow_request(app, request, duration_ms, status_code)
    return recorded


# ---------------------------------------------------------------- Lesen

def _since_iso(hours: int) -> str:
    return (now_utc() - timedelta(hours=hours)).isoformat()


async def errors_overview(db, status: str = "open", limit: int = 100, source: str = "all", q: str = "") -> list[dict]:
    """Die Gruppen für Betrieb → Fehler: Stand, Quelle (#1657: Server, Website, App) und Suche in Fehlerart, Route,
    Stelle und Kennung (die Kennung von der Fehlerseite - auch nur ihr Anfang)."""
    query: dict = {}
    if status == "open":
        query["resolved_at"] = None
    elif status == "resolved":
        query["resolved_at"] = {"$ne": None}
    if source == "server":
        # Gruppen aus der Zeit vor #1657 haben keine Quelle - sie sind alle vom Server.
        query["source"] = {"$nin": list(CLIENT_SOURCES)}
    elif source in CLIENT_SOURCES:
        query["source"] = source
    text = " ".join(str(q or "").split())[:80]
    if text:
        pattern = re.escape(text)
        query["$or"] = [
            {"fingerprint": {"$regex": f"^{pattern}"}},
            {"error_type": {"$regex": pattern, "$options": "i"}},
            {"route": {"$regex": pattern, "$options": "i"}},
            {"stack": {"$regex": pattern, "$options": "i"}},
            {"version": {"$regex": pattern, "$options": "i"}},
        ]
    rows = await db.ops_errors.find(query, {"_id": 0}).sort("last_seen_at", -1).to_list(max(1, min(int(limit), 500)))
    return rows


async def set_error_resolved(db, fingerprint: str, resolved: bool, actor_id: str | None = None) -> dict | None:
    """Gelöst bzw. wieder offen; ``resolved_by`` (#2447) ist die Kennung, wer gelöst bzw. quittiert hat."""
    await db.ops_errors.update_one(
        {"fingerprint": fingerprint},
        {"$set": {"resolved_at": now_utc().isoformat() if resolved else None, "resolved_by": actor_id if resolved else None}},
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
    patterns = await upload_routes(db)
    buckets: dict[tuple[str, str], list[int]] = {}
    uploads: set[tuple[str, str]] = set()
    for row in rows:
        bucket = (row.get("method") or "GET", row.get("route") or "/")
        buckets.setdefault(bucket, []).append(int(row.get("duration_ms") or 0))
        if is_upload(row, patterns):
            uploads.add(bucket)
    routes = [
        {
            "method": method,
            "route": route,
            "count": len(durations),
            "avg_ms": int(sum(durations) / len(durations)),
            "max_ms": max(durations),
            "p95_ms": _percentile(durations, 0.95),
            # Datei-Upload (#2447): steht da, zählt aber nicht als langsam - darum ans Ende.
            "upload": (method, route) in uploads,
        }
        for (method, route), durations in buckets.items()
    ]
    routes.sort(key=lambda item: (item["upload"], -item["p95_ms"], -item["count"]))
    upload_count = sum(1 for row in rows if is_upload(row, patterns))
    return {"hours": hours, "threshold_ms": SLOW_REQUEST_MS, "total": len(rows) - upload_count, "upload_count": upload_count,
            "routes": routes[:limit], "recent": rows[:limit]}


async def ops_summary(db) -> dict:
    """Die Zahlen für die Tageszentrale."""
    since = _since_iso(24)
    open_groups = await db.ops_errors.count_documents({"resolved_at": None})
    recent_groups = await db.ops_errors.find({"last_seen_at": {"$gte": since}}, {"_id": 0, "count": 1, "route": 1, "error_type": 1, "last_seen_at": 1}).sort("last_seen_at", -1).to_list(200)
    every_slow = await db.ops_slow_requests.find({"at": {"$gte": since}}, {"_id": 0, "route": 1, "method": 1, "duration_ms": 1, "upload": 1}).to_list(5000)
    # Datei-Uploads (#2447) zählen nicht als langsam und sind nie „Langsamste Route“.
    patterns = await upload_routes(db)
    slow_rows = [row for row in every_slow if not is_upload(row, patterns)]
    slowest = max(slow_rows, key=lambda row: int(row.get("duration_ms") or 0), default=None)
    from services.ops_checks import latest_checks_summary

    return {
        "open_error_groups": open_groups,
        "error_groups_24h": len(recent_groups),
        "slow_requests_24h": len(slow_rows),
        "slow_uploads_24h": len(every_slow) - len(slow_rows),
        "slowest_route_24h": {"route": slowest.get("route"), "duration_ms": slowest.get("duration_ms")} if slowest else None,
        "threshold_ms": SLOW_REQUEST_MS,
        "checks": await latest_checks_summary(db),
    }
