"""Auto-Checks für den Betrieb (#265).

Alle fünf Minuten prüft der Scheduler, was im Betrieb still kaputtgehen
kann: Datenbank-Latenz, freier Speicher, Upload-Volume, Mail-Queue,
Änderungsstrom, fehlende Bildvarianten, offene Fehlergruppen, Scheduler,
eindeutige Indizes (#1043) und die Nacharbeit gescheiterter Dateilöschungen (#1046).
Jede Prüfung ergibt eine Ampel (ok, warn, crit) mit einem Wert und einem
Satz; ein Lauf wird sieben Tage aufgehoben. Die Tageszentrale zeigt die
schlechteste Ampel, Admin → Betrieb → Checks die Einzelheiten.

Die Bewertung ist von der Messung getrennt (``rate_*``), damit Tests die
Schwellen prüfen können, ohne eine Platte vollzuschreiben.
"""
from __future__ import annotations

import asyncio
import ipaddress
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
DOLIBARR_STALE_MINUTES = 60.0
VARIANTS_WARN_MISSING = 50
VARIANT_SCAN_LIMIT = 5000
UPLOAD_SCAN_LIMIT = 200_000
# Besucher-Adresse (#941): unter so vielen Sitzungen am Tag sagt eine gemeinsame Adresse nichts.
CLIENT_IP_MIN_SESSIONS = 5
# Die Netze von Cloudflare (cloudflare.com/ips, Stand Oktober 2026) - eine Sitzung von dort ist der Proxy, kein Besucher.
CLOUDFLARE_NETS = tuple(ipaddress.ip_network(net) for net in (
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
    "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
))


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


def rate_dolibarr(mode: str, state: dict | None, age_minutes: float | None) -> str:
    # Aus ist kein Alarm. Live ohne frischen Stand heißt: Mitgliedschaften und
    # Vereinsrechte laufen auf altem Wissen - nach 48 h ruhen die Rechte ganz.
    if mode == "off" or not state:
        return "ok"
    if not state.get("ok"):
        return "crit" if mode == "live" and (age_minutes is None or age_minutes > 24 * 60) else "warn"
    if age_minutes is None or age_minutes > DOLIBARR_STALE_MINUTES:
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


def rate_client_ip(sessions: int, addresses: int, proxied: int) -> str:
    """Gelb, wenn der Server statt der Besucher den Proxy sieht (#941): alle Sitzungen eines Tages von einer einzigen
    Adresse oder ausschließlich aus privaten Netzen bzw. denen von Cloudflare. Dann gilt jede Bremse je Adresse
    (Registrierung, Passwort vergessen, Zwei-Faktor) für alle gemeinsam."""
    sessions = int(sessions or 0)
    if sessions < CLIENT_IP_MIN_SESSIONS:
        return "ok"
    if int(addresses or 0) <= 1 or int(proxied or 0) >= sessions:
        return "warn"
    return "ok"


def behind_proxy(address: str | None) -> bool:
    """Eine Adresse, die kein Besucher hat: privat (Proxy im eigenen Netz, Docker) oder aus den Netzen von Cloudflare."""
    try:
        ip = ipaddress.ip_address(str(address or "").strip())
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or any(ip.version == net.version and ip in net for net in CLOUDFLARE_NETS)


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


async def check_dolibarr_sync(db) -> dict:
    label = "Dolibarr-Abgleich"
    try:
        settings = await db.settings.find_one({"id": "dolibarr"}, {"_id": 0, "mode": 1}) or {}
        state = await db.settings.find_one({"id": "dolibarr_sync_state"}, {"_id": 0}) or {}
    except Exception as exc:  # noqa: BLE001
        return failed("dolibarr_sync", label, exc)
    mode = settings.get("mode") or "off"
    if mode == "off":
        return result("dolibarr_sync", label, "ok", "aus", "die Mitgliederverwaltung ist nicht angebunden")
    if not state:
        return result("dolibarr_sync", label, "ok", "noch kein Lauf", "der Abgleich läuft alle 10 min")
    ok_hours = _hours_since(state.get("last_ok_at"))
    age_minutes = None if ok_hours is None else ok_hours * 60
    status = rate_dolibarr(mode, state, age_minutes)
    where = "Vorschau" if mode == "preview" else "Live"
    if not state.get("ok"):
        error = state.get("last_error") or {}
        since = f", letzter Erfolg vor {ok_hours:.1f} h" if ok_hours is not None else ", noch nie gelungen"
        return result("dolibarr_sync", label, status, "liefert nichts", f"{error.get('text') or 'Fehler'}{since} – Admin → Dolibarr")
    if status == "warn":
        return result("dolibarr_sync", label, status, f"steht seit {age_minutes:.0f} min" if age_minutes is not None else "steht", "der letzte gelungene Lauf ist zu lange her")
    counts = state.get("counts") or {}
    return result("dolibarr_sync", label, status, f"{where}: {counts.get('seen', 0)} gelesen, {counts.get('applied', 0)} übernommen", "letzter Lauf in Ordnung")


async def check_dolibarr_webhook(db) -> dict:
    """Signierte Webhooks (#1540): gelb, solange der ältere Webhook-Weg noch angenommen wird."""
    from services import vereine_webhooks
    from services.secret_store import secret_is_configured

    label = "Dolibarr-Webhook"
    try:
        settings = await db.settings.find_one({"id": "dolibarr"}, {"_id": 0}) or {}
    except Exception as exc:  # noqa: BLE001
        return failed("dolibarr_webhook", label, exc)
    if (settings.get("mode") or "off") == "off":
        return result("dolibarr_webhook", label, "ok", "aus", "die Mitgliederverwaltung ist nicht angebunden")
    signed = vereine_webhooks.secret_source(settings) is not None
    if vereine_webhooks.legacy_enabled(settings) and secret_is_configured(settings.get("webhook_token")):
        step = "den alten Weg" if signed else "im Vereinsmodul den signierten Webhook einrichten, dann den alten Weg"
        return result("dolibarr_webhook", label, "warn", "alter Webhook-Weg aktiv",
                      f"Auf signierte Webhooks umstellen: {step} unter Admin → Dolibarr → Funktionen abschalten")
    if signed:
        return result("dolibarr_webhook", label, "ok", "signiert", "Hinweise aus dem Vereinsmodul werden geprüft angenommen")
    return result("dolibarr_webhook", label, "ok", "noch nicht eingerichtet", "ohne Webhook holt der Abgleich alle 10 min auf")


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
        from services.scheduler_state import get_scheduler_status

        status = get_scheduler_status()
    except Exception as exc:  # noqa: BLE001
        return failed("scheduler", label, exc)
    running = bool(status.get("running"))
    jobs = len(status.get("jobs") or [])
    return result("scheduler", label, "ok" if running else "crit", f"{jobs} Jobs" if running else "steht", "läuft" if running else "kein Scheduler aktiv")


async def check_image_reading() -> dict:
    """Bild-Erkennung für Ergebnis- und Tabellen-Bilder (#1756, #2018): Tesseract und der zweite Leser. Fehlt der zweite
    Leser, liest der Server weiter, aber Namen und Teams sind dann nur mit bekannten Teilnehmern grün - eine Warnung.
    Geprüft wird, ohne das Modell zu laden."""
    label = "Bild-Erkennung"
    try:
        from services import result_image_ocr, result_image_second

        tesseract = await asyncio.to_thread(result_image_ocr.available)
        second = result_image_second.presence()
    except Exception as exc:  # noqa: BLE001
        return failed("image_reading", label, exc)
    if not tesseract:
        return result("image_reading", label, "warn", "Tesseract fehlt",
                      "Ergebnis- und Tabellen-Bilder lassen sich nicht lesen - Backend-Image prüfen (backend/Dockerfile).")
    if second["status"] == "ok":
        return result("image_reading", label, "ok", f"Tesseract und zweiter Leser ({second['model']})",
                      "Namen und Teams lesen zwei Leser")
    if second["status"] == "off":
        return result("image_reading", label, "ok", "zweiter Leser abgeschaltet",
                      "RESULT_IMAGE_SECOND_READER=off - Namen und Teams sind nur mit bekannten Teilnehmern grün")
    return result("image_reading", label, "warn", f"zweiter Leser fehlt ({second['reason']})",
                  "Bilder werden weiter gelesen, aber Namen und Teams sind nur mit bekannten Teilnehmern grün. Das "
                  "Backend-Image neu bauen - backend/Dockerfile lädt das Modell (docs/BETRIEB.md, „Bild-Erkennung“).")


async def check_client_ip(db) -> dict:
    label = "Besucher-Adresse"
    try:
        since = now_utc() - timedelta(hours=24)
        rows = await db.auth_sessions.find({"last_active": {"$gte": since}}, {"_id": 0, "ip": 1}).to_list(5000)
    except Exception as exc:  # noqa: BLE001
        return failed("client_ip", label, exc)
    addresses = [str(row["ip"]) for row in rows if row.get("ip")]
    distinct = len(set(addresses))
    status = rate_client_ip(len(addresses), distinct, sum(1 for address in addresses if behind_proxy(address)))
    value = f"{len(addresses)} Sitzungen in 24 h von {distinct} Adressen" if addresses else "keine Sitzung in 24 h"
    if status == "ok":
        return result("client_ip", label, status, value, "Besucher kommen mit ihrer eigenen Adresse an")
    return result("client_ip", label, status, value,
                  "Der Server sieht den Proxy statt der Besucher - jede Bremse je Adresse gilt dann für alle gemeinsam. "
                  "TRUSTED_PROXY_CIDRS in der Server-.env prüfen, hinter Cloudflare zusätzlich den Proxy (docs/BETRIEB.md, "
                  "„Besucher-Adresse“). Kein Fehler, wenn an dem Tag wirklich alle im selben Netz waren, etwa am Vereinsabend.")


async def check_unique_indexes(db) -> dict:
    """Eindeutige Indizes, die beim Start an Altdubletten gescheitert sind (#930, #1043). Statt ihrer steht ein
    gewöhnlicher Index; „einmal je …“ ist dann wieder nur im Code geprüft. Bereinigt wird nur mit dem Werkzeug."""
    label = "Eindeutige Indizes"
    try:
        from database import AUDIT_UNIQUE_INDEXES, blocked_unique_indexes

        blocked = await blocked_unique_indexes(db)
    except Exception as exc:  # noqa: BLE001
        return failed("unique_indexes", label, exc)
    total = len(AUDIT_UNIQUE_INDEXES)
    if not blocked:
        return result("unique_indexes", label, "ok", f"{total} von {total} aktiv", "Doppelte Zeilen sind ausgeschlossen")
    return result("unique_indexes", label, "warn", f"{len(blocked)} von {total} nicht eindeutig",
                  f"{', '.join(blocked)}. Erst Trockenlauf: docker compose exec backend python scripts/unique_index_duplicates.py "
                  "- dann bewusst bereinigen (docs/BETRIEB.md, „Altdubletten“). Gelöscht wird nie automatisch.")


async def check_file_cleanups(db) -> dict:
    """Dateien, deren Löschung scheiterte (Kontolöschung, Mediathek; #1046). Offen heißt: der Aufräum-Job versucht es
    noch; aufgegeben heißt: nach der Grenze braucht es jemanden am Server."""
    label = "Datei-Nacharbeit"
    try:
        from services.account_erasure import RETRY_LIMIT, file_cleanup_counts

        counts = await file_cleanup_counts(db)
    except Exception as exc:  # noqa: BLE001
        return failed("file_cleanups", label, exc)
    pending, given_up = counts["pending"], counts["failed"]
    if not pending and not given_up:
        return result("file_cleanups", label, "ok", "nichts offen", "Keine Datei wartet auf ihre Löschung")
    return result("file_cleanups", label, "crit" if given_up else "warn", f"{pending} offen, {given_up} aufgegeben",
                  "Löschung gescheitert (Rechte, Sperre). Der Aufräum-Job versucht es stündlich mit wachsendem Abstand, "
                  f"nach {RETRY_LIMIT} Versuchen gibt er auf. Rechte am Upload-Volume prüfen, dann unten „Erneut versuchen“.")


async def check_shop(db) -> dict:
    """Shop (#1706): Stufe, Notschalter, ob der Printful-Schlüssel hinterlegt und lesbar ist, und die Ursache, wenn der
    letzte Verbindungstest scheiterte. Rot nur, wenn Bestellungen hinausgehen sollen, ohne dass es gehen kann."""
    label = "Shop"
    try:
        from services import shop_config

        config = await shop_config.load(db)
    except Exception as exc:  # noqa: BLE001
        return failed("shop", label, exc)
    state = shop_config.key_state(config)
    sending = config["orders_to_printful"]
    value = " · ".join((shop_config.STAGE_LABELS[shop_config.effective_stage(config)],
                        "Bestellungen an Printful an" if sending else "Notschalter aus",
                        {"ok": "Schlüssel hinterlegt", "missing": "kein Schlüssel",
                         "unreadable": "Schlüssel nicht lesbar"}[state]))
    where = "Verwaltung → Finanzen → Shop"
    if state == "unreadable":
        return result("shop", label, "crit" if sending else "warn", value,
                      f"Printful-Schlüssel {shop_config.UNREADABLE_KEY} – oder neu hinterlegen ({where}).")
    if sending and state == "missing":
        return result("shop", label, "crit", value, f"Bestellungen sollen hinausgehen, aber es fehlt der Schlüssel ({where}).")
    last = config.get("printful_last_test") or {}
    if state == "ok" and last and not last.get("ok"):
        return result("shop", label, "warn", value, f"Letzter Verbindungstest: {last.get('detail') or 'fehlgeschlagen'} ({where})")
    return result("shop", label, "ok", value, where)


async def check_spam_guard(db) -> dict:
    """Spamschutz (#2067): abgefangen heute, Spam-Quote der letzten 7 Tage und die stärkste Stunde der letzten 24
    Stunden. Gelb bei einer Spitze über der Schwelle, bei Turnstile-Ausfällen und bei einem unlesbaren Secret Key."""
    label = "Spamschutz"
    try:
        from services import spam_guard

        config = await spam_guard.load(db)
        stats = await spam_guard.stats_view(db)
    except Exception as exc:  # noqa: BLE001
        return failed("spam_guard", label, exc)
    where = "Verwaltung → Kontakt-Inbox, Einstellungen → Spamschutz"
    quote = stats["quote_week"]
    value = f"{stats['today']['caught']} abgefangen heute · Quote {quote if quote is not None else '–'} % (7 Tage)"
    if not config["enabled"]:
        return result("spam_guard", label, "warn", "aus", f"Der Spamschutz ist ausgeschaltet – nur die Limits wirken ({where}).")
    problems = []
    peak = stats["peak_24h"]
    if peak["count"] >= config["peak_per_hour"]:
        problems.append(f"Spitze: {peak['count']} abgefangen in einer Stunde ({peak['hour']}), Schwelle {config['peak_per_hour']}")
    if stats["turnstile_unavailable_24h"]:
        problems.append(f"Turnstile {stats['turnstile_unavailable_24h']}× nicht erreichbar in 24 h – es wirkten nur die eigenen Stufen")
    if config["turnstile"]["enabled"] and spam_guard.secret_state(config) != "ok":
        problems.append("Turnstile ist an, aber der Secret Key fehlt oder ist nicht lesbar")
    if problems:
        return result("spam_guard", label, "warn", value, "; ".join(problems) + f" ({where}).")
    return result("spam_guard", label, "ok", value, where)


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
        ("dolibarr_sync", "Dolibarr-Abgleich", lambda: check_dolibarr_sync(db)),
        ("dolibarr_webhook", "Dolibarr-Webhook", lambda: check_dolibarr_webhook(db)),
        ("client_ip", "Besucher-Adresse", lambda: check_client_ip(db)),
        ("unique_indexes", "Eindeutige Indizes", lambda: check_unique_indexes(db)),
        ("file_cleanups", "Datei-Nacharbeit", lambda: check_file_cleanups(db)),
        ("image_reading", "Bild-Erkennung", check_image_reading),
        ("shop", "Shop", lambda: check_shop(db)),
        ("spam_guard", "Spamschutz", lambda: check_spam_guard(db)),
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
