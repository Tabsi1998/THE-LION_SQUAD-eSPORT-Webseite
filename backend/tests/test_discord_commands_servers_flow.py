"""Slash-Befehle je Server (#630, Discord VI D7) durch die echte Anwendung: registriert auf dem Hauptserver und jedem
eingeschalteten Unterserver (ausgeschaltete verlieren sie wieder), auf einem Spielserver zeigen /turniere,
/naechstes-event und /bracket nur dessen Spiele - `spiel:` wählt ein anderes, `alle: True` zeigt alles; /status nennt
den Server, seine Spiele und Kanäle. Jede Antwort sieht nur die fragende Person."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_bot, discord_commands, discord_guilds  # noqa: E402

MAIN, COD, OFF, EMPTY = "800000000000000001", "800000000000000002", "800000000000000003", "800000000000000004"
COD_EVENTS = "100000000000000081"
ALL = {key: True for key, _, _ in discord_guilds.PERMISSIONS}


def seen(guild_id, name):
    return {"guild_id": guild_id, "name": name, "icon_url": None, "member_count": 10, "bot_permissions": dict(ALL)}


def soon(days: int) -> str:
    return (now_utc() + timedelta(days=days)).isoformat()


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def servers(flow):
    """Hauptserver LION, eingeschaltet CoD-Server (mit Kanal) und „Leer“ (ohne Spiel), ausgeschaltet „Alt“."""
    db = flow.db
    await discord_guilds.reconcile(db, [seen(MAIN, "LION"), seen(COD, "CoD-Server"), seen(OFF, "Alt"), seen(EMPTY, "Leer")], configured_main=MAIN)
    await discord_guilds.update_guild(db, COD, {"enabled": True, "channels": {"events": COD_EVENTS}})
    await discord_guilds.update_guild(db, EMPTY, {"enabled": True})
    await db.games.insert_many([
        {"id": "g-cod", "name": "Call of Duty", "slug": "cod", "discord_guild_id": COD},
        {"id": "g-mw3", "name": "MW3", "slug": "mw3", "kind": "edition", "parent_game_id": "g-cod"},
        {"id": "g-rl", "name": "Rocket League", "slug": "rl"},
    ])
    await db.events.insert_many([
        {"id": "e-fest", "slug": "fest", "name": "Sommerfest", "status": "scheduled", "visibility": "public", "start_date": soon(2)},
        {"id": "e-lan", "slug": "lan", "name": "LAN-Party", "status": "scheduled", "visibility": "public", "start_date": soon(5)},
    ])
    await db.tournaments.insert_many([
        {"id": "t-cod", "slug": "cod-cup", "title": "CoD-Cup", "game_id": "g-mw3", "event_id": "e-lan", "status": "registration_open",
         "is_public": True, "visibility": "public", "start_date": soon(5)},
        {"id": "t-rl", "slug": "rl-cup", "title": "RL-Cup", "game_id": "g-rl", "status": "registration_open", "is_public": True, "visibility": "public",
         "start_date": soon(6)},
        {"id": "t-vm", "slug": "vm", "title": "Vereinsmeisterschaft", "game_id": "g-cod", "status": "registration_open", "is_public": True,
         "visibility": "members", "start_date": soon(7)},
        {"id": "t-live-cod", "slug": "cod-live", "title": "CoD-Abend", "game_id": "g-cod", "status": "live", "is_public": True, "visibility": "public",
         "start_date": soon(-1)},
        {"id": "t-live-rl", "slug": "rl-live", "title": "RL-Abend", "game_id": "g-rl", "status": "live", "is_public": True, "visibility": "public",
         "start_date": soon(-2)},
    ])


def test_commands_go_to_main_and_every_switched_on_sub_server():
    rows = {MAIN: {"role": "main", "enabled": True}, COD: {"role": "sub", "enabled": True}, OFF: {"role": "sub", "enabled": False},
            EMPTY: {"role": "sub", "enabled": True, "left_at": "2026-10-01"}}
    assert discord_bot.command_targets(rows, [MAIN, COD, OFF, EMPTY], MAIN) == ([MAIN, COD], [OFF, EMPTY])
    # Allererster Start, noch kein Verzeichnis: nur der Hauptserver (eingetragen oder der erste).
    assert discord_bot.command_targets({}, [COD, MAIN], MAIN) == ([MAIN], [COD])
    assert discord_bot.command_targets({}, [COD, MAIN], "") == ([COD], [MAIN])


class FakeGuild:
    def __init__(self, guild_id, name):
        self.id = int(guild_id)
        self.name = name


class FakeTree:
    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.refuse: set[str] = set()

    def copy_global_to(self, *, guild):
        self.calls.append(("copy", str(guild.id)))

    def clear_commands(self, *, guild):
        self.calls.append(("clear", str(guild.id)))

    async def sync(self, *, guild=None):
        if guild is not None and str(guild.id) in self.refuse:
            raise RuntimeError("403 Forbidden (error code: 50001): Missing Access")
        self.calls.append(("sync", str(guild.id) if guild is not None else "global"))


class FakeClient:
    def __init__(self, guilds):
        self.guilds = guilds


@pytest.mark.asyncio
async def test_registration_follows_the_switch_and_one_refusing_server_does_not_stop_the_others(flow, monkeypatch):
    await servers(flow)
    runner = discord_bot.BotRunner()
    tree = FakeTree()
    guilds = [FakeGuild(guild_id, name) for guild_id, name in ((MAIN, "LION"), (COD, "CoD-Server"), (OFF, "Alt"), (EMPTY, "Leer"))]
    runner._client, runner._tree, runner.connected, runner._view = FakeClient(guilds), tree, True, {"guild_id": MAIN}
    first = await runner.sync_commands()
    assert first == {"ok": True, "registered": [MAIN, COD, EMPTY], "removed": [], "errors": []}
    assert ("sync", "global") not in tree.calls and ("clear", OFF) not in tree.calls, "nie global, und ein Server ohne Befehle braucht kein Aufräumen"
    stored = {row["guild_id"]: row for row in await flow.db.discord_guilds.find({}, {"_id": 0}).to_list(10)}
    assert stored[COD]["commands_at"] and "commands_at" not in stored[OFF]

    # Ausschalten über den Admin: die Befehle verschwinden dort sofort - der Bot muss nicht neu starten.
    monkeypatch.setattr(discord_bot, "bot", runner)
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    tree.calls.clear()
    assert (await flow.patch(f"/api/settings/discord/guilds/{COD}", json={"enabled": False})).status_code == 200
    assert ("clear", COD) in tree.calls and ("sync", COD) in tree.calls and ("copy", COD) not in tree.calls
    assert "commands_at" not in await flow.db.discord_guilds.find_one({"guild_id": COD}, {"_id": 0})
    tree.calls.clear()
    assert (await flow.patch(f"/api/settings/discord/guilds/{COD}", json={"note": "nur eine Notiz"})).status_code == 200
    assert tree.calls == [], "eine Notiz registriert nichts neu"

    # Ein Server verweigert: die anderen bekommen ihre Befehle trotzdem, der Fehler steht in Worten da.
    tree.refuse.add(EMPTY)
    second = await runner.sync_commands()
    assert second["registered"] == [MAIN] and second["ok"] is False and second["errors"][0].startswith("Leer: 403")
    report = await discord_guilds.health(flow.db, MAIN)
    assert any(check["key"] == "commands" and check["ok"] for check in report["checks"])

    runner.connected = False
    assert (await runner.sync_commands())["reason"] == "bot_offline"


@pytest.mark.asyncio
async def test_a_game_server_answers_with_its_games_and_spiel_or_alle_override(flow):
    await servers(flow)
    db = flow.db
    cod = (await discord_commands.answer_turniere(db, COD, base_url="https://lionsquad.at"))["content"]
    assert "CoD-Cup" in cod and "RL-Cup" not in cod and "Vereinsmeisterschaft" not in cod, "Edition MW3 gehört zu Call of Duty; Mitglieder-Turniere nie"
    assert cod.endswith("-# Nur Call of Duty – `alle: True` zeigt alles.")
    main = (await discord_commands.answer_turniere(db, MAIN))["content"]
    assert "CoD-Cup" in main and "RL-Cup" in main and "-#" not in main
    everything = (await discord_commands.answer_turniere(db, COD, alle=True))["content"]
    assert "CoD-Cup" in everything and "RL-Cup" in everything
    picked = (await discord_commands.answer_turniere(db, COD, spiel="g-rl"))["content"]
    assert "RL-Cup" in picked and "CoD-Cup" not in picked and "Nur Rocket League" in picked
    typed = (await discord_commands.answer_turniere(db, MAIN, spiel="rocket"))["content"]
    assert "RL-Cup" in typed and "CoD-Cup" not in typed
    assert "kenne ich nicht" in (await discord_commands.answer_turniere(db, MAIN, spiel="Tetris"))["content"]
    assert (await discord_commands.answer_turniere(db, EMPTY))["content"] == discord_commands.NO_GAMES
    assert "RL-Cup" in (await discord_commands.answer_turniere(db, OFF))["content"], "ein ausgeschalteter Server filtert nicht"
    assert [row["name"] for row in await discord_commands.game_choices(db)] == ["Call of Duty", "Rocket League", "MW3"]
    assert await discord_commands.game_choices(db, "ro") == [{"name": "Rocket League", "value": "g-rl"}]

    # Nächstes Event: auf dem Spielserver das nächste mit einem Turnier seiner Spiele.
    assert "LAN-Party" in (await discord_commands.answer_naechstes_event(db, COD))["content"]
    assert "Sommerfest" in (await discord_commands.answer_naechstes_event(db, MAIN))["content"]
    assert "Sommerfest" in (await discord_commands.answer_naechstes_event(db, COD, alle=True))["content"]
    assert "kein Event geplant" in (await discord_commands.answer_naechstes_event(db, COD, spiel="g-rl"))["content"]

    # Bracket: die Auswahl zeigt die Turniere des Servers; ein ausdrücklich gewähltes geht überall.
    assert await discord_commands.bracket_choices(db, guild_id=COD) == [{"name": "CoD-Abend", "value": "t-live-cod"}]
    assert {row["value"] for row in await discord_commands.bracket_choices(db, guild_id=MAIN)} == {"t-live-cod", "t-live-rl"}
    assert (await discord_commands.answer_bracket(db, guild_id=COD))["embed"]["title"].startswith("🏆 CoD-Abend"), "läuft nur eins hier: dieses"
    assert (await discord_commands.answer_bracket(db, "t-live-rl", guild_id=COD))["embed"]["title"].startswith("🏆 RL-Abend")


@pytest.mark.asyncio
async def test_status_names_the_server_its_games_and_channels(flow):
    await servers(flow)
    db = flow.db
    await db.settings.update_one({"id": "discord"}, {"$set": {"id": "discord", "channels": {"events": "100000000000000003", "board": "100000000000000005"},
                                                              "embeds": {"ranking": {"updated_at": "2026-10-05T10:00:00+00:00"}}}}, upsert=True)
    cod = await discord_commands.server_status_lines(db, COD)
    assert cod == ["Dieser Server: CoD-Server (Unterserver · an)", "Spiele: Call of Duty, MW3", f"Kanäle: Events und Turniere <#{COD_EVENTS}>",
                   "Einbettungen zuletzt aktualisiert: –"]
    main = await discord_commands.server_status_lines(db, MAIN)
    assert main[0] == "Dieser Server: LION (Hauptserver)" and main[1] == "Spiele: alle ohne eigenen Server"
    assert main[2] == "Kanäle: Events und Turniere <#100000000000000003>, Vorstand <#100000000000000005>"
    assert main[3] == "Einbettungen zuletzt aktualisiert: 05.10.2026, 12:00 Uhr"
    assert (await discord_commands.server_status_lines(db, "900000000000000000"))[0].startswith("Dieser Server: nicht im Server-Verzeichnis")


class FakeResponse:
    def __init__(self):
        self.deferred: dict | None = None

    async def defer(self, **kwargs):
        self.deferred = kwargs


class FakeFollowup:
    def __init__(self):
        self.sent: list[dict] = []

    async def send(self, **kwargs):
        self.sent.append(kwargs)


class FakeInteraction:
    def __init__(self):
        self.response = FakeResponse()
        self.followup = FakeFollowup()


@pytest.mark.asyncio
async def test_every_answer_is_only_for_the_asking_person(flow):
    await servers(flow)
    interaction = FakeInteraction()
    await discord_bot.bot._reply(interaction, lambda: discord_commands.answer_turniere(flow.db, COD))
    assert interaction.response.deferred == {"ephemeral": True, "thinking": True}
    assert interaction.followup.sent[0]["ephemeral"] is True and "CoD-Cup" in interaction.followup.sent[0]["content"]

    async def broken():
        raise RuntimeError("kaputt")

    failed = FakeInteraction()
    await discord_bot.bot._reply(failed, broken)
    assert failed.followup.sent == [{"content": "Das hat gerade nicht geklappt – versuch es gleich noch einmal.", "ephemeral": True}]
