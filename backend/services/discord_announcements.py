"""News und Events im Discord ankündigen - und zeigen, wie die Meldung aussehen wird (#300, #303).

Ein Job sieht jede Minute nach, was veröffentlicht und noch nicht geprüft ist.
Damit gilt dieselbe Stelle für „sofort veröffentlicht“ und „geplant für 18 Uhr“,
und jede News, jedes Event wird genau einmal geprüft (`discord_checked_at`) -
ob gesendet oder aus gutem Grund nicht.

Nie gesendet wird: was nur Mitglieder oder der Vorstand sehen (entscheidet
`send_event` noch einmal selbst), was der Autor mit „Ohne Discord“ markiert hat,
Entwürfe, und Altes: Wer den Schalter heute einschaltet, bekommt nicht das
Archiv der letzten Jahre in den Kanal.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from database import get_db
from models import now_utc

logger = logging.getLogger("tls.discord.announce")

VIENNA = ZoneInfo("Europe/Vienna")
MAX_AGE_HOURS = 24
EVENT_PUBLIC_STATUSES = ("scheduled", "registration_open")
NEWS_COLOR = 0x29B6E8
EVENT_COLOR = 0x00FF88


def _parse(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def vienna(value, *, with_time: bool = True) -> str:
    """Zeit so, wie sie im Verein gilt - mit „Uhr“, damit im Discord niemand rechnet."""
    parsed = _parse(value)
    if not parsed:
        return ""
    local = parsed.astimezone(VIENNA)
    return local.strftime("%d.%m.%Y, %H:%M Uhr") if with_time else local.strftime("%d.%m.%Y")


def plain_text(value: str | None, limit: int = 300) -> str:
    text = re.sub(r"<[^>]+>", " ", value or "")
    text = re.sub(r"[#*_`>\[\]]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def news_message(post: dict) -> dict:
    return {
        "event_key": "news.published",
        "title": f"📰 {post.get('title') or 'News'}",
        "description": plain_text(post.get("excerpt") or post.get("content"), 400),
        "color": NEWS_COLOR,
        "url": f"/news/{post.get('slug') or post.get('id')}",
        "image_url": post.get("banner_url") or post.get("cover_url"),
        "fields": [],
    }


def event_message(event: dict) -> dict:
    fields = []
    if event.get("start_date"):
        when = vienna(event["start_date"])
        end = _parse(event.get("end_date"))
        start = _parse(event.get("start_date"))
        if end and start and end.astimezone(VIENNA).date() != start.astimezone(VIENNA).date():
            when = f"{when} – {vienna(end, with_time=False)}"
        fields.append({"name": "Wann", "value": when, "inline": True})
    place = ", ".join(part for part in (event.get("location"), event.get("city")) if part)
    if place:
        fields.append({"name": "Wo", "value": place, "inline": True})
    if event.get("has_registration"):
        if event.get("registration_closes_at"):
            fields.append({"name": "Anmeldung bis", "value": vienna(event["registration_closes_at"]), "inline": True})
        if event.get("max_participants"):
            fields.append({"name": "Plätze", "value": str(event["max_participants"]), "inline": True})
    return {
        "event_key": "event.announced",
        "title": f"📅 {event.get('name') or event.get('title') or 'Event'}",
        "description": plain_text(event.get("short_description") or event.get("description"), 400),
        "color": EVENT_COLOR,
        "url": f"/events/{event.get('slug') or event.get('id')}",
        "image_url": event.get("banner_url") or event.get("poster_url"),
        "fields": fields,
    }


def skip_reason(item: dict, *, published_at, now: datetime | None = None) -> str | None:
    """Warum diese News / dieses Event nicht gemeldet wird - oder None."""
    from discord_service import should_post_to_public_discord

    if item.get("discord_skip"):
        return "author_opt_out"
    if not should_post_to_public_discord(item):
        return "private_visibility"
    when = _parse(published_at)
    if when and (now or now_utc()) - when > timedelta(hours=MAX_AGE_HOURS):
        return "too_old"
    return None


async def preview(kind: str, item: dict) -> dict:
    """Dasselbe Embed wie beim Senden, plus ob und wohin es ginge."""
    from discord_service import EVENTS, _get_discord_config, build_embed, event_enabled, resolve_target

    message = news_message(item) if kind == "news" else event_message(item)
    cfg = await _get_discord_config()
    resolved = resolve_target(cfg, EVENTS[message["event_key"]]["target"])
    reason = skip_reason(item, published_at=None)
    if not reason and not event_enabled(cfg, message["event_key"]):
        reason = "event_disabled"
    if not reason and not cfg["master"]:
        reason = "disabled"
    if not reason and not cfg["bot"]["enabled"]:
        reason = "bot_off"
    if not reason and not resolved["channel_id"]:
        reason = "no_channel"
    embed = await build_embed(message["title"], message["description"], color=message["color"], url=message["url"],
                              fields=message["fields"], image_url=message["image_url"])
    return {"embed": embed, "would_send": reason is None, "reason": reason, "target": resolved["target"]}


async def _announce(collection, item: dict, message: dict, published_at) -> str:
    from discord_service import send_event

    reason = skip_reason(item, published_at=published_at)
    outcome = reason
    if not reason:
        result = await send_event(message["event_key"], message["title"], message["description"], item=item,
                                  color=message["color"], url=message["url"], fields=message["fields"], image_url=message["image_url"])
        outcome = "sent" if result.get("ok") else (result.get("reason") or "failed")
    await collection.update_one({"id": item["id"]}, {"$set": {"discord_checked_at": now_utc().isoformat(), "discord_outcome": outcome}})
    return outcome


async def announce_due(limit: int = 50) -> dict:
    db = get_db()
    now_iso = now_utc().isoformat()
    outcomes: dict[str, int] = {}
    posts = await db.news_posts.find(
        {"published": True, "published_at": {"$lte": now_iso}, "discord_checked_at": {"$exists": False}}, {"_id": 0}
    ).sort("published_at", 1).to_list(limit)
    for post in posts:
        outcome = await _announce(db.news_posts, post, news_message(post), post.get("published_at"))
        outcomes[outcome] = outcomes.get(outcome, 0) + 1
    events = await db.events.find(
        {"status": {"$in": list(EVENT_PUBLIC_STATUSES)}, "discord_checked_at": {"$exists": False}}, {"_id": 0}
    ).sort("created_at", 1).to_list(limit)
    for event in events:
        start = _parse(event.get("start_date"))
        if start and start < now_utc():
            await db.events.update_one({"id": event["id"]}, {"$set": {"discord_checked_at": now_iso, "discord_outcome": "past_event"}})
            outcomes["past_event"] = outcomes.get("past_event", 0) + 1
            continue
        outcome = await _announce(db.events, event, event_message(event), event.get("published_at") or event.get("updated_at") or event.get("created_at"))
        outcomes[outcome] = outcomes.get(outcome, 0) + 1
    return {"news": len(posts), "events": len(events), "outcomes": outcomes}


# ---------------------------------------------------------------- Vorstand (privates Ziel)

async def notify_board(event_key: str, title: str, description: str, *, url: str, fields: list | None = None) -> dict:
    """Nur in den Vorstandskanal. Fehlt er, passiert nichts - nie ein Rückfall auf die Community."""
    from discord_service import send_event

    try:
        return await send_event(event_key, title, description, color=0xFFD700, url=url, fields=fields)
    except Exception:  # noqa: BLE001 - ein Antrag darf nie an Discord scheitern
        logger.warning("[discord] board notification failed", exc_info=True)
        return {"ok": False, "reason": "error"}
