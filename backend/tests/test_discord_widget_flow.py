"""Discord auf der Website (#581) durch die echte Anwendung: aus dem Server-Widget nur Zahlen - online und je
öffentlichem Sprachkanal die Belegung, nie Namen; Startseite nur Zahlen und Einladung, Mitglieder dazu die
Kanäle; Widget aus → nichts kaputt, der Bot-Kasten sagt warum; Discord bremst → letzter Stand bleibt kurz."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_bot, discord_widget  # noqa: E402

GUILD = "400000000000000001"
WIDGET = {
    "id": GUILD, "name": "THE LION SQUAD", "instant_invite": "https://discord.com/invite/abc123", "presence_count": 42,
    "channels": [{"id": "1", "name": "Turnier-Lobby", "position": 2}, {"id": "2", "name": "Chillen", "position": 1}, {"id": "3", "name": "Leer", "position": 3}],
    "members": [
        {"id": "0", "username": "Paula", "status": "online", "channel_id": "1"}, {"id": "1", "username": "Leon", "status": "online", "channel_id": "1"},
        {"id": "2", "username": "Mira", "status": "idle", "channel_id": "2"}, {"id": "3", "username": "Kai", "status": "online"},
        {"id": "4", "username": "Geheim", "status": "online", "channel_id": "99"},
    ],
}


class Discord:
    """Discords Antwort auf widget.json - umstellbar je Test."""

    def __init__(self):
        self.answer = (200, WIDGET)
        self.urls: list[str] = []

    async def __call__(self, url):
        self.urls.append(url)
        return self.answer


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def discord(monkeypatch):
    fake = Discord()
    monkeypatch.setattr(discord_widget, "_fetch", fake)
    return fake


def test_only_numbers_survive_never_names():
    summary = discord_widget.summarize(WIDGET)
    assert summary == {"online": 42, "in_voice": 3, "voice": [{"name": "Chillen", "count": 1}, {"name": "Turnier-Lobby", "count": 2}],
                       "invite": "https://discord.com/invite/abc123"}
    assert "Paula" not in str(summary) and "Geheim" not in str(summary), "Namen fallen weg, private Kanäle zählen nicht"
    assert discord_widget.summarize({"presence_count": "7", "instant_invite": "javascript:alert(1)"})["invite"] is None
    assert discord_widget.summarize(None) == {"online": 0, "in_voice": 0, "voice": [], "invite": None}


@pytest.mark.asyncio
async def test_widget_feeds_home_and_member_area_and_goes_away_when_switched_off(flow, discord):
    # Ohne Server-ID kein Abruf.
    assert (await discord_widget.refresh(flow.db))["reason"] == "no_guild" and discord.urls == []
    await discord_bot.record_state(flow.db, guild_id=GUILD, guild_name="THE LION SQUAD")

    assert (await discord_widget.refresh(flow.db))["ok"] is True and discord.urls == [f"https://discord.com/api/guilds/{GUILD}/widget.json"]
    home = (await flow.get("/api/home/state")).json()["discord"]
    assert home == {"available": True, "online": 42, "in_voice": 3, "invite": "https://discord.com/invite/abc123"}, "öffentlich nur Zahlen"
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "discord_invite_url": "https://discord.gg/lions"}}, upsert=True)
    assert (await flow.get("/api/home/state")).json()["discord"]["invite"] == "https://discord.gg/lions", "die Einladung des Vereins geht vor"

    player = await flow.add_user(role="player", name="gast")
    flow.act_as(player)
    assert (await flow.get("/api/membership/discord-voice")).status_code == 403
    member = await flow.add_user(role="player", name="paula")
    await flow.db.users.update_one({"id": member["id"]}, {"$set": {"is_club_member": True}})
    member["is_club_member"] = True   # der Test-Login liest die Person nicht neu
    flow.act_as(member)
    voice = (await flow.get("/api/membership/discord-voice")).json()
    assert voice["voice"] == [{"name": "Chillen", "count": 1}, {"name": "Turnier-Lobby", "count": 2}] and voice["online"] == 42

    # Discord bremst: der letzte Stand bleibt - aber höchstens fünf Minuten.
    discord.answer = (429, {"message": "You are being rate limited."})
    assert (await discord_widget.refresh(flow.db))["reason"] == "rate_limited"
    assert (await flow.get("/api/home/state")).json()["discord"]["online"] == 42
    later = now_utc() + timedelta(minutes=6)
    assert (await discord_widget.public_view(flow.db, later)) == {"available": False}, "veralteter Stand wird nicht gezeigt"

    # Widget aus: die Anzeige verschwindet, der Bot-Kasten sagt, wo man es einschaltet.
    discord.answer = (403, {"code": 50004, "message": "Widget Disabled"})
    assert (await discord_widget.refresh(flow.db))["reason"] == "widget_disabled"
    assert (await flow.get("/api/home/state")).json()["discord"] == {"available": False}
    assert (await flow.get("/api/membership/discord-voice")).json() == {"available": False}

    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    status = (await flow.get("/api/settings/discord/bot/widget")).json()
    assert status["available"] is False and status["reason"] == "widget_disabled" and "Server-Widget aktivieren" in status["reason_text"]
    discord.answer = (200, WIDGET)
    refreshed = (await flow.post("/api/settings/discord/bot/widget/refresh")).json()
    assert refreshed["available"] is True and refreshed["online"] == 42 and refreshed["reason"] is None
    flow.act_as(member)
    assert (await flow.get("/api/settings/discord/bot/widget")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_unknown_server_and_network_errors_never_break_the_home_page(flow, discord):
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {"id": "discord", "bot_guild_id": GUILD}}, upsert=True)
    discord.answer = (404, {"code": 10004, "message": "Unknown Guild"})
    assert (await discord_widget.refresh(flow.db))["reason"] == "unknown_guild"
    assert "Server-ID prüfen" in (await discord_widget.admin_view(flow.db))["reason_text"]

    async def broken(url):
        raise TimeoutError("zu langsam")

    assert (await discord_widget.refresh(flow.db, fetch=broken))["reason"] == "error"
    response = await flow.get("/api/home/state")
    assert response.status_code == 200 and response.json()["discord"] == {"available": False}

    # Niemand online: keine Kachel mit „0 online“.
    discord.answer = (200, {**WIDGET, "presence_count": 0, "members": []})
    await discord_widget.refresh(flow.db)
    assert (await flow.get("/api/home/state")).json()["discord"] == {"available": False}
