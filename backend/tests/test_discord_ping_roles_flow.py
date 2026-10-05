"""Spiel-Rolle anpingen (#629 Teil 2) durch die echte Anwendung: ein Schalter je Meldung mit Spielbezug, von Anfang an
aus; die Meldung beginnt mit genau einer Erwähnung - der Rolle des Hauptspiels auf dem Server, an den sie geht. Der
Querverweis am Hauptserver pingt nie, private Meldungen auch nicht, und ohne Rolle geht die Meldung ohne Ping."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import discord_service  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import discord_bot, discord_guilds, discord_roles  # noqa: E402

MAIN, RL = "500000000000000001", "500000000000000002"
MAIN_COMMUNITY, MAIN_EVENTS, MAIN_BOARD = "100000000000000001", "100000000000000003", "100000000000000004"
RL_COMMUNITY, RL_EVENTS = "200000000000000001", "200000000000000003"
ROLE_MAIN, ROLE_RL = "800000000000000001", "800000000000000002"
TOKEN = "test" * 6 + ".fake." + "token" * 8
ALL = {key: True for key, _, _ in discord_guilds.PERMISSIONS}


def seen(guild_id, name):
    return {"guild_id": guild_id, "name": name, "icon_url": None, "member_count": 10, "bot_permissions": dict(ALL)}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


class FakeBot:
    def __init__(self):
        self.posted: list[dict] = []
        self.roles: dict[tuple[str, str], str] = {}

    async def send_embed(self, channel_id, embed, buttons=None, *, content=None, mention_role_ids=None):
        self.posted.append({"channel_id": channel_id, "embed": embed, "content": content, "mentions": mention_role_ids})
        return {"ok": True, "message_id": f"9000000000000000{len(self.posted):02d}", "channel_id": channel_id}

    def role_id(self, name, guild_id=None):
        return self.roles.get((str(guild_id or MAIN), name))


@pytest.fixture
def bot(monkeypatch):
    fake = FakeBot()

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "send_embed", fake.send_embed)
    monkeypatch.setattr(discord_bot.bot, "role_id", fake.role_id)
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    return fake


async def setup(flow, bot):
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, "events": {"f1.new_leader": True},
                                                              "channels": {"community": MAIN_COMMUNITY, "events": MAIN_EVENTS, "board": MAIN_BOARD}})
    assert response.status_code == 200, response.text
    await discord_guilds.reconcile(flow.db, [seen(MAIN, "LION"), seen(RL, "Rocket League")], configured_main=MAIN)
    await discord_guilds.update_guild(flow.db, RL, {"enabled": True, "invite_url": "https://discord.gg/rocket",
                                                   "channels": {"community": RL_COMMUNITY, "events": RL_EVENTS}})
    rl = (await flow.post("/api/games", json={"name": "Rocket League", "discord_guild_id": RL})).json()
    name = discord_roles.game_role_name(await flow.db.games.find_one({"id": rl["id"]}, {"_id": 0}))
    bot.roles = {(MAIN, name): ROLE_MAIN, (RL, name): ROLE_RL}
    return rl, name


async def settings(flow, **body):
    response = await flow.put("/api/settings/discord", json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def best_time(game_id, **extra):
    return await discord_service.send_event("f1.new_leader", "Neue Bestzeit", "Runde in 1:02.345", item={"game_id": game_id, "visibility": "public"},
                                            url="/fastlap/rl", **extra)


@pytest.mark.asyncio
async def test_the_switch_is_off_at_first_and_only_events_with_a_game_can_ping(flow, bot):
    rl, _ = await setup(flow, bot)
    await best_time(rl["id"])
    assert all(post["content"] is None and post["mentions"] is None for post in bot.posted) and bot.posted, "von Anfang an aus"

    listed = {row["key"]: row for row in (await flow.get("/api/settings/discord")).json()["events"]}
    assert listed["f1.new_leader"]["ping"] is False and listed["f1.new_leader"]["routable"] is True
    private = await flow.put("/api/settings/discord", json={"pings": {"membership.application": True}})
    assert private.status_code == 400 and "keine Spiel-Rolle" in private.json()["detail"]
    assert (await flow.put("/api/settings/discord", json={"pings": {"gibt.es.nicht": True}})).status_code == 400

    await settings(flow, pings={"f1.new_leader": True})
    assert {row["key"]: row for row in (await flow.get("/api/settings/discord")).json()["events"]}["f1.new_leader"]["ping"] is True
    # Ein anderer Schalter lässt den Ping stehen.
    await settings(flow, events={"f1.new_leader": True})
    assert {row["key"]: row for row in (await flow.get("/api/settings/discord")).json()["events"]}["f1.new_leader"]["ping"] is True


@pytest.mark.asyncio
async def test_the_full_message_pings_the_role_of_its_own_server_and_the_cross_reference_never(flow, bot):
    rl, _ = await setup(flow, bot)
    await settings(flow, pings={"f1.new_leader": True})

    # Vorgabe „Spielserver + Querverweis“: Ping am Spielserver mit dessen Rolle, der Verweis am Hauptserver bleibt still.
    await best_time(rl["id"])
    game, ref = bot.posted
    assert (game["channel_id"], game["content"], game["mentions"]) == (RL_EVENTS, f"<@&{ROLE_RL}>", [ROLE_RL])
    assert (ref["channel_id"], ref["content"], ref["mentions"]) == (MAIN_EVENTS, None, None)

    # Beide voll: jeder Server pingt seine eigene Rolle - je Nachricht genau eine.
    await settings(flow, routing={"f1.new_leader": "both_full"})
    bot.posted.clear()
    await best_time(rl["id"])
    assert [(post["channel_id"], post["mentions"]) for post in bot.posted] == [(RL_EVENTS, [ROLE_RL]), (MAIN_EVENTS, [ROLE_MAIN])]

    # Nur Hauptserver: dort die Rolle des Hauptservers.
    await settings(flow, routing={"f1.new_leader": "main_only"})
    bot.posted.clear()
    await best_time(rl["id"])
    assert [(post["channel_id"], post["content"]) for post in bot.posted] == [(MAIN_EVENTS, f"<@&{ROLE_MAIN}>")]

    # Ein eigener Text über dem Kasten bleibt - die Erwähnung steht davor.
    bot.posted.clear()
    await best_time(rl["id"], content="Neue Bestzeit auf Mannfield!")
    assert bot.posted[0]["content"] == f"<@&{ROLE_MAIN}>\nNeue Bestzeit auf Mannfield!"


@pytest.mark.asyncio
async def test_without_the_role_or_without_a_game_the_message_goes_out_without_a_ping(flow, bot):
    rl, name = await setup(flow, bot)
    await settings(flow, pings={"f1.new_leader": True}, routing={"f1.new_leader": "game_server_only"})
    del bot.roles[(RL, name)]  # die Rolle gibt es am Spielserver nicht
    await best_time(rl["id"])
    assert [(post["channel_id"], post["content"], post["mentions"]) for post in bot.posted] == [(RL_EVENTS, None, None)]

    bot.posted.clear()
    await best_time(None)
    assert [(post["channel_id"], post["content"]) for post in bot.posted] == [(MAIN_EVENTS, None)], "ohne Spiel keine Rolle"


@pytest.mark.asyncio
async def test_an_edition_pings_the_role_of_its_main_game_also_in_the_thread_of_a_tournament(flow, bot):
    rl, name = await setup(flow, bot)
    await settings(flow, pings={"f1.new_leader": True})
    edition = {"id": "rl-sideswipe", "name": "Rocket League Sideswipe", "kind": "child", "parent_game_id": rl["id"]}
    await flow.db.games.insert_one(dict(edition))
    assert await discord_roles.ping_role_name(flow.db, {"game_id": edition["id"]}) == name
    assert await discord_roles.ping_role_name(flow.db, {"game_id": None}) is None

    # Genau an diesen Server und in diesen Thread (so schickt der Turnier-Thread): die Rolle dieses Servers.
    await best_time(edition["id"], guild_id=RL, thread_id="700000000000000009", route=False)
    assert [(post["channel_id"], post["mentions"]) for post in bot.posted] == [("700000000000000009", [ROLE_RL])]


@pytest.mark.asyncio
async def test_a_private_target_never_carries_a_mention(flow, bot):
    await setup(flow, bot)
    sent = await discord_service.send_to("board", "Neuer Antrag", "intern", content=f"<@&{ROLE_MAIN}>\nBitte ansehen", mention_role_ids=[ROLE_MAIN])
    assert sent["ok"] is True
    assert (bot.posted[0]["channel_id"], bot.posted[0]["content"], bot.posted[0]["mentions"]) == (MAIN_BOARD, "Bitte ansehen", None)
    assert discord_service.ping_enabled({"pings": {"membership.application": True}}, "membership.application") is False
