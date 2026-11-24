"""Saisonfinale am TV (#1641) und Liga im Discord (#1642) über die echten Routen: Schritt „Auf- und Absteiger“ mit Weiter und Ende,
nur für öffentliche Seasons; Spieltag-Zusammenfassung und Saisonende-Meldung je Season einstellbar, nie doppelt. Discord ist ein Fake -
kein Token, kein Netz. Nur erfundene Namen."""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_runtime, league_discord  # noqa: E402
from test_league_final_flow import ADMIN, add_staffel, lead, matches_of, must_close, must_reopen, play_all, setup  # noqa: E402
from test_league_successor_flow import BEST, build, close, ok  # noqa: E402

CHANNEL = "100000000000000042"
OTHER_CHANNEL = "100000000000000043"


class FakeBot:
    def __init__(self):
        self.sent = []
        self.fail = False
        # Wirft erst nach der Zustellung (Zeitüberschreitung, 5xx): die Nachricht steht im Kanal, zurück kommt ein Fehler.
        self.after_send = None

    async def send_embed(self, channel_id, embed, buttons=None, **kwargs):
        if self.fail:
            return {"ok": False, "reason": "bot_offline"}
        self.sent.append({"channel_id": channel_id, "embed": embed, "buttons": buttons or []})
        if self.after_send:
            return {"ok": False, "reason": self.after_send, "error": "TimeoutError: "}
        return {"ok": True, "message_id": str(900000000000000000 + len(self.sent)), "channel_id": channel_id}

    async def list_channels(self, guild_id=""):
        return {"ok": True, "channels": [{"id": CHANNEL, "name": "liga-ergebnisse", "category": "Liga", "can_send": True},
                                         {"id": OTHER_CHANNEL, "name": "nur-lesen", "category": "Liga", "can_send": False}]}


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
    monkeypatch.setattr(discord_runtime.bot, "send_embed", fake.send_embed)
    monkeypatch.setattr(discord_runtime.bot, "list_channels", fake.list_channels)
    return fake


async def two_leagues(flow, *, close_both: bool = True):
    """Liga 1 und Liga 2 mit je vier Teams, alles gespielt (1 vor 2 vor 3 vor 4) - Vorgabe 1 Auf-, 1 Absteiger."""
    admin, league, season, top, staffel = await setup(flow)
    second = (await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={})).json()
    lower = await add_staffel(flow, second, "b")
    await play_all(flow, staffel)
    await play_all(flow, lower)
    await must_close(flow, staffel)
    if close_both:
        await must_close(flow, lower)
    return admin, league, season, staffel, lower


async def display(flow, staffel):
    response = await flow.get(f"/api/tournaments/{staffel['id']}/bracket/display", params={"table": 1})
    assert response.status_code == 200, response.text
    return response.json()


async def step(flow, season, action):
    response = await flow.post(f"{ADMIN}/seasons/{season['id']}/tv-finale", json={"action": action})
    assert response.status_code == 200, response.text
    return response.json()


async def discord_ready(flow):
    """Discord an, Bot an - ohne Token: gesendet wird nur an den Fake. Freigegeben ist CHANNEL als Kanal für Events und Turniere
    (Verbindungen → Discord → Kanäle je Zweck, Nr. 234)."""
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {"enabled": True, "bot_enabled": True, "channels": {"events": CHANNEL}}},
                                      upsert=True)


# ---------------------------------------------------------------- TV (#1641)

@pytest.mark.asyncio
async def test_tv_finale_steps_through_each_league_with_next_and_end(flow):
    _admin, _league, season, staffel, lower = await two_leagues(flow)
    assert (await display(flow, staffel))["league_finale"] is None

    state = (await flow.get(f"{ADMIN}/seasons/{season['id']}/tv-finale")).json()
    assert state == {"step": 0, "count": 2, "labels": ["Liga 1", "Liga 2"], "closed": 2, "reason": None}

    assert (await step(flow, season, "next"))["step"] == 1
    finale = (await display(flow, staffel))["league_finale"]
    assert finale["step"] == 1 and finale["count"] == 2 and finale["season"] == season["name"]
    first, second = finale["pages"]
    assert [(row["name"], row["move"], row["target"]) for row in first["rows"]] == [("Probe 4", "down", "Liga 2")]
    assert [(row["name"], row["move"], row["target"]) for row in second["rows"]] == [("Probe b1", "up", "Liga 1")]
    # Jeder TV der Season geht mit - auch der der anderen Staffel.
    assert (await display(flow, lower))["league_finale"]["step"] == 1

    assert (await step(flow, season, "next"))["step"] == 2
    assert (await step(flow, season, "next"))["step"] == 2, "auf der letzten Liga N bleibt Weiter stehen"
    assert (await display(flow, staffel))["league_finale"]["step"] == 2

    assert (await step(flow, season, "end"))["step"] == 0
    assert (await display(flow, staffel))["league_finale"] is None
    assert (await display(flow, lower))["league_finale"] is None
    logged = await flow.db.audit_logs.find({"action": "league.season.tv_finale"}, {"_id": 0}).to_list(10)
    assert [row["data"]["step"] for row in logged] == [1, 2, 0]
    # Am Turnier steht nur Schritt, Liga N und Zeit - keine Person (Nr. 241: die Liga N hält den TV bei seiner Seite).
    stored = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0, "tv_finale": 1})
    assert set(stored["tv_finale"]) == {"step", "division_id", "updated_at"}


@pytest.mark.asyncio
async def test_tv_finale_never_for_internal_seasons_or_open_staffeln(flow):
    _admin, _league, season, staffel, lower = await two_leagues(flow, close_both=False)
    # Nur Liga 1 abgeschlossen: der Schritt kennt nur ihren Absteiger; der TV der offenen Staffel zeigt nichts.
    assert (await step(flow, season, "next"))["labels"] == ["Liga 1"]
    assert (await display(flow, staffel))["league_finale"]["step"] == 1
    assert (await display(flow, lower))["league_finale"] is None

    for visibility in ("admins", "members", "off"):
        await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"visibility": visibility}})
        assert (await display(flow, staffel))["league_finale"] is None, visibility
        state = (await flow.get(f"{ADMIN}/seasons/{season['id']}/tv-finale")).json()
        assert state["reason"] == "season_hidden" and state["step"] == 0
    # Gegenprobe: wieder öffentlich - der gespeicherte Schritt gilt wieder.
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"visibility": "public"}})
    assert (await display(flow, staffel))["league_finale"]["step"] == 1
    # Eine Staffel, die Gäste nicht sehen, auch nicht.
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"is_public": False}})
    assert (await display(flow, staffel))["league_finale"] is None


@pytest.mark.asyncio
async def test_tv_finale_needs_league_rights(flow):
    _admin, league, season, _staffel, _lower = await two_leagues(flow)
    stranger = await flow.add_user(name="Fremd")
    flow.act_as(stranger)
    assert (await flow.post(f"{ADMIN}/seasons/{season['id']}/tv-finale", json={"action": "next"})).status_code == 403
    reader = await lead(flow, league, "Nur Kader", "roster")
    flow.act_as(reader)
    assert (await flow.get(f"{ADMIN}/seasons/{season['id']}/tv-finale")).status_code == 200
    assert (await flow.post(f"{ADMIN}/seasons/{season['id']}/tv-finale", json={"action": "next"})).status_code == 403
    helper = await lead(flow, league, "Spielbetrieb", "matches")
    flow.act_as(helper)
    assert (await flow.post(f"{ADMIN}/seasons/{season['id']}/tv-finale", json={"action": "next"})).json()["step"] == 1
    assert (await flow.post(f"{ADMIN}/seasons/{season['id']}/tv-finale", json={"action": "jump"})).status_code == 422


# ---------------------------------------------------------------- Discord (#1642)

async def switch_on(flow, season, **body):
    response = await flow.put(f"{ADMIN}/seasons/{season['id']}/discord",
                              json={"matchday": True, "season_end": True, "channel_id": CHANNEL, **body})
    assert response.status_code == 200, response.text
    return response.json()


async def since_long_ago(flow, season):
    """Wie eingeschaltet vor Saisonbeginn - sonst gälten die gespielten Spieltage als „vor dem Einschalten“."""
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {f"{league_discord.FIELD}.matchday_since": "2025-01-01T00:00:00+00:00"}})


@pytest.mark.asyncio
async def test_discord_is_off_without_setting(flow, bot):
    _admin, _league, season, _staffel, _lower = await two_leagues(flow)
    await discord_ready(flow)
    got = (await flow.get(f"{ADMIN}/seasons/{season['id']}/discord")).json()
    assert got["active"] is False and got["settings"]["matchday"] is False and got["settings"]["season_end"] is False
    # Nur freigegebene Kanäle (Nr. 234) - OTHER_CHANNEL kennt der Bot, er steht aber in keinem Zweck.
    assert [row["id"] for row in got["channels"]] == [CHANNEL]
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 0}
    assert bot.sent == [] and await flow.db.league_discord_posts.count_documents({}) == 0


@pytest.mark.asyncio
async def test_discord_matchdays_and_season_end_once_into_the_chosen_channel(flow, bot):
    _admin, _league, season, staffel, _lower = await two_leagues(flow)
    await discord_ready(flow)
    saved = await switch_on(flow, season, table_rows=3)
    assert saved["active"] is True and saved["settings"]["channel_id"] == CHANNEL
    assert "matchday_since" not in saved["settings"]

    # Frisch eingeschaltet: die alten Spieltage gehen nicht nachträglich hinaus - nur das Saisonende.
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 1}
    end = bot.sent[-1]
    assert end["channel_id"] == CHANNEL
    assert end["embed"]["title"] == f"Saisonende · {season['name']}"
    assert "Meister: **Probe 1**" in end["embed"]["description"]
    fields = {field["name"]: field["value"] for field in end["embed"]["fields"]}
    assert fields == {"Liga 1": "▼ Probe 4 → Liga 2", "Liga 2": "▲ Probe b1 → Liga 1"}
    assert end["buttons"][0]["label"] == "Zur Season" and end["buttons"][0]["url"].endswith("/liga/probe-shooter/season-1")

    # Eingeschaltet vor Saisonbeginn: alle drei Spieltage je Staffel liegen fertig da - nach Nr. 240 kommt je Staffel nur der neueste,
    # die älteren werden verworfen.
    await since_long_ago(flow, season)
    assert await league_discord.sweep(flow.db) == {"matchday": 2, "season_end": 0}
    titles = sorted(sent["embed"]["title"] for sent in bot.sent[1:])
    assert titles == sorted([f"Spieltag 3 · Liga {level}" for level in (1, 2)])
    one = next(sent for sent in bot.sent if sent["embed"]["title"] == "Spieltag 3 · Liga 1")
    assert "*Alle Spiele gewertet*" in one["embed"]["description"]
    assert one["embed"]["fields"][0]["value"].splitlines()[:3] == ["1. Probe 1 · 9 Pkt.", "2. Probe 2 · 6 Pkt.", "3. Probe 3 · 3 Pkt."]
    assert all(sent["channel_id"] == CHANNEL for sent in bot.sent)

    # Doppellauf - auch zwei zugleich: keine zweite Nachricht.
    before = len(bot.sent)
    results = await asyncio.gather(league_discord.sweep(flow.db), league_discord.sweep(flow.db))
    assert results == [{"matchday": 0, "season_end": 0}] * 2
    assert len(bot.sent) == before
    assert await flow.db.league_discord_posts.count_documents({"status": "sent"}) == 3
    assert await flow.db.league_discord_posts.count_documents({"status": "skipped"}) == 4
    stored = await flow.db.league_discord_posts.find_one({"dedupe_key": f"matchday:{staffel['id']}:3"}, {"_id": 0})
    assert stored["status"] == "sent" and stored["channel_id"] == CHANNEL and stored["message_id"]


@pytest.mark.asyncio
async def test_discord_open_games_wait_for_the_deadline_then_say_how_many(flow, bot):
    admin, _league, season, _top, staffel = await setup(flow)
    await play_all(flow, staffel)
    last = (await matches_of(flow, staffel, 3))[0]
    await flow.db.matches_v2.update_one({"id": last["id"]}, {"$set": {"status": "scheduled", "results": []}})
    await discord_ready(flow)
    await switch_on(flow, season, season_end=False, late=False)
    await since_long_ago(flow, season)
    # Ohne „trotzdem melden“: Spieltag 3 wartet, bis alles gewertet ist. Von den fertigen 1 und 2 kommt nur der neueste (Nr. 240).
    assert await league_discord.sweep(flow.db) == {"matchday": 1, "season_end": 0}
    assert sorted(sent["embed"]["title"] for sent in bot.sent) == ["Spieltag 2 · Liga 1"]
    # Mit „trotzdem melden“ nach der Frist (Spielwoche längst vorbei): mit „1 Spiel offen“.
    await switch_on(flow, season, season_end=False, late=True)
    await since_long_ago(flow, season)
    assert await league_discord.sweep(flow.db) == {"matchday": 1, "season_end": 0}
    assert "*1 Spiel offen*" in bot.sent[-1]["embed"]["description"]
    assert " · offen" in bot.sent[-1]["embed"]["description"]
    # Season noch nicht beendet: keine Saisonende-Meldung, auch wenn eingeschaltet.
    await switch_on(flow, season)
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 0}


@pytest.mark.asyncio
async def test_discord_never_for_internal_seasons_and_never_without_bot(flow, bot):
    _admin, _league, season, _staffel, _lower = await two_leagues(flow)
    await discord_ready(flow)
    await switch_on(flow, season)
    await since_long_ago(flow, season)
    # Bot aus: nichts gesendet, nichts belegt.
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {"enabled": True, "bot_enabled": False}}, upsert=True)
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 0}
    await discord_ready(flow)
    for visibility in ("admins", "members", "off"):
        await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"visibility": visibility}})
        assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 0}, visibility
    assert bot.sent == [] and await flow.db.league_discord_posts.count_documents({}) == 0
    # Gegenprobe: öffentlich - jetzt geht es hinaus.
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"visibility": "public"}})
    assert await league_discord.sweep(flow.db) == {"matchday": 2, "season_end": 1}


@pytest.mark.asyncio
async def test_discord_failure_is_retried_later_but_never_twice_sent(flow, bot):
    _admin, _league, season, _staffel, _lower = await two_leagues(flow)
    await discord_ready(flow)
    await switch_on(flow, season, matchday=False)
    bot.fail = True
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 1}
    stored = await flow.db.league_discord_posts.find_one({"dedupe_key": f"season_end:{season['id']}"}, {"_id": 0})
    assert stored["status"] == "failed" and stored["attempts"] == 1 and stored["error"] == "bot_offline"
    bot.fail = False
    # Gleich danach: noch nicht wieder.
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 0}
    assert bot.sent == []
    later = now_utc() + timedelta(minutes=league_discord.RETRY_MINUTES + 1)
    assert await league_discord.sweep(flow.db, now=later) == {"matchday": 0, "season_end": 1}
    assert len(bot.sent) == 1
    assert await league_discord.sweep(flow.db, now=later + timedelta(hours=2)) == {"matchday": 0, "season_end": 0}
    assert len(bot.sent) == 1


@pytest.mark.asyncio
async def test_discord_setting_rights_and_checks(flow, bot):
    _admin, league, season, _staffel, _lower = await two_leagues(flow)
    await discord_ready(flow)
    missing = await flow.put(f"{ADMIN}/seasons/{season['id']}/discord", json={"matchday": True})
    assert missing.status_code == 422 and "Kanal" in missing.json()["detail"]
    reader = await lead(flow, league, "Nur Kader", "roster")
    flow.act_as(reader)
    assert (await flow.get(f"{ADMIN}/seasons/{season['id']}/discord")).status_code == 200
    assert (await flow.put(f"{ADMIN}/seasons/{season['id']}/discord", json={"season_end": True, "channel_id": CHANNEL})).status_code == 403
    configurer = await lead(flow, league, "Season-Leitung", "season")
    flow.act_as(configurer)
    assert (await flow.put(f"{ADMIN}/seasons/{season['id']}/discord", json={"season_end": True, "channel_id": CHANNEL})).status_code == 200
    logged = await flow.db.audit_logs.find_one({"action": "league.season.discord_digest"}, {"_id": 0})
    assert logged["actor_id"] == configurer["id"] and logged["data"]["to"]["season_end"] is True


# ---------------------------------------------------------------- Fix-Runde (Nr. 233-236)

@pytest.mark.asyncio
async def test_tv_finale_starts_over_after_reopening_and_closing_again(flow):
    """Wiederöffnen nimmt den TV-Schritt der ganzen Season zurück, erneutes Abschließen setzt ihn nicht wieder: Der TV zeigt den
    Schritt erst nach dem nächsten „Weiter“ - nie einen alten Stand mit überholten Auf- und Absteigern."""
    _admin, _league, season, staffel, lower = await two_leagues(flow)
    await step(flow, season, "next")
    assert (await step(flow, season, "next"))["step"] == 2
    await must_reopen(flow, staffel, emergency_reason="Niemand sonst erreichbar")
    assert (await display(flow, lower))["league_finale"] is None
    for tid in (staffel["id"], lower["id"]):
        assert "tv_finale" not in await flow.db.tournaments.find_one({"id": tid}, {"_id": 0, "tv_finale": 1})
    await must_close(flow, staffel)
    assert "tv_finale" not in await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0, "tv_finale": 1})
    assert (await display(flow, staffel))["league_finale"] is None
    assert (await display(flow, lower))["league_finale"] is None
    assert (await flow.get(f"{ADMIN}/seasons/{season['id']}/tv-finale")).json()["step"] == 0
    assert (await step(flow, season, "next"))["step"] == 1
    assert (await display(flow, staffel))["league_finale"]["step"] == 1


@pytest.mark.asyncio
async def test_tv_finale_close_clears_a_leftover_step(flow):
    """Abschließen räumt einen übrig gebliebenen Schritt am Turnier weg (z. B. aus einem abgebrochenen Wiederöffnen)."""
    admin, _league, season, _top, staffel = await setup(flow)
    await play_all(flow, staffel)
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"tv_finale": {"step": 1, "updated_at": "2026-01-01T00:00:00+00:00"}}})
    await must_close(flow, staffel)
    assert "tv_finale" not in await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0, "tv_finale": 1})
    assert (await display(flow, staffel))["league_finale"] is None


@pytest.mark.asyncio
async def test_tv_finale_second_tab_gets_409_when_the_step_moved(flow):
    """Zwei Leitungs-Tabs: „Weiter“ schickt den Stand mit, den der Tab zeigt. Hat der andere Tab schon weitergeschaltet, gibt es 409 -
    sonst überspränge der TV eine Liga N."""
    _admin, _league, season, staffel, _lower = await two_leagues(flow)
    first = await flow.post(f"{ADMIN}/seasons/{season['id']}/tv-finale", json={"action": "next", "from_step": 0})
    assert first.status_code == 200 and first.json()["step"] == 1
    stale = await flow.post(f"{ADMIN}/seasons/{season['id']}/tv-finale", json={"action": "next", "from_step": 0})
    assert stale.status_code == 409 and "anderen" in stale.json()["detail"]
    assert (await display(flow, staffel))["league_finale"]["step"] == 1
    fresh = await flow.post(f"{ADMIN}/seasons/{season['id']}/tv-finale", json={"action": "next", "from_step": 1})
    assert fresh.status_code == 200 and fresh.json()["step"] == 2
    # „Ende“ gilt immer - zurück zum gewohnten Bild ist nie falsch.
    assert (await flow.post(f"{ADMIN}/seasons/{season['id']}/tv-finale", json={"action": "end", "from_step": 0})).json()["step"] == 0


@pytest.mark.asyncio
async def test_best_runner_up_across_staffeln_on_tv_control_and_discord(flow, bot):
    """Zone über Staffeln hinweg (#1627): Der beste Zweite der Liga 2 steigt auf - der Endstand selbst trägt die Zone nicht, sie kommt
    beim Lesen dazu. TV, Steuerung und Discord-Saisonende zeigen ihn; der schlechtere Zweite bleibt."""
    world = await build(flow, levels=2, zones=BEST, extra={2: [3]})
    for tid in world["tids"]:
        ok(await close(flow, world, tid))
    season_id = world["season"]["id"]
    # Der Helfer legt die Season intern an - hier wie nach dem Veroeffentlichen: Season und Staffeln oeffentlich.
    await flow.db.league_seasons.update_one({"id": season_id}, {"$set": {"visibility": "public"}})
    await flow.db.tournaments.update_many({"id": {"$in": world["tids"]}}, {"$set": {"visibility": "public", "is_public": True}})
    best, worse = world["regs"][2][1]["id"], world["more"][2][0]["regs"][1]["id"]

    flow.act_as(world["lead"])
    control = ok(await flow.post(f"{ADMIN}/seasons/{season_id}/tv-finale", json={"action": "next"}))
    assert control["labels"] == ["Liga 1", "Liga 2"]
    finale = ok(await flow.get(f"/api/tournaments/{world['tids'][1]}/bracket/display", params={"table": 1}))["league_finale"]
    lower = finale["pages"][1]
    ups = {row["registration_id"]: row["target"] for row in lower["rows"] if row["move"] == "up"}
    assert ups.get(best) == "Liga 1"
    assert worse not in ups

    season = await flow.db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if season.get("status") != "completed":
        await flow.db.league_seasons.update_one({"id": season_id}, {"$set": {"status": "completed"}})
    await discord_ready(flow)
    ok(await flow.put(f"{ADMIN}/seasons/{season_id}/discord", json={"season_end": True, "channel_id": CHANNEL}))
    assert (await league_discord.sweep(flow.db))["season_end"] == 1
    fields = {field["name"]: field["value"] for field in bot.sent[-1]["embed"]["fields"]}
    best_name = next(row["name"] for row in lower["rows"] if row["registration_id"] == best)
    assert best_name in fields["Liga 2"]


@pytest.mark.asyncio
async def test_discord_unclear_failure_is_never_sent_again_and_the_lead_sees_it(flow, bot):
    """Wirft das Senden erst nach der Zustellung (Zeitüberschreitung, 5xx), steht die Meldung womöglich schon im Kanal: Der Merker
    bleibt, es gibt keinen zweiten Versuch - die Leitung sieht den Hinweis im Kasten."""
    _admin, _league, season, _staffel, _lower = await two_leagues(flow)
    await discord_ready(flow)
    await switch_on(flow, season, matchday=False)
    bot.after_send = "error"
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 1}
    assert len(bot.sent) == 1
    stored = await flow.db.league_discord_posts.find_one({"dedupe_key": f"season_end:{season['id']}"}, {"_id": 0})
    assert stored["status"] == "unclear" and stored["attempts"] == 1
    bot.after_send = None
    later = now_utc() + timedelta(minutes=league_discord.RETRY_MINUTES + 1)
    assert await league_discord.sweep(flow.db, now=later) == {"matchday": 0, "season_end": 0}
    assert await league_discord.sweep(flow.db, now=later + timedelta(hours=5)) == {"matchday": 0, "season_end": 0}
    assert len(bot.sent) == 1
    problems = (await flow.get(f"{ADMIN}/seasons/{season['id']}/discord")).json()["problems"]
    assert [(row["kind"], row["status"]) for row in problems] == [("season_end", "unclear")]
    assert "nachsehen" in problems[0]["text"]


@pytest.mark.asyncio
async def test_discord_channel_only_from_the_approved_list(flow, bot):
    """Nr. 234: Wählbar sind nur die öffentlichen „Kanäle je Zweck“ aus Verbindungen → Discord. Der Server prüft (422); fällt ein
    Kanal später aus der Liste, geht nichts mehr hinein und der Kasten sagt es."""
    _admin, _league, season, _staffel, _lower = await two_leagues(flow)
    await discord_ready(flow)
    got = (await flow.get(f"{ADMIN}/seasons/{season['id']}/discord")).json()
    assert [(row["id"], row["purpose"]) for row in got["channels"]] == [(CHANNEL, "Events und Turniere")]
    refused = await flow.put(f"{ADMIN}/seasons/{season['id']}/discord", json={"season_end": True, "channel_id": OTHER_CHANNEL})
    assert refused.status_code == 422 and "freigegeben" in refused.json()["detail"]
    # Ein privater Zweck (Vorstand, Betrieb, Test, Mitglieder) ist nie freigegeben.
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {"channels.board": OTHER_CHANNEL}})
    again = await flow.put(f"{ADMIN}/seasons/{season['id']}/discord", json={"season_end": True, "channel_id": OTHER_CHANNEL})
    assert again.status_code == 422
    await switch_on(flow, season)
    await since_long_ago(flow, season)
    # Aus der Liste gefallen: nichts geht hinaus, nichts wird belegt.
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {"channels.events": ""}})
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 0}
    assert bot.sent == [] and await flow.db.league_discord_posts.count_documents({}) == 0
    assert (await flow.get(f"{ADMIN}/seasons/{season['id']}/discord")).json()["channel_approved"] is False


@pytest.mark.asyncio
async def test_discord_without_week_window_old_matchdays_do_not_come_at_once(flow, bot, monkeypatch):
    """Ohne Spielwoche (kein Start, kaputter Plan) zählt für „erst ab dem Einschalten“ das letzte Ergebnis des Spieltags - frisch
    eingeschaltet kommen die alten Spieltage nicht auf einmal."""
    from services import matchday_schedule

    def no_window(*_args, **_kwargs):
        raise ValueError("kein Start")

    monkeypatch.setattr(matchday_schedule, "tournament_matchday_window", no_window)
    _admin, _league, season, _staffel, _lower = await two_leagues(flow)
    await discord_ready(flow)
    await switch_on(flow, season, season_end=False)
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 0}
    assert bot.sent == []
    # Gegenprobe: eingeschaltet vor Saisonbeginn - jetzt geht je Staffel der neueste hinaus (Nr. 240).
    await since_long_ago(flow, season)
    assert await league_discord.sweep(flow.db) == {"matchday": 2, "season_end": 0}


@pytest.mark.asyncio
async def test_discord_failed_matchday_is_not_rebuilt_while_it_waits_or_gave_up(flow, bot, monkeypatch):
    """Nach einem Fehlschlag wartet der Spieltag auf seinen nächsten Versuch, nach dem dritten gibt er auf. In beiden Fällen lädt der
    Job nicht bei jedem Lauf wieder Namen und Tabelle."""
    _admin, _league, season, _staffel, _lower = await two_leagues(flow)
    await discord_ready(flow)
    await switch_on(flow, season, season_end=False)
    await since_long_ago(flow, season)
    bot.fail = True
    assert (await league_discord.sweep(flow.db))["matchday"] == 2
    loaded = []
    original = league_discord._names

    async def counting(db, tournament_id):
        loaded.append(tournament_id)
        return await original(db, tournament_id)

    monkeypatch.setattr(league_discord, "_names", counting)
    assert (await league_discord.sweep(flow.db))["matchday"] == 0
    assert loaded == [], "wartet auf den nächsten Versuch"
    await flow.db.league_discord_posts.update_many({}, {"$set": {"attempts": league_discord.MAX_ATTEMPTS}})
    later = now_utc() + timedelta(hours=3)
    assert (await league_discord.sweep(flow.db, now=later))["matchday"] == 0
    assert loaded == [], "aufgegeben"
    problems = (await flow.get(f"{ADMIN}/seasons/{season['id']}/discord")).json()["problems"]
    assert len(problems) == 2 and {row["status"] for row in problems} == {"failed"}


# ---------------------------------------------------------------- Runde 2 (Nr. 238-241)

RELEASE = "Ich habe im Kanal nachgesehen, die Meldung fehlt"


async def release(flow, season, key, **body):
    return await flow.post(f"{ADMIN}/seasons/{season['id']}/discord/release", json={"key": key, "confirm": True, **body})


@pytest.mark.asyncio
async def test_discord_build_error_shows_a_hint_and_never_blocks_silently(flow, bot, monkeypatch):
    """M2: Wirft schon der Aufbau der Meldung (vor dem Senden), steht sie nicht still als „sending“ - sie ist sofort als nicht gesendet
    im Kasten und lässt sich nach dem Beheben wieder freigeben."""
    from services import discord_links

    async def broken(*_args, **_kwargs):
        raise ValueError("kaputt")

    _admin, _league, season, _staffel, _lower = await two_leagues(flow)
    await discord_ready(flow)
    await switch_on(flow, season, matchday=False)
    monkeypatch.setattr(discord_links, "build_embed", broken)
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 1}
    stored = await flow.db.league_discord_posts.find_one({"dedupe_key": f"season_end:{season['id']}"}, {"_id": 0})
    assert stored["status"] == "failed" and stored["error"] == "build"
    problems = (await flow.get(f"{ADMIN}/seasons/{season['id']}/discord")).json()["problems"]
    assert [(row["key"], row["status"]) for row in problems] == [(f"season_end:{season['id']}", "failed")]
    assert "aufbauen" in problems[0]["text"]
    assert bot.sent == []


@pytest.mark.asyncio
async def test_discord_stuck_sending_turns_into_a_hint_after_30_minutes(flow, bot):
    """M2: Bricht der Lauf zwischen Belegen und Ergebnis ab (Neustart), bleibt „sending“ stehen - nach 30 Minuten zeigt der Kasten ihn
    als unklar. Gesendet wird er nicht noch einmal."""
    _admin, _league, season, _staffel, _lower = await two_leagues(flow)
    key = f"season_end:{season['id']}"
    now = now_utc()
    assert await league_discord.claim(flow.db, key, {"kind": "season_end", "season_id": season["id"]}, now - timedelta(minutes=10))
    assert (await flow.get(f"{ADMIN}/seasons/{season['id']}/discord")).json()["problems"] == []
    await flow.db.league_discord_posts.update_one({"dedupe_key": key}, {"$set": {"claimed_at": (now - timedelta(minutes=31)).isoformat()}})
    problems = (await flow.get(f"{ADMIN}/seasons/{season['id']}/discord")).json()["problems"]
    assert [(row["key"], row["status"]) for row in problems] == [(key, "unclear")]
    assert problems[0]["text"].startswith("Ob die Meldung ankam, ist unklar")
    await discord_ready(flow)
    await switch_on(flow, season, matchday=False)
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 0}
    assert bot.sent == []


@pytest.mark.asyncio
async def test_discord_release_sends_exactly_once_with_rights_audit_and_no_double_click(flow, bot):
    """Nr. 239: Nach dem Nachsehen im Kanal gibt die Leitung eine unklare Meldung frei - der nächste Lauf sendet sie genau einmal.
    Rechte wie die Einstellung („Season konfigurieren“), mit Protokoll; zwei Klicks bzw. zwei Fenster geben nur einmal frei."""
    _admin, league, season, _staffel, _lower = await two_leagues(flow)
    await discord_ready(flow)
    await switch_on(flow, season, matchday=False)
    bot.after_send = "error"
    assert (await league_discord.sweep(flow.db))["season_end"] == 1
    bot.after_send = None
    key = f"season_end:{season['id']}"
    unconfirmed = await flow.post(f"{ADMIN}/seasons/{season['id']}/discord/release", json={"key": key})
    assert unconfirmed.status_code == 422
    reader = await lead(flow, league, "Nur Kader", "roster")
    flow.act_as(reader)
    assert (await release(flow, season, key)).status_code == 403
    configurer = await lead(flow, league, "Season-Leitung", "season")
    flow.act_as(configurer)
    answers = await asyncio.gather(release(flow, season, key), release(flow, season, key))
    assert sorted(answer.status_code for answer in answers) == [200, 409]
    done = next(answer for answer in answers if answer.status_code == 200).json()
    assert done["problems"] == []
    logged = await flow.db.audit_logs.find({"action": "league.season.discord_release"}, {"_id": 0}).to_list(5)
    assert len(logged) == 1 and logged[0]["actor_id"] == configurer["id"] and logged[0]["data"]["key"] == key
    assert logged[0]["created_at"]
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 1}
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 0}
    assert len(bot.sent) == 2  # der unklare erste Versuch und genau ein neuer
    stored = await flow.db.league_discord_posts.find_one({"dedupe_key": key}, {"_id": 0})
    assert stored["status"] == "sent" and stored["released_by"] == configurer["id"]
    # Eine gesendete Meldung lässt sich nicht freigeben, eine unbekannte auch nicht.
    assert (await release(flow, season, key)).status_code == 409
    assert (await release(flow, season, "season_end:fremd")).status_code == 404


@pytest.mark.asyncio
async def test_discord_after_an_outage_only_the_newest_matchday_per_staffel(flow, bot):
    """Nr. 240: Nach einem Ausfall (Bot offline, Kanal nicht freigegeben) kommt je Staffel nur der neueste Spieltag - die älteren
    bekommen den Merker „verworfen“ und gehen nie hinaus. Sechs verpasste Spieltage, zwei Staffeln: zwei Meldungen."""
    _admin, _league, season, staffel, lower = await two_leagues(flow)
    await discord_ready(flow)
    await switch_on(flow, season, season_end=False)
    await since_long_ago(flow, season)
    assert await league_discord.sweep(flow.db) == {"matchday": 2, "season_end": 0}
    assert sorted(sent["embed"]["title"] for sent in bot.sent) == ["Spieltag 3 · Liga 1", "Spieltag 3 · Liga 2"]
    skipped = await flow.db.league_discord_posts.find({"status": "skipped"}, {"_id": 0}).to_list(10)
    assert sorted(row["dedupe_key"] for row in skipped) == sorted(f"matchday:{tid}:{n}" for tid in (staffel["id"], lower["id"]) for n in (1, 2))
    assert {row["reason"] for row in skipped} == {"missed"}
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 0}
    assert len(bot.sent) == 2
    assert (await flow.get(f"{ADMIN}/seasons/{season['id']}/discord")).json()["problems"] == []


@pytest.mark.asyncio
async def test_tv_finale_a_staffel_closing_during_the_finale_joins_it(flow):
    """Nr. 241: Schließt eine Staffel ab, während das Finale läuft, zeigt ihr TV sofort den laufenden Schritt - dieselbe Liga N wie die
    anderen TVs, auch wenn dadurch eine Liga N davor dazukommt. Die Steuerung zählt die neue Liga N mit."""
    _admin, _league, season, staffel, lower = await two_leagues(flow, close_both=False)
    # Erst schließt Liga 1 ab, die Leitung zeigt Liga 1. Dann kommt Liga 2 dazu: Ihr TV zeigt sofort Liga 1.
    assert (await step(flow, season, "next"))["labels"] == ["Liga 1"]
    await must_close(flow, lower)
    finale = (await display(flow, lower))["league_finale"]
    assert finale is not None and finale["count"] == 2 and finale["pages"][finale["step"] - 1]["label"] == "Liga 1"
    state = (await flow.get(f"{ADMIN}/seasons/{season['id']}/tv-finale")).json()
    assert state["count"] == 2 and state["labels"] == ["Liga 1", "Liga 2"] and state["step"] == 1
    assert (await step(flow, season, "next"))["step"] == 2
    assert (await display(flow, staffel))["league_finale"]["step"] == 2


@pytest.mark.asyncio
async def test_tv_finale_keeps_its_league_when_an_earlier_league_closes_later(flow):
    """Nr. 241: Zeigt der TV Liga 2 und schließt Liga 1 erst danach ab, bleibt er bei Liga 2 (jetzt Seite 2 von 2) - er springt nicht."""
    admin, _league, season, top, staffel = await setup(flow)
    second = (await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={})).json()
    lower = await add_staffel(flow, second, "b")
    await play_all(flow, staffel)
    await play_all(flow, lower)
    await must_close(flow, lower)
    assert (await step(flow, season, "next"))["labels"] == ["Liga 2"]
    await must_close(flow, staffel)
    for tid in (staffel, lower):
        finale = (await display(flow, tid))["league_finale"]
        assert finale["step"] == 2 and finale["pages"][1]["label"] == "Liga 2", tid["id"]
    state = (await flow.get(f"{ADMIN}/seasons/{season['id']}/tv-finale")).json()
    assert state["step"] == 2 and state["labels"] == ["Liga 1", "Liga 2"]
    # Wiederöffnen beendet das Finale weiterhin an allen TVs.
    await must_reopen(flow, staffel, emergency_reason="Niemand sonst erreichbar")
    assert (await display(flow, lower))["league_finale"] is None
