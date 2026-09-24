"""E-Mail-Vorlagen (#437 A): alle Mails der Website an einer Stelle - Liste mit Zweck, Empfänger, Variablen;
Vorschau mit Beispieldaten; Überschreiben, Testmail an mich, Zurücksetzen; das tote CMS ist weg."""
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
async def test_catalog_lists_every_mail_with_purpose_recipient_and_vars(flow):
    from routes.phase_ef_routes import seed_email_templates
    await seed_email_templates()
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    rows = (await flow.get("/api/admin/email-templates")).json()
    by_key = {row["key"]: row for row in rows}
    assert {"registration", "password_reset", "match_reminder", "prize_ready", "membership_activated", "membership_approve", "contact_auto_reply", "newsletter_news", "ops_alert"} <= set(by_key)
    assert by_key["match_reminder"]["vars"] == ["tournament_title", "opponent", "when", "url", "station"] and by_key["match_reminder"]["source"] == "code"
    assert by_key["membership_approve"]["source"] == "db" and by_key["membership_approve"]["custom"] is False
    assert all(row["purpose"] and row["recipient"] and row["category_label"] for row in rows)
    assert by_key["ops_alert"]["editable"] is False

    # Redaktion (content) darf nicht - das ist System.
    editor = await flow.add_user(role="player", name="redaktion")
    await flow.db.users.update_one({"id": editor["id"]}, {"$set": {"areas": ["content"]}})
    flow.act_as(editor)
    assert (await flow.get("/api/admin/email-templates")).status_code == 403


@pytest.mark.asyncio
async def test_preview_override_test_and_reset(flow):
    from routes.phase_ef_routes import seed_email_templates
    await seed_email_templates()
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)

    # Vorschau der festen Vorlage mit Beispieldaten.
    preview = (await flow.post("/api/admin/email-templates/registration/preview", json={})).json()
    assert preview["source"] == "code" and "Paula" in preview["html"] and preview["subject"]
    # Vorschau eines Entwurfs, ungespeichert.
    draft = (await flow.post("/api/admin/email-templates/registration/preview", json={"subject": "Hallo {{display_name}}!", "html": "<p>Willkommen, {{display_name}} &lt;3</p>"})).json()
    assert draft["subject"] == "Hallo Paula!" and draft["html"] == "<p>Willkommen, Paula &lt;3</p>" and draft["source"] == "custom"

    # Überschreiben: ab jetzt geht die eigene Fassung raus.
    saved = (await flow.put("/api/admin/email-templates/registration", json={"subject": "Servus {{display_name}}", "html": "<p>Schön, dass du da bist, {{display_name}}.</p>"})).json()
    assert saved["override"] is True
    rows = {row["key"]: row for row in (await flow.get("/api/admin/email-templates")).json()}
    assert rows["registration"]["custom"] is True and rows["registration"]["subject"] == "Servus {{display_name}}"
    from email_service import send_template
    outcome = await send_template("registration", "max@example.test", display_name="Max <Neon>")
    assert outcome["ok"]
    job = await flow.db.mail_jobs.find_one({"to": "max@example.test"}, {"_id": 0})
    assert job["subject"] == "Servus Max <Neon>" and "Schön, dass du da bist, Max &lt;Neon&gt;." in job["html"]

    # Testmail an mich: Beispieldaten, an die eigene Adresse.
    test = (await flow.post("/api/admin/email-templates/registration/test", json={})).json()
    assert test["ok"] is True and test["to"] == admin["email"]
    mine = await flow.db.mail_jobs.find_one({"to": admin["email"]}, {"_id": 0})
    assert mine["subject"] == "Servus Paula" and mine["template_key"] == "registration"

    # Zurücksetzen: Standard gilt wieder.
    assert (await flow.post("/api/admin/email-templates/registration/reset")).json()["source"] == "code"
    rows = {row["key"]: row for row in (await flow.get("/api/admin/email-templates")).json()}
    assert rows["registration"]["custom"] is False
    await send_template("registration", "moritz@example.test", display_name="Moritz")
    assert "Servus" not in (await flow.db.mail_jobs.find_one({"to": "moritz@example.test"}, {"_id": 0}))["subject"]

    # Datenbank-Vorlage: ändern und zurück auf den Standard der Erstinstallation.
    (await flow.put("/api/admin/email-templates/membership_approve", json={"subject": "Willkommen im Rudel"})).json()
    rows = {row["key"]: row for row in (await flow.get("/api/admin/email-templates")).json()}
    assert rows["membership_approve"]["custom"] is True
    assert (await flow.post("/api/admin/email-templates/membership_approve/reset")).json()["source"] == "db"
    rows = {row["key"]: row for row in (await flow.get("/api/admin/email-templates")).json()}
    assert rows["membership_approve"]["custom"] is False
    assert (await flow.put("/api/admin/email-templates/gibt_es_nicht", json={"subject": "x"})).status_code == 404
    assert (await flow.put("/api/admin/email-templates/ops_alert", json={"subject": "x"})).status_code == 404


@pytest.mark.asyncio
async def test_the_dead_cms_is_gone(flow):
    assert (await flow.get("/api/pages/about")).status_code == 404
    assert (await flow.get("/api/seo/page/about")).status_code == 404
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    assert (await flow.get("/api/admin/pages")).status_code == 404
