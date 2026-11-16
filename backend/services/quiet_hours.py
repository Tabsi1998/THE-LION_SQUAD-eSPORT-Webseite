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

Doppelt geht nichts: Je Person und Freigabe gibt es einen Schlüssel ``quiet_digest:<spätestes Ende>:<zufall>``, der vor dem
Versand an den Zeilen steht (Teilindex ``user_unique_dedupe``); erst danach werden die Meldungen freigegeben. Siehe
``release_due``. Der Push-Test der Verwaltung (``admin_push_test``) ist ebenfalls eine Ausnahme.
"""
from __future__ import annotations

import logging
from datetime import datetime

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services import quiet_hours_rules as rules
from services.log_safe import log_safe
from services.quiet_hours_rules import ACTIVE_TOURNAMENT_STATUSES, EXEMPT_KINDS, crosses_midnight

logger = logging.getLogger("tls.quiet_hours")

DIGEST_KIND = "quiet_digest"
DIGEST_URL = "/notifications"
HELD_CHANNELS = ("push", "browser", "discord")
# Höchstens so viele zurückgehaltene Meldungen je Lauf - der Rest folgt im nächsten.
RELEASE_BATCH = 2000


def quiet_until(user: dict | None, now: datetime | None = None) -> datetime | None:
    """Siehe ``quiet_hours_rules.quiet_until`` - hier mit der Uhr des Servers (in Tests verstellbar)."""
    return rules.quiet_until(user, now or now_utc())


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


async def _send_digest(db, user: dict, dedupe: str, until: str, rows: list[dict], channels: set[str]) -> bool:
    """Die Sammelmeldung einmal anlegen (Schlüssel ``dedupe``) und über die zurückgehaltenen Wege schicken. ``False``: gab
    es schon."""
    from services.notification_preferences import browser_allowed, discord_allowed, push_allowed

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
    """Zurückgehaltene Meldungen freigeben, sobald die Person nicht mehr still ist - je Person und Freigabe genau eine
    Sammelmeldung.

    Je Person, nicht je altem Ende: Wer die Ruhezeit verlängert oder den Job über zwei Nächte verpasst, bekommt trotzdem nur
    eine Sammelmeldung. Ist die Person gerade still, bekommen ihre Zeilen das neue Ende (umstempeln) - so blockieren sie
    nichts. Wer die Ruhezeit ausschaltet oder verkürzt, bekommt seine Meldungen beim nächsten Lauf. Der Schlüssel der
    Sammelmeldung steht vor dem Versand an den Zeilen (``quiet_release_key``): bricht ein Lauf nach dem Versand ab, nimmt der
    nächste denselben Schlüssel, und der eindeutige Index lässt keine zweite zu."""
    now = now or now_utc()
    now_iso = now.isoformat()
    counts = {"released": 0, "digests": 0, "restamped": 0}
    user_ids = sorted(await db.notifications.distinct("user_id", {"quiet_hold_until": {"$exists": True}}))
    for user_id in user_ids:
        rows = await db.notifications.find(
            {"user_id": user_id, "quiet_hold_until": {"$exists": True}},
            {"_id": 0, "id": 1, "kind": 1, "read": 1, "meta": 1, "quiet_hold_until": 1, "quiet_held_channels": 1,
             "quiet_release_key": 1},
        ).to_list(RELEASE_BATCH)
        if not rows:
            continue
        ids = [row["id"] for row in rows]
        user = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "id": 1, "newsletter_consent": 1, "notification_preferences": 1, "quiet_hours": 1},
        )
        still = quiet_until(user, now) if user else None
        if still is not None:
            # Noch (oder wieder) still: alle Zeilen auf das jetzige Ende - die Freigabe kommt einmal, danach.
            until = still.isoformat()
            stale = [row["id"] for row in rows if row.get("quiet_hold_until") != until]
            if stale:
                result = await db.notifications.update_many({"id": {"$in": stale}}, {"$set": {"quiet_hold_until": until}})
                counts["restamped"] += int(getattr(result, "modified_count", 0) or 0)
            continue
        latest = max(str(row.get("quiet_hold_until") or "") for row in rows)
        key = next((row["quiet_release_key"] for row in rows if row.get("quiet_release_key")), None)
        if not key:
            key = f"{DIGEST_KIND}:{latest}:{new_id()[:8]}"
            await db.notifications.update_many({"id": {"$in": ids}}, {"$set": {"quiet_release_key": key}})
        unread = [row for row in rows if not row.get("read")]
        channels = {channel for row in unread for channel in (row.get("quiet_held_channels") or []) if channel in HELD_CHANNELS}
        if user and unread and channels and await _send_digest(db, user, key, latest, unread, channels):
            counts["digests"] += 1
        result = await db.notifications.update_many(
            {"id": {"$in": ids}},
            {"$unset": {"quiet_hold_until": "", "quiet_held_channels": "", "quiet_release_key": ""},
             "$set": {"quiet_released_at": now_iso}},
        )
        counts["released"] += int(getattr(result, "modified_count", 0) or 0)
    return counts
