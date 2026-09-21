"""Auto-Checks für den Betrieb (#265).

Alle fünf Minuten prüft der Scheduler, was im Betrieb still kaputtgehen
kann: Datenbank-Latenz, freier Speicher, Upload-Volume, Mail-Queue,
Änderungsstrom, fehlende Bildvarianten, offene Fehlergruppen, Scheduler.
Jede Prüfung ergibt eine Ampel (ok, warn, crit) mit einem Wert und einem
Satz; ein Lauf wird sieben Tage aufgehoben. Die Tageszentrale zeigt die
schlechteste Ampel, Admin → Betrieb → Checks die Einzelheiten.

Die Bewertung ist von der Messung getrennt (``rate_*``), damit Tests die
Schwellen prüfen können, ohne eine Platte vollzuschreiben.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from models import new_id, now_utc
from services.image_variants import VARIANT_DIR_NAME, is_resizable
from storage import PUBLIC_UPLOAD_DIR, UPLOAD_DIR

logger = logging.getLogger(__name__)

STATUS_ORDER = {"ok": 0, "warn": 1, "crit": 2}
HISTORY_DAYS = 7
CHECK_INTERVAL_MINUTES = 5

DB_WARN_MS = 250
DB_CRIT_MS = 1000
DISK_WARN_PCT = 15.0
DISK_CRIT_PCT = 5.0
MAIL_CRIT_BACKLOG = 20
STREAM_WARN_HOURS = 48.0
TWITCH_STALE_MINUTES = 15.0
VARIANTS_WARN_MISSING = 50
VARIANT_SCAN_LIMIT = 5000
UPLOAD_SCAN_LIMIT = 200_000


# ---------------------------------------------------------------- Bewertung

def worst_status(statuses: list[str] | tuple[str, ...]) -> str:
    worst = "ok"
    for status in statuses:
        if STATUS_ORDER.get(status, 0) > STATUS_ORDER[worst]:
            worst = status
    return worst


def rate_database(latency_ms: float | None) -> str:
    if latency_ms is None:
        return "crit"
    if latency_ms >= DB_CRIT_MS:
        return "crit"
    if latency_ms >= DB_WARN_MS:
        return "warn"
    return "ok"


def rate_disk(free_pct: float | None) -> str:
    if free_pct is None:
        return "crit"
    if free_pct < DISK_CRIT_PCT:
        return "crit"
    if free_pct < DISK_WARN_PCT:
        return "warn"
    return "ok"


def rate_mail(counts: dict | None, due_pending: int = 0, stale_sending: int = 0) -> str:
    counts = counts or {}
    if int(stale_sending or 0) > 0 or int(due_pending or 0) >= MAIL_CRIT_BACKLOG:
        return "crit"
    if int(counts.get("failed") or 0) > 0:
        return "warn"
    return "ok"


def rate_stream(age_hours: float | None) -> str:
    # Kein Ereignis ist kein Fehler - nachts passiert nichts. Erst nach zwei
    # Tagen Stille lohnt ein Blick, ob der Strom überhaupt noch läuft.
    if age_hours is None:
        return "ok"
    return "warn" if age_hours > STREAM_WARN_HOURS else "ok"


def rate_twitch(state: dict | None, age_minutes: float | None) -> str:
    # Nie eingerichtet oder bewusst aus ist kein Alarm. Eingerichtet und
    # trotzdem ohne Ergebnis heißt: die Startseite zeigt keine Streams (#310).
    state = state or {}
    if state.get("reason") in ("not_configured", "disabled"):
        return "ok"
    if not state:
        return "ok"
    if not state.get("ok"):
        return "warn"
    if age_minutes is None or age_minutes > TWITCH_STALE_MINUTES:
        return "warn"
    return "ok"


def rate_variants(missing: int) -> str:
    return "warn" if int(missing or 0) > VARIANTS_WARN_MISSING else "ok"


def rate_error_groups(open_groups: int, new_5xx_last_hour: int) -> str:
    if int(new_5xx_last_hour or 0) > 0:
        return "crit"
    if int(open_groups or 0) > 0:
        return "warn"
    return "ok"


def result(key: str, label: str, status: str, value: str, detail: str = "") -> dict:
    return {"key": key, "label": label, "status": status if status in STATUS_ORDER else "crit", "value": value, "detail": detail}


def failed(key: str, label: str, exc: BaseException) -> dict:
    logger.warning("[ops] check %s failed: %s", key, exc)
    return result(key, label, "crit", "Prüfung fehlgeschlagen", type(exc).__name__)


# ---------------------------------------------------------------- Messungen

async def check_database(db) -> dict:
    label = "Datenbank"
    started = time.perf_counter()
    try:
        try:
            await db.command("ping")
        except (NotImplementedError, TypeError, AttributeError):
            # Die In-Memory-Datenbank der Tests kennt kein ping; ein Lesen tut es auch.
            await db.list_collection_names()
        latency = (time.perf_counter() - started) * 1000
    except Exception as exc:  # noqa: BLE001 - jede Ursache ist rot
        return result("database", label, "crit", "nicht erreichbar", str(exc)[:160])
    return result("database", label, rate_database(latency), f"{latency:.0f} ms", "Antwortzeit auf ping")


def _disk_usage(path: Path) -> tuple[int, int]:
    target = path if path.exists() else Path.cwd()
    usage = shutil.disk_usage(target)
    return usage.total, usage.free


async def check_disk() -> dict:
    label = "Freier Speicher"
    try:
        total, free = await asyncio.to_thread(_disk_usage, UPLOAD_DIR)
    except Exception as exc:  # noqa: BLE001
        return failed("disk", label, exc)
    free_pct = (free / total * 100) if total else None
    value = f"{free / 1e9:.1f} GB frei" + (f" ({free_pct:.0f} %)" if free_pct is not None else "")
    return result("disk", label, rate_disk(free_pct), value, f"Datenträger von {UPLOAD_DIR}")


def _walk_size(path: Path, limit: int = UPLOAD_SCAN_LIMIT) -> tuple[int, int, bool]:
    files = 0
    total = 0
    truncated = False
    for root, _dirs, names in os.walk(path):
        for name in names:
            files += 1
            if files > limit:
                truncated = True
                return files - 1, total, truncated
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                continue
    return files, total, truncated


async def check_uploads() -> dict:
    label = "Upload-Volume"
    if not UPLOAD_DIR.exists():
        return result("uploads", label, "crit", "fehlt", f"{UPLOAD_DIR} gibt es nicht")
    try:
        files, total, truncated = await asyncio.to_thread(_walk_size, UPLOAD_DIR)
    except Exception as exc:  # noqa: BLE001
        return failed("uploads", label, exc)
    value = f"{total / 1e9:.2f} GB, {files:,}".replace(",", " ") + (" +" if truncated else "") + " Dateien"
    writable = os.access(UPLOAD_DIR, os.W_OK)
    return result("uploads", label, "ok" if writable else "crit", value, "beschreibbar" if writable else "nicht beschreibbar")


async def check_mail_queue() -> dict:
    label = "Mail-Queue"
    try:
        from services.mail_queue import mail_queue_stats

        stats = await mail_queue_stats()
    except Exception as exc:  # noqa: BLE001
        return failed("mail_queue", label, exc)
    counts = stats.get("counts") or {}
    due_pending = int(stats.get("due_pending") or 0)
    stale = int(stats.get("stale_sending") or 0)
    status = rate_mail(counts, due_pending, stale)
    value = f"{int(counts.get('pending') or 0)} wartend, {int(counts.get('failed') or 0)} fehlgeschlagen"
    detail = f"{due_pending} fällig, {stale} hängen im Versand" if (due_pending or stale) else "nichts fällig"
    return result("mail_queue", label, status, value, detail)


def _hours_since(value: str | None) -> float | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(0.0, (now_utc() - parsed).total_seconds() / 3600)


async def check_change_stream() -> dict:
    label = "Änderungsstrom"
    try:
        from services.change_events import last_event_occurred_at

        last = last_event_occurred_at()
    except Exception as exc:  # noqa: BLE001
        return failed("change_stream", label, exc)
    age = _hours_since(last)
    if age is None:
        return result("change_stream", label, "ok", "kein Ereignis seit dem Start", "der Puffer füllt sich mit der ersten Änderung")
    if age < 1:
        value = f"vor {age * 60:.0f} min"
    else:
        value = f"vor {age:.1f} h"
    return result("change_stream", label, rate_stream(age), value, "letztes Ereignis")


async def check_twitch_poll(db) -> dict:
    label = "Twitch-Abfrage"
    try:
        state = await db.settings.find_one({"id": "twitch_poll_state"}, {"_id": 0}) or {}
    except Exception as exc:  # noqa: BLE001
        return failed("twitch_poll", label, exc)
    if not state:
        return result("twitch_poll", label, "ok", "noch kein Lauf", "die Abfrage läuft alle 90 s, sobald Zugangsdaten gespeichert sind")
    hours = _hours_since(state.get("last_run_at"))
    age_minutes = None if hours is None else hours * 60
    status = rate_twitch(state, age_minutes)
    reason = state.get("reason_text") or state.get("reason") or ""
    if state.get("reason") in ("not_configured", "disabled"):
        return result("twitch_poll", label, status, "aus", reason)
    if not state.get("ok"):
        detail = f"{reason} ({state.get('detail')})" if state.get("detail") else reason
        return result("twitch_poll", label, status, "liefert nichts", detail + " – Einstellungen → Twitch")
    if status == "warn":
        return result("twitch_poll", label, status, f"steht seit {age_minutes:.0f} min" if age_minutes is not None else "steht", "der letzte Lauf ist zu lange her")
    return result("twitch_poll", label, status, f"{state.get('live', 0)} live von {state.get('checked', 0)} Kanälen", "letzter Lauf in Ordnung")


def _missing_variants(path: Path, limit: int = VARIANT_SCAN_LIMIT) -> tuple[int, int, bool]:
    scanned = 0
    missing = 0
    truncated = False
    if not path.exists():
        return 0, 0, False
    variants = path / VARIANT_DIR_NAME
    for entry in path.iterdir():
        if not entry.is_file() or not is_resizable(entry):
            continue
        scanned += 1
        if scanned > limit:
            truncated = True
            scanned -= 1
            break
        if not (variants / f"{entry.stem}-400.webp").exists():
            missing += 1
    return scanned, missing, truncated


async def check_image_variants() -> dict:
    label = "Bildvarianten"
    try:
        scanned, missing, truncated = await asyncio.to_thread(_missing_variants, PUBLIC_UPLOAD_DIR)
    except Exception as exc:  # noqa: BLE001
        return failed("image_variants", label, exc)
    value = f"{missing} von {scanned}{' +' if truncated else ''} ohne kleine Fassung"
    return result("image_variants", label, rate_variants(missing), value, "Bilder unter uploads/public, geprüft auf die 400er-Fassung")


async def check_error_groups(db) -> dict:
    label = "Fehlergruppen"
    try:
        open_groups = await db.ops_errors.count_documents({"resolved_at": None})
        since = (now_utc() - timedelta(hours=1)).isoformat()
        new_5xx = await db.ops_errors.count_documents({"first_seen_at": {"$gte": since}, "status_code": {"$gte": 500}})
    except Exception as exc:  # noqa: BLE001
        return failed("error_groups", label, exc)
    value = f"{open_groups} offen, {new_5xx} neue 5xx in 1 h"
    return result("error_groups", label, rate_error_groups(open_groups, new_5xx), value, "Server-Fehler als Gruppen (Betrieb → Fehler)")


async def check_scheduler() -> dict:
    label = "Scheduler"
    try:
        from services.scheduler import get_scheduler_status

        status = get_scheduler_status()
    except Exception as exc:  # noqa: BLE001
        return failed("scheduler", label, exc)
    running = bool(status.get("running"))
    jobs = len(status.get("jobs") or [])
    return result("scheduler", label, "ok" if running else "crit", f"{jobs} Jobs" if running else "steht", "läuft" if running else "kein Scheduler aktiv")


CheckRunner = Callable[[Any], Awaitable[dict]]


def default_checks(db) -> list[tuple[str, str, Callable[[], Awaitable[dict]]]]:
    return [
        ("database", "Datenbank", lambda: check_database(db)),
        ("disk", "Freier Speicher", check_disk),
        ("uploads", "Upload-Volume", check_uploads),
        ("mail_queue", "Mail-Queue", check_mail_queue),
        ("change_stream", "Änderungsstrom", check_change_stream),
        ("image_variants", "Bildvarianten", check_image_variants),
        ("error_groups", "Fehlergruppen", lambda: check_error_groups(db)),
        ("scheduler", "Scheduler", check_scheduler),
        ("twitch_poll", "Twitch-Abfrage", lambda: check_twitch_poll(db)),
    ]


# ---------------------------------------------------------------- Lauf und Verlauf

def summarize_run(checks: list[dict], at: str | None = None) -> dict:
    counts = {"ok": 0, "warn": 0, "crit": 0}
    for check in checks:
        counts[check.get("status") if check.get("status") in counts else "crit"] += 1
    return {
        "at": at or now_utc().isoformat(),
        "status": worst_status([c.get("status", "crit") for c in checks]),
        "counts": counts,
        "failing": [c["key"] for c in checks if c.get("status") != "ok"],
    }


async def run_checks(db, checks: list[tuple[str, str, Callable[[], Awaitable[dict]]]] | None = None) -> dict:
    """Alle Prüfungen ausführen, den Lauf speichern und zurückgeben."""
    results: list[dict] = []
    for key, label, runner in (checks if checks is not None else default_checks(db)):
        try:
            results.append(await runner())
        except Exception as exc:  # noqa: BLE001 - eine kaputte Prüfung reißt die anderen nicht mit
            results.append(failed(key, label, exc))
    now = now_utc()
    run = {"id": new_id(), **summarize_run(results, now.isoformat()), "checks": results, "expires_at": now + timedelta(days=HISTORY_DAYS)}
    try:
        await db.ops_check_runs.insert_one(dict(run))
    except Exception:  # noqa: BLE001
        logger.warning("[ops] could not store check run", exc_info=True)
    run.pop("_id", None)
    return run


def _day(value: str) -> str:
    return str(value)[:10]


async def checks_overview(db) -> dict:
    """Der letzte Lauf mit allen Prüfungen, dazu sieben Tage Verlauf je Tag."""
    latest = await db.ops_check_runs.find_one({}, {"_id": 0}, sort=[("at", -1)])
    since = (now_utc() - timedelta(days=HISTORY_DAYS)).isoformat()
    rows = await db.ops_check_runs.find(
        {"at": {"$gte": since}}, {"_id": 0, "at": 1, "status": 1, "failing": 1}
    ).sort("at", -1).to_list(HISTORY_DAYS * 24 * 60 // CHECK_INTERVAL_MINUTES + 10)
    days: dict[str, dict] = {}
    for row in rows:
        bucket = days.setdefault(_day(row.get("at", "")), {"day": _day(row.get("at", "")), "runs": 0, "warn": 0, "crit": 0})
        bucket["runs"] += 1
        if row.get("status") == "crit":
            bucket["crit"] += 1
        elif row.get("status") == "warn":
            bucket["warn"] += 1
    history = sorted(days.values(), key=lambda item: item["day"])
    recent_bad = [row for row in rows if row.get("status") != "ok"][:20]
    if latest:
        latest.pop("expires_at", None)
    return {"latest": latest, "history": history, "recent_bad": recent_bad, "interval_minutes": CHECK_INTERVAL_MINUTES, "history_days": HISTORY_DAYS}


async def latest_checks_summary(db) -> dict | None:
    """Für die Tageszentrale: nur Ampel, Zähler und Zeitpunkt."""
    latest = await db.ops_check_runs.find_one({}, {"_id": 0, "at": 1, "status": 1, "counts": 1, "failing": 1}, sort=[("at", -1)])
    if not latest:
        return None
    return {"at": latest.get("at"), "status": latest.get("status"), "counts": latest.get("counts") or {}, "failing": latest.get("failing") or []}
