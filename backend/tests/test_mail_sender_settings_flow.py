"""Absender, Antworten-an und „Versand aktiv“ an einer Stelle (#2119 ML3).

Der Resend-Abschnitt schrieb diese Werte nach `settings.email`, der Versand liest aber zuerst `settings.mail` (SMTP).
Sobald SMTP einmal gespeichert war, wirkten Änderungen im Resend-Abschnitt still nicht mehr. Jetzt landen beide in
`settings.mail`, und beide Abschnitte zeigen den Wert, der wirklich gilt.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_the_resend_section_changes_what_really_applies_after_smtp_was_saved(flow):
    from services.mail_queue import get_mail_settings

    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    smtp = await flow.put("/api/settings/smtp", json={"provider": "resend", "sender_name": "Verein SMTP", "sender_email": "smtp@example.test", "enabled": True})
    assert smtp.status_code == 200, smtp.text

    saved = await flow.put("/api/settings/email", json={"sender_name": "Verein Neu", "sender_email": "neu@example.test",
                                                        "reply_to_email": "office@example.test", "enabled": False})
    assert saved.status_code == 200, saved.text

    applied = await get_mail_settings()
    assert (applied["sender_name"], applied["sender_email"], applied["reply_to_email"], applied["enabled"]) == (
        "Verein Neu", "neu@example.test", "office@example.test", False)
    for path in ("/api/settings/email", "/api/settings/smtp"):
        shown = (await flow.get(path)).json()
        assert (shown["sender_name"], shown["sender_email"], shown["reply_to_email"], shown["enabled"]) == (
            "Verein Neu", "neu@example.test", "office@example.test", False), path


@pytest.mark.asyncio
async def test_both_sections_show_older_values_that_still_apply(flow):
    """Ältere Installationen haben den Absender nur im Resend-Teil - die SMTP-Seite zeigte dann leere Felder."""
    from services.mail_queue import get_mail_settings

    await flow.db.settings.insert_one({"id": "email", "sender_name": "Altverein", "sender_email": "alt@example.test", "enabled": True})
    await flow.db.settings.insert_one({"id": "mail", "provider": "resend"})
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)

    assert (await get_mail_settings())["sender_name"] == "Altverein"
    smtp = (await flow.get("/api/settings/smtp")).json()
    assert smtp["sender_name"] == "Altverein" and smtp["sender_email"] == "alt@example.test"
    assert smtp["reply_to_email"] == "alt@example.test"
    email = (await flow.get("/api/settings/email")).json()
    assert email["sender_name"] == "Altverein"
