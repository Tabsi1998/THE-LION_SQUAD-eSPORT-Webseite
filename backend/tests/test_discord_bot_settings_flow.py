"""Discord-Bot (#302) im Admin: Token verschlüsselt und nie zurück, Schalter und Rollen, Neustart
nach Änderung, Stand und Rollenabgleich über die Bot-Routen - ohne Discord."""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import discord_bot  # noqa: E402
from services.secret_store import decrypt_secret  # noqa: E402

# Erfundener Wert in Token-Form (drei Teile, lang genug) - bewusst ohne Zufall, damit kein Scanner anschlägt.
TOKEN = "test" * 6 + ".fake." + "token" * 8


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def restarts(monkeypatch):
    calls: list[str] = []

    async def fake_apply():
        calls.append("apply")
        return True

    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    return calls


@pytest.mark.asyncio
async def test_token_is_stored_encrypted_never_returned_and_changes_restart_the_bot(flow, restarts):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    before = (await flow.get("/api/settings/discord")).json()
    assert before["bot"]["configured"] is False and before["bot"]["roles"]["member"] == "Mitglied" and "bot_token" not in before

    bad = await flow.put("/api/settings/discord", json={"bot_token": "kurz"})
    assert bad.status_code == 400 and "Bot-Token" in bad.json()["detail"]
    assert (await flow.put("/api/settings/discord", json={"bot_guild_id": "abc"})).status_code == 400
    assert (await flow.put("/api/settings/discord", json={"bot_roles": {"admin": "x"}})).status_code == 400

    saved = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_guild_id": "123456789012345678", "bot_roles": {"member": "Mitglied:in"}, "bot_count_messages": False})
    assert saved.status_code == 200 and saved.json()["changed"] is True, saved.text
    stored = await flow.db.settings.find_one({"id": "discord"}, {"_id": 0})
    assert stored["bot_token"] != TOKEN and decrypt_secret(stored["bot_token"]) == TOKEN
    assert stored["bot_roles"] == {"member": "Mitglied:in"} and stored["bot_guild_id"] == "123456789012345678"
    assert restarts == ["apply"]

    after = (await flow.get("/api/settings/discord")).json()
    assert "bot_token" not in after and "bot_roles" not in after
    assert after["bot"]["configured"] is True and after["bot"]["enabled"] is False and after["bot"]["count_messages"] is False
    assert after["bot"]["roles"] == {"member": "Mitglied:in", "board": "Vorstand", "tournament": "Turnierleitung"}

    # Leer gelassen heißt behalten; nur der Schalter ändert sich und startet neu.
    assert (await flow.put("/api/settings/discord", json={"bot_token": "", "bot_enabled": True})).json()["changed"] is True
    assert decrypt_secret((await flow.db.settings.find_one({"id": "discord"}, {"_id": 0}))["bot_token"]) == TOKEN
    assert restarts == ["apply", "apply"]
    # Nichts geändert: kein Neustart.
    assert (await flow.put("/api/settings/discord", json={"bot_enabled": True})).json()["changed"] is False
    assert len(restarts) == 2
    # Token löschen.
    assert (await flow.put("/api/settings/discord", json={"clear_bot_token": True, "bot_enabled": False})).status_code == 200
    assert "bot_token" not in (await flow.db.settings.find_one({"id": "discord"}, {"_id": 0}))


@pytest.mark.asyncio
async def test_status_and_sync_routes_without_a_connection(flow):
    admin = await flow.add_user(role="club_admin", name="admin")
    paula = await flow.add_user(role="player", name="paula")
    await flow.db.platform_links.insert_one({"id": "l1", "user_id": paula["id"], "platform": "discord", "external_id": "111", "handle": "paula"})
    flow.act_as(admin)
    status = (await flow.get("/api/settings/discord/bot/status")).json()
    assert status["connected"] is False and status["linked_count"] == 1 and status["roles"]["board"] == "Vorstand"
    sync = (await flow.post("/api/settings/discord/bot/sync")).json()
    assert sync["ok"] is False and sync["reason"] == "offline" and sync["changes"] == 0
    assert "Bot verbinden" in sync["text"], "der Grund steht in Worten, nicht als Code (#515)"
    player = await flow.add_user(role="player", name="max")
    flow.act_as(player)
    assert (await flow.get("/api/settings/discord/bot/status")).status_code == 403


@pytest.mark.asyncio
async def test_message_counting_and_wanted_roles(flow):
    paula = await flow.add_user(role="player", name="paula")
    chef = await flow.add_user(role="club_admin", name="chef")
    await flow.db.platform_links.insert_one({"id": "l1", "user_id": paula["id"], "platform": "discord", "external_id": "111", "handle": "paula"})
    await flow.db.memberships.insert_one({"id": "m1", "user_id": paula["id"], "member_status": "active", "membership_type": "ordinary"})
    links = await discord_bot.linked_discord_ids(flow.db)
    assert links == {"111": paula["id"]}
    await discord_bot.count_message(flow.db, paula["id"])
    await discord_bot.count_message(flow.db, paula["id"])
    user = await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0})
    assert user["discord_messages_count"] == 2
    day = await flow.db.discord_activity.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert day["count"] == 2 and len(day["day"]) == 10, "Zahl je Tag, kein Inhalt"
    assert await flow.db.achievement_eval_queue.count_documents({"user_id": paula["id"]}) == 1, "Erfolge werden vorgemerkt, je Person einmal"
    wanted = await discord_bot.wanted_roles_by_user(flow.db, [paula["id"], chef["id"], "unbekannt"])
    assert wanted[paula["id"]] == {"member"}
    assert "board" in wanted[chef["id"]] and "tournament" in wanted[chef["id"]]
    assert wanted["unbekannt"] == set()


@pytest.mark.asyncio
async def test_watch_restarts_the_bot_only_after_its_run_ended(flow, monkeypatch):
    """Nach einem Abbruch (fehlender Intent, falscher Token) startet der Scheduler den Bot neu; solange er läuft, nicht."""
    starts: list[str] = []
    gate = asyncio.Event()

    async def fake_run(token, view):
        starts.append(view["guild_id"])
        await gate.wait()

    monkeypatch.setattr(discord_bot.bot, "_run", fake_run)
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    assert (await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_guild_id": "42", "bot_enabled": True})).status_code == 200
    assert starts == ["42"] and discord_bot.bot.status()["running"] is True
    assert await discord_bot.bot.restart_if_down() is False
    gate.set()
    await asyncio.wait_for(discord_bot.bot._task, 1)
    assert discord_bot.bot.status()["running"] is False
    assert await discord_bot.bot.restart_if_down() is True
    await asyncio.sleep(0)  # die neue Aufgabe kommt erst beim nächsten Schleifendurchlauf dran
    assert starts == ["42", "42"]
    await discord_bot.bot.stop()
    assert await discord_bot.bot.restart_if_down() is True
    await asyncio.sleep(0)
    assert starts == ["42", "42", "42"]
    await flow.put("/api/settings/discord", json={"bot_enabled": False})
    assert await discord_bot.bot.restart_if_down() is False and len(starts) == 3
