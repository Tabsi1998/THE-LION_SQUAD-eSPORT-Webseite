"""Admin-only routes: dashboard KPIs, audit logs, notifications."""
import os
import pathlib
import logging
import json
import re
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from database import get_db
from auth import require_admin, require_club_admin, get_current_user, get_optional_user, require_any_admin, require_area
from models import new_id, now_utc
from services.competition_read import count_matches_by_status
from services.user_notifications import create_user_notification

from services.ops_monitor import errors_overview, ops_summary, set_error_resolved, slow_overview
from services.ops_alerts import ALERT_KINDS, alert_red_checks, load_alert_settings, recent_alerts, save_alert_settings, send_test_alert
from services.ops_checks import checks_overview, run_checks
from services.ops_vitals import vitals_overview
from services import github_releases
from services.app_releases import delete_release, list_releases, public_release, set_updater_settings, store_release, update_release, updater_settings, upload_token_matches, upload_token_problem, upload_token_status

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = logging.getLogger("tls.admin")


class MobileLogPatch(BaseModel):
    status: str | None = Field(default=None, max_length=20)
    admin_note: str | None = Field(default=None, max_length=2000)


class MobilePushTestCreate(BaseModel):
    user_id: str | None = Field(default=None, max_length=80)
    title: str = Field(default="LionsAPP Push-Test", max_length=120)
    body: str = Field(default="Wenn du diese Nachricht am Handy siehst, funktionieren Push-Benachrichtigungen.", max_length=240)


def _token_preview(token: str | None) -> str:
    value = str(token or "")
    return f"{value[:24]}..." if len(value) > 24 else value


def _safe_log_limit(limit: int | None, default: int = 80) -> int:
    try:
        value = int(limit or default)
    except (TypeError, ValueError):
        value = default
    return max(1, min(value, 200))


def _clip_log_text(value, limit: int = 900) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        try:
            value = json.dumps(value, ensure_ascii=False, default=str)
        except TypeError:
            value = str(value)
    text = str(value)
    return text if len(text) <= limit else f"{text[:limit - 1]}…"


def _log_time(row: dict, *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if not value:
            continue
        if hasattr(value, "isoformat"):
            return value.isoformat()
        return str(value)
    return ""


def _log_item(source: str, label: str, href: str, row: dict, *, severity: str, title: str, subtitle: str = "", detail="", status: str = "", time_keys=("created_at",)) -> dict:
    return {
        "id": row.get("id") or f"{source}:{_log_time(row, *time_keys)}:{title}",
        "source": source,
        "source_label": label,
        "href": href,
        "severity": severity,
        "status": status,
        "time": _log_time(row, *time_keys),
        "title": _clip_log_text(title, 180),
        "subtitle": _clip_log_text(subtitle, 260),
        "detail": _clip_log_text(detail, 1200),
    }


def _source_summary(key: str, label: str, href: str, *, total: int, problem_count: int, items: list[dict], tone: str = "info") -> dict:
    latest_at = max((item.get("time") or "" for item in items), default="")
    return {
        "key": key,
        "label": label,
        "href": href,
        "total": total,
        "problem_count": problem_count,
        "latest_at": latest_at,
        "tone": tone,
        "items": items,
    }


@router.get("/growth-stats")
async def growth_stats(days: int = 30, me: dict = Depends(require_any_admin())):
    """Login + member growth for the dashboard mini chart (last N days)."""
    days = max(7, min(int(days or 30), 90))
    db = get_db()
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    start_iso = start.isoformat()
    login_rows = await db.refresh_tokens.aggregate([
        {"$match": {"created_at": {"$gte": start, "$type": "date"}, "$expr": {"$eq": ["$family_id", "$jti"]}}},
        {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}}, "count": {"$sum": 1}}},
    ]).to_list(200)
    user_rows = await db.users.aggregate([
        {"$match": {"created_at": {"$gte": start_iso}}},
        {"$group": {"_id": {"$substrBytes": ["$created_at", 0, 10]}, "count": {"$sum": 1}}},
    ]).to_list(200)
    base_users = await db.users.count_documents({"created_at": {"$lt": start_iso}})
    logins_by_day = {row["_id"]: row["count"] for row in login_rows}
    users_by_day = {row["_id"]: row["count"] for row in user_rows}
    out = []
    total = base_users
    for i in range(days):
        day = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        new_users = users_by_day.get(day, 0)
        total += new_users
        out.append({
            "date": day,
            "logins": logins_by_day.get(day, 0),
            "new_users": new_users,
            "total_users": total,
        })
    return {"days": out, "window_days": days}


@router.get("/dashboard")
async def dashboard(me: dict = Depends(require_any_admin())):
    db = get_db()
    try:
        from services.push_notifications import mobile_push_health_summary
        mobile_push = await mobile_push_health_summary()
    except Exception as exc:
        logger.warning("mobile push summary failed", exc_info=True)
        mobile_push = {"active_tokens": 0, "users_with_tokens": 0, "ticket_errors": 0, "receipt_errors": 0, "error": "Push-Status konnte nicht geladen werden."}
    client_logs = {
        "open": await db.mobile_client_logs.count_documents({"status": "open"}),
        "critical_open": await db.mobile_client_logs.count_documents({"status": "open", "priority": "critical"}),
        "high_open": await db.mobile_client_logs.count_documents({"status": "open", "priority": "high"}),
    }
    membership_applications = {
        "pending": await db.membership_applications.count_documents({"status": "pending"}),
    }
    prize_pickups = {
        "pending": await db.prize_pickups.count_documents({"status": "pending"}),
        "ready": await db.prize_pickups.count_documents({"status": "ready"}),
    }
    tournament_registrations = {
        "pending": await db.tournament_registrations.count_documents({"status": "pending"}),
    }
    today_matches = await count_matches_by_status(db, {"ready", "in_progress"})
    open_disputes = await count_matches_by_status(db, {"disputed"})
    # Tageszentrale (#227): gemeldete Ergebnisse, Meldungen, Kontakt, verfallende Terminvorschläge, Termine heute.
    try:
        from services.daily_center import task_counts, today_items
        daily_tasks = await task_counts(db)
        today = await today_items(db)
    except Exception:  # noqa: BLE001 - die Tageszentrale darf daran nicht scheitern
        logger.warning("daily center failed", exc_info=True)
        daily_tasks, today = {}, []
    try:
        ops = await ops_summary(db)
    except Exception:  # noqa: BLE001 - die Tageszentrale darf daran nicht scheitern
        logger.warning("ops summary failed", exc_info=True)
        ops = None
    # Discord-Kanal ohne Recht oder gelöscht (#303, #566): nur für den, der es in den Einstellungen beheben kann.
    discord_broken = []
    try:
        from services.permissions import user_has_area
        if await user_has_area(me, "system"):
            from discord_service import broken_targets
            discord_broken = await broken_targets(db)
    except Exception:  # noqa: BLE001 - die Tageszentrale darf daran nicht scheitern
        logger.warning("discord status failed", exc_info=True)
    return {
        "ops": ops,
        "discord_broken": discord_broken,
        "player_count": await db.users.count_documents({"is_active": True}),
        "team_count": await db.teams.count_documents({}),
        "active_tournaments": await db.tournaments.count_documents({"status": {"$in": ["live", "check_in"]}}),
        "registration_open": await db.tournaments.count_documents({"status": "registration_open"}),
        "today_matches": today_matches,
        "open_disputes": open_disputes,
        "active_f1": await db.f1_challenges.count_documents({"status": "live"}),
        "total_tournaments": await db.tournaments.count_documents({}),
        "total_f1_challenges": await db.f1_challenges.count_documents({}),
        "total_events": await db.events.count_documents({}),
        "mobile_push": mobile_push,
        "client_logs": client_logs,
        "membership_applications": membership_applications,
        "prize_pickups": prize_pickups,
        "tournament_registrations": tournament_registrations,
        "daily_tasks": daily_tasks,
        "today": today,
        "recent_audit_logs": await db.audit_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(20),
    }


@router.get("/audit-logs")
async def audit_logs(limit: int = 100, me: dict = Depends(require_club_admin())):
    db = get_db()
    safe_limit = max(1, min(int(limit or 100), 500))
    logs = await db.audit_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(safe_limit)
    return logs


@router.get("/mobile-logs")
async def mobile_client_logs(
    limit: int = Query(default=100, ge=1, le=500),
    level: str = "",
    status: str = "",
    priority: str = "",
    platform: str = "",
    user_id: str = "",
    q: str = "",
    me: dict = Depends(require_club_admin()),
):
    db = get_db()
    query = {}
    if level:
        query["level"] = level.strip().lower()
    if status:
        query["status"] = status.strip().lower()
    if priority:
        query["priority"] = priority.strip().lower()
    if platform:
        query["platform"] = platform.strip().lower()
    if user_id:
        query["user_id"] = user_id.strip()
    search = re.escape(q.strip()[:80])
    if search:
        query["$or"] = [
            {"message": {"$regex": search, "$options": "i"}},
            {"source": {"$regex": search, "$options": "i"}},
            {"screen": {"$regex": search, "$options": "i"}},
            {"username": {"$regex": search, "$options": "i"}},
            {"display_name": {"$regex": search, "$options": "i"}},
        ]
    return await db.mobile_client_logs.find(query, {"_id": 0}).sort([("priority_rank", 1), ("received_at", -1)]).to_list(limit)


# ---------------------------------------------------------------- Betrieb (#233)

@router.get("/ops/summary")
async def ops_overview(me: dict = Depends(require_club_admin())):
    return await ops_summary(get_db())


@router.get("/ops/errors")
async def ops_errors(
    status: str = Query(default="open", pattern="^(open|resolved|all)$"),
    limit: int = Query(default=100, ge=1, le=500),
    me: dict = Depends(require_club_admin()),
):
    return await errors_overview(get_db(), status=status, limit=limit)


@router.post("/ops/errors/{fingerprint}/resolve")
async def ops_error_resolve(fingerprint: str, me: dict = Depends(require_club_admin())):
    row = await set_error_resolved(get_db(), fingerprint, True)
    if not row:
        raise HTTPException(status_code=404, detail="Fehlergruppe nicht gefunden")
    return row


@router.post("/ops/errors/{fingerprint}/reopen")
async def ops_error_reopen(fingerprint: str, me: dict = Depends(require_club_admin())):
    row = await set_error_resolved(get_db(), fingerprint, False)
    if not row:
        raise HTTPException(status_code=404, detail="Fehlergruppe nicht gefunden")
    return row


@router.get("/ops/slow")
async def ops_slow(
    hours: int = Query(default=24, ge=1, le=720),
    limit: int = Query(default=50, ge=1, le=200),
    me: dict = Depends(require_club_admin()),
):
    return await slow_overview(get_db(), hours=hours, limit=limit)


# ---------------------------------------------------------------- Betrieb II (#265)

@router.get("/ops/vitals")
async def ops_vitals(days: int = Query(default=7, ge=1, le=30), me: dict = Depends(require_club_admin())):
    return await vitals_overview(get_db(), days=days)


@router.get("/ops/checks")
async def ops_checks(me: dict = Depends(require_club_admin())):
    return await checks_overview(get_db())


@router.post("/ops/checks/run")
async def ops_checks_run(me: dict = Depends(require_club_admin())):
    """Jetzt prüfen - mit denselben Alarmen wie der Scheduler, gedrosselt."""
    db = get_db()
    run = await run_checks(db)
    await alert_red_checks(db, run)
    return run


# ---------------------------------------------------------------- Alarme (#517): Regeln je Ereignisart, Testalarm

class OpsAlertSettingsBody(BaseModel):
    emails: list[str] | str | None = None
    cooldown_minutes: int | None = None
    rules: dict[str, dict[str, bool]] | None = None
    retention_days: dict[str, int] | None = None


@router.get("/ops/alerts")
async def ops_alerts_view(me: dict = Depends(require_club_admin())):
    db = get_db()
    return {
        "settings": await load_alert_settings(db),
        "kinds": [{"key": key, "label": spec["label"], "hint": spec["hint"], "email_allowed": spec.get("email_allowed", True)} for key, spec in ALERT_KINDS.items()],
        "recent": await recent_alerts(db),
    }


@router.put("/ops/alerts")
async def ops_alerts_save(body: OpsAlertSettingsBody, me: dict = Depends(require_area("system"))):
    try:
        return await save_alert_settings(get_db(), body.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/ops/alerts/test")
async def ops_alerts_test(me: dict = Depends(require_area("system"))):
    """Geht alle Wege, die irgendeine Regel nutzt - ohne Sperrfrist."""
    return await send_test_alert(get_db())


HREFS = {
    "uploads": "/admin/media", "client": "/admin/ops?tab=app", "audit": "/admin/ops?tab=events&source=audit",
    "email": "/admin/ops?tab=events&source=email", "mail_queue": "/admin/settings/mail-queue", "server": "/admin/ops?tab=errors",
    "checks": "/admin/ops?tab=checks", "alerts": "/admin/ops?tab=alerts", "sync": "/admin/dolibarr", "bot": "/admin/integrations/discord",
}
SEVERITY_FILTERS = {"problem": {"error", "warn"}, "error": {"error"}, "warn": {"warn"}, "info": {"info"}, "success": {"success"}}


def _since_iso_hours(hours: int) -> str:
    from datetime import timedelta
    return (now_utc() - timedelta(hours=int(hours))).isoformat() if hours else ""


async def _log_sources(db, safe_limit: int, *, since_iso: str = "") -> list[dict]:
    """Alle Ereignisquellen als eine Liste je Quelle (#517 Teil 2): Uploads, App-Logs, Adminaktionen,
    E-Mail-Versand, Mail-Queue, Serverfehler, Auto-Checks, Alarme, Dolibarr-Abgleich, Discord-Bot.
    Ohne Namen, Adressen oder Tokens - so, wie die Quellen es selbst schon halten."""
    def since(field: str) -> dict:
        return {field: {"$gte": since_iso}} if since_iso else {}

    upload_rows = await db.upload_events.find(since("created_at"), {"_id": 0}).sort("created_at", -1).limit(safe_limit).to_list(safe_limit)
    upload_items = [
        _log_item("uploads", "Uploads", HREFS["uploads"], row,
                  severity="success" if row.get("status") == "success" else "warn" if row.get("status") == "client_failed" else "error",
                  status=row.get("status") or "", title=row.get("filename") or "Upload",
                  subtitle=" · ".join(filter(None, [row.get("kind"), row.get("media_scope"), row.get("mime")])),
                  detail=row.get("detail") or (row.get("result") or {}).get("url") or "", time_keys=("created_at",))
        for row in upload_rows
    ]

    client_rows = await db.mobile_client_logs.find(since("received_at"), {"_id": 0}).sort([("priority_rank", 1), ("received_at", -1)]).limit(safe_limit).to_list(safe_limit)
    client_items = []
    for row in client_rows:
        level = row.get("level") or "info"
        severity = "error" if level in {"fatal", "error"} else "warn" if level == "warn" else "info"
        client_items.append(_log_item("client", "App-Logs", HREFS["client"], row, severity=severity, status=row.get("status") or level,
                                      title=row.get("message") or row.get("error_name") or "Client-Log",
                                      subtitle=" · ".join(filter(None, [row.get("source"), row.get("screen"), row.get("display_name") or row.get("username"), row.get("platform")])),
                                      detail=row.get("stack") or row.get("context") or "", time_keys=("received_at", "created_at")))

    audit_rows = await db.audit_logs.find(since("created_at"), {"_id": 0}).sort("created_at", -1).limit(safe_limit).to_list(safe_limit)
    audit_items = [
        _log_item("audit", "Adminaktionen", HREFS["audit"], row, severity="info", status="audit", title=row.get("action") or "Admin-Aktion",
                  subtitle=" · ".join(filter(None, [row.get("actor_display_name") or row.get("actor_username") or row.get("actor_id"), row.get("target_id")])),
                  detail=row.get("data") or "", time_keys=("created_at",))
        for row in audit_rows
    ]

    email_rows = await db.email_logs.find(since("created_at"), {"_id": 0}).sort("created_at", -1).limit(safe_limit).to_list(safe_limit)
    email_items = []
    for row in email_rows:
        status = row.get("status") or ""
        severity = "success" if status == "sent" else "error" if status == "failed" else "warn" if status == "skipped" else "info"
        email_items.append(_log_item("email", "E-Mail-Versand", HREFS["email"], row, severity=severity, status=status,
                                     title=row.get("template_key") or row.get("event_key") or row.get("subject") or "Versand",
                                     subtitle=" · ".join(filter(None, [row.get("channel") or "email", row.get("to")])),
                                     detail=row.get("error") or row.get("message_id") or "", time_keys=("created_at",)))

    queue_rows = await db.mail_jobs.find(since("created_at"), {"_id": 0, "html": 0}).sort("created_at", -1).limit(safe_limit).to_list(safe_limit)
    queue_items = []
    for row in queue_rows:
        status = row.get("status") or ""
        severity = "success" if status == "sent" else "error" if status == "failed" else "warn" if status == "skipped" else "info"
        queue_items.append(_log_item("mail_queue", "Mail-Queue", HREFS["mail_queue"], row, severity=severity, status=status,
                                     title=row.get("template_key") or row.get("subject") or "Mail-Job",
                                     subtitle=" · ".join(filter(None, [row.get("to"), f"{row.get('attempts', 0)} Versuch(e)"])),
                                     detail=row.get("last_error") or row.get("next_attempt_at") or row.get("message_id") or "", time_keys=("updated_at", "created_at")))

    # Serverfehler (Gruppen), Auto-Checks, Alarme - bisher nur unter Betrieb, jetzt auch in der Liste.
    error_rows = await db.ops_errors.find(since("last_seen_at"), {"_id": 0, "stack": 0}).sort("last_seen_at", -1).limit(safe_limit).to_list(safe_limit)
    server_items = [
        _log_item("server", "Serverfehler", HREFS["server"], row, severity="info" if row.get("resolved_at") else "error",
                  status="gelöst" if row.get("resolved_at") else "offen",
                  title=f"{row.get('error_type') or 'Fehler'} · {row.get('method') or ''} {row.get('route') or ''}".strip(),
                  subtitle=f"{row.get('count') or 1}× · HTTP {row.get('status_code') or '?'} · {row.get('actor') or ''}".strip(" ·"),
                  detail=row.get("message") or "", time_keys=("last_seen_at", "first_seen_at"))
        for row in error_rows
    ]

    check_rows = await db.ops_check_runs.find({**since("at"), "status": {"$ne": "ok"}}, {"_id": 0, "checks": 0}).sort("at", -1).limit(safe_limit).to_list(safe_limit)
    check_items = [
        _log_item("checks", "Auto-Checks", HREFS["checks"], row, severity="error" if row.get("status") == "crit" else "warn", status=row.get("status") or "",
                  title="Auto-Checks rot" if row.get("status") == "crit" else "Auto-Checks gelb",
                  subtitle=", ".join(row.get("failing") or []),
                  detail=f"{(row.get('counts') or {}).get('crit', 0)} rot · {(row.get('counts') or {}).get('warn', 0)} gelb · {(row.get('counts') or {}).get('ok', 0)} grün",
                  time_keys=("at",))
        for row in check_rows
    ]

    alert_rows = await db.ops_alert_log.find(since("at"), {"_id": 0}).sort("at", -1).limit(safe_limit).to_list(safe_limit)
    alert_items = [
        _log_item("alerts", "Alarme", HREFS["alerts"], row, severity="warn" if row.get("kind") != "test" else "info", status=row.get("kind") or "",
                  title=row.get("title") or "Alarm",
                  subtitle=", ".join(row.get("channels") or []) or "kein Weg eingerichtet",
                  detail=row.get("description") or "", time_keys=("at",))
        for row in alert_rows
    ]

    sync_state = await db.settings.find_one({"id": "dolibarr_sync_state"}, {"_id": 0}) or {}
    sync_items = []
    last_error = sync_state.get("last_error") if isinstance(sync_state.get("last_error"), dict) else None
    if last_error:
        sync_items.append(_log_item("sync", "Dolibarr-Abgleich", HREFS["sync"], {"at": sync_state.get("last_run_at") or last_error.get("at")}, severity="error", status="rot",
                                    title="Dolibarr-Abgleich rot", subtitle=str(last_error.get("kind") or ""), detail=last_error.get("text") or "", time_keys=("at",)))
    elif sync_state.get("last_ok_at"):
        sync_items.append(_log_item("sync", "Dolibarr-Abgleich", HREFS["sync"], {"at": sync_state.get("last_ok_at")}, severity="success", status="grün",
                                    title="Dolibarr-Abgleich grün", subtitle="", detail="", time_keys=("at",)))
    if since_iso:
        sync_items = [item for item in sync_items if (item.get("time") or "") >= since_iso]

    bot_state = await db.settings.find_one({"id": "discord_bot_state"}, {"_id": 0}) or {}
    bot_items = []
    if bot_state:
        bot_error = bot_state.get("last_error") or bot_state.get("error")
        status = str(bot_state.get("status") or ("online" if bot_state.get("running") else ""))
        if bot_error:
            bot_items.append(_log_item("bot", "Discord-Bot", HREFS["bot"], bot_state, severity="error", status=status or "fehler", title="Discord-Bot: Fehler",
                                       subtitle=str(bot_state.get("guild_name") or ""), detail=bot_error, time_keys=("updated_at",)))
        elif status:
            bot_items.append(_log_item("bot", "Discord-Bot", HREFS["bot"], bot_state, severity="success" if status == "online" else "info", status=status,
                                       title=f"Discord-Bot {status}", subtitle=str(bot_state.get("guild_name") or ""), detail="", time_keys=("updated_at",)))
    if since_iso:
        bot_items = [item for item in bot_items if (item.get("time") or "") >= since_iso]

    return [
        _source_summary("server", "Serverfehler", HREFS["server"], total=await db.ops_errors.count_documents({}), problem_count=await db.ops_errors.count_documents({"resolved_at": None}), items=server_items, tone="danger"),
        _source_summary("checks", "Auto-Checks", HREFS["checks"], total=await db.ops_check_runs.count_documents({}), problem_count=await db.ops_check_runs.count_documents({"status": {"$ne": "ok"}}), items=check_items, tone="danger"),
        _source_summary("alerts", "Alarme", HREFS["alerts"], total=await db.ops_alert_log.count_documents({}), problem_count=0, items=alert_items, tone="warn"),
        _source_summary("client", "App-Logs", HREFS["client"], total=await db.mobile_client_logs.count_documents({}), problem_count=await db.mobile_client_logs.count_documents({"status": "open"}), items=client_items, tone="danger"),
        _source_summary("email", "E-Mail-Versand", HREFS["email"], total=await db.email_logs.count_documents({}), problem_count=await db.email_logs.count_documents({"status": {"$in": ["failed", "skipped"]}}), items=email_items, tone="warn"),
        _source_summary("mail_queue", "Mail-Queue", HREFS["mail_queue"], total=await db.mail_jobs.count_documents({}), problem_count=await db.mail_jobs.count_documents({"status": "failed"}), items=queue_items, tone="warn"),
        _source_summary("audit", "Adminaktionen", HREFS["audit"], total=await db.audit_logs.count_documents({}), problem_count=0, items=audit_items, tone="info"),
        _source_summary("uploads", "Uploads", HREFS["uploads"], total=await db.upload_events.count_documents({}), problem_count=await db.upload_events.count_documents({"status": {"$ne": "success"}}), items=upload_items, tone="warn"),
        _source_summary("sync", "Dolibarr-Abgleich", HREFS["sync"], total=len(sync_items), problem_count=1 if last_error else 0, items=sync_items, tone="danger"),
        _source_summary("bot", "Discord-Bot", HREFS["bot"], total=len(bot_items), problem_count=sum(1 for item in bot_items if item["severity"] == "error"), items=bot_items, tone="danger"),
    ]


@router.get("/logs")
async def admin_logs_overview(limit: int = Query(default=80, ge=1, le=200), me: dict = Depends(require_club_admin())):
    db = get_db()
    safe_limit = _safe_log_limit(limit)
    sources = await _log_sources(db, safe_limit)
    combined = sorted([item for source in sources for item in source["items"]], key=lambda item: item.get("time") or "", reverse=True)[:safe_limit * 2]
    return {
        "sources": sources,
        "combined": combined,
        "summary": {
            "total": sum(source["total"] for source in sources),
            "problem_count": sum(source["problem_count"] for source in sources),
            "latest_at": max((source["latest_at"] for source in sources), default=""),
        },
    }


@router.get("/ops/events")
async def ops_events(source: str = "all", severity: str = "all", hours: int = Query(default=168, ge=0, le=24 * 366), q: str = "",
                     limit: int = Query(default=200, ge=1, le=500), format: str = "json", me: dict = Depends(require_area("system"))):
    """Ereignisse aller Quellen in einer Liste (#517 Teil 2): Filter nach Quelle, Schwere, Zeitraum und Text;
    `format=csv` liefert dieselbe Auswahl als Datei. Zustand und Zähler je Quelle kommen mit."""
    db = get_db()
    since_iso = _since_iso_hours(hours)
    sources = await _log_sources(db, _safe_log_limit(min(limit, 200)), since_iso=since_iso)
    wanted = {part.strip() for part in str(source or "all").split(",") if part.strip()} - {"all", ""}
    severities = SEVERITY_FILTERS.get(str(severity or "all").lower())
    needle = str(q or "").strip().lower()
    items = []
    for entry in sources:
        if wanted and entry["key"] not in wanted:
            continue
        for item in entry["items"]:
            if severities and item.get("severity") not in severities:
                continue
            if needle and needle not in " ".join(str(item.get(key) or "") for key in ("source_label", "title", "subtitle", "detail", "status")).lower():
                continue
            items.append(item)
    items.sort(key=lambda item: item.get("time") or "", reverse=True)
    items = items[:limit]
    if str(format).lower() == "csv":
        import csv
        import io
        from fastapi.responses import Response
        buffer = io.StringIO()
        writer = csv.writer(buffer, delimiter=";")
        writer.writerow(["Zeit", "Schwere", "Quelle", "Status", "Titel", "Details", "Weitere Angaben"])
        for item in items:
            writer.writerow([item.get("time"), item.get("severity"), item.get("source_label"), item.get("status"), item.get("title"), item.get("subtitle"), item.get("detail")])
        return Response(content="﻿" + buffer.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="ereignisse.csv"'})
    return {
        "items": items,
        "sources": [{key: value for key, value in entry.items() if key != "items"} for entry in sources],
        "summary": {
            "shown": len(items),
            "problem_count": sum(source["problem_count"] for source in sources),
            "latest_at": max((source["latest_at"] for source in sources), default=""),
        },
        "filters": {"source": sorted(wanted) or ["all"], "severity": severity, "hours": hours, "q": q, "limit": limit},
    }


@router.patch("/mobile-logs/{log_id}")
async def update_mobile_client_log(log_id: str, body: MobileLogPatch, me: dict = Depends(require_club_admin())):
    db = get_db()
    update = {"updated_at": now_utc().isoformat()}
    if body.status is not None:
        status = body.status.strip().lower()
        if status not in {"open", "info", "resolved", "ignored"}:
            raise HTTPException(status_code=400, detail="Ungültiger Status")
        update["status"] = status
        if status == "resolved":
            update["resolved_at"] = now_utc().isoformat()
            update["resolved_by"] = me["id"]
    if body.admin_note is not None:
        update["admin_note"] = body.admin_note.strip()[:2000]
    result = await db.mobile_client_logs.update_one({"id": log_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Log nicht gefunden")
    return await db.mobile_client_logs.find_one({"id": log_id}, {"_id": 0})


@router.get("/mobile-push/users")
async def mobile_push_users(q: str = "", limit: int = Query(default=40, ge=1, le=100), me: dict = Depends(require_club_admin())):
    db = get_db()
    token_rows = await db.mobile_push_tokens.find(
        {},
        {
            "_id": 0,
            "user_id": 1,
            "token": 1,
            "platform": 1,
            "enabled": 1,
            "updated_at": 1,
            "last_sent_at": 1,
            "last_ticket_status": 1,
            "last_ticket_error": 1,
            "last_receipt_status": 1,
            "last_receipt_error": 1,
        },
    ).sort("updated_at", -1).to_list(500)
    user_ids = list({row.get("user_id") for row in token_rows if row.get("user_id")})
    users = await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "email": 1, "role": 1},
    ).to_list(500)
    user_by_id = {user["id"]: user for user in users if user.get("id")}
    needle = q.strip().lower()
    rows = []
    for user_id in user_ids:
        user = user_by_id.get(user_id) or {"id": user_id}
        haystack = " ".join(str(user.get(key) or "") for key in ("username", "display_name", "email", "id")).lower()
        if needle and needle not in haystack:
            continue
        tokens = [row for row in token_rows if row.get("user_id") == user_id]
        enabled_tokens = [row for row in tokens if row.get("enabled") is not False]
        latest = tokens[0] if tokens else {}
        rows.append({
            **user,
            "token_count": len(tokens),
            "enabled_token_count": len(enabled_tokens),
            "has_enabled_token": bool(enabled_tokens),
            "platforms": sorted({row.get("platform") or "unknown" for row in tokens}),
            "latest_token_preview": _token_preview(latest.get("token")),
            "latest_updated_at": latest.get("updated_at"),
            "last_sent_at": latest.get("last_sent_at"),
            "last_ticket_status": latest.get("last_ticket_status"),
            "last_ticket_error": latest.get("last_ticket_error"),
            "last_receipt_status": latest.get("last_receipt_status"),
            "last_receipt_error": latest.get("last_receipt_error"),
        })
    return rows[:limit]


@router.get("/mobile-push/status/{user_id}")
async def mobile_push_status_for_user(user_id: str, me: dict = Depends(require_club_admin())):
    db = get_db()
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "email": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    tokens = await db.mobile_push_tokens.find({"user_id": user_id}, {"_id": 0}).sort("updated_at", -1).to_list(20)
    for token in tokens:
        token["token_preview"] = _token_preview(token.get("token"))
        token.pop("token", None)
    return {
        "user": user,
        "tokens": tokens,
        "enabled_count": len([row for row in tokens if row.get("enabled") is not False]),
        "has_enabled_token": any(row.get("enabled") is not False for row in tokens),
    }


@router.post("/mobile-push/test")
async def mobile_push_test(body: MobilePushTestCreate, me: dict = Depends(require_club_admin())):
    target_id = body.user_id or me["id"]
    notification = await create_user_notification(
        target_id,
        title=body.title.strip() or "LionsAPP Push-Test",
        body=body.body.strip() or "Wenn du diese Nachricht am Handy siehst, funktionieren Push-Benachrichtigungen.",
        url="/profile?tab=inbox",
        kind="admin_push_test",
        meta={"admin_test": True, "sent_by": me["id"]},
    )
    if not notification:
        raise HTTPException(status_code=400, detail="Benachrichtigung konnte nicht erstellt werden")
    return {"ok": True, "notification": notification}


@router.post("/mobile-push/receipts/{user_id}")
async def mobile_push_receipts_for_user(user_id: str, me: dict = Depends(require_club_admin())):
    db = get_db()
    exists = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
    if not exists:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    from services.push_notifications import check_mobile_push_receipts_for_user
    return await check_mobile_push_receipts_for_user(user_id)


@router.post("/mobile-push/receipts")
async def mobile_push_receipts_all(me: dict = Depends(require_club_admin())):
    from services.push_notifications import check_recent_mobile_push_receipts
    return await check_recent_mobile_push_receipts(limit=200)


def _upload_status() -> dict:
    upload_dir = pathlib.Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
    public_dir = upload_dir / "public"
    doc_dir = upload_dir / "documents"
    checks = []
    for label, path in (("uploads", upload_dir), ("public", public_dir), ("documents", doc_dir)):
        error = ""
        try:
            path.mkdir(parents=True, exist_ok=True)
            probe = path / ".tls-write-test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
        except Exception as exc:
            logger.warning("upload directory write check failed for %s", label, exc_info=True)
            error = "Schreibtest fehlgeschlagen."
            try:
                (path / ".tls-write-test").unlink(missing_ok=True)
            except Exception:
                pass
        exists = path.exists() and path.is_dir()
        writable = os.access(path, os.W_OK) if exists else False
        write_test = exists and not error
        checks.append({
            "label": label,
            "path": str(path),
            "exists": exists,
            "writable": writable,
            "write_test": write_test,
            "ok": exists and writable and write_test,
            "error": error,
        })
    return {"ok": all(c["ok"] for c in checks), "checks": checks}


@router.get("/system-status")
async def system_status(me: dict = Depends(require_any_admin())):
    db = get_db()
    mail = await db.settings.find_one({"id": "mail"}, {"_id": 0}) or {}
    discord = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    latest_mail_error = await db.email_logs.find_one(
        {
            "status": {"$in": ["failed", "skipped"]},
            "$or": [{"channel": {"$exists": False}}, {"channel": {"$ne": "discord"}}],
        },
        {"_id": 0, "created_at": 1, "status": 1, "error": 1, "template_key": 1, "event_key": 1, "channel": 1},
        sort=[("created_at", -1)],
    )
    latest_discord = await db.email_logs.find_one(
        {"channel": "discord"},
        {"_id": 0, "created_at": 1, "status": 1, "error": 1, "event_key": 1},
        sort=[("created_at", -1)],
    )
    try:
        from services.mail_queue import mail_queue_stats
        queue_stats = await mail_queue_stats()
        queue_counts = queue_stats.get("counts", {})
    except Exception:
        queue_stats = {}
        queue_counts = {}
        for status in ("pending", "sending", "sent", "failed", "skipped"):
            queue_counts[status] = await db.mail_jobs.count_documents({"status": status})
    try:
        from services.scheduler import get_scheduler_status
        scheduler = get_scheduler_status()
    except Exception as exc:
        logger.warning("scheduler status failed", exc_info=True)
        scheduler = {"running": False, "jobs": [], "error": "Scheduler-Status konnte nicht geladen werden."}
    try:
        from services.push_notifications import mobile_push_health_summary
        mobile_push = await mobile_push_health_summary()
    except Exception as exc:
        logger.warning("mobile push health failed", exc_info=True)
        mobile_push = {"active_tokens": 0, "users_with_tokens": 0, "ticket_errors": 0, "receipt_errors": 0, "error": "Push-Status konnte nicht geladen werden."}
    try:
        await db.command("ping")
        database = {"ok": True}
    except Exception as exc:
        logger.warning("database health check failed", exc_info=True)
        database = {"ok": False, "error": "Datenbankprüfung fehlgeschlagen."}
    uploads = _upload_status()
    smtp_ready = bool(mail.get("enabled", True)) and (
        mail.get("provider") == "smtp" and bool(mail.get("smtp_host"))
        or mail.get("provider") == "resend" and bool(mail.get("resend_api_key"))
        or bool(mail.get("smtp_host"))
    )
    # Discord III (#566): gesendet wird nur über den Bot - ohne Bot oder Kanal ist nichts „ok“.
    discord_channels = discord.get("channels") if isinstance(discord.get("channels"), dict) else {}
    discord_configured = any(str(value or "").strip() for value in discord_channels.values())
    discord_ready = bool(discord.get("enabled", True)) and bool(discord.get("bot_enabled")) and discord_configured
    return {
        "database": database,
        "smtp": {
            "ok": smtp_ready,
            "provider": mail.get("provider") or ("smtp" if mail.get("smtp_host") else "resend"),
            "host": mail.get("smtp_host") or "",
            "sender_email": mail.get("sender_email") or "",
            "latest_problem": latest_mail_error,
        },
        "discord": {
            "ok": discord_ready,
            "configured": discord_configured,
            "bot_enabled": bool(discord.get("bot_enabled")),
            "enabled": bool(discord.get("enabled", True)),
            "latest": latest_discord,
        },
        "uploads": uploads,
        "scheduler": scheduler,
        "mobile_push": mobile_push,
        "mail_queue": {**queue_counts, **{k: v for k, v in queue_stats.items() if k != "counts"}},
    }


@router.get("/notifications")
async def my_notifications(me: dict = Depends(get_current_user)):
    db = get_db()
    notes = await db.notifications.find({"user_id": me["id"], "in_app_visible": {"$ne": False}}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return notes


@router.post("/notifications/{nid}/read")
async def mark_read(nid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    await db.notifications.update_one({"id": nid, "user_id": me["id"], "in_app_visible": {"$ne": False}}, {"$set": {"read": True}})
    return {"ok": True}


@router.post("/notifications/read-all")
async def mark_all_read(me: dict = Depends(get_current_user)):
    db = get_db()
    await db.notifications.update_many({"user_id": me["id"], "read": {"$ne": True}, "in_app_visible": {"$ne": False}}, {"$set": {"read": True}})
    return {"ok": True}


@router.delete("/notifications/read")
async def delete_read_notifications(me: dict = Depends(get_current_user)):
    db = get_db()
    result = await db.notifications.delete_many({"user_id": me["id"], "read": True, "in_app_visible": {"$ne": False}})
    return {"ok": True, "deleted": result.deleted_count}


@router.delete("/notifications/{nid}")
async def delete_notification(nid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    result = await db.notifications.delete_one({"id": nid, "user_id": me["id"], "in_app_visible": {"$ne": False}})
    return {"ok": True, "deleted": result.deleted_count}


# ---------------------------------------------------------------- App-Releases (#250)

class AppReleaseUpdate(BaseModel):
    min_build: int | None = Field(default=None, ge=0)
    is_current: bool | None = None
    notes: str | None = Field(default=None, max_length=8000)


async def _release_uploader(request: Request, user: dict | None = Depends(get_optional_user)) -> str:
    """Wer darf hochladen: der Vereinsadmin (Sitzung) oder das Release-Skript (Token aus der Server-Umgebung)."""
    presented = request.headers.get("X-Release-Token")
    if upload_token_matches(presented):
        return "release-script"
    problem = upload_token_problem(presented)
    if problem:
        # Das Skript hat ein Token geschickt: sagen, woran es liegt (#307).
        raise HTTPException(status_code=401, detail=problem)
    if not user:
        raise HTTPException(status_code=401, detail="Nicht angemeldet")
    if user.get("role") not in {"club_admin", "superadmin"}:
        raise HTTPException(status_code=403, detail="Nur Vereinsadmins")
    if not user.get("mfa_enabled") or not user.get("auth_mfa_verified"):
        raise HTTPException(status_code=403, detail="Für den Adminbereich ist eine bestätigte Zwei-Faktor-Anmeldung erforderlich.")
    return f"admin:{user.get('id')}"


@router.get("/app-releases")
async def admin_app_releases(me: dict = Depends(require_club_admin())):
    return await list_releases(get_db())


@router.get("/app-releases/status")
async def admin_app_release_status(me: dict = Depends(require_club_admin())):
    """Ob das Release-Skript hochladen kann: Token am Server ja/nein (#307)."""
    return {"upload_token": upload_token_status()}


class AppReleaseSettingsUpdate(BaseModel):
    server_updater_enabled: bool


@router.get("/app-releases/settings")
async def admin_app_release_settings(me: dict = Depends(require_club_admin())):
    """Server-Updater an/aus (#421) - vor der {build}-Route, damit „settings“ keine Buildnummer ist."""
    return await updater_settings(get_db())


@router.patch("/app-releases/settings")
async def admin_app_release_settings_update(body: AppReleaseSettingsUpdate, me: dict = Depends(require_club_admin())):
    result = await set_updater_settings(get_db(), server_updater_enabled=body.server_updater_enabled, by=me["id"])
    await get_db().audit_logs.insert_one({
        "id": new_id(), "action": "app_release.settings", "actor": me["id"],
        "target": "server_updater", "details": result, "created_at": now_utc().isoformat(),
    })
    return result


class GithubReleaseSettingsUpdate(BaseModel):
    github_token: str | None = Field(default=None, max_length=400)
    clear_github_token: bool = False
    github_repo: str | None = Field(default=None, max_length=200)
    github_sync_enabled: bool | None = None
    github_rollout_betas: bool | None = None


@router.get("/app-releases/github")
async def admin_app_release_github(me: dict = Depends(require_club_admin())):
    """GitHub-Abgleich (#309): Stand und Schalter - das Token bleibt beim Server."""
    return await github_releases.settings(get_db())


@router.patch("/app-releases/github")
async def admin_app_release_github_update(body: GithubReleaseSettingsUpdate, me: dict = Depends(require_club_admin())):
    try:
        result = await github_releases.save_settings(
            get_db(), by=me["id"], github_token=body.github_token, clear_github_token=body.clear_github_token,
            github_repo=body.github_repo, github_sync_enabled=body.github_sync_enabled, github_rollout_betas=body.github_rollout_betas,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await get_db().audit_logs.insert_one({
        "id": new_id(), "action": "app_release.github_settings", "actor": me["id"], "target": "github",
        "details": {key: value for key, value in result.items() if key.startswith("github_") and "token" not in key},
        "created_at": now_utc().isoformat(),
    })
    return result


@router.post("/app-releases/github/sync")
async def admin_app_release_github_sync(me: dict = Depends(require_club_admin())):
    """„Jetzt abgleichen“ - auch, wenn der Hintergrundjob aus ist."""
    result = await github_releases.sync(get_db(), force=True)
    await get_db().audit_logs.insert_one({
        "id": new_id(), "action": "app_release.github_sync", "actor": me["id"], "target": "github",
        "details": {"imported": [row["build"] for row in result.get("imported", [])], "errors": result.get("errors", []), "skipped": result.get("skipped")},
        "created_at": now_utc().isoformat(),
    })
    return {**result, "settings": await github_releases.settings(get_db())}


@router.post("/app-releases")
async def admin_app_release_upload(
    file: UploadFile = File(...),
    version: str = Form(...),
    build: int = Form(...),
    notes: str = Form(default=""),
    min_build: int | None = Form(default=None),
    set_current: bool = Form(default=True),
    source: str = Depends(_release_uploader),
):

    async def chunks():
        while True:
            piece = await file.read(1024 * 1024)
            if not piece:
                break
            yield piece

    try:
        stored = await store_release(
            get_db(), build=build, version=version, notes=notes, chunks=chunks(),
            min_build=min_build, set_current=set_current, source=source,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await get_db().audit_logs.insert_one({
        "id": new_id(), "action": "app_release.upload", "actor": source,
        "target": f"build {int(build)}", "details": {"version": version, "size": stored.get("size"), "sha256": stored.get("sha256")},
        "created_at": now_utc().isoformat(),
    })
    return public_release(stored)


@router.patch("/app-releases/{build}")
async def admin_app_release_update(build: int, body: AppReleaseUpdate, me: dict = Depends(require_club_admin())):
    doc = await update_release(get_db(), build, min_build=body.min_build, is_current=body.is_current, notes=body.notes)
    if not doc:
        raise HTTPException(status_code=404, detail="Release nicht gefunden")
    return public_release(doc)


@router.delete("/app-releases/{build}")
async def admin_app_release_delete(build: int, me: dict = Depends(require_club_admin())):
    if not await delete_release(get_db(), build):
        raise HTTPException(status_code=404, detail="Release nicht gefunden")
    return {"ok": True}
