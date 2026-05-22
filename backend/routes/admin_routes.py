"""Admin-only routes: dashboard KPIs, audit logs, notifications."""
import os
import pathlib
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from database import get_db
from auth import require_admin, get_current_user
from models import now_utc
from services.user_notifications import create_user_notification

router = APIRouter(prefix="/api/admin", tags=["admin"])


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


@router.get("/mobile-logs")
async def mobile_client_logs(
    limit: int = Query(default=100, ge=1, le=500),
    level: str = "",
    status: str = "",
    user_id: str = "",
    q: str = "",
    me: dict = Depends(require_admin()),
):
    db = get_db()
    query = {}
    if level:
        query["level"] = level.strip().lower()
    if status:
        query["status"] = status.strip().lower()
    if user_id:
        query["user_id"] = user_id.strip()
    search = q.strip()
    if search:
        query["$or"] = [
            {"message": {"$regex": search, "$options": "i"}},
            {"source": {"$regex": search, "$options": "i"}},
            {"screen": {"$regex": search, "$options": "i"}},
            {"username": {"$regex": search, "$options": "i"}},
            {"display_name": {"$regex": search, "$options": "i"}},
        ]
    return await db.mobile_client_logs.find(query, {"_id": 0}).sort("received_at", -1).to_list(limit)


@router.patch("/mobile-logs/{log_id}")
async def update_mobile_client_log(log_id: str, body: MobileLogPatch, me: dict = Depends(require_admin())):
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
async def mobile_push_users(q: str = "", limit: int = Query(default=40, ge=1, le=100), me: dict = Depends(require_admin())):
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
async def mobile_push_status_for_user(user_id: str, me: dict = Depends(require_admin())):
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
async def mobile_push_test(body: MobilePushTestCreate, me: dict = Depends(require_admin())):
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
async def mobile_push_receipts_for_user(user_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    exists = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
    if not exists:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    from services.push_notifications import check_mobile_push_receipts_for_user
    return await check_mobile_push_receipts_for_user(user_id)


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
