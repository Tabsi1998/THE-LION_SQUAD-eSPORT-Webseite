"""Live-Einbettungen (#569): Rechnung der Einbettungen, eine Nachricht je Einbettung (posten +
pinnen, dann bearbeiten), gleicher Inhalt = keine Bearbeitung, neu nach Löschung, Bremse eine Minute,
Einstellungen mit Kanalwahl und „Jetzt aktualisieren“ - alles mit nachgestelltem Bot. Seit #883: „Live jetzt“
gibt es nicht mehr (einmal aufgeräumt), und eine stehende Einbettung sagt, warum."""
import json
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_bot, discord_embeds, discord_guilds  # noqa: E402

CHANNEL = "100000000000000011"
TOKEN = "test" * 6 + ".fake." + "token" * 8


class FakeBot:
    def __init__(self):
        self.sent: list[dict] = []
        self.edited: list[dict] = []
        self.pinned: list[str] = []
        self.deleted: set[str] = set()
        self.delete_calls: list[tuple[str, str]] = []
        self.delete_result: dict = {"ok": True}
        self.counter = 0

    async def send_embed(self, channel_id, embed, buttons=None, *, content=None, mention_role_ids=None):
        self.counter += 1
        self.sent.append({"channel_id": channel_id, "embed": embed})
        return {"ok": True, "message_id": f"m{self.counter}", "channel_id": channel_id}

    async def edit_embed(self, channel_id, message_id, embed, buttons=None, *, content=None):
        if message_id in self.deleted:
            return {"ok": False, "reason": "unknown_message"}
        self.edited.append({"channel_id": channel_id, "message_id": message_id, "embed": embed})
        return {"ok": True, "message_id": message_id}

    async def pin_message(self, channel_id, message_id):
        self.pinned.append(message_id)
        return {"ok": True}

    async def delete_message(self, channel_id, message_id):
        self.delete_calls.append((channel_id, message_id))
        return dict(self.delete_result)


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
    monkeypatch.setattr(discord_bot.bot, "delete_message", fake.delete_message)

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    discord_embeds._dirty.clear()
    return fake


def text_of(embed: dict) -> str:
    """Alles Lesbare einer Einbettung - Text und Felder (seit #866 stehen Listen als Felder)."""
    return "\n".join([embed.get("description") or ""] + [f"{field['name']}\n{field['value']}" for field in embed.get("fields") or []])


def test_embeds_are_pure_functions():
    season = {"id": "s1", "slug": "2026", "title": "Saison 2026"}
    rows = [{"display_name": "Paula", "total_points": 120.5}, {"username": "leon", "total_points": 80}]
    ranking = discord_embeds.ranking_embed(season, rows, "https://lionsquad.at", now_utc())
    assert ranking["title"] == "🏆 Rangliste – Saison 2026" and "🥇 **Paula** — 120,5 Punkte" in ranking["description"] and "🥈 **leon** — 80 Punkte" in ranking["description"]
    assert ranking["url"] == "https://lionsquad.at/seasons/2026" and ranking["footer"]["text"].startswith("Stand: ")
    assert ranking["thumbnail"]["url"] == "https://lionsquad.at/assets/brand/tls-favicon.png"
    nothing = discord_embeds.ranking_embed(None, [], "https://lionsquad.at")
    assert "keine laufende Saison" in nothing["title"] and nothing["description"] == "Noch keine Punkte vergeben."

    items = [{"kind": "tournament", "title": "Sommer-Cup", "start": "2026-10-03T16:00:00+00:00", "path": "/tournaments/sommer-cup", "phase": {"label": "Anmeldung offen"}}]
    events = discord_embeds.events_embed(items, "https://lionsquad.at")
    assert events["fields"][0]["name"].startswith("🏆 ") and events["fields"][0]["name"].endswith("03.10.2026 · 18:00 Uhr")
    assert events["fields"][0]["value"] == "**[Sommer-Cup](https://lionsquad.at/tournaments/sommer-cup)**\nTurnier · Anmeldung offen"
    without_state = discord_embeds.events_embed([{**items[0], "phase": None}], "https://lionsquad.at")
    assert without_state["fields"][0]["value"].endswith("\nTurnier"), "ohne Stand kein loser Trennpunkt"
    assert discord_embeds.events_embed([], "https://lionsquad.at")["description"] == "Nichts geplant – Termine folgen."

    live = discord_embeds.live_embed([{"display_name": "Paula", "game_name": "Rocket League", "title": "Finale!", "viewer_count": 12, "stream_url": "https://twitch.tv/paula"}], "https://lionsquad.at")
    assert live["fields"] == [{"name": "🔴 Paula · 12 Zuschauer", "value": "[Finale!](https://twitch.tv/paula)\n🎮 Rocket League", "inline": False}]
    assert "Gerade streamt niemand" in discord_embeds.live_embed([], "https://lionsquad.at")["description"]
    sneaky = discord_embeds.live_embed([{"display_name": "x", "title": "**fett** @everyone [link](https://evil.example)", "viewer_count": 1, "stream_url": "https://twitch.tv/x"}], "https://lionsquad.at")
    assert "\\*\\*fett\\*\\*" in sneaky["fields"][0]["value"] and "@\u200beveryone" in sneaky["fields"][0]["value"] and "\\[link\\]" in sneaky["fields"][0]["value"], \
        "Werte aus der Website setzen kein Markdown, keine Links und pingen niemanden"

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
    assert data["embeds"]["ranking"]["enabled"] is False and set(data["embeds"]) == {"ranking", "events", "achievement_week"}
    assert (await flow.put("/api/settings/discord", json={"embeds": {"live": {"enabled": True}}})).status_code == 400, "„Live jetzt“ gibt es nicht mehr (#883)"
    assert "embeds" not in data.get("bot", {})


@pytest.mark.asyncio
async def test_one_message_per_embed_edit_on_change_repost_after_deletion_and_throttle(flow, bot):
    await configure(flow, {"events": {"enabled": True, "channel_id": CHANNEL}, "achievement_week": {"enabled": True, "channel_id": CHANNEL}, "ranking": {"enabled": False}})
    await flow.db.events.insert_one({"id": "e1", "slug": "lan", "name": "LAN-Party", "status": "scheduled", "visibility": "public",
                                     "start_date": (now_utc() + timedelta(days=3)).isoformat()})
    t0 = now_utc()

    first = await discord_embeds.refresh(flow.db, "events", now=t0)
    assert first == {"ok": True, "reason": "posted", "message_id": "m1", "pinned": True}, first
    assert bot.pinned == ["m1"] and "LAN-Party" in text_of(bot.sent[0]["embed"]) and bot.sent[0]["embed"]["footer"]["text"].startswith("Stand: ")
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
    assert len(bot.sent) == 1 and bot.edited[-1]["message_id"] == "m1" and "Herbst-Cup" in text_of(bot.edited[-1]["embed"])
    assert "events" not in discord_embeds.pending()

    # Nachricht gelöscht: der Bot postet neu und pinnt wieder.
    bot.deleted.add("m1")
    reposted = await discord_embeds.refresh(flow.db, "events", force=True, now=t0 + timedelta(seconds=200))
    assert reposted["reason"] == "posted" and reposted["message_id"] == "m2" and bot.pinned == ["m1", "m2"]
    state = (await flow.db.settings.find_one({"id": "discord"}, {"_id": 0}))["embeds"]["events"]
    assert state["message_id"] == "m2" and state["last_action"] == "posted" and state["error"] is None

    # Der Sammler alle 10 min schreibt den Stand neu (force), auch ohne Änderung; ohne Freischaltung „diese Woche keiner“.
    outcome = await discord_embeds.sweep(flow.db, full=True)
    assert outcome["checked"] == 2 and outcome["posted"] == 1, outcome   # Erfolg der Woche zum ersten Mal, events gebremst oder bearbeitet
    assert "Diese Woche" in json.dumps(bot.sent[-1]["embed"], ensure_ascii=False)

    flow.act_as(await flow.add_user(role="club_admin", name="admin2"))
    status = (await flow.get("/api/settings/discord")).json()["embeds"]
    assert status["events"]["message_id"] == "m2" and status["achievement_week"]["message_id"] == "m3" and status["events"]["updated_at"]
    assert status["events"]["checked_at"] and status["events"]["paused"] is None
    player = await flow.add_user(role="player", name="paula")
    flow.act_as(player)
    assert (await flow.post("/api/settings/discord/embeds/events/refresh")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_channel_change_starts_a_new_message_and_refresh_route_forces(flow, bot):
    await configure(flow, {"events": {"enabled": True, "channel_id": CHANNEL}})
    assert (await discord_embeds.refresh(flow.db, "events"))["reason"] == "posted"
    other = "100000000000000012"
    assert (await flow.put("/api/settings/discord", json={"embeds": {"events": {"channel_id": other}}})).status_code == 200
    state = (await flow.db.settings.find_one({"id": "discord"}, {"_id": 0}))["embeds"]["events"]
    assert "message_id" not in state and state["channel_id"] == other, "neuer Kanal = neue Nachricht"
    forced = (await flow.post("/api/settings/discord/embeds/events/refresh")).json()
    assert forced["reason"] == "posted" and bot.sent[-1]["channel_id"] == other
    assert (await flow.post("/api/settings/discord/embeds/gibt-es-nicht/refresh")).status_code == 404
    assert (await flow.post("/api/settings/discord/embeds/live/refresh")).status_code == 404


@pytest.mark.asyncio
async def test_the_live_overview_is_retired_once_and_its_channel_goes_to_the_stream_posts(flow, bot):
    """#883 (Entscheidung A): „Live jetzt“ gibt es nicht mehr. Die alte angeheftete Nachricht löscht der Bot einmal (seine
    eigene), ihr Kanal wird den Stream-Meldungen vorgeschlagen, „Wenn der Stream endet“ steht auf löschen - eingeschaltet
    wird nichts. Ist der Bot nicht verbunden, versucht es der nächste Lauf wieder."""
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {
        "id": "discord", "embeds": {"live": {"enabled": True, "channel_id": CHANNEL, "message_id": "m9"}},
        "streams": {"enabled": False, "channel_id": "", "on_end": "edit"}}}, upsert=True)

    bot.delete_result = {"ok": False, "reason": "bot_offline"}
    assert (await discord_embeds.retire(flow.db))["retired"] == []
    assert "live" in (await flow.db.settings.find_one({"id": "discord"}, {"_id": 0}))["embeds"], "der nächste Lauf versucht es wieder"

    bot.delete_result = {"ok": True}
    await discord_embeds.sweep(flow.db, full=True)
    settings = await flow.db.settings.find_one({"id": "discord"}, {"_id": 0})
    assert bot.delete_calls == [(CHANNEL, "m9"), (CHANNEL, "m9")]
    assert "live" not in (settings.get("embeds") or {})
    assert settings["streams"] == {"enabled": False, "channel_id": CHANNEL, "on_end": "delete"}, "Kanal vorgeschlagen, nichts eingeschaltet"
    await discord_embeds.sweep(flow.db, full=True)
    assert len(bot.delete_calls) == 2, "nur einmal aufräumen"

    # /wer-streamt antwortet weiter mit der Vorlage „live“.
    built = await discord_embeds.build(flow.db, "live")
    assert "Gerade streamt niemand" in text_of(built["embed"])


@pytest.mark.asyncio
async def test_retiring_keeps_what_was_chosen_for_the_stream_posts(flow, bot):
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {
        "id": "discord", "embeds": {"live": {"enabled": True, "channel_id": CHANNEL, "message_id": "m9"}},
        "streams": {"enabled": True, "channel_id": "100000000000000099", "on_end": "edit"}}}, upsert=True)
    bot.delete_result = {"ok": True, "gone": True}
    assert (await discord_embeds.retire(flow.db))["retired"] == ["live"]
    settings = await flow.db.settings.find_one({"id": "discord"}, {"_id": 0})
    assert settings["streams"] == {"enabled": True, "channel_id": "100000000000000099", "on_end": "edit"}, "Eingestelltes bleibt"
    assert "live" not in settings["embeds"]


@pytest.mark.asyncio
async def test_a_stalled_embed_says_why_instead_of_standing_still(flow, bot, monkeypatch):
    """#883: „Live jetzt“ stand vier Tage auf „Nachricht steht · Stand 29.9.“ - ohne Grund. Jeder Lauf hält fest, wann er
    geprüft hat; darf er nicht schreiben (Bot aus) oder scheitert der Aufbau, steht der Grund da - und verschwindet wieder."""
    await configure(flow, {"events": {"enabled": True, "channel_id": CHANNEL}})
    t0 = now_utc()
    assert (await discord_embeds.refresh(flow.db, "events", now=t0))["reason"] == "posted"

    assert (await flow.put("/api/settings/discord", json={"bot_enabled": False})).status_code == 200
    stopped = await discord_embeds.refresh(flow.db, "events", force=True, now=t0 + timedelta(minutes=10))
    assert stopped["reason"] == "bot_off"
    status = (await flow.get("/api/settings/discord")).json()["embeds"]["events"]
    assert status["paused"] and status["checked_at"] == (t0 + timedelta(minutes=10)).isoformat() and status["updated_at"] == t0.isoformat()

    assert (await flow.put("/api/settings/discord", json={"bot_enabled": True})).status_code == 200
    original_build = discord_embeds.build

    async def broken(*_args, **_kwargs):
        raise RuntimeError("kaputt")

    monkeypatch.setattr(discord_embeds, "build", broken)
    failed = await discord_embeds.refresh(flow.db, "events", force=True, now=t0 + timedelta(minutes=20))
    assert failed["reason"] == "build_failed" and "RuntimeError" in failed["error"]
    status = (await flow.get("/api/settings/discord")).json()["embeds"]["events"]
    assert "RuntimeError" in status["error"] and status["checked_at"] == (t0 + timedelta(minutes=20)).isoformat()

    monkeypatch.setattr(discord_embeds, "build", original_build)
    healed = await discord_embeds.refresh(flow.db, "events", force=True, now=t0 + timedelta(minutes=30))
    assert healed["reason"] == "edited"
    state = (await flow.db.settings.find_one({"id": "discord"}, {"_id": 0}))["embeds"]["events"]
    assert "paused" not in state and state["error"] is None and state["checked_at"] == (t0 + timedelta(minutes=30)).isoformat()


MAIN, COD, EMPTY = "700000000000000001", "700000000000000002", "700000000000000003"
COD_CHANNEL, EMPTY_CHANNEL = "100000000000000021", "100000000000000031"


def seen(guild_id, name):
    return {"guild_id": guild_id, "name": name, "icon_url": None, "member_count": 10, "bot_permissions": {key: True for key, _, _ in discord_guilds.PERMISSIONS}}


@pytest.mark.asyncio
async def test_a_game_server_shows_only_its_games_and_main_shows_everything(flow, bot):
    """#628: Rangliste und nächste Termine je Unterserver - nur Turniere und Punkte der Spiele dieses Servers, das Spiel
    steht hinter dem Saisonnamen; der Hauptserver zeigt alles. Ohne Spiel am Server: angehalten mit Grund."""
    await configure(flow, {"events": {"enabled": True, "channel_id": CHANNEL}, "ranking": {"enabled": True, "channel_id": CHANNEL}})
    db = flow.db
    await discord_guilds.reconcile(db, [seen(MAIN, "LION"), seen(COD, "CoD-Server"), seen(EMPTY, "Leer")], configured_main=MAIN)
    for guild_id in (COD, EMPTY):
        await discord_guilds.update_guild(db, guild_id, {"enabled": True})
    await db.games.insert_many([{"id": "g-cod", "name": "Call of Duty", "discord_guild_id": COD}, {"id": "g-rl", "name": "Rocket League"}])
    soon = (now_utc() + timedelta(days=3)).isoformat()
    await db.tournaments.insert_many([
        {"id": "t-cod", "slug": "cod", "title": "CoD-Cup", "game_id": "g-cod", "status": "registration_open", "visibility": "public", "start_date": soon},
        {"id": "t-rl", "slug": "rl", "title": "RL-Cup", "game_id": "g-rl", "status": "registration_open", "visibility": "public", "start_date": soon},
    ])
    await db.events.insert_one({"id": "e1", "slug": "lan", "name": "LAN-Party", "status": "scheduled", "visibility": "public", "start_date": soon})
    await db.seasons.insert_one({"id": "s1", "slug": "2026", "title": "Saison 2026", "status": "active"})
    paula, otto = await flow.add_user(name="Paula"), await flow.add_user(name="Otto")
    await db.season_points.insert_many([
        {"id": "p1", "season_id": "s1", "user_id": paula["id"], "source_type": "tournament", "source_id": "t-cod", "total_points": 50, "raw_points": 50, "rank": 1},
        {"id": "p2", "season_id": "s1", "user_id": otto["id"], "source_type": "tournament", "source_id": "t-rl", "total_points": 80, "raw_points": 80, "rank": 1},
    ])

    both = {"events": {"enabled": True, "channel_id": COD_CHANNEL}, "ranking": {"enabled": True, "channel_id": COD_CHANNEL}}
    saved = await flow.patch(f"/api/settings/discord/guilds/{COD}", json={"embeds": both})
    assert saved.status_code == 200 and saved.json()["embeds"]["events"]["channel_id"] == COD_CHANNEL
    assert (await flow.patch(f"/api/settings/discord/guilds/{EMPTY}", json={"embeds": {"events": {"enabled": True, "channel_id": EMPTY_CHANNEL}}})).status_code == 200
    assert (await flow.patch(f"/api/settings/discord/guilds/{COD}", json={"embeds": {"achievement_week": {"enabled": True}}})).status_code == 400
    assert (await flow.patch(f"/api/settings/discord/guilds/{COD}", json={"embeds": {"events": {"channel_id": "123"}}})).status_code == 400
    assert (await flow.patch(f"/api/settings/discord/guilds/{MAIN}", json={"embeds": {"events": {"enabled": True}}})).status_code == 400

    outcome = await discord_embeds.sweep(db, full=True)
    assert outcome["checked"] == 5 and outcome["posted"] == 4 and outcome["errors"] == 1, outcome
    texts: dict[str, str] = {}
    for sent in bot.sent:
        texts[sent["channel_id"]] = texts.get(sent["channel_id"], "") + json.dumps(sent["embed"], ensure_ascii=False)
    assert "CoD-Cup" in texts[COD_CHANNEL] and "RL-Cup" not in texts[COD_CHANNEL] and "LAN-Party" not in texts[COD_CHANNEL]
    assert "Paula" in texts[COD_CHANNEL] and "Otto" not in texts[COD_CHANNEL] and "Saison 2026 · Call of Duty" in texts[COD_CHANNEL]
    assert all(word in texts[CHANNEL] for word in ("CoD-Cup", "RL-Cup", "LAN-Party", "Paula", "Otto")) and "· Call of Duty" not in texts[CHANNEL]
    assert EMPTY_CHANNEL not in texts, "ohne Spiel keine leere Nachricht"

    rows = {row["guild_id"]: row for row in (await flow.get("/api/settings/discord/guilds")).json()["guilds"]}
    assert rows[COD]["embeds"]["events"]["message_id"] and rows[COD]["embeds"]["events"]["last_action"] == "posted"
    assert rows[EMPTY]["embeds"]["events"]["paused"].startswith("Diesem Server ist noch kein Spiel")

    # Änderung am CoD-Turnier: der nächste Lauf bearbeitet die Nachrichten (nach der Bremse), keine neuen.
    await db.tournaments.update_one({"id": "t-cod"}, {"$set": {"title": "CoD-Cup 2026"}})
    discord_embeds.request_refresh("events")
    later = now_utc() + timedelta(minutes=2)
    edited = await discord_embeds.refresh(db, "events", guild_id=COD, now=later)
    assert edited["reason"] == "edited" and "CoD-Cup 2026" in json.dumps(bot.edited[-1]["embed"], ensure_ascii=False) and bot.edited[-1]["channel_id"] == COD_CHANNEL
    assert "events" in discord_embeds.pending(), "die Merkliste führt der Sammler, nicht der Unterserver"
    forced = (await flow.post(f"/api/settings/discord/guilds/{COD}/embeds/ranking/refresh")).json()
    assert forced["reason"] in ("edited", "throttled", "unchanged")
    assert (await flow.post(f"/api/settings/discord/guilds/{COD}/embeds/achievement_week/refresh")).status_code == 404
    assert (await flow.post(f"/api/settings/discord/guilds/{MAIN}/embeds/events/refresh")).status_code == 404

    # Server aus: nichts wird mehr angefasst.
    await discord_guilds.update_guild(db, COD, {"enabled": False})
    assert (await discord_embeds.refresh(db, "events", guild_id=COD, force=True, now=later + timedelta(minutes=5)))["reason"] == "server_off"

    def cod_calls():
        return sum(1 for item in bot.sent + bot.edited if item["channel_id"] == COD_CHANNEL)

    before = cod_calls()
    swept = await discord_embeds.sweep(db, full=True)
    assert swept["checked"] == 3 and cod_calls() == before, swept   # Hauptserver zwei, „Leer“ angehalten, CoD aus
