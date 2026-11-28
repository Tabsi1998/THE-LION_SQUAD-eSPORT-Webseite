"""Alarme für den Betrieb (#265, #517): rote Auto-Checks, neue 5xx-Fehlergruppen, nicht zustellbare
Mails, abgebrochene Hintergrundjobs, ein roter Dolibarr-Abgleich, ein Bot, der nicht mehr verbindet,
und kritische App-Fehler gehen als Meldung raus - über den Discord-Bot in den Betriebskanal und, wenn
gewünscht, per E-Mail an den Vorstand. Je Ereignisart legt der Admin unter Betrieb → Alarme fest,
welche Wege gelten; eine Sperrfrist je Schlüssel verhindert, dass ein Dauerfehler den Kanal flutet.

Der Betrieb hat seinen eigenen Kanal (Admin → Verbindungen → Discord → Kanäle je Zweck → Betrieb) - der
Community-Kanal mit News und Turnieren bekommt nie einen Alarm. Ist kein Weg eingerichtet oder der Bot
aus, passiert nichts; ``send_ops_discord`` schreibt das ins Log (#566).
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone

from models import new_id, now_utc
from services.log_safe import log_safe
from services.ops_upload_routes import DEFAULT_UPLOAD_ROUTES, clean_upload_routes

logger = logging.getLogger(__name__)

ALERT_WINDOW_SECONDS = 3600
# Dauer-Rot (#2080): ein roter Check erinnert nach so vielen Stunden erneut; 0 = aus. Einstellbar unter Betrieb → Alarme.
DEFAULT_RED_REMINDER_HOURS = 24
MAX_RED_REMINDER_HOURS = 720
RED = 0xFF3B30
SETTINGS_ID = "ops_alerts"
# Zählt jedes Speichern mit - ops_monitor.error_settings verwirft dann seinen Zwischenspeicher (ohne Rückimport).
SETTINGS_VERSION = 0
LOG_LIMIT = 200

# Ereignisarten mit Vorgabe: Discord an, E-Mail aus. `email_allowed` False, wo eine Mail-Meldung sich
# selbst nicht zustellen könnte (Mailversand kaputt).
ALERT_KINDS = {
    "check_red": {"label": "Auto-Check rot", "hint": "Eine der Prüfungen (Datenbank, Speicher, Mail-Queue, Twitch, Dolibarr, Fehlergruppen) wechselt auf rot; bleibt sie rot, erinnert sie nach der eingestellten Frist."},
    "error_group": {"label": "Serverfehler (5xx)", "hint": "Eine neue Gruppe unbehandelter Serverfehler oder Antworten mit Status 5xx."},
    "mail_failed": {"label": "Mail nicht zustellbar", "hint": "Eine Mail ist nach allen Versuchen endgültig fehlgeschlagen.", "email_allowed": False},
    "job_failed": {"label": "Hintergrundjob abgebrochen", "hint": "Ein Job des Schedulers (Abgleich, Erinnerungen, Versand …) ist mit einem Fehler abgebrochen."},
    "dolibarr_sync_failed": {"label": "Dolibarr-Abgleich rot", "hint": "Der Abgleich mit der Mitgliederverwaltung ist fehlgeschlagen (nicht erreichbar, Schlüssel, Antwort)."},
    "discord_bot_offline": {"label": "Discord-Bot offline", "hint": "Der Bot ist eingeschaltet, kommt aber nicht mehr auf den Server (Token, Intent, Netz)."},
    "client_log_critical": {"label": "App: kritischer Fehler", "hint": "Die LionsAPP hat einen kritischen Fehler gemeldet (Absturz, Login, Push)."},
    # Fehler-Sammler (#1657): Häufung einer Fehlergruppe, Tageszusammenfassung, Erreichbarkeit (Ausfall und Wiederkehr).
    "error_spike": {"label": "Häufung von Fehlern", "hint": "Eine Fehlergruppe des Servers tritt im eingestellten Zeitfenster öfter auf als die Schwelle - eine Warnung je Fenster. Häufungen aus Website und App stehen nur in der Tageszusammenfassung."},
    "daily_summary": {"label": "Tageszusammenfassung", "hint": "Einmal am Tag zur eingestellten Stunde: neue und aktive Fehlergruppen der letzten 24 Stunden und Ausfälle. An ruhigen Tagen kommt nichts."},
    "reachability": {"label": "Erreichbarkeit", "hint": "Website, API oder Datenbank antworten nicht mehr - und wenn sie wieder da sind. Schaltet auch die Statusseite um."},
    "tournament_settle_failed": {"label": "Turnierabschluss unvollständig", "hint": "Beim Veröffentlichen der Ergebnisse ist ein Schritt gescheitert (Jahreswertung, Auszeichnungen, Erfolge oder Gewinne) - beim Turnier „Abschluss nachholen“ tippen."},
}

DEFAULT_RULES = {kind: {"discord": True, "email": False} for kind in ALERT_KINDS}
# Kontaktanfragen (#2131): erledigt 12 Monate, Spam 30 Tage - siehe services/contact_retention.py.
# Abgemeldete Push-Geräte (#2467): 30 Tage ab dem Abmelden, dann ist der Eintrag weg.
# Fehlergruppen (#1657): 30 Tage ab dem letzten Auftreten, einstellbar.
DEFAULT_RETENTION = {"email_logs": 90, "audit_logs": 730, "contact_done": 365, "contact_spam": 30, "push_devices": 30, "ops_errors": 30}
# Fehler-Sammler (#1657): Schwellen unter Betrieb → Alarme - Vorgabe, kleinster und größter Wert, Hinweis bei falschem Wert.
NUMBER_SETTINGS = {
    "spike_threshold": (20, 2, 10000, "Die Schwelle für eine Häufung liegt zwischen 2 und 10000 Auftreten."),
    "spike_window_minutes": (10, 1, 1440, "Das Zeitfenster für eine Häufung liegt zwischen 1 Minute und einem Tag."),
    "daily_summary_hour": (8, 0, 23, "Die Stunde der Tageszusammenfassung liegt zwischen 0 und 23."),
    "reach_fail_threshold": (2, 1, 10, "Ein Ausfall gilt nach 1 bis 10 Fehlversuchen in Folge."),
    "reach_recover_threshold": (2, 1, 10, "Wieder erreichbar gilt nach 1 bis 10 Erfolgen in Folge."),
    "client_group_cap": (200, 10, 5000, "Die Obergrenze neuer Fehlergruppen aus Website und App liegt zwischen 10 und 5000 je Tag."),
    "alert_hourly_cap": (10, 1, 100, "Höchstens 1 bis 100 Meldungen je Ereignisart und Stunde."),
}
# Ereignisarten, die Verkehr von außen auslösen kann: höchstens ``alert_hourly_cap`` Meldungen je Stunde, danach genau
# eine Sammelmeldung und Ruhe bis zur nächsten vollen Stunde.
BRAKED_KINDS = frozenset({"error_spike", "error_group", "client_log_critical"})
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


def _readable_stamp(value) -> bool:
    if not isinstance(value, str):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


async def _ensure_state_row(db, key: str) -> None:
    from pymongo.errors import DuplicateKeyError

    try:
        await db.ops_alert_state.update_one({"key": key}, {"$setOnInsert": {"key": key}}, upsert=True)
    except DuplicateKeyError:
        pass  # ein gleichzeitiger Lauf hat die Zeile eben angelegt


async def claim_alert(db, key: str, now: datetime | None = None, window_seconds: int = ALERT_WINDOW_SECONDS) -> dict | None:
    """Reserviert den Schlüssel für die Sperrfrist; None, wenn schon gemeldet. Atomar (#2080, Codex): nur wer das
    bedingte ``find_one_and_update`` gewinnt (``last_sent_at`` fehlt oder liegt vor der Frist, ``retry_after`` ist
    vorbei), sendet - zwei Läufe zugleich melden nie doppelt. Ein unlesbarer ``last_sent_at`` (kein ISO-Text) gilt als
    „nie gesendet“ und wird vorher bedingt entfernt. Zurück kommt der Claim für ``alert_failed``."""
    from pymongo import ReturnDocument

    current = now or now_utc()
    stamp = current.isoformat()
    limit = (current - timedelta(seconds=window_seconds)).isoformat()
    await _ensure_state_row(db, key)
    state = await db.ops_alert_state.find_one({"key": key}, {"_id": 0, "last_sent_at": 1})
    junk = (state or {}).get("last_sent_at")
    if junk is not None and not _readable_stamp(junk):
        await db.ops_alert_state.update_one({"key": key, "last_sent_at": junk}, {"$unset": {"last_sent_at": ""}})
    before = await db.ops_alert_state.find_one_and_update(
        {"key": key, "$and": [
            {"$or": [{"last_sent_at": {"$exists": False}}, {"last_sent_at": None}, {"last_sent_at": {"$lte": limit}}]},
            {"$or": [{"retry_after": {"$exists": False}}, {"retry_after": None}, {"retry_after": {"$lte": stamp}}]},
        ]},
        {"$set": {"last_sent_at": stamp}},
        # ``key`` mit ausgeben: ein Dokument ohne ``last_sent_at`` käme sonst leer zurück und hieße „nicht geholt“.
        projection={"_id": 0, "key": 1, "last_sent_at": 1, "failures": 1}, return_document=ReturnDocument.BEFORE,
    )
    if before is None:
        return None
    return {"key": key, "stamp": stamp, "previous": before.get("last_sent_at"), "failures": int(before.get("failures") or 0),
            "window_seconds": window_seconds}


FAILURE_BACKOFF_SECONDS = 300


async def alert_failed(db, claim: dict | None) -> None:
    """Ein eingerichteter Weg ist gescheitert (#2080, Codex): Die Sperrfrist gilt nicht als verbraucht, der nächste
    Versuch kommt aber erst nach ``retry_after`` - 5 Minuten, dann 10, 20 … bis zur Sperrfrist. So meldet ein Job, der
    jede Minute scheitert, nicht jede Minute. Nur, solange der Claim noch der eigene ist."""
    if not claim:
        return
    delay = min(FAILURE_BACKOFF_SECONDS * (2 ** claim["failures"]), max(int(claim["window_seconds"]), FAILURE_BACKOFF_SECONDS))
    retry_after = (now_utc() + timedelta(seconds=delay)).isoformat()
    previous = claim.get("previous")
    change: dict = {"$set": {"retry_after": retry_after}, "$inc": {"failures": 1}}
    if previous:
        change["$set"]["last_sent_at"] = previous
    else:
        change["$unset"] = {"last_sent_at": ""}
    await db.ops_alert_state.update_one({"key": claim["key"], "last_sent_at": claim["stamp"]}, change)


async def claim_failure_log(db, key: str) -> bool:
    """Darf dieser Fehlversuch ins Alarm-Log? Atomar (#2080, Codex): nur wer den Merker ``undeliverable_logged`` setzt,
    schreibt den Eintrag - je Rot-Phase einer. ``alert_red_checks`` nimmt ihn beim Wechsel und nach Erfolg wieder weg."""
    await _ensure_state_row(db, key)
    won = await db.ops_alert_state.find_one_and_update(
        {"key": key, "undeliverable_logged": {"$ne": True}}, {"$set": {"undeliverable_logged": True}},
        projection={"_id": 0, "key": 1},
    )
    return won is not None


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
    reminder = stored.get("red_reminder_hours")
    upload_routes = stored.get("upload_routes")
    return {
        "emails": list(stored.get("emails") or []),
        "cooldown_minutes": int(stored.get("cooldown_minutes") or ALERT_WINDOW_SECONDS // 60),
        "red_reminder_hours": DEFAULT_RED_REMINDER_HOURS if reminder is None else int(reminder),
        "rules": rules,
        "retention_days": retention,
        # Datei-Uploads, die nicht als langsam zählen (#2447); nie gespeichert = die Vorgabe aus ops_monitor.
        "upload_routes": list(DEFAULT_UPLOAD_ROUTES if upload_routes is None else upload_routes),
        **{key: _stored_number(stored.get(key), spec) for key, spec in NUMBER_SETTINGS.items()},
        # Fehler aus Website und App sammeln (#1657): ab Werk aus, bis der Datenschutz-Absatz freigegeben ist.
        "client_errors_enabled": stored.get("client_errors_enabled") is True,
    }


def _stored_number(value, spec) -> int:
    """Ein gespeicherter Wert außerhalb der Grenzen (oder unlesbar) gilt als nicht gesetzt - die Vorgabe greift."""
    default, low, high, _message = spec
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return number if low <= number <= high else default


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
    if "red_reminder_hours" in patch:
        hours = int(patch["red_reminder_hours"] or 0)
        if not 0 <= hours <= MAX_RED_REMINDER_HOURS:
            raise ValueError("Die Erinnerung bei Dauer-Rot liegt zwischen 0 (aus) und 720 Stunden.")
        update["red_reminder_hours"] = hours
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
    if "upload_routes" in patch:
        update["upload_routes"] = clean_upload_routes(patch["upload_routes"])
    if "client_errors_enabled" in patch:
        update["client_errors_enabled"] = patch["client_errors_enabled"] is True
    for key, (_default, low, high, message) in NUMBER_SETTINGS.items():
        if key in patch:
            try:
                number = int(patch[key])
            except (TypeError, ValueError):
                raise ValueError(message) from None
            if not low <= number <= high:
                raise ValueError(message)
            update[key] = number
    if update:
        update["updated_at"] = now_utc().isoformat()
        await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {"id": SETTINGS_ID, **update}}, upsert=True)
        # Der Zwischenspeicher des Fehler-Sammlers (ops_monitor.error_settings) liest beim nächsten Fehler frisch.
        global SETTINGS_VERSION
        SETTINGS_VERSION += 1
    return await load_alert_settings(db)


# ---------------------------------------------------------------- Melden

# Discord sagt „nicht eingerichtet“ (Schalter aus, Bot aus, kein Betriebskanal) - dann gibt es den Weg gar nicht.
DISCORD_NOT_SET_UP = frozenset({"disabled", "bot_off", "ops_channel_missing", "channel_missing"})


async def _send(title: str, description: str, fields: list[dict], event_key: str) -> dict:
    from discord_service import send_ops_discord

    return await send_ops_discord(title, description, color=RED, url="/admin/ops", fields=fields, event_key=event_key) or {}


def _mail_html(title: str, description: str, fields: list[dict]) -> str:
    rows = "".join(f"<li><strong>{html.escape(str(f.get('name') or ''))}:</strong> {html.escape(str(f.get('value') or ''))}</li>" for f in fields or [])
    body = html.escape(description or "").replace("\n", "<br>")
    return (f"<h2 style=\"font-family:sans-serif\">{html.escape(title)}</h2><p style=\"font-family:sans-serif\">{body}</p>"
            f"{('<ul style=' + chr(34) + 'font-family:sans-serif' + chr(34) + '>' + rows + '</ul>') if rows else ''}"
            "<p style=\"font-family:sans-serif;color:#666\">Betrieb & Logs im Admin: /admin/ops – dort lassen sich die Alarme einstellen.</p>")


async def notify(db, kind: str, title: str, description: str = "", fields: list[dict] | None = None, *, key: str | None = None,
                 force: bool = False, event_key: str | None = None, log_gate: Callable[[], Awaitable[bool]] | None = None) -> dict:
    """Ein Ereignis melden - nach den Regeln unter Betrieb → Alarme, mit Sperrfrist je Schlüssel.
    Liefert, welche Wege gegangen sind. Nie eine Ausnahme nach außen: ein Alarm darf nichts abbrechen.

    Ging kein Weg (#2080, Codex): ``reason`` sagt, warum. ``undeliverable`` - kein Weg eingerichtet (Discord aus bzw.
    ohne Betriebskanal, keine Mail): der Claim bleibt, der nächste Versuch kommt nach der Sperrfrist. ``failed`` - ein
    eingerichteter Weg scheiterte: neuer Versuch nach dem wachsenden Mindestabstand (``alert_failed``). ``log_gate``
    entscheidet, ob ein Fehlversuch ins Alarm-Log kommt (atomar, etwa ``claim_failure_log``); ohne ihn immer."""
    spec = ALERT_KINDS.get(kind)
    settings = await load_alert_settings(db)
    rule = settings["rules"].get(kind, {"discord": True, "email": False}) if spec else {"discord": True, "email": bool(settings["emails"])}
    channels: list[str] = []
    set_up = False
    alert_key = key or f"{kind}"
    claim = None
    if not force:
        claim = await claim_alert(db, alert_key, window_seconds=settings["cooldown_minutes"] * 60)
        if claim is None:
            return {"sent": False, "channels": [], "reason": "cooldown"}
    fields = fields or []
    if kind in BRAKED_KINDS and not force:
        gate = await _hourly_gate(db, kind, int(settings["alert_hourly_cap"]))
        if gate == "drop":
            return {"sent": False, "channels": [], "reason": "braked"}
        if gate == "summary":
            title = f"Betrieb: weitere Meldungen „{spec['label']}“ in dieser Stunde"
            description = ("Diese Art hat in dieser Stunde ihre Höchstzahl an Meldungen erreicht. Weitere kommen erst ab der "
                           "nächsten vollen Stunde - der Stand steht unter Betrieb & Logs.")
            fields = []
            alert_key = f"{alert_key}:brake"
    if rule.get("discord"):
        try:
            outcome = await _send(title, description, fields, event_key or f"ops_{kind}")
            if outcome.get("ok"):
                channels.append("discord")
            set_up = set_up or outcome.get("reason") not in DISCORD_NOT_SET_UP
        except Exception:  # noqa: BLE001 - ein Alarm darf nichts abbrechen
            set_up = True
            logger.warning("[ops] Discord-Alarm %s fehlgeschlagen", log_safe(alert_key), exc_info=True)
    if rule.get("email") and settings["emails"] and (spec is None or spec.get("email_allowed") is not False):
        set_up = True
        try:
            from services.mail_outbox import enqueue_mail

            for address in settings["emails"]:
                await enqueue_mail(address, f"[Betrieb] {title}"[:180], _mail_html(title, description, fields), template_key="ops_alert",
                                   meta={"kind": kind, "key": alert_key})
            channels.append("email")
        except Exception:  # noqa: BLE001
            logger.warning("[ops] E-Mail-Alarm %s fehlgeschlagen", log_safe(alert_key), exc_info=True)
    reason = None if channels else ("failed" if set_up else "undeliverable")
    if reason == "failed":
        await alert_failed(db, claim)
    elif channels and claim and claim.get("failures"):
        await db.ops_alert_state.update_one({"key": alert_key}, {"$unset": {"retry_after": "", "failures": ""}})
    if channels or log_gate is None or await log_gate():
        await db.ops_alert_log.insert_one({
            "id": new_id(), "kind": kind, "key": alert_key, "title": title[:200], "description": (description or "")[:500],
            "channels": channels, "at": now_utc().isoformat(),
        })
    return {"sent": True, "channels": channels} if channels else {"sent": False, "channels": [], "reason": reason}


def helper_day(now: datetime | None = None) -> str:
    """Tag eines Hilfszählers in ``ops_alert_state`` - der tägliche Job räumt ältere weg."""
    return (now or now_utc()).date().isoformat()


async def _hourly_gate(db, kind: str, cap: int) -> str:
    """Bremse je Ereignisart: ``send`` bis zur Höchstzahl, dann einmal ``summary``, danach ``drop``. Atomar gezählt."""
    from pymongo import ReturnDocument

    current = now_utc()
    key = f"hour:{kind}:{current.strftime('%Y%m%d%H')}"
    row = await db.ops_alert_state.find_one_and_update(
        {"key": key}, {"$inc": {"count": 1}, "$setOnInsert": {"key": key, "helper_day": helper_day(current)}},
        upsert=True, return_document=ReturnDocument.AFTER, projection={"_id": 0, "count": 1},
    )
    count = int((row or {}).get("count") or 0)
    if count <= cap:
        return "send"
    return "summary" if count == cap + 1 else "drop"


def schedule_notify(db, kind: str, title: str, description: str = "", fields: list[dict] | None = None, *, key: str | None = None) -> None:
    """Aus einem Anfrage-Pfad oder Job heraus: nicht warten, nur anstoßen."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(notify(db, kind, title, description, fields, key=key))
    task.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)


async def recent_alerts(db, limit: int = 30) -> list[dict]:
    # Zweitschlüssel _id: zwei Alarme in derselben Mikrosekunde kamen sonst in zufälliger Reihenfolge (Test flackerte).
    return await db.ops_alert_log.find({}, {"_id": 0}).sort([("at", -1), ("_id", -1)]).to_list(max(1, min(int(limit), LOG_LIMIT)))


async def send_test_alert(db) -> dict:
    """„Testalarm“ auf der Seite: geht alle Wege, die irgendeine Regel nutzt - ohne Sperrfrist."""
    settings = await load_alert_settings(db)
    any_discord = any(rule.get("discord") for rule in settings["rules"].values())
    any_email = any(rule.get("email") for rule in settings["rules"].values()) and bool(settings["emails"])
    channels: list[str] = []
    from services.date_text import format_moment

    fields = [{"name": "Zeit", "value": format_moment(now_utc()), "inline": True}]
    if any_discord:
        try:
            if (await _send("Testalarm aus Betrieb → Alarme", "Wenn diese Meldung ankommt, passt der Betriebskanal.", fields, "ops_test")).get("ok"):
                channels.append("discord")
        except Exception:  # noqa: BLE001
            logger.warning("[ops] Test-Alarm Discord fehlgeschlagen", exc_info=True)
    if any_email:
        from services.mail_outbox import enqueue_mail

        for address in settings["emails"]:
            await enqueue_mail(address, "[Betrieb] Testalarm", _mail_html("Testalarm aus Betrieb → Alarme", "Wenn diese Mail ankommt, passen Adresse und Versand.", fields),
                               template_key="ops_alert", meta={"kind": "test"})
        channels.append("email")
    await db.ops_alert_log.insert_one({"id": new_id(), "kind": "test", "key": "test", "title": "Testalarm", "description": "", "channels": channels, "at": now_utc().isoformat()})
    return {"sent": bool(channels), "channels": channels, "emails": settings["emails"] if any_email else []}


# ---------------------------------------------------------------- Bestehende Anlässe (#265)

def _vienna_time(value) -> str:
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return str(value or "")
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    from services.date_text import format_moment

    return format_moment(moment)


def check_red_message(check: dict, run: dict, *, still_red_since: str | None = None) -> dict:
    """Titel, Text und Felder eines roten Auto-Checks - auch die Vorschau (#583) baut sie hiermit. Mit
    ``still_red_since`` die Erinnerung bei Dauer-Rot (#2080): „weiterhin rot seit …“."""
    text = f"{check.get('value') or ''}\n{check.get('detail') or ''}".strip()
    if still_red_since:
        return {"title": f"Betrieb: {check.get('label')} ist weiterhin rot",
                "description": f"Weiterhin rot seit {_vienna_time(still_red_since)}.\n{text}".strip(),
                "fields": [{"name": "Prüfung", "value": check.get("key") or "-", "inline": True}, {"name": "Lauf", "value": run.get("at") or "-", "inline": True}]}
    return {"title": f"Betrieb: {check.get('label')} ist rot",
            "description": text,
            "fields": [{"name": "Prüfung", "value": check.get("key") or "-", "inline": True}, {"name": "Lauf", "value": run.get("at") or "-", "inline": True}]}


SOURCE_LABELS = {"server": "Server", "web": "Website", "app": "App"}


def _top_place(group: dict) -> str:
    """Die oberste eigene Code-Stelle (#1657) steht statt einer Meldung im Alarm - eine Meldung wird nie gespeichert.
    Im Python-Traceback ist das die letzte Zeile, im Browser-Stack die erste."""
    lines = [line for line in str(group.get("stack") or "").splitlines() if line.strip()]
    if not lines:
        return ""
    return f"Stelle: {lines[-1] if (group.get('source') or 'server') == 'server' else lines[0]}"


def error_group_message(group: dict) -> dict:
    """Titel, Text und Felder einer neuen Fehlergruppe."""
    return {"title": f"Serverfehler: {group.get('error_type') or 'Fehler'} auf {group.get('method') or ''} {group.get('route') or ''}".strip(),
            "description": (group.get("message") or _top_place(group))[:1000],
            "fields": [{"name": "HTTP", "value": str(group.get("status_code") or ""), "inline": True}, {"name": "Zähler", "value": str(group.get("count") or 1), "inline": True}]}


async def alert_red_checks(db, run: dict) -> list[str]:
    """Eine Meldung beim Wechsel einer Prüfung auf Rot (#2080) - ein Dauer-Rot meldet sich nicht jede Stunde neu,
    sondern erinnert nach ``red_reminder_hours`` (Vorgabe 24 h, 0 = aus) mit „weiterhin rot seit …“. Dazu die Sperrfrist
    je Prüfung gegen Flackern.

    Der Stand je Prüfung steht bei ihrem Schlüssel in ``ops_alert_state``: ``check_status`` (crit erst, wenn die Meldung
    wirklich raus ist - scheitert der Versand, versucht es der nächste rote Lauf erneut), ``red_since``, ``red_alerted_at``
    und ``undeliverable_logged``: ein Fehlversuch (kein Weg eingerichtet oder Versand gescheitert) steht je Rot-Episode
    höchstens einmal im Alarm-Log, danach bleibt es still, bis die Prüfung wechselt oder ein Weg trägt. Gibt die
    gemeldeten Schlüssel zurück."""
    settings = await load_alert_settings(db)
    reminder_seconds = int(settings.get("red_reminder_hours") or 0) * 3600
    sent: list[str] = []
    for check in run.get("checks") or []:
        key = f"check:{check.get('key')}"
        status = check.get("status")
        state = await db.ops_alert_state.find_one({"key": key}, {"_id": 0}) or {}
        if status != "crit":
            if state.get("check_status") != status or state.get("red_since") or state.get("undeliverable_logged"):
                await db.ops_alert_state.update_one({"key": key}, {"$set": {"key": key, "check_status": status},
                                                                   "$unset": {"red_since": "", "red_alerted_at": "", "undeliverable_logged": ""}},
                                                    upsert=True)
                # Gegenstück (#2447): Die Prüfung ist nicht mehr rot - ihre Alarme gelten als behoben, mit Zeitpunkt.
                await db.ops_alert_log.update_many({"key": key, "resolved_at": None, "at": {"$lte": run.get("at") or now_utc().isoformat()}},
                                                   {"$set": {"resolved_at": run.get("at") or now_utc().isoformat()}})
            continue
        red_since = state.get("red_since") or run.get("at") or now_utc().isoformat()
        if state.get("check_status") == "crit":
            if not reminder_seconds or not alert_due(state.get("red_alerted_at"), window_seconds=reminder_seconds):
                continue
            message = check_red_message(check, run, still_red_since=red_since)
        else:
            if not state.get("red_since"):
                await db.ops_alert_state.update_one({"key": key}, {"$set": {"key": key, "red_since": red_since}}, upsert=True)
            message = check_red_message(check, run)
        try:
            outcome = await notify(db, "check_red", message["title"], message["description"], message["fields"], key=key,
                                   event_key="ops_check", log_gate=lambda key=key: claim_failure_log(db, key))
        except Exception:  # noqa: BLE001 - ein Alarm darf den Lauf nicht abbrechen; der nächste versucht es erneut
            logger.warning("[ops] Alarm %s nicht gemeldet", key, exc_info=True)
            continue
        if outcome.get("sent"):
            await db.ops_alert_state.update_one({"key": key}, {"$set": {"check_status": "crit", "red_alerted_at": now_utc().isoformat()},
                                                               "$unset": {"undeliverable_logged": ""}})
            sent.append(key)
    return sent


async def alert_error_group(db, group: dict) -> bool:
    """Eine neue Fehlergruppe mit 5xx - einmal pro Gruppe und Sperrfrist."""
    if int(group.get("status_code") or 0) < 500:
        return False
    message = error_group_message(group)
    outcome = await notify(db, "error_group", message["title"], message["description"], message["fields"],
                           key=f"error:{group.get('fingerprint')}", event_key="ops_error")
    return bool(outcome.get("sent"))


def schedule_error_alert(db, group: dict) -> None:
    """Aus dem Anfrage-Pfad heraus: nicht warten, nur anstoßen."""
    _spawn(alert_error_group(db, group))


def _spawn(coroutine) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        coroutine.close()
        return
    task = loop.create_task(coroutine)
    task.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)


def error_spike_message(group: dict, count: int, window_minutes: int) -> dict:
    """Häufung (#1657): Quelle, Fehlerart, Seite und Zahl - keine Nutzdaten."""
    source = SOURCE_LABELS.get(group.get("source") or "server", "Server")
    place = f"{group.get('method') or ''} {group.get('route') or ''}".strip() or "/"
    return {"title": f"Häufung: {group.get('error_type') or 'Fehler'} auf {place} ({source})",
            "description": f"{count}× in {window_minutes} Minuten. {_top_place(group)}".strip(),
            "fields": [{"name": "Quelle", "value": source, "inline": True},
                       {"name": "Zähler gesamt", "value": str(group.get("count") or count), "inline": True},
                       {"name": "Version", "value": group.get("version") or "-", "inline": True}]}


async def alert_error_spike(db, group: dict, count: int, window_minutes: int) -> bool:
    """Eine Warnung je Häufung: ``ops_monitor`` stößt sie nur einmal je Zeitfenster an; die Sperrfrist je Gruppe
    (``spike:<Fingerabdruck>``) fängt Fenster ab, die dicht aufeinander folgen."""
    message = error_spike_message(group, count, window_minutes)
    outcome = await notify(db, "error_spike", message["title"], message["description"], message["fields"],
                           key=f"spike:{group.get('fingerprint')}", event_key="ops_error_spike")
    return bool(outcome.get("sent"))


def schedule_spike_alert(db, group: dict, count: int, window_minutes: int) -> None:
    _spawn(alert_error_spike(db, group, count, window_minutes))


# ---------------------------------------------------------------- Aufbewahrung

async def purge_old_logs(db, *, now: datetime | None = None) -> dict:
    """Versandlogs, Adminaktionen und Fehlergruppen nach der eingestellten Frist löschen; die übrigen Quellen räumt die
    Datenbank selbst (Ablaufdatum an App-Logs, Vitals, Upload-Ereignissen)."""
    settings = await load_alert_settings(db)
    current = now or now_utc()
    removed = {}
    # Fehlergruppen (#1657): ab dem letzten Auftreten. Das Ablaufdatum an der Gruppe folgt der Frist beim Schreiben;
    # das hier fängt eine verkürzte Frist ab.
    cutoff = (current - timedelta(days=settings["retention_days"]["ops_errors"])).isoformat()
    result = await db.ops_errors.delete_many({"last_seen_at": {"$lt": cutoff}})
    removed["ops_errors"] = int(getattr(result, "deleted_count", 0) or 0)
    for source in ("email_logs", "audit_logs"):
        cutoff = (current - timedelta(days=settings["retention_days"][source])).isoformat()
        result = await getattr(db, source).delete_many({"created_at": {"$lt": cutoff}})
        removed[source] = int(getattr(result, "deleted_count", 0) or 0)
    # Nachrichten an alle Angemeldeten (#1372): dieselbe Frist wie das Adminprotokoll.
    cutoff = (current - timedelta(days=settings["retention_days"]["audit_logs"])).isoformat()
    result = await db.event_messages.delete_many({"created_at": {"$lt": cutoff}})
    removed["event_messages"] = int(getattr(result, "deleted_count", 0) or 0)
    # An der Tür Eingetragene (#2127, EV17): kein Konto, über das sich Name und Notizen löschen ließen. Nach derselben Frist
    # bleibt nur die Zählung.
    result = await db.event_registrations.update_many(
        {"walk_in": True, "created_at": {"$lt": cutoff}, "anonymized_at": None},
        {"$set": {"display_name": "Teilnehmer", "note": None, "internal_note": None, "anonymized_at": current.isoformat()}},
    )
    removed["walk_in_names"] = int(getattr(result, "modified_count", 0) or 0)
    from services.contact_retention import purge_expired

    removed["contact_messages"] = await purge_expired(db, done_days=settings["retention_days"]["contact_done"], spam_days=settings["retention_days"]["contact_spam"], now=current)
    removed["push_devices"] = await purge_disabled_push_devices(db, days=settings["retention_days"]["push_devices"], now=current)
    old_alerts = (current - timedelta(days=365)).isoformat()
    await db.ops_alert_log.delete_many({"at": {"$lt": old_alerts}})
    # Hilfszähler (#1657): Bremse je Stunde, Obergrenze je Tag, Häufungsfenster - nach zwei Tagen ohne Nutzen.
    await db.ops_alert_state.delete_many({"helper_day": {"$lt": helper_day(current - timedelta(days=2))}})
    return removed


async def purge_disabled_push_devices(db, *, days: int, now: datetime | None = None) -> int:
    """Abgeschaltete Push-Geräte (#2467) nach ``days`` Tagen löschen. Die Frist läuft ab ``disabled_at``; Einträge, die vor
    dem Feld abgemeldet wurden, zählen ab ihrer letzten Änderung. Aktive Geräte bleiben, wie alt sie auch sind."""
    cutoff = ((now or now_utc()) - timedelta(days=days)).isoformat()
    result = await db.mobile_push_tokens.delete_many({
        "enabled": False,
        "$or": [
            {"disabled_at": {"$lt": cutoff}},
            {"disabled_at": None, "updated_at": {"$lt": cutoff}},
        ],
    })
    return int(getattr(result, "deleted_count", 0) or 0)
