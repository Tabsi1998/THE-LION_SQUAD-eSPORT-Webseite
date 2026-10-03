"""Spiel → Discord-Server (#626, Discord VI) durch die echte Anwendung: Vererbung Kind → Hauptspiel → Hauptserver,
ausgeschaltete Server nirgends öffentlich, „du bist dabei“ nur für die eigene Person (fünf Minuten gemerkt, Beitritt
und Austritt sofort), der Zähler für „Überall dabei“ und die Direktnachricht mit passenden Servern nach dem Verknüpfen."""
import pathlib
import sys
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import achievement_counters, discord_bot, discord_guilds, platform_links  # noqa: E402

MAIN, RL, FC, OFF, GONE = "500000000000000001", "500000000000000002", "500000000000000003", "500000000000000004", "500000000000000005"
TOKEN = "test" * 6 + ".fake." + "token" * 8
ALL = {key: True for key, _, _ in discord_guilds.PERMISSIONS}
PAULA_DISCORD, OTTO_DISCORD = "123456789012345678", "223456789012345678"


def seen(guild_id, name, members=10):
    return {"guild_id": guild_id, "name": name, "icon_url": None, "member_count": members, "bot_permissions": dict(ALL)}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


class FakeBot:
    """Antwortet wie der Bot: wer auf welchem Server ist, und welche Direktnachrichten hinausgingen."""

    def __init__(self):
        self.members: dict[tuple[str, str], bool] = {}
        self.asked: list[tuple[tuple[str, ...], str]] = []
        self.dms: list[dict] = []
        self.online = True

    async def member_status(self, guild_ids, discord_id):
        self.asked.append((tuple(guild_ids), discord_id))
        if not self.online:
            return {guild_id: None for guild_id in guild_ids}
        return {guild_id: self.members.get((guild_id, discord_id), False) for guild_id in guild_ids}

    async def send_dm(self, discord_id, embed, buttons=None):
        self.dms.append({"to": discord_id, "embed": embed, "buttons": buttons or []})
        return {"ok": True, "message_id": f"dm{len(self.dms)}"}


@pytest.fixture
def bot(monkeypatch):
    fake = FakeBot()

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "member_status", fake.member_status)
    monkeypatch.setattr(discord_bot.bot, "send_dm", fake.send_dm)
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    return fake


async def game(flow, name, **fields):
    response = await flow.post("/api/games", json={"name": name, **fields})
    assert response.status_code == 200, response.text
    return response.json()


async def setup(flow):
    """Hauptserver LION, eingeschaltete Unterserver Rocket League und EA FC, ein ausgeschalteter, ein verlassener."""
    db = flow.db
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    assert (await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True})).status_code == 200
    await db.settings.update_one({"id": "branding"}, {"$set": {"discord_invite_url": "https://discord.gg/lion"}}, upsert=True)
    await discord_guilds.reconcile(db, [seen(MAIN, "LION", 120), seen(RL, "Rocket League", 40), seen(FC, "EA FC", 30), seen(OFF, "Alt"), seen(GONE, "Weg")], configured_main=MAIN)
    await discord_guilds.reconcile(db, [seen(MAIN, "LION", 120), seen(RL, "Rocket League", 40), seen(FC, "EA FC", 30), seen(OFF, "Alt")])
    await discord_guilds.update_guild(db, RL, {"enabled": True, "invite_url": "https://discord.gg/rocket"})
    await discord_guilds.update_guild(db, FC, {"enabled": True, "invite_url": "https://discord.gg/eafc"})
    await discord_guilds.update_guild(db, OFF, {"invite_url": "https://discord.gg/alt"})
    rl = await game(flow, "Rocket League", discord_guild_id=RL)
    fc = await game(flow, "EA FC", kind="series", discord_guild_id=FC)
    fc26 = await game(flow, "EA FC 26", kind="edition", parent_game_id=fc["id"])
    rl_off = await game(flow, "RL Classic", kind="edition", parent_game_id=rl["id"], discord_guild_id=OFF)
    chess = await game(flow, "Schach")
    tetris = await game(flow, "Tetris", discord_guild_id=OFF)
    return admin, {"rl": rl, "fc": fc, "fc26": fc26, "rl_off": rl_off, "chess": chess, "tetris": tetris}


async def person(flow, name, discord_id=None, **fields):
    user = await flow.add_user(name=name)
    if fields:
        await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    if discord_id:
        await flow.db.platform_links.insert_one({"id": f"link-{name}", "user_id": user["id"], "platform": "discord", "external_id": discord_id, "handle": name})
    return user


@pytest.mark.asyncio
async def test_a_game_finds_its_server_child_parent_main_and_never_a_switched_off_one(flow, bot):
    _, games = await setup(flow)
    db = flow.db

    async def resolved(key):
        row = await discord_guilds.guild_for_game(db, await db.games.find_one({"id": games[key]["id"]}, {"_id": 0}))
        return row["guild_id"], row["inherited_from"]

    assert await resolved("rl") == (RL, None), "eigenes Feld"
    assert await resolved("fc26") == (FC, games["fc"]["id"]), "Kind ohne Feld → Server des Hauptspiels"
    assert await resolved("chess") == (MAIN, "main"), "ohne alles → Hauptserver"
    assert await resolved("rl_off") == (RL, games["rl"]["id"]), "eigener Server aus → der des Hauptspiels"
    assert await resolved("tetris") == (MAIN, "main"), "eigener Server aus, kein Hauptspiel → Hauptserver"
    await discord_guilds.update_guild(db, FC, {"enabled": False})
    assert await resolved("fc26") == (MAIN, "main"), "Server des Hauptspiels aus → Hauptserver"

    # Das Formular: nur Server aus dem Verzeichnis, nie ein verlassener; leer heißt erben.
    unknown = await flow.patch(f"/api/games/{games['chess']['id']}", json={"discord_guild_id": "999999999999999999"})
    assert unknown.status_code == 404 and "kennt die Website nicht" in unknown.json()["detail"]
    gone = await flow.patch(f"/api/games/{games['chess']['id']}", json={"discord_guild_id": GONE})
    assert gone.status_code == 400 and "nicht mehr" in gone.json()["detail"]
    assert (await flow.post("/api/games", json={"name": "Neu", "discord_guild_id": "123"})).status_code == 404
    # Verlässt der Bot den Server später, blockiert das kein anderes Speichern.
    await db.games.update_one({"id": games["tetris"]["id"]}, {"$set": {"discord_guild_id": GONE}})
    assert (await flow.patch(f"/api/games/{games['tetris']['id']}", json={"genre": "Puzzle", "discord_guild_id": GONE})).status_code == 200
    await db.games.update_one({"id": games["tetris"]["id"]}, {"$set": {"discord_guild_id": OFF}})
    # Die Auswahl im Formular - auch für die Turnierleitung ohne Zugriff auf die Einstellungen.
    choices = {row["guild_id"]: row for row in (await flow.get("/api/games/discord-servers")).json()}
    assert choices[MAIN]["role"] == "main" and choices[OFF]["enabled"] is False and choices[GONE]["left"] is True
    cleared = await flow.patch(f"/api/games/{games['rl']['id']}", json={"discord_guild_id": ""})
    assert cleared.status_code == 200 and cleared.json()["discord_guild_id"] is None
    assert await resolved("rl") == (MAIN, "main")

    # Umgekehrte Sicht im Server-Reiter: eigene zuerst, geerbte (Editionen) danach.
    await flow.patch(f"/api/games/{games['rl']['id']}", json={"discord_guild_id": RL})
    listing = {row["guild_id"]: row for row in (await flow.get("/api/settings/discord/guilds")).json()["guilds"]}
    assert [(entry["name"], entry["inherited"]) for entry in listing[FC]["games"]] == [("EA FC", False), ("EA FC 26", True)]
    assert [entry["name"] for entry in listing[OFF]["games"]] == ["RL Classic", "Tetris"], "auch am ausgeschalteten Server sichtbar - nur im Admin"
    assert listing[MAIN]["games"] == [], "der Hauptserver zählt nur ausdrücklich zugeordnete Spiele"


@pytest.mark.asyncio
async def test_the_game_tile_is_public_but_never_shows_a_switched_off_server(flow, bot):
    _, games = await setup(flow)
    flow.act_as(None)
    rl = (await flow.get(f"/api/games/{games['rl']['slug']}/discord")).json()
    assert rl == {"available": True, "guild_id": RL, "name": "Rocket League", "icon_url": None, "member_count": 40,
                  "invite_url": "https://discord.gg/rocket", "main": False, "for_game": True}, "ohne Anmeldung kein Status"
    chess = (await flow.get(f"/api/games/{games['chess']['id']}/discord")).json()
    assert chess["guild_id"] == MAIN and chess["main"] is True and chess["for_game"] is False
    assert chess["invite_url"] == "https://discord.gg/lion", "der Hauptserver nimmt die Einladung aus Footer und Kontaktseite"
    tetris = (await flow.get(f"/api/games/{games['tetris']['slug']}/discord")).json()
    assert tetris["guild_id"] == MAIN and "discord.gg/alt" not in str(tetris), "ein ausgeschalteter Server erscheint nie"
    assert (await flow.get("/api/games/gibtsnicht/discord")).status_code == 404

    # Spielkarten unter „Über uns“: nur eigene Server - der Hauptserver steht schon im Footer.
    about = {row["name"]: row for row in (await flow.get("/api/home/about")).json()["games"]}
    assert about["Rocket League"]["discord"]["invite_url"] == "https://discord.gg/rocket"
    assert about["EA FC"]["discord"]["name"] == "EA FC"
    assert about["Schach"]["discord"] is None and about["Tetris"]["discord"] is None
    assert "discord.gg/alt" not in str(about)


@pytest.mark.asyncio
async def test_you_are_in_only_for_yourself_remembered_five_minutes_unknown_when_offline(flow, bot):
    _, games = await setup(flow)
    db = flow.db
    paula = await person(flow, "paula", PAULA_DISCORD)
    otto = await person(flow, "otto")
    bot.members[(RL, PAULA_DISCORD)] = True

    flow.act_as(paula)
    tile = (await flow.get(f"/api/games/{games['rl']['slug']}/discord")).json()
    assert tile["linked"] is True and tile["member"] is True
    assert (await flow.get(f"/api/games/{games['rl']['slug']}/discord")).json()["member"] is True
    assert len(bot.asked) == 1, "fünf Minuten gemerkt - der Bot fragt nicht noch einmal"

    area = (await flow.get("/api/membership/discord-servers")).json()
    assert area["linked"] is True
    assert [(row["guild_id"], row["member"]) for row in area["servers"]] == [(MAIN, False), (FC, False), (RL, True)], "nur eingeschaltete, Hauptserver zuerst"
    assert bot.asked[-1] == ((MAIN, FC), PAULA_DISCORD), "nur die nicht gemerkten"

    # Privatsphäre: nie der Status einer anderen Person - auch nicht mit einer Kennung in der Adresse.
    await db.discord_memberships.insert_one({"user_id": otto["id"], "guild_id": FC, "member": True, "checked_at": now_utc().isoformat()})
    flow.act_as(otto)
    asked = len(bot.asked)
    mine = (await flow.get(f"/api/membership/discord-servers?user_id={paula['id']}")).json()
    assert mine["linked"] is False and all(row["member"] is None for row in mine["servers"]), "ohne Verknüpfung nur die Einladungen"
    assert all(row["invite_url"] for row in mine["servers"])
    assert len(bot.asked) == asked, "ohne Verknüpfung fragt der Bot gar nicht"
    tile = (await flow.get(f"/api/games/{games['fc']['slug']}/discord")).json()
    assert tile["linked"] is False and tile["member"] is None
    flow.act_as(None)
    assert (await flow.get("/api/membership/discord-servers")).status_code == 401

    # Bot offline: unbekannt, nicht „nein“ - und nichts gemerkt.
    bot.online = False
    later = now_utc() + timedelta(minutes=6)
    status = await discord_guilds.own_status(db, paula["id"], [RL, FC], now=later)
    assert status == {"linked": True, "statuses": {RL: None, FC: None}}
    assert (await db.discord_memberships.find_one({"user_id": paula["id"], "guild_id": RL}))["member"] is True, "der letzte bekannte Stand bleibt"


@pytest.mark.asyncio
async def test_joining_and_leaving_counts_for_everywhere_at_once(flow, bot):
    await setup(flow)
    db = flow.db
    paula = await person(flow, "paula", PAULA_DISCORD)
    joined = achievement_counters.REGISTRY["discord_guilds_joined"]
    assert "discord" in joined.sources

    async def count():
        return await joined.compute(achievement_counters.Context(db, paula["id"]))

    assert await count() == 0
    assert await discord_guilds.note_membership(db, RL, PAULA_DISCORD, True) == paula["id"]
    assert await discord_guilds.note_membership(db, MAIN, PAULA_DISCORD, True) == paula["id"]
    assert await discord_guilds.note_membership(db, OFF, PAULA_DISCORD, True) == paula["id"]
    assert await count() == 2, "ein ausgeschalteter Server zählt nicht"
    assert await db.achievement_eval_queue.count_documents({"user_id": paula["id"]}) == 1, "der Zähler rechnet sofort neu"
    await discord_guilds.note_membership(db, RL, PAULA_DISCORD, False)
    assert await count() == 1
    assert await discord_guilds.note_membership(db, RL, OTTO_DISCORD, True) is None, "nicht verknüpft: nichts gemerkt"
    assert await db.discord_memberships.count_documents({"guild_id": RL, "member": True}) == 0


@pytest.mark.asyncio
async def test_linking_discord_sends_matching_servers_once_and_only_as_a_dm(flow, bot, monkeypatch):
    _, games = await setup(flow)
    db = flow.db
    paula = await person(flow, "paula", favorite_games=["rocket league"])
    await db.tournaments.insert_one({"id": "t-fc", "game_id": games["fc26"]["id"], "title": "Cup"})
    await db.tournament_registrations.insert_one({"id": "r-1", "tournament_id": "t-fc", "user_id": paula["id"]})

    # Über den echten Rückruf: Verknüpfen löst die Direktnachricht im Hintergrund aus.
    monkeypatch.setattr(platform_links, "read_state_payload", lambda state, platform: {"sub": paula["id"]})

    async def identity(platform, branding, query, state_payload=None, db=None):
        return {"external_id": PAULA_DISCORD, "handle": "paula", "display_name": "Paula"}

    monkeypatch.setattr(platform_links, "fetch_identity", identity)
    flow.act_as(None)
    response = await flow.get("/api/platform-links/discord/callback?code=gut&state=x")
    assert response.status_code == 302 and parse_qs(urlparse(response.headers["location"]).query).get("linked") == ["discord"]
    assert len(bot.dms) == 1 and bot.dms[0]["to"] == PAULA_DISCORD
    text = bot.dms[0]["embed"]["description"]
    assert "**Rocket League** – für Rocket League" in text and "**EA FC** – für" in text and "EA FC 26" in text
    assert "LION" not in text, "der Hauptserver ist kein Vorschlag"
    assert [button["url"] for button in bot.dms[0]["buttons"]] == ["https://discord.gg/rocket", "https://discord.gg/eafc"]

    log = await db.email_logs.find_one({"event_key": "discord.servers_for_games"}, {"_id": 0})
    assert log["target"] == "dm" and log["status"] == "sent" and log["user_id"] == paula["id"] and "payload" not in log
    admin = await db.users.find_one({"role": "superadmin"}, {"_id": 0})
    flow.act_as(admin)
    assert (await flow.post(f"/api/settings/discord/resend/{log['id']}")).status_code == 404, "eine Direktnachricht geht nie in einen Kanal"

    # Einmal je Discord-Konto - erneut verknüpfen schickt nichts doppelt.
    assert (await discord_guilds.greet_linked(db, paula["id"], PAULA_DISCORD))["reason"] == "already_greeted"
    assert len(bot.dms) == 1

    # Nichts passt: keine Nachricht, kein Log. Bot aus: im Log als übersprungen.
    otto = await person(flow, "otto")
    assert (await discord_guilds.greet_linked(db, otto["id"], OTTO_DISCORD))["reason"] == "nothing_to_suggest"
    await db.users.update_one({"id": otto["id"]}, {"$set": {"favorite_games": ["EA FC"]}})
    await db.settings.update_one({"id": "discord"}, {"$set": {"bot_enabled": False}})
    assert (await discord_guilds.greet_linked(db, otto["id"], OTTO_DISCORD))["reason"] == "bot_off"
    assert len(bot.dms) == 1
    skipped = await db.email_logs.find_one({"user_id": otto["id"]}, {"_id": 0})
    assert skipped["status"] == "skipped" and skipped["reason"] == "bot_off"
