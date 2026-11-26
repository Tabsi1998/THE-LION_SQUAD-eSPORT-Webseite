"""Sammel-Mail (#1662): Regeln und Sammeln - ein Blatt-Modul ohne ``notification_preferences``.

``notification_preferences.send_user_template`` fragt hier, ob eine Mail gesammelt wird, und legt sie ab (``hold``). Den Versand,
die Läufe und die Sichtbarkeit beim Versand regelt ``services/mail_digest.py`` (dort die ausführliche Beschreibung).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc

VIENNA = ZoneInfo("Europe/Vienna")
SETTINGS_ID = "notification_digest"
DIGEST_TEMPLATE = "notification_digest"
RHYTHMS: tuple[str, ...] = ("instant", "daily", "weekly")
RHYTHM_LABELS = {"instant": "Sofort", "daily": "Täglich", "weekly": "Wöchentlich"}
WEEKDAYS = ("Montags", "Dienstags", "Mittwochs", "Donnerstags", "Freitags", "Samstags", "Sonntags")
DEFAULTS: dict[str, Any] = {"default_rhythm": "instant", "daily_time": "07:00", "weekly_weekday": 0, "weekly_time": "07:00"}
# Kann nicht warten: Spiel in 10 Minuten, Erinnerung vor dem Spiel, Check-in schließt, Ergebnis bestätigen, Dispute offen -
# und Absagen von Turnier und Event (Fabian 26.11., A). Die Terminänderung eines Events ruft mit ``importance="urgent"``.
URGENT_TEMPLATES = frozenset({
    "match_lead_10m", "match_reminder", "checkin_closes_soon", "checkin_closes_soon_on_site", "score_reported", "dispute_opened",
    "tournament_cancelled", "event_cancelled",
})
# Schon selbst ein Gruß bzw. eine Zusammenfassung - und die Newsletter mit eigenem Abmeldeweg.
OWN_FORMAT_TEMPLATES = frozenset({"birthday_greeting", "achievement_recap", "newsletter_news", "newsletter_event", DIGEST_TEMPLATE})
PREVIEW_FIELDS = ("text", "detail", "summary", "message", "preview", "decision", "reason", "when")
PREVIEW_MAX = 200


def _clock(value: Any) -> str | None:
    from services.quiet_hours_rules import parse_time

    return str(value).strip() if parse_time(value) is not None else None


def normalized_settings(raw: dict | None) -> dict[str, Any]:
    """Die Vorgaben der Verwaltung - Ungültiges fällt auf den Standard zurück."""
    raw = raw or {}
    weekday = raw.get("weekly_weekday")
    return {
        "default_rhythm": raw.get("default_rhythm") if raw.get("default_rhythm") in RHYTHMS else DEFAULTS["default_rhythm"],
        "daily_time": _clock(raw.get("daily_time")) or DEFAULTS["daily_time"],
        "weekly_weekday": weekday if isinstance(weekday, int) and not isinstance(weekday, bool) and 0 <= weekday <= 6
        else DEFAULTS["weekly_weekday"],
        "weekly_time": _clock(raw.get("weekly_time")) or DEFAULTS["weekly_time"],
    }


def rhythm_of(user: dict | None, cfg: dict) -> str:
    own = (user or {}).get("mail_digest")
    return own if own in RHYTHMS else cfg["default_rhythm"]


def collectable(template_key: str, importance: str | None = None, required: bool = False) -> bool:
    """Darf diese Mail in die Sammlung? Nie: Pflicht (``required``), Dringendes, eigene Formate."""
    if required or importance == "urgent":
        return False
    return template_key not in URGENT_TEMPLATES and template_key not in OWN_FORMAT_TEMPLATES


def _at(day, clock: str) -> datetime:
    hours, minutes = (int(part) for part in clock.split(":"))
    return datetime(day.year, day.month, day.day, hours, minutes, tzinfo=VIENNA).astimezone(timezone.utc)


def last_slot(rhythm: str, cfg: dict, now: datetime) -> datetime:
    """Der zuletzt begonnene Termin (UTC) - täglich zur Uhrzeit, wöchentlich am Wochentag zur Uhrzeit, Wiener Zeit."""
    today = now.astimezone(VIENNA).date()
    if rhythm == "weekly":
        day = today - timedelta(days=(today.weekday() - cfg["weekly_weekday"]) % 7)
        slot = _at(day, cfg["weekly_time"])
        return slot if slot <= now else _at(day - timedelta(days=7), cfg["weekly_time"])
    slot = _at(today, cfg["daily_time"])
    return slot if slot <= now else _at(today - timedelta(days=1), cfg["daily_time"])


def period_key(rhythm: str, slot: datetime) -> str:
    return f"{rhythm}:{slot.astimezone(VIENNA).date().isoformat()}"


def schedule_text(rhythm: str, cfg: dict) -> str:
    if rhythm == "daily":
        return f"Täglich um {cfg['daily_time']} Uhr"
    if rhythm == "weekly":
        return f"{WEEKDAYS[cfg['weekly_weekday']]} um {cfg['weekly_time']} Uhr"
    return "Jede Mail sofort"


def preview_line(values: dict) -> str:
    """Eine Zeile Vorschau aus den Werten der Mail - der erste Text, Leerraum zusammengefasst, höchstens 200 Zeichen."""
    for field in PREVIEW_FIELDS:
        value = values.get(field)
        if isinstance(value, str) and value.strip():
            text = " ".join(value.split())
            return text if len(text) <= PREVIEW_MAX else text[:PREVIEW_MAX - 1].rstrip() + "…"
    return ""


def settings_payload(user: dict | None, cfg: dict) -> dict:
    """Für die Einstellungen der Person."""
    own = (user or {}).get("mail_digest")
    return {
        "rhythm": rhythm_of(user, cfg),
        "own": own if own in RHYTHMS else None,
        "default": cfg["default_rhythm"],
        "options": [{"key": key, "label": RHYTHM_LABELS[key], "schedule": schedule_text(key, cfg)} for key in RHYTHMS],
    }


# ---------------------------------------------------------------- Sammeln

async def load_settings(db) -> dict:
    return normalized_settings(await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}))


async def hold(user: dict, template_key: str, category: str | None, values: dict) -> dict | None:
    """Die Mail sammeln statt einreihen - ``None``: geht wie bisher sofort. Gleicher ``dedupe_key``: nur einmal gesammelt."""
    from database import get_db
    from email_service import render_named

    db = get_db()
    cfg = await load_settings(db)
    if "mail_digest" not in user:
        # Viele Aufrufer lesen das Konto mit schmaler Projektion - der Rhythmus wird dann hier nachgelesen.
        stored = await db.users.find_one({"id": user["id"]}, {"_id": 0, "mail_digest": 1}) or {}
        user = {**user, "mail_digest": stored.get("mail_digest")}
    if rhythm_of(user, cfg) == "instant":
        return None
    template_values = {key: value for key, value in values.items() if key not in ("dedupe_key", "mail_meta", "mail_headers")}
    try:
        rendered = await render_named(template_key, **template_values)
    except TypeError:
        return None  # falsche Werte: wie bisher meldet send_template das (ok False)
    if rendered is None:
        return None
    dedupe_key = values.get("dedupe_key") or None
    item = {
        "id": new_id(),
        "user_id": user["id"],
        "template_key": template_key,
        "category": category,
        "subject": rendered[0],
        "preview": preview_line(template_values),
        "url": str(template_values.get("url") or ""),
        "created_at": now_utc().isoformat(),
        **({"dedupe_key": dedupe_key} if dedupe_key else {}),
    }
    if dedupe_key and await db.mail_digest_items.find_one({"user_id": user["id"], "dedupe_key": dedupe_key}, {"_id": 1}):
        return {"ok": True, "digest": True, "deduped": True}
    try:
        await db.mail_digest_items.insert_one(dict(item))
    except DuplicateKeyError:
        return {"ok": True, "digest": True, "deduped": True}
    return {"ok": True, "digest": True, "id": item["id"]}
