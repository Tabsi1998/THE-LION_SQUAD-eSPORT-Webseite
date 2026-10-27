"""Werte in Mails sind Text, nie Formatierung: Namen, Teamnamen, Turniertitel und freie Texte stehen in jeder Mail so,
wie sie eingegeben wurden - im HTML geschützt, im Betreff in einer Zeile, in der Text-Fassung ohne &lt;. Nur HTML, das
unser Code selbst baut (Knopf, Link-Block, Liste, Zitat), bleibt HTML."""
import inspect
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from flow_harness import make_flow  # noqa: E402
from spam_forms import form_fields  # noqa: E402
from services.email_delivery import SafeHtml, fill_placeholders, header_text, html_to_text, html_value  # noqa: E402
from services.mail_catalog import code_templates  # noqa: E402

NAME = '<b>X</b> <a href="https://example.test">klick</a>'
SHOWN = "&lt;b&gt;X&lt;/b&gt; &lt;a href=&quot;https://example.test&quot;&gt;klick&lt;/a&gt;"
RAW = ("<b>X</b>", '<a href="https://example.test">')


@pytest_asyncio.fixture
async def flow(monkeypatch):
    # Formular-Token und Zähler des Spamschutzes (#2067) brauchen das Server-Geheimnis.
    monkeypatch.setenv("JWT_SECRET", "spam-guard-aware-tests-secret-with-32-characters")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def assert_text_only(html: str, where: str) -> None:
    leaked = [mark for mark in RAW if mark in html]
    doubled = [mark for mark in ("&amp;lt;", "&amp;gt;", "&amp;quot;", "&amp;amp;") if mark in html]
    assert leaked == [], f"{where}: ein Wert wurde zu Formatierung"
    assert doubled == [], f"{where}: ein Wert wurde doppelt geschützt"


# --------------------------------------------------------------------------- jede feste Vorlage
@pytest.mark.parametrize("key", sorted(code_templates()))
def test_every_template_shows_each_value_as_text(key):
    render = code_templates()[key]
    values = {name: NAME for name in inspect.signature(render).parameters}
    subject, html = render(**values)
    assert_text_only(html, key)
    if key != "test":  # die Testmail zeigt keinen Wert
        assert SHOWN in html, f"{key}: der Wert fehlt oder steht nicht als Text da"
    assert "\n" not in subject and "\r" not in subject
    assert "&lt;" not in subject and "&amp;" not in subject, f"{key}: der Betreff ist Text, kein HTML"


def test_every_template_runs_through_the_one_protection():
    templates = code_templates()  # jede Funktion tpl_* in email_service
    unprotected = sorted(key for key, render in templates.items() if not getattr(render, "is_mail_template", False))
    assert len(templates) >= 25
    assert unprotected == [], f"Vorlagen ohne @mail_template: {unprotected}"


def test_the_helpers_escape_once_and_keep_subjects_on_one_line():
    once = html_value("<b>&</b>")
    twice = html_value(once)
    assert once == "&lt;b&gt;&amp;&lt;/b&gt;" and twice == once, "schon geschützt wird nicht noch einmal geschützt"
    assert html_value(None) == "" and html_value(SafeHtml("<em>ok</em>")) == "<em>ok</em>"
    assert header_text("Cup\r\nBcc: opfer@example.test x") == "Cup Bcc: opfer@example.test x"
    assert header_text(SafeHtml("<b>Cup</b>")) == "Cup" and header_text(None) == ""
    # In einem Durchgang: ein Wert zieht keinen weiteren Platzhalter nach.
    filled = fill_placeholders("<p>{{a}} {{b}} {{c}}</p>", {"a": "{{b}}", "b": "<i>", "c": SafeHtml("<br>")}, as_html=True)
    assert filled == "<p>{{b}} &lt;i&gt; <br></p>"
    subject = fill_placeholders("Hallo {{a}} {{fehlt}}", {"a": "Max\nMoritz"}, as_html=False)
    assert subject == "Hallo Max Moritz {{fehlt}}"


# --------------------------------------------------------------------------- Mails, wie sie rausgehen
@pytest.mark.asyncio
async def test_names_and_titles_reach_the_queue_as_text(flow):
    from email_service import send_template

    sends = [
        ("registration", {"display_name": NAME}),
        ("match_lead_10m", {"tournament_title": NAME, "opponent": NAME, "when": "18:00", "url": "https://lionsquad.example/m/1", "station": NAME}),
        ("team_chat_mention", {"display_name": NAME, "team_name": NAME, "sender_name": NAME, "preview": NAME, "url": "https://lionsquad.example/t/1"}),
        ("prize_ready", {"display_name": NAME, "tournament_title": NAME, "place": "1", "prize_label": NAME}),
        ("newsletter_event", {"display_name": NAME, "title": NAME, "when": NAME, "location": NAME, "url": "https://lionsquad.example/e/1"}),
    ]
    for index, (key, values) in enumerate(sends):
        outcome = await send_template(key, f"empfang{index}@example.test", **values)
        assert outcome["ok"], key
        job = await flow.db.mail_jobs.find_one({"to": f"empfang{index}@example.test"}, {"_id": 0})
        assert_text_only(job["html"], key)
        assert SHOWN in job["html"], key
        # Die Text-Fassung zeigt den Namen, wie er eingegeben wurde - ohne &lt;.
        text = html_to_text(job["html"])
        assert NAME in text and "&lt;" not in text, key
    mention = await flow.db.mail_jobs.find_one({"to": "empfang2@example.test"}, {"_id": 0})
    assert mention["subject"] == f"Erwähnung im Team-Chat: {NAME}", "Betreff ist Text - nicht geschützt, nicht verändert"


@pytest.mark.asyncio
async def test_a_line_break_in_a_value_never_reaches_a_subject(flow, monkeypatch):
    from email_service import send_mail, send_template
    from services.mail_queue import enqueue_mail

    queued = await send_template("registration_received", "zeile@example.test", tournament_title="Cup\r\nBcc: opfer@example.test", url="https://lionsquad.example/t")
    assert queued["ok"]
    job = await flow.db.mail_jobs.find_one({"to": "zeile@example.test"}, {"_id": 0})
    assert job["subject"] == "Anmeldung eingegangen: Cup Bcc: opfer@example.test"

    await enqueue_mail("direkt@example.test", "Hallo\nBcc: opfer@example.test", "<p>x</p>")
    direct = await flow.db.mail_jobs.find_one({"to": "direkt@example.test"}, {"_id": 0})
    assert direct["subject"] == "Hallo Bcc: opfer@example.test"

    # Der alte Sofort-Weg (Resend) ebenso.
    import resend

    seen = []
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    monkeypatch.setattr(resend, "api_key", None)
    monkeypatch.setattr(resend.Emails, "send", lambda params: seen.extend([params]) or {"id": "m-1"})
    result = await send_mail("sofort@example.test", "Test\r\nBcc: opfer@example.test", "<p>x</p>")
    assert result["ok"] and seen[0]["subject"] == "Test Bcc: opfer@example.test"


@pytest.mark.asyncio
async def test_admin_templates_keep_their_html_and_show_values_as_text(flow):
    from routes.phase_ef_routes import render_template
    from email_service import send_template

    await flow.db.email_templates.update_one(
        {"key": "moderation_notice"},
        {"$set": {"key": "moderation_notice", "subject": "Hinweis für {{display_name}}",
                  "html": "<p>Hallo <em>{{display_name}}</em>: <strong>{{reason}}</strong> {{regeln}}</p>"}},
        upsert=True,
    )
    link = SafeHtml('<a href="https://lionsquad.example/regeln">Regeln</a>')
    subject, html = await render_template("moderation_notice", {"display_name": NAME + "\n{{reason}}", "reason": "Spam", "regeln": link})
    assert html == f"<p>Hallo <em>{SHOWN}\n{{{{reason}}}}</em>: <strong>Spam</strong> {link}</p>", "Admin-HTML bleibt, Werte als Text, SafeHtml als HTML"
    assert subject == f"Hinweis für {NAME} {{{{reason}}}}"

    # Eine überschriebene feste Vorlage: dasselbe.
    await flow.db.email_templates.update_one(
        {"key": "registration"},
        {"$set": {"key": "registration", "override": True, "subject": "Servus {{display_name}}", "html": "<p><strong>Servus</strong> {{display_name}}</p>"}},
        upsert=True,
    )
    sent = await send_template("registration", "admin-vorlage@example.test", display_name=NAME + "\r\nX")
    assert sent["ok"]
    job = await flow.db.mail_jobs.find_one({"to": "admin-vorlage@example.test"}, {"_id": 0})
    assert job["subject"] == f"Servus {NAME} X" and f"<p><strong>Servus</strong> {SHOWN}\r\nX</p>" in job["html"]


@pytest.mark.asyncio
async def test_moderation_mail_without_saved_template_shows_name_and_reason_as_text(flow):
    await flow.db.email_templates.delete_many({"key": "moderation_notice"})  # der Ersatztext im Code gilt
    mod = await flow.add_user(role="moderator", name="mod")
    paula = await flow.add_user(role="player", name="paula")
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"display_name": NAME, "email": "paula-mod@example.test"}})
    flow.act_as(mod)
    strike = await flow.post(f"/api/moderation/people/{paula['id']}/strikes", json={"note": NAME})
    assert strike.status_code == 200, strike.text
    job = await flow.db.mail_jobs.find_one({"to": "paula-mod@example.test", "template_key": "moderation_notice"}, {"_id": 0})
    assert job, "die Mail geht raus"
    assert_text_only(job["html"], "moderation_notice")
    assert job["html"].startswith(f"<p>Hallo {SHOWN},</p><p>Hinweis. Grund: ")
    assert job["html"].count(SHOWN) == 2, "Name und Grund - beide als Text"


@pytest.mark.asyncio
async def test_contact_form_mails_show_the_sender_text_as_text(flow):
    await flow.db.email_templates.delete_many({"key": "contact_auto_reply"})  # der Ersatztext im Code gilt
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "contact_email": "vorstand@example.test"}}, upsert=True)
    sent = await flow.post("/api/contact/submit", json={
        "name": NAME, "email": "absender@lionsquad-test.at", "topic": "general", "subject": "Frage <i>wichtig</i>",
        "message": "Hallo <img src=https://example.test/p.png> bitte melden", "accept_privacy": True, **form_fields("contact"),
    })
    assert sent.status_code == 200, sent.text
    reply = await flow.db.mail_jobs.find_one({"to": "absender@lionsquad-test.at"}, {"_id": 0})
    board = await flow.db.mail_jobs.find_one({"to": "vorstand@example.test"}, {"_id": 0})
    for job in (reply, board):
        assert_text_only(job["html"], job["template_key"])
        assert "<img src=https://example.test" not in job["html"] and "&lt;img src=https://example.test/p.png&gt;" in job["html"]
    assert "<p>Hallo &lt;b&gt;X&lt;/b&gt;,</p>" in reply["html"], "Antwort: nur der Vorname, als Text"
    assert reply["subject"] == "Bestätigung: Wir haben deine Nachricht erhalten — Frage <i>wichtig</i>"
    assert f"<strong>Name:</strong> {SHOWN}<br/>" in board["html"] and "Frage &lt;i&gt;wichtig&lt;/i&gt;" in board["html"]
    assert board["subject"] == "[TLS Kontakt] Allgemeine Anfrage: Frage <i>wichtig</i>"


@pytest.mark.asyncio
async def test_membership_mails_show_names_and_notes_as_text(flow):
    board = await flow.add_user(role="club_admin", name="vorstand")
    paula = await flow.add_user(role="player", name="paula")
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"display_name": NAME}})
    paula["display_name"] = NAME
    flow.act_as(board)
    invited = await flow.post("/api/admin/membership-invitations", json={"user_id": paula["id"], "note": NAME})
    assert invited.status_code == 200, invited.text
    invite = await flow.db.mail_jobs.find_one({"template_key": "membership_invited"}, {"_id": 0})
    assert_text_only(invite["html"], "membership_invited")
    assert f"<p>Hallo {SHOWN},</p>" in invite["html"]
    assert f"<p><em>{SHOWN}</em></p>" in invite["html"], "der Hinweis-Block bleibt HTML, der Hinweis darin ist Text"

    flow.act_as(paula)
    applied = await flow.post("/api/membership/apply", json={
        "motivation": "Ich möchte mitspielen und mich beim Verein einbringen.", "contribution_pref": "full",
        "accept_statutes": True, "accept_privacy": True,
    })
    assert applied.status_code == 200, applied.text
    notice = await flow.db.mail_jobs.find_one({"to": board["email"]}, {"_id": 0})
    assert notice and notice["html"].startswith(f"<p>{SHOWN} hat eine Mitgliedsbewerbung eingereicht.")
    assert_text_only(notice["html"], "membership_application_admin")


# --------------------------------------------------------------------------- HTML, das unser Code baut, bleibt HTML
SAFE_BLOCKS = [
    ("knopf", "email_verification", {"display_name": NAME, "verification_url": "https://lionsquad.example/verify-email?token=a&next=%2Fturniere"},
     '<p style="margin:24px 0 0"><a href="https://lionsquad.example/verify-email?token=a&amp;next=%2Fturniere" '),
    ("knopf-beschriftung", "password_reset", {"reset_url": "https://lionsquad.example/reset"}, ">Passwort zurücksetzen</a></p>"),
    ("titel", "registration", {"display_name": NAME},
     f'<div style="margin-top:10px;font-size:24px;font-weight:700;color:#111827;line-height:1.25">Willkommen in der Community, {SHOWN}</div>'),
    ("einstellungen-link", "newsletter_news", {"display_name": NAME, "title": NAME, "preferences_url": "https://lionsquad.example/profile?tab=notifications&x=1"},
     '<a href="https://lionsquad.example/profile?tab=notifications&amp;x=1">E-Mail-Einstellungen öffnen</a>'),
    ("liste", "achievement_recap", {"display_name": NAME, "week": "1", "xp_week": "5", "level": "2", "level_title": "", "unlocked": f"Champion III\n{NAME}"},
     f"<ul><li>Champion III</li><li>{SHOWN}</li></ul>"),
    ("station", "match_lead_10m", {"tournament_title": "Cup", "opponent": NAME, "when": "18:00", "url": "https://lionsquad.example/m", "station": "Station 3"},
     "<p>Station: <strong>Station 3</strong></p>"),
    ("zitat", "direct_message", {"display_name": NAME, "sender_name": NAME, "preview": NAME, "url": "https://lionsquad.example/m"},
     f'<p style="border-left:3px solid #29B6E8;padding-left:12px;color:#374151">{SHOWN}</p>'),
    ("grund", "registration_rejected", {"tournament_title": "Cup", "reason": NAME}, f"<p><em>Grund: {SHOWN}</em></p>"),
    ("rechnung", "invoice_ready", {"display_name": NAME, "source": NAME, "amount": "40,00 €", "due_on": "17.10.2026"},
     f"deine Rechnung zu <strong>{SHOWN}</strong> ist da: <strong>40,00 €</strong>, zahlbar bis <strong>17.10.2026</strong>."),
]


@pytest.mark.parametrize("block,key,values,fragment", SAFE_BLOCKS, ids=[block[0] for block in SAFE_BLOCKS])
def test_html_our_code_builds_still_renders_as_html(block, key, values, fragment):
    html = code_templates()[key](**values)[1]
    assert fragment in html, f"{block}: der Block ist kein HTML mehr oder der Wert darin nicht als Text"


@pytest.mark.asyncio
async def test_the_sponsor_block_stays_html(flow):
    from email_service import send_template

    await flow.db.sponsors.insert_one({"id": "s-1", "name": "Alpha <Energy>", "logo_url": "https://cdn.example.test/logo.png",
                                       "link": "https://sponsor.example.test/?a=1&b=2", "show_in_emails": True, "is_active": True})
    sent = await send_template("registration", "sponsor@example.test", display_name=NAME)
    assert sent["ok"]
    job = await flow.db.mail_jobs.find_one({"to": "sponsor@example.test"}, {"_id": 0})
    assert ('<a href="https://sponsor.example.test/?a=1&amp;b=2" style="text-decoration:none">'
            '<img src="https://cdn.example.test/logo.png" alt="Alpha &lt;Energy&gt;"') in job["html"]
    assert_text_only(job["html"], "registration mit Sponsor")


def test_a_ready_html_block_passes_only_as_safe_html():
    rendered = fill_placeholders("<p>{{block}}</p>", {"block": "<em>Text</em>"}, as_html=True)
    marked = fill_placeholders("<p>{{block}}</p>", {"block": SafeHtml("<em>Block</em>")}, as_html=True)
    assert rendered == "<p>&lt;em&gt;Text&lt;/em&gt;</p>", "ohne Kennzeichen ist es Text - auch wenn es nach HTML aussieht"
    assert marked == "<p><em>Block</em></p>"
