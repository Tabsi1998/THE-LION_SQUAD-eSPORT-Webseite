"""Email service using Resend. Reads API key from settings DB document (fallback .env).
Logs all sends to the email_logs collection. Silent failure if no key configured."""
import os
import asyncio
import logging
import html as html_lib
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
    sender_email = s.get("sender_email") or mail.get("sender_email") or os.environ.get("SENDER_EMAIL", "noreply@lionsquad.at")
    sender_name = s.get("sender_name") or mail.get("sender_name") or "THE LION SQUAD"
    if str(sender_name).strip().lower() == "tls arena":
        sender_name = "THE LION SQUAD"
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


# ---------- HTML Templates ----------
BRAND_CYAN = "#29B6E8"


async def _site_base_url() -> str:
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    base = (os.environ.get("FRONTEND_URL") or branding.get("domain") or "https://lionsquad.at").strip().rstrip("/")
    if base and not base.startswith(("http://", "https://")):
        base = "https://" + base
    return base or "https://lionsquad.at"


def _absolute_public_url(value: str, base: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw.startswith(("http://", "https://")):
        return raw
    return f"{base}/{raw.lstrip('/')}"


async def _email_sponsor_block() -> str:
    db = get_db()
    sponsors = await db.sponsors.find(
        {"is_active": {"$ne": False}},
        {"_id": 0, "name": 1, "logo_url": 1, "link": 1, "tier": 1, "order_index": 1, "show_in_emails": 1},
    ).sort([("order_index", 1), ("name", 1)]).to_list(50)
    sponsors = [
        s for s in sponsors
        if s.get("logo_url") and (s.get("show_in_emails") is True or (s.get("show_in_emails") is None and s.get("tier") == "main"))
    ][:3]
    if not sponsors:
        return ""
    base = await _site_base_url()
    items = []
    for sponsor in sponsors:
        logo = html_lib.escape(_absolute_public_url(sponsor.get("logo_url"), base), quote=True)
        name = html_lib.escape(sponsor.get("name") or "Sponsor")
        link = html_lib.escape(_absolute_public_url(sponsor.get("link"), base), quote=True) if sponsor.get("link") else ""
        image = f'<img src="{logo}" alt="{name}" style="display:block;max-width:190px;max-height:60px;width:auto;height:auto;margin:8px auto 0">'
        if link:
            image = f'<a href="{link}" style="text-decoration:none">{image}</a>'
        items.append(f'<td align="center" style="padding:0 10px">{image}</td>')
    return (
        '<tr><td style="padding:18px 32px;border-top:1px solid #edf0f3;background:#fbfcfd">'
        '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;font-weight:700;text-align:center">Unterstützt von</div>'
        f'<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px"><tr>{"".join(items)}</tr></table>'
        '</td></tr>'
    )


async def _with_email_sponsors(html: str) -> str:
    sponsor_html = await _email_sponsor_block()
    if not sponsor_html:
        return html
    marker = '    <tr><td style="padding:16px 32px;border-top:1px solid #edf0f3;color:#6b7280;font-size:12px;line-height:1.5">'
    if marker in html:
        return html.replace(marker, sponsor_html + "\n" + marker, 1)
    return html.replace("</table>\n</td></tr></table></body></html>", sponsor_html + "\n</table>\n</td></tr></table></body></html>", 1)


def tpl_registration(display_name: str) -> tuple[str, str]:
    return "Willkommen im Rudel", _wrap(
        "Willkommen, " + (display_name or "Löwe"),
        "<p>Dein Account auf der Website von THE LION SQUAD eSports ist bereit. Ab jetzt kannst du dich fuer Turniere anmelden, Teams gruenden und die F1 Fast Lap Challenge mitfahren.</p>"
        "<p>Viel Erfolg!</p>",
    )


def tpl_password_reset(reset_url: str) -> tuple[str, str]:
    return "Passwort zurücksetzen", _wrap(
        "Passwort zurücksetzen",
        "<p>Du hast eine Passwort-Zurücksetzung angefordert. Klicke auf den Button unten, um ein neues Passwort zu vergeben. Der Link ist 60 Minuten gültig.</p>"
        "<p>Hast du diese Anfrage nicht gestellt? Dann ignoriere diese E-Mail einfach.</p>",
        "Passwort zurücksetzen", reset_url,
    )


def tpl_user_invite(display_name: str, invite_url: str, invited_by: str = "") -> tuple[str, str]:
    byline = f"<p>Die Einladung wurde von <strong>{invited_by}</strong> erstellt.</p>" if invited_by else ""
    return "Einladung zu THE LION SQUAD", _wrap(
        "Account aktivieren",
        f"<p>Hallo {display_name or 'Lion'},</p>"
        "<p>fuer dich wurde ein Account auf der Website von <strong>THE LION SQUAD eSports</strong> angelegt.</p>"
        f"{byline}"
        "<p>Klicke auf den Button, vergib dein eigenes Passwort und schliesse die Einrichtung ab. Der Link ist 7 Tage gueltig.</p>",
        "Passwort erstellen", invite_url,
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


def tpl_newsletter_news(display_name: str, title: str, excerpt: str = "", url: str = "") -> tuple[str, str]:
    body = f"<p>Hallo {display_name or 'Löwe'},</p><p>es gibt neue Vereinsnews:</p><p><strong>{title}</strong></p>"
    if excerpt:
        body += f"<p>{excerpt}</p>"
    return f"Neue Vereinsnews: {title}", _wrap("Neue Vereinsnews", body, "News lesen", url)


def tpl_newsletter_event(display_name: str, title: str, when: str = "", location: str = "", url: str = "") -> tuple[str, str]:
    facts = ""
    if when:
        facts += f"<p><strong>Datum:</strong> {when}</p>"
    if location:
        facts += f"<p><strong>Ort:</strong> {location}</p>"
    body = f"<p>Hallo {display_name or 'Löwe'},</p><p>ein neues Event wurde veröffentlicht:</p><p><strong>{title}</strong></p>{facts}"
    return f"Neues Event: {title}", _wrap("Neues Event", body, "Event ansehen", url)


def _wrap(title: str, body_html: str, cta_label: Optional[str] = None, cta_url: Optional[str] = None) -> str:
    """Neutral transactional email layout tuned for inbox placement."""
    cta = ""
    if cta_label and cta_url:
        cta = (
            f'<p style="margin:24px 0 0"><a href="{cta_url}" '
            f'style="display:inline-block;padding:12px 18px;background:{BRAND_CYAN};'
            'color:#001018;font-weight:700;text-decoration:none;font-family:Arial,sans-serif;'
            'font-size:14px;border-radius:4px">'
            f"{cta_label}</a></p>"
        )
    return f"""<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#17202a">
<div style="display:none;max-height:0;overflow:hidden;color:transparent">Automatische Nachricht von THE LION SQUAD.</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #d8dee6;border-radius:6px">
    <tr><td style="padding:28px 32px 16px;border-bottom:1px solid #edf0f3">
      <div style="font-size:13px;font-weight:700;color:#167da3">THE LION SQUAD eSports</div>
      <div style="margin-top:10px;font-size:24px;font-weight:700;color:#111827;line-height:1.25">{title}</div>
    </td></tr>
    <tr><td style="padding:26px 32px 30px;color:#273447;font-size:15px;line-height:1.65">
      {body_html}
      {cta}
    </td></tr>
    <tr><td style="padding:16px 32px;border-top:1px solid #edf0f3;color:#6b7280;font-size:12px;line-height:1.5">
      Diese automatische Nachricht wurde von THE LION SQUAD eSports versendet.
      Newsletter und optionale Hinweise kannst du jederzeit in deinem Profil unter Privatsphäre deaktivieren.
    </td></tr>
  </table>
</td></tr></table></body></html>"""


def tpl_test(branding: str = "THE LION SQUAD") -> tuple[str, str]:
    return "Testmail von THE LION SQUAD", _wrap(
        "E-Mail-Test",
        "<p>Diese Nachricht wurde ueber die Website von THE LION SQUAD eSports versendet.</p>"
        "<p>Sie dient nur zur Pruefung der SMTP-Konfiguration.</p>",
    )


async def send_template(
    template_key: str,
    to: str,
    queue: bool = True,
    scheduled_at=None,
    dedupe_key: Optional[str] = None,
    mail_meta: Optional[dict] = None,
    **kwargs,
) -> dict:
    """Shortcut for named templates. By default the mail is queued via the new mail-queue.
    Set queue=False to use the old immediate-Resend path (e.g. test buttons).
    """
    templates = {
        "registration": tpl_registration,
        "password_reset": tpl_password_reset,
        "user_invite": tpl_user_invite,
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
        "newsletter_news": tpl_newsletter_news,
        "newsletter_event": tpl_newsletter_event,
    }
    fn = templates.get(template_key)
    if not fn:
        return {"ok": False, "reason": "unknown template"}
    try:
        subject, html = fn(**kwargs)
    except TypeError as e:
        return {"ok": False, "reason": f"template args error: {e}"}
    html = await _with_email_sponsors(html)
    if queue:
        from services.mail_queue import enqueue_mail
        return await enqueue_mail(
            to=to, subject=subject, html=html,
            template_key=template_key, scheduled_at=scheduled_at,
            dedupe_key=dedupe_key, meta=mail_meta,
        )
    return await send_mail(to, subject, html, template_key=template_key)
