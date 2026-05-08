"""Birthday greeting queueing.

Runs from the scheduler and queues one optional birthday mail per user/year.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from services.notification_preferences import _site_base_url, send_user_template


try:
    VIENNA_TZ = ZoneInfo("Europe/Vienna")
except ZoneInfoNotFoundError:
    VIENNA_TZ = timezone(timedelta(hours=1), "Europe/Vienna")


def _parse_birth_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def birthday_is_today(birth_date: Any, today: date) -> bool:
    parsed = _parse_birth_date(birth_date)
    if not parsed:
        return False
    if parsed.month == today.month and parsed.day == today.day:
        return True
    if parsed.month == 2 and parsed.day == 29 and today.month == 2 and today.day == 28:
        return not calendar.isleap(today.year)
    return False


async def queue_birthday_greetings(now: datetime | None = None) -> dict:
    from database import get_db

    db = get_db()
    current = now.astimezone(VIENNA_TZ) if now else datetime.now(VIENNA_TZ)
    today = current.date()
    base = await _site_base_url()
    preferences_url = f"{base}/profile?tab=privacy"
    query = {
        "is_active": True,
        "is_banned": {"$ne": True},
        "email": {"$nin": [None, ""]},
        "birth_date": {"$nin": [None, ""]},
    }
    users = await db.users.find(
        query,
        {
            "_id": 0,
            "id": 1,
            "email": 1,
            "username": 1,
            "display_name": 1,
            "birth_date": 1,
            "newsletter_consent": 1,
            "notification_preferences": 1,
        },
    ).to_list(50000)

    checked = len(users)
    due = 0
    queued = 0
    skipped = 0
    deduped = 0
    for user in users:
        if not birthday_is_today(user.get("birth_date"), today):
            continue
        due += 1
        display_name = user.get("display_name") or user.get("username") or "Löwe"
        result = await send_user_template(
            user,
            "birthday_greeting",
            display_name=display_name,
            preferences_url=preferences_url,
            dedupe_key=f"birthday_greeting:{today.year}:{user['id']}",
            mail_meta={
                "kind": "birthday_greeting",
                "user_id": user["id"],
                "birthday_year": today.year,
            },
        )
        if result.get("deduped"):
            deduped += 1
        elif result.get("skipped"):
            skipped += 1
        elif result.get("ok"):
            queued += 1

    return {
        "checked": checked,
        "due": due,
        "queued": queued,
        "skipped": skipped,
        "deduped": deduped,
        "date": today.isoformat(),
    }
