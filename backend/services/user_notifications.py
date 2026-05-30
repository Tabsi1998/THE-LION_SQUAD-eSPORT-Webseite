"""Small helpers for in-app user notifications."""
import os
from typing import Any
from datetime import timedelta

from database import get_db
from models import new_id, now_utc
from services.notification_preferences import notification_allowed, push_allowed


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
    if user and not notification_allowed(user, kind, category):
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
        "meta": meta,
        "created_at": now_utc().isoformat(),
    }
    await db.notifications.insert_one(doc)
    doc.pop("_id", None)
    try:
        push_sent_count = 0
        if push_allowed(user, kind, category):
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
    return doc
