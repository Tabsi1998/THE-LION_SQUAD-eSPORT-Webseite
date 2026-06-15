"""Operational tournament reminder jobs.

Queues check-in mails around the configured check-in window:
- 10 minutes before check-in opens
- when check-in opens
- 10 minutes before check-in closes for users still not checked in
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from database import get_db
from services.notification_preferences import _site_base_url, send_user_template
from services.user_notifications import create_user_notification

logger = logging.getLogger("tls.tournament_reminders")


@dataclass(frozen=True)
class ReminderSpec:
    template_key: str
    label: str
    field: str
    lead_minutes: int
    window_minutes: int


CHECKIN_REMINDERS = [
    ReminderSpec("checkin_opens_soon", "opens_10m", "check_in_from", 10, 3),
    ReminderSpec("checkin_reminder", "open_now", "check_in_from", 0, 3),
    ReminderSpec("checkin_closes_soon", "closes_10m", "check_in_until", 10, 3),
]
EMAIL_CHECKIN_REMINDER_LABELS = {"closes_10m"}


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except ValueError:
        return None


def _format_de_time(value: Any) -> str:
    dt = _parse_dt(value)
    if not dt:
        return ""
    return dt.astimezone(ZoneInfo("Europe/Vienna")).strftime("%d.%m.%Y, %H:%M Uhr")


def due_checkin_reminders(tournament: dict, now: datetime) -> list[tuple[ReminderSpec, datetime]]:
    if tournament.get("registration_enabled") is False or tournament.get("is_invite_only"):
        return []
    if tournament.get("status") in {"draft", "paused", "completed", "results_published", "archived", "cancelled"}:
        return []
    now = now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now
    due: list[tuple[ReminderSpec, datetime]] = []
    for spec in CHECKIN_REMINDERS:
        target = _parse_dt(tournament.get(spec.field))
        if not target:
            continue
        diff_minutes = (target - now).total_seconds() / 60
        if abs(diff_minutes - spec.lead_minutes) <= spec.window_minutes:
            due.append((spec, target))
    return due


async def _unchecked_registration_users(tournament_id: str) -> list[dict]:
    db = get_db()
    regs = await db.tournament_registrations.find(
        {"tournament_id": tournament_id, "status": "approved", "user_id": {"$nin": [None, ""]}},
        {"_id": 0, "user_id": 1},
    ).to_list(5000)
    user_ids = list({reg["user_id"] for reg in regs if reg.get("user_id")})
    if not user_ids:
        return []
    return await db.users.find(
        {"id": {"$in": user_ids}, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1, "email": 1, "username": 1, "display_name": 1, "notification_preferences": 1, "newsletter_consent": 1},
    ).to_list(5000)


async def schedule_checkin_reminders(now: datetime | None = None) -> dict:
    db = get_db()
    now = now or datetime.now(timezone.utc)
    checked = 0
    due_count = 0
    queued = 0
    notifications = 0
    base_url = await _site_base_url()
    cursor = db.tournaments.find(
        {
            "status": {"$nin": ["draft", "paused", "completed", "results_published", "archived", "cancelled"]},
            "$or": [{"check_in_from": {"$nin": [None, ""]}}, {"check_in_until": {"$nin": [None, ""]}}],
        },
        {"_id": 0},
    )
    async for tournament in cursor:
        checked += 1
        due = due_checkin_reminders(tournament, now)
        if not due:
            continue
        users = await _unchecked_registration_users(tournament["id"])
        if not users:
            continue
        slug_or_id = tournament.get("slug") or tournament["id"]
        public_path = f"/tournaments/{slug_or_id}"
        url = f"{base_url}{public_path}"
        for spec, target in due:
            due_count += 1
            target_iso = target.isoformat()
            for user in users:
                dedupe_key = f"tournament_checkin:{tournament['id']}:{spec.label}:{target_iso}:{user['id']}"
                kwargs = {
                    "tournament_title": tournament.get("title") or "Turnier",
                    "url": url,
                    "dedupe_key": dedupe_key,
                    "mail_meta": {
                        "kind": "tournament_checkin",
                        "tournament_id": tournament["id"],
                        "user_id": user["id"],
                        "reminder": spec.label,
                    },
                }
                if spec.template_key == "checkin_reminder":
                    kwargs["until"] = _format_de_time(tournament.get("check_in_until"))
                else:
                    kwargs["when"] = _format_de_time(target)
                if spec.label in EMAIL_CHECKIN_REMINDER_LABELS:
                    result = await send_user_template(user, spec.template_key, **kwargs)
                    if result.get("ok") and not result.get("skipped") and not result.get("deduped"):
                        queued += 1
                existing_notification = await db.notifications.find_one(
                    {
                        "user_id": user["id"],
                        "kind": "tournament_checkin",
                        "meta.dedupe_key": dedupe_key,
                    },
                    {"_id": 1},
                )
                if not existing_notification:
                    tournament_title = tournament.get("title") or "Turnier"
                    if spec.label == "opens_10m":
                        title = "Check-in startet gleich"
                        body = f"{tournament_title}: Check-in startet um {_format_de_time(target)}."
                    elif spec.label == "open_now":
                        title = "Check-in ist offen"
                        until = _format_de_time(tournament.get("check_in_until"))
                        body = f"{tournament_title}: Check-in ist jetzt offen."
                        if until:
                            body += f" Bitte bis {until} einchecken."
                    else:
                        title = "Check-in endet bald"
                        body = f"{tournament_title}: Check-in endet um {_format_de_time(target)}."
                    created = await create_user_notification(
                        user["id"],
                        title=title,
                        body=body,
                        url=public_path,
                        kind="tournament_checkin",
                        meta={
                            "dedupe_key": dedupe_key,
                            "category": "tournament_updates",
                            "tournament_id": tournament["id"],
                            "reminder": spec.label,
                        },
                    )
                    if created:
                        notifications += 1
    if queued:
        logger.info("[tournament-reminders] queued=%s notifications=%s checked=%s due=%s", queued, notifications, checked, due_count)
    return {"checked": checked, "due": due_count, "queued": queued, "notifications": notifications}
