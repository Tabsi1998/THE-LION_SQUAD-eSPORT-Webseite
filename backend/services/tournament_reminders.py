"""Check-in-Erinnerungen rund um das Check-in-Fenster eines Turniers.

- 10 Minuten bevor der Check-in öffnet und wenn er öffnet: Postfach und Push,
- 10 Minuten bevor er schließt, für alle noch nicht Eingecheckten: Postfach, Push und - wenn erlaubt - die Mail
  „Check-in endet bald“.

Die Mails „Check-in öffnet bald“ und „Check-in offen“ sind weggefallen (Entscheidung zu #1133): dafür gibt es Push
und die Nachricht in App und Website.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from database import get_db
from services.match_audience import responsible_user_ids, users_for
from services.notification_preferences import _site_base_url, send_user_template
from services.tournament_rules import self_checkin_allowed
from services.user_notifications import create_user_notification

logger = logging.getLogger("tls.tournament_reminders")


@dataclass(frozen=True)
class ReminderSpec:
    mail_template: str | None
    label: str
    field: str
    lead_minutes: int
    window_minutes: int


CHECKIN_REMINDERS = [
    ReminderSpec(None, "opens_10m", "check_in_from", 10, 3),
    ReminderSpec(None, "open_now", "check_in_from", 0, 3),
    ReminderSpec("checkin_closes_soon", "closes_10m", "check_in_until", 10, 3),
]
# Vor Ort checkt die Turnierleitung ein (#1135): dieselbe Erinnerung mit „vor Ort bei der Turnierleitung melden“.
ON_SITE_MAIL = {"checkin_closes_soon": "checkin_closes_soon_on_site"}


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


def checkin_reminder_text(tournament: dict, label: str, target: datetime) -> tuple[str, str]:
    """Titel und Text einer Check-in-Erinnerung. Vor Ort (#1135) checkt die Turnierleitung ein - die Nachricht sagt
    dann, bis wann man sich dort meldet, statt zum Selbst-Check-in aufzufordern."""
    title_text = tournament.get("title") or "Turnier"
    on_site = not self_checkin_allowed(tournament)
    until = _format_de_time(tournament.get("check_in_until"))
    if label == "opens_10m":
        if on_site:
            return "Check-in startet gleich", f"{title_text}: Check-in vor Ort bei der Turnierleitung ab {_format_de_time(target)}."
        return "Check-in startet gleich", f"{title_text}: Check-in startet um {_format_de_time(target)}."
    if label == "open_now":
        if on_site:
            body = f"{title_text}: Check-in ist offen."
            body += f" Bitte bis {until} vor Ort bei der Turnierleitung melden." if until else " Bitte vor Ort bei der Turnierleitung melden."
            return "Check-in ist offen", body
        body = f"{title_text}: Check-in ist jetzt offen."
        return "Check-in ist offen", body + (f" Bitte bis {until} einchecken." if until else "")
    if on_site:
        return "Check-in endet bald", f"{title_text}: Bitte bis {_format_de_time(target)} vor Ort bei der Turnierleitung melden."
    return "Check-in endet bald", f"{title_text}: Check-in endet um {_format_de_time(target)}."


async def _unchecked_registration_users(tournament_id: str) -> list[dict]:
    """Wer noch einchecken muss: die Verantwortlichen jeder bestätigten Anmeldung (#1136) - wer angemeldet hat, bei
    Teams dazu Teamleitung und Co-Leitung; ein Team ohne anmeldende Person über seine Teamleitung."""
    db = get_db()
    regs = await db.tournament_registrations.find(
        {"tournament_id": tournament_id, "status": "approved"},
        {"_id": 0, "id": 1, "user_id": 1, "team_id": 1},
    ).to_list(5000)
    if not regs:
        return []
    return await users_for(db, await responsible_user_ids(db, regs))


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
        on_site = not self_checkin_allowed(tournament)
        for spec, target in due:
            due_count += 1
            target_iso = target.isoformat()
            for user in users:
                dedupe_key = f"tournament_checkin:{tournament['id']}:{spec.label}:{target_iso}:{user['id']}"
                if spec.mail_template:
                    # Vor Ort (#1135): „Bitte bis … vor Ort bei der Turnierleitung melden“ - ohne „Jetzt einchecken“.
                    template = ON_SITE_MAIL.get(spec.mail_template, spec.mail_template) if on_site else spec.mail_template
                    result = await send_user_template(
                        user, template,
                        tournament_title=tournament.get("title") or "Turnier",
                        when=_format_de_time(target),
                        url=url,
                        dedupe_key=dedupe_key,
                        mail_meta={"kind": "tournament_checkin", "tournament_id": tournament["id"], "user_id": user["id"],
                                   "reminder": spec.label},
                    )
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
                    title, body = checkin_reminder_text(tournament, spec.label, target)
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
