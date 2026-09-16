"""Alarme für den Betrieb (#265): rote Auto-Checks und neue 5xx-Fehlergruppen
gehen per Discord-Webhook raus - gedrosselt auf eine Meldung je Schlüssel
und Stunde, damit ein Dauerfehler nicht den Kanal flutet.

Der Webhook ist derselbe wie für News und Turniere (Admin → Einstellungen →
Discord). Ist er nicht eingerichtet, passiert nichts; ``send_discord``
schreibt das ins Log.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from models import now_utc

logger = logging.getLogger(__name__)

ALERT_WINDOW_SECONDS = 3600
RED = 0xFF3B30


def alert_due(last_sent_at: str | None, now: datetime | None = None, window_seconds: int = ALERT_WINDOW_SECONDS) -> bool:
    """Darf zu diesem Schlüssel wieder eine Meldung raus?"""
    if not last_sent_at:
        return True
    try:
        last = datetime.fromisoformat(str(last_sent_at).replace("Z", "+00:00"))
    except ValueError:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    current = now or now_utc()
    return current - last >= timedelta(seconds=window_seconds)


async def claim_alert(db, key: str, now: datetime | None = None) -> bool:
    """Reserviert den Schlüssel für diese Stunde; False, wenn schon gemeldet."""
    current = now or now_utc()
    state = await db.ops_alert_state.find_one({"key": key}, {"_id": 0, "last_sent_at": 1})
    if state and not alert_due(state.get("last_sent_at"), current):
        return False
    await db.ops_alert_state.update_one({"key": key}, {"$set": {"key": key, "last_sent_at": current.isoformat()}}, upsert=True)
    return True


async def _send(title: str, description: str, fields: list[dict], event_key: str) -> bool:
    from discord_service import send_discord

    outcome = await send_discord(title, description, color=RED, url="/admin/ops", fields=fields, event_key=event_key)
    return bool(outcome.get("ok"))


async def alert_red_checks(db, run: dict) -> list[str]:
    """Je roter Prüfung höchstens eine Meldung pro Stunde. Gibt die gemeldeten Schlüssel zurück."""
    sent: list[str] = []
    for check in run.get("checks") or []:
        if check.get("status") != "crit":
            continue
        key = f"check:{check.get('key')}"
        if not await claim_alert(db, key):
            continue
        try:
            await _send(
                f"Betrieb: {check.get('label')} ist rot",
                f"{check.get('value') or ''}\n{check.get('detail') or ''}".strip(),
                [{"name": "Prüfung", "value": check.get("key") or "-", "inline": True}, {"name": "Lauf", "value": run.get("at") or "-", "inline": True}],
                "ops_check",
            )
            sent.append(key)
        except Exception:  # noqa: BLE001 - ein Alarm darf den Lauf nicht abbrechen
            logger.warning("[ops] alert for %s failed", key, exc_info=True)
    return sent


async def alert_error_group(db, group: dict) -> bool:
    """Eine neue Fehlergruppe mit 5xx - einmal pro Gruppe und Stunde."""
    if int(group.get("status_code") or 0) < 500:
        return False
    key = f"error:{group.get('fingerprint')}"
    if not await claim_alert(db, key):
        return False
    try:
        return await _send(
            f"Serverfehler: {group.get('error_type') or 'Fehler'} auf {group.get('method') or ''} {group.get('route') or ''}".strip(),
            (group.get("message") or "")[:1000],
            [{"name": "HTTP", "value": str(group.get("status_code") or ""), "inline": True}, {"name": "Zähler", "value": str(group.get("count") or 1), "inline": True}],
            "ops_error",
        )
    except Exception:  # noqa: BLE001
        logger.warning("[ops] error alert for %s failed", key, exc_info=True)
        return False


def schedule_error_alert(db, group: dict) -> None:
    """Aus dem Anfrage-Pfad heraus: nicht warten, nur anstoßen."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(alert_error_group(db, group))
    task.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
