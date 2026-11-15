"""Ruhezeit (#1206): von–bis in Wiener Zeit, Standard aus; beim Einschalten vorgeschlagen 22:00 bis 7:00.

In der Ruhezeit geht kein Push aufs Handy, keine Browser-Meldung (#1163) und keine Discord-Direktnachricht (#567) hinaus.
Die Benachrichtigung entsteht trotzdem und liegt in der Glocke - zurückgehalten, nicht verworfen: Sie trägt
``quiet_hold_until`` (Ende der Ruhezeit, UTC) und ``quiet_held_channels`` (die Wege, die sie genommen hätte). Nach dem Ende
schickt der Job ``quiet_digest`` genau eine Sammelmeldung („In der Nacht: 4 Meldungen“) über diese Wege - nur, wenn noch
etwas ungelesen ist. E-Mail bleibt unverändert.

Ausnahmen, die auch in der Ruhezeit sofort kommen:

- ``match_call``: Aufruf zum eigenen Spiel (#1137) - dieselbe Art tragen in der Liga „Check-in offen“ fürs eigene Spiel und
  „Veto – ihr seid am Zug“ (D.2, D.3).
- ``match_station`` und die Liga-Meldung ``match_schedule`` mit Grund ``checkin_started``: „Match startet jetzt“.
- ``match_attention`` für die Turnierleitung (#1160), solange ihr Turnier läuft (Check-in, live, Pause) - nicht bei
  Liga-Staffeln: deren Leitungs-Meldungen (Verfahren, Fristen) haben Tage Zeit, die Sammelmeldung am Morgen reicht.

Doppelt geht nichts: Die Sammelmeldung hat den eindeutigen Schlüssel ``quiet_digest:<ende>`` (Teilindex
``user_unique_dedupe``); zwei gleichzeitige Läufe legen nur eine an, und erst danach werden die Meldungen freigegeben.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services.log_safe import log_safe

logger = logging.getLogger("tls.quiet_hours")

VIENNA = ZoneInfo("Europe/Vienna")
SUGGESTED_START = "22:00"
SUGGESTED_END = "07:00"
DIGEST_KIND = "quiet_digest"
DIGEST_URL = "/notifications"
HELD_CHANNELS = ("push", "browser", "discord")
# Höchstens so viele zurückgehaltene Meldungen je Lauf - der Rest folgt im nächsten.
RELEASE_BATCH = 2000

EXEMPT_KINDS = frozenset({"match_call", "match_station"})
ACTIVE_TOURNAMENT_STATUSES = frozenset({"check_in", "live", "paused"})
EXEMPTION_TEXTS = (
    "Aufruf zu deinem Spiel und „Match startet jetzt“",
    "Liga: Check-in offen und Veto – ihr seid am Zug, für dein eigenes Spiel",
    "Für die Turnierleitung: „Braucht Aufmerksamkeit“, solange dein Turnier läuft",
)


def parse_time(value: Any) -> int | None:
    """``"HH:MM"`` als Minuten nach Mitternacht - sonst ``None``. Ohne Regex: zwei Zahlen und ein Doppelpunkt."""
    text = str(value or "").strip()
    hours, sep, minutes = text.partition(":")
    if not sep or len(hours) != 2 or len(minutes) != 2 or not hours.isdigit() or not minutes.isdigit():
        return None
    h, m = int(hours), int(minutes)
    if h > 23 or m > 59:
        return None
    return h * 60 + m


def _raw(user: dict | None) -> dict:
    value = (user or {}).get("quiet_hours")
    return value if isinstance(value, dict) else {}


def settings_payload(user: dict | None) -> dict[str, Any]:
    """Für die Einstellungen: an oder aus, von, bis - ohne gespeicherten Wert der Vorschlag 22:00 bis 7:00."""
    raw = _raw(user)
    start = raw.get("start") if parse_time(raw.get("start")) is not None else SUGGESTED_START
    end = raw.get("end") if parse_time(raw.get("end")) is not None else SUGGESTED_END
    return {"enabled": bool(raw.get("enabled")), "start": start, "end": end}


def window(user: dict | None) -> tuple[int, int] | None:
    """Beginn und Ende in Minuten, wenn die Ruhezeit an ist - gleiche Zeiten heißen: keine Ruhezeit."""
    raw = _raw(user)
    if not raw.get("enabled"):
        return None
    start, end = parse_time(raw.get("start")), parse_time(raw.get("end"))
    if start is None or end is None or start == end:
        return None
    return start, end


def crosses_midnight(user: dict | None) -> bool:
    found = window(user)
    return bool(found and found[0] > found[1])


def quiet_until(user: dict | None, now: datetime | None = None) -> datetime | None:
    """Liegt ``now`` in der Ruhezeit, das Ende dieser Ruhezeit (UTC) - sonst ``None``.

    Gerechnet wird in Wiener Wanduhrzeit: 22:00 bis 7:00 bleibt 22:00 bis 7:00, auch in der Nacht der Zeitumstellung."""
    found = window(user)
    if not found:
        return None
    start, end = found
    local = (now or now_utc()).astimezone(VIENNA)
    minute = local.hour * 60 + local.minute
    day = local.date()
    if start < end:
        if not (start <= minute < end):
            return None
    else:
        if not (minute >= start or minute < end):
            return None
        if minute >= start:
            day = day + timedelta(days=1)
    end_local = datetime(day.year, day.month, day.day, end // 60, end % 60, tzinfo=VIENNA)
    return end_local.astimezone(timezone.utc)


async def is_exempt(db, kind: str, meta: dict | None) -> bool:
    """Kommt diese Meldung auch in der Ruhezeit sofort? Siehe Modulbeschreibung."""
    meta = meta or {}
    if kind in EXEMPT_KINDS:
        return True
    if kind == "match_schedule" and meta.get("reason") == "checkin_started":
        return True
    if kind == "match_attention" and meta.get("tournament_id"):
        tournament = await db.tournaments.find_one(
            {"id": meta["tournament_id"]}, {"_id": 0, "status": 1, "league_context": 1},
        )
        if not tournament or isinstance(tournament.get("league_context"), dict):
            return False
        return tournament.get("status") in ACTIVE_TOURNAMENT_STATUSES
    return False


async def hold_until(db, user: dict | None, kind: str, meta: dict | None, now: datetime | None = None) -> str | None:
    """Ende der Ruhezeit als UTC-Zeitstempel, wenn diese Meldung zurückgehalten wird - sonst ``None``."""
    until = quiet_until(user, now)
    if until is None or await is_exempt(db, kind, meta):
        return None
    return until.isoformat()


def digest_title(count: int, night: bool) -> str:
    what = "1 Meldung" if count == 1 else f"{count} Meldungen"
    return f"In der Nacht: {what}" if night else f"In deiner Ruhezeit: {what}"


def digest_body(rows: list[dict]) -> str:
    """Nur die Themen und wie viele - keine fremden Nachrichtentexte."""
    from services.notification_preferences import NOTIFICATION_KIND_CATEGORY, OPTIONAL_EMAIL_PREFERENCES

    counts: dict[str, int] = {}
    for row in rows:
        topic = (row.get("meta") or {}).get("category") or NOTIFICATION_KIND_CATEGORY.get(str(row.get("kind") or ""))
        label = (OPTIONAL_EMAIL_PREFERENCES.get(topic) or {}).get("label") or "Sonstiges"
        counts[label] = counts.get(label, 0) + 1
    parts = [f"{label} {count}" for label, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))]
    return " · ".join(parts[:4]) + " – alles liegt in der Glocke."


async def _send_digest(db, user: dict, until: str, rows: list[dict], channels: set[str]) -> bool:
    """Die Sammelmeldung einmal anlegen und über die zurückgehaltenen Wege schicken. ``False``: gab es schon."""
    from services.notification_preferences import browser_allowed, discord_allowed, push_allowed

    dedupe = f"{DIGEST_KIND}:{until}"
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        "kind": DIGEST_KIND,
        "title": digest_title(len(rows), crosses_midnight(user)),
        "body": digest_body(rows),
        "url": DIGEST_URL,
        # Die Meldungen selbst liegen schon in der Glocke - die Sammelmeldung nicht noch einmal.
        "read": True,
        "in_app_visible": False,
        "meta": {"dedupe_key": dedupe, "count": len(rows), "quiet_until": until},
        "unique_dedupe_key": dedupe,
        "created_at": now_utc().isoformat(),
    }
    try:
        await db.notifications.insert_one(doc)
    except DuplicateKeyError:
        return False
    doc.pop("_id", None)
    sent: dict[str, int] = {}
    if "push" in channels and push_allowed(user, DIGEST_KIND):
        try:
            from services.push_notifications import send_mobile_push_for_notification
            sent["push_sent_count"] = await send_mobile_push_for_notification(doc)
        except Exception:  # ein Weg hält die anderen nicht auf
            logger.warning("[quiet] Sammel-Push %s fehlgeschlagen", log_safe(doc["id"]), exc_info=True)
    if "browser" in channels and browser_allowed(user, DIGEST_KIND):
        try:
            from services.web_push import send_web_push_for_notification
            sent["browser_sent_count"] = await send_web_push_for_notification(doc)
        except Exception:
            logger.warning("[quiet] Sammel-Browser-Push %s fehlgeschlagen", log_safe(doc["id"]), exc_info=True)
    if "discord" in channels and discord_allowed(user, DIGEST_KIND):
        try:
            from services.discord_dm import send_discord_dm_for_notification
            sent["discord_sent_count"] = await send_discord_dm_for_notification(doc, None)
        except Exception:
            logger.warning("[quiet] Sammel-Direktnachricht %s fehlgeschlagen", log_safe(doc["id"]), exc_info=True)
    if sent:
        await db.notifications.update_one({"id": doc["id"]}, {"$set": sent})
    return True


async def release_due(db, now: datetime | None = None) -> dict[str, int]:
    """Zurückgehaltene Meldungen nach dem Ende der Ruhezeit freigeben - je Person und Ruhezeit eine Sammelmeldung."""
    now = now or now_utc()
    rows = await db.notifications.find(
        {"quiet_hold_until": {"$lte": now.isoformat()}},
        {"_id": 0, "id": 1, "user_id": 1, "kind": 1, "read": 1, "meta": 1, "quiet_hold_until": 1, "quiet_held_channels": 1},
    ).sort("quiet_hold_until", 1).to_list(RELEASE_BATCH)
    groups: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        groups.setdefault((row.get("user_id") or "", row.get("quiet_hold_until") or ""), []).append(row)
    counts = {"released": 0, "digests": 0}
    for (user_id, until), group in groups.items():
        user = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "id": 1, "newsletter_consent": 1, "notification_preferences": 1, "quiet_hours": 1},
        )
        # Hat die Person ihre Ruhezeit inzwischen verschoben und ist gerade wieder still: später freigeben.
        if user and quiet_until(user, now) is not None:
            continue
        unread = [row for row in group if not row.get("read")]
        channels = {channel for row in unread for channel in (row.get("quiet_held_channels") or []) if channel in HELD_CHANNELS}
        if user and unread and channels and await _send_digest(db, user, until, unread, channels):
            counts["digests"] += 1
        result = await db.notifications.update_many(
            {"id": {"$in": [row["id"] for row in group]}, "quiet_hold_until": until},
            {"$unset": {"quiet_hold_until": "", "quiet_held_channels": ""}, "$set": {"quiet_released_at": now.isoformat()}},
        )
        counts["released"] += int(getattr(result, "modified_count", 0) or 0)
    return counts
