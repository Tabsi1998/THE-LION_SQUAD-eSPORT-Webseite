"""Ein Thread je Turnier (#572): Die Ankündigung steht im Kanal, alles Weitere hängt darunter.

Geprüft wird, was im Kanal landet und was im Thread: ein Thread je Turnier, jede
weitere Meldung darin, und - wenn Discord den Thread nicht mehr kennt - die Meldung
trotzdem im Kanal statt gar nicht.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import discord_bot, discord_threads  # noqa: E402

EVENTS_CHANNEL = "100000000000000003"
THREAD_ID = "200000000000000009"
TOKEN = "test" * 6 + ".fake." + "token" * 8


class FakeBot:
    """Der Bot, wie ihn diese Flows sehen: er merkt sich, wohin etwas ging."""

    def __init__(self):
        self.sent: list[dict] = []
        self.threads: list[dict] = []
        self.counter = 0
        self.unknown: set[str] = set()
        self.thread_result: dict | None = None

    async def send_embed(self, channel_id, embed, buttons=None):
        if str(channel_id) in self.unknown:
            return {"ok": False, "reason": "unknown_channel"}
        self.counter += 1
        self.sent.append({"channel_id": str(channel_id), "title": embed.get("title"), "buttons": buttons or []})
        return {"ok": True, "message_id": f"m{self.counter}", "channel_id": str(channel_id)}

    async def create_thread(self, channel_id, message_id, name):
        self.threads.append({"channel_id": str(channel_id), "message_id": str(message_id), "name": name})
        return self.thread_result or {"ok": True, "thread_id": THREAD_ID}

    async def edit_embed(self, channel_id, message_id, embed):
        return {"ok": True, "message_id": str(message_id)}

    async def pin_message(self, channel_id, message_id):
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
    for name in ("send_embed", "create_thread", "edit_embed", "pin_message"):
        monkeypatch.setattr(discord_bot.bot, name, getattr(fake, name))

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    return fake


async def configure(flow):
    """Ein Verein mit Bot und Events-Kanal, und ein Admin, der Turniere schalten darf."""
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/settings/discord",
                              json={"bot_token": TOKEN, "bot_enabled": True, "channels": {"events": EVENTS_CHANNEL}})
    assert response.status_code == 200, response.text
    return admin


async def set_status(flow, tournament, status):
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": status})
    assert response.status_code == 200, response.text
    return response.json()


def test_thread_name_says_game_and_title():
    assert discord_threads.thread_name({"title": "Sommer-Cup"}) == "Sommer-Cup"
    assert discord_threads.thread_name({"title": "Sommer-Cup"}, game_name="Rocket League") == "Rocket League: Sommer-Cup"
    assert discord_threads.thread_name({}) == "Turnier"

    long_one = discord_threads.thread_name({"title": "T" * 200}, game_name="Rocket League")
    assert len(long_one) == discord_threads.MAX_NAME and long_one.startswith("Rocket League: ")


@pytest.mark.asyncio
async def test_one_thread_per_tournament_and_every_later_message_inside_it(flow, bot):
    await configure(flow)
    tournament, _, _ = await flow.with_participants(2, title="Sommer-Cup", status="draft")

    await set_status(flow, tournament, "registration_open")

    assert len(bot.sent) == 1 and bot.sent[0]["channel_id"] == EVENTS_CHANNEL, "die Ankündigung steht im Kanal"
    # Der Knopf aus #573 reist mit und trägt eine vollständige Adresse, keinen Pfad.
    assert [button["label"] for button in bot.sent[0]["buttons"]] == ["Zur Anmeldung"]
    assert bot.sent[0]["buttons"][0]["url"].startswith("http")
    assert bot.threads == [{"channel_id": EVENTS_CHANNEL, "message_id": "m1", "name": "Sommer-Cup"}]
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0, discord_threads.FIELD: 1})
    assert discord_threads.stored(stored)["thread_id"] == THREAD_ID

    await set_status(flow, tournament, "live")
    await set_status(flow, tournament, "completed")

    assert [row["channel_id"] for row in bot.sent] == [EVENTS_CHANNEL, THREAD_ID, THREAD_ID], \
        "nach der Ankündigung geht alles in den Thread"
    assert len(bot.threads) == 1, "ein zweiter Thread wäre genau das, was das Issue vermeidet"
    assert "Endstand" in (bot.sent[-1]["title"] or "") or bot.sent[-1]["channel_id"] == THREAD_ID


@pytest.mark.asyncio
async def test_a_thread_discord_no_longer_knows_does_not_swallow_the_message(flow, bot):
    await configure(flow)
    tournament, _, _ = await flow.with_participants(2, title="Herbst-Cup", status="draft")
    await set_status(flow, tournament, "registration_open")

    # Jemand löscht den Thread von Hand.
    bot.unknown.add(THREAD_ID)
    await set_status(flow, tournament, "live")

    assert [row["channel_id"] for row in bot.sent] == [EVENTS_CHANNEL, EVENTS_CHANNEL], \
        "ohne Thread geht die Meldung in den Kanal, nicht verloren"


@pytest.mark.asyncio
async def test_without_a_thread_nothing_changes(flow, bot):
    await configure(flow)
    bot.thread_result = {"ok": False, "reason": "forbidden"}
    tournament, _, _ = await flow.with_participants(2, title="Winter-Cup", status="draft")

    await set_status(flow, tournament, "registration_open")
    await set_status(flow, tournament, "live")

    assert [row["channel_id"] for row in bot.sent] == [EVENTS_CHANNEL, EVENTS_CHANNEL]
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0, discord_threads.FIELD: 1})
    assert discord_threads.stored(stored) == {}, "ein Thread, den der Bot nicht öffnen durfte, wird nicht gespeichert"
    assert len(bot.threads) == 1, "nur die Ankündigung öffnet den Thread, ein späterer Versuch hänge unter der falschen Nachricht"
