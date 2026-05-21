"""User mail/notification preference helpers.

Transactional account/security mails are always allowed. Optional mail streams
are controlled per user so normal profile settings decide what gets queued.
"""
from __future__ import annotations

from typing import Any
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


OPTIONAL_EMAIL_PREFERENCES = {
    "match_reminders": {
        "label": "Match-Erinnerungen",
        "description": "Startzeiten, Match-Hub und Check-in-nahe Hinweise.",
        "default": True,
    },
    "tournament_updates": {
        "label": "Turnier-Updates",
        "description": "Anmeldung, Status, Ergebnisse und wichtige Turnierinfos.",
        "default": True,
    },
    "prize_updates": {
        "label": "Gewinne & Abholung",
        "description": "Gewinn bereit, übergeben oder Frist abgelaufen.",
        "default": True,
    },
    "membership_updates": {
        "label": "Vereinsmitgliedschaft",
        "description": "Bewerbung, Mitgliedsstatus und Vereinsvorteile.",
        "default": True,
    },
    "birthday_greetings": {
        "label": "Geburtstagsgruß",
        "description": "Einmal im Jahr eine Geburtstagsmail vom Verein.",
        "default": True,
    },
    "community_messages": {
        "label": "Nachrichten & Erwähnungen",
        "description": "Direktnachrichten, Team-Chat-Erwähnungen und ähnliche Community-Hinweise.",
        "default": True,
    },
    "news_events": {
        "label": "News & Events",
        "description": "Neue Vereinsnews, neue Events und wichtige Ankündigungen.",
        "default": False,
        "requires_newsletter_consent": True,
    },
}


TEMPLATE_CATEGORY = {
    "registration_received": "tournament_updates",
    "registration_approved": "tournament_updates",
    "registration_rejected": "tournament_updates",
    "checkin_opens_soon": "tournament_updates",
    "checkin_reminder": "tournament_updates",
    "checkin_closes_soon": "tournament_updates",
    "tournament_finished": "tournament_updates",
    "match_reminder": "match_reminders",
    "match_lead_24h": "match_reminders",
    "match_lead_2h": "match_reminders",
    "match_lead_30m": "match_reminders",
    "match_lead_10m": "match_reminders",
    "match_lead_5m": "match_reminders",
    "score_reported": "match_reminders",
    "dispute_opened": "match_reminders",
    "dispute_resolved": "match_reminders",
    "prize_ready": "prize_updates",
    "prize_picked_up": "prize_updates",
    "prize_expired": "prize_updates",
    "membership_activated": "membership_updates",
    "membership_deactivated": "membership_updates",
    "membership_blocked": "membership_updates",
    "membership_approve": "membership_updates",
    "membership_reject": "membership_updates",
    "birthday_greeting": "birthday_greetings",
    "direct_message": "community_messages",
    "team_chat_message": "community_messages",
    "team_chat_mention": "community_messages",
    "newsletter_news": "news_events",
    "newsletter_event": "news_events",
}

NOTIFICATION_KIND_CATEGORY = {
    "match_reminder": "match_reminders",
    "match_station": "match_reminders",
    "match_result": "match_reminders",
    "tournament_checkin": "tournament_updates",
    "tournament_chat_message": "community_messages",
    "tournament_chat_mention": "community_messages",
    "team_chat_message": "community_messages",
    "team_chat_mention": "community_messages",
    "direct_message": "community_messages",
    "friend_request": "community_messages",
    "friend_accept": "community_messages",
    "team_invite": "community_messages",
    "team_invite_accepted": "community_messages",
    "team_role_changed": "community_messages",
    "team_leader_transferred": "community_messages",
    "f1_prize": "prize_updates",
    "f1_prize_reminder": "prize_updates",
    "prize_pending": "prize_updates",
    "news_mention": "news_events",
    "membership_update": "membership_updates",
}


REQUIRED_NOTIFICATION_KINDS = {
    "direct_message",
}


REQUIRED_EMAIL_TEMPLATES = {
    "registration",
    "password_reset",
    "user_invite",
    "test",
}


def normalized_preferences(user: dict | None) -> dict[str, bool]:
    user = user or {}
    raw = user.get("notification_preferences") or {}
    newsletter = bool(user.get("newsletter_consent"))
    prefs: dict[str, bool] = {}
    for key, meta in OPTIONAL_EMAIL_PREFERENCES.items():
        default = bool(meta.get("default"))
        if meta.get("requires_newsletter_consent"):
            default = newsletter
        prefs[key] = bool(raw[key]) if key in raw else default
        if meta.get("requires_newsletter_consent") and not newsletter:
            prefs[key] = False
    return prefs


def email_allowed(user: dict | None, template_key: str, category: str | None = None) -> bool:
    if template_key in REQUIRED_EMAIL_TEMPLATES:
        return True
    category = category or TEMPLATE_CATEGORY.get(template_key)
    if not category:
        return True
    prefs = normalized_preferences(user)
    return bool(prefs.get(category, True))


def notification_allowed(user: dict | None, kind: str, category: str | None = None) -> bool:
    if kind in REQUIRED_NOTIFICATION_KINDS:
        return True
    category = category or NOTIFICATION_KIND_CATEGORY.get(kind)
    if not category:
        return True
    prefs = normalized_preferences(user)
    return bool(prefs.get(category, True))


async def send_user_template(user: dict | None, template_key: str, category: str | None = None, **kwargs) -> dict:
    """Send a named template to a user if their preferences allow it."""
    if not user or not user.get("email"):
        return {"ok": False, "skipped": True, "reason": "missing_email"}
    category = category or TEMPLATE_CATEGORY.get(template_key)
    if not email_allowed(user, template_key, category):
        return {"ok": True, "skipped": True, "reason": "preference_disabled", "category": category}
    from email_service import send_template
    return await send_template(template_key, user["email"], **kwargs)


def public_preferences_payload(user: dict | None) -> dict[str, Any]:
    return {
        "newsletter_consent": bool((user or {}).get("newsletter_consent")),
        "preferences": normalized_preferences(user),
        "channels": [
            {"key": key, **meta} for key, meta in OPTIONAL_EMAIL_PREFERENCES.items()
        ],
    }


async def newsletter_recipients(visibility: str = "public") -> list[dict]:
    """Return users that may receive news/event newsletters for this visibility."""
    from database import get_db
    db = get_db()
    query: dict[str, Any] = {
        "is_active": True,
        "is_banned": {"$ne": True},
        "email": {"$nin": [None, ""]},
        "newsletter_consent": True,
    }
    users = await db.users.find(
        query,
        {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1,
         "newsletter_consent": 1, "notification_preferences": 1},
    ).to_list(10000)
    if visibility == "members":
        memberships = await db.memberships.find(
            {"member_status": {"$in": ["active", "honorary"]}},
            {"_id": 0, "user_id": 1},
        ).to_list(10000)
        member_ids = {m["user_id"] for m in memberships}
        users = [u for u in users if u["id"] in member_ids]
    return [u for u in users if email_allowed(u, "newsletter_news", "news_events")]


async def _site_base_url() -> str:
    from database import get_db
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    domain = (branding.get("domain") or "https://lionsquad.at").strip().rstrip("/")
    if domain and not domain.startswith(("http://", "https://")):
        domain = "https://" + domain
    return domain or "https://lionsquad.at"


def _format_de_datetime(value: Any) -> str:
    if not value:
        return ""
    try:
        dt = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(ZoneInfo("Europe/Vienna")).strftime("%d.%m.%Y, %H:%M Uhr")
    except Exception:
        return ""


async def enqueue_newsletter_for_item(kind: str, item: dict, dedupe_suffix: str = "") -> dict:
    """Queue opt-in newsletter mails for a published news post or announced event."""
    if kind not in {"news", "event"}:
        return {"queued": 0, "reason": "unsupported_kind"}
    visibility = item.get("visibility") or "public"
    if visibility == "internal":
        return {"queued": 0, "reason": "internal_visibility"}
    if kind == "news" and not item.get("published", True):
        return {"queued": 0, "reason": "not_published"}
    if kind == "event" and item.get("status") in {"draft", "archived", "cancelled"}:
        return {"queued": 0, "reason": "not_announced"}

    users = await newsletter_recipients(visibility)
    if not users:
        return {"queued": 0, "reason": "no_recipients"}

    base = await _site_base_url()
    preferences_url = f"{base}/profile?tab=privacy"
    slug_or_id = item.get("slug") or item.get("id")
    if kind == "news":
        template_key = "newsletter_news"
        url = f"{base}/news/{slug_or_id}"
        title = item.get("title") or "Neue Vereinsnews"
        common_kwargs = {
            "title": title,
            "excerpt": item.get("excerpt") or "",
            "url": url,
            "preferences_url": preferences_url,
        }
    else:
        template_key = "newsletter_event"
        url = f"{base}/events/{slug_or_id}"
        title = item.get("name") or "Neues Event"
        common_kwargs = {
            "title": title,
            "when": _format_de_datetime(item.get("start_date")),
            "location": item.get("location") or item.get("city") or "",
            "url": url,
            "preferences_url": preferences_url,
        }

    queued = 0
    from email_service import send_template
    for user in users:
        if not email_allowed(user, template_key, "news_events"):
            continue
        display_name = user.get("display_name") or user.get("username") or "Löwe"
        result = await send_template(
            template_key,
            user["email"],
            display_name=display_name,
            dedupe_key=f"{template_key}:{item.get('id')}:{user['id']}{dedupe_suffix}",
            mail_meta={
                "kind": "newsletter",
                "source_type": kind,
                "source_id": item.get("id"),
                "manual": bool(dedupe_suffix),
                "user_id": user["id"],
            },
            **common_kwargs,
        )
        if result.get("ok") and not result.get("deduped"):
            queued += 1
    return {"queued": queued, "recipients": len(users)}
