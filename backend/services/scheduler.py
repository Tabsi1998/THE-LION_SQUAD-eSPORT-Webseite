"""Phase 8: APScheduler-based background tasks.

Runs three jobs in the FastAPI process:
  - mail_queue every 30 seconds
  - match_reminders every 5 minutes
  - prize_expiry every 60 minutes

Designed to be safe-by-default: every job catches its own exceptions so the
scheduler never crashes the app.
"""
import logging
from contextlib import suppress
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger("tls.scheduler")

_scheduler: AsyncIOScheduler | None = None


async def _safe_mail_queue():
    try:
        from services.mail_queue import process_mail_queue
        res = await process_mail_queue(batch=20)
        if res.get("processed"):
            logger.info(f"[scheduler] mail_queue {res}")
    except Exception as exc:
        logger.exception(f"[scheduler] mail_queue crash: {exc}")


async def _safe_match_reminders():
    try:
        from services.match_reminder import schedule_match_reminders
        res = await schedule_match_reminders()
        if res.get("queued"):
            logger.info(f"[scheduler] match_reminders {res}")
    except Exception as exc:
        logger.exception(f"[scheduler] match_reminders crash: {exc}")


async def _safe_prize_expiry():
    try:
        from services.prize_service import expire_overdue
        n = await expire_overdue()
        if n:
            logger.info(f"[scheduler] prize_expiry expired={n}")
    except Exception as exc:
        logger.exception(f"[scheduler] prize_expiry crash: {exc}")


async def _safe_twitch_poll():
    try:
        from services.twitch_service import twitch_poll_loop
        await twitch_poll_loop()
    except Exception as exc:
        logger.exception(f"[scheduler] twitch_poll crash: {exc}")


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except ValueError:
        return None


def _next_status(doc: dict, now: datetime, kind: str = "tournament") -> str | None:
    status = doc.get("status")
    if kind == "event":
        reg_enabled = bool(doc.get("has_registration") or doc.get("registration_url"))
        reg_from = _parse_dt(doc.get("registration_opens_at"))
        reg_until = _parse_dt(doc.get("registration_closes_at"))
    else:
        reg_enabled = doc.get("registration_enabled") is not False and not doc.get("is_invite_only")
        reg_from = _parse_dt(doc.get("registration_open_from"))
        reg_until = _parse_dt(doc.get("registration_open_until"))
    check_from = _parse_dt(doc.get("check_in_from"))
    check_until = _parse_dt(doc.get("check_in_until"))
    start = _parse_dt(doc.get("start_date"))
    end = _parse_dt(doc.get("end_date"))

    if status in ("draft", "paused", "completed", "results_published", "archived", "cancelled"):
        return None
    if end and now >= end:
        return "completed"
    if status == "scheduled" and reg_enabled and reg_from and now >= reg_from and (not reg_until or now <= reg_until):
        return "registration_open"
    if kind != "event" and status in ("scheduled", "registration_open", "registration_closed") and check_from and now >= check_from and (not check_until or now <= check_until):
        return "check_in"
    if status == "registration_open" and reg_until and now > reg_until:
        return "registration_closed"
    if status == "check_in" and check_until and now > check_until:
        return "registration_closed"
    if status in ("scheduled", "registration_open", "registration_closed", "check_in", "checkin_open") and start and now >= start:
        return "live"
    return None


async def _safe_status_transitions():
    try:
        from database import get_db
        from models import now_utc
        db = get_db()
        now = datetime.now(timezone.utc)
        now_iso = now_utc().isoformat()
        changed = 0
        for collection_name, kind in (("tournaments", "tournament"), ("f1_challenges", "f1"), ("events", "event")):
            cursor = db[collection_name].find(
                {"status": {"$in": ["scheduled", "registration_open", "registration_closed", "check_in", "checkin_open", "live"]}},
                {"_id": 0},
            )
            async for doc in cursor:
                nxt = _next_status(doc, now, kind)
                if nxt and nxt != doc.get("status"):
                    await db[collection_name].update_one(
                        {"id": doc["id"]},
                        {"$set": {"status": nxt, "updated_at": now_iso}},
                    )
                    changed += 1
        if changed:
            logger.info(f"[scheduler] status_transitions changed={changed}")
    except Exception as exc:
        logger.exception(f"[scheduler] status_transitions crash: {exc}")


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler:
        return _scheduler
    sched = AsyncIOScheduler(timezone="UTC")
    sched.add_job(_safe_mail_queue, IntervalTrigger(seconds=30), id="mail_queue",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_match_reminders, IntervalTrigger(minutes=5), id="match_reminders",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_prize_expiry, IntervalTrigger(minutes=60), id="prize_expiry",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_twitch_poll, IntervalTrigger(seconds=90), id="twitch_poll",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_status_transitions, IntervalTrigger(seconds=60), id="status_transitions",
                  max_instances=1, coalesce=True)
    sched.start()
    _scheduler = sched
    logger.info("[scheduler] started (mail_queue 30s · match_reminders 5m · prize_expiry 60m · twitch 90s)")
    return sched


def stop_scheduler():
    global _scheduler
    if _scheduler:
        with suppress(Exception):
            _scheduler.shutdown(wait=False)
        _scheduler = None


def get_scheduler_status() -> dict:
    if not _scheduler:
        return {"running": False, "jobs": []}
    jobs = []
    for job in _scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
        })
    return {"running": _scheduler.running, "jobs": jobs}
