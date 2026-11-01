"""Bescheid zur eigenen Event-Anmeldung (#2127, EV6 und EV13) - wie bei Turnieren (``registration_notifications``).

Glocke und Push, dazu die Mail ``event_registration``, wenn die Person Mails zu Turnier-Updates zulässt:

- angemeldet oder auf der Warteliste (wer es gerade selbst getan hat, sieht es schon: kein Push),
- von der Warteliste nachgerückt - von selbst rückt niemand nach, die Leitung tut das per Knopf, weil Plätze etwas kosten
  können,
- von der Leitung storniert oder als „nicht erschienen“ eingetragen, wieder aktiviert oder auf die Warteliste gesetzt.

Einchecken und „Rückgängig“ ändern nichts daran, dass die Person dabei ist - dazu gibt es keine Nachricht. Wer sich selbst
abmeldet, bekommt ebenfalls keine; dann steht bei der Leitung der Hinweis auf den freien Platz. Personen ohne Konto (an
der Tür eingetragen) erreicht nichts davon.
"""
from __future__ import annotations

import logging

from services import pricing
from services.log_safe import log_safe

logger = logging.getLogger("tls.events.notifications")

KIND = "event_registration"
TEMPLATE = "event_registration"
ACTIVE = {"registered", "checked_in"}
ENDED = {"cancelled", "no_show"}
COST_ENDED = ("Ein offener Kostenbeitrag wird nicht verrechnet; wurde schon eine Rechnung gestellt, meldet sich der Verein bei dir.")


def _cost_line(registration: dict) -> str:
    """Der Satz zum Kostenbeitrag - nur, wenn wirklich abgerechnet wird. Kommt die Rechnung erst nach der Freigabe in der
    Finanzübersicht, steht sie noch nicht in „Meine Rechnungen“."""
    snapshot = registration.get("price_snapshot") or {}
    cents = int(snapshot.get("total_cents") or 0)
    if cents <= 0 or registration.get("billing_status") == "cancelled":
        return ""
    amount = pricing.format_cents(cents, snapshot.get("currency") or "EUR")
    later = snapshot.get("invoice_timing") not in (None, "on_confirm")
    invoice = "Die Rechnung bekommst du später unter „Meine Rechnungen“." if later else "Die Rechnung findest du unter „Meine Rechnungen“."
    return f"Dein Kostenbeitrag: {amount}. {invoice}"


def registration_message(event: dict, registration: dict, status: str, previous: str | None = None) -> dict | None:
    """Überschrift und Text für einen Stand der Anmeldung - oder nichts, wenn es dazu keine Nachricht gibt."""
    if status == previous or (status in ACTIVE and previous in ACTIVE):
        return None
    paid = bool(registration.get("price_snapshot"))
    if status in ACTIVE:
        if previous == "waitlist":
            headline, text = "Nachgerückt", "Ein Platz ist frei geworden – du bist von der Warteliste nachgerückt."
        elif previous in ENDED:
            headline, text = "Du bist wieder dabei", "Die Turnierleitung hat deine Anmeldung wieder aktiviert."
        else:
            headline, text = "Du bist dabei", "Deine Anmeldung ist gespeichert."
        return {"headline": headline, "detail": " ".join(part for part in (text, _cost_line(registration)) if part)}
    if status == "waitlist":
        first = ("Die Turnierleitung hat dich auf die Warteliste gesetzt." if previous else "Das Event ist voll – du stehst auf der Warteliste.")
        detail = f"{first} Wird ein Platz frei, kann dich die Turnierleitung nachholen; dann bekommst du Bescheid."
        return {"headline": "Warteliste", "detail": detail}
    if status == "cancelled":
        text = "Die Turnierleitung hat deine Anmeldung storniert."
        return {"headline": "Anmeldung storniert", "detail": f"{text} {COST_ENDED}" if paid else text}
    if status == "no_show":
        text = "Die Turnierleitung hat dich als „nicht erschienen“ eingetragen. Stimmt das nicht, wende dich bitte an sie."
        return {"headline": "Nicht erschienen", "detail": f"{text} {COST_ENDED}" if paid else text}
    return None


async def notify_registration_status(db, event: dict, registration: dict, status: str, *, previous: str | None = None,
                                     actor_id: str | None = None) -> bool:
    """Eine Nachricht je Stand - ein Fehler dabei hält nie die Anmeldung oder den Knopf der Leitung auf."""
    try:
        return await _send(db, event, registration, status, previous, actor_id)
    except Exception:  # noqa: BLE001
        logger.warning("Event %s: Bescheid zur Anmeldung nicht verschickt", log_safe(event.get("id")), exc_info=True)
        return False


async def _send(db, event: dict, registration: dict, status: str, previous: str | None, actor_id: str | None) -> bool:
    if registration.get("walk_in") or not registration.get("user_id"):
        return False
    message = registration_message(event, registration, status, previous)
    if not message:
        return False
    user = await db.users.find_one(
        {"id": registration["user_id"], "is_active": {"$ne": False}, "is_banned": {"$ne": True}, "anonymized_at": None},
        {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1, "notification_preferences": 1, "newsletter_consent": 1},
    )
    if not user:
        return False
    from services.notification_preferences import send_user_template
    from services.user_notifications import build_public_url, create_user_notification

    name = event.get("name") or "Event"
    path = f"/events/{event.get('slug') or event['id']}"
    stamp = registration.get("updated_at") or registration.get("created_at") or ""
    dedupe = f"event-registration:{registration.get('id')}:{status}:{stamp}"
    meta = {"category": "tournament_updates", "dedupe_key": dedupe, "event_id": event.get("id"), "registration_id": registration.get("id"), "status": status}
    if user["id"] == actor_id:
        meta["in_app_only"] = True  # wer es gerade selbst getan hat, sieht es schon auf dem Bildschirm
    sent = await create_user_notification(user["id"], f"{message['headline']}: {name}", message["detail"], url=path, kind=KIND, meta=meta)
    url = await build_public_url(path)
    await send_user_template(
        user, TEMPLATE, "tournament_updates", dedupe_key=f"{dedupe}:mail",
        display_name=user.get("display_name") or user.get("username") or "", event_name=name,
        headline=message["headline"], detail=message["detail"], url=url,
    )
    return bool(sent)
