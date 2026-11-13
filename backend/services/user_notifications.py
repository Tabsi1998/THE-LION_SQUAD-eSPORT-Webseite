"""Small helpers for in-app user notifications."""
import logging
import os
from typing import Any
from datetime import timedelta

from pymongo.errors import DuplicateKeyError

from database import get_db
from models import new_id, now_utc
from services.notification_preferences import (
    NOTIFICATION_KIND_CATEGORY, browser_allowed, discord_allowed, notification_allowed, push_allowed,
)
from services.log_safe import log_safe

logger = logging.getLogger("tls.notifications")


DEFAULT_COOLDOWN_SECONDS = {
    "match_reminder": 10 * 60,
    "match_station": 10 * 60,
    "tournament_checkin": 15 * 60,
    "tournament_chat_message": 2 * 60,
    "match_chat_message": 2 * 60,
    "team_chat_message": 2 * 60,
    "news_mention": 10 * 60,
    "membership_update": 10 * 60,
    # Kronen (#2126): schaltet jemand „Erfolge öffentlich“ hin und her, wechseln sie jedes Mal - höchstens eine Meldung je Art.
    "crown_gained": 6 * 60 * 60,
    "crown_changed": 6 * 60 * 60,
    "crown_lost": 6 * 60 * 60,
}
NO_COOLDOWN_KINDS = {
    "direct_message",
    "match_chat_mention",
    "team_chat_mention",
    "tournament_chat_mention",
}
# Erfolge II (#622): Erfolge, Level und Prestige schicken höchstens drei Pushes am Tag (Wien) - der Rest steht im
# Postfach. Ein Paket ist schon eine Meldung (achievement_queue bündelt eine Minute).
ACHIEVEMENT_PUSH_KINDS = ("achievement", "level", "prestige")
ACHIEVEMENT_PUSH_DAILY_CAP = 3


def vienna_day_start(now=None) -> str:
    """Der Beginn des heutigen Tages in Wien, als UTC-Zeitstempel wie in ``created_at``."""
    from datetime import timezone
    from zoneinfo import ZoneInfo

    local = (now or now_utc()).astimezone(ZoneInfo("Europe/Vienna"))
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()


async def achievement_push_capped(db, user_id: str, kind: str, now=None) -> bool:
    """Hat diese Person heute schon drei Erfolgs-Pushes bekommen?"""
    if kind not in ACHIEVEMENT_PUSH_KINDS:
        return False
    sent = await db.notifications.count_documents({
        "user_id": user_id, "kind": {"$in": list(ACHIEVEMENT_PUSH_KINDS)},
        "created_at": {"$gte": vienna_day_start(now)},
        # App oder Browser (#1163): beides zählt als Push.
        "$or": [{"push_sent_count": {"$gt": 0}}, {"browser_sent_count": {"$gt": 0}}],
    })
    return sent >= ACHIEVEMENT_PUSH_DAILY_CAP


async def build_public_url(path: str = "") -> str:
    """Build an absolute frontend URL for notification mails."""
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    base = (os.environ.get("FRONTEND_URL") or branding.get("domain") or "https://lionsquad.at").strip().rstrip("/")
    if base and not base.startswith(("http://", "https://")):
        base = "https://" + base
    base = base or "https://lionsquad.at"
    raw = str(path or "").strip()
    if raw.startswith(("http://", "https://")):
        return raw
    return f"{base}/{raw.lstrip('/')}" if raw else base


async def create_user_notification(
    user_id: str | None,
    title: str,
    body: str = "",
    url: str = "",
    kind: str = "general",
    meta: dict[str, Any] | None = None,
) -> dict | None:
    if not user_id:
        return None
    db = get_db()
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "id": 1, "newsletter_consent": 1, "notification_preferences": 1},
    )
    category = (meta or {}).get("category")
    in_app_allowed = (not user) or notification_allowed(user, kind, category)
    # `in_app_only`: nur ins Postfach - etwa eine Rücknahme (#622), die niemand per Push erfahren soll.
    in_app_only = bool((meta or {}).get("in_app_only"))
    push_channel_allowed = push_allowed(user, kind, category) and not in_app_only
    # Browser-Benachrichtigungen (#1163): wie der App-Push, mit eigenem Kanal „Browser“.
    browser_channel_allowed = browser_allowed(user, kind, category) and not in_app_only
    # `no_discord`: Postfach und Push, aber keine Direktnachricht - etwa die Sammel-Nachricht der Neuberechnung (#2340).
    discord_channel_allowed = discord_allowed(user, kind, category) and not in_app_only and not (meta or {}).get("no_discord")
    if not in_app_allowed and not push_channel_allowed and not browser_channel_allowed and not discord_channel_allowed:
        return None
    meta = meta or {}
    dedupe_key = meta.get("dedupe_key")
    unique = bool(dedupe_key and meta.get("unique_dedupe"))
    if dedupe_key:
        # Liga-Erinnerungen (#1647): die Prüfung trifft den Teilindex ``user_unique_dedupe`` (Person + Schlüssel) - die übrigen
        # Arten fragen wie bisher nach Art und ``meta.dedupe_key``.
        existing = await db.notifications.find_one(
            {"user_id": user_id, "unique_dedupe_key": dedupe_key} if unique
            else {"user_id": user_id, "kind": kind, "meta.dedupe_key": dedupe_key},
            {"_id": 1},
        )
        if existing:
            return None
    # Liga-Erinnerungen (#1647) mit eindeutigem Schlüssel brauchen keine Abkühlzeit: Der Schlüssel hält Doppeltes auf, und die
    # Erinnerung eine Stunde vorher darf nicht an „Spiel startet in 10 Minuten“ eines anderen Laufs hängen bleiben.
    if kind not in NO_COOLDOWN_KINDS and not unique:
        cooldown_seconds = int(meta.get("cooldown_seconds") or DEFAULT_COOLDOWN_SECONDS.get(kind, 0) or 0)
        if cooldown_seconds > 0:
            cutoff = (now_utc() - timedelta(seconds=cooldown_seconds)).isoformat()
            cooldown_query: dict[str, Any] = {
                "user_id": user_id,
                "kind": kind,
                "created_at": {"$gte": cutoff},
                # Nur Zeilen ohne eindeutigen Schlüssel zählen (#1647, N3): „Liga-Spiel in 30 Minuten“ darf „Match startet in
                # 10 Minuten“ nicht unterdrücken.
                "unique_dedupe_key": {"$exists": False},
            }
            if category:
                cooldown_query["meta.category"] = category
            if meta.get("match_id"):
                cooldown_query["meta.match_id"] = meta["match_id"]
            elif meta.get("tournament_id"):
                cooldown_query["meta.tournament_id"] = meta["tournament_id"]
            recent = await db.notifications.find_one(cooldown_query, {"_id": 1})
            if recent:
                return None
    doc = {
        "id": new_id(),
        "user_id": user_id,
        "kind": kind,
        "title": title,
        "body": body,
        "url": url,
        "read": False,
        "in_app_visible": bool(in_app_allowed),
        "meta": meta,
        "created_at": now_utc().isoformat(),
    }
    if unique:
        # Liga-Erinnerungen (#1647): der Teilindex ``user_unique_dedupe`` lässt je Person und Schlüssel nur eine Zeile zu - laufen
        # zwei Jobs gleichzeitig, verliert der zweite hier und schickt weder Push noch Discord.
        doc["unique_dedupe_key"] = dedupe_key
    try:
        await db.notifications.insert_one(doc)
    except DuplicateKeyError:
        return None
    doc.pop("_id", None)
    if in_app_allowed:
        # Only the recipient hears about it, and only that something is new.
        from services.change_events import publish_user_change
        await publish_user_change([user_id], "notifications")
    # Die Tagesgrenze der Erfolgs-Pushes (#622) gilt für App und Browser zusammen.
    capped = False
    if push_channel_allowed or browser_channel_allowed:
        try:
            capped = await achievement_push_capped(db, user_id, kind)
        except Exception:
            capped = False
    if capped:
        push_channel_allowed = False
        browser_channel_allowed = False
    try:
        push_sent_count = 0
        if push_channel_allowed:
            from services.push_notifications import send_mobile_push_for_notification
            push_sent_count = await send_mobile_push_for_notification(doc)
        doc["push_sent_count"] = push_sent_count
        doc["push_sent_at"] = now_utc().isoformat()
        await db.notifications.update_one(
            {"id": doc["id"]},
            {"$set": {"push_sent_count": push_sent_count, "push_sent_at": doc["push_sent_at"]}},
        )
    except Exception:
        logger.warning("[push] Push zur Benachrichtigung %s fehlgeschlagen", log_safe(doc["id"]), exc_info=True)
    try:
        browser_sent = 0
        if browser_channel_allowed:
            from services.web_push import send_web_push_for_notification
            browser_sent = await send_web_push_for_notification(doc)
        doc["browser_sent_count"] = browser_sent
        if browser_sent:
            await db.notifications.update_one({"id": doc["id"]}, {"$set": {"browser_sent_count": browser_sent}})
    except Exception:
        logger.warning("[web-push] Browser-Push zur Benachrichtigung %s fehlgeschlagen", log_safe(doc["id"]), exc_info=True)
        doc.setdefault("browser_sent_count", 0)
    # Discord als persönlicher Kanal (#567): Direktnachricht vom Bot - nur mit Opt-in und verknüpftem Konto.
    try:
        discord_sent = 0
        if discord_channel_allowed:
            from services.discord_dm import send_discord_dm_for_notification
            discord_sent = await send_discord_dm_for_notification(doc, category or NOTIFICATION_KIND_CATEGORY.get(kind))
        doc["discord_sent_count"] = discord_sent
        await db.notifications.update_one({"id": doc["id"]}, {"$set": {"discord_sent_count": discord_sent}})
    except Exception:
        doc.setdefault("discord_sent_count", 0)
    return doc
