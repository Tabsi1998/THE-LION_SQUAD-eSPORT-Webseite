"""Server-Verzeichnis (#624, Discord VI) durch die echte Anwendung: der Bot meldet seine Server, neue kommen als
ausgeschaltete Unterserver, genau ein Hauptserver (nach dem Deploy der heutige), verlassene bleiben sichtbar;
Gesundheitsprüfung nennt fehlende Rechte in Worten; Einladungslink vom Bot; Test am Unterserver nur mit Bestätigung."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import discord_bot, discord_guilds  # noqa: E402

MAIN = "500000000000000001"
SUB = "500000000000000002"
OTHER = "500000000000000003"
TEST_CHANNEL = "100000000000000008"
SYSTEM = "100000000000000099"
TOKEN = "test" * 6 + ".fake." + "token" * 8
ALL = {key: True for key, _, _ in discord_guilds.PERMISSIONS}


def seen(guild_id, name, **permissions):
    return {"guild_id": guild_id, "name": name, "icon_url": None, "member_count": 42, "bot_permissions": {**ALL, **permissions}}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def bot(monkeypatch):
    sent = []

    async def fake_send(channel_id, embed, buttons=None):
        sent.append({"channel_id": channel_id, "title": embed.get("title")})
        return {"ok": True, "message_id": f"m{len(sent)}", "channel_id": channel_id}

    async def fake_invite(guild_id, channel_id=""):
        return {"ok": True, "url": f"https://discord.gg/{guild_id[-4:]}"}

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "send_embed", fake_send)
    monkeypatch.setattr(discord_bot.bot, "create_invite", fake_invite)
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    monkeypatch.setattr(discord_bot.bot, "connected_guild_ids", lambda: {MAIN, SUB})
    monkeypatch.setattr(discord_bot.bot, "system_channel_id", lambda guild_id: SYSTEM)
    return sent


def test_permissions_in_words_and_the_invite_link():
    class Perms:
        send_messages = True
        manage_messages = True

    snapshot = discord_guilds.permission_snapshot(Perms())
    assert snapshot["send_messages"] and snapshot["pin_messages"], "„Nachrichten verwalten“ schließt das Anheften ein"
    labels = [entry["label"] for entry in discord_guilds.missing_permissions(snapshot)]
    assert "Rollen verwalten" in labels and "Nachrichten senden" not in labels
    assert discord_guilds.missing_permissions({}) == [], "noch nie gesehen heißt unbekannt, nicht „alles fehlt“"

    class Admin:
        administrator = True

    assert discord_guilds.missing_permissions(discord_guilds.permission_snapshot(Admin())) == []
    link = discord_guilds.bot_invite_url("123456789012345678")
    assert link.startswith("https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot%20applications.commands&permissions=")
    assert discord_guilds.bot_invite_url("") is None


@pytest.mark.asyncio
async def test_reconcile_keeps_todays_server_as_main_and_adds_new_ones_switched_off(flow):
    db = flow.db
    await discord_guilds.reconcile(db, [seen(SUB, "Rocket League"), seen(MAIN, "THE LION SQUAD")], configured_main=MAIN)
    rows = {row["guild_id"]: row for row in await discord_guilds.list_guilds(db)}
    assert rows[MAIN]["role"] == "main" and rows[MAIN]["enabled"] is True, "der eingetragene Server bleibt der Hauptserver"
    assert rows[SUB]["role"] == "sub" and rows[SUB]["enabled"] is False, "neu = ausgeschalteter Unterserver"

    # Ein weiterer Server kommt dazu, einer geht - und kommt zurück.
    result = await discord_guilds.reconcile(db, [seen(MAIN, "THE LION SQUAD"), seen(OTHER, "Fast Lap")], configured_main=MAIN)
    assert result == {"seen": 2, "added": 1, "left": 1}
    rows = {row["guild_id"]: row for row in await discord_guilds.list_guilds(db)}
    assert rows[SUB]["left_at"] and rows[OTHER]["enabled"] is False
    assert [row["guild_id"] for row in await discord_guilds.list_guilds(db)][-1] == SUB, "verlassene zuletzt"
    await discord_guilds.reconcile(db, [seen(MAIN, "THE LION SQUAD"), seen(SUB, "Rocket League"), seen(OTHER, "Fast Lap")])
    assert (await db.discord_guilds.find_one({"guild_id": SUB}))["left_at"] is None
    assert await db.discord_guilds.count_documents({"role": "main"}) == 1


@pytest.mark.asyncio
async def test_without_configured_server_the_first_becomes_main(flow):
    await discord_guilds.reconcile(flow.db, [seen(OTHER, "Erster"), seen(SUB, "Zweiter")])
    assert await discord_guilds.main_guild_id(flow.db) == OTHER


@pytest.mark.asyncio
async def test_one_main_never_switched_off_and_validated_fields(flow):
    db = flow.db
    await discord_guilds.reconcile(db, [seen(MAIN, "Haupt"), seen(SUB, "Unter")], configured_main=MAIN)
    with pytest.raises(discord_guilds.GuildError, match="erst einen anderen"):
        await discord_guilds.update_guild(db, MAIN, {"enabled": False})
    with pytest.raises(discord_guilds.GuildError, match="immer einen Hauptserver"):
        await discord_guilds.update_guild(db, MAIN, {"role": "sub"})
    with pytest.raises(discord_guilds.GuildError, match="discord.gg"):
        await discord_guilds.update_guild(db, SUB, {"invite_url": "https://example.com/x"})
    with pytest.raises(discord_guilds.GuildError, match="Unbekannte"):
        await discord_guilds.update_guild(db, SUB, {"secret": 1})
    switched = await discord_guilds.update_guild(db, SUB, {"role": "main"})
    assert switched["role"] == "main" and switched["enabled"] is True
    assert (await db.discord_guilds.find_one({"guild_id": MAIN}))["role"] == "sub"
    assert await db.discord_guilds.count_documents({"role": "main"}) == 1


@pytest.mark.asyncio
async def test_admin_routes_health_invite_and_test_with_confirmation(flow, bot):
    db = flow.db
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    assert (await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, "channels": {"test": TEST_CHANNEL}})).status_code == 200
    await discord_bot.record_state(db, application_id="123456789012345678")
    await discord_guilds.reconcile(db, [seen(MAIN, "Haupt"), seen(SUB, "Unter", manage_roles=False, manage_events=False)], configured_main=MAIN)

    listing = (await flow.get("/api/settings/discord/guilds")).json()
    assert [row["guild_id"] for row in listing["guilds"]] == [MAIN, SUB] and listing["connected"] is True
    assert listing["bot_invite_url"].startswith("https://discord.com/oauth2/authorize?client_id=123456789012345678")
    assert [entry["label"] for entry in listing["guilds"][1]["missing_permissions"]] == ["Rollen verwalten", "Events verwalten"]

    updated = await flow.patch(f"/api/settings/discord/guilds/{SUB}", json={"enabled": True, "note": "Rocket-League-Server"})
    assert updated.status_code == 200 and updated.json()["enabled"] is True
    assert (await flow.patch(f"/api/settings/discord/guilds/{MAIN}", json={"enabled": False})).status_code == 400
    assert (await flow.patch("/api/settings/discord/guilds/999", json={"note": "x"})).status_code == 404
    audit = await db.audit_logs.find_one({"action": "settings.discord.guild.update"}, {"_id": 0})
    assert audit["data"]["changed_fields"] == [f"guilds.{SUB}.enabled", f"guilds.{SUB}.note"]

    health = (await flow.post(f"/api/settings/discord/guilds/{SUB}/health")).json()
    assert health["ok"] is False and "„Rollen verwalten“" in health["checks"][1]["text"] and "Servereinstellungen → Rollen" in health["checks"][1]["text"]
    main_health = (await flow.post(f"/api/settings/discord/guilds/{MAIN}/health")).json()
    assert any(check["key"] == "target.test" for check in main_health["checks"])

    invite = (await flow.post(f"/api/settings/discord/guilds/{SUB}/invite")).json()
    assert invite == {"ok": True, "url": f"https://discord.gg/{SUB[-4:]}"}
    assert (await db.discord_guilds.find_one({"guild_id": SUB}))["invite_url"] == invite["url"]

    main_test = (await flow.post(f"/api/settings/discord/guilds/{MAIN}/test", json={})).json()
    assert main_test["ok"] is True and bot[-1]["channel_id"] == TEST_CHANNEL, "Hauptserver: in den privaten Testkanal"
    unconfirmed = await flow.post(f"/api/settings/discord/guilds/{SUB}/test", json={})
    assert unconfirmed.status_code == 409 and "Systemkanal" in unconfirmed.json()["detail"] and len(bot) == 1
    confirmed = (await flow.post(f"/api/settings/discord/guilds/{SUB}/test", json={"confirm": True})).json()
    assert confirmed["ok"] is True and bot[-1]["channel_id"] == SYSTEM

    flow.act_as(await flow.add_user(role="player", name="paula"))
    assert (await flow.get("/api/settings/discord/guilds")).status_code in (401, 403)
