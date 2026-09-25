"""Live-Einbettungen (#569): Rechnung der drei Einbettungen, eine Nachricht je Einbettung (posten +
pinnen, dann bearbeiten), gleicher Inhalt = keine Bearbeitung, neu nach Löschung, Bremse eine Minute,
Einstellungen mit Kanalwahl und „Jetzt aktualisieren“ - alles mit nachgestelltem Bot."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_bot, discord_embeds  # noqa: E402

CHANNEL = "100000000000000011"
TOKEN = "test" * 6 + ".fake." + "token" * 8


class FakeBot:
    def __init__(self):
        self.sent: list[dict] = []
        self.edited: list[dict] = []
        self.pinned: list[str] = []
        self.deleted: set[str] = set()
        self.counter = 0

    async def send_embed(self, channel_id, embed):
        self.counter += 1
        self.sent.append({"channel_id": channel_id, "embed": embed})
        return {"ok": True, "message_id": f"m{self.counter}", "channel_id": channel_id}

    async def edit_embed(self, channel_id, message_id, embed):
        if message_id in self.deleted:
            return {"ok": False, "reason": "unknown_message"}
        self.edited.append({"channel_id": channel_id, "message_id": message_id, "embed": embed})
        return {"ok": True, "message_id": message_id}

    async def pin_message(self, channel_id, message_id):
        self.pinned.append(message_id)
        return {"ok": True}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def bot(monkeypatch):
    fake = FakeBot()
    monkeypatch.setattr(discord_bot.bot, "send_embed", fake.send_embed)
    monkeypatch.setattr(discord_bot.bot, "edit_embed", fake.edit_embed)
    monkeypatch.setattr(discord_bot.bot, "pin_message", fake.pin_message)

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    discord_embeds._dirty.clear()
    return fake


def test_embeds_are_pure_functions():
    season = {"id": "s1", "slug": "2026", "title": "Saison 2026"}
    rows = [{"display_name": "Paula", "total_points": 120.5}, {"username": "leon", "total_points": 80}]
    ranking = discord_embeds.ranking_embed(season, rows, "https://lionsquad.at", now_utc())
    assert ranking["title"] == "🏆 Rangliste – Saison 2026" and "🥇 **Paula** – 120,5 Punkte" in ranking["description"] and "🥈 **leon** – 80 Punkte" in ranking["description"]
    assert ranking["url"] == "https://lionsquad.at/seasons/2026" and ranking["footer"].startswith("Stand: ")
    assert "Keine laufende Saison" in discord_embeds.ranking_embed(None, [], "https://lionsquad.at")["description"]

    items = [{"kind": "tournament", "title": "Sommer-Cup", "start": "2026-10-03T16:00:00+00:00", "path": "/tournaments/sommer-cup", "phase": {"label": "Anmeldung offen"}}]
    events = discord_embeds.events_embed(items, "https://lionsquad.at")
    assert "**Sommer-Cup** · 03.10.2026, 18:00 Uhr · Turnier · Anmeldung offen" in events["description"] and "<https://lionsquad.at/tournaments/sommer-cup>" in events["description"]
    assert "Nichts geplant" in discord_embeds.events_embed([], "https://lionsquad.at")["description"]

    live = discord_embeds.live_embed([{"display_name": "Paula", "game_name": "Rocket League", "title": "Finale!", "viewer_count": 12, "stream_url": "https://twitch.tv/paula"}], "https://lionsquad.at")
    assert "🔴 **Paula** spielt Rocket League – „Finale!“ · 12 Zuschauer" in live["description"]
    assert "Gerade streamt niemand." in discord_embeds.live_embed([], "https://lionsquad.at")["description"]

    a = discord_embeds.content_hash({"title": "x", "description": "y", "footer": "Stand: 10:00 Uhr"})
    b = discord_embeds.content_hash({"title": "x", "description": "y", "footer": "Stand: 10:10 Uhr"})
    assert a == b and a != discord_embeds.content_hash({"title": "x", "description": "z"})


async def configure(flow, embeds: dict):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, "embeds": embeds})
    assert response.status_code == 200, response.text
    return admin


@pytest.mark.asyncio
async def test_settings_validate_and_expose_the_embeds(flow, bot):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    assert (await flow.put("/api/settings/discord", json={"embeds": {"unbekannt": {"enabled": True}}})).status_code == 400
    assert (await flow.put("/api/settings/discord", json={"embeds": {"events": {"channel_id": "abc"}}})).status_code == 400
    saved = await flow.put("/api/settings/discord", json={"embeds": {"events": {"enabled": True, "channel_id": CHANNEL}}})
    assert saved.status_code == 200 and saved.json()["changed"] is True
    data = (await flow.get("/api/settings/discord")).json()
    assert data["embeds"]["events"]["enabled"] is True and data["embeds"]["events"]["channel_id"] == CHANNEL and data["embeds"]["events"]["label"] == "Nächste Events"
    assert data["embeds"]["ranking"]["enabled"] is False and set(data["embeds"]) == {"ranking", "events", "live"}
    assert "embeds" not in data.get("bot", {})


@pytest.mark.asyncio
async def test_one_message_per_embed_edit_on_change_repost_after_deletion_and_throttle(flow, bot):
    await configure(flow, {"events": {"enabled": True, "channel_id": CHANNEL}, "live": {"enabled": True, "channel_id": CHANNEL}, "ranking": {"enabled": False}})
    await flow.db.events.insert_one({"id": "e1", "slug": "lan", "name": "LAN-Party", "status": "scheduled", "visibility": "public",
                                     "start_date": (now_utc() + timedelta(days=3)).isoformat()})
    t0 = now_utc()

    first = await discord_embeds.refresh(flow.db, "events", now=t0)
    assert first == {"ok": True, "reason": "posted", "message_id": "m1", "pinned": True}, first
    assert bot.pinned == ["m1"] and "LAN-Party" in bot.sent[0]["embed"]["description"] and bot.sent[0]["embed"]["footer"]["text"].startswith("Stand: ")
    assert (await discord_embeds.refresh(flow.db, "ranking", now=t0))["reason"] == "disabled"

    # Gleicher Inhalt eine Minute später: keine Bearbeitung.
    assert (await discord_embeds.refresh(flow.db, "events", now=t0 + timedelta(seconds=61)))["reason"] == "unchanged" and bot.edited == []
    # Änderung, aber innerhalb der Minute: gebremst und vorgemerkt.
    await flow.db.events.insert_one({"id": "e2", "slug": "cup", "name": "Herbst-Cup", "status": "scheduled", "visibility": "public",
                                     "start_date": (now_utc() + timedelta(days=5)).isoformat()})
    discord_embeds.request_refresh("events")
    throttled = await discord_embeds.refresh(flow.db, "events", now=t0 + timedelta(seconds=30))
    assert throttled["reason"] == "throttled" and "events" in discord_embeds.pending()
    # Nach der Minute: bearbeitet statt neu, die Nachricht bleibt m1.
    edited = await discord_embeds.refresh(flow.db, "events", now=t0 + timedelta(seconds=90))
    assert edited == {"ok": True, "reason": "edited", "message_id": "m1", "pinned": None}
    assert len(bot.sent) == 1 and bot.edited[-1]["message_id"] == "m1" and "Herbst-Cup" in bot.edited[-1]["embed"]["description"]
    assert "events" not in discord_embeds.pending()

    # Nachricht gelöscht: der Bot postet neu und pinnt wieder.
    bot.deleted.add("m1")
    reposted = await discord_embeds.refresh(flow.db, "events", force=True, now=t0 + timedelta(seconds=200))
    assert reposted["reason"] == "posted" and reposted["message_id"] == "m2" and bot.pinned == ["m1", "m2"]
    state = (await flow.db.settings.find_one({"id": "discord"}, {"_id": 0}))["embeds"]["events"]
    assert state["message_id"] == "m2" and state["last_action"] == "posted" and state["error"] is None

    # Der Sammler alle 10 min schreibt den Stand neu (force), auch ohne Änderung; leer bleibt „niemand“.
    outcome = await discord_embeds.sweep(flow.db, full=True)
    assert outcome["checked"] == 2 and outcome["posted"] == 1, outcome   # live wird zum ersten Mal gepostet, events gebremst oder bearbeitet
    assert "Gerade streamt niemand." in bot.sent[-1]["embed"]["description"]

    flow.act_as(await flow.add_user(role="club_admin", name="admin2"))
    status = (await flow.get("/api/settings/discord")).json()["embeds"]
    assert status["events"]["message_id"] == "m2" and status["live"]["message_id"] == "m3" and status["events"]["updated_at"]
    player = await flow.add_user(role="player", name="paula")
    flow.act_as(player)
    assert (await flow.post("/api/settings/discord/embeds/events/refresh")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_channel_change_starts_a_new_message_and_refresh_route_forces(flow, bot):
    await configure(flow, {"live": {"enabled": True, "channel_id": CHANNEL}})
    assert (await discord_embeds.refresh(flow.db, "live"))["reason"] == "posted"
    other = "100000000000000012"
    assert (await flow.put("/api/settings/discord", json={"embeds": {"live": {"channel_id": other}}})).status_code == 200
    state = (await flow.db.settings.find_one({"id": "discord"}, {"_id": 0}))["embeds"]["live"]
    assert "message_id" not in state and state["channel_id"] == other, "neuer Kanal = neue Nachricht"
    forced = (await flow.post("/api/settings/discord/embeds/live/refresh")).json()
    assert forced["reason"] == "posted" and bot.sent[-1]["channel_id"] == other
    assert (await flow.post("/api/settings/discord/embeds/gibt-es-nicht/refresh")).status_code == 404
