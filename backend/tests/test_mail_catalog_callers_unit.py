"""Unter „System → E-Mail-Vorlagen“ steht keine Vorlage, die nie verschickt wird (#1133).

Jeder Schlüssel im Katalog braucht einen Aufrufer außerhalb der Vorlagen selbst - sonst kann der Admin eine Mail
bearbeiten, die nie ankommt. Entscheidung des Betreibers: die drei Anmelde-Mails und „Turnier beendet“ sind
angebunden; die vier Vorlauf-Mails (24 Stunden, 2 Stunden, 30 und 5 Minuten) und die zwei Check-in-Mails („öffnet
bald“, „offen“) sind weggefallen.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.mail_catalog import CATALOG, code_templates  # noqa: E402
from services.notification_preferences import TEMPLATE_CATEGORY  # noqa: E402

BACKEND = pathlib.Path(__file__).resolve().parents[1]
# Wo die Vorlagen selbst stehen - ein Treffer dort ist kein Aufrufer. Aus den Einstellungen zählt nur die Liste der
# Kategorien nicht; der Newsletter-Versand dort ist ein echter Aufrufer.
DEFINITIONS = {"email_service.py", "mail_catalog.py"}


def _without_category_list(text: str) -> str:
    start = text.find("TEMPLATE_CATEGORY = {")
    if start < 0:
        return text
    end = text.find("\n}\n", start)
    return text[:start] + text[end + 3:]
REMOVED = {"match_lead_24h", "match_lead_2h", "match_lead_30m", "match_lead_5m", "checkin_opens_soon", "checkin_reminder"}


def _sources() -> str:
    texts = []
    for path in BACKEND.rglob("*.py"):
        relative = path.relative_to(BACKEND).as_posix()
        if relative.startswith(("tests/", "venv", ".venv")) or path.name in DEFINITIONS:
            continue
        texts.append(_without_category_list(path.read_text(encoding="utf-8").replace("\r\n", "\n")))
    return "\n".join(texts)


def test_every_catalog_mail_has_a_caller():
    sources = _sources()
    unused = [key for key in CATALOG if f'"{key}"' not in sources]
    assert unused == [], f"Vorlagen ohne Aufrufer: {unused}"


def test_removed_mails_are_gone_everywhere():
    assert REMOVED.isdisjoint(CATALOG)
    assert REMOVED.isdisjoint(code_templates())
    assert REMOVED.isdisjoint(TEMPLATE_CATEGORY)


def test_registration_texts_promise_nothing_that_does_not_happen():
    templates = code_templates()
    _subject, received = templates["registration_received"]("Cup", "https://example.test/t")
    assert "weitere E-Mail" not in received, "die Selbstanmeldung ist sofort bestätigt - kein Versprechen einer zweiten Mail"
    _subject, approved = templates["registration_approved"]("Cup", "https://example.test/t", "Ein Platz ist frei geworden.")
    assert "Ein Platz ist frei geworden." in approved
    _subject, rejected = templates["registration_rejected"]("Cup", "<b>zu spät</b>")
    assert "&lt;b&gt;zu spät&lt;/b&gt;" in rejected, "der Grund wird als Text gezeigt"
    for key in ("checkin_closes_soon",):
        _subject, html = templates[key]("Cup", "18:30 Uhr", "https://example.test/t")
        assert "Warteliste" not in html
