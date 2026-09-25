"""Alle Verbindungen auf einer Seite (#546): das Backend rechnet je Verbindung aktiv, aus, fehlt, Fehler –
und „gespeichert, aber nicht lesbar“, wenn ein Schlüssel nicht zum aktuellen SETTINGS_ENCRYPTION_KEY passt.
Nie ein Schlüssel, nie eine Adresse in der Antwort."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_the_overview_tells_active_off_missing_and_unreadable_apart_without_leaking_secrets(flow):
    admin = await flow.add_user(role="superadmin")
    await flow.db.settings.replace_one({"id": "branding"}, {
        "id": "branding",
        "discord_client_id": "discord-id", "discord_client_secret": encrypt_secret("discord-secret"),
        "twitch_client_id": "twitch-id", "twitch_client_secret": "enc:v1:nicht-mit-diesem-schluessel",   # anderer Schlüssel
        "youtube_client_id": "yt-id",                                                                   # Secret fehlt
        "steam_api_key": encrypt_secret("steam-key"), "analytics_provider": "plausible",
    }, upsert=True)
    await flow.db.settings.replace_one({"id": "email"}, {"id": "email", "resend_api_key": encrypt_secret("re_geheim")}, upsert=True)
    await flow.db.settings.replace_one({"id": "mail"}, {"id": "mail", "provider": "smtp", "smtp_host": "mail.lionsquad-test.at", "smtp_pass": encrypt_secret("pw"), "enabled": True}, upsert=True)
    await flow.db.settings.replace_one({"id": "discord"}, {"id": "discord", "channels": {"community": "100000000000000001"}, "bot_token": encrypt_secret("bot"), "bot_enabled": False}, upsert=True)
    await flow.db.settings.replace_one({"id": "dolibarr"}, {"id": "dolibarr", "mode": "live", "base_url": "https://erp.lionsquad-test.at", "api_key": encrypt_secret("dolikey")}, upsert=True)
    await flow.db.settings.replace_one({"id": "dolibarr_sync_state"}, {"id": "dolibarr_sync_state", "ok": False, "last_error": {"kind": "unauthorized", "text": "401"}}, upsert=True)

    flow.act_as(admin)
    response = await flow.get("/api/settings/integrations/overview")
    assert response.status_code == 200, response.text
    body = response.json()
    states = {row["key"]: row["state"] for row in body["items"]}
    details = {row["key"]: row["detail"] for row in body["items"]}
    assert states["discord"] == "active"
    assert states["twitch"] == "unreadable" and "nicht lesbar" in details["twitch"]
    assert states["youtube"] == "missing" and "Secret fehlt" in details["youtube"]
    assert states["steam"] == "active" and "Anzeigename" in details["steam"]
    assert states["riot"] == "missing"
    assert states["google"] == "missing"
    assert states["resend"] == "off" and "SMTP" in details["resend"]
    assert states["smtp"] == "active"
    assert states["discord_channels"] == "off" and "Bot aus" in details["discord_channels"] and states["discord_bot"] == "off"
    assert states["analytics"] == "active" and "Plausible" in details["analytics"]
    assert states["dolibarr"] == "error" and "unauthorized" in details["dolibarr"]
    assert states["play"] == "missing"
    assert body["summary"]["unreadable"] == 1 and body["summary"]["error"] == 1
    assert {row["group"] for row in body["items"]} <= set(body["groups"])
    text = response.text
    for secret in ("discord-secret", "re_geheim", "dolikey", "abc", "enc:v1"):
        assert secret not in text, secret
    assert all(row["to"].startswith("/admin/") for row in body["items"])

    # Nur wer den Bereich System hat, sieht die Übersicht.
    player = await flow.add_user(role="player")
    flow.act_as(player)
    assert (await flow.get("/api/settings/integrations/overview")).status_code in (401, 403)
