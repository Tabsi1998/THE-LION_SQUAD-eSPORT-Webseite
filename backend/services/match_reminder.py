"""Phase 8: Match-Reminder cron logic. Picks all matches with scheduled_at in the
near future and enqueues reminder mails at 24h / 2h / 30m / 10m offsets.

Idempotent via dedupe_key on the mail_jobs collection.
"""
import logging
from datetime import datetime, timedelta, timezone

from database import get_db
from match_rules import participant_source_ids
from models import now_utc

logger = logging.getLogger("tls.match_reminders")

# Lead times: (template_key, label, lead_minutes, window_minutes)
LEAD_TIMES = [
    ("match_lead_24h", "24h", 24 * 60, 30),
    ("match_lead_2h", "2h", 120, 20),
    ("match_lead_30m", "30m", 30, 10),
    ("match_lead_10m", "10m", 10, 5),
]


async def _participants_for_match(match: dict) -> list[dict]:
    """Resolve match participant registration ids to user objects."""
    db = get_db()
    out: list[dict] = []
    for raw in participant_source_ids(match):
        # Try direct user
        u = await db.users.find_one({"id": raw}, {"id": 1, "email": 1, "display_name": 1, "username": 1, "notification_preferences": 1, "newsletter_consent": 1})
        if u:
            out.append(u)
            continue
        # Try via registration
        reg = await db.tournament_registrations.find_one({"id": raw}, {"_id": 0})
        if reg and reg.get("user_id"):
            u2 = await db.users.find_one({"id": reg["user_id"]}, {"id": 1, "email": 1, "display_name": 1, "username": 1, "notification_preferences": 1, "newsletter_consent": 1})
            if u2:
                out.append(u2)
        elif reg and reg.get("team_id"):
            members = await db.team_members.find({"team_id": reg["team_id"]}, {"_id": 0, "user_id": 1}).to_list(20)
            uids = [m["user_id"] for m in members if m.get("user_id")]
            if uids:
                users = await db.users.find(
                    {"id": {"$in": uids}},
                    {"id": 1, "email": 1, "display_name": 1, "username": 1, "notification_preferences": 1, "newsletter_consent": 1},
                ).to_list(20)
                out.extend(users)
    return out


async def schedule_match_reminders() -> dict:
    """Look ahead 25h and queue reminder mails for upcoming matches."""
    db = get_db()
    now = now_utc()
    horizon = now + timedelta(hours=25)
    cursor = db.matches.find({
        "scheduled_at": {"$gte": now.isoformat(), "$lte": horizon.isoformat()},
        "status": {"$in": ["pending", "scheduled", "ready", "in_progress"]},
    })
    queued = 0
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
        when_str = scheduled.astimezone(timezone.utc).strftime("%d.%m. %H:%M UTC")

        participants = await _participants_for_match(m)
        if len(participants) < 1:
            continue
        for p in participants:
            opp = next((q for q in participants if q.get("id") != p.get("id")), None)
            opp_name = (opp or {}).get("display_name", "TBD")
            for tpl_key, label, lead_min, window in LEAD_TIMES:
                # Match this lead time? (within ±window)
                if abs(diff_min - lead_min) > window:
                    continue
                if not p.get("email"):
                    continue
                from services.notification_preferences import send_user_template
                dedupe = f"match_reminder:{m.get('id')}:{p.get('id')}:{label}"
                await send_user_template(
                    p, tpl_key,
                    tournament_title=t.get("title", "Turnier"),
                    opponent=opp_name,
                    when=when_str,
                    url=url,
                    dedupe_key=dedupe,
                )
                queued += 1
    if queued:
        logger.info(f"[match-reminders] queued {queued} mails")
    return {"queued": queued}
