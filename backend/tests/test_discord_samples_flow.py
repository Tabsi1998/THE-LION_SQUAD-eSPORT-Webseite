"""Vorschau jeder Meldungsart (#583): der Katalog deckt alle Ereignisse und die Direktnachrichten ab,
nimmt die letzten echten Daten, wenn es welche gibt, und der Testversand geht nur in den Testkanal
oder an den Admin selbst - nie in einen öffentlichen Kanal, auch wenn der Testkanal fehlt."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import discord_bot  # noqa: E402
from services.discord_announcements import fast_lap_message, tournament_message  # noqa: E402

COMMUNITY = "100000000000000001"
TEST_CHANNEL = "100000000000000007"
DISCORD_ID = "200000000000000001"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


class Calls(list):
    answer = {"ok": True}


@pytest.fixture
def posted(monkeypatch):
    calls = Calls()

    async def fake_send_embed(channel_id, embed):
        calls.append({"channel_id": channel_id, "embed": embed})
        return {"ok": True, "message_id": f"m{len(calls)}", "channel_id": channel_id}

    async def fake_send_dm(discord_user_id, embed):
        calls.append({"dm": discord_user_id, "embed": embed})
        return dict(calls.answer, message_id=f"d{len(calls)}") if calls.answer.get("ok") else dict(calls.answer)

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "send_embed", fake_send_embed)
    monkeypatch.setattr(discord_bot.bot, "send_dm", fake_send_dm)
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    return calls


async def configure(flow, channels: dict, *, bot: bool = True):
    payload = {"channels": channels}
    if bot:
        payload.update({"bot_token": "test" * 6 + ".fake." + "token" * 8, "bot_enabled": True})
    response = await flow.put("/api/settings/discord", json=payload)
    assert response.status_code == 200, response.text


def test_tournament_and_fast_lap_messages_are_the_single_source():
    message = tournament_message({"id": "t1", "slug": "cup", "title": "Sommer-Cup", "description": "Los!", "format": "single_elimination", "max_participants": 8, "banner_url": "/x.webp"},
                                 "live", game_name="Rocket League")
    assert message["event_key"] == "tournament.live" and message["title"] == "🏆 Sommer-Cup · Jetzt live" and message["url"] == "/tournaments/cup"
    assert [f["value"] for f in message["fields"]] == ["Rocket League", "Single Elimination", "max. 8"] and message["image_url"] == "/x.webp"
    lap = fast_lap_message({"id": "c1", "slug": "spa", "title": "Spa"}, driver="Paula", track="Spa", time_text="1:42.318", previous_text=None)
    assert lap["event_key"] == "f1.new_leader" and "**Paula**" in lap["description"] and lap["fields"] == [{"name": "Zeit", "value": "1:42.318", "inline": True}]


@pytest.mark.asyncio
async def test_catalog_covers_every_event_and_uses_latest_real_data(flow):
    from discord_service import EVENTS

    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    data = (await flow.get("/api/settings/discord/samples")).json()
    keys = {entry["key"] for entry in data["entries"]}
    assert set(EVENTS) <= keys, "jedes Ereignis hat eine Vorschau"
    assert {"ops.check_red", "ops.error_group", "notify.achievement", "notify.direct_message"} <= keys
    assert [group["key"] for group in data["groups"]] == ["public", "board", "ops", "dm"]
    assert data["test_channel"]["configured"] is False and data["dm"]["linked"] is False
    by_key = {entry["key"]: entry for entry in data["entries"]}
    assert by_key["news.published"]["source"] == "example" and by_key["news.published"]["embed"]["title"].startswith("📰 ")
    assert by_key["news.published"]["enabled"] is False and by_key["tournament.live"]["enabled"] is True
    assert by_key["notify.direct_message"]["dm"] is True and "Öffne die Website" in by_key["notify.direct_message"]["embed"]["description"]
    assert "Hey, hast du" not in by_key["notify.direct_message"]["embed"]["description"], "fremde Nachrichtentexte nie"
    assert "Paula" in by_key["notify.achievement"]["embed"]["title"] and by_key["notify.achievement"]["embed"]["color"] != 0x29B6E8
    assert "message" not in by_key["news.published"], "Rohdaten bleiben im Server"

    await flow.db.news_posts.insert_one({"id": "n1", "slug": "sommerfest", "title": "Sommerfest", "excerpt": "Grillen!", "published": True,
                                         "published_at": "2026-09-20T10:00:00+00:00", "visibility": "public"})
    await flow.db.news_posts.insert_one({"id": "n2", "slug": "intern", "title": "Intern", "excerpt": "Nur Mitglieder", "published": True,
                                         "published_at": "2026-09-21T10:00:00+00:00", "visibility": "members"})
    data = (await flow.get("/api/settings/discord/samples")).json()
    news = next(entry for entry in data["entries"] if entry["key"] == "news.published")
    assert news["source"] == "latest" and news["embed"]["title"] == "📰 Sommerfest" and "Sommerfest" in news["source_text"], "die letzte öffentliche News, nie die interne"


@pytest.mark.asyncio
async def test_sending_a_sample_goes_only_to_the_test_channel_and_is_marked_as_test(flow, posted):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    await configure(flow, {"community": COMMUNITY})

    missing = (await flow.post("/api/settings/discord/samples/news.published/send?via=test")).json()
    assert missing["ok"] is False and missing["reason"] == "test_channel_missing" and "Testkanal" in missing["error"]
    assert posted == [], "ohne Testkanal geht nichts raus - auch nicht in die Community"

    await configure(flow, {"community": COMMUNITY, "test": TEST_CHANNEL})
    status = (await flow.get("/api/settings/discord")).json()["target_status"]["test"]
    assert status["private"] is True and status["configured"] is True

    sent = (await flow.post("/api/settings/discord/samples/tournament.live/send?via=test")).json()
    assert sent["ok"] is True and sent["target"] == "test", sent
    assert len(posted) == 1 and posted[0]["channel_id"] == TEST_CHANNEL
    embed = posted[0]["embed"]
    assert embed["title"].startswith("🏆 ") and embed["footer"]["text"] == "Test · nicht an die Community"
    log = await flow.db.email_logs.find_one({"channel": "discord", "target": "test"}, {"_id": 0}, sort=[("created_at", -1)])
    assert log["status"] == "sent" and log["test"] is True and log["event_key"] == "test.tournament.live"
    overview = (await flow.get("/api/settings/discord")).json()
    assert overview.get("last_event_key") != "test.tournament.live", "Tests zählen nicht als Meldung"

    assert (await flow.post("/api/settings/discord/samples/gibt.es.nicht/send?via=test")).status_code == 404
    assert (await flow.post("/api/settings/discord/samples/news.published/send?via=public")).status_code == 422


@pytest.mark.asyncio
async def test_sending_to_me_needs_a_linked_account_and_reports_closed_dms(flow, posted):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    await configure(flow, {"community": COMMUNITY})

    unlinked = (await flow.post("/api/settings/discord/samples/notify.achievement/send?via=dm")).json()
    assert unlinked["ok"] is False and unlinked["reason"] == "not_linked" and "Socials" in unlinked["error"]
    assert posted == []

    await flow.db.platform_links.insert_one({"id": "l-admin", "user_id": admin["id"], "platform": "discord", "external_id": DISCORD_ID, "handle": "admin"})
    data = (await flow.get("/api/settings/discord/samples")).json()
    assert data["dm"]["linked"] is True

    sent = (await flow.post("/api/settings/discord/samples/notify.achievement/send?via=dm")).json()
    assert sent["ok"] is True and sent["target"] == "dm"
    assert len(posted) == 1 and posted[0]["dm"] == DISCORD_ID and posted[0]["embed"]["footer"]["text"] == "Test · nicht an die Community"
    assert "Paula" in posted[0]["embed"]["title"]
    log = await flow.db.email_logs.find_one({"channel": "discord", "target": "dm", "user_id": admin["id"]}, {"_id": 0}, sort=[("created_at", -1)])
    assert log["status"] == "sent" and log["test"] is True and log["event_key"] == "test.notify.achievement"

    posted.answer = {"ok": False, "reason": "forbidden"}
    closed = (await flow.post("/api/settings/discord/samples/notify.match_reminder/send?via=dm")).json()
    assert closed["ok"] is False and closed["reason"] == "dm_forbidden" and "Direktnachricht" in closed["error"]

    player = await flow.add_user(role="player", name="paula")
    flow.act_as(player)
    assert (await flow.get("/api/settings/discord/samples")).status_code in (401, 403)
