"""Small helpers for in-app user notifications."""
import os
from typing import Any
from datetime import timedelta

from database import get_db
from models import new_id, now_utc
from services.notification_preferences import NOTIFICATION_KIND_CATEGORY, discord_allowed, notification_allowed, push_allowed


DEFAULT_COOLDOWN_SECONDS = {
    "match_reminder": 10 * 60,
    "match_station": 10 * 60,
    "tournament_checkin": 15 * 60,
    "tournament_chat_message": 2 * 60,
    "match_chat_message": 2 * 60,
    "team_chat_message": 2 * 60,
    "news_mention": 10 * 60,
    "membership_update": 10 * 60,
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
        "created_at": {"$gte": vienna_day_start(now)}, "push_sent_count": {"$gt": 0},
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
    discord_channel_allowed = discord_allowed(user, kind, category) and not in_app_only
    if not in_app_allowed and not push_channel_allowed and not discord_channel_allowed:
        return None
    meta = meta or {}
    dedupe_key = meta.get("dedupe_key")
    if dedupe_key:
        existing = await db.notifications.find_one(
            {"user_id": user_id, "kind": kind, "meta.dedupe_key": dedupe_key},
            {"_id": 0},
        )
        if existing:
            return None
    if kind not in NO_COOLDOWN_KINDS:
        cooldown_seconds = int(meta.get("cooldown_seconds") or DEFAULT_COOLDOWN_SECONDS.get(kind, 0) or 0)
        if cooldown_seconds > 0:
            cutoff = (now_utc() - timedelta(seconds=cooldown_seconds)).isoformat()
            cooldown_query: dict[str, Any] = {
                "user_id": user_id,
                "kind": kind,
                "created_at": {"$gte": cutoff},
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
    await db.notifications.insert_one(doc)
    doc.pop("_id", None)
    if in_app_allowed:
        # Only the recipient hears about it, and only that something is new.
        from services.change_events import publish_user_change
        await publish_user_change([user_id], "notifications")
    try:
        push_sent_count = 0
        if push_channel_allowed and await achievement_push_capped(db, user_id, kind):
            push_channel_allowed = False
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
        pass
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
