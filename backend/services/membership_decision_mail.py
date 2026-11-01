"""Mail zur Entscheidung über einen Mitgliedsantrag (#1444) - ein Weg für Admin und Dolibarr.

Die Vorlagen ``membership_approve`` und ``membership_reject`` liegen in der Datenbank (Admin →
Mail-Vorlagen); fehlt eine, gilt der Ersatztext hier. Die Mail geht über die Warteschlange und kommt immer an (#2125):
Wer eine Entscheidung über den eigenen Antrag nicht erfährt, wartet ins Leere. Dazu kommt eine Meldung in Glocke und App.
Ein Fehler beim Einreihen geht an den Aufrufer: nur er weiß, ob er es später noch einmal versucht.
"""
from __future__ import annotations

from services.membership_notices import NO_ADDRESS, QUEUED, tell_person

__all__ = ["NO_ADDRESS", "QUEUED", "queue_decision_mail"]


async def queue_decision_mail(user: dict | None, *, approved: bool, note: str = "", application_id: str | None = None) -> str:
    """Die Entscheidung in die Mail-Warteschlange legen. Zurück kommt, was passiert ist: ``queued`` oder ``no_address``."""
    from services.mail_templates import render_template
    from services.mail_queue import enqueue_mail

    if user and user.get("id"):
        lead = "Deine Bewerbung wurde angenommen. Willkommen im Verein!" if approved else "Deine Bewerbung wurde abgelehnt."
        await tell_person(user["id"], "Mitgliedsbewerbung angenommen" if approved else "Mitgliedsbewerbung abgelehnt", f"{lead} {note}".strip(),
                          "/members/membership" if approved else "/membership/apply",
                          dedupe_key=f"membership-decision:{application_id}" if application_id else None)
    if not user or not user.get("email"):
        return NO_ADDRESS
    template_key = "membership_approve" if approved else "membership_reject"
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
