"""Alarme für den Betrieb (#265, #517): rote Auto-Checks, neue 5xx-Fehlergruppen, nicht zustellbare
Mails, abgebrochene Hintergrundjobs, ein roter Dolibarr-Abgleich, ein Bot, der nicht mehr verbindet,
und kritische App-Fehler gehen als Meldung raus - per Discord-Webhook (Betriebs-Webhook) und, wenn
gewünscht, per E-Mail an den Vorstand. Je Ereignisart legt der Admin unter Betrieb → Alarme fest,
welche Wege gelten; eine Sperrfrist je Schlüssel verhindert, dass ein Dauerfehler den Kanal flutet.

Der Betrieb hat seinen eigenen Webhook (Admin → Verbindungen → Discord → Betriebs-Webhook) - der
Community-Kanal mit News, Turnieren und Erfolgen bekommt nie einen Alarm. Ist kein Weg eingerichtet,
passiert nichts; ``send_ops_discord`` schreibt das ins Log.
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
from datetime import datetime, timedelta, timezone

from models import new_id, now_utc

logger = logging.getLogger(__name__)

ALERT_WINDOW_SECONDS = 3600
RED = 0xFF3B30
SETTINGS_ID = "ops_alerts"
LOG_LIMIT = 200

# Ereignisarten mit Vorgabe: Discord an, E-Mail aus. `email_allowed` False, wo eine Mail-Meldung sich
# selbst nicht zustellen könnte (Mailversand kaputt).
ALERT_KINDS = {
    "check_red": {"label": "Auto-Check rot", "hint": "Eine der Prüfungen (Datenbank, Speicher, Mail-Queue, Twitch, Dolibarr, Fehlergruppen) steht auf rot."},
    "error_group": {"label": "Serverfehler (5xx)", "hint": "Eine neue Gruppe unbehandelter Serverfehler oder Antworten mit Status 5xx."},
    "mail_failed": {"label": "Mail nicht zustellbar", "hint": "Eine Mail ist nach allen Versuchen endgültig fehlgeschlagen.", "email_allowed": False},
    "job_failed": {"label": "Hintergrundjob abgebrochen", "hint": "Ein Job des Schedulers (Abgleich, Erinnerungen, Versand …) ist mit einem Fehler abgebrochen."},
    "dolibarr_sync_failed": {"label": "Dolibarr-Abgleich rot", "hint": "Der Abgleich mit der Mitgliederverwaltung ist fehlgeschlagen (nicht erreichbar, Schlüssel, Antwort)."},
    "discord_bot_offline": {"label": "Discord-Bot offline", "hint": "Der Bot ist eingeschaltet, kommt aber nicht mehr auf den Server (Token, Intent, Netz)."},
    "client_log_critical": {"label": "App: kritischer Fehler", "hint": "Die LionsAPP hat einen kritischen Fehler gemeldet (Absturz, Login, Push)."},
}

DEFAULT_RULES = {kind: {"discord": True, "email": False} for kind in ALERT_KINDS}
DEFAULT_RETENTION = {"email_logs": 90, "audit_logs": 730}
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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


async def claim_alert(db, key: str, now: datetime | None = None, window_seconds: int = ALERT_WINDOW_SECONDS) -> bool:
    """Reserviert den Schlüssel für die Sperrfrist; False, wenn schon gemeldet."""
    current = now or now_utc()
    state = await db.ops_alert_state.find_one({"key": key}, {"_id": 0, "last_sent_at": 1})
    if state and not alert_due(state.get("last_sent_at"), current, window_seconds):
        return False
    await db.ops_alert_state.update_one({"key": key}, {"$set": {"key": key, "last_sent_at": current.isoformat()}}, upsert=True)
    return True


# ---------------------------------------------------------------- Einstellungen (Betrieb → Alarme)

def _clean_emails(values) -> list[str]:
    if isinstance(values, str):
        values = re.split(r"[,;\s]+", values)
    out: list[str] = []
    for value in values or []:
        email = str(value or "").strip().lower()
        if email and email not in out:
            if not EMAIL_PATTERN.match(email):
                raise ValueError(f"„{email}“ ist keine E-Mail-Adresse.")
            out.append(email)
    return out[:10]


def merge_settings(stored: dict | None) -> dict:
    """Gespeicherte Werte mit den Vorgaben - so, wie die Seite sie zeigt."""
    stored = stored or {}
    rules = {}
    for kind, spec in ALERT_KINDS.items():
        row = {**DEFAULT_RULES[kind], **{k: bool(v) for k, v in (stored.get("rules") or {}).get(kind, {}).items() if k in ("discord", "email")}}
        if spec.get("email_allowed") is False:
            row["email"] = False
        rules[kind] = row
    retention = {**DEFAULT_RETENTION, **{k: int(v) for k, v in (stored.get("retention_days") or {}).items() if k in DEFAULT_RETENTION}}
    return {
        "emails": list(stored.get("emails") or []),
        "cooldown_minutes": int(stored.get("cooldown_minutes") or ALERT_WINDOW_SECONDS // 60),
        "rules": rules,
        "retention_days": retention,
    }


async def load_alert_settings(db) -> dict:
    return merge_settings(await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}))


async def save_alert_settings(db, patch: dict) -> dict:
    """Nur die gesendeten Teile ändern sich; ungültige Werte lehnen mit ValueError ab."""
    current = await load_alert_settings(db)
    update: dict = {}
    if "emails" in patch:
        update["emails"] = _clean_emails(patch["emails"])
    if "cooldown_minutes" in patch:
        minutes = int(patch["cooldown_minutes"] or 0)
        if not 5 <= minutes <= 1440:
            raise ValueError("Die Sperrfrist liegt zwischen 5 Minuten und einem Tag.")
        update["cooldown_minutes"] = minutes
    if "rules" in patch:
        rules = dict(current["rules"])
        for kind, row in (patch["rules"] or {}).items():
            if kind not in ALERT_KINDS:
                raise ValueError(f"Unbekannte Ereignisart: {kind}")
            rules[kind] = {**rules[kind], **{k: bool(v) for k, v in (row or {}).items() if k in ("discord", "email")}}
            if ALERT_KINDS[kind].get("email_allowed") is False:
                rules[kind]["email"] = False
        update["rules"] = rules
    if "retention_days" in patch:
        retention = dict(current["retention_days"])
        for source, days in (patch["retention_days"] or {}).items():
            if source not in DEFAULT_RETENTION:
                raise ValueError(f"Unbekannte Quelle: {source}")
            days = int(days or 0)
            if not 7 <= days <= 3650:
                raise ValueError("Die Aufbewahrung liegt zwischen 7 Tagen und zehn Jahren.")
            retention[source] = days
        update["retention_days"] = retention
    if update:
        update["updated_at"] = now_utc().isoformat()
        await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {"id": SETTINGS_ID, **update}}, upsert=True)
    return await load_alert_settings(db)


# ---------------------------------------------------------------- Melden

async def _send(title: str, description: str, fields: list[dict], event_key: str) -> bool:
    from discord_service import send_ops_discord

    outcome = await send_ops_discord(title, description, color=RED, url="/admin/ops", fields=fields, event_key=event_key)
    return bool(outcome.get("ok"))


def _mail_html(title: str, description: str, fields: list[dict]) -> str:
    rows = "".join(f"<li><strong>{html.escape(str(f.get('name') or ''))}:</strong> {html.escape(str(f.get('value') or ''))}</li>" for f in fields or [])
    body = html.escape(description or "").replace("\n", "<br>")
    return (f"<h2 style=\"font-family:sans-serif\">{html.escape(title)}</h2><p style=\"font-family:sans-serif\">{body}</p>"
            f"{('<ul style=' + chr(34) + 'font-family:sans-serif' + chr(34) + '>' + rows + '</ul>') if rows else ''}"
            "<p style=\"font-family:sans-serif;color:#666\">Betrieb & Logs im Admin: /admin/ops – dort lassen sich die Alarme einstellen.</p>")


async def notify(db, kind: str, title: str, description: str = "", fields: list[dict] | None = None, *, key: str | None = None,
                 force: bool = False, event_key: str | None = None) -> dict:
    """Ein Ereignis melden - nach den Regeln unter Betrieb → Alarme, mit Sperrfrist je Schlüssel.
    Liefert, welche Wege gegangen sind. Nie eine Ausnahme nach außen: ein Alarm darf nichts abbrechen."""
    spec = ALERT_KINDS.get(kind)
    settings = await load_alert_settings(db)
    rule = settings["rules"].get(kind, {"discord": True, "email": False}) if spec else {"discord": True, "email": bool(settings["emails"])}
    channels: list[str] = []
    alert_key = key or f"{kind}"
    if not force and not await claim_alert(db, alert_key, window_seconds=settings["cooldown_minutes"] * 60):
        return {"sent": False, "channels": [], "reason": "cooldown"}
    fields = fields or []
    if rule.get("discord"):
        try:
            if await _send(title, description, fields, event_key or f"ops_{kind}"):
                channels.append("discord")
        except Exception:  # noqa: BLE001 - ein Alarm darf nichts abbrechen
            logger.warning("[ops] Discord-Alarm %s fehlgeschlagen", alert_key, exc_info=True)
    if rule.get("email") and settings["emails"] and (spec is None or spec.get("email_allowed") is not False):
        try:
            from services.mail_queue import enqueue_mail

            for address in settings["emails"]:
                await enqueue_mail(address, f"[Betrieb] {title}"[:180], _mail_html(title, description, fields), template_key="ops_alert",
                                   meta={"kind": kind, "key": alert_key})
            channels.append("email")
        except Exception:  # noqa: BLE001
            logger.warning("[ops] E-Mail-Alarm %s fehlgeschlagen", alert_key, exc_info=True)
    await db.ops_alert_log.insert_one({
        "id": new_id(), "kind": kind, "key": alert_key, "title": title[:200], "description": (description or "")[:500],
        "channels": channels, "at": now_utc().isoformat(),
    })
    return {"sent": bool(channels), "channels": channels}


def schedule_notify(db, kind: str, title: str, description: str = "", fields: list[dict] | None = None, *, key: str | None = None) -> None:
    """Aus einem Anfrage-Pfad oder Job heraus: nicht warten, nur anstoßen."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(notify(db, kind, title, description, fields, key=key))
    task.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)


async def recent_alerts(db, limit: int = 30) -> list[dict]:
    return await db.ops_alert_log.find({}, {"_id": 0}).sort("at", -1).to_list(max(1, min(int(limit), LOG_LIMIT)))


async def send_test_alert(db) -> dict:
    """„Testalarm“ auf der Seite: geht alle Wege, die irgendeine Regel nutzt - ohne Sperrfrist."""
    settings = await load_alert_settings(db)
    any_discord = any(rule.get("discord") for rule in settings["rules"].values())
    any_email = any(rule.get("email") for rule in settings["rules"].values()) and bool(settings["emails"])
    channels: list[str] = []
    fields = [{"name": "Zeit", "value": now_utc().strftime("%d.%m.%Y %H:%M UTC"), "inline": True}]
    if any_discord:
        try:
            if await _send("Testalarm aus Betrieb → Alarme", "Wenn diese Meldung ankommt, passt der Betriebs-Webhook.", fields, "ops_test"):
                channels.append("discord")
        except Exception:  # noqa: BLE001
            logger.warning("[ops] Test-Alarm Discord fehlgeschlagen", exc_info=True)
    if any_email:
        from services.mail_queue import enqueue_mail

        for address in settings["emails"]:
            await enqueue_mail(address, "[Betrieb] Testalarm", _mail_html("Testalarm aus Betrieb → Alarme", "Wenn diese Mail ankommt, passen Adresse und Versand.", fields),
                               template_key="ops_alert", meta={"kind": "test"})
        channels.append("email")
    await db.ops_alert_log.insert_one({"id": new_id(), "kind": "test", "key": "test", "title": "Testalarm", "description": "", "channels": channels, "at": now_utc().isoformat()})
    return {"sent": bool(channels), "channels": channels, "emails": settings["emails"] if any_email else []}


# ---------------------------------------------------------------- Bestehende Anlässe (#265)

async def alert_red_checks(db, run: dict) -> list[str]:
    """Je roter Prüfung höchstens eine Meldung je Sperrfrist. Gibt die gemeldeten Schlüssel zurück."""
    sent: list[str] = []
    for check in run.get("checks") or []:
        if check.get("status") != "crit":
            continue
        key = f"check:{check.get('key')}"
        outcome = await notify(
            db, "check_red", f"Betrieb: {check.get('label')} ist rot",
            f"{check.get('value') or ''}\n{check.get('detail') or ''}".strip(),
            [{"name": "Prüfung", "value": check.get("key") or "-", "inline": True}, {"name": "Lauf", "value": run.get("at") or "-", "inline": True}],
            key=key, event_key="ops_check",
        )
        if outcome.get("sent"):
            sent.append(key)
    return sent


async def alert_error_group(db, group: dict) -> bool:
    """Eine neue Fehlergruppe mit 5xx - einmal pro Gruppe und Sperrfrist."""
    if int(group.get("status_code") or 0) < 500:
        return False
    outcome = await notify(
        db, "error_group",
        f"Serverfehler: {group.get('error_type') or 'Fehler'} auf {group.get('method') or ''} {group.get('route') or ''}".strip(),
        (group.get("message") or "")[:1000],
        [{"name": "HTTP", "value": str(group.get("status_code") or ""), "inline": True}, {"name": "Zähler", "value": str(group.get("count") or 1), "inline": True}],
        key=f"error:{group.get('fingerprint')}", event_key="ops_error",
    )
    return bool(outcome.get("sent"))


def schedule_error_alert(db, group: dict) -> None:
    """Aus dem Anfrage-Pfad heraus: nicht warten, nur anstoßen."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(alert_error_group(db, group))
    task.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)


# ---------------------------------------------------------------- Aufbewahrung

async def purge_old_logs(db, *, now: datetime | None = None) -> dict:
    """Versandlogs und Adminaktionen nach der eingestellten Frist löschen; die übrigen Quellen räumt die
    Datenbank selbst (Ablaufdatum an App-Logs, Fehlergruppen, Vitals, Upload-Ereignissen)."""
    settings = await load_alert_settings(db)
    current = now or now_utc()
    removed = {}
    for source in ("email_logs", "audit_logs"):
        cutoff = (current - timedelta(days=settings["retention_days"][source])).isoformat()
        result = await getattr(db, source).delete_many({"created_at": {"$lt": cutoff}})
        removed[source] = int(getattr(result, "deleted_count", 0) or 0)
    old_alerts = (current - timedelta(days=365)).isoformat()
    await db.ops_alert_log.delete_many({"at": {"$lt": old_alerts}})
    return removed
