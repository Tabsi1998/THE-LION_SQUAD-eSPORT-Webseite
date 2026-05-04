"""Phase 8: Mail Queue with SMTP + Resend support, retry with backoff."""
import os
import logging
import asyncio
import ssl
from datetime import datetime, timezone, timedelta
from typing import Optional

import aiosmtplib
import resend

from database import get_db
from models import new_id, now_utc
from services.email_delivery import html_to_text, mailbox_domain

logger = logging.getLogger("tls.mailqueue")

# Backoff schedule in minutes for retry attempts (1m, 5m, 30m, 2h, 12h)
RETRY_BACKOFF_MIN = [1, 5, 30, 120, 720]
MAX_ATTEMPTS = len(RETRY_BACKOFF_MIN) + 1


async def get_mail_settings() -> dict:
    db = get_db()
    s = await db.settings.find_one({"id": "mail"}, {"_id": 0}) or {}
    legacy = await db.settings.find_one({"id": "email"}, {"_id": 0}) or {}
    # Provider: smtp or resend (default smtp if SMTP host present, else resend)
    provider = s.get("provider")
    if not provider:
        provider = "smtp" if s.get("smtp_host") else "resend"
    return {
        "provider": provider,
        "smtp_host": s.get("smtp_host", ""),
        "smtp_port": int(s.get("smtp_port") or 587),
        "smtp_user": s.get("smtp_user", ""),
        "smtp_pass": s.get("smtp_pass", ""),
        "smtp_auth": s.get("smtp_auth", "auto"),
        "smtp_security": s.get("smtp_security", "starttls"),  # starttls | tls | none
        "smtp_tls_verify": s.get("smtp_tls_verify", True),
        "smtp_envelope_from": s.get("smtp_envelope_from", ""),
        "sender_name": s.get("sender_name") or legacy.get("sender_name") or "TLS ARENA",
        "sender_email": s.get("sender_email") or legacy.get("sender_email") or os.environ.get("SENDER_EMAIL", "noreply@thelionsquad.at"),
        "reply_to_email": s.get("reply_to_email") or legacy.get("reply_to_email") or s.get("sender_email") or legacy.get("sender_email") or os.environ.get("SENDER_EMAIL", "noreply@thelionsquad.at"),
        "message_id_domain": s.get("message_id_domain") or legacy.get("message_id_domain") or "",
        "resend_api_key": legacy.get("resend_api_key") or s.get("resend_api_key") or os.environ.get("RESEND_API_KEY", ""),
        "enabled": s.get("enabled", True) if "enabled" in s else legacy.get("enabled", True),
    }


async def _smtp_send(cfg: dict, to: str, subject: str, html: str) -> str:
    """Send via aiosmtplib. Returns message-id-like marker."""
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.utils import formataddr, formatdate, make_msgid

    smtp_auth = (cfg.get("smtp_auth") or "auto").lower()
    auth_user_for_envelope = cfg.get("smtp_user") if smtp_auth != "none" else ""
    envelope_from = cfg.get("smtp_envelope_from") or auth_user_for_envelope or cfg["sender_email"]
    configured_msg_domain = (cfg.get("message_id_domain") or "").strip()
    message_id_domain = configured_msg_domain or mailbox_domain(cfg["sender_email"])
    reply_to = (cfg.get("reply_to_email") or cfg["sender_email"]).strip()

    msg = MIMEMultipart("alternative")
    msg["From"] = formataddr((cfg["sender_name"], cfg["sender_email"]))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=False)
    msg["Message-ID"] = make_msgid(domain=message_id_domain)
    msg["Auto-Submitted"] = "auto-generated"
    msg["X-Auto-Response-Suppress"] = "All"
    if reply_to:
        msg["Reply-To"] = reply_to
    if envelope_from and envelope_from.lower() != cfg["sender_email"].lower():
        msg["Sender"] = envelope_from
    msg.attach(MIMEText(html_to_text(html), "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    use_tls = cfg["smtp_security"] == "tls"
    start_tls = cfg["smtp_security"] == "starttls"
    tls_context = None
    validate_certs = bool(cfg.get("smtp_tls_verify", True))
    if (use_tls or start_tls) and not validate_certs:
        tls_context = ssl.create_default_context()
        tls_context.check_hostname = False
        tls_context.verify_mode = ssl.CERT_NONE

    username = cfg["smtp_user"] or None
    password = cfg["smtp_pass"] or None
    if smtp_auth == "none":
        username = None
        password = None

    kwargs = {
        "hostname": cfg["smtp_host"],
        "port": cfg["smtp_port"],
        "username": username,
        "password": password,
        "sender": envelope_from,
        "recipients": [to],
        "use_tls": use_tls,
        "start_tls": start_tls,
        "timeout": 30,
    }
    if tls_context is not None:
        kwargs["tls_context"] = tls_context
    # If both falsy -> plain
    if not (use_tls or start_tls):
        kwargs["use_tls"] = False
        kwargs["start_tls"] = False
    try:
        await aiosmtplib.send(msg, **kwargs)
    except Exception as exc:
        if smtp_auth == "auto" and username and "AUTH extension is not supported" in str(exc):
            logger.warning("[mailqueue] SMTP AUTH not supported, retrying without login")
            retry_kwargs = {**kwargs, "username": None, "password": None}
            await aiosmtplib.send(msg, **retry_kwargs)
        else:
            raise
    return msg["Message-ID"]


async def _resend_send(cfg: dict, to: str, subject: str, html: str) -> str:
    if not cfg["resend_api_key"]:
        raise RuntimeError("Resend API key not configured")
    resend.api_key = cfg["resend_api_key"]
    params = {
        "from": f"{cfg['sender_name']} <{cfg['sender_email']}>",
        "to": [to],
        "subject": subject,
        "html": html,
        "text": html_to_text(html),
        "headers": {
            "Auto-Submitted": "auto-generated",
            "X-Auto-Response-Suppress": "All",
        },
    }
    if cfg.get("reply_to_email"):
        params["reply_to"] = cfg["reply_to_email"]
    resp = await asyncio.to_thread(resend.Emails.send, params)
    return resp.get("id") if isinstance(resp, dict) else "ok"


async def _dispatch(cfg: dict, to: str, subject: str, html: str) -> str:
    if cfg["provider"] == "smtp":
        if not cfg["smtp_host"]:
            raise RuntimeError("SMTP host not configured")
        return await _smtp_send(cfg, to, subject, html)
    return await _resend_send(cfg, to, subject, html)


async def enqueue_mail(
    to: str,
    subject: str,
    html: str,
    template_key: str = "custom",
    scheduled_at: Optional[datetime] = None,
    meta: Optional[dict] = None,
    dedupe_key: Optional[str] = None,
) -> dict:
    """Enqueue a mail. If dedupe_key is set, will not re-queue if already exists."""
    db = get_db()
    if dedupe_key:
        existing = await db.mail_jobs.find_one({"dedupe_key": dedupe_key})
        if existing:
            return {"ok": True, "id": existing["id"], "deduped": True}
    job = {
        "id": new_id(),
        "to": to,
        "subject": subject,
        "html": html,
        "template_key": template_key,
        "status": "pending",
        "attempts": 0,
        "next_attempt_at": (scheduled_at or now_utc()).isoformat(),
        "scheduled_at": (scheduled_at or now_utc()).isoformat(),
        "last_error": None,
        "message_id": None,
        "meta": meta or {},
        "dedupe_key": dedupe_key,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.mail_jobs.insert_one(job)
    return {"ok": True, "id": job["id"]}


async def _try_send_job(job: dict) -> None:
    db = get_db()
    cfg = await get_mail_settings()
    if not cfg["enabled"]:
        await db.mail_jobs.update_one(
            {"id": job["id"]},
            {"$set": {
                "status": "skipped",
                "last_error": "Versand deaktiviert",
                "updated_at": now_utc().isoformat(),
            }},
        )
        return
    try:
        msg_id = await _dispatch(cfg, job["to"], job["subject"], job["html"])
        await db.mail_jobs.update_one(
            {"id": job["id"]},
            {"$set": {
                "status": "sent",
                "message_id": msg_id,
                "sent_at": now_utc().isoformat(),
                "updated_at": now_utc().isoformat(),
            }, "$inc": {"attempts": 1}},
        )
        # mirror to email_logs for backwards compat
        await db.email_logs.insert_one({
            "id": new_id(),
            "to": job["to"],
            "subject": job["subject"],
            "template_key": job.get("template_key", "custom"),
            "status": "sent",
            "message_id": msg_id,
            "error": None,
            "provider": cfg["provider"],
            "created_at": now_utc().isoformat(),
        })
    except Exception as exc:
        logger.error(f"[mailqueue] {job['id']} failed: {exc}")
        attempts = (job.get("attempts") or 0) + 1
        if attempts >= MAX_ATTEMPTS:
            await db.mail_jobs.update_one(
                {"id": job["id"]},
                {"$set": {
                    "status": "failed",
                    "last_error": str(exc)[:500],
                    "updated_at": now_utc().isoformat(),
                }, "$inc": {"attempts": 1}},
            )
            await db.email_logs.insert_one({
                "id": new_id(),
                "to": job["to"],
                "subject": job["subject"],
                "template_key": job.get("template_key", "custom"),
                "status": "failed",
                "error": str(exc)[:300],
                "provider": cfg["provider"],
                "created_at": now_utc().isoformat(),
            })
        else:
            backoff = RETRY_BACKOFF_MIN[min(attempts - 1, len(RETRY_BACKOFF_MIN) - 1)]
            next_at = (now_utc() + timedelta(minutes=backoff)).isoformat()
            await db.mail_jobs.update_one(
                {"id": job["id"]},
                {"$set": {
                    "status": "pending",
                    "last_error": str(exc)[:500],
                    "next_attempt_at": next_at,
                    "updated_at": now_utc().isoformat(),
                }, "$inc": {"attempts": 1}},
            )


async def process_mail_queue(batch: int = 10) -> dict:
    db = get_db()
    now = now_utc().isoformat()
    cursor = db.mail_jobs.find(
        {"status": "pending", "next_attempt_at": {"$lte": now}}
    ).sort("next_attempt_at", 1).limit(batch)
    jobs = await cursor.to_list(batch)
    sent = 0
    for job in jobs:
        # claim
        claimed = await db.mail_jobs.find_one_and_update(
            {"id": job["id"], "status": "pending"},
            {"$set": {"status": "sending", "updated_at": now_utc().isoformat()}},
        )
        if not claimed:
            continue
        try:
            await _try_send_job(job)
            sent += 1
        except Exception as exc:
            logger.exception(f"[mailqueue] dispatch crash: {exc}")
    return {"processed": len(jobs), "sent": sent}


async def smtp_test(to: str) -> dict:
    """Direct synchronous SMTP test (does not use queue)."""
    cfg = await get_mail_settings()
    if cfg["provider"] != "smtp":
        return {"ok": False, "reason": "Provider ist nicht auf SMTP gesetzt."}
    if not cfg["smtp_host"]:
        return {"ok": False, "reason": "SMTP Host fehlt."}
    try:
        from email_service import tpl_test
        subject, html = tpl_test(branding="TLS ARENA")
        msg_id = await _smtp_send(cfg, to, subject, html)
        return {"ok": True, "id": msg_id}
    except Exception as exc:
        return {"ok": False, "reason": str(exc)}
