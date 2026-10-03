"""Mitgliederkanal (#605) durch die echte Anwendung: News und Events nur für Mitglieder gehen in den privaten
Mitgliederkanal - nie in einen öffentlichen, ohne Kanal gar nicht; Internes geht an den Vorstand, dort nur mit
Titel, Zeit, Ort und Link; nie Internes an die Mitglieder. Öffentliches bleibt, wie es war."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import discord_service  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_announcements, discord_bot  # noqa: E402

COMMUNITY = "100000000000000001"
NEWS = "100000000000000002"
BOARD = "100000000000000003"
MEMBERS = "100000000000000007"
TOKEN = "test" * 6 + ".fake." + "token" * 8
ALL_ON = {"news.published": True, "news.members": True, "news.internal": True, "event.members": True, "event.internal": True}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def posted(monkeypatch):
    calls = []

    async def fake_send(channel_id, embed, buttons=None):
        calls.append({"channel_id": channel_id, "title": embed.get("title"), "description": embed.get("description"), "fields": embed.get("fields"),
                      "image": (embed.get("image") or {}).get("url")})
        return {"ok": True, "message_id": f"m{len(calls)}", "channel_id": channel_id}

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "send_embed", fake_send)
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    return calls


async def configure(flow, channels, events=None):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, "channels": channels, "events": ALL_ON if events is None else events})
    assert response.status_code == 200, response.text


async def add_news(flow, id, visibility, **extra):
    await flow.db.news_posts.insert_one({"id": id, "slug": id, "title": f"News {id}", "excerpt": f"Text von {id}", "published": True, "visibility": visibility,
                                         "published_at": now_utc().isoformat(), "banner_url": "uploads/public/b.webp", **extra})


@pytest.mark.asyncio
async def test_each_audience_reaches_only_its_own_channel(flow, posted):
    await configure(flow, {"community": COMMUNITY, "news": NEWS, "board": BOARD, "members": MEMBERS})
    await add_news(flow, "offen", "public")
    await add_news(flow, "verein", "members")
    await add_news(flow, "vorstand", "internal")
    result = await discord_announcements.announce_due()
    assert result["outcomes"] == {"sent": 3}, result
    by_title = {call["title"]: call for call in posted}
    assert by_title["📰 News offen"]["channel_id"] == NEWS
    assert by_title["📰 News verein"]["channel_id"] == MEMBERS and by_title["📰 News verein"]["description"] == "Text von verein"
    internal = by_title["📰 News vorstand"]
    assert internal["channel_id"] == BOARD and internal["description"] == "" and internal["image"] is None, "intern: kein Text, kein Bild im fremden Dienst"

    # Mitglieder-Events mit Zeit und Ort.
    start = (now_utc() + timedelta(days=4)).replace(hour=18, minute=0, second=0, microsecond=0)
    await flow.db.events.insert_one({"id": "e1", "slug": "stammtisch", "name": "Stammtisch", "visibility": "members", "status": "scheduled",
                                     "created_at": now_utc().isoformat(), "start_date": start.isoformat(), "location": "Vereinsheim", "city": "Telfs"})
    await discord_announcements.announce_due()
    event = posted[-1]
    assert event["channel_id"] == MEMBERS and event["title"] == "📅 Stammtisch"
    assert [field["name"] for field in event["fields"]] == ["Wann", "Wo"] and event["fields"][1]["value"] == "Vereinsheim, Telfs"


@pytest.mark.asyncio
async def test_without_members_channel_nothing_and_never_a_fallback(flow, posted):
    await configure(flow, {"community": COMMUNITY, "news": NEWS})
    await add_news(flow, "verein", "members")
    assert (await discord_announcements.announce_due())["outcomes"] == {"members_channel_missing": 1}
    assert posted == [], "kein Mitgliederkanal: nichts - nie Community oder News"
    log = await flow.db.email_logs.find_one({"event_key": "news.members"}, {"_id": 0})
    assert log["target"] == "members" and "Mitgliederkanal" in log["error"]

    # Die Grenze steht in send_event: Internes nie an Mitglieder, Mitglieder-Inhalte nie öffentlich.
    for key, visibility in (("news.members", "internal"), ("news.published", "members"), ("event.announced", "internal")):
        assert (await discord_service.send_event(key, "x", item={"visibility": visibility}))["reason"] == "private_visibility", key
    assert discord_service.allowed_in_target({"visibility": "members"}, "board") is True, "der Vorstand darf alles sehen"


@pytest.mark.asyncio
async def test_switches_are_off_by_default_and_the_test_reaches_the_members_channel(flow, posted):
    await configure(flow, {"community": COMMUNITY, "members": MEMBERS}, events={})
    data = (await flow.get("/api/settings/discord")).json()
    switches = {event["key"]: event for event in data["events"]}
    for key in ("news.members", "event.members", "news.internal", "event.internal"):
        assert switches[key]["enabled"] is False, key
    assert switches["news.members"]["target"] == "members" and switches["news.internal"]["target"] == "board"
    assert data["target_status"]["members"]["private"] is True and data["target_status"]["members"]["label"] == "Mitglieder (privat)"

    sent = (await flow.post("/api/settings/discord/test?target=members")).json()
    assert sent["ok"] is True and posted[-1]["channel_id"] == MEMBERS and "Rolle „Mitglied“" in posted[-1]["description"]

    preview = (await flow.post("/api/settings/discord/preview", json={"kind": "event", "item": {"name": "Stammtisch", "visibility": "members"}})).json()
    assert preview["target"] == "members" and preview["reason"] == "event_disabled"
