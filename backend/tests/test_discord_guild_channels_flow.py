"""Kanalziele je Server (#625, Discord VI) durch die echte Anwendung: Community, News und Events auf jedem Server;
Vorstand, Betrieb, Test und Mitglieder nur am Hauptserver; Rückfall nur innerhalb eines Servers, nie über Servergrenzen;
ein ausgeschalteter oder verlassener Server bekommt nichts; jeder Aufrufer von send_to ist gezählt."""
import pathlib
import re
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import discord_service  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import discord_bot, discord_guilds  # noqa: E402

BACKEND = pathlib.Path(__file__).resolve().parent.parent
MAIN, SUB, GONE = "500000000000000001", "500000000000000002", "500000000000000003"
MAIN_COMMUNITY, MAIN_BOARD, MAIN_TEST = "100000000000000001", "100000000000000004", "100000000000000008"
SUB_COMMUNITY, SUB_NEWS = "200000000000000001", "200000000000000002"
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


@pytest.fixture
def posted(monkeypatch):
    calls = []

    async def fake_send(channel_id, embed, buttons=None):
        calls.append({"channel_id": channel_id, "title": embed.get("title")})
        return {"ok": True, "message_id": f"m{len(calls)}", "channel_id": channel_id}

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "send_embed", fake_send)
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    return calls


async def setup(flow):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True,
                                                              "channels": {"community": MAIN_COMMUNITY, "board": MAIN_BOARD, "test": MAIN_TEST}})
    assert response.status_code == 200, response.text
    await discord_guilds.reconcile(flow.db, [seen(MAIN, "Haupt"), seen(SUB, "Rocket League"), seen(GONE, "Alt")], configured_main=MAIN)
    await discord_guilds.reconcile(flow.db, [seen(MAIN, "Haupt"), seen(SUB, "Rocket League")])   # GONE verlassen
    return admin


def test_resolve_target_every_combination():
    cfg = {"channels": {"community": "c", "news": "n", "board": "b"}}
    assert discord_service.resolve_target(cfg, "news") == {"target": "news", "channel_id": "n", "fallback": False}
    assert discord_service.resolve_target(cfg, "events") == {"target": "community", "channel_id": "c", "fallback": True}
    assert discord_service.resolve_target(cfg, "ops") == {"target": "ops", "channel_id": "", "fallback": False}
    main = {"guild_id": "1", "role": "main", "channels": {"community": "x"}}
    assert discord_service.resolve_target(cfg, "news", main)["channel_id"] == "n", "der Hauptserver nimmt die „Kanäle je Zweck“"
    sub = {"guild_id": "2", "role": "sub", "channels": {"community": "sc", "news": "sn"}}
    assert discord_service.resolve_target(cfg, "news", sub) == {"target": "news", "channel_id": "sn", "fallback": False, "guild_id": "2"}
    assert discord_service.resolve_target(cfg, "events", sub) == {"target": "community", "channel_id": "sc", "fallback": True, "guild_id": "2"}
    for private in ("board", "ops", "test", "members"):
        assert discord_service.resolve_target(cfg, private, sub)["error"] == "private_on_sub", private
    bare = {"guild_id": "3", "role": "sub", "channels": {}}
    assert discord_service.resolve_target(cfg, "news", bare)["channel_id"] == "", "nie auf den Kanal eines anderen Servers"


@pytest.mark.asyncio
async def test_send_to_a_sub_server_only_public_only_when_switched_on(flow, posted):
    await setup(flow)
    db = flow.db
    await discord_guilds.update_guild(db, SUB, {"channels": {"community": SUB_COMMUNITY, "news": SUB_NEWS}})

    off = await discord_service.send_to("news", "Aus", guild_id=SUB)
    assert off["reason"] == "guild_disabled" and posted == [], "ausgeschaltet: nichts"
    await discord_guilds.update_guild(db, SUB, {"enabled": True})
    assert (await discord_service.send_to("news", "News", guild_id=SUB))["ok"] is True and posted[-1]["channel_id"] == SUB_NEWS
    assert (await discord_service.send_to("events", "Event", guild_id=SUB))["ok"] is True and posted[-1]["channel_id"] == SUB_COMMUNITY
    blocked = await discord_service.send_to("board", "Vorstand", guild_id=SUB)
    assert blocked["reason"] == "private_on_sub" and "nur am Hauptserver" in blocked["error"] and len(posted) == 2
    log = await db.email_logs.find_one({"title": "Vorstand"}, {"_id": 0})
    assert log["status"] == "skipped" and log["guild_id"] == SUB, "Fehler mit Protokoll, keine Nachricht"
    assert (await discord_service.send_to("news", "Weg", guild_id=GONE))["reason"] == "guild_left"
    assert (await discord_service.send_to("news", "Wer?", guild_id="999999999999999999"))["reason"] == "unknown_guild"

    # Der Hauptserver - mit oder ohne Angabe - wie bisher.
    assert (await discord_service.send_to("board", "Antrag", guild_id=MAIN))["ok"] is True and posted[-1]["channel_id"] == MAIN_BOARD
    assert (await discord_service.send_to("news", "Haupt"))["ok"] is True and posted[-1]["channel_id"] == MAIN_COMMUNITY
    # Ereignisse reichen den Server durch.
    assert (await discord_service.send_event("tournament.live", "Live", item={"visibility": "public"}, guild_id=SUB))["ok"] is True
    assert posted[-1]["channel_id"] == SUB_COMMUNITY


@pytest.mark.asyncio
async def test_channels_per_server_and_switching_the_main_server_moves_them(flow, posted):
    await setup(flow)
    db = flow.db
    assert (await db.discord_guilds.find_one({"guild_id": MAIN}))["channels"] == {"community": MAIN_COMMUNITY, "board": MAIN_BOARD, "test": MAIN_TEST}
    with pytest.raises(discord_guilds.GuildError, match="nur am Hauptserver"):
        await discord_guilds.update_guild(db, SUB, {"channels": {"board": "200000000000000009"}})
    with pytest.raises(discord_guilds.GuildError, match="Kanäle je Zweck"):
        await discord_guilds.update_guild(db, MAIN, {"channels": {"news": "100000000000000002"}})
    with pytest.raises(discord_guilds.GuildError, match="17 bis 20"):
        await discord_guilds.update_guild(db, SUB, {"channels": {"news": "12"}})
    await discord_guilds.update_guild(db, SUB, {"channels": {"community": SUB_COMMUNITY, "news": SUB_NEWS}})
    await discord_guilds.update_guild(db, SUB, {"channels": {"news": ""}})
    assert (await db.discord_guilds.find_one({"guild_id": SUB}))["channels"] == {"community": SUB_COMMUNITY}, "leer entfernt das Ziel"

    # „Kanäle je Zweck“ speichern spiegelt in den Hauptserver.
    await flow.put("/api/settings/discord", json={"channels": {"news": "100000000000000002"}})
    assert (await db.discord_guilds.find_one({"guild_id": MAIN}))["channels"]["news"] == "100000000000000002"

    # Hauptserver wechseln: die Kanäle wandern mit, private sind neu zu wählen.
    await discord_guilds.update_guild(db, SUB, {"role": "main"})
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0, "channels": 1})
    assert settings["channels"] == {"community": SUB_COMMUNITY}
    old_main = await db.discord_guilds.find_one({"guild_id": MAIN})
    assert old_main["role"] == "sub" and old_main["channels"] == {"community": MAIN_COMMUNITY, "news": "100000000000000002"}, "nur die öffentlichen"
    assert (await discord_service.send_to("board", "Antrag"))["reason"] == "board_channel_missing", "privat nie über Servergrenzen"


@pytest.mark.asyncio
async def test_channel_list_per_server_and_preview_per_server(flow, posted, monkeypatch):
    await setup(flow)

    async def fake_list(guild_id=""):
        return {"ok": True, "channels": [{"id": SUB_COMMUNITY, "name": "allgemein", "category": "", "can_send": True, "can_embed": True}]} if guild_id == SUB else {"ok": False}

    monkeypatch.setattr(discord_bot.bot, "list_channels", fake_list)
    listing = (await flow.get(f"/api/settings/discord/guilds/{SUB}/channels")).json()
    assert listing["channels"][0]["name"] == "allgemein"
    assert (await flow.get("/api/settings/discord/guilds/999/channels")).status_code == 404

    await discord_guilds.update_guild(flow.db, SUB, {"channels": {"community": SUB_COMMUNITY}, "enabled": True})
    samples = (await flow.get(f"/api/settings/discord/samples?guild={SUB}")).json()
    assert samples["guild"] == SUB and [row["guild_id"] for row in samples["guilds"]] == [MAIN, SUB], "verlassene fehlen, Hauptserver zuerst"
    by_key = {entry["key"]: entry for entry in samples["entries"]}
    assert by_key["membership.application"]["only_main"] is True and by_key["membership.application"]["delivers_to"] is None
    assert by_key["tournament.live"]["delivers_to"] == "community"
    assert "only_main" not in (await flow.get("/api/settings/discord/samples")).json()["entries"][0]


def test_every_send_to_caller_names_its_server_or_means_the_main_server():
    """Jeder Aufrufer von send_to ist hier gezählt - ein neuer muss sagen, welchen Server er meint (#625)."""
    expected = {
        # send_event: ausdrücklicher Server oder Thread; nach der Regel (#627) Spielserver oder Hauptserver, Querverweis,
        # voll am Hauptserver; send_discord und send_ops_discord meinen den Hauptserver.
        "discord_service.py": 6,
        # Querverweis im Turnier-Thread am Hauptserver (#627); Mitglieder-Turnier im Mitglieder-Kanal am Hauptserver (#910)
        "services/discord_threads.py": 2,
        "routes/settings_routes.py": 2,   # erneut senden (guild_id aus dem Log), Test je Ziel (Hauptserver)
        "services/discord_guilds.py": 1,  # Test am Hauptserver (Unterserver gehen direkt in den Systemkanal)
        "services/discord_samples.py": 1, # Vorschau-Test in den Testkanal des Hauptservers
    }
    found = {}
    for path in BACKEND.rglob("*.py"):
        relative = path.relative_to(BACKEND).as_posix()
        if relative.startswith(("tests/", "venv", ".venv")):
            continue
        count = len(re.findall(r"(?<!def )\bsend_to\(", path.read_text(encoding="utf-8")))
        if count:
            found[relative] = count
    assert found == expected
