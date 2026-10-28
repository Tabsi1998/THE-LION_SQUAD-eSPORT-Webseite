"""Email service using Resend. Reads API key from settings DB document (fallback .env).
Logs all sends to the email_logs collection. Silent failure if no key configured."""
import os
import asyncio
import functools
import logging
import html as html_lib
from typing import Optional
from datetime import datetime, timezone

import resend
from database import get_db
from models import new_id
from services.email_delivery import header_text, html_to_text, html_value
from services.log_safe import log_safe, mask_addresses
from services.secret_store import decrypt_secret
from services.svg_logo import raster_urls_in_text

logger = logging.getLogger("tls-arena.email")


async def _get_email_config() -> dict:
    db = get_db()
    s = await db.settings.find_one({"id": "email"}) or {}
    mail = await db.settings.find_one({"id": "mail"}) or {}
    api_key = decrypt_secret(s.get("resend_api_key")) or os.environ.get("RESEND_API_KEY", "")
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
    subject = header_text(subject)  # der Betreff bleibt eine Zeile - kein Wert hängt eine Kopfzeile an
    html = raster_urls_in_text(html)  # Mail-Programme zeigen kein SVG: die PNG-Fassung eines Logos (#1952)
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
        # Ins Protokoll ohne Mail-Adressen und in einer Zeile; die volle Meldung steht im Versandprotokoll (Admin).
        logger.error("[email] send failed: %s", log_safe(mask_addresses(e), 300))
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
        {"_id": 0, "name": 1, "logo_url": 1, "dolibarr_images": 1, "link": 1, "tier": 1, "order_index": 1, "show_in_emails": 1},
    ).sort([("order_index", 1), ("name", 1)]).to_list(50)
    # Mails haben hellen Grund: die Fassung für hellen Hintergrund aus Dolibarr, sonst der Upload (#880).
    from services import sponsor_images
    sponsors = [{**s, "logo_url": sponsor_images.pick(s, "logo", "light")[0]} for s in sponsors]
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


def mail_template(render):
    """Jede feste Vorlage (tpl_*) läuft hierüber - die eine Stelle, an der eingesetzte Werte geschützt werden.

    Die Vorlage wird mit denselben Werten zweimal gebaut: für den Betreff mit jedem Wert als einzeiligem Text
    (`header_text`), für das HTML mit jedem Wert als Text (`html_value`). Ein Name mit spitzen Klammern oder einem
    Link bleibt so in der Mail sichtbarer Text und wird nie zu Formatierung. HTML, das die Vorlage selbst baut
    (Knopf, Link-Block, Liste), bleibt HTML; ein fertiger HTML-Block als Wert kommt nur als `SafeHtml` durch.
    Darum ruft eine Vorlage nie selbst html.escape auf - sonst stünde „&amp;amp;“ in der Mail."""

    @functools.wraps(render)
    def safe_render(*args, **kwargs) -> tuple[str, str]:
        subject = render(*[header_text(value) for value in args], **{key: header_text(value) for key, value in kwargs.items()})[0]
        body = render(*[html_value(value) for value in args], **{key: html_value(value) for key, value in kwargs.items()})[1]
        return header_text(subject), body

    safe_render.is_mail_template = True
    return safe_render


@mail_template
def tpl_registration(display_name: str) -> tuple[str, str]:
    return "Willkommen in der Community", _wrap(
        "Willkommen in der Community, " + (display_name or "Community-Mitglied"),
        "<p>Dein Account auf der Website von THE LION SQUAD eSports ist bereit. Ab jetzt kannst du dich für Turniere anmelden, Teams gründen und die F1 Fast Lap Challenge mitfahren.</p>"
        "<p>Die offizielle Aufnahme in den Verein ist davon getrennt und erfolgt erst nach einer freigeschalteten Mitgliedschaft.</p>"
        "<p>Viel Erfolg!</p>",
    )


@mail_template
def tpl_email_verification(display_name: str, verification_url: str) -> tuple[str, str]:
    return "E-Mail-Adresse bestätigen", _wrap(
        "E-Mail-Adresse bestätigen",
        f"<p>Hallo {display_name or 'Lion'},</p>"
        "<p>bestätige bitte deine E-Mail-Adresse, bevor du dich anmeldest. Der Link ist 24 Stunden gültig.</p>"
        "<p>Falls du den Account nicht erstellt hast, kannst du diese Nachricht ignorieren.</p>",
        "E-Mail bestätigen", verification_url,
    )


@mail_template
def tpl_password_reset(reset_url: str) -> tuple[str, str]:
    return "Passwort zurücksetzen", _wrap(
        "Passwort zurücksetzen",
        "<p>Du hast eine Passwort-Zurücksetzung angefordert. Klicke auf den Button unten, um ein neues Passwort zu vergeben. Der Link ist 60 Minuten gültig.</p>"
        "<p>Hast du diese Anfrage nicht gestellt? Dann ignoriere diese E-Mail einfach.</p>",
        "Passwort zurücksetzen", reset_url,
    )


@mail_template
def tpl_user_invite(display_name: str, invite_url: str, invited_by: str = "") -> tuple[str, str]:
    byline = f"<p>Die Einladung wurde von <strong>{invited_by}</strong> erstellt.</p>" if invited_by else ""
    return "Einladung zu THE LION SQUAD", _wrap(
        "Account aktivieren",
        f"<p>Hallo {display_name or 'Lion'},</p>"
        "<p>für dich wurde ein Account auf der Website von <strong>THE LION SQUAD eSports</strong> angelegt.</p>"
        f"{byline}"
        "<p>Klicke auf den Button, vergib dein eigenes Passwort und schließe die Einrichtung ab. Der Link ist 7 Tage gültig.</p>",
        "Passwort erstellen", invite_url,
    )


@mail_template
def tpl_account_banned(display_name: str, reason: str, appeal_url: str = "") -> tuple[str, str]:
    """Konto gesperrt (#1357): die Person erfährt den Grund - derselbe, der im Protokoll steht. Die Werte kommen schon
    als Text geschützt an (mail_template); aus den Zeilen des Grundes werden hier nur noch Umbrüche."""
    reason_html = (reason or "").replace("\n", "<br>")
    contact = (f'<p>Wenn du das für einen Irrtum hältst, schreib dem Verein über das <a href="{appeal_url}">Kontaktformular</a>.</p>'
               if appeal_url else "<p>Wenn du das für einen Irrtum hältst, melde dich beim Verein.</p>")
    return "Dein Konto bei THE LION SQUAD ist gesperrt", _wrap(
        "Konto gesperrt",
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        "<p>dein Konto auf der Website von <strong>THE LION SQUAD eSports</strong> wurde gesperrt. Anmelden ist damit nicht mehr möglich.</p>"
        f"<p><strong>Grund:</strong> {reason_html}</p>"
        f"{contact}",
    )


# Turnier-Anmeldung (#1133): eingegangen (wartet auf Freigabe oder Warteliste), bestätigt (auch beim Nachrücken) und
# abgelehnt. `detail` ist ein fertiger Satz aus services/registration_notifications - etwa der Check-in-Hinweis.
@mail_template
def tpl_registration_received(tournament_title: str, url: str, detail: str = "") -> tuple[str, str]:
    return f"Anmeldung eingegangen: {tournament_title}", _wrap(
        "Anmeldung eingegangen",
        f"<p>Deine Anmeldung für <strong>{tournament_title}</strong> ist bei uns eingegangen.</p>"
        + (f"<p>{detail}</p>" if detail else ""),
        "Turnier ansehen", url,
    )


@mail_template
def tpl_registration_approved(tournament_title: str, url: str, detail: str = "") -> tuple[str, str]:
    return f"Du bist dabei: {tournament_title}", _wrap(
        "Anmeldung bestätigt",
        f"<p>Dein Platz im Turnier <strong>{tournament_title}</strong> ist bestätigt.</p>"
        + (f"<p>{detail}</p>" if detail else ""),
        "Zum Turnier", url,
    )


@mail_template
def tpl_registration_rejected(tournament_title: str, reason: str = "", url: str = "") -> tuple[str, str]:
    return f"Anmeldung abgelehnt: {tournament_title}", _wrap(
        "Anmeldung abgelehnt",
        f"<p>Leider hat die Turnierleitung deine Anmeldung für <strong>{tournament_title}</strong> abgelehnt.</p>"
        + (f"<p><em>Grund: {reason}</em></p>" if reason else ""),
        "Zum Turnier" if url else None, url or None,
    )


@mail_template
def tpl_checkin_closes_soon(tournament_title: str, when: str, url: str) -> tuple[str, str]:
    return f"Check-in endet bald: {tournament_title}", _wrap(
        "Check-in endet bald",
        f"<p>Du bist für <strong>{tournament_title}</strong> noch nicht eingecheckt. Der Check-in endet um <strong>{when}</strong>.</p>"
        "<p>Bitte checke jetzt ein, wenn du wirklich mitspielst.</p>",
        "Jetzt einchecken", url,
    )


@mail_template
def tpl_checkin_closes_soon_on_site(tournament_title: str, when: str, url: str) -> tuple[str, str]:
    # Vor Ort (#1135) checkt die Turnierleitung ein - kein Knopf „Jetzt einchecken“.
    return f"Check-in endet bald: {tournament_title}", _wrap(
        "Check-in endet bald",
        f"<p>Du bist für <strong>{tournament_title}</strong> noch nicht eingecheckt.</p>"
        f"<p>Bitte melde dich bis <strong>{when}</strong> vor Ort bei der Turnierleitung, wenn du mitspielst.</p>",
        "Zum Turnier", url,
    )


def _station_hint(station: str = "") -> str:
    # Teil einer Vorlage: `station` kommt schon als Text geschützt an (mail_template).
    return f"<p>Station: <strong>{station}</strong></p>" if station else ""


@mail_template
def tpl_match_reminder(tournament_title: str, opponent: str, when: str, url: str, station: str = "") -> tuple[str, str]:
    # Geht raus, wenn die Turnierleitung das Spiel an der Station startet (#1137) - es geht also jetzt los.
    return f"Match startet jetzt: {tournament_title}", _wrap(
        "Dein Match startet jetzt",
        f"<p>Dein Match im Turnier <strong>{tournament_title}</strong> ({opponent}) startet jetzt.</p>"
        + _station_hint(station)
        + f"<p>Gestartet: {when}</p>",
        "Zum Match", url,
    )


@mail_template
def tpl_score_reported(tournament_title: str, url: str, summary: str = "") -> tuple[str, str]:
    # Ergebnis melden (#1132): die Gegenseite hat gemeldet - bestätigen oder anders melden.
    reported = f"<p>Gemeldet: <strong>{summary}</strong></p>" if summary else ""
    return f"Ergebnis gemeldet: {tournament_title}", _wrap(
        "Bitte bestätige das Ergebnis",
        f"<p>Die Gegenseite hat für dein Spiel im Turnier <strong>{tournament_title}</strong> ein Ergebnis gemeldet.</p>"
        + reported
        + "<p>Stimmt es, bestätige es auf der Matchseite. Stimmt es nicht, melde dein Ergebnis – dann entscheidet die "
        "Turnierleitung.</p>",
        "Zum Match", url,
    )


@mail_template
def tpl_dispute_opened(tournament_title: str, url: str) -> tuple[str, str]:
    # Dispute (#1134): an die Spieler des Spiels - die Turnierleitung hat schon Bescheid.
    return f"Dispute zu deinem Spiel: {tournament_title}", _wrap(
        "Dispute gemeldet",
        f"<p>Zu einem deiner Spiele im Turnier <strong>{tournament_title}</strong> wurde ein Dispute gemeldet.</p>"
        "<p>Die Turnierleitung prüft und entscheidet. Du bekommst Bescheid, sobald die Entscheidung feststeht.</p>",
        "Zum Match", url,
    )


@mail_template
def tpl_dispute_resolved(tournament_title: str, decision: str, url: str) -> tuple[str, str]:
    return f"Dispute entschieden: {tournament_title}", _wrap(
        "Dispute entschieden",
        "<p>Die Turnierleitung hat den Dispute zu deinem Spiel entschieden:</p>"
        f"<p><strong>{decision}</strong></p>",
        "Match ansehen", url,
    )


@mail_template
def tpl_tournament_finished(tournament_title: str, url: str) -> tuple[str, str]:
    return f"Turnier beendet: {tournament_title}", _wrap(
        "Das Turnier ist zu Ende",
        f"<p>Danke fürs Mitspielen! Das Turnier <strong>{tournament_title}</strong> ist beendet. Platzierungen und Ergebnisse stehen auf der Turnierseite.</p>",
        "Ergebnisse ansehen", url,
    )


# Erinnerung vor dem Spiel: nur noch 10 Minuten vorher (#1133) - die Vorlauf-Mails 24 Stunden, 2 Stunden, 30 und 5 Minuten
# vorher sind weggefallen; dafür gibt es Push und die Nachricht in App und Website.
@mail_template
def tpl_match_lead_10m(tournament_title: str, opponent: str, when: str, url: str, station: str = "") -> tuple[str, str]:
    return f"Jetzt gleich: {tournament_title}", _wrap(
        "Match startet in 10 Minuten",
        f"<p>Dein Match gegen <strong>{opponent}</strong> ({tournament_title}) startet in <strong>10 Minuten</strong>. Sei bereit!</p>"
        + _station_hint(station),
        "Match öffnen", url,
    )


# ---------- Phase 9: Prize Pickup ----------
@mail_template
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


@mail_template
def tpl_prize_picked_up(display_name: str, tournament_title: str, prize_label: str) -> tuple[str, str]:
    return f"Gewinn übergeben: {tournament_title}", _wrap(
        "Gewinn erfolgreich übergeben",
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        f"<p>dein Gewinn <strong>{prize_label}</strong> aus dem Turnier <strong>{tournament_title}</strong> wurde übergeben. Danke fürs Mitmachen — wir sehen uns beim nächsten Wettkampf!</p>",
    )


@mail_template
def tpl_prize_expired(display_name: str, tournament_title: str, prize_label: str) -> tuple[str, str]:
    return f"Gewinn verfallen: {tournament_title}", _wrap(
        "Abholfrist abgelaufen",
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        f"<p>leider wurde dein Gewinn <strong>{prize_label}</strong> aus dem Turnier <strong>{tournament_title}</strong> nicht innerhalb der Frist abgeholt. Der Anspruch ist verfallen.</p>"
        "<p>Bei Rückfragen wende dich bitte an den Vorstand.</p>",
    )


# ---------- Membership templates ----------
@mail_template
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


@mail_template
def tpl_membership_deactivated(display_name: str) -> tuple[str, str]:
    return "Deine Mitgliedschaft wurde deaktiviert", _wrap(
        "Mitgliedschaft deaktiviert",
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        "<p>deine offizielle Vereinsmitgliedschaft wurde deaktiviert. Dein Account bleibt als Community-Account aktiv und du kannst weiterhin an öffentlichen Turnieren teilnehmen.</p>"
        "<p>Bei Fragen melde dich jederzeit beim Vorstand.</p>",
    )


@mail_template
def tpl_membership_blocked(display_name: str) -> tuple[str, str]:
    return "Mitgliedschaftsstatus geändert", _wrap(
        "Mitgliedschaft gesperrt",
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        "<p>deine Vereinsmitgliedschaft wurde gesperrt. Bitte kontaktiere den Vorstand für weitere Informationen.</p>",
    )


@mail_template
def tpl_newsletter_news(display_name: str, title: str, excerpt: str = "", url: str = "", preferences_url: str = "") -> tuple[str, str]:
    body = f"<p>Hallo {display_name or 'Löwe'},</p><p>es gibt neue Vereinsnews:</p><p><strong>{title}</strong></p>"
    if excerpt:
        body += f"<p>{excerpt}</p>"
    if preferences_url:
        body += f'<p style="font-size:12px;color:#6b7280">Newsletter abbestellen oder Kategorien ändern: <a href="{preferences_url}">E-Mail-Einstellungen öffnen</a>.</p>'
    return f"Neue Vereinsnews: {title}", _wrap("Neue Vereinsnews", body, "News lesen", url)


@mail_template
def tpl_newsletter_event(display_name: str, title: str, when: str = "", location: str = "", url: str = "", preferences_url: str = "") -> tuple[str, str]:
    facts = ""
    if when:
        facts += f"<p><strong>Datum:</strong> {when}</p>"
    if location:
        facts += f"<p><strong>Ort:</strong> {location}</p>"
    body = f"<p>Hallo {display_name or 'Löwe'},</p><p>ein neues Event wurde veröffentlicht:</p><p><strong>{title}</strong></p>{facts}"
    if preferences_url:
        body += f'<p style="font-size:12px;color:#6b7280">Newsletter abbestellen oder Kategorien ändern: <a href="{preferences_url}">E-Mail-Einstellungen öffnen</a>.</p>'
    return f"Neues Event: {title}", _wrap("Neues Event", body, "Event ansehen", url)


# Nachricht an alle Angemeldeten eines Events (#1372): von der Turnierleitung auf der Seite „Anmeldungen & Einlass“.
@mail_template
def tpl_event_message(display_name: str, event_name: str, message: str, url: str = "") -> tuple[str, str]:
    body = (
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        f"<p>die Turnierleitung von <strong>{event_name}</strong> schreibt allen Angemeldeten:</p>"
        f'<p style="border-left:3px solid {BRAND_CYAN};padding-left:12px;color:#374151;white-space:pre-line">{message}</p>'
    )
    return f"{event_name}: Nachricht der Turnierleitung", _wrap("Nachricht zum Event", body, "Zum Event", url)


# Absage (#2119): eigene Mails statt „Nachricht der Turnierleitung“ (Event, #2118) bzw. nur Glocke und Push (Turnier, #2120).
@mail_template
def tpl_event_cancelled(display_name: str, event_name: str, url: str = "") -> tuple[str, str]:
    body = (
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        f"<p><strong>{event_name}</strong> ist abgesagt. Deine Anmeldung ist damit storniert, auch ein Platz auf der Warteliste.</p>"
        "<p>Einen offenen Kostenbeitrag verrechnen wir nicht. Hast du schon eine Rechnung bekommen, meldet sich der Verein bei dir.</p>"
    )
    return f"Abgesagt: {event_name}", _wrap("Event abgesagt", body, "Zum Event" if url else None, url or None)


@mail_template
def tpl_tournament_cancelled(display_name: str, tournament_title: str, reason: str = "", url: str = "") -> tuple[str, str]:
    body = (
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        f"<p>die Turnierleitung hat <strong>{tournament_title}</strong> abgesagt. Deine Anmeldung ist damit hinfällig.</p>"
        + (f"<p><strong>Grund:</strong> {reason}</p>" if reason else "")
    )
    return f"Turnier abgesagt: {tournament_title}", _wrap("Turnier abgesagt", body, "Zum Turnier" if url else None, url or None)


@mail_template
def tpl_birthday_greeting(display_name: str, preferences_url: str = "") -> tuple[str, str]:
    body = (
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        "<p>alles Gute zum Geburtstag und einen starken Tag wünscht dir "
        "THE LION SQUAD eSports.</p>"
        "<p>Danke, dass du Teil unserer Community bist.</p>"
    )
    if preferences_url:
        body += (
            '<p style="font-size:12px;color:#6b7280">'
            f'Geburtstagsmails kannst du jederzeit in deinen <a href="{preferences_url}">'
            "E-Mail-Einstellungen</a> deaktivieren.</p>"
        )
    return "Alles Gute zum Geburtstag", _wrap("Alles Gute zum Geburtstag", body)


@mail_template
def tpl_achievement_recap(display_name: str, week: str, xp_week: str, level: str, level_title: str, unlocked: str = "", next_up: str = "",
                          bonus_hint: str = "", url: str = "", preferences_url: str = "") -> tuple[str, str]:
    """Wochenrückblick (#622): XP der Woche, Level, neue Erfolge, was als Nächstes kommt - nur an die Person selbst.
    `unlocked` sind Zeilen (je Erfolg eine), damit die Vorlage auch im Admin mit einfachem Text bearbeitbar bleibt.
    Die Werte kommen schon als Text geschützt an (mail_template) - hier also kein html.escape."""
    items = [line.strip() for line in str(unlocked or "").splitlines() if line.strip()]
    body = (
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        f"<p>deine Woche bei THE LION SQUAD ({week}):</p>"
        f'<p style="font-size:20px;margin:16px 0"><strong>+{xp_week} XP</strong> · Level {level}'
        + (f" – {level_title}" if level_title else "") + "</p>"
    )
    if items:
        body += "<p><strong>Neu freigeschaltet:</strong></p><ul>" + "".join(f"<li>{item}</li>" for item in items) + "</ul>"
    if next_up:
        body += f"<p><strong>Als Nächstes:</strong> {next_up}</p>"
    if bonus_hint:
        body += f'<p style="color:#6b7280">{bonus_hint}</p>'
    if preferences_url:
        body += (
            '<p style="font-size:12px;color:#6b7280">'
            f'Den Wochenrückblick kannst du jederzeit in deinen <a href="{preferences_url}">E-Mail-Einstellungen</a> abbestellen.</p>'
        )
    return f"Deine Woche: +{xp_week} XP", _wrap("Deine Woche", body, "Zu deinen Erfolgen", url or None)


@mail_template
def tpl_invoice_ready(display_name: str, source: str, amount: str, due_on: str = "", paid: str = "", url: str = "", preferences_url: str = "") -> tuple[str, str]:
    """„Deine Rechnung ist da“ (#841): Vorgang, Betrag, Zahlungsziel und der Weg zum PDF im Konto. Das PDF hängt nie an
    der Mail - es bleibt hinter der Anmeldung, nur für die Person selbst."""
    if paid:
        state = " – schon bezahlt, danke!"
    elif due_on:
        state = f", zahlbar bis <strong>{due_on}</strong>."
    else:
        state = "."
    body = (
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        f"<p>deine Rechnung zu <strong>{source}</strong> ist da: <strong>{amount}</strong>{state}</p>"
        "<p>Das PDF findest du in deinem Konto unter „Rechnungen“ – nach der Anmeldung, nur für dich.</p>"
    )
    if preferences_url:
        body += (
            '<p style="font-size:12px;color:#6b7280">'
            f'Diese Mails kannst du in deinen <a href="{preferences_url}">E-Mail-Einstellungen</a> abbestellen.</p>'
        )
    subject_source = (source or "deiner Anmeldung")[:80]
    return f"Deine Rechnung zu {subject_source} ist da", _wrap("Deine Rechnung ist da", body, "Rechnung ansehen", url or None)


@mail_template
def tpl_direct_message(display_name: str, sender_name: str, preview: str = "", url: str = "", preferences_url: str = "") -> tuple[str, str]:
    sender = sender_name or "Benutzer"
    body = (
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        f"<p><strong>{sender}</strong> hat dir eine Direktnachricht auf der Webseite geschickt.</p>"
    )
    if preview:
        body += f'<p style="border-left:3px solid {BRAND_CYAN};padding-left:12px;color:#374151">{preview}</p>'
    if preferences_url:
        body += (
            '<p style="font-size:12px;color:#6b7280">'
            f'Diese E-Mails kannst du in deinen <a href="{preferences_url}">'
            "Benachrichtigungs-Einstellungen</a> deaktivieren.</p>"
        )
    return f"Neue Nachricht von {sender[:80]}", _wrap(
        "Neue Direktnachricht", body, "Nachricht öffnen", url,
    )


@mail_template
def tpl_team_chat_mention(display_name: str, team_name: str, sender_name: str, preview: str = "", url: str = "", preferences_url: str = "") -> tuple[str, str]:
    team = team_name or "Team"
    body = (
        f"<p>Hallo {display_name or 'Löwe'},</p>"
        f"<p><strong>{sender_name or 'Benutzer'}</strong> hat dich im Team-Chat von <strong>{team}</strong> erwähnt.</p>"
    )
    if preview:
        body += f'<p style="border-left:3px solid {BRAND_CYAN};padding-left:12px;color:#374151">{preview}</p>'
    if preferences_url:
        body += (
            '<p style="font-size:12px;color:#6b7280">'
            f'Erwähnungs-Mails kannst du in deinen <a href="{preferences_url}">'
            "Benachrichtigungs-Einstellungen</a> deaktivieren.</p>"
        )
    return f"Erwähnung im Team-Chat: {team[:80]}", _wrap(
        "Du wurdest erwähnt", body, "Team-Chat öffnen", url,
    )


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


@mail_template
def tpl_test(branding: str = "THE LION SQUAD") -> tuple[str, str]:
    return "Testmail von THE LION SQUAD", _wrap(
        "E-Mail-Test",
        "<p>Diese Nachricht wurde über die Website von THE LION SQUAD eSports versendet.</p>"
        "<p>Sie dient nur zur Prüfung der SMTP-Konfiguration.</p>",
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
        "email_verification": tpl_email_verification,
        "password_reset": tpl_password_reset,
        "user_invite": tpl_user_invite,
        "account_banned": tpl_account_banned,
        "registration_received": tpl_registration_received,
        "registration_approved": tpl_registration_approved,
        "registration_rejected": tpl_registration_rejected,
        "checkin_closes_soon": tpl_checkin_closes_soon,
        "checkin_closes_soon_on_site": tpl_checkin_closes_soon_on_site,
        "match_reminder": tpl_match_reminder,
        "score_reported": tpl_score_reported,
        "dispute_opened": tpl_dispute_opened,
        "dispute_resolved": tpl_dispute_resolved,
        "tournament_finished": tpl_tournament_finished,
        "test": tpl_test,
        "match_lead_10m": tpl_match_lead_10m,
        "prize_ready": tpl_prize_ready,
        "prize_picked_up": tpl_prize_picked_up,
        "prize_expired": tpl_prize_expired,
        "membership_activated": tpl_membership_activated,
        "membership_deactivated": tpl_membership_deactivated,
        "membership_blocked": tpl_membership_blocked,
        "birthday_greeting": tpl_birthday_greeting,
        "achievement_recap": tpl_achievement_recap,
        "invoice_ready": tpl_invoice_ready,
        "direct_message": tpl_direct_message,
        "team_chat_mention": tpl_team_chat_mention,
        "newsletter_news": tpl_newsletter_news,
        "newsletter_event": tpl_newsletter_event,
        "event_message": tpl_event_message,
        "event_cancelled": tpl_event_cancelled,
        "tournament_cancelled": tpl_tournament_cancelled,
    }
    fn = templates.get(template_key)
    if not fn:
        return {"ok": False, "reason": "unknown template"}
    try:
        subject, html = fn(**kwargs)
    except TypeError as e:
        return {"ok": False, "reason": f"template args error: {e}"}
    # E-Mail-Vorlagen (#437 A): hat der Admin diese Vorlage überschrieben, gilt sein Betreff/HTML mit denselben Werten.
    from services.mail_overrides import apply_override
    subject, html = await apply_override(template_key, subject, html, kwargs)
    html = await _with_email_sponsors(html)
    if queue:
        from services.mail_queue import enqueue_mail
        return await enqueue_mail(
            to=to, subject=subject, html=html,
            template_key=template_key, scheduled_at=scheduled_at,
            dedupe_key=dedupe_key, meta=mail_meta,
        )
    return await send_mail(to, subject, html, template_key=template_key)


async def smtp_test(to: str) -> dict:
    """Direct synchronous SMTP test (does not use queue). Steht seit #1420 hier bei der Testvorlage, nicht in
    services/mail_queue.py - die Warteschlange importiert email_service sonst im Kreis."""
    from services.mail_queue import _smtp_send, explain_smtp_error, get_mail_settings

    cfg = await get_mail_settings()
    if cfg["provider"] != "smtp":
        return {"ok": False, "reason": "Provider ist nicht auf SMTP gesetzt."}
    if not cfg["smtp_host"]:
        return {"ok": False, "reason": "SMTP Host fehlt."}
    try:
        subject, html = tpl_test(branding="THE LION SQUAD")
        msg_id = await _smtp_send(cfg, to, subject, html)
        return {"ok": True, "id": msg_id}
    except Exception as exc:
        return {"ok": False, "reason": explain_smtp_error(exc), "raw_error": str(exc)[:500]}
