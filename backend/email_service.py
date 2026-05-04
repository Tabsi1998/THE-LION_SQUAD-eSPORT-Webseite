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
from services.email_delivery import html_to_text

logger = logging.getLogger("tls-arena.email")


async def _get_email_config() -> dict:
    db = get_db()
    s = await db.settings.find_one({"id": "email"}) or {}
    mail = await db.settings.find_one({"id": "mail"}) or {}
    api_key = s.get("resend_api_key") or os.environ.get("RESEND_API_KEY", "")
    sender_email = s.get("sender_email") or mail.get("sender_email") or os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
    sender_name = s.get("sender_name") or mail.get("sender_name") or "TLS ARENA"
    reply_to_email = s.get("reply_to_email") or mail.get("reply_to_email") or sender_email
    enabled = s.get("enabled", True) and bool(api_key)
    return {
        "api_key": api_key,
        "sender_email": sender_email,
        "sender_name": sender_name,
        "reply_to_email": reply_to_email,
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
            "text": html_to_text(html),
            "headers": {
                "Auto-Submitted": "auto-generated",
                "X-Auto-Response-Suppress": "All",
            },
        }
        if cfg.get("reply_to_email"):
            params["reply_to"] = cfg["reply_to_email"]
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
        "<p>Diese E-Mail bestätigt, dass dein E-Mail-Setup korrekt funktioniert. THE LION SQUAD kann jetzt Nachrichten an deine Spieler und Mitglieder senden.</p>",
    )


# ---------- Phase 8: Match-Reminder (mit Lead-Time) ----------
def tpl_match_lead_24h(tournament_title: str, opponent: str, when: str, url: str) -> tuple[str, str]:
    return f"In 24h: {tournament_title}", _wrap(
        "Match in 24 Stunden",
        f"<p>Morgen um <strong>{when}</strong> startet dein nächstes Match im Turnier <strong>{tournament_title}</strong> gegen <strong>{opponent}</strong>.</p>"
        "<p>Plane deinen Tag, lade dein Setup und sei rechtzeitig bereit.</p>",
        "Zum Match Hub", url,
    )


def tpl_match_lead_2h(tournament_title: str, opponent: str, when: str, url: str) -> tuple[str, str]:
    return f"In 2h: {tournament_title}", _wrap(
        "Match in 2 Stunden",
        f"<p>In <strong>2 Stunden</strong> ist dein Match im Turnier <strong>{tournament_title}</strong> gegen <strong>{opponent}</strong>. Startzeit: <strong>{when}</strong>.</p>",
        "Zum Match Hub", url,
    )


def tpl_match_lead_30m(tournament_title: str, opponent: str, when: str, url: str) -> tuple[str, str]:
    return f"In 30 Minuten: {tournament_title}", _wrap(
        "Match in 30 Minuten",
        f"<p>Achtung Löwe — dein Match gegen <strong>{opponent}</strong> startet in <strong>30 Minuten</strong> ({when}).</p>"
        "<p>Letzter Check: Setup, Verbindung, Voice-Chat.</p>",
        "Match öffnen", url,
    )


def tpl_match_lead_10m(tournament_title: str, opponent: str, when: str, url: str) -> tuple[str, str]:
    return f"Jetzt gleich: {tournament_title}", _wrap(
        "Match startet in 10 Minuten",
        f"<p>Dein Match gegen <strong>{opponent}</strong> ({tournament_title}) startet in <strong>10 Minuten</strong>. Sei bereit!</p>",
        "Match öffnen", url,
    )


# ---------- Phase 9: Prize Pickup ----------
def tpl_prize_ready(display_name: str, tournament_title: str, place: str, prize_label: str, deadline: str = "") -> tuple[str, str]:
    body = (
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        f"<p>Glückwunsch nochmal zu Platz <strong>{place}</strong> beim Turnier <strong>{tournament_title}</strong>!</p>"
        f"<p>Dein Gewinn <strong>{prize_label}</strong> ist jetzt <strong>zur Abholung bereit</strong>.</p>"
    )
    if deadline:
        body += f"<p>Bitte hole deinen Preis bis spätestens <strong>{deadline}</strong> ab. Danach verfällt der Anspruch.</p>"
    body += "<p>Komm einfach zum nächsten Vereinsabend oder vereinbare einen Termin mit dem Vorstand.</p>"
    return f"Dein Gewinn wartet: {tournament_title}", _wrap(
        "Gewinn bereit zur Abholung", body,
    )


def tpl_prize_picked_up(display_name: str, tournament_title: str, prize_label: str) -> tuple[str, str]:
    return f"Gewinn übergeben: {tournament_title}", _wrap(
        "Gewinn erfolgreich übergeben",
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        f"<p>dein Gewinn <strong>{prize_label}</strong> aus dem Turnier <strong>{tournament_title}</strong> wurde übergeben. Danke fürs Mitmachen — wir sehen uns beim nächsten Wettkampf!</p>",
    )


def tpl_prize_expired(display_name: str, tournament_title: str, prize_label: str) -> tuple[str, str]:
    return f"Gewinn verfallen: {tournament_title}", _wrap(
        "Abholfrist abgelaufen",
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        f"<p>leider wurde dein Gewinn <strong>{prize_label}</strong> aus dem Turnier <strong>{tournament_title}</strong> nicht innerhalb der Frist abgeholt. Der Anspruch ist verfallen.</p>"
        "<p>Bei Rückfragen wende dich bitte an den Vorstand.</p>",
    )


# ---------- Membership templates ----------
def tpl_membership_activated(display_name: str, member_number: str = "") -> tuple[str, str]:
    body = (
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        "<p>du bist jetzt offizielles <strong>Vereinsmitglied</strong> bei THE LION SQUAD eSports — willkommen im Rudel!</p>"
    )
    if member_number:
        body += f"<p>Deine Mitgliedsnummer: <strong>{member_number}</strong></p>"
    body += "<p>Der Mitgliederbereich, alle Vereinsvorteile, internen News und Mitglieder-Achievements sind jetzt für dich freigeschaltet.</p>"
    return "Willkommen als offizielles Vereinsmitglied", _wrap(
        "Vereinsmitglied freigeschaltet", body, "Mitgliederbereich öffnen", None,
    )


def tpl_membership_deactivated(display_name: str) -> tuple[str, str]:
    return "Deine Mitgliedschaft wurde deaktiviert", _wrap(
        "Mitgliedschaft deaktiviert",
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        "<p>deine offizielle Vereinsmitgliedschaft wurde deaktiviert. Dein Account bleibt als Community-Account aktiv und du kannst weiterhin an öffentlichen Turnieren teilnehmen.</p>"
        "<p>Bei Fragen melde dich jederzeit beim Vorstand.</p>",
    )


def tpl_membership_blocked(display_name: str) -> tuple[str, str]:
    return "Mitgliedschaftsstatus geändert", _wrap(
        "Mitgliedschaft gesperrt",
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        "<p>deine Vereinsmitgliedschaft wurde gesperrt. Bitte kontaktiere den Vorstand für weitere Informationen.</p>",
    )


async def send_template(template_key: str, to: str, queue: bool = True, scheduled_at=None, dedupe_key: Optional[str] = None, **kwargs) -> dict:
    """Shortcut for named templates. By default the mail is queued via the new mail-queue.
    Set queue=False to use the old immediate-Resend path (e.g. test buttons).
    """
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
        "match_lead_24h": tpl_match_lead_24h,
        "match_lead_2h": tpl_match_lead_2h,
        "match_lead_30m": tpl_match_lead_30m,
        "match_lead_10m": tpl_match_lead_10m,
        "prize_ready": tpl_prize_ready,
        "prize_picked_up": tpl_prize_picked_up,
        "prize_expired": tpl_prize_expired,
        "membership_activated": tpl_membership_activated,
        "membership_deactivated": tpl_membership_deactivated,
        "membership_blocked": tpl_membership_blocked,
    }
    fn = templates.get(template_key)
    if not fn:
        return {"ok": False, "reason": "unknown template"}
    try:
        subject, html = fn(**kwargs)
    except TypeError as e:
        return {"ok": False, "reason": f"template args error: {e}"}
    if queue:
        from services.mail_queue import enqueue_mail
        return await enqueue_mail(
            to=to, subject=subject, html=html,
            template_key=template_key, scheduled_at=scheduled_at,
            dedupe_key=dedupe_key,
        )
    return await send_mail(to, subject, html, template_key=template_key)
