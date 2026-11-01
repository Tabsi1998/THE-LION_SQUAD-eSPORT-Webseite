"""Wer bei der Mitgliedschaft was erfährt (#2125).

Entscheidungen über die eigene Mitgliedschaft (aufgenommen, abgelehnt, gesperrt, beendet) kommen immer an: als Mail und als
Meldung, unabhängig von „Vereinsmitgliedschaft“ in den Einstellungen. Die Verwaltung sieht am Rückgabewert ehrlich, was mit
der Mail passiert ist. Hinweise an den Vorstand gehen an alle mit dem Bereich Vereinsverwaltung."""
from __future__ import annotations

import logging
import re

from services.log_safe import log_safe

logger = logging.getLogger("tls.membership")

# Was mit der Mail passiert ist - die Verwaltung bekommt genau das zurück (lib/membershipMail.js).
QUEUED = "queued"
SKIPPED = "skipped"  # Die Verwaltung hat „ohne Mail“ gewählt.
NO_ADDRESS = "no_address"
MAIL_OFF = "mail_off"  # Eingereiht, aber der Mailversand ist abgeschaltet: Sie liegt nur in der Warteschlange.
FAILED = "failed"

ACTIVE_NOTICES = ("active", "honorary")
STATUS_NOTICES = {
    "active": ("membership_activated", "Deine Mitgliedschaft ist aktiv", "Willkommen im Verein! Karte und Vorteile findest du in deiner Mitgliedschaft."),
    "honorary": ("membership_activated", "Du bist Ehrenmitglied", "Karte und Vorteile findest du in deiner Mitgliedschaft."),
    "inactive": ("membership_deactivated", "Deine Mitgliedschaft ruht", "Fragen dazu beantwortet dir der Vorstand."),
    "former": ("membership_deactivated", "Deine Mitgliedschaft ist beendet", "Fragen dazu beantwortet dir der Vorstand."),
    "blocked": ("membership_blocked", "Deine Mitgliedschaft ist gesperrt", "Fragen dazu beantwortet dir der Vorstand."),
}


async def honest_mail_state(state: str) -> str:
    """Eingereiht heißt nur dann unterwegs, wenn der Versand eingeschaltet ist."""
    if state != QUEUED:
        return state
    from services.mail_queue import get_mail_settings

    return QUEUED if (await get_mail_settings()).get("enabled", True) else MAIL_OFF


def first_sentence(text: str | None, limit: int = 140) -> str:
    """Der erste Satz einer Begründung - für den Sperrbildschirm und fremde Dienste; der volle Text steht in Mail und Glocke."""
    clean = " ".join(str(text or "").split())
    match = re.match(r".+?[.!?](?=\s|$)", clean)
    sentence = match.group(0) if match else clean
    return sentence if len(sentence) <= limit else f"{sentence[:limit - 1].rstrip()}…"


async def tell_person(user_id: str | None, title: str, body: str, url: str = "", *, dedupe_key: str | None = None, push_body: str | None = None) -> None:
    """Die Meldung in Glocke und App. Sie darf eine Entscheidung nie aufhalten."""
    from services.user_notifications import create_user_notification

    meta = {**({"dedupe_key": dedupe_key} if dedupe_key else {}), **({"push_body": push_body} if push_body else {})}
    try:
        await create_user_notification(user_id, title=title, body=body, url=url, kind="membership_decision", meta=meta or None)
    except Exception:  # noqa: BLE001
        logger.exception("Meldung zur Mitgliedschaft fehlgeschlagen")


async def tell_status_change(user: dict, membership: dict, status: str, *, notify: bool = True) -> str | None:
    """Mail und Meldung zu einem neuen Status - ``None``, wenn dieser Status keine hat (kein Mitglied, Entwurf)."""
    from services.notification_preferences import send_user_template

    notice = STATUS_NOTICES.get(status)
    if not notice:
        return None
    if not notify:
        return SKIPPED
    template_key, title, body = notice
    # Der Mitgliederbereich steht nur Mitgliedern offen - wer nicht mehr aktiv ist, käme dort nicht weiter.
    await tell_person(user.get("id"), title, body, "/members/membership" if status in ACTIVE_NOTICES else "")
    if not user.get("email"):
        return NO_ADDRESS
    values = {"display_name": user.get("display_name") or user.get("username")}
    if template_key == "membership_activated":
        values["member_number"] = membership.get("member_number") or ""
    try:
        result = await send_user_template(user, template_key, **values)
    except Exception:  # noqa: BLE001 - der Status ist gespeichert; die Verwaltung erfährt, dass die Mail fehlt
        logger.warning("[membership] Mail zum Status %s fehlgeschlagen", log_safe(status), exc_info=True)
        return FAILED
    return await honest_mail_state(QUEUED if result.get("ok", True) else FAILED)


async def mail_club_area(db, template_key: str, values: dict, *, subject: str, html: str, exclude: str | None = None) -> int:
    """Ein Hinweis an alle mit dem Bereich Vereinsverwaltung: Rolle, Freigabe, Vorstandsposten, Dolibarr-Funktion. Nur der Name
    der Person - keine weiteren Daten aus dem Antrag."""
    from services.mail_queue import enqueue_mail
    from services.mail_templates import render_template
    from services.member_announcements import club_area_user_ids

    ids = await club_area_user_ids(db) - {exclude}
    if not ids:
        return 0
    rendered_subject, rendered_html = await render_template(template_key, values, fallback_subject=subject, fallback_html=html)
    sent = 0
    async for user in db.users.find({"id": {"$in": sorted(ids)}, "email": {"$nin": [None, ""]}}, {"_id": 0, "email": 1}):
        await enqueue_mail(to=user["email"], subject=rendered_subject, html=rendered_html, template_key=template_key)
        sent += 1
    return sent
