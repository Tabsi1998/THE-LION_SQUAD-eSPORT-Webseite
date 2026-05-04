"""Phase 8: Mail Queue with SMTP + Resend support, retry with backoff."""
import os
import logging
import asyncio
import ssl
import smtplib
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


def explain_smtp_error(exc: Exception) -> str:
    raw = str(exc)
    if "AUTH extension is not supported" in raw:
        return (
            "Der SMTP-Server bietet auf diesem Host/Port keine Anmeldung an. "
            "Fuer normalen E-Mail-Versand ohne Relay brauchst du den Submission-Port "
            "mit SMTP AUTH, meistens 587 mit STARTTLS und Login."
        )
    if "Relay access denied" in raw:
        return (
            "Relay access denied: Der Mailserver erlaubt dem Backend nicht, an externe "
            "Empfaenger zu senden. Loesung: SMTP AUTH auf dem Submission-Port verwenden "
            "oder die exakte Docker-/Server-IP im Mailserver als vertrauenswuerdiges Relay "
            "eintragen. Port 25 ohne AUTH funktioniert nur fuer vertrauenswuerdige interne "
            "Hosts und darf nie als offenes Relay konfiguriert werden."
        )
    if "CERTIFICATE_VERIFY_FAILED" in raw or "self-signed certificate" in raw:
        return (
            "TLS-Zertifikat konnte nicht verifiziert werden. Fuer lokale/self-signed Server "
            "im Admin 'TLS Zertifikat pruefen' deaktivieren oder ein vertrauenswuerdiges Zertifikat installieren."
        )
    return raw


def _smtp_tls_context(validate_certs: bool):
    context = ssl.create_default_context()
    if not validate_certs:
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    return context


def _smtp_diagnose_sync(cfg: dict, to: str) -> dict:
    host = cfg.get("smtp_host")
    port = int(cfg.get("smtp_port") or 587)
    security = cfg.get("smtp_security") or "starttls"
    auth_mode = (cfg.get("smtp_auth") or "login").lower()
    validate_certs = bool(cfg.get("smtp_tls_verify", True))
    username = cfg.get("smtp_user") or ""
    password = cfg.get("smtp_pass") or ""
    envelope_from = cfg.get("smtp_envelope_from") or (username if auth_mode != "none" else "") or cfg.get("sender_email")

    result = {
        "ok": False,
        "host": host,
        "port": port,
        "security": security,
        "auth_mode": auth_mode,
        "auth_supported": False,
        "auth_ok": False,
        "relay_ok": False,
        "steps": [],
        "recommendations": [],
    }
    if not host:
        result["recommendations"].append("SMTP Host fehlt.")
        return result

    smtp = None
    try:
        context = _smtp_tls_context(validate_certs)
        if security == "tls":
            smtp = smtplib.SMTP_SSL(host=host, port=port, timeout=15, context=context)
            result["steps"].append({"ok": True, "label": f"SSL/TLS Verbindung zu {host}:{port} hergestellt."})
        else:
            smtp = smtplib.SMTP(host=host, port=port, timeout=15)
            result["steps"].append({"ok": True, "label": f"SMTP Verbindung zu {host}:{port} hergestellt."})

        code, msg = smtp.ehlo()
        result["steps"].append({"ok": 200 <= code < 400, "label": f"EHLO: {code} {msg.decode(errors='ignore') if isinstance(msg, bytes) else msg}"})
        if security == "starttls":
            if not smtp.has_extn("starttls"):
                result["steps"].append({"ok": False, "label": "STARTTLS wird von diesem Host/Port nicht angeboten."})
                result["recommendations"].append("Stelle Sicherheit auf 'Keine' oder nutze den richtigen STARTTLS-Port.")
                return result
            smtp.starttls(context=context)
            result["steps"].append({"ok": True, "label": "STARTTLS erfolgreich aktiviert."})
            code, msg = smtp.ehlo()
            result["steps"].append({"ok": 200 <= code < 400, "label": f"EHLO nach STARTTLS: {code}"})

        auth_supported = smtp.has_extn("auth")
        result["auth_supported"] = auth_supported
        result["features"] = sorted((smtp.esmtp_features or {}).keys())
        result["steps"].append({"ok": auth_supported or auth_mode == "none", "label": f"AUTH angeboten: {'ja' if auth_supported else 'nein'}"})

        should_login = auth_mode == "login" or (auth_mode == "auto" and username and password and auth_supported)
        if auth_mode == "login" and not auth_supported:
            result["recommendations"].append("Dieser Host/Port bietet kein SMTP AUTH. Fuer Versand ohne Relay brauchst du Port 587 mit STARTTLS und SMTP Anmeldung.")
            result["recommendations"].append("Port 25 ist fuer Server-zu-Server-Transport gedacht und ist ohne besondere Mailserver-Regel kein normaler Client-Versand.")
            return result
        if should_login:
            if not username or not password:
                result["recommendations"].append("SMTP Anmeldung ist aktiv, aber User oder Passwort fehlt.")
                return result
            smtp.login(username, password)
            result["auth_ok"] = True
            result["steps"].append({"ok": True, "label": "SMTP Login erfolgreich."})
        elif auth_mode == "none":
            result["steps"].append({"ok": True, "label": "SMTP Login bewusst uebersprungen (lokaler Relay-Modus)."})
        else:
            result["steps"].append({"ok": False, "label": "Auto-Modus konnte keinen Login durchfuehren. Stelle auf 'Mit Benutzer/Passwort' und nutze Port 587 STARTTLS."})
            result["recommendations"].append("Auto-Modus ist nur fuer Altbestand gedacht. Empfohlen ist 'Mit Benutzer/Passwort'.")
            return result

        mail_code, mail_msg = smtp.mail(envelope_from)
        result["steps"].append({"ok": 200 <= mail_code < 400, "label": f"MAIL FROM <{envelope_from}>: {mail_code} {mail_msg.decode(errors='ignore') if isinstance(mail_msg, bytes) else mail_msg}"})
        if not (200 <= mail_code < 400):
            result["recommendations"].append("Der technische SMTP-Absender wird vom Server abgelehnt. Nutze office@lionsquad.at oder den eingeloggten SMTP-User.")
            return result

        rcpt_code, rcpt_msg = smtp.rcpt(to)
        rcpt_text = rcpt_msg.decode(errors="ignore") if isinstance(rcpt_msg, bytes) else str(rcpt_msg)
        result["relay_ok"] = 200 <= rcpt_code < 400
        result["steps"].append({"ok": result["relay_ok"], "label": f"RCPT TO <{to}>: {rcpt_code} {rcpt_text}"})
        if result["relay_ok"]:
            result["ok"] = True
            result["recommendations"].append("SMTP Diagnose erfolgreich. Der Server akzeptiert den Empfaenger vor DATA.")
        elif "Relay access denied" in rcpt_text:
            result["recommendations"].append("Relay fehlt: Der Mailserver akzeptiert den Absender, erlaubt diesem Backend aber keine externen Empfaenger.")
            result["recommendations"].append("Empfohlen: Submission-Port 587 mit STARTTLS und SMTP Anmeldung fuer office@lionsquad.at aktivieren.")
            result["recommendations"].append("Alternative fuer lokalen Relay-Betrieb: Port 25 ohne Anmeldung lassen, aber nur die exakte Webserver-/Docker-IP in mynetworks/permit_mynetworks erlauben. Nicht 0.0.0.0/0 freigeben.")
            result["recommendations"].append("Pruefe im Mailserver-Log, welche Quell-IP beim RCPT-Versuch ankommt; genau diese IP muss erlaubt werden.")
        else:
            result["recommendations"].append("Empfaenger wurde vor DATA abgelehnt. Pruefe Mailserver-Logs fuer die genaue Regel.")
        return result
    except Exception as exc:
        result["steps"].append({"ok": False, "label": explain_smtp_error(exc)})
        result["recommendations"].append(explain_smtp_error(exc))
        return result
    finally:
        if smtp is not None:
            try:
                smtp.rset()
                smtp.quit()
            except Exception:
                pass


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
        "smtp_auth": s.get("smtp_auth", "login"),
        "smtp_security": s.get("smtp_security", "starttls"),  # starttls | tls | none
        "smtp_tls_verify": s.get("smtp_tls_verify", True),
        "smtp_envelope_from": s.get("smtp_envelope_from", ""),
        "sender_name": s.get("sender_name") or legacy.get("sender_name") or "TLS ARENA",
        "sender_email": s.get("sender_email") or legacy.get("sender_email") or os.environ.get("SENDER_EMAIL", "noreply@lionsquad.at"),
        "reply_to_email": s.get("reply_to_email") or legacy.get("reply_to_email") or s.get("sender_email") or legacy.get("sender_email") or os.environ.get("SENDER_EMAIL", "noreply@lionsquad.at"),
        "message_id_domain": s.get("message_id_domain") or legacy.get("message_id_domain") or "",
        "resend_api_key": legacy.get("resend_api_key") or s.get("resend_api_key") or os.environ.get("RESEND_API_KEY", ""),
        "enabled": s.get("enabled", True) if "enabled" in s else legacy.get("enabled", True),
    }


async def _smtp_send(cfg: dict, to: str, subject: str, html: str) -> str:
    """Send via aiosmtplib. Returns message-id-like marker."""
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.utils import formataddr, formatdate, make_msgid

    smtp_auth = (cfg.get("smtp_auth") or "login").lower()
    if smtp_auth == "auto":
        smtp_auth = "login"
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
    elif smtp_auth == "login" and (not username or not password):
        raise RuntimeError("SMTP Login ist aktiv, aber Benutzer oder Passwort fehlt.")

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
    await aiosmtplib.send(msg, **kwargs)
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
        return {"ok": False, "reason": explain_smtp_error(exc), "raw_error": str(exc)[:500]}


async def smtp_diagnose(to: str) -> dict:
    cfg = await get_mail_settings()
    if cfg["provider"] != "smtp":
        return {"ok": False, "recommendations": ["Provider ist nicht auf SMTP gesetzt."], "steps": []}
    return await asyncio.to_thread(_smtp_diagnose_sync, cfg, to)
