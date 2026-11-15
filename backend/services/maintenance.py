"""Kurze Schreibpause für das nächtliche Backup (#1009).

Während Datenbank und Uploads als Paar gesichert werden, darf niemand schreiben - sonst passen Dump und Upload-Archiv
nicht zusammen. Das Backup-Skript schaltet darum für einige Sekunden eine Schreibpause ein:

- **Ein Ort für den Zustand:** ein Dokument ``write_pause`` in ``ops_maintenance`` mit einer Lease (``lease_until``).
  Alle Backend-Prozesse lesen dasselbe Dokument. Läuft die Lease ab, ist die Pause vorbei - auch wenn das Skript
  abstürzt und nie „aus“ sagt. Hängen bleiben kann sie also nicht.
- **Lesen geht weiter.** Schreibende Anfragen (POST, PUT, PATCH, DELETE) unter ``/api/`` bekommen 503 mit
  ``Retry-After`` und einem deutschen Text. Anmelden, Abmelden und Sitzung verlängern bleiben erlaubt.
- **Hintergrundjobs** (``services/scheduler.py``) lassen ihren Takt aus, solange die Pause gilt.
- **Gesteuert** wird nur über diese Kommandozeile im Backend-Container - es gibt keine Route dafür::

      docker compose exec -T backend python -m services.maintenance on --ttl 120 --reason backup
      docker compose exec -T backend python -m services.maintenance renew --token <token> --ttl 120
      docker compose exec -T backend python -m services.maintenance off --token <token>
      docker compose exec -T backend python -m services.maintenance status

Fällt die Datenbank beim Prüfen aus, gilt die Pause als aus (offen statt gesperrt): ohne Datenbank scheitert das
Schreiben ohnehin, und eine Störung darf die Website nie dauerhaft sperren.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import socket
import sys
from datetime import datetime, timedelta, timezone
from time import monotonic
from uuid import uuid4

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

logger = logging.getLogger("tls.maintenance")

DOC_ID = "write_pause"
ERROR_CODE = "write_pause"
# Kennzeichen der Antwort: die Betriebssicht zählt sie nicht als Serverfehler (server.py, ops_monitoring).
MARKER_HEADER = "X-Write-Pause"
# Grenzen der Lease: kurz genug, dass ein abgestürztes Backup die Website nicht lange sperrt.
MIN_TTL_SECONDS = 5
MAX_TTL_SECONDS = 1800
DEFAULT_TTL_SECONDS = 120
MESSAGE = ("Kurze Wartung: Wir sichern gerade die Daten. Lesen geht weiter, Speichern ist gleich wieder möglich. "
           "Bitte versuch es in einer Minute noch einmal.")
# Anmelden, Abmelden und Sitzung verlängern bleiben in der Pause möglich - sonst flöge jemand mitten in der Nacht raus.
DEFAULT_EXEMPT_PATHS = frozenset({
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/refresh",
    "/api/auth/mfa/complete",
    "/api/auth/mfa/cancel",
    "/api/auth/google/session",
    "/api/auth/mobile/login",
    "/api/auth/mobile/logout",
    "/api/auth/mobile/refresh",
    "/api/auth/passkeys/login/options",
    "/api/auth/passkeys/login/verify",
})
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class WritePauseBusy(RuntimeError):
    """Eine andere Pause (anderes Token) läuft noch - etwa ein zweites Backup."""


def _float_env(name: str, default: float, low: float, high: float) -> float:
    try:
        value = float(os.environ.get(name, "") or default)
    except ValueError:
        return default
    return min(max(value, low), high)


def cache_seconds() -> float:
    """So lange merkt sich ein Prozess den Zustand (``MAINTENANCE_CACHE_SECONDS``, Standard 1 s)."""
    return _float_env("MAINTENANCE_CACHE_SECONDS", 1.0, 0.0, 10.0)


def retry_after_seconds() -> int:
    """Was ``Retry-After`` höchstens nennt (``MAINTENANCE_RETRY_AFTER_SECONDS``, Standard 30 s)."""
    return int(_float_env("MAINTENANCE_RETRY_AFTER_SECONDS", 30, 1, 600))


def exempt_paths() -> frozenset[str]:
    """Pfade, die auch in der Pause schreiben dürfen: die Vorgabe plus ``MAINTENANCE_EXEMPT_PATHS`` (mit Komma)."""
    extra = {part.strip().rstrip("/") for part in os.environ.get("MAINTENANCE_EXEMPT_PATHS", "").split(",") if part.strip()}
    return DEFAULT_EXEMPT_PATHS | frozenset(extra)


def blocks(method: str, path: str) -> bool:
    """Trifft die Pause diese Anfrage? Nur schreibende Methoden unter ``/api/``, ohne die Ausnahmen."""
    if method.upper() not in UNSAFE_METHODS or not path.startswith("/api/"):
        return False
    return path.rstrip("/") not in exempt_paths()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value) -> datetime | None:
    """Motor liefert Zeiten ohne Zeitzone (UTC) - für den Vergleich mit Zeitzone."""
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _check_ttl(ttl_seconds: float) -> float:
    ttl = float(ttl_seconds)
    if not MIN_TTL_SECONDS <= ttl <= MAX_TTL_SECONDS:
        raise ValueError(f"Die Dauer der Pause muss zwischen {MIN_TTL_SECONDS} und {MAX_TTL_SECONDS} Sekunden liegen.")
    return ttl


def _public(doc: dict | None, now: datetime) -> dict:
    """Der Zustand für Ausgabe und Middleware - ohne das Token."""
    if not doc:
        return {"active": False}
    until = _aware(doc.get("lease_until"))
    active = bool(doc.get("active")) and until is not None and until > now
    result = {"active": active, "reason": doc.get("reason") or "", "host": doc.get("host") or ""}
    if until is not None:
        result["lease_until"] = until.isoformat(timespec="seconds")
        result["remaining_seconds"] = max(0, int((until - now).total_seconds())) if active else 0
    started = _aware(doc.get("started_at"))
    if started is not None:
        result["started_at"] = started.isoformat(timespec="seconds")
    return result


# ---------------------------------------------------------------------------------------------------------------------
# Schalten
# ---------------------------------------------------------------------------------------------------------------------

async def activate(db, *, ttl_seconds: float = DEFAULT_TTL_SECONDS, reason: str = "backup", now: datetime | None = None) -> dict:
    """Pause einschalten. Liefert ``token`` (zum Verlängern und Beenden) und ``lease_until``.

    Läuft schon eine Pause mit anderem Token und gültiger Lease: ``WritePauseBusy`` - zwei Backups gleichzeitig
    sollen sich nicht gegenseitig die Pause beenden."""
    ttl = _check_ttl(ttl_seconds)
    now = now or _now()
    token = uuid4().hex
    until = now + timedelta(seconds=ttl)
    try:
        doc = await db.ops_maintenance.find_one_and_update(
            {"_id": DOC_ID, "$or": [{"active": {"$ne": True}}, {"lease_until": {"$lte": now}}]},
            {"$set": {"active": True, "token": token, "reason": str(reason or "")[:60], "host": socket.gethostname()[:80],
                      "started_at": now, "lease_until": until, "updated_at": now},
             "$unset": {"ended_at": ""}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError as exc:
        raise WritePauseBusy("Es läuft schon eine Schreibpause.") from exc
    if not doc or doc.get("token") != token:
        raise WritePauseBusy("Es läuft schon eine Schreibpause.")
    reset_cache()
    return {"token": token, "lease_until": until.isoformat(timespec="seconds"), "ttl_seconds": ttl}


async def renew(db, token: str, *, ttl_seconds: float = DEFAULT_TTL_SECONDS, now: datetime | None = None) -> bool:
    """Lease verlängern - nur das eigene Token und nur, solange sie noch gilt. ``False``: die Pause war schon vorbei."""
    ttl = _check_ttl(ttl_seconds)
    now = now or _now()
    result = await db.ops_maintenance.update_one(
        {"_id": DOC_ID, "token": str(token or ""), "active": True, "lease_until": {"$gt": now}},
        {"$set": {"lease_until": now + timedelta(seconds=ttl), "updated_at": now}},
    )
    reset_cache()
    return getattr(result, "matched_count", 0) == 1


async def release_report(db, token: str | None = None, *, force: bool = False, now: datetime | None = None) -> dict:
    """Pause beenden. Ohne ``force`` nur mit dem eigenen Token.

    ``released``: ein Dokument wurde beendet. ``lease_held``: die Pause galt bis zum Beenden noch (bei eigenem Token:
    nie abgelaufen) - ``False`` heißt, zwischendurch durfte jemand schreiben."""
    if not force and not token:
        raise ValueError("Ohne Token nur mit force beenden.")
    now = now or _now()
    query = {"_id": DOC_ID} if force else {"_id": DOC_ID, "token": str(token)}
    before = await db.ops_maintenance.find_one_and_update(
        query, {"$set": {"active": False, "lease_until": now, "ended_at": now, "updated_at": now}},
        return_document=ReturnDocument.BEFORE)
    reset_cache()
    until = _aware((before or {}).get("lease_until"))
    held = bool(before and before.get("active") and until is not None and until > now)
    return {"released": before is not None, "lease_held": held}


async def release(db, token: str | None = None, *, force: bool = False, now: datetime | None = None) -> bool:
    """Pause beenden; ``True``, wenn ein Dokument beendet wurde (siehe ``release_report``)."""
    return (await release_report(db, token, force=force, now=now))["released"]


async def status(db, now: datetime | None = None) -> dict:
    now = now or _now()
    return _public(await db.ops_maintenance.find_one({"_id": DOC_ID}), now)


# ---------------------------------------------------------------------------------------------------------------------
# Lesen in jeder Anfrage (mit kurzem Zwischenspeicher je Prozess)
# ---------------------------------------------------------------------------------------------------------------------

# (Datenbank, gültig bis, Zustand) - je Datenbank-Objekt, damit ein Wechsel der Datenbank nie einen alten Stand liefert.
_cache: tuple[int, float, dict | None] | None = None


def reset_cache() -> None:
    global _cache
    _cache = None


async def active_state(db) -> dict | None:
    """Der Zustand einer gültigen Pause, sonst ``None``. Fehler beim Lesen: ``None`` (offen statt gesperrt)."""
    global _cache
    now_mono = monotonic()
    if _cache is not None and _cache[0] == id(db) and _cache[1] > now_mono:
        return _cache[2]
    try:
        state = await status(db)
    except Exception as exc:  # eine Störung darf die Website nicht sperren
        logger.warning("[maintenance] Zustand nicht lesbar, Schreiben bleibt erlaubt type=%s", type(exc).__name__)
        state = {"active": False}
    current = state if state.get("active") else None
    _cache = (id(db), now_mono + cache_seconds(), current)
    return current


async def wait_until_released(db, *, poll_seconds: float = 2.0, max_seconds: float = MAX_TTL_SECONDS) -> bool:
    """Warten, bis keine Pause mehr gilt (für Jobs zu festen Uhrzeiten). ``False``: nach ``max_seconds`` noch aktiv."""
    deadline = monotonic() + max_seconds
    while True:
        state = await active_state(db)
        if not state:
            return True
        if monotonic() >= deadline:
            return False
        remaining = float(state.get("remaining_seconds") or poll_seconds)
        await asyncio.sleep(max(0.05, min(poll_seconds, remaining + 0.1, max(0.0, deadline - monotonic()))))


def response_parts(state: dict) -> tuple[int, dict, dict]:
    """Status, Inhalt und Kopfzeilen der Antwort in der Pause."""
    retry = max(1, min(retry_after_seconds(), int(state.get("remaining_seconds") or retry_after_seconds())))
    body = {"detail": MESSAGE, "code": ERROR_CODE, "retry_after": retry}
    headers = {"Retry-After": str(retry), "Cache-Control": "no-store", MARKER_HEADER: "1"}
    return 503, body, headers


# ---------------------------------------------------------------------------------------------------------------------
# Warten, bis laufende Schreibvorgänge fertig sind
# ---------------------------------------------------------------------------------------------------------------------

async def busy_leases(db, now: datetime | None = None) -> list[str]:
    """Sperren laufender Schreibvorgänge (``mutation_locks``): Hintergrundjobs und Turnier-Änderungen."""
    now = now or _now()
    names = []
    async for row in db.mutation_locks.find({"expires_at": {"$gt": now}}, {"_id": 0, "resource": 1}):
        names.append(str(row.get("resource") or "")[:80])
    return sorted(names)


async def wait_for_drain(db, *, timeout_seconds: float, settle_seconds: float, poll_seconds: float = 0.5) -> list[str]:
    """Nach dem Einschalten: erst ``settle_seconds`` warten (Zwischenspeicher der Prozesse, Anfragen im Flug), dann bis
    ``timeout_seconds``, bis keine Sperre mehr gehalten wird. Liefert die Sperren, die danach noch gehalten werden."""
    await asyncio.sleep(max(0.0, settle_seconds))
    deadline = monotonic() + max(0.0, timeout_seconds)
    while True:
        busy = await busy_leases(db)
        if not busy or monotonic() >= deadline:
            return busy
        await asyncio.sleep(poll_seconds)


# ---------------------------------------------------------------------------------------------------------------------
# Kommandozeile (nur im Backend-Container)
# ---------------------------------------------------------------------------------------------------------------------

def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m services.maintenance", description="Schreibpause für das Backup (#1009)")
    sub = parser.add_subparsers(dest="command", required=True)
    on = sub.add_parser("on", help="Pause einschalten")
    on.add_argument("--ttl", type=float, default=DEFAULT_TTL_SECONDS, help="Lease in Sekunden (endet von selbst)")
    on.add_argument("--reason", default="backup")
    on.add_argument("--settle", type=float, default=3.0, help="Sekunden, bis alle Prozesse die Pause sehen")
    on.add_argument("--drain-timeout", type=float, default=60.0, help="Höchstens so lange auf laufende Schreibvorgänge warten")
    renew_cmd = sub.add_parser("renew", help="Lease verlängern")
    renew_cmd.add_argument("--token", required=True)
    renew_cmd.add_argument("--ttl", type=float, default=DEFAULT_TTL_SECONDS)
    off = sub.add_parser("off", help="Pause beenden")
    off.add_argument("--token", default="")
    off.add_argument("--force", action="store_true", help="Auch eine fremde Pause beenden")
    sub.add_parser("status", help="Zustand zeigen")
    return parser


async def run_command(db, argv: list[str]) -> tuple[int, dict]:
    """Ein Befehl der Kommandozeile; liefert Rückgabewert und Ausgabe (JSON). Getrennt von ``main`` für die Tests."""
    args = _parser().parse_args(argv)
    try:
        if args.command == "on":
            started = await activate(db, ttl_seconds=args.ttl, reason=args.reason)
            try:
                busy = await wait_for_drain(db, timeout_seconds=args.drain_timeout, settle_seconds=args.settle)
            except BaseException:
                # Das Token ginge mit der Ausnahme verloren - die Pause selbst freigeben, statt die Lease abzuwarten.
                await release(db, started["token"])
                raise
            return 0, {**started, "drained": not busy, "busy": busy}
        if args.command == "renew":
            if await renew(db, args.token, ttl_seconds=args.ttl):
                return 0, {"renewed": True, **(await status(db))}
            return 4, {"renewed": False, "error": "Die Pause war schon vorbei oder gehört einem anderen Lauf."}
        if args.command == "off":
            if not args.token and not args.force:
                return 2, {"error": "Token fehlt (oder --force)."}
            report = await release_report(db, args.token or None, force=args.force)
            # Mit --force ist "aus" das Ziel: auch ohne Dokument (frische oder alte Datenbank) ist das erreicht.
            ok = report["released"] or args.force
            return (0 if ok else 5), report
        return 0, await status(db)
    except WritePauseBusy as exc:
        return 3, {"error": str(exc), **(await status(db))}
    except ValueError as exc:
        return 2, {"error": str(exc)}


async def _main(argv: list[str]) -> int:
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=10000)
    try:
        code, payload = await run_command(client[os.environ["DB_NAME"]], argv)
    finally:
        client.close()
    print(json.dumps(payload, ensure_ascii=False))
    return code


if __name__ == "__main__":  # pragma: no cover - Betriebsbefehl
    raise SystemExit(asyncio.run(_main(sys.argv[1:])))
