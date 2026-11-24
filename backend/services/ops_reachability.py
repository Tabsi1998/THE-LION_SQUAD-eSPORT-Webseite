"""Erreichbarkeit (#1657): Website, API und Datenbank im Minutentakt prüfen, Ausfall und Wiederkehr melden und daraus
die öffentliche Statusseite speisen („Alles läuft“ / „Störung, wir sind dran“).

- Ein Ziel gilt als **ausgefallen** nach ``reach_fail_threshold`` Fehlversuchen in Folge (Vorgabe 2, unter Betrieb →
  Alarme), als **wieder da** nach dem ersten Erfolg. Jeder Wechsel meldet sich genau einmal (Ereignisart
  „Erreichbarkeit“); die Wiederkehr nennt, seit wann es weg war, und markiert den Ausfall im Verlauf als behoben.
- Scheitert eine Meldung (etwa weil gerade die Datenbank weg ist), bleibt sie vorgemerkt und geht beim nächsten Lauf
  raus. Ist gar kein Weg eingerichtet, steht sie einmal im Verlauf - die Statusseite schaltet trotzdem.
- Adressen kommen nur aus der Umgebung (``OPS_REACH_WEB_URL``, ``OPS_REACH_API_URL``), nie aus der Verwaltung: der
  Server ruft sie selbst auf. Ohne Adresse wird das Ziel nicht geprüft.

**Grenze:** Die Prüfung läuft auf demselben Server. Fällt der ganze Server, der Backend-Prozess oder das Netz aus,
prüft und meldet niemand - das kann nur eine Prüfung von außen (``docs/BETRIEB.md``, „Externe Überwachung“).
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from models import now_utc
from services import ops_alerts

logger = logging.getLogger("tls.ops")

STATE_ID = "ops_reachability"
TARGETS = (("web", "Website"), ("api", "API"), ("database", "Datenbank"))
PROBE_TIMEOUT_SECONDS = 5.0
# So lange darf der letzte Lauf zurückliegen; danach zeigt die Statusseite eine Störung (es prüft ja niemand mehr).
STALE_MINUTES = 15

_memory: dict = {}


def configured_urls() -> dict[str, str]:
    return {"web": os.environ.get("OPS_REACH_WEB_URL", "").strip(), "api": os.environ.get("OPS_REACH_API_URL", "").strip()}


def _http_probe(url: str):
    async def probe() -> bool:
        import httpx

        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS, follow_redirects=False) as client:
            response = await client.get(url, headers={"User-Agent": "tls-ops-reachability"})
        return 200 <= response.status_code < 400

    return probe


def _database_probe(db):
    async def probe() -> bool:
        reply = await db.command("ping")
        return bool(reply) and reply.get("ok") in (1, 1.0, True)

    return probe


def default_probes(db) -> dict:
    urls = configured_urls()
    return {
        "web": _http_probe(urls["web"]) if urls["web"] else None,
        "api": _http_probe(urls["api"]) if urls["api"] else None,
        "database": _database_probe(db),
    }


async def _load_state(db) -> dict | None:
    return await db.settings.find_one({"id": STATE_ID}, {"_id": 0})


def _vienna(value: str | None) -> str:
    return ops_alerts._vienna_time(value) if value else "-"


async def _probe(probe) -> bool:
    try:
        return bool(await asyncio.wait_for(probe(), timeout=PROBE_TIMEOUT_SECONDS + 1))
    except Exception:  # noqa: BLE001 - jede Ausnahme heißt: keine Antwort
        return False


def _next_row(row: dict, ok: bool, stamp: str, threshold: int) -> dict:
    previous = row.get("state")
    if ok:
        if previous == "down":
            return {"state": "up", "since": stamp, "fails": 0, "pending": "up", "down_since": row.get("since")}
        kept = {key: value for key, value in row.items() if key in ("pending", "down_since")}
        return {**kept, "state": "up", "since": row.get("since") if previous == "up" else stamp, "fails": 0}
    fails = int(row.get("fails") or 0) + 1
    out = {**row, "fails": fails, "state": previous if previous in ("up", "down") else "up"}
    if fails == 1:
        out["first_fail_at"] = stamp
    if previous != "down" and fails >= threshold:
        out.update({"state": "down", "since": out.get("first_fail_at") or stamp, "pending": "down"})
        out.pop("down_since", None)
    return out


def _message(key: str, label: str, row: dict, stamp: str) -> dict:
    if row.get("pending") == "down":
        return {"key": f"reach:{key}", "title": f"Betrieb: {label} nicht erreichbar",
                "description": f"Keine Antwort seit {_vienna(row.get('since'))} ({row.get('fails')} Prüfungen in Folge). Die Statusseite zeigt „Störung“.",
                "fields": [{"name": "Ziel", "value": label, "inline": True}]}
    return {"key": f"reach:{key}:back", "title": f"Betrieb: {label} wieder erreichbar",
            "description": f"Wieder da seit {_vienna(row.get('since') or stamp)}. Ausfall seit {_vienna(row.get('down_since'))}.",
            "fields": [{"name": "Ziel", "value": label, "inline": True}]}


async def _announce(db, key: str, label: str, row: dict, stamp: str) -> None:
    """Die vorgemerkte Meldung senden. Gesendet oder kein Weg eingerichtet: erledigt. Gescheitert: bleibt vorgemerkt."""
    message = _message(key, label, row, stamp)
    try:
        outcome = await ops_alerts.notify(db, "reachability", message["title"], message["description"], message["fields"],
                                          key=message["key"], force=True, event_key="ops_reachability",
                                          log_gate=lambda alert_key=message["key"]: ops_alerts.claim_failure_log(db, alert_key))
    except Exception:  # noqa: BLE001 - der nächste Lauf versucht es erneut
        logger.warning("[ops] Erreichbarkeit %s nicht gemeldet", key, exc_info=True)
        return
    if not (outcome.get("sent") or outcome.get("reason") == "undeliverable"):
        return
    was = row.pop("pending", None)
    if was == "up":
        row.pop("down_since", None)
        try:
            await db.ops_alert_log.update_many({"key": {"$in": [f"reach:{key}", f"reach:{key}:back"]}, "resolved_at": None},
                                               {"$set": {"resolved_at": now_utc().isoformat()}})
        except Exception:  # noqa: BLE001
            logger.debug("[ops] Ausfall %s nicht als behoben markiert", key)


async def run_reachability(db, probes: dict | None = None, now: datetime | None = None) -> dict:
    """Ein Lauf: alle Ziele prüfen, Wechsel merken und melden, den Stand speichern. Ohne Datenbank gilt der Stand im
    Speicher weiter - die Meldung über den Datenbank-Ausfall geht dann raus, sobald sie wieder erreichbar ist."""
    current = now or now_utc()
    stamp = current.isoformat()
    try:
        settings = await ops_alerts.load_alert_settings(db)
    except Exception:  # noqa: BLE001
        settings = ops_alerts.merge_settings(None)
    threshold = int(settings["reach_fail_threshold"])
    remembered = _memory.get("state") or {}
    try:
        stored = await _load_state(db) or {}
    except Exception:  # noqa: BLE001 - nur wenn das Lesen scheitert, gilt der Stand im Speicher
        stored = remembered
    # Konnte ein Lauf nicht speichern (Datenbank weg), ist der Stand im Speicher neuer - er trägt den Ausfall weiter.
    if str(remembered.get("checked_at") or "") > str(stored.get("checked_at") or ""):
        stored = remembered
    targets = dict(stored.get("targets") or {})
    checks = probes if probes is not None else default_probes(db)
    for key, _label in TARGETS:
        probe = checks.get(key)
        if probe is None:
            targets[key] = {"state": "unchecked"}
            continue
        before = targets.get(key) or {}
        row = _next_row(dict(before), await _probe(probe), stamp, threshold)
        if row.get("state") != before.get("state") and row.get("pending"):
            try:
                # Neuer Wechsel: ein gescheiterter Versand darf wieder einmal in den Verlauf.
                await db.ops_alert_state.update_many({"key": {"$in": [f"reach:{key}", f"reach:{key}:back"]}}, {"$unset": {"undeliverable_logged": ""}})
            except Exception:  # noqa: BLE001
                pass
        targets[key] = row
    for key, label in TARGETS:
        if targets[key].get("pending"):
            await _announce(db, key, label, targets[key], stamp)
    overall = "disturbance" if any(row.get("state") == "down" for row in targets.values()) else "ok"
    state = {"id": STATE_ID, "targets": targets, "overall": overall, "checked_at": stamp}
    _memory["state"] = state
    try:
        await _save_state(db, state)
    except Exception:  # noqa: BLE001
        logger.warning("[ops] Stand der Erreichbarkeit nicht gespeichert")
    return state


async def _save_state(db, state: dict) -> None:
    await db.settings.update_one({"id": STATE_ID}, {"$set": state}, upsert=True)


def _stale(checked_at: str | None, now: datetime) -> bool:
    if not checked_at:
        return True
    try:
        moment = datetime.fromisoformat(str(checked_at).replace("Z", "+00:00"))
    except ValueError:
        return True
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return now - moment > timedelta(minutes=STALE_MINUTES)


async def public_status(db, now: datetime | None = None) -> dict:
    """Für ``/status``: nur der Zustand und wann zuletzt geprüft wurde. Nie geprüft (frische Installation, Prüfung aus):
    „ok“. Unlesbar oder veraltet: „disturbance“ - dann stimmt etwas nicht."""
    try:
        doc = await _load_state(db)
    except Exception:  # noqa: BLE001
        return {"state": "disturbance", "checked_at": None}
    if not doc:
        return {"state": "ok", "checked_at": None}
    checked_at = doc.get("checked_at")
    if _stale(checked_at, now or now_utc()):
        return {"state": "disturbance", "checked_at": checked_at}
    return {"state": "disturbance" if doc.get("overall") == "disturbance" else "ok", "checked_at": checked_at}
