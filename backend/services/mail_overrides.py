"""Vom Admin überschriebene Mail-Vorlagen anwenden (#437 A; #1420: aus services/mail_catalog.py herausgelöst).

email_service.py setzt beim Versand Betreff und HTML des Admins ein; der Katalog (services/mail_catalog.py) liest
dafür die festen Vorlagen aus email_service. Ein Blatt, damit sich die beiden nicht gegenseitig importieren.
"""
from __future__ import annotations

from typing import Any

from database import get_db
from services.email_delivery import fill_placeholders


def substitute(text: str, values: dict[str, Any], escape: bool) -> str:
    """`{{variable}}` einsetzen: im HTML (escape=True) jeder Wert als Text, im Betreff einzeilig - siehe
    services/email_delivery. Der Vorlagentext des Admins bleibt, wie er ist."""
    return fill_placeholders(text, values, as_html=escape)


async def apply_override(template_key: str, subject: str, html: str, values: dict[str, Any]) -> tuple[str, str]:
    """Hat der Admin eine feste Vorlage überschrieben, gilt sein Betreff/HTML mit den Werten des Versands."""
    db = get_db()
    doc = await db.email_templates.find_one({"key": template_key, "override": True}, {"_id": 0, "subject": 1, "html": 1})
    if not doc or not (doc.get("html") or "").strip():
        return subject, html
    return substitute(doc.get("subject") or subject, values, escape=False), substitute(doc["html"], values, escape=True)
