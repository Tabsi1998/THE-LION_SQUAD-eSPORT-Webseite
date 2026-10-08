"""Queue a single scheduled 10-minute reminder for upcoming online matches.

Idempotent via dedupe_key on the mail_jobs collection.
"""
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from database import get_db
from models import now_utc
from services.competition_read import load_scheduled_matches
from services.match_audience import match_player_users, playing_ids, registrations_for_match, teams_by_id, users_for
from services.tournament_rules import uses_actual_start_notifications
from services.user_notifications import build_public_url, create_user_notification

logger = logging.getLogger("tls.match_reminders")

LEAD_TIMES = [
    ("match_lead_10m", "10m", 10, 5),
]
EMAIL_LEAD_LABELS = {"10m"}


# Vor Ort mit festen Zeiten: kein Hinweis vorher, der Aufruf beim Reservieren und der Start sagen es (Regel an einer
# Stelle: services/tournament_rules).
_uses_actual_start_notifications = uses_actual_start_notifications


async def _participants_for_match(match: dict) -> list[dict]:
    """Wer im Spiel antritt, als Konten - bei Teams die Aufgestellten, ohne Aufstellung jedes Mitglied (#1136, #1192)."""
    return await match_player_users(get_db(), match)


async def _recipients_with_opponents(db, match: dict) -> list[tuple[dict, str]]:
    """Jeder Spieler mit dem Namen der Gegenseite: bei Teams bekommen die Aufgestellten die Erinnerung, ohne
    Aufstellung jedes Mitglied (#1136, #1192). Der Gegner ist die andere Anmeldung - nie die eigenen Mitspieler."""
    registrations = await registrations_for_match(db, match)
    if not registrations:
        return [(user, "TBD") for user in await _participants_for_match(match)]
    teams = await teams_by_id(db, registrations)
    out: list[tuple[dict, str]] = []
    seen: set[str] = set()
    for reg in registrations:
        others = [_registration_name(other) for other in registrations if other.get("id") != reg.get("id")]
        opponent = _opponent_names([name for name in others if name])
        for user in await users_for(db, playing_ids(reg, teams.get(reg.get("team_id") or ""))):
            if user.get("id") and user["id"] not in seen:
                seen.add(user["id"])
                out.append((user, opponent))
    return out


def _registration_name(registration: dict) -> str:
    return registration.get("display_name") or registration.get("ingame_name") or registration.get("team_name") or ""


def _opponent_names(names: list[str]) -> str:
    if not names:
        return "TBD"
    if len(names) <= 3:
        return ", ".join(names)
    return f"{len(names)} Gegner"


async def _station_label(match: dict) -> str:
    station_id = match.get("station_id")
    if not station_id:
        return ""
    db = get_db()
    station = await db.stations.find_one({"id": station_id}, {"_id": 0, "name": 1, "device_type": 1, "notes": 1})
    if not station:
        return station_id
    parts = [station.get("name") or station_id]
    if station.get("device_type"):
        parts.append(station["device_type"])
    if station.get("notes"):
        parts.append(station["notes"])
    return " - ".join(parts)


async def schedule_match_reminders() -> dict:
    """Look ahead 25h and queue reminder mails for upcoming matches."""
    db = get_db()
    now = now_utc()
    horizon = now + timedelta(hours=25)
    matches = await load_scheduled_matches(
        db,
        scheduled_from=now.isoformat(),
        scheduled_until=horizon.isoformat(),
        statuses={"pending", "scheduled", "ready", "in_progress"},
    )
    queued = 0
    notifications = 0
    actual_start_only = 0
    for m in matches:
        try:
            scheduled = datetime.fromisoformat(m["scheduled_at"].replace("Z", "+00:00"))
        except Exception:
            continue
        if scheduled.tzinfo is None:
            scheduled = scheduled.replace(tzinfo=timezone.utc)
        diff_min = (scheduled - now).total_seconds() / 60
        # Tournament + opponent context
        t = await db.tournaments.find_one(
            {"id": m.get("tournament_id")},
            {
                "title": 1,
                "slug": 1,
                "event_mode": 1,
                "schedule_mode": 1,
                "is_online": 1,
                "is_hybrid": 1,
            },
        ) or {}
        if _uses_actual_start_notifications(t):
            actual_start_only += 1
            continue
        url = f"/matches/{m.get('id')}"
        mail_url = await build_public_url(url)
        when_str = scheduled.astimezone(ZoneInfo("Europe/Vienna")).strftime("%d.%m. %H:%M Uhr")
        station = await _station_label(m)

        participants = await _recipients_with_opponents(db, m)
        if len(participants) < 1:
            continue
        for p, opp_name in participants:
            for tpl_key, label, lead_min, window in LEAD_TIMES:
                # Match this lead time? (within ±window)
                if abs(diff_min - lead_min) > window:
                    continue
                if label == "10m":
                    dedupe_notification = f"match_reminder:{m.get('id')}:{p.get('id')}:web:{label}"
                    exists = await db.notifications.find_one(
                        {
                            "user_id": p.get("id"),
                            "kind": "match_reminder",
                            "meta.dedupe_key": dedupe_notification,
                        },
                        {"_id": 1},
                    )
                    if not exists:
                        station_part = f" an {station}" if station else ""
                        await create_user_notification(
                            p.get("id"),
                            "Match startet in 10 Minuten",
                            f"{t.get('title', 'Turnier')} gegen {opp_name} um {when_str}{station_part}.",
                            url=url,
                            kind="match_reminder",
                            meta={
                                "category": "match_reminders",
                                "dedupe_key": dedupe_notification,
                                "match_id": m.get("id"),
                                "tournament_id": m.get("tournament_id"),
                                "lead_time": label,
                                "station": station,
                            },
                        )
                        notifications += 1
                if label not in EMAIL_LEAD_LABELS:
                    continue
                if not p.get("email"):
                    continue
                from services.notification_preferences import send_user_template
                dedupe = f"match_reminder:{m.get('id')}:{p.get('id')}:{label}"
                result = await send_user_template(
                    p, tpl_key,
                    tournament_title=t.get("title", "Turnier"),
                    opponent=opp_name,
                    when=when_str,
                    url=mail_url,
                    station=station,
                    dedupe_key=dedupe,
                )
                if result.get("ok") and not result.get("skipped") and not result.get("deduped"):
                    queued += 1
    if queued or notifications:
        logger.info(f"[match-reminders] queued {queued} mails, created {notifications} web notifications")
    return {
        "queued": queued,
        "notifications": notifications,
        "actual_start_only": actual_start_only,
    }
