"""Email service using Resend. Reads API key from settings DB document (fallback .env).
Logs all sends to the email_logs collection. Silent failure if no key configured."""
import os
import asyncio
import logging
from typing import Optional
from datetime import datetime, timezone

import resend
from database import get_db
from models import new_id

logger = logging.getLogger("tls-arena.email")


async def _get_email_config() -> dict:
    db = get_db()
    s = await db.settings.find_one({"id": "email"}) or {}
    api_key = s.get("resend_api_key") or os.environ.get("RESEND_API_KEY", "")
    sender_email = s.get("sender_email") or os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
    sender_name = s.get("sender_name") or "TLS ARENA"
    enabled = s.get("enabled", True) and bool(api_key)
    return {
        "api_key": api_key,
        "sender_email": sender_email,
        "sender_name": sender_name,
        "enabled": enabled,
        "from_header": f"{sender_name} <{sender_email}>",
    }


async def send_mail(to: str, subject: str, html: str, template_key: str = "custom") -> dict:
    """Send via Resend. Never raises; always writes an email_log."""
    db = get_db()
    cfg = await _get_email_config()
    log = {
        "id": new_id(),
        "to": to,
        "subject": subject,
        "template_key": template_key,
        "status": "skipped",
        "message_id": None,
        "error": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if not cfg["enabled"]:
        log["error"] = "Email disabled or no API key configured."
        await db.email_logs.insert_one({**log})
        return {"ok": False, "reason": "disabled"}
    try:
        resend.api_key = cfg["api_key"]
        params = {
            "from": cfg["from_header"],
            "to": [to],
            "subject": subject,
            "html": html,
        }
        resp = await asyncio.to_thread(resend.Emails.send, params)
        log["status"] = "sent"
        log["message_id"] = resp.get("id") if isinstance(resp, dict) else None
        await db.email_logs.insert_one({**log})
        return {"ok": True, "id": log["message_id"]}
    except Exception as e:
        logger.error(f"[email] send failed: {e}")
        log["status"] = "failed"
        log["error"] = str(e)[:300]
        await db.email_logs.insert_one({**log})
        return {"ok": False, "reason": str(e)}


# ---------- HTML Templates (dark eSports theme, inline CSS) ----------
BRAND_CYAN = "#29B6E8"
BRAND_BLACK = "#0A0A0A"


def _wrap(title: str, body_html: str, cta_label: Optional[str] = None, cta_url: Optional[str] = None) -> str:
    cta = ""
    if cta_label and cta_url:
        cta = f'<a href="{cta_url}" style="display:inline-block;padding:14px 28px;background:{BRAND_CYAN};color:#000;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;text-decoration:none;font-family:Arial,sans-serif;font-size:13px;margin-top:16px">{cta_label}</a>'
    return f"""<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:{BRAND_BLACK};font-family:Arial,Helvetica,sans-serif;color:#fff">
<table width="100%" cellpadding="0" cellspacing="0" style="background:{BRAND_BLACK};padding:40px 0">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#121212;border:1px solid rgba(255,255,255,0.1)">
    <tr><td style="padding:32px 32px 16px;border-bottom:1px solid rgba(255,255,255,0.06)">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.3em;color:{BRAND_CYAN};text-transform:uppercase">THE LION SQUAD · TLS ARENA</div>
      <div style="margin-top:10px;font-size:26px;font-weight:900;text-transform:uppercase;color:#fff;line-height:1.1">{title}</div>
    </td></tr>
    <tr><td style="padding:28px 32px 32px;color:rgba(255,255,255,0.8);font-size:15px;line-height:1.6">
      {body_html}
      {cta}
    </td></tr>
    <tr><td style="padding:18px 32px;border-top:1px solid rgba(255,255,255,0.06);color:rgba(255,255,255,0.4);font-size:11px;letter-spacing:0.18em;text-transform:uppercase">TLS ARENA · The Lion Squad eSports</td></tr>
  </table>
</td></tr></table></body></html>"""


def tpl_registration(display_name: str) -> tuple[str, str]:
    return "Willkommen im Rudel", _wrap(
        "Willkommen, " + (display_name or "Löwe"),
        "<p>Dein Account in der TLS ARENA ist bereit. Ab jetzt kannst du dich für Turniere anmelden, Teams gründen und die F1 Fast Lap Challenge mitfahren.</p>"
        "<p>Viel Erfolg!</p>",
    )


def tpl_password_reset(reset_url: str) -> tuple[str, str]:
    return "Passwort zurücksetzen", _wrap(
        "Passwort zurücksetzen",
        "<p>Du hast eine Passwort-Zurücksetzung angefordert. Klicke auf den Button unten, um ein neues Passwort zu vergeben. Der Link ist 60 Minuten gültig.</p>"
        "<p>Hast du diese Anfrage nicht gestellt? Dann ignoriere diese E-Mail einfach.</p>",
        "Passwort zurücksetzen", reset_url,
    )


def tpl_registration_received(tournament_title: str, url: str) -> tuple[str, str]:
    return f"Anmeldung eingegangen: {tournament_title}", _wrap(
        "Anmeldung eingegangen",
        f"<p>Deine Anmeldung für <strong>{tournament_title}</strong> ist bei uns eingegangen. Du erhältst eine weitere E-Mail, sobald dein Platz bestätigt wird.</p>",
        "Turnier ansehen", url,
    )


def tpl_registration_approved(tournament_title: str, url: str) -> tuple[str, str]:
    return f"Du bist dabei: {tournament_title}", _wrap(
        "Anmeldung bestätigt",
        f"<p>Dein Platz im Turnier <strong>{tournament_title}</strong> wurde bestätigt. Bereite dich vor und vergiss den Check-in nicht.</p>",
        "Zum Turnier", url,
    )


def tpl_registration_rejected(tournament_title: str, reason: str = "") -> tuple[str, str]:
    return f"Anmeldung abgelehnt: {tournament_title}", _wrap(
        "Anmeldung abgelehnt",
        f"<p>Leider wurde deine Anmeldung für <strong>{tournament_title}</strong> nicht akzeptiert.</p>"
        + (f"<p><em>Grund: {reason}</em></p>" if reason else ""),
    )


def tpl_checkin_reminder(tournament_title: str, url: str) -> tuple[str, str]:
    return f"Check-in offen: {tournament_title}", _wrap(
        "Check-in ist offen",
        f"<p>Der Check-in für <strong>{tournament_title}</strong> ist jetzt geöffnet. Bitte bestätige deine Teilnahme rechtzeitig, sonst rückt die Warteliste nach.</p>",
        "Jetzt einchecken", url,
    )


def tpl_match_reminder(tournament_title: str, opponent: str, when: str, url: str) -> tuple[str, str]:
    return f"Match startet bald: {tournament_title}", _wrap(
        "Dein Match startet bald",
        f"<p>Dein nächstes Match im Turnier <strong>{tournament_title}</strong> gegen <strong>{opponent}</strong> startet um <strong>{when}</strong>.</p>",
        "Zum Match Hub", url,
    )


def tpl_score_reported(tournament_title: str, url: str) -> tuple[str, str]:
    return f"Ergebnis gemeldet: {tournament_title}", _wrap(
        "Ergebnis wurde gemeldet",
        "<p>Ein Spielergebnis wurde gemeldet. Bitte bestätige oder widersprich es zeitnah.</p>",
        "Match öffnen", url,
    )


def tpl_dispute_opened(tournament_title: str, url: str) -> tuple[str, str]:
    return f"Dispute eröffnet: {tournament_title}", _wrap(
        "Dispute eröffnet",
        "<p>Ein Dispute wurde zu einem deiner Matches eröffnet. Ein Admin wird sich darum kümmern.</p>",
        "Zum Match", url,
    )


def tpl_dispute_resolved(tournament_title: str, decision: str, url: str) -> tuple[str, str]:
    return f"Dispute entschieden: {tournament_title}", _wrap(
        "Dispute entschieden",
        f"<p>Die Admin-Entscheidung liegt vor:</p><p><strong>{decision}</strong></p>",
        "Match ansehen", url,
    )


def tpl_tournament_finished(tournament_title: str, url: str) -> tuple[str, str]:
    return f"Turnier beendet: {tournament_title}", _wrap(
        "Das Turnier ist zu Ende",
        f"<p>Herzlichen Glückwunsch an alle Teilnehmer. Das Turnier <strong>{tournament_title}</strong> ist offiziell beendet. Die finalen Ergebnisse sind jetzt online.</p>",
        "Ergebnisse ansehen", url,
    )


def tpl_test(branding: str = "TLS ARENA") -> tuple[str, str]:
    return f"[Test] {branding} E-Mail-Versand funktioniert", _wrap(
        "Testmail erfolgreich",
        "<p>Diese E-Mail bestätigt, dass dein Resend-Setup korrekt funktioniert. Die TLS ARENA kann jetzt Nachrichten an deine Spieler senden.</p>",
    )


async def send_template(template_key: str, to: str, **kwargs) -> dict:
    """Shortcut for named templates."""
    templates = {
        "registration": tpl_registration,
        "password_reset": tpl_password_reset,
        "registration_received": tpl_registration_received,
        "registration_approved": tpl_registration_approved,
        "registration_rejected": tpl_registration_rejected,
        "checkin_reminder": tpl_checkin_reminder,
        "match_reminder": tpl_match_reminder,
        "score_reported": tpl_score_reported,
        "dispute_opened": tpl_dispute_opened,
        "dispute_resolved": tpl_dispute_resolved,
        "tournament_finished": tpl_tournament_finished,
        "test": tpl_test,
    }
    fn = templates.get(template_key)
    if not fn:
        return {"ok": False, "reason": "unknown template"}
    try:
        subject, html = fn(**kwargs)
    except TypeError as e:
        return {"ok": False, "reason": f"template args error: {e}"}
    return await send_mail(to, subject, html, template_key=template_key)
