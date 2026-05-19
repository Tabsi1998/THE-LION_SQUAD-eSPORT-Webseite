"""Admin-only routes: dashboard KPIs, audit logs, notifications."""
import os
import pathlib
from fastapi import APIRouter, Depends
from database import get_db
from auth import require_admin, get_current_user

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/dashboard")
async def dashboard(me: dict = Depends(require_admin())):
    db = get_db()
    return {
        "player_count": await db.users.count_documents({"is_active": True}),
        "team_count": await db.teams.count_documents({}),
        "active_tournaments": await db.tournaments.count_documents({"status": {"$in": ["live", "check_in"]}}),
        "registration_open": await db.tournaments.count_documents({"status": "registration_open"}),
        "today_matches": await db.matches.count_documents({"status": {"$in": ["ready", "in_progress"]}}),
        "open_disputes": await db.matches.count_documents({"status": "disputed"}),
        "active_f1": await db.f1_challenges.count_documents({"status": "live"}),
        "total_tournaments": await db.tournaments.count_documents({}),
        "total_f1_challenges": await db.f1_challenges.count_documents({}),
        "total_events": await db.events.count_documents({}),
        "recent_audit_logs": await db.audit_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(20),
    }


@router.get("/audit-logs")
async def audit_logs(limit: int = 100, me: dict = Depends(require_admin())):
    db = get_db()
    safe_limit = max(1, min(int(limit or 100), 500))
    logs = await db.audit_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(safe_limit)
    return logs


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
            error = str(exc)
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
async def system_status(me: dict = Depends(require_admin())):
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
        scheduler = {"running": False, "jobs": [], "error": str(exc)}
    try:
        await db.command("ping")
        database = {"ok": True}
    except Exception as exc:
        database = {"ok": False, "error": str(exc)}
    uploads = _upload_status()
    smtp_ready = bool(mail.get("enabled", True)) and (
        mail.get("provider") == "smtp" and bool(mail.get("smtp_host"))
        or mail.get("provider") == "resend" and bool(mail.get("resend_api_key"))
        or bool(mail.get("smtp_host"))
    )
    discord_ready = bool(discord.get("enabled", True)) and bool(discord.get("webhook_url"))
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
            "configured": bool(discord.get("webhook_url")),
            "enabled": bool(discord.get("enabled", True)),
            "latest": latest_discord,
        },
        "uploads": uploads,
        "scheduler": scheduler,
        "mail_queue": {**queue_counts, **{k: v for k, v in queue_stats.items() if k != "counts"}},
    }


@router.get("/notifications")
async def my_notifications(me: dict = Depends(get_current_user)):
    db = get_db()
    notes = await db.notifications.find({"user_id": me["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return notes


@router.post("/notifications/{nid}/read")
async def mark_read(nid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    await db.notifications.update_one({"id": nid, "user_id": me["id"]}, {"$set": {"read": True}})
    return {"ok": True}


@router.post("/notifications/read-all")
async def mark_all_read(me: dict = Depends(get_current_user)):
    db = get_db()
    await db.notifications.update_many({"user_id": me["id"], "read": {"$ne": True}}, {"$set": {"read": True}})
    return {"ok": True}


@router.delete("/notifications/read")
async def delete_read_notifications(me: dict = Depends(get_current_user)):
    db = get_db()
    result = await db.notifications.delete_many({"user_id": me["id"], "read": True})
    return {"ok": True, "deleted": result.deleted_count}


@router.delete("/notifications/{nid}")
async def delete_notification(nid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    result = await db.notifications.delete_one({"id": nid, "user_id": me["id"]})
    return {"ok": True, "deleted": result.deleted_count}
