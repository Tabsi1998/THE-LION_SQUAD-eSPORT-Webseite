"""Mail-Vorlagen aus der Datenbank füllen (#1420: aus routes/phase_ef_routes.py herausgelöst).

Dienste wie Moderation, Mitgliedsentscheid und Einladungen brauchen die Vorlage, ohne eine Route zu importieren.
"""
import re

from database import get_db
from services.email_delivery import fill_placeholders


async def render_template(key: str, vars_: dict, fallback_subject: str = "", fallback_html: str = "") -> tuple[str, str]:
    """Vorlage aus der Datenbank (oder der Ersatztext des Aufrufers) mit `{{var}}`-Werten: im HTML jeder Wert als
    Text, im Betreff einzeilig (services/email_delivery). Werte gehören deshalb immer als `{{var}}` in den
    Ersatztext, nie direkt hineingeschrieben."""
    db = get_db()
    t = await db.email_templates.find_one({"key": key}, {"_id": 0})
    subj = (t and t.get("subject")) or fallback_subject
    html = (t and t.get("html")) or fallback_html
    values = vars_ or {}
    # Ein Absatz nur für einen leeren Wert (etwa „{{note}}“ ohne Notiz, #2119) fällt weg statt leer stehen zu bleiben.
    body = _EMPTY_PARAGRAPH.sub("", fill_placeholders(html, values, as_html=True))
    return fill_placeholders(subj, values, as_html=False), body


_EMPTY_PARAGRAPH = re.compile(r"<p>\s*(?:<(em|strong|i|b)>\s*</\1>\s*)?</p>", re.IGNORECASE)
