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
async def test_contact_reply_names_every_variable_the_form_fills_in(flow):
    """#2119 ML7: das Kontaktformular setzt auch {{subject}} und {{message}} ein - die Liste nennt sie jetzt, auch bei
    einer Vorlage, die schon vor dieser Änderung gespeichert war."""
    from routes.phase_ef_routes import seed_email_templates
    await flow.db.email_templates.insert_one({"key": "contact_auto_reply", "id": "contact_auto_reply", "subject": "Danke",
                                              "html": "<p>Eigener Text {{name}}</p>", "vars": ["name", "topic"]})
    await seed_email_templates()
    stored = await flow.db.email_templates.find_one({"key": "contact_auto_reply"}, {"_id": 0})
    assert stored["vars"] == ["name", "topic", "subject", "message"] and stored["html"] == "<p>Eigener Text {{name}}</p>"
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    rows = {row["key"]: row for row in (await flow.get("/api/admin/email-templates")).json()}
    assert rows["contact_auto_reply"]["vars"] == ["name", "topic", "subject", "message"]
    preview = (await flow.post("/api/admin/email-templates/contact_auto_reply/preview", json={"html": "<p>{{subject}}: {{message}}</p>"})).json()
    assert "{{" not in preview["html"]


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
    # #2119 ML6: die Einladung zum Mitgliedsantrag hat einen Standard und steht darum in der Liste.
    assert by_key["membership_invited"]["source"] == "db" and by_key["membership_invited"]["vars"] == ["name", "note"]
    assert by_key["membership_invited"]["custom"] is False

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
async def test_editor_loads_the_template_with_placeholders_not_sample_values(flow):
    """#2119 ML1: der Editor bekam die mit Beispieldaten gerenderte Fassung - wer einen Satz änderte und speicherte,
    schickte ab dann allen „Hallo Paula“. Jetzt lädt er die Vorlage mit `{{variable}}`; die Vorschau rendert getrennt."""
    from routes.phase_ef_routes import seed_email_templates
    await seed_email_templates()
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)

    source = (await flow.get("/api/admin/email-templates/registration")).json()
    assert source["custom"] is False and source["source"] == "code"
    assert source["subject"] == "Willkommen in der Community"
    assert "{{display_name}}" in source["html"] and "Paula" not in source["html"]
    assert source["sample_leaks"] == []

    approved = (await flow.get("/api/admin/email-templates/registration_approved")).json()
    assert approved["subject"] == "Du bist dabei: {{tournament_title}}"
    assert "{{tournament_title}}" in approved["html"] and 'href="{{url}}"' in approved["html"]
    assert "Mario Kart" not in approved["html"] + approved["subject"]

    # Optionale Teile wählen den häufigen Fall: offene Rechnung mit Zahlungsziel, nicht „schon bezahlt“.
    invoice = (await flow.get("/api/admin/email-templates/invoice_ready")).json()
    assert "{{due_on}}" in invoice["html"] and "schon bezahlt" not in invoice["html"]

    # Datenbank-Vorlage: der Text der Erstinstallation, mit Platzhaltern.
    approve = (await flow.get("/api/admin/email-templates/membership_approve")).json()
    assert approve["source"] == "db" and approve["html"].startswith("<p>Hallo {{display_name}},</p>")

    # Die Vorschau rendert weiter mit Beispieldaten - nur eben nicht mehr ins Formular.
    preview = (await flow.post("/api/admin/email-templates/registration/preview", json={"subject": source["subject"], "html": source["html"]})).json()
    assert "Paula" in preview["html"] and "{{display_name}}" not in preview["html"]

    assert (await flow.get("/api/admin/email-templates/gibt_es_nicht")).status_code == 404
    assert (await flow.get("/api/admin/email-templates/ops_alert")).status_code == 404


@pytest.mark.asyncio
async def test_saving_sample_values_needs_a_conscious_yes(flow):
    from routes.phase_ef_routes import seed_email_templates
    await seed_email_templates()
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)

    refused = await flow.put("/api/admin/email-templates/registration_approved", json={
        "subject": "Du bist dabei: Mario Kart Winter Cup", "html": "<p>Hallo Paula, dein Platz ist bestätigt.</p>"})
    assert refused.status_code == 409
    detail = refused.json()["detail"]
    assert detail["code"] == "sample_values" and set(detail["sample_leaks"]) == {"Mario Kart Winter Cup"}
    assert "Mario Kart Winter Cup" in detail["message"]
    assert await flow.db.email_templates.find_one({"key": "registration_approved"}) is None

    # Bewusst trotzdem: geht, wenn ausdrücklich bestätigt.
    forced = await flow.put("/api/admin/email-templates/registration_approved", json={
        "subject": "Du bist dabei: Mario Kart Winter Cup", "html": "<p>Fix für den Cup.</p>", "allow_samples": True})
    assert forced.status_code == 200 and forced.json()["override"] is True

    # Mit Platzhaltern kein Einwand; ein Name aus SAMPLES, der keine Variable dieser Vorlage ist, auch nicht.
    clean = await flow.put("/api/admin/email-templates/registration", json={
        "subject": "Servus {{display_name}}", "html": "<p>Willkommen, {{display_name}}. Grüße vom Vorstand.</p>"})
    assert clean.status_code == 200
    db_tpl = await flow.put("/api/admin/email-templates/membership_approve", json={"html": "<p>Hallo Paula,</p>"})
    assert db_tpl.status_code == 409 and db_tpl.json()["detail"]["sample_leaks"] == ["Paula"]


@pytest.mark.asyncio
async def test_spoiled_saved_templates_are_flagged_not_overwritten(flow):
    """Schon so gespeicherte Vorlagen: die Liste zeigt die Beispielwerte, nichts wird ohne Rückfrage überschrieben."""
    from routes.phase_ef_routes import seed_email_templates
    from services.mail_catalog import code_templates, SAMPLES
    await seed_email_templates()
    subject, html = code_templates()["registration_approved"](tournament_title=SAMPLES["tournament_title"], url="https://lionsquad.at/tournaments/mario-kart-winter-cup", detail="")
    await flow.db.email_templates.insert_one({"key": "registration_approved", "id": "registration_approved", "override": True, "subject": subject, "html": html})
    await flow.db.email_templates.update_one({"key": "contact_auto_reply"}, {"$set": {"html": "<p>Hallo Paula,</p><p>Danke!</p>"}})
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)

    rows = {row["key"]: row for row in (await flow.get("/api/admin/email-templates")).json()}
    assert "Mario Kart Winter Cup" in rows["registration_approved"]["sample_leaks"]
    assert "https://lionsquad.at/tournaments/mario-kart-winter-cup" in rows["registration_approved"]["sample_leaks"]
    assert rows["contact_auto_reply"]["sample_leaks"] == ["Paula"]
    assert rows["registration"]["sample_leaks"] == [] and rows["membership_approve"]["sample_leaks"] == []
    one = (await flow.get("/api/admin/email-templates/registration_approved")).json()
    assert one["custom"] is True and one["html"] == html and "Mario Kart Winter Cup" in one["sample_leaks"]
    # Nur gemeldet - der gespeicherte Text bleibt, bis der Admin zurücksetzt.
    assert (await flow.db.email_templates.find_one({"key": "registration_approved"}))["html"] == html


@pytest.mark.asyncio
async def test_the_dead_cms_is_gone(flow):
    assert (await flow.get("/api/pages/about")).status_code == 404
    assert (await flow.get("/api/seo/page/about")).status_code == 404
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    assert (await flow.get("/api/admin/pages")).status_code == 404
