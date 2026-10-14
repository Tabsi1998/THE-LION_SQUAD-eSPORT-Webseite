"""Mail zur Entscheidung über einen Mitgliedsantrag (#1444) - ein Weg für Admin und Dolibarr.

Die Vorlagen ``membership_approve`` und ``membership_reject`` liegen in der Datenbank (Admin →
Mail-Vorlagen); fehlt eine, gilt der Ersatztext hier. Die Mail geht über die Warteschlange und nur,
wenn die Person Mitgliedschafts-Mails zulässt. Ein Fehler beim Einreihen geht an den Aufrufer:
nur er weiß, ob er es später noch einmal versucht.
"""
from __future__ import annotations

QUEUED = "queued"
SWITCHED_OFF = "switched_off"
NO_ADDRESS = "no_address"


async def queue_decision_mail(user: dict | None, *, approved: bool, note: str = "", application_id: str | None = None) -> str:
    """Die Entscheidung in die Mail-Warteschlange legen. Zurück kommt, was passiert ist:
    ``queued``, ``switched_off`` (die Person will keine Mitgliedschafts-Mails) oder ``no_address``."""
    from services.mail_templates import render_template
    from services.mail_queue import enqueue_mail
    from services.notification_preferences import email_allowed

    if not user or not user.get("email"):
        return NO_ADDRESS
    template_key = "membership_approve" if approved else "membership_reject"
    if not email_allowed(user, template_key, "membership_updates"):
        return SWITCHED_OFF
    display = user.get("display_name") or user.get("username") or "Spieler"
    # Werte nur als {{…}} - render_template setzt sie als Text ein.
    subject, html = await render_template(
        template_key,
        {"display_name": display, "note": note or ""},
        fallback_subject=("Mitgliedsbewerbung angenommen 🦁" if approved else "Mitgliedsbewerbung abgelehnt"),
        fallback_html=("<p>Hallo {{display_name}},</p><p>Deine Bewerbung wurde "
                       f"{'angenommen' if approved else 'abgelehnt'}.</p>"
                       "<p>{{note}}</p>"),
    )
    # Je Antrag höchstens eine Entscheidungsmail - auch wenn ein Lauf nach dem Einreihen abbricht.
    dedupe_key = f"membership-decision:{application_id}" if application_id else None
    await enqueue_mail(user["email"], subject, html, template_key=template_key, dedupe_key=dedupe_key)
    return QUEUED
