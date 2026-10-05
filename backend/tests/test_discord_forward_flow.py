"""Discord VI, D8 (#631) durch die echte Anwendung: Statistik je Server (nur Zahlen, ein Erfolgs-Zähler über alle
Server), ``/verteilen`` und das Formular im Admin (Vorschau, dann je Server eine Sendung mit Fußzeile und Log), und das
Folgen von Ankündigungskanälen in den Sammelkanal am Hauptserver - mit dem Stand, wie Discord ihn meldet."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import discord_bot, discord_distribute, discord_follow, discord_guilds, discord_stats  # noqa: E402

MAIN, RL, F1 = "500000000000000001", "500000000000000002", "500000000000000003"
MAIN_COMMUNITY, MAIN_NEWS, MAIN_COLLECT = "100000000000000001", "100000000000000002", "100000000000000009"
RL_COMMUNITY, RL_NEWS = "200000000000000001", "200000000000000002"
F1_COMMUNITY = "300000000000000001"
TOKEN = "test" * 6 + ".fake." + "token" * 8
ALL = {key: True for key, _, _ in discord_guilds.PERMISSIONS}
NOON = datetime(2026, 10, 5, 10, 0, tzinfo=timezone.utc)   # Mittag in Wien


def seen(guild_id, name, members=10):
    return {"guild_id": guild_id, "name": name, "icon_url": None, "member_count": members, "bot_permissions": dict(ALL)}


def channel(channel_id, name, *, news=False, webhooks=False):
    return {"id": channel_id, "name": name, "category": "", "position": 0, "can_send": True, "can_embed": True, "can_thread": True,
            "news": news, "can_webhooks": webhooks}


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
        self.online = True
        self.channels = {
            "": [channel(MAIN_COMMUNITY, "allgemein"), channel(MAIN_NEWS, "news"), channel(MAIN_COLLECT, "aus-den-servern", webhooks=True)],
            RL: [channel(RL_COMMUNITY, "allgemein"), channel(RL_NEWS, "ankündigungen", news=True)],
            F1: [channel(F1_COMMUNITY, "allgemein")],
        }
        self.sources: dict[str, str] = {}
        self.lookup: dict | None = None
        self.follow_result: dict | None = None
        self.followed: list[tuple[str, str]] = []

    async def send_embed(self, channel_id, embed, buttons=None, *, content=None, mention_role_ids=None):
        self.posted.append({"channel_id": channel_id, "embed": embed, "content": content, "mentions": mention_role_ids})
        return {"ok": True, "message_id": f"9000000000000000{len(self.posted):02d}", "channel_id": channel_id}

    def connected_guild_ids(self):
        return {MAIN, RL, F1} if self.online else None

    async def list_channels(self, guild_id=""):
        return {"ok": self.online, "channels": self.channels.get(str(guild_id or ""), [])}

    async def followed_sources(self, destination_channel_id):
        if not self.online:
            return {"ok": False, "reason": "bot_offline"}
        return self.lookup or {"ok": True, "sources": dict(self.sources)}

    async def follow_channel(self, source_channel_id, destination_channel_id):
        if self.follow_result:
            return self.follow_result
        self.followed.append((source_channel_id, destination_channel_id))
        self.sources[source_channel_id] = "700000000000000001"
        return {"ok": True, "webhook_id": "700000000000000001"}


@pytest.fixture
def bot(monkeypatch):
    fake = FakeBot()

    async def fake_apply():
        return True

    for name in ("send_embed", "connected_guild_ids", "list_channels", "followed_sources", "follow_channel"):
        monkeypatch.setattr(discord_bot.bot, name, getattr(fake, name))
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    return fake


async def setup(flow, bot):
    """Hauptserver mit Community und News; Rocket League eingeschaltet (nur Community); F1 eingeschaltet ohne Kanal."""
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True,
                                                              "channels": {"community": MAIN_COMMUNITY, "news": MAIN_NEWS}})
    assert response.status_code == 200, response.text
    await discord_guilds.reconcile(flow.db, [seen(MAIN, "LION", 120), seen(RL, "Rocket League", 40), seen(F1, "F1")], configured_main=MAIN)
    await discord_guilds.update_guild(flow.db, RL, {"enabled": True, "channels": {"community": RL_COMMUNITY}})
    await discord_guilds.update_guild(flow.db, F1, {"enabled": True})
    return admin


async def link(flow, user, discord_id):
    await flow.db.platform_links.insert_one({"id": f"link-{discord_id}", "platform": "discord", "external_id": discord_id, "user_id": user["id"]})


# ---------------------------------------------------------------------------------------------------- Statistik

@pytest.mark.asyncio
async def test_messages_count_per_server_and_the_achievement_counter_is_one_across_all_servers(flow, bot):
    await setup(flow, bot)
    paula = await flow.add_user(role="player", name="paula")
    await link(flow, paula, "42")
    view = {"count_messages": True}

    # Paula schreibt auf zwei Servern, ein Gast ohne Konto am Hauptserver, ein Bot irgendwo.
    assert await discord_bot.handle_message(flow.db, view, MAIN, "42", False) == paula["id"]
    assert await discord_bot.handle_message(flow.db, view, RL, "42", False) == paula["id"]
    assert await discord_bot.handle_message(flow.db, view, RL, "42", False) == paula["id"]
    assert await discord_bot.handle_message(flow.db, view, MAIN, "77", False) is None
    assert await discord_bot.handle_message(flow.db, view, MAIN, "99", True) is None

    # Ein Zähler je Person, egal wo sie schreibt - daraus zählen die Erfolge.
    assert (await flow.db.users.find_one({"id": paula["id"]}))["discord_messages_count"] == 3
    today = discord_stats.day_of()
    main_row = await flow.db.discord_guild_stats.find_one({"guild_id": MAIN, "day": today})
    rl_row = await flow.db.discord_guild_stats.find_one({"guild_id": RL, "day": today})
    assert (main_row["messages"], rl_row["messages"]) == (2, 2), "Menschen zählen, der Bot nicht"
    # Wer aktiv war, steht nur für verknüpfte Konten da - der Gast ist eine Zahl ohne Namen.
    active = [(row["guild_id"], row["user_id"]) async for row in flow.db.discord_guild_active.find({}, {"_id": 0})]
    assert sorted(active) == [(MAIN, paula["id"]), (RL, paula["id"])]
    stored = [row async for row in flow.db.discord_guild_stats.find({}, {"_id": 0})]
    assert all(set(row) <= {"guild_id", "day", "messages", "joins", "leaves"} for row in stored), "keine Person, kein Inhalt"

    # Beitritte und Austritte: nur die Zahl; Bots zählen nicht.
    await discord_bot.note_guild_member(flow.db, RL, True)
    await discord_bot.note_guild_member(flow.db, RL, True)
    await discord_bot.note_guild_member(flow.db, RL, False)
    await discord_bot.note_guild_member(flow.db, RL, True, is_bot=True)

    data = (await flow.get("/api/settings/discord/stats")).json()
    assert data["counting"] is True and [row["name"] for row in data["servers"]] == ["LION", "F1", "Rocket League"]
    by_name = {row["name"]: row for row in data["servers"]}
    assert by_name["Rocket League"]["messages"] == {"7": 2, "30": 2} and by_name["Rocket League"]["active"] == {"7": 1, "30": 1}
    assert by_name["Rocket League"]["joins"] == {"7": 2, "30": 2} and by_name["Rocket League"]["leaves"] == {"7": 1, "30": 1}
    assert by_name["LION"]["messages"]["7"] == 2 and by_name["LION"]["member_count"] == 120
    assert by_name["F1"]["messages"] == {"7": 0, "30": 0} and len(by_name["F1"]["series"]) == 30
    assert by_name["LION"]["series"][-1] == 2 and sum(by_name["LION"]["series"]) == 2
    # Über alle Server: vier Nachrichten, aber nur ein aktives Konto - Paula zählt einmal.
    assert data["total"]["messages"] == {"7": 4, "30": 4} and data["total"]["active"] == {"7": 1, "30": 1}

    # Ist „Nachrichten zählen“ aus, zählt auch die Statistik nicht.
    assert await discord_bot.handle_message(flow.db, {"count_messages": False}, MAIN, "42", False) is None
    assert (await flow.db.discord_guild_stats.find_one({"guild_id": MAIN, "day": today}))["messages"] == 2


@pytest.mark.asyncio
async def test_the_windows_count_days_and_old_activity_rows_are_removed(flow, bot):
    await setup(flow, bot)
    paula = await flow.add_user(role="player", name="paula")
    for days_ago, count in ((0, 1), (6, 2), (7, 4), (29, 8), (30, 16), (40, 32)):
        moment = NOON - timedelta(days=days_ago)
        for _ in range(count):
            await discord_stats.note_message(flow.db, MAIN, paula["id"], moment=moment)
    data = await discord_stats.overview(flow.db, now=NOON)
    lion = next(row for row in data["servers"] if row["guild_id"] == MAIN)
    assert lion["messages"] == {"7": 3, "30": 15}, "heute und sechs Tage zurück; heute und 29 Tage zurück"
    assert lion["series"][0] == 8 and lion["series"][-1] == 1 and data["days"][-1] == discord_stats.day_of(NOON)
    assert data["since"] == discord_stats.day_of(NOON - timedelta(days=40))

    # Wer wann aktiv war, bleibt nur so lange, wie die 30-Tage-Zahl es braucht; die Tageszahlen bleiben.
    assert await discord_stats.purge_old(flow.db, now=NOON) == 1
    assert await flow.db.discord_guild_active.count_documents({}) == 5
    assert await flow.db.discord_guild_stats.count_documents({}) == 6
    assert await discord_stats.purge_old(flow.db, now=NOON) == 0


# ---------------------------------------------------------------------------------------------------- Verteilen

@pytest.mark.asyncio
async def test_only_staff_may_distribute_and_the_preview_names_every_server(flow, bot):
    await setup(flow, bot)
    referee = await flow.add_user(role="tournament_admin", name="schiri")
    player = await flow.add_user(role="player", name="spieler")
    await link(flow, referee, "11")
    await link(flow, player, "12")

    assert (await discord_distribute.staff_user(flow.db, "11"))["id"] == referee["id"]
    assert await discord_distribute.staff_user(flow.db, "12") is None, "ein Spieler darf nicht"
    assert await discord_distribute.staff_user(flow.db, "13") is None, "ohne verknüpftes Konto auch nicht"
    refused = await discord_distribute.draft_from_discord(flow.db, "12", "Hallo", "community")
    assert refused == {"ok": False, "text": discord_distribute.NOT_STAFF}
    assert bot.posted == [], "die Vorschau sendet nichts"

    draft = await discord_distribute.draft_from_discord(flow.db, "11", "  Server-Wartung heute ab 20 Uhr.  ", "news", author="Schiri Sam", guild_id=RL)
    assert draft["ok"] and draft["sendable"] and draft["origin"] == "Rocket League"
    assert draft["embed"]["title"] == "Mitteilung" and draft["embed"]["description"] == "Server-Wartung heute ab 20 Uhr."
    assert draft["embed"]["footer"]["text"] == "verteilt von Schiri Sam vom Rocket League"
    rows = {row["name"]: row for row in draft["plan"]["servers"]}
    assert (rows["LION"]["target"], rows["LION"]["channel_id"], rows["LION"]["fallback"]) == ("news", MAIN_NEWS, False)
    # Rocket League hat keinen News-Kanal: dort geht es in Community - auf demselben Server. F1 hat gar keinen Kanal.
    assert (rows["Rocket League"]["target"], rows["Rocket League"]["channel_id"], rows["Rocket League"]["fallback"]) == ("community", RL_COMMUNITY, True)
    assert rows["F1"]["ready"] is False
    assert "an 2 Server" in draft["content"] and "Rocket League (dort in Community)" in draft["content"] and "Kein Kanal dafür gewählt: F1" in draft["content"]
    assert bot.posted == []

    # Leerer Text, zu langer Text, privates Ziel, unbekannter Server: ein Satz statt einer Sendung.
    for text, target, server, part in (("  ", "community", None, "Text fehlt"), ("x" * 1801, "community", None, "zu lang"),
                                       ("Hallo", "board", None, "öffentliche Kanäle"), ("Hallo", "community", "123", "gibt es nicht")):
        answer = await discord_distribute.draft_from_discord(flow.db, "11", text, target, server)
        assert answer["ok"] is False and part in answer["text"], part


@pytest.mark.asyncio
async def test_sending_posts_once_per_server_with_footer_log_and_audit(flow, bot):
    admin = await setup(flow, bot)
    result = await discord_distribute.send(flow.db, text="Server-Wartung heute ab 20 Uhr.", target="news", title="Wartung",
                                           author="Schiri Sam", origin="Rocket League", actor_id=admin["id"], via="discord")
    assert (result["ok"], result["sent"], result["failed"]) == (True, 2, 1)
    assert [(post["channel_id"], post["embed"]["title"], post["content"], post["mentions"]) for post in bot.posted] == [
        (MAIN_NEWS, "Wartung", None, None), (RL_COMMUNITY, "Wartung", None, None)], "je Server eine Sendung, niemand wird erwähnt"
    assert all(post["embed"]["footer"]["text"] == "verteilt von Schiri Sam vom Rocket League" for post in bot.posted)
    failed = next(row for row in result["servers"] if not row["ok"])
    assert failed["name"] == "F1" and failed["reason"] == "channel_missing"
    assert discord_distribute.result_text(result).startswith("Gesendet an 2 Server: LION, Rocket League.")

    # Protokoll: jede Sendung im Versand-Log mit ihrem Server, das Verteilen selbst in den Adminaktionen - ohne den Text.
    logs = [row async for row in flow.db.email_logs.find({"event_key": "staff.distribute"}, {"_id": 0})]
    assert sorted((row["guild_id"], row["status"]) for row in logs) == [(MAIN, "sent"), (RL, "sent"), (F1, "skipped")]
    audit = await flow.db.audit_logs.find_one({"action": "discord.distribute"}, {"_id": 0})
    assert audit["actor_id"] == admin["id"] and audit["data"] == {"via": "discord", "target": "news", "guild_ids": [MAIN, F1, RL], "sent": 2, "failed": 1}
    assert "Wartung" not in str(audit)

    # Nur ein Server: genau dorthin.
    bot.posted.clear()
    only = await discord_distribute.send(flow.db, text="Nur hier.", target="community", guild_ids=[RL], author="Schiri Sam")
    assert only["sent"] == 1 and [post["channel_id"] for post in bot.posted] == [RL_COMMUNITY]
    assert bot.posted[0]["embed"]["footer"]["text"] == "verteilt von Schiri Sam über die Website"


@pytest.mark.asyncio
async def test_the_admin_form_previews_first_and_sends_on_the_second_call(flow, bot):
    await setup(flow, bot)
    options = (await flow.get("/api/settings/discord/distribute")).json()
    assert [row["name"] for row in options["servers"]] == ["LION", "F1", "Rocket League"] and options["servers"][0]["main"] is True
    assert [row["key"] for row in options["targets"]] == ["community", "news", "events"] and options["max_text"] == 1800

    preview = await flow.post("/api/settings/discord/distribute", json={"text": "Hallo zusammen", "target": "community", "preview": True})
    assert preview.status_code == 200 and preview.json()["preview"] is True
    assert [(row["name"], row["ready"]) for row in preview.json()["servers"]] == [("LION", True), ("F1", False), ("Rocket League", True)]
    assert bot.posted == []

    sent = await flow.post("/api/settings/discord/distribute", json={"text": "Hallo zusammen", "target": "community", "guild_ids": [MAIN, RL]})
    assert sent.status_code == 200 and sent.json()["sent"] == 2 and len(bot.posted) == 2
    assert bot.posted[0]["embed"]["footer"]["text"] == "verteilt von admin über die Website"

    assert (await flow.post("/api/settings/discord/distribute", json={"text": "", "target": "community"})).status_code == 400
    assert (await flow.post("/api/settings/discord/distribute", json={"text": "Hallo", "target": "ops"})).status_code == 400
    flow.act_as(await flow.add_user(role="player", name="spieler"))
    assert (await flow.post("/api/settings/discord/distribute", json={"text": "Hallo", "target": "community"})).status_code in (401, 403)
    assert (await flow.get("/api/settings/discord/stats")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_the_confirm_buttons_send_once():
    sent = []

    async def on_send():
        sent.append(1)
        return "Gesendet."

    view = discord_bot.confirm_view(on_send)
    assert [(item.label, item.disabled) for item in view.children] == [("Senden", False), ("Abbrechen", False)]

    class Response:
        def __init__(self):
            self.edits = []

        async def edit_message(self, **kwargs):
            self.edits.append(kwargs)

        async def defer(self):
            self.edits.append("defer")

    class Interaction:
        def __init__(self):
            self.response = Response()
            self.final = None

        async def edit_original_response(self, **kwargs):
            self.final = kwargs

    first, second = Interaction(), Interaction()
    await view.children[0].callback(first)
    await view.children[0].callback(second)
    assert sent == [1], "ein zweiter Klick sendet nicht noch einmal"
    assert first.response.edits == [{"content": "Wird gesendet …", "view": None}] and first.final == {"content": "Gesendet."}
    assert second.response.edits == ["defer"]


# ---------------------------------------------------------------------------------------------------- Folgen

@pytest.mark.asyncio
async def test_following_an_announcement_channel_into_the_collector(flow, bot):
    await setup(flow, bot)
    start = (await flow.get("/api/settings/discord/forward")).json()
    assert start["collector"]["channel_id"] == "" and [row["name"] for row in start["servers"]] == ["F1", "Rocket League"], "nur Unterserver"
    assert {row["state"] for row in start["servers"]} == {"no_collector"}
    assert (await flow.post(f"/api/settings/discord/forward/{RL}", json={"source_channel_id": RL_NEWS})).status_code == 400, "erst der Sammelkanal"

    chosen = await flow.put("/api/settings/discord/forward", json={"channel_id": MAIN_COLLECT})
    assert chosen.status_code == 200 and chosen.json()["collector"] == {"channel_id": MAIN_COLLECT, "name": "aus-den-servern", "can_webhooks": True}
    rows = {row["name"]: row for row in chosen.json()["servers"]}
    assert rows["Rocket League"]["state"] == "ready" and rows["Rocket League"]["can_setup"] is True
    assert [entry["name"] for entry in rows["Rocket League"]["news_channels"]] == ["ankündigungen"]
    assert rows["F1"]["state"] == "no_news_channel" and "Ankündigungskanal" in rows["F1"]["text"] and rows["F1"]["can_setup"] is False
    assert (await flow.put("/api/settings/discord/forward", json={"channel_id": "kein Kanal"})).status_code == 400

    # Nur ein Ankündigungskanal dieses Servers lässt sich folgen; der Hauptserver ist das Ziel, nie die Quelle.
    assert (await flow.post(f"/api/settings/discord/forward/{RL}", json={"source_channel_id": RL_COMMUNITY})).status_code == 400
    assert (await flow.post(f"/api/settings/discord/forward/{MAIN}", json={"source_channel_id": MAIN_NEWS})).status_code == 400
    assert (await flow.post("/api/settings/discord/forward/123", json={"source_channel_id": RL_NEWS})).status_code == 404
    assert bot.followed == []

    done = await flow.post(f"/api/settings/discord/forward/{RL}", json={"source_channel_id": RL_NEWS})
    assert done.status_code == 200 and done.json()["ok"] is True and bot.followed == [(RL_NEWS, MAIN_COLLECT)]
    stored = (await flow.db.discord_guilds.find_one({"guild_id": RL}))["forward"]
    assert stored["source_channel_id"] == RL_NEWS and stored["webhook_id"] == "700000000000000001"
    after = {row["name"]: row for row in (await flow.get("/api/settings/discord/forward")).json()["servers"]}
    assert after["Rocket League"]["state"] == "followed" and after["Rocket League"]["source_channel_id"] == RL_NEWS and after["Rocket League"]["can_setup"] is False
    assert await flow.db.audit_logs.count_documents({"action": "settings.discord.forward.follow"}) == 1


@pytest.mark.asyncio
async def test_the_state_comes_from_discord_and_a_missing_right_is_named(flow, bot):
    await setup(flow, bot)
    await discord_follow.set_collector(flow.db, MAIN_COLLECT)

    # Jemand ist von Hand gefolgt: Discord meldet den Webhook - das gilt als eingerichtet, ohne dass die Website es wusste.
    bot.sources = {RL_NEWS: "700000000000000002"}
    by_hand = {row["name"]: row for row in (await discord_follow.overview(flow.db))["servers"]}
    assert by_hand["Rocket League"]["state"] == "followed"

    # Ohne „Webhooks verwalten“ kann der Bot weder nachsehen noch einrichten - der Satz nennt das Recht und den Weg von Hand.
    bot.lookup = {"ok": False, "reason": "forbidden"}
    blind = {row["name"]: row for row in (await discord_follow.overview(flow.db))["servers"]}
    assert blind["Rocket League"]["state"] == "no_webhook_right" and "Webhooks verwalten" in blind["Rocket League"]["text"] and "Von Hand" in blind["Rocket League"]["text"]
    bot.lookup, bot.sources = None, {}
    bot.follow_result = {"ok": False, "reason": "forbidden"}
    refused = await discord_follow.setup(flow.db, RL, RL_NEWS)
    assert refused["ok"] is False and "Webhooks verwalten" in refused["error"]
    assert "forward" not in (await flow.db.discord_guilds.find_one({"guild_id": RL})), "ohne Erfolg wird nichts gemerkt"

    # Bot offline: kein Raten - der Stand kommt, sobald er wieder da ist.
    bot.online = False
    offline = await discord_follow.overview(flow.db)
    assert offline["online"] is False and {row["state"] for row in offline["servers"]} == {"offline"}
