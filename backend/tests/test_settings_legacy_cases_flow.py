"""Einstellungen und Verwaltungsseiten aus alten Live-Tests (#932): Branding mit Social-Voreinstellungen, öffentliche
Einstellungen, E-Mail/SMTP, Discord, Protokoll, Datenauskunft, Einrichtungsstand und robots.txt - jeweils mit den
Rechten, die die Route heute verlangt.

Ersetzt die alten Live-Tests
test_iter20_bug_hunt.py::test_branding_update_roundtrip,
test_iter20_bug_hunt.py::TestBrandingSocials::test_branding_contains_all_socials,
test_iter20_bugfixes.py::test_branding_get_returns_all_socials,
test_iter20_edge_cases.py::test_branding_specific_default_urls,
test_phase2_3.py::test_branding_update_creates_audit, test_phase2_3.py::test_public_settings,
test_phase2_3.py::test_email_settings_admin_only, test_phase2_3.py::test_audit_admin_only,
test_phase2_3.py::test_export_requires_auth,
test_phase4_features.py::test_public_settings_has_discord_twitch_defaults,
test_phase_8_9_10.py::test_smtp_settings_roundtrip, test_phase_8_9_10.py::test_setup_status,
test_phase3.py::test_discord_put_persists_and_audits, test_phase3.py::test_discord_can_clear_channel,
test_phase3.py::test_discord_test_requires_admin und
test_phase_fg_iter18.py::test_robots_txt.
Erfundene Daten, keine echten Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


SOCIAL_DEFAULTS = {
    "discord_invite_url": "https://discord.com/invite/thelionsquadesports",
    "twitch_channel": "the_lion_squad_esports",
    "facebook_url": "https://www.facebook.com/thelionsquadesports",
    "instagram_url": "https://instagram.com/thelionsquadesports",
    "tiktok_url": "https://www.tiktok.com/@thelionsquadesports",
    "youtube_url": "https://www.youtube.com/@TheLionSquadeSports",
}
CHANNEL = "100000000000000001"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def audit_rows(flow, action):
    return await flow.db.audit_logs.find({"action": action}, {"_id": 0}).to_list(50)


# ---------------------------------------------------------------- Branding und öffentliche Einstellungen
@pytest.mark.asyncio
async def test_branding_fills_social_defaults_and_keeps_what_is_saved(flow):
    flow.act_as(await flow.add_staff())

    empty = await flow.get("/api/settings/branding")
    assert empty.status_code == 200
    assert {key: empty.json()[key] for key in SOCIAL_DEFAULTS} == SOCIAL_DEFAULTS

    saved = await flow.put("/api/settings/branding", json={"facebook_url": "https://facebook.example.test/probeverein",
                                                           "tiktok_url": "https://tiktok.example.test/@probeverein"})
    assert saved.status_code == 200

    again = await flow.get("/api/settings/branding")
    assert again.status_code == 200
    body = again.json()
    assert body["facebook_url"] == "https://facebook.example.test/probeverein"
    assert body["tiktok_url"] == "https://tiktok.example.test/@probeverein"
    assert body["youtube_url"] == SOCIAL_DEFAULTS["youtube_url"], "Ungesetztes bleibt bei der Voreinstellung"


@pytest.mark.asyncio
async def test_public_settings_have_defaults_and_show_a_new_tagline_with_one_audit_row(flow):
    flow.act_as(None)
    blank = await flow.get("/api/settings/public")
    assert blank.status_code == 200
    for key in ("club_name", "tagline", "primary_color", "discord_invite_url", "twitch_channel"):
        assert blank.json()[key], f"{key} ist ohne gespeichertes Branding leer"

    admin = await flow.add_staff()
    flow.act_as(admin)
    first = await flow.put("/api/settings/branding", json={"tagline": "Probeverein mit Herz"})
    assert first.status_code == 200
    same = await flow.put("/api/settings/branding", json={"tagline": "Probeverein mit Herz"})
    assert same.status_code == 200

    flow.act_as(None)
    public = await flow.get("/api/settings/public")
    assert public.status_code == 200
    assert public.json()["tagline"] == "Probeverein mit Herz"

    rows = await audit_rows(flow, "settings.branding.update")
    assert len(rows) == 1, "nur die echte Änderung landet im Protokoll"
    assert rows[0]["actor_id"] == admin["id"] and "tagline" in rows[0]["data"]["changed_fields"]


# ---------------------------------------------------------------- E-Mail und SMTP
@pytest.mark.asyncio
async def test_email_settings_need_the_system_area(flow):
    flow.act_as(None)
    guest = await flow.get("/api/settings/email")
    assert guest.status_code == 401

    flow.act_as(await flow.add_user(name="mitglied"))
    member = await flow.get("/api/settings/email")
    assert member.status_code == 403

    flow.act_as(await flow.add_staff())
    admin = await flow.get("/api/settings/email")
    assert admin.status_code == 200


@pytest.mark.asyncio
async def test_smtp_password_is_stored_but_only_shown_masked(flow):
    flow.act_as(await flow.add_staff())
    saved = await flow.put("/api/settings/smtp", json={"smtp_host": "smtp.example.test", "smtp_auth": "none",
                                                       "smtp_pass": "probe-passwort"})
    assert saved.status_code == 200
    assert saved.json() == {"ok": True, "changed": True}

    read = await flow.get("/api/settings/smtp")
    assert read.status_code == 200
    body = read.json()
    assert body["smtp_host"] == "smtp.example.test"
    assert body["smtp_auth"] == "none"
    assert "smtp_pass" not in body
    assert body["smtp_pass_masked"]
    assert "probe-passwort" not in read.text

    stored = await flow.db.settings.find_one({"id": "mail"}, {"_id": 0})
    assert stored["smtp_pass"] and stored["smtp_pass"] != "probe-passwort", "das Passwort liegt verschlüsselt"


# ---------------------------------------------------------------- Discord
@pytest.mark.asyncio
async def test_discord_switch_persists_with_audit_and_a_channel_can_be_cleared(flow):
    admin = await flow.add_staff()
    flow.act_as(admin)

    switched = await flow.put("/api/settings/discord", json={"enabled": True})
    assert switched.status_code == 200
    read = await flow.get("/api/settings/discord")
    assert read.status_code == 200
    assert read.json()["enabled"] is True
    rows = await audit_rows(flow, "settings.discord.update")
    assert len(rows) == 1 and rows[0]["actor_id"] == admin["id"] and "enabled" in rows[0]["data"]["changed_fields"]

    with_channel = await flow.put("/api/settings/discord", json={"channels": {"community": CHANNEL}})
    assert with_channel.status_code == 200
    configured = await flow.get("/api/settings/discord")
    assert configured.json()["configured"] is True
    assert configured.json()["channels"]["community"] == CHANNEL

    cleared = await flow.put("/api/settings/discord", json={"channels": {"community": ""}})
    assert cleared.status_code == 200
    after = await flow.get("/api/settings/discord")
    assert after.status_code == 200
    assert after.json()["configured"] is False
    assert after.json()["channels"]["community"] == ""


@pytest.mark.asyncio
async def test_discord_test_message_refuses_guests(flow):
    flow.act_as(None)
    res = await flow.post("/api/settings/discord/test")
    assert res.status_code == 401


# ---------------------------------------------------------------- Protokoll, Datenauskunft, Einrichtung, robots.txt
@pytest.mark.asyncio
async def test_audit_log_is_for_admins_and_data_export_needs_a_login(flow):
    flow.act_as(None)
    guest_audit = await flow.get("/api/audit")
    assert guest_audit.status_code == 401
    guest_export = await flow.get("/api/dsgvo/export-my-data")
    assert guest_export.status_code == 401

    flow.act_as(await flow.add_staff())
    admin_audit = await flow.get("/api/audit")
    assert admin_audit.status_code == 200
    assert isinstance(admin_audit.json(), list)


@pytest.mark.asyncio
async def test_setup_status_and_robots_txt_are_public(flow):
    flow.act_as(None)
    status = await flow.get("/api/setup/status")
    assert status.status_code == 200
    body = status.json()
    assert {"completed", "has_admin", "has_branding", "has_email"} <= set(body)
    assert body["has_admin"] is False

    robots = await flow.get("/api/robots.txt")
    assert robots.status_code == 200
    assert robots.headers["content-type"].startswith("text/plain")
    assert "User-agent" in robots.text
