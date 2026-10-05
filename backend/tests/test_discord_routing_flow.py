"""Versand-Routing (#627, Discord VI) durch die echte Anwendung: vier Regeln je Ereignis, Spielserver an/aus,
Ereignis mit und ohne Spiel; der Querverweis trägt nie den vollen Inhalt; scheitert der Spielserver, bekommt der
Hauptserver die volle Meldung; Turnier-Threads je Server; das Versand-Log zeigt und filtert den Server."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import discord_service  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import discord_bot, discord_guilds, discord_routing, discord_threads  # noqa: E402

MAIN, RL = "500000000000000001", "500000000000000002"
MAIN_COMMUNITY, MAIN_EVENTS, MAIN_BOARD = "100000000000000001", "100000000000000003", "100000000000000004"
RL_COMMUNITY, RL_EVENTS = "200000000000000001", "200000000000000003"
TOKEN = "test" * 6 + ".fake." + "token" * 8
ALL = {key: True for key, _, _ in discord_guilds.PERMISSIONS}
LONG = "Alle Infos zur Challenge: Strecke, Wetter, Fahrzeug und Regeln. " * 8


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
        self.threads: list[dict] = []
        self.fail: dict[str, str] = {}

    async def send_embed(self, channel_id, embed, buttons=None):
        if channel_id in self.fail:
            return {"ok": False, "reason": self.fail[channel_id]}
        self.posted.append({"channel_id": channel_id, "embed": embed, "buttons": buttons or []})
        return {"ok": True, "message_id": f"9000000000000000{len(self.posted):02d}", "channel_id": channel_id}

    async def create_thread(self, channel_id, message_id, name):
        thread_id = f"7{len(self.threads) + 1:02d}{channel_id[3:]}"
        self.threads.append({"channel_id": channel_id, "message_id": message_id, "thread_id": thread_id})
        return {"ok": True, "thread_id": thread_id}


@pytest.fixture
def bot(monkeypatch):
    fake = FakeBot()

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "send_embed", fake.send_embed)
    monkeypatch.setattr(discord_bot.bot, "create_thread", fake.create_thread)
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    return fake


def is_crossref(post):
    return str((post["embed"].get("footer") or {}).get("text") or "").startswith("aus dem ")


async def setup(flow):
    db = flow.db
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, "events": {"f1.new_leader": True},
                                                              "channels": {"community": MAIN_COMMUNITY, "events": MAIN_EVENTS, "board": MAIN_BOARD}})
    assert response.status_code == 200, response.text
    await discord_guilds.reconcile(db, [seen(MAIN, "LION"), seen(RL, "Rocket League")], configured_main=MAIN)
    await discord_guilds.update_guild(db, RL, {"enabled": True, "invite_url": "https://discord.gg/rocket",
                                              "channels": {"community": RL_COMMUNITY, "events": RL_EVENTS}})
    rl = (await flow.post("/api/games", json={"name": "Rocket League", "discord_guild_id": RL})).json()
    chess = (await flow.post("/api/games", json={"name": "Schach"})).json()
    return admin, rl, chess


async def set_rule(flow, rule, key="f1.new_leader"):
    response = await flow.put("/api/settings/discord", json={"routing": {key: rule}})
    assert response.status_code == 200, response.text


async def challenge(item_game):
    return await discord_service.send_event("f1.new_leader", "Neue Bestzeit", LONG, item={"game_id": item_game, "visibility": "public"},
                                            url="/fastlap/rl", fields=[{"name": "Zeit", "value": "1:02.345"}], image_url="https://example.test/bild.png",
                                            buttons=[{"label": "Zur Challenge", "url": "/fastlap/rl"}])


@pytest.mark.asyncio
async def test_routing_matrix_rule_by_game_server_by_game(flow, bot):
    _, rl, chess = await setup(flow)
    expectations = {
        "game_server_plus_crossref": [(RL_EVENTS, False), (MAIN_EVENTS, True)],
        "both_full": [(RL_EVENTS, False), (MAIN_EVENTS, False)],
        "game_server_only": [(RL_EVENTS, False)],
        "main_only": [(MAIN_EVENTS, False)],
    }
    for rule, wanted in expectations.items():
        await set_rule(flow, rule)
        bot.posted.clear()
        result = await challenge(rl["id"])
        assert [(post["channel_id"], is_crossref(post)) for post in bot.posted] == wanted, rule
        assert result["ok"] is True
        # Ohne Spiel: immer voll an den Hauptserver.
        bot.posted.clear()
        await challenge(chess["id"])
        assert [(post["channel_id"], is_crossref(post)) for post in bot.posted] == [(MAIN_EVENTS, False)], f"{rule} ohne Spielserver"
        bot.posted.clear()
        await challenge(None)
        assert [(post["channel_id"], is_crossref(post)) for post in bot.posted] == [(MAIN_EVENTS, False)], f"{rule} ohne Spiel"

    # Spielserver aus: voll an den Hauptserver - bei jeder Regel (Server → Server, gleiche Sichtbarkeit).
    await discord_guilds.update_guild(flow.db, RL, {"enabled": False})
    for rule in discord_routing.RULES:
        await set_rule(flow, rule)
        bot.posted.clear()
        await challenge(rl["id"])
        assert [(post["channel_id"], is_crossref(post)) for post in bot.posted] == [(MAIN_EVENTS, False)], f"{rule} bei ausgeschaltetem Spielserver"

    # Spielserver an, aber ohne Kanal: ebenso.
    await discord_guilds.update_guild(flow.db, RL, {"enabled": True, "channels": {"community": "", "events": ""}})
    await set_rule(flow, "game_server_only")
    bot.posted.clear()
    await challenge(rl["id"])
    assert [post["channel_id"] for post in bot.posted] == [MAIN_EVENTS]

    # Privates bleibt am Hauptserver - auch mit Spiel am Inhalt.
    bot.posted.clear()
    await flow.put("/api/settings/discord", json={"events": {"membership.application": True}})
    await discord_service.send_event("membership.application", "Antrag", item={"game_id": rl["id"]})
    assert [post["channel_id"] for post in bot.posted] == [MAIN_BOARD]


@pytest.mark.asyncio
async def test_the_crossref_never_carries_the_full_content(flow, bot):
    _, rl, _ = await setup(flow)
    await challenge(rl["id"])
    full, ref = bot.posted
    assert full["embed"]["description"].startswith("Alle Infos") and full["embed"]["fields"] and full["embed"].get("image")
    embed = ref["embed"]
    assert embed["title"] == "Neue Bestzeit"
    assert "fields" not in embed and "image" not in embed, "nie Felder oder Bild"
    assert len(embed["description"]) <= discord_routing.CROSSREF_TEXT_MAX and "Alle Infos" not in embed["description"]
    assert embed["description"] == "Alles dazu steht auf unserem Discord-Server „Rocket League“."
    assert embed["footer"]["text"] == "aus dem Rocket League-Server"
    link = f"https://discord.com/channels/{RL}/{RL_EVENTS}/900000000000000001"
    assert ref["buttons"] == [{"label": "Zum Server „Rocket League“", "url": link}, {"label": "Beitreten", "url": "https://discord.gg/rocket"}]

    logs = {log["channel_id"]: log async for log in flow.db.email_logs.find({"event_key": "f1.new_leader"}, {"_id": 0})}
    assert logs[RL_EVENTS]["guild_id"] == RL and not logs[RL_EVENTS].get("crossref")
    assert logs[MAIN_EVENTS]["guild_id"] == MAIN and logs[MAIN_EVENTS]["crossref"] is True and logs[MAIN_EVENTS]["crossref_guild_id"] == RL

    # Ohne Einladung: nur der Nachrichtenlink. Scheitert der Spielserver: voll an den Hauptserver statt ins Leere.
    await discord_guilds.update_guild(flow.db, RL, {"invite_url": ""})
    bot.posted.clear()
    await challenge(rl["id"])
    assert [button["label"] for button in bot.posted[1]["buttons"]] == ["Zum Server „Rocket League“"]
    bot.posted.clear()
    bot.fail[RL_EVENTS] = "forbidden"
    result = await challenge(rl["id"])
    assert [(post["channel_id"], is_crossref(post)) for post in bot.posted] == [(MAIN_EVENTS, False)]
    assert result["ok"] is True and result["channel_id"] == MAIN_EVENTS
    await set_rule(flow, "game_server_only")
    bot.posted.clear()
    assert (await challenge(rl["id"]))["ok"] is False and bot.posted == [], "„nur Spielserver“ heißt: kein Ersatz am Hauptserver"


@pytest.mark.asyncio
async def test_rules_in_the_settings_with_preview_and_guard_rails(flow, bot):
    await setup(flow)
    events = {entry["key"]: entry for entry in (await flow.get("/api/settings/discord")).json()["events"]}
    assert events["tournament.live"]["routable"] is True and events["tournament.live"]["routing"] == "game_server_plus_crossref"
    assert events["tournament.live"]["routing_preview"] == "geht an: Rocket League (Events und Turniere), Hauptserver (Querverweis)"
    assert events["membership.application"]["routable"] is False and events["membership.application"]["routing"] == "main_only"
    assert events["news.members"]["routable"] is False, "Mitglieder ist privat"

    bad = await flow.put("/api/settings/discord", json={"routing": {"membership.application": "both_full"}})
    assert bad.status_code == 400 and "Hauptserver" in bad.json()["detail"]
    assert (await flow.put("/api/settings/discord", json={"routing": {"tournament.live": "irgendwo"}})).status_code == 400
    assert (await flow.put("/api/settings/discord", json={"routing": {"gibt.es.nicht": "main_only"}})).status_code == 400
    await set_rule(flow, "both_full", "tournament.live")
    live = next(entry for entry in (await flow.get("/api/settings/discord")).json()["events"] if entry["key"] == "tournament.live")
    assert live["routing"] == "both_full" and live["routing_preview"] == "geht an: Rocket League (Events und Turniere), Hauptserver (Events und Turniere)"
    audit = await flow.db.audit_logs.find_one({"action": "settings.discord.update"}, {"_id": 0}, sort=[("created_at", -1)])
    assert audit is None or "routing.tournament__live" in str(audit)


@pytest.mark.asyncio
async def test_tournament_threads_per_server_and_crossrefs_in_the_main_thread(flow, bot):
    db = flow.db
    _, rl, _ = await setup(flow)
    tournament = {"id": "t-1", "slug": "rl-cup", "title": "RL Cup", "game_id": rl["id"], "visibility": "public", "is_public": True, "status": "draft"}
    await db.tournaments.insert_one(dict(tournament))

    await discord_threads.status_changed(db, tournament, "draft", "registration_open")
    assert [(post["channel_id"], is_crossref(post)) for post in bot.posted] == [(RL_EVENTS, False), (MAIN_EVENTS, True)]
    assert [thread["channel_id"] for thread in bot.threads] == [RL_EVENTS, MAIN_EVENTS], "je Server ein Thread"
    saved = await db.tournaments.find_one({"id": "t-1"}, {"_id": 0})
    rl_thread = saved["discord_thread_by_guild"][RL]["thread_id"]
    main_thread = saved["discord_thread"]["thread_id"]
    assert rl_thread != main_thread

    bot.posted.clear()
    await discord_threads.status_changed(db, {**saved, "status": "registration_open"}, "registration_open", "check_in")
    assert [(post["channel_id"], is_crossref(post)) for post in bot.posted] == [(rl_thread, False), (main_thread, True)], "weiter in den Threads"
    saved = await db.tournaments.find_one({"id": "t-1"}, {"_id": 0})
    assert saved["discord_thread_by_guild"][RL]["last_message_id"] and saved["discord_thread"]["last_message_id"]
    assert len(bot.threads) == 2

    # „nur Hauptserver“: wie vor Discord VI - ein Thread am Hauptserver.
    await set_rule(flow, "main_only", "tournament.check_in")
    bot.posted.clear()
    await discord_threads.status_changed(db, {**saved, "status": "registration_open"}, "registration_open", "check_in")
    assert [post["channel_id"] for post in bot.posted] == [main_thread]
    # Ein abgeschaltetes Ereignis erzeugt auch keinen Querverweis.
    await flow.put("/api/settings/discord", json={"events": {"tournament.check_in": False}})
    bot.posted.clear()
    assert (await discord_threads.status_changed(db, {**saved, "status": "registration_open"}, "registration_open", "check_in"))["reason"] == "event_disabled"
    assert bot.posted == []


@pytest.mark.asyncio
async def test_the_log_shows_and_filters_the_server(flow, bot):
    _, rl, chess = await setup(flow)
    await challenge(rl["id"])
    await challenge(chess["id"])
    bot.fail[RL_EVENTS] = "forbidden"
    await set_rule(flow, "game_server_only")
    await challenge(rl["id"])

    everything = (await flow.get("/api/admin/ops/events", params={"source": "email"})).json()
    assert {(row["guild_id"], row["subtitle"]) for row in everything["items"] if row["title"] == "f1.new_leader"} == {
        (RL, "discord · Rocket League"), (MAIN, "discord · LION (Hauptserver) · Querverweis"), (MAIN, "discord · LION (Hauptserver)")}
    assert [entry["name"] for entry in everything["guilds"]] == ["LION (Hauptserver)", "Rocket League"]
    only_rl = (await flow.get("/api/admin/ops/events", params={"source": "email", "guild": RL})).json()["items"]
    assert len(only_rl) == 2 and all(row["guild_id"] == RL for row in only_rl)

    # „Kanäle je Zweck“ zeigt nur den Hauptserver - ein Fehler am Spielserver färbt ihn nicht.
    status = await discord_service.target_status(flow.db)
    assert status["events"]["last"]["status"] == "sent"
    assert not [entry for entry in await discord_service.broken_targets(flow.db) if entry.get("target") == "events"]
