"""Discord als persönlicher Benachrichtigungskanal (#567) durch die echte Anwendung: Opt-in je Person,
Direktnachricht vom Bot mit Titel, Text und Link; ohne Opt-in oder Verknüpfung nichts; lehnt Discord
ab, bleibt es bei In-App und Push - mit Merker und Klickweg in den Einstellungen. Fremde Nachrichtentexte
und Moderation gehen nie als Direktnachricht."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import discord_bot, discord_dm  # noqa: E402
from services.user_notifications import create_user_notification  # noqa: E402

DISCORD_ID = "200000000000000001"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def dms(monkeypatch):
    """Der Bot gilt als verbunden; jede Direktnachricht wird festgehalten. `answer` stellt Discords Antwort um."""
    class Calls(list):
        answer: dict = {}

    calls = Calls()
    state = {"answer": {"ok": True}}

    async def fake_dm(discord_user_id, embed):
        calls.append({"to": discord_user_id, "title": embed.get("title"), "description": embed.get("description"), "url": embed.get("url"), "color": embed.get("color")})
        answer = dict(state["answer"])
        if answer.get("ok"):
            answer.setdefault("message_id", f"dm{len(calls)}")
        return answer

    monkeypatch.setattr(discord_bot.bot, "send_dm", fake_dm)
    calls.answer = state
    return calls


async def bot_on(flow, enabled=True):
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {"id": "discord", "bot_enabled": enabled, "bot_token": "enc:v1:x"}}, upsert=True)


async def linked_player(flow, name="paula", opt_in=True):
    user = await flow.add_user(role="player", name=name)
    await flow.db.platform_links.insert_one({"id": f"l-{name}", "user_id": user["id"], "platform": "discord", "external_id": DISCORD_ID, "handle": name})
    if opt_in:
        await flow.db.users.update_one({"id": user["id"]}, {"$set": {"notification_preferences": {"discord": True}}})
    return user


@pytest.mark.asyncio
async def test_opt_in_gets_the_notification_as_a_direct_message_with_link(flow, dms):
    await bot_on(flow)
    paula = await linked_player(flow)
    doc = await create_user_notification(paula["id"], "Check-in offen", "Dein Match beginnt in 15 Minuten.", url="/tournaments/cup", kind="tournament_checkin")
    assert doc["discord_sent_count"] == 1 and doc["in_app_visible"] is True
    assert len(dms) == 1 and dms[0]["to"] == DISCORD_ID and dms[0]["title"] == "Check-in offen"
    assert dms[0]["description"] == "Dein Match beginnt in 15 Minuten." and dms[0]["url"].endswith("/tournaments/cup")
    log = await flow.db.email_logs.find_one({"channel": "discord", "target": "dm"}, {"_id": 0})
    assert log["status"] == "sent" and log["message_id"] == "dm1" and log["user_id"] == paula["id"] and log["event_key"] == "notify.tournament_checkin"
    stored = await flow.db.notifications.find_one({"id": doc["id"]}, {"_id": 0})
    assert stored["discord_sent_count"] == 1


@pytest.mark.asyncio
async def test_without_opt_in_or_link_nothing_goes_to_discord(flow, dms):
    await bot_on(flow)
    silent = await linked_player(flow, "still", opt_in=False)
    unlinked = await flow.add_user(role="player", name="ohne")
    await flow.db.users.update_one({"id": unlinked["id"]}, {"$set": {"notification_preferences": {"discord": True}}})
    for user in (silent, unlinked):
        doc = await create_user_notification(user["id"], "Hallo", "Text", kind="tournament_checkin")
        assert doc is not None and doc["discord_sent_count"] == 0
    assert dms == []
    # Thema aus, Kanal an: auch nichts.
    await flow.db.users.update_one({"id": silent["id"]}, {"$set": {"notification_preferences": {"discord": True, "discord:tournament_updates": False}}})
    # (Andere Art als oben: dieselbe Art hätte noch Abkühlzeit und ergäbe gar keine Benachrichtigung.)
    doc = await create_user_notification(silent["id"], "Anmeldung offen", "Text", kind="match_result", meta={"category": "tournament_updates"})
    assert doc is not None and doc["discord_sent_count"] == 0 and dms == []
    assert await flow.db.email_logs.count_documents({"target": "dm"}) == 0


@pytest.mark.asyncio
async def test_refused_direct_message_marks_the_person_and_the_settings_show_the_click_path(flow, dms):
    await bot_on(flow)
    paula = await linked_player(flow)
    dms.answer["answer"] = {"ok": False, "reason": "forbidden"}
    doc = await create_user_notification(paula["id"], "Check-in offen", "Los geht's", kind="tournament_checkin")
    assert doc["discord_sent_count"] == 0 and doc["in_app_visible"] is True, "In-App bleibt - die Person merkt nichts vom Fehlschlag"
    log = await flow.db.email_logs.find_one({"target": "dm"}, {"_id": 0})
    assert log["status"] == "failed" and log["reason"] == "dm_forbidden" and "Servermitgliedern" in log["error"]
    assert (await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0}))["discord_dm_blocked_at"]

    flow.act_as(paula)
    prefs = (await flow.get("/api/users/me/notification-preferences")).json()
    assert prefs["discord"]["linked"] is True and prefs["discord"]["blocked_at"] and "Servermitgliedern" in prefs["discord"]["hint"]
    assert {channel["key"] for channel in prefs["channels"]} >= {"discord", "push", "in_app", "email"}
    assert prefs["preferences"]["discord"] is True

    # Klappt es wieder, verschwindet der Merker.
    dms.answer["answer"] = {"ok": True}
    again = await create_user_notification(paula["id"], "Ergebnis da", "geht", kind="match_result")
    assert again["discord_sent_count"] == 1
    assert "discord_dm_blocked_at" not in await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0})
    assert (await flow.get("/api/users/me/notification-preferences")).json()["discord"]["hint"] is None


@pytest.mark.asyncio
async def test_other_peoples_messages_and_moderation_never_travel_as_direct_message(flow, dms):
    await bot_on(flow)
    paula = await linked_player(flow)
    doc = await create_user_notification(paula["id"], "Neue Nachricht von Max", "Hey, treffen wir uns um 8 vor dem Vereinsheim?", url="/messages", kind="direct_message")
    assert doc["discord_sent_count"] == 1
    assert dms[-1]["description"] == discord_dm.PRIVATE_BODY_TEXT and "Vereinsheim" not in str(dms[-1])
    doc = await create_user_notification(paula["id"], "Verwarnung", "Du wurdest verwarnt.", kind="moderation")
    assert doc is not None and doc["discord_sent_count"] == 0 and len(dms) == 1
    assert await flow.db.email_logs.count_documents({"target": "dm"}) == 1, "Moderation hinterlässt auch keinen Versuch"


@pytest.mark.asyncio
async def test_bot_off_or_offline_means_no_direct_message_but_a_reason(flow, dms):
    await bot_on(flow, enabled=False)
    paula = await linked_player(flow)
    doc = await create_user_notification(paula["id"], "Hallo", "Text", kind="tournament_checkin")
    assert doc["discord_sent_count"] == 0 and dms == []
    log = await flow.db.email_logs.find_one({"target": "dm"}, {"_id": 0})
    assert log["status"] == "skipped" and log["reason"] == "bot_off"
    # Eingeschaltet, aber nicht verbunden: der echte Bot sagt es ohne Netz.
    assert await discord_bot.BotRunner().send_dm(DISCORD_ID, {"title": "x"}) == {"ok": False, "reason": "bot_offline"}


@pytest.mark.asyncio
async def test_achievements_come_as_a_personal_congratulation(flow, dms, monkeypatch):
    """Erfolge (#568): gebündelt, mit Namen, Punkten, Stufe und Weg zum Profil - Thema „Erfolge“ schaltet es ab."""
    from services import achievement_queue

    await bot_on(flow)
    paula = await linked_player(flow)
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"display_name": "Paula"}})
    monkeypatch.setattr(achievement_queue, "BUNDLE_WINDOW_SECONDS", -1)
    group = {"code": "g", "name": "Turniersiege", "public": True}
    await achievement_queue.note_award(paula["id"], {"code": "t1", "name": "Erster Sieg", "description": "x", "points": 50, "level": 1}, group)
    await achievement_queue.note_award(paula["id"], {"code": "t2", "name": "Seriensieger", "description": "y", "points": 150, "level": 3}, group)
    assert await achievement_queue.flush_awards() == {"users": 1, "notified": 1}
    dm = dms[-1]
    assert dm["title"] == "🏆 Stark, Paula! 2 Erfolge freigeschaltet"
    assert "• **Erster Sieg** (Turniersiege) · +50 Punkte" in dm["description"] and "Seriensieger" in dm["description"]
    assert "+200 Punkte" in dm["description"] and "unter „Erfolge“" in dm["description"]
    assert dm["url"].endswith("/profile?tab=achievements") and dm["color"] == 0xFFD700, "Stufe 3 = Gold"

    # Thema „Erfolge“ aus: In-App bleibt, Discord schweigt.
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"notification_preferences": {"discord": True, "discord:achievements": False}}})
    await achievement_queue.note_award(paula["id"], {"code": "t3", "name": "Dritter", "description": "z", "points": 10, "level": 1}, group)
    await achievement_queue.flush_awards()
    assert len(dms) == 1
    assert await flow.db.notifications.count_documents({"user_id": paula["id"], "kind": "achievement"}) == 2


def test_direct_message_content_keeps_titles_and_links_but_not_foreign_text():
    plain = discord_dm.dm_content({"kind": "tournament_checkin", "title": "Check-in", "body": "15 Minuten", "url": "/t/1"}, "tournament_updates")
    assert plain == {"title": "Check-in", "description": "15 Minuten", "url": "/t/1", "color": 0x29B6E8}
    chat = discord_dm.dm_content({"kind": "team_chat_mention", "title": "Erwähnt", "body": "geheim"}, "community_messages")
    assert chat["description"] == discord_dm.PRIVATE_BODY_TEXT
    single = discord_dm.dm_content({"kind": "achievement", "title": "Erfolg", "body": "Talker · +20 Punkte", "meta": {"awards": [{"name": "Talker", "points": 20, "level": 2}], "level": 2}}, "achievements", name="Max")
    assert single["title"] == "🏆 Stark, Max! Erfolg freigeschaltet" and single["description"].startswith("• **Talker** · +20 Punkte") and single["color"] == 0xC0C0C0
    assert discord_dm.dm_content({"kind": "achievement", "title": "Erfolg", "body": "irgendwas"}, "achievements")["title"] == "🏆 Erfolg freigeschaltet"
