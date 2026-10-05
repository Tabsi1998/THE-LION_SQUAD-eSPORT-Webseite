"""Ein Thread je Turnier (#572) durch die echte Anwendung: die erste Meldung steht im Kanal und öffnet den
Thread, alles Weitere geht hinein - egal, ob der Status per Knopf, Formular, Zeitplan oder Station wechselt;
das Bracket steht im Thread, der Endstand ist die letzte Nachricht. „Ohne Discord“ hält alles zurück, ein
fehlendes Recht lässt nichts verloren gehen, ein gelöschter Thread oder ein neuer Kanal beginnt neu."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_bot, discord_bracket, discord_threads, tournament_streams  # noqa: E402

EVENTS = "100000000000000003"
OTHER = "100000000000000009"
TOKEN = "test" * 6 + ".fake." + "token" * 8
REGS = [{"id": "r1", "display_name": "Paula"}, {"id": "r2", "display_name": "Leon"}]
STAGES = [{"id": "s1", "tournament_id": "t1", "number": 1, "name": "Playoffs", "stage_type": "single_elimination"}]


def final_match(status="pending", score=None):
    results = []
    if score:
        results = [{"registration_id": "r1", "rank": 1, "score": score[0]}, {"registration_id": "r2", "rank": 2, "score": score[1]}]
    return {"id": "f", "tournament_id": "t1", "stage_id": "s1", "stage_number": 1, "round": 1, "order": 1, "section": "wb", "match_key": "F",
            "slots": [{"slot": 1, "registration_id": "r1", "status": "filled"}, {"slot": 2, "registration_id": "r2", "status": "filled"}],
            "results": results, "advancement": [], "status": status}


class FakeDiscord:
    """Discord im Kleinen: je Kanal und Thread die Nachrichten in Reihenfolge."""

    def __init__(self):
        self.messages: dict[str, list[dict]] = {}
        self.threads: dict[str, dict] = {}
        self.pinned: list[str] = []
        self.gone: set[str] = set()
        self.counter = 0
        self.thread_answer: dict | None = None

    async def send_embed(self, channel_id, embed, buttons=None, files=None):
        self.files = getattr(self, 'files', []) + [(channel_id, name, len(data)) for name, data in files or []]
        if channel_id in self.gone:
            return {"ok": False, "reason": "unknown_channel"}
        self.counter += 1
        message_id = f"m{self.counter}"
        self.messages.setdefault(channel_id, []).append({"id": message_id, "embed": embed})
        return {"ok": True, "message_id": message_id, "channel_id": channel_id}

    async def edit_embed(self, channel_id, message_id, embed, buttons=None, files=None):
        self.files = getattr(self, 'files', []) + [(channel_id, name, len(data)) for name, data in files or []]
        for row in self.messages.get(channel_id, []):
            if row["id"] == message_id:
                row["embed"] = embed
                return {"ok": True, "message_id": message_id, "channel_id": channel_id}
        return {"ok": False, "reason": "unknown_message"}

    async def pin_message(self, channel_id, message_id):
        self.pinned.append(message_id)
        return {"ok": True}

    async def create_thread(self, channel_id, message_id, name):
        if self.thread_answer:
            return dict(self.thread_answer)
        thread_id = f"th-{message_id}"
        self.threads[thread_id] = {"parent": channel_id, "starter": message_id, "name": name}
        return {"ok": True, "thread_id": thread_id}

    async def delete_message(self, channel_id, message_id):
        self.messages[channel_id] = [row for row in self.messages.get(channel_id, []) if row["id"] != message_id]
        return {"ok": True}

    def titles(self, channel_id):
        return [row["embed"]["title"] for row in self.messages.get(channel_id, [])]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def discord(monkeypatch):
    fake = FakeDiscord()
    for name in ("send_embed", "edit_embed", "pin_message", "create_thread", "delete_message"):
        monkeypatch.setattr(discord_bot.bot, name, getattr(fake, name))

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    discord_bracket._dirty.clear()
    return fake


async def configure(flow, channels=None):
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, "channels": channels or {"events": EVENTS}})
    assert response.status_code == 200, response.text
    await flow.db.games.insert_one({"id": "g1", "name": "Rocket League", "slug": "rl"})
    await flow.db.tournaments.insert_one({"id": "t1", "slug": "sommer-cup", "title": "Sommer-Cup", "description": "Das Vereinsturnier der Saison.", "game_id": "g1",
                                          "format": "single_elim", "max_participants": 8, "status": "scheduled", "is_public": True, "visibility": "public",
                                          "check_in_until": "2027-06-12T15:45:00+00:00"})
    await flow.db.tournament_registrations.insert_many([{**reg, "tournament_id": "t1", "status": "approved"} for reg in REGS])
    await flow.db.tournament_stages.insert_many(STAGES)
    await flow.db.matches_v2.insert_one(final_match())
    return admin


async def thread_state(flow, tournament_id="t1"):
    return (await flow.db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "discord_thread": 1})).get("discord_thread") or {}


@pytest.mark.asyncio
async def test_one_thread_per_tournament_from_every_status_source_with_the_final_standing_last(flow, discord, monkeypatch):
    await configure(flow)

    # Knopf der Turnierleitung: „Anmeldung offen“ steht im Kanal, darunter öffnet sich der Thread.
    response = await flow.post("/api/tournaments/t1/status", json={"status": "registration_open"})
    assert response.status_code == 200, response.text
    assert discord.titles(EVENTS) == ["🏆 Sommer-Cup · Anmeldung offen"]
    opener = discord.messages[EVENTS][0]["embed"]
    assert [field["value"] for field in opener["fields"]][:2] == ["Rocket League", "Single Elim"] and opener["description"] == "Das Vereinsturnier der Saison."
    state = await thread_state(flow)
    thread = state["thread_id"]
    assert state["channel_id"] == EVENTS and state["message_id"] == "m1" and thread == "th-m1"
    assert discord.threads[thread] == {"parent": EVENTS, "starter": "m1", "name": "🏆 Sommer-Cup"}

    # Formular: Check-in - kurz, im Thread.
    response = await flow.patch("/api/tournaments/t1", json={"status": "check_in"})
    assert response.status_code == 200, response.text
    checkin = discord.messages[thread][-1]["embed"]
    assert checkin["title"] == "🏆 Sommer-Cup · Check-in offen" and checkin["description"].startswith("Jetzt einchecken – bis 12.06.2027, 17:45 Uhr")
    assert "fields" not in checkin and "image" not in checkin

    # Station oder Gruppen schreiben den Status direkt: live, ebenfalls im Thread.
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": "live"}})
    await discord_threads.status_written(flow.db, "t1", "check_in")
    assert discord.titles(thread)[-1] == "🏆 Sommer-Cup · Jetzt live"

    # Ein Teilnehmer streamt: in den Thread.
    paula = await flow.add_user(role="player", name="paula")
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"privacy_public_profile": True}})
    await flow.db.tournament_registrations.update_one({"id": "r1"}, {"$set": {"user_id": paula["id"]}})
    await flow.db.live_streams.insert_one({"user_id": paula["id"], "username": "paula", "display_name": "Paula", "stream_id": "s1", "title": "Finale!",
                                           "stream_url": "https://twitch.tv/paula", "viewer_count": 3})
    assert (await tournament_streams.sync(flow.db))["announced"] == 1
    assert discord.titles(thread)[-1] == "🔴 Paula streamt den Sommer-Cup"

    # Das Bracket (#571) kommt in den Thread und wird dort angepinnt.
    t0 = now_utc()
    posted = await discord_bracket.refresh(flow.db, "t1", now=t0)
    assert posted["reason"] == "posted" and discord.titles(thread)[-1] == "🏆 Sommer-Cup – Bracket" and posted["message_id"] in discord.pinned
    bracket_id = posted["message_id"]
    assert (await thread_state(flow))["last_message_id"] == bracket_id

    # Zeitplan: Ende erreicht → „Beendet“ im Thread, danach wandert der Endstand ans Ende.
    from services import scheduler
    await flow.db.matches_v2.update_one({"id": "f"}, {"$set": final_match("completed", (3, 1))})
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"auto_start_enabled": True, "end_date": (t0 - timedelta(minutes=5)).isoformat()}})
    await scheduler._safe_status_transitions()
    assert (await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0, "status": 1}))["status"] == "completed"
    assert discord.titles(thread)[-1] == "🏆 Sommer-Cup · Beendet" and "t1" in discord_bracket.pending()
    final = await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(seconds=10))
    assert final["reason"] == "posted" and final["moved"] is True and final["final"] is True, final
    assert discord.titles(thread)[-1] == "🏆 Sommer-Cup – Endstand" and discord.messages[thread][-1]["embed"]["description"].startswith("🥇 Paula")
    assert bracket_id not in [row["id"] for row in discord.messages[thread]], "die alte Fassung ist weg - es gibt einen Endstand"

    # Danach noch „Ergebnisse veröffentlicht“: der Endstand bleibt die letzte Nachricht.
    response = await flow.post("/api/tournaments/t1/status", json={"status": "results_published"})
    assert response.status_code == 200, response.text
    assert discord.titles(thread)[-1] == "🏆 Sommer-Cup · Ergebnisse veröffentlicht"
    moved = await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(seconds=20))
    assert moved["moved"] is True and discord.titles(thread)[-1] == "🏆 Sommer-Cup – Endstand"
    assert sum(1 for title in discord.titles(thread) if title.endswith("Endstand")) == 1
    assert (await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(seconds=400)))["reason"] == "final", "nichts mehr darunter: Ruhe"

    # Der Kanal: genau eine Meldung - alles andere steht im Thread.
    assert discord.titles(EVENTS) == ["🏆 Sommer-Cup · Anmeldung offen"]
    assert discord.titles(thread) == ["🏆 Sommer-Cup · Check-in offen", "🏆 Sommer-Cup · Jetzt live", "🔴 Paula streamt den Sommer-Cup",
                                      "🏆 Sommer-Cup · Beendet", "🏆 Sommer-Cup · Ergebnisse veröffentlicht", "🏆 Sommer-Cup – Endstand"]
    logs = await flow.db.email_logs.find({"channel": "discord", "thread_id": thread}, {"_id": 0}).to_list(20)
    assert len(logs) == 5 and all(log["status"] == "sent" and log["channel_id"] == thread for log in logs), "im Versand-Log mit Thread"


@pytest.mark.asyncio
async def test_without_discord_or_not_public_nothing_reaches_discord(flow, discord):
    await configure(flow)
    response = await flow.patch("/api/tournaments/t1", json={"discord_skip": True})
    assert response.status_code == 200 and response.json()["discord_skip"] is True, response.text
    assert (await flow.post("/api/tournaments/t1/status", json={"status": "registration_open"})).status_code == 200
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": "live"}})
    await discord_threads.status_written(flow.db, "t1", "registration_open")
    assert (await discord_bracket.refresh(flow.db, "t1"))["reason"] == "author_opt_out"
    assert discord.messages == {} and discord.threads == {} and await thread_state(flow) == {}

    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"discord_skip": False, "visibility": "members"}})
    tournament = await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0})
    # Nur Mitglieder (#910): ohne Mitglieder-Kanal kommt nichts an - kein Rückfall auf einen öffentlichen Kanal.
    assert (await discord_threads.status_changed(flow.db, tournament, "live", "completed"))["reason"] == "members_channel_missing"
    assert discord.messages == {}, "nur Mitglieder: nie in einen öffentlichen Kanal"
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"visibility": "internal"}})
    tournament = await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0})
    assert (await discord_threads.status_changed(flow.db, tournament, "completed", "results_published"))["reason"] == "private_visibility"
    assert discord.messages == {}, "intern (nur Vorstand): gar nicht"


@pytest.mark.asyncio
async def test_without_thread_rights_messages_stay_in_the_channel_and_the_reason_is_shown(flow, discord):
    await configure(flow)
    discord.thread_answer = {"ok": False, "reason": "thread_forbidden"}
    assert (await flow.post("/api/tournaments/t1/status", json={"status": "registration_open"})).status_code == 200
    state = await thread_state(flow)
    assert state["thread_id"] is None and "Öffentliche Threads erstellen" in state["error"]
    failure = await flow.db.email_logs.find_one({"event_key": "tournament.thread"}, {"_id": 0})
    assert failure["status"] == "failed" and failure["reason"] == "thread_forbidden" and failure["target"] == "events"
    settings = (await flow.get("/api/settings/discord")).json()
    assert "Threads" in settings["target_status"]["events"]["last"]["error"], "der Kasten „Kanäle je Zweck“ sagt, was fehlt"
    from discord_service import broken_targets
    assert [row["reason"] for row in await broken_targets(flow.db)] == ["thread_forbidden"], "eine Aufgabe für die Tageszentrale"

    # Recht nachgetragen: die nächste Meldung steht im Kanal und öffnet den Thread, danach geht alles hinein.
    discord.thread_answer = None
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": "check_in"}})
    await discord_threads.status_written(flow.db, "t1", "registration_open")
    assert discord.titles(EVENTS) == ["🏆 Sommer-Cup · Anmeldung offen", "🏆 Sommer-Cup · Check-in offen"]
    thread = (await thread_state(flow))["thread_id"]
    assert thread == "th-m2"
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": "live"}})
    await discord_threads.status_written(flow.db, "t1", "check_in")
    assert discord.titles(thread) == ["🏆 Sommer-Cup · Jetzt live"] and len(discord.titles(EVENTS)) == 2


@pytest.mark.asyncio
async def test_deleted_thread_or_new_channel_starts_a_new_thread(flow, discord):
    await configure(flow)
    await flow.post("/api/tournaments/t1/status", json={"status": "registration_open"})
    first = (await thread_state(flow))["thread_id"]
    discord.gone.add(first)
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": "check_in"}})
    await discord_threads.status_written(flow.db, "t1", "registration_open")
    second = (await thread_state(flow))["thread_id"]
    assert second != first and discord.titles(EVENTS)[-1] == "🏆 Sommer-Cup · Check-in offen", "gelöscht: neu im Kanal, neuer Thread"

    # Der Betreiber wählt einen anderen Kanal: der alte Thread bleibt, wo er ist; das Turnier beginnt im neuen Kanal neu.
    await flow.put("/api/settings/discord", json={"channels": {"events": OTHER}})
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": "live"}})
    await discord_threads.status_written(flow.db, "t1", "check_in")
    state = await thread_state(flow)
    assert state["channel_id"] == OTHER and discord.titles(OTHER) == ["🏆 Sommer-Cup · Jetzt live"] and discord.threads[state["thread_id"]]["parent"] == OTHER


@pytest.mark.asyncio
async def test_the_preview_says_where_each_tournament_message_goes(flow):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    entries = {entry["key"]: entry for entry in (await flow.get("/api/settings/discord/samples")).json()["entries"]}
    assert entries["tournament.registration_open"]["place"] == "im Kanal · öffnet den Turnier-Thread"
    assert entries["tournament.registration_open"]["embed"]["fields"], "die Ankündigung mit Spiel, Format, Plätzen"
    for key in ("tournament.check_in", "tournament.live", "tournament.completed", "tournament.results_published", "tournament.stream_live"):
        assert entries[key]["place"] == "im Turnier-Thread", key
    assert "fields" not in entries["tournament.live"]["embed"] and entries["tournament.check_in"]["enabled"] is True
    assert "place" not in entries["news.published"]


MEMBERS = "100000000000000004"
MAIN_GUILD, GAME_GUILD, GAME_EVENTS = "500000000000000091", "500000000000000092", "100000000000000077"


async def with_game_server(flow):
    """Rocket League hat einen eigenen, eingeschalteten Server mit Kanal - öffentliche Turniere gingen dorthin (#627)."""
    await flow.db.discord_guilds.insert_many([
        {"guild_id": MAIN_GUILD, "name": "LION", "role": "main", "enabled": True},
        {"guild_id": GAME_GUILD, "name": "RL-Server", "role": "sub", "enabled": True, "channels": {"community": GAME_EVENTS, "events": GAME_EVENTS}},
    ])
    await flow.db.games.update_one({"id": "g1"}, {"$set": {"discord_guild_id": GAME_GUILD}})


@pytest.mark.asyncio
async def test_member_tournaments_post_in_the_members_channel_with_their_own_thread_and_bracket(flow, discord):
    """#910: Ein Turnier nur für Mitglieder meldet sich im Kanal „Mitglieder (privat)“ am Hauptserver - die Ankündigung
    öffnet einen eigenen Thread, Check-in, live, Streams und das Bracket stehen darin. Nie in „Events und Turniere“,
    nie auf dem Spielserver, auch wenn das Spiel einen hat."""
    await configure(flow, channels={"events": EVENTS, "members": MEMBERS})
    await with_game_server(flow)
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"visibility": "members"}})

    response = await flow.post("/api/tournaments/t1/status", json={"status": "registration_open"})
    assert response.status_code == 200, response.text
    assert discord.titles(MEMBERS) == ["🏆 Sommer-Cup · Anmeldung offen"]
    stored = await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0})
    thread = stored["discord_thread_members"]["thread_id"]
    assert discord.threads[thread]["parent"] == MEMBERS and "discord_thread" not in stored and "discord_thread_by_guild" not in stored

    assert (await flow.patch("/api/tournaments/t1", json={"status": "check_in"})).status_code == 200
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": "live"}})
    await discord_threads.status_written(flow.db, "t1", "check_in")
    paula = await flow.add_user(role="player", name="paula")
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"privacy_public_profile": True}})
    await flow.db.tournament_registrations.update_one({"id": "r1"}, {"$set": {"user_id": paula["id"]}})
    await flow.db.live_streams.insert_one({"user_id": paula["id"], "username": "paula", "display_name": "Paula", "stream_id": "s1", "title": "Finale!",
                                           "stream_url": "https://twitch.tv/paula", "viewer_count": 3})
    assert (await tournament_streams.sync(flow.db))["announced"] == 1
    posted = await discord_bracket.refresh(flow.db, "t1")
    assert posted["reason"] == "posted" and posted["message_id"] in discord.pinned
    assert discord.titles(thread) == ["🏆 Sommer-Cup · Check-in offen", "🏆 Sommer-Cup · Jetzt live", "🔴 Paula streamt den Sommer-Cup",
                                      "🏆 Sommer-Cup – Bracket"]
    assert (await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0}))["discord_thread_members"]["last_message_id"] == posted["message_id"]

    # Nichts davon öffentlich: kein Kanal „Events und Turniere“, kein Spielserver, kein Querverweis.
    assert EVENTS not in discord.messages and GAME_EVENTS not in discord.messages
    logs = await flow.db.email_logs.find({"channel": "discord"}, {"_id": 0, "target": 1, "status": 1, "guild_id": 1}).to_list(50)
    assert logs and all(log["target"] == "members" and log["status"] == "sent" and log.get("guild_id") == MAIN_GUILD for log in logs), logs
    # /bracket bietet es nicht an - die Antwort sähe auch, wer kein Mitglied ist.
    from services import discord_commands
    assert await discord_commands.bracket_choices(flow.db) == []


@pytest.mark.asyncio
async def test_a_public_bracket_message_never_gets_the_members_version(flow, discord):
    """Wird ein öffentliches Turnier nachträglich „nur für Mitglieder“, bearbeitet der Bot die öffentliche Bracket-Nachricht
    nicht weiter - das Bracket beginnt im Mitglieder-Kanal neu."""
    await configure(flow, channels={"events": EVENTS, "members": MEMBERS})
    assert (await flow.post("/api/tournaments/t1/status", json={"status": "registration_open"})).status_code == 200
    public_thread = (await thread_state(flow))["thread_id"]
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": "live"}})
    t0 = now_utc()
    first = await discord_bracket.refresh(flow.db, "t1", now=t0)
    assert first["reason"] == "posted" and discord.titles(public_thread)[-1] == "🏆 Sommer-Cup – Bracket"
    before = [dict(row) for row in discord.messages[public_thread]]

    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"visibility": "members"}})
    await flow.db.matches_v2.update_one({"id": "f"}, {"$set": final_match("live", (1, 0))})
    moved = await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(minutes=2))
    assert moved["reason"] == "posted" and moved["message_id"] != first["message_id"]
    assert discord.titles(MEMBERS) == ["🏆 Sommer-Cup – Bracket"]
    assert discord.messages[public_thread] == before, "die öffentliche Nachricht bleibt, wie sie war"


@pytest.mark.asyncio
async def test_the_bracket_lives_on_the_game_server_and_on_main_only_with_both_full(flow, discord):
    """#628: Hat das Spiel einen eigenen Server, steht das Bracket im Turnier-Thread dort; am Hauptserver steht nur der
    Querverweis - es sei denn, „Turnier: jetzt live“ steht auf „beide voll“. Der Endstand ist in jedem Thread der letzte."""
    await configure(flow)
    await with_game_server(flow)
    assert (await flow.post("/api/tournaments/t1/status", json={"status": "registration_open"})).status_code == 200
    stored = await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0})
    game_thread = stored["discord_thread_by_guild"][GAME_GUILD]["thread_id"]
    main_thread = stored["discord_thread"]["thread_id"]
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": "live"}})
    await discord_threads.status_written(flow.db, "t1", "registration_open")

    t0 = now_utc()
    posted = await discord_bracket.refresh(flow.db, "t1", now=t0)
    assert posted["reason"] == "posted" and list(posted["lanes"]) == [GAME_GUILD]
    assert discord.titles(game_thread)[-1] == "🏆 Sommer-Cup – Bracket" and "🏆 Sommer-Cup – Bracket" not in discord.titles(main_thread)
    stored = await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0})
    assert stored["discord_bracket_by_guild"][GAME_GUILD]["channel_id"] == game_thread and "discord_bracket_embed" not in stored

    # „Beide voll“: das Bracket kommt auch an den Hauptserver - in seinen Turnier-Thread.
    assert (await flow.put("/api/settings/discord", json={"routing": {"tournament.live": "both_full"}})).status_code == 200
    await flow.db.matches_v2.update_one({"id": "f"}, {"$set": final_match("live", (1, 0))})
    both = await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(minutes=2))
    assert set(both["lanes"]) == {GAME_GUILD, "main"} and both["lanes"]["main"]["reason"] == "posted" and both["lanes"][GAME_GUILD]["reason"] == "edited"
    assert discord.titles(main_thread)[-1] == "🏆 Sommer-Cup – Bracket"

    # Ende: „Beendet“ in beiden Threads, danach wandert der Endstand in beiden ans Ende.
    await flow.db.matches_v2.update_one({"id": "f"}, {"$set": final_match("completed", (3, 1))})
    assert (await flow.post("/api/tournaments/t1/status", json={"status": "completed"})).status_code == 200
    final = await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(minutes=3))
    assert all(lane["moved"] is True and lane["final"] is True for lane in final["lanes"].values()), final
    assert discord.titles(game_thread)[-1] == "🏆 Sommer-Cup – Endstand" and discord.titles(main_thread)[-1] == "🏆 Sommer-Cup – Endstand"
    assert (await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(minutes=9)))["reason"] == "final"
    assert (await discord_bracket.sweep(flow.db, full=True))["checked"] == 0, "alles im Endstand: der Sammler lässt das Turnier in Ruhe"


@pytest.mark.asyncio
async def test_a_game_server_that_refuses_the_bracket_hands_it_to_main(flow, discord):
    await configure(flow)
    await with_game_server(flow)
    discord.gone.add(GAME_EVENTS)
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": "live"}})
    result = await discord_bracket.refresh(flow.db, "t1")
    assert result["lanes"][GAME_GUILD]["reason"] == "unknown_channel" and result["lanes"]["main"]["reason"] == "posted"
    assert discord.titles(EVENTS) == ["🏆 Sommer-Cup – Bracket"], "voll am Hauptserver statt nirgends"
