"""Phase 8: Match-Reminder cron logic. Picks all matches with scheduled_at in the
near future and enqueues reminder mails at 24h / 2h / 30m / 10m offsets.

Idempotent via dedupe_key on the mail_jobs collection.
"""
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from database import get_db
from match_rules import participant_source_ids
from models import now_utc
from services.user_notifications import build_public_url, create_user_notification

logger = logging.getLogger("tls.match_reminders")

# Lead times: (template_key, label, lead_minutes, window_minutes)
LEAD_TIMES = [
    ("match_lead_24h", "24h", 24 * 60, 30),
    ("match_lead_2h", "2h", 120, 20),
    ("match_lead_30m", "30m", 30, 10),
    ("match_lead_10m", "10m", 10, 5),
    ("match_lead_5m", "5m", 5, 3),
]
EMAIL_LEAD_LABELS = {"10m"}


async def _participants_for_match(match: dict) -> list[dict]:
    """Resolve match participant registration ids to user objects."""
    db = get_db()
    out: list[dict] = []
    seen_user_ids: set[str] = set()

    def add_user(user: dict | None) -> None:
        if not user or not user.get("id") or user["id"] in seen_user_ids:
            return
        seen_user_ids.add(user["id"])
        out.append(user)

    for raw in participant_source_ids(match):
        # Try direct user
        u = await db.users.find_one({"id": raw}, {"id": 1, "email": 1, "display_name": 1, "username": 1, "notification_preferences": 1, "newsletter_consent": 1})
        if u:
            add_user(u)
            continue
        # Try via registration
        reg = await db.tournament_registrations.find_one({"id": raw}, {"_id": 0})
        if reg and reg.get("user_id"):
            u2 = await db.users.find_one({"id": reg["user_id"]}, {"id": 1, "email": 1, "display_name": 1, "username": 1, "notification_preferences": 1, "newsletter_consent": 1})
            if u2:
                add_user(u2)
        elif reg and reg.get("team_id"):
            members = await db.team_members.find({"team_id": reg["team_id"]}, {"_id": 0, "user_id": 1}).to_list(20)
            uids = [m["user_id"] for m in members if m.get("user_id")]
            if uids:
                users = await db.users.find(
                    {"id": {"$in": uids}},
                    {"id": 1, "email": 1, "display_name": 1, "username": 1, "notification_preferences": 1, "newsletter_consent": 1},
                ).to_list(20)
                for team_user in users:
                    add_user(team_user)
    return out


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


def _opponent_label(participants: list[dict], user: dict) -> str:
    others = [p.get("display_name") or p.get("username") for p in participants if p.get("id") != user.get("id")]
    others = [name for name in others if name]
    if not others:
        return "TBD"
    if len(others) == 1:
        return others[0]
    if len(others) <= 3:
        return ", ".join(others)
    return f"{len(others)} Gegner"


async def schedule_match_reminders() -> dict:
    """Look ahead 25h and queue reminder mails for upcoming matches."""
    db = get_db()
    now = now_utc()
    horizon = now + timedelta(hours=25)
    queries = [
        ("matches", db.matches.find({
            "scheduled_at": {"$gte": now.isoformat(), "$lte": horizon.isoformat()},
            "status": {"$in": ["pending", "scheduled", "ready", "in_progress"]},
        })),
        ("matches_v2", db.matches_v2.find({
            "scheduled_at": {"$gte": now.isoformat(), "$lte": horizon.isoformat()},
            "status": {"$in": ["pending", "scheduled", "ready", "in_progress"]},
        })),
    ]
    queued = 0
    notifications = 0
    for collection_name, cursor in queries:
        async for m in cursor:
            try:
                scheduled = datetime.fromisoformat(m["scheduled_at"].replace("Z", "+00:00"))
            except Exception:
                continue
            if scheduled.tzinfo is None:
                scheduled = scheduled.replace(tzinfo=timezone.utc)
            diff_min = (scheduled - now).total_seconds() / 60
            # Tournament + opponent context
            t = await db.tournaments.find_one({"id": m.get("tournament_id")}, {"title": 1, "slug": 1}) or {}
            url = f"/matches/{m.get('id')}"
            mail_url = await build_public_url(url)
            when_str = scheduled.astimezone(ZoneInfo("Europe/Vienna")).strftime("%d.%m. %H:%M Uhr")
            station = await _station_label(m)

            participants = await _participants_for_match(m)
            if len(participants) < 1:
                continue
            for p in participants:
                opp_name = _opponent_label(participants, p)
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
    return {"queued": queued, "notifications": notifications}
