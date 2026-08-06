"""Phase 8: APScheduler-based background tasks.

Runs recurring jobs in the FastAPI process:
  - mail_queue every 30 seconds
  - match_reminders every 5 minutes
  - tournament_reminders every 60 seconds
  - scheduled_news every 60 seconds
  - prize_expiry every 60 minutes
  - f1_prize_reminders every 5 minutes
  - birthday_greetings every 6 hours
  - game_server_sync every 5 minutes
  - mobile_push_receipts every 5 minutes

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


def _log_task_failure(task: str, exc: Exception) -> None:
    """Log operational context without persisting exception payloads."""
    logger.error("[scheduler] %s failed type=%s", task, type(exc).__name__)


async def _safe_mail_queue():
    try:
        from services.mail_queue import process_mail_queue
        res = await process_mail_queue(batch=20)
        if res.get("processed"):
            logger.info(f"[scheduler] mail_queue {res}")
    except Exception as exc:
        _log_task_failure("mail_queue", exc)


async def _safe_match_reminders():
    try:
        from services.match_reminder import schedule_match_reminders
        res = await schedule_match_reminders()
        if res.get("queued"):
            logger.info(f"[scheduler] match_reminders {res}")
    except Exception as exc:
        _log_task_failure("match_reminders", exc)


async def _safe_tournament_reminders():
    try:
        from services.tournament_reminders import schedule_checkin_reminders
        res = await schedule_checkin_reminders()
        if res.get("queued"):
            logger.info(f"[scheduler] tournament_reminders {res}")
    except Exception as exc:
        _log_task_failure("tournament_reminders", exc)


async def _safe_scheduled_news():
    try:
        from services.news_publish import finalize_due_news
        res = await finalize_due_news()
        if res.get("processed") or res.get("newsletter_queued") or res.get("mentions"):
            logger.info(f"[scheduler] scheduled_news {res}")
    except Exception as exc:
        _log_task_failure("scheduled_news", exc)


async def _safe_prize_expiry():
    try:
        from services.prize_service import expire_overdue
        n = await expire_overdue()
        if n:
            logger.info(f"[scheduler] prize_expiry expired={n}")
    except Exception as exc:
        _log_task_failure("prize_expiry", exc)


async def _safe_f1_prize_reminders():
    try:
        from services.f1_prize_reminder import schedule_f1_prize_reminders
        res = await schedule_f1_prize_reminders()
        if res.get("notifications"):
            logger.info(f"[scheduler] f1_prize_reminders {res}")
    except Exception as exc:
        _log_task_failure("f1_prize_reminders", exc)


async def _safe_birthday_greetings():
    try:
        from services.birthday_mailer import queue_birthday_greetings
        res = await queue_birthday_greetings()
        if res.get("queued") or res.get("deduped"):
            logger.info("[scheduler] birthday_greetings completed")
    except Exception as exc:
        _log_task_failure("birthday_greetings", exc)


async def _safe_twitch_poll():
    try:
        from services.twitch_service import twitch_poll_loop
        await twitch_poll_loop()
    except Exception as exc:
        _log_task_failure("twitch_poll", exc)


async def _safe_game_server_sync():
    try:
        from routes.game_server_routes import sync_configured_game_servers
        res = await sync_configured_game_servers()
        if res.get("processed"):
            logger.info(f"[scheduler] game_server_sync processed={res.get('processed')} failed={res.get('failed')}")
    except Exception as exc:
        _log_task_failure("game_server_sync", exc)


async def _safe_mobile_push_receipts():
    try:
        from services.push_notifications import check_recent_mobile_push_receipts
        res = await check_recent_mobile_push_receipts(limit=100)
        if res.get("checked") or res.get("errors") or res.get("disabled"):
            logger.info(f"[scheduler] mobile_push_receipts {res}")
    except Exception as exc:
        _log_task_failure("mobile_push_receipts", exc)


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
        reg_from = _parse_dt(doc.get("registration_open_from"))
        reg_until = _parse_dt(doc.get("registration_open_until"))
        if kind == "f1":
            reg_enabled = doc.get("online_registration_enabled") is True and doc.get("registration_enabled") is True and bool(reg_from or reg_until)
        else:
            reg_enabled = doc.get("registration_enabled") is not False and not doc.get("is_invite_only")
    check_from = _parse_dt(doc.get("check_in_from"))
    check_until = _parse_dt(doc.get("check_in_until"))
    start = _parse_dt(doc.get("start_date"))
    end = _parse_dt(doc.get("end_date"))

    if status in ("draft", "paused", "completed", "results_published", "archived", "cancelled"):
        return None
    auto_start_enabled = bool(doc.get("auto_start_enabled"))
    if end and now >= end and (kind != "tournament" or auto_start_enabled):
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
        if kind == "tournament" and not auto_start_enabled:
            return None
        return "live"
    return None


async def _prepare_tournament_transition(db, doc: dict, next_status: str) -> bool:
    if next_status not in {"check_in", "live"}:
        return True
    try:
        from routes.tournament_routes import (
            _collect_plan_matches,
            _finalize_bracket_for_checkin,
            _live_start_blocker,
            _planning_report,
        )
        tournament = {**doc, "status": next_status}
        await _finalize_bracket_for_checkin(db, tournament, None)
        if next_status == "live":
            matches, current = await _collect_plan_matches(db, doc["id"])
            participant_count = await db.tournament_registrations.count_documents({
                "tournament_id": doc["id"],
                "status": {"$in": ["approved", "checked_in"]},
            })
            report = _planning_report(
                matches,
                current,
                participant_count=participant_count,
                require_fixed_bracket=True,
            )
            if _live_start_blocker(report, force=False):
                logger.warning(
                    "[scheduler] tournament auto-start blocked for %s errors=%s",
                    doc.get("id"),
                    report.get("error_count", 0),
                )
                return False
        return True
    except Exception as exc:
        logger.warning(
            "[scheduler] tournament transition preparation failed for %s type=%s",
            doc.get("id"),
            type(exc).__name__,
        )
        return next_status == "check_in"


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
                    if kind == "tournament" and not await _prepare_tournament_transition(db, doc, nxt):
                        continue
                    await db[collection_name].update_one(
                        {"id": doc["id"]},
                        {"$set": {"status": nxt, "updated_at": now_iso}},
                    )
                    changed += 1
        if changed:
            logger.info(f"[scheduler] status_transitions changed={changed}")
    except Exception as exc:
        _log_task_failure("status_transitions", exc)


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler:
        return _scheduler
    sched = AsyncIOScheduler(timezone="UTC")
    sched.add_job(_safe_mail_queue, IntervalTrigger(seconds=30), id="mail_queue",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_match_reminders, IntervalTrigger(minutes=5), id="match_reminders",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_tournament_reminders, IntervalTrigger(seconds=60), id="tournament_reminders",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_scheduled_news, IntervalTrigger(seconds=60), id="scheduled_news",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_prize_expiry, IntervalTrigger(minutes=60), id="prize_expiry",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_f1_prize_reminders, IntervalTrigger(minutes=5), id="f1_prize_reminders",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_birthday_greetings, IntervalTrigger(hours=6), id="birthday_greetings",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_twitch_poll, IntervalTrigger(seconds=90), id="twitch_poll",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_game_server_sync, IntervalTrigger(seconds=60), id="game_server_sync",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_mobile_push_receipts, IntervalTrigger(minutes=5), id="mobile_push_receipts",
                  max_instances=1, coalesce=True)
    sched.add_job(_safe_status_transitions, IntervalTrigger(seconds=60), id="status_transitions",
                  max_instances=1, coalesce=True)
    sched.start()
    _scheduler = sched
    logger.info("[scheduler] started (mail_queue 30s · match_reminders 5m · tournament_reminders 60s · scheduled_news 60s · prize_expiry 60m · f1_prize_reminders 5m · birthday 6h · twitch 90s · game_server_sync 60s · mobile_push_receipts 5m)")
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
