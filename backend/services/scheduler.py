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
