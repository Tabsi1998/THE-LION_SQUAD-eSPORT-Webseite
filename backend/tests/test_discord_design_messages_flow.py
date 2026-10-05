"""Vorlagen für News, Events und Turniere (#866 Teil 2) durch die echte Anwendung: der Standard sieht aus wie bisher, nur
mit Autorzeile, Fußzeile und Zeitstempel; eine eigene Fassung aus der Gestaltung geht genau so hinaus - im News-Kanal,
im Mitgliederkanal und im Turnier-Thread; „erneut senden“ schickt dieselbe Einbettung; Internes bleibt ohne Vorlage."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_announcements, discord_bot, discord_design, discord_threads  # noqa: E402

NEWS, EVENTS, BOARD, MEMBERS = "100000000000000002", "100000000000000004", "100000000000000003", "100000000000000007"
TOKEN = "test" * 6 + ".fake." + "token" * 8
ALL_ON = {"news.published": True, "news.members": True, "news.internal": True, "event.announced": True, "event.members": True}


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

    async def fake_send(channel_id, embed, buttons=None, content=None):
        calls.append({"channel_id": channel_id, "embed": embed, "content": content})
        if channel_id == "100000000000000099":
            return {"ok": False, "reason": "forbidden"}
        return {"ok": True, "message_id": f"m{len(calls)}", "channel_id": channel_id}

    async def fake_thread(channel_id, message_id, name):
        return {"ok": True, "thread_id": f"th-{message_id}"}

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "send_embed", fake_send)
    monkeypatch.setattr(discord_bot.bot, "create_thread", fake_thread)
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    return calls


async def configure(flow, channels):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, "channels": channels, "events": ALL_ON})
    assert response.status_code == 200, response.text
    return admin


@pytest.mark.asyncio
async def test_the_standard_looks_like_before_plus_author_footer_and_time(flow):
    post = {"id": "n1", "slug": "rekord", "title": "Vereinsrekord", "excerpt": "120 Leute bei der LAN.", "banner_url": "https://cdn.example.org/b.webp",
            "visibility": "public"}
    news = await discord_announcements.designed_news(flow.db, post)
    embed = news["embed"]
    assert embed["title"] == "📰 Vereinsrekord" and embed["description"] == "120 Leute bei der LAN." and embed["url"].endswith("/news/rekord")
    assert embed["author"]["name"] == "THE LION SQUAD · News" and embed["footer"]["text"] == "THE LION SQUAD" and embed["timestamp"]
    assert embed["image"] == {"url": "https://cdn.example.org/b.webp"} and embed["color"] == 0x29B6E8
    members = await discord_announcements.designed_news(flow.db, {**post, "visibility": "members"})
    assert members["embed"]["footer"]["text"] == "THE LION SQUAD · nur für Mitglieder"
    internal = await discord_announcements.designed_news(flow.db, {**post, "visibility": "internal"})
    assert "embed" not in internal and internal["description"] == "", "intern: keine Vorlage, kein Text im fremden Dienst"

    event = {"id": "e1", "slug": "lan", "name": "LAN-Party", "short_description": "Zwei Tage zocken.", "start_date": "2026-10-10T16:00:00+00:00",
             "end_date": "2026-10-11T20:00:00+00:00", "location": "Vereinsheim", "city": "Telfs", "has_registration": True,
             "registration_closes_at": "2026-10-08T21:59:00+00:00", "max_participants": 24, "visibility": "public"}
    fields = {field["name"]: field["value"] for field in (await discord_announcements.designed_event(flow.db, event))["embed"]["fields"]}
    assert fields == {"Wann": "10.10.2026, 18:00 Uhr – 11.10.2026", "Wo": "Vereinsheim, Telfs", "Anmeldung bis": "08.10.2026, 23:59 Uhr", "Plätze": "24"}
    without = (await discord_announcements.designed_event(flow.db, {**event, "has_registration": False}))["embed"]["fields"]
    assert [field["name"] for field in without] == ["Wann", "Wo"], "ohne Anmeldung keine leeren Felder"

    tournament = {"id": "t1", "slug": "cup", "title": "Sommer-Cup", "description": "Das Vereinsturnier.", "format": "double_elimination",
                  "max_participants": 16}
    opener = (await discord_announcements.designed_tournament(flow.db, tournament, "registration_open", {"name": "Rocket League"}))["embed"]
    assert opener["title"] == "🏆 Sommer-Cup · Anmeldung offen" and opener["color"] == 0x00FF88
    assert [field["value"] for field in opener["fields"]] == ["Rocket League", "Double Elimination", "max. 16"]
    thread = (await discord_announcements.designed_tournament(flow.db, tournament, "live", None, in_thread=True))["embed"]
    assert thread["title"] == "🏆 Sommer-Cup · Jetzt live" and "fields" not in thread and "image" not in thread and thread["color"] == 0x29B6E8


@pytest.mark.asyncio
async def test_an_own_template_goes_out_exactly_so_and_resend_keeps_it(flow, posted):
    await configure(flow, {"news": NEWS, "members": MEMBERS})
    template = {**discord_design.default_template("news"), "title": "Neu bei uns: {title}", "content": "📣 {club} hat Neuigkeiten"}
    saved = await flow.put("/api/settings/discord/design/news", json={"template": template})
    assert saved.status_code == 200, saved.text
    listing = (await flow.get("/api/settings/discord/design")).json()
    assert "Meldungen" in listing["groups"] and {"news", "event", "tournament", "tournament_thread"} <= {kind["key"] for kind in listing["kinds"]}

    now = now_utc().isoformat()
    await flow.db.news_posts.insert_many([
        {"id": "a", "slug": "a", "title": "Sommerfest", "excerpt": "Grillen am Platz.", "published": True, "visibility": "public", "published_at": now},
        {"id": "b", "slug": "b", "title": "Mitgliederabend", "excerpt": "Nur für uns.", "published": True, "visibility": "members", "published_at": now},
    ])
    await discord_announcements.announce_due()
    by_channel = {call["channel_id"]: call for call in posted}
    assert by_channel[NEWS]["embed"]["title"] == "Neu bei uns: Sommerfest" and by_channel[NEWS]["content"] == "📣 THE LION SQUAD hat Neuigkeiten"
    assert by_channel[MEMBERS]["embed"]["title"] == "Neu bei uns: Mitgliederabend" and "nur für Mitglieder" in by_channel[MEMBERS]["embed"]["footer"]["text"]

    # Fehlgeschlagen und erneut gesendet: dieselbe gestaltete Einbettung, an dasselbe Ziel.
    log = await flow.db.email_logs.find_one({"channel": "discord", "target": "news"}, {"_id": 0})
    assert log["payload"]["embed"]["title"] == "Neu bei uns: Sommerfest"
    await flow.db.email_logs.update_one({"id": log["id"]}, {"$set": {"status": "failed"}})
    resent = await flow.post(f"/api/settings/discord/resend/{log['id']}")
    assert resent.status_code == 200 and resent.json()["ok"] is True
    assert posted[-1]["channel_id"] == NEWS and posted[-1]["embed"] == by_channel[NEWS]["embed"] and posted[-1]["content"] == by_channel[NEWS]["content"]


@pytest.mark.asyncio
async def test_tournament_templates_reach_channel_and_thread(flow, posted):
    await configure(flow, {"events": EVENTS})
    own = {**discord_design.default_template("tournament_thread"), "title": "{title}: {status}", "color": "#123456"}
    assert (await flow.put("/api/settings/discord/design/tournament_thread", json={"template": own})).status_code == 200
    await flow.db.tournaments.insert_one({"id": "t1", "slug": "cup", "title": "Sommer-Cup", "description": "Das Vereinsturnier.", "status": "scheduled",
                                          "is_public": True, "visibility": "public", "check_in_until": "2027-06-12T15:45:00+00:00"})
    tournament = await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0})
    await discord_threads.status_changed(flow.db, tournament, "scheduled", "registration_open")
    await discord_threads.status_changed(flow.db, {**tournament, "status": "registration_open"}, "registration_open", "check_in")
    assert posted[0]["channel_id"] == EVENTS and posted[0]["embed"]["title"] == "🏆 Sommer-Cup · Anmeldung offen", "die Ankündigung im Standard"
    assert posted[1]["channel_id"] == "th-m1" and posted[1]["embed"]["title"] == "Sommer-Cup: Check-in offen" and posted[1]["embed"]["color"] == 0x123456
    assert posted[1]["embed"]["description"].startswith("Jetzt einchecken – bis 12.06.2027, 17:45 Uhr")


@pytest.mark.asyncio
async def test_the_live_preview_uses_the_latest_news(flow):
    await configure(flow, {"news": NEWS})
    await flow.db.news_posts.insert_one({"id": "a", "slug": "a", "title": "Echte News", "excerpt": "Aus der Datenbank.", "published": True,
                                         "visibility": "public", "published_at": now_utc().isoformat()})
    preview = (await flow.post("/api/settings/discord/design/news/preview", json={"template": discord_design.default_template("news"), "data": "live"})).json()
    assert preview["data"] == "live" and preview["embed"]["title"] == "📰 Echte News"
    empty = (await flow.post("/api/settings/discord/design/event/preview", json={"template": discord_design.default_template("event"), "data": "live"})).json()
    assert empty["data"] == "sample" and empty["embed"]["title"] == "📅 LAN-Party im Vereinsheim", "ohne Event: Beispielwerte mit Hinweis"
