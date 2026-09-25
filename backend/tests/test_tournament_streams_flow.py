"""„Turnier live“ (#579): die Turnierseite zeigt die Streams der Teilnehmer, und der Bot meldet jeden
Stream-Start genau einmal - nur öffentliche Turniere, nur Teilnehmer mit öffentlichem Profil."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402
from services import discord_bot, tournament_streams  # noqa: E402
from services.discord_announcements import stream_live_message  # noqa: E402

EVENTS_CHANNEL = "100000000000000003"


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

    async def fake_send_embed(channel_id, embed):
        calls.append({"channel_id": channel_id, "embed": embed})
        return {"ok": True, "message_id": f"m{len(calls)}", "channel_id": channel_id}

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "send_embed", fake_send_embed)
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    return calls


async def streamer(flow, name: str, *, public: bool = True, twitch_private: bool = False) -> dict:
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"display_name": name.capitalize(), "privacy_public_profile": public, "twitch_handle": name,
                                                                "profile_visibility": {"twitch": "private" if twitch_private else "public"}}})
    return user


async def live(flow, user: dict, stream_id: str, title: str = "Ranked Grind", viewers: int = 12):
    await flow.db.live_streams.insert_one({"user_id": user["id"], "username": user["username"], "display_name": user["username"].capitalize(), "twitch_login": user["username"],
                                           "stream_id": stream_id, "title": title, "game_name": "Rocket League", "viewer_count": viewers,
                                           "thumbnail_url": "https://static-cdn.jtvnw.net/previews-ttv/live_user_x-640x360.jpg", "started_at": "2026-09-25T18:00:00Z",
                                           "stream_url": f"https://twitch.tv/{user['username']}", "updated_at": "2026-09-25T18:01:00Z"})


def test_stream_live_message_is_the_single_source():
    message = stream_live_message({"id": "t1", "slug": "sommer-cup", "title": "Sommer-Cup"},
                                  {"display_name": "Paula", "title": "Finale!", "game_name": "Rocket League", "viewer_count": 12, "stream_url": "https://twitch.tv/paula",
                                   "thumbnail_url": "https://static-cdn.jtvnw.net/x.jpg"})
    assert message["event_key"] == "tournament.stream_live" and message["title"] == "🔴 Paula streamt den Sommer-Cup"
    assert "Finale!" in message["description"] and "zuschauen" in message["description"].lower() and message["url"] == "https://twitch.tv/paula"
    assert [f["value"] for f in message["fields"]] == ["Sommer-Cup", "Rocket League"] and message["image_url"].endswith("x.jpg")


@pytest.mark.asyncio
async def test_tournament_page_lists_participant_streams_only_for_public_people(flow):
    paula = await streamer(flow, "paula")
    leon = await streamer(flow, "leon", public=False)
    mira = await streamer(flow, "mira", twitch_private=True)
    kai = await streamer(flow, "kai")
    await flow.db.tournaments.insert_one({"id": "t1", "slug": "sommer-cup", "title": "Sommer-Cup", "status": "live", "is_public": True, "visibility": "public"})
    await flow.db.tournaments.insert_one({"id": "t2", "slug": "geheim", "title": "Geheim", "status": "live", "is_public": False})
    await flow.db.teams.insert_one({"id": "team1", "name": "Team Lions"})
    await flow.db.team_members.insert_one({"id": new_id(), "team_id": "team1", "user_id": kai["id"], "role": "member"})
    await flow.db.tournament_registrations.insert_many([
        {"id": "r1", "tournament_id": "t1", "user_id": paula["id"], "status": "confirmed"},
        {"id": "r2", "tournament_id": "t1", "user_id": leon["id"], "status": "confirmed"},
        {"id": "r3", "tournament_id": "t1", "user_id": mira["id"], "status": "confirmed"},
        {"id": "r4", "tournament_id": "t1", "team_id": "team1", "status": "confirmed"},
        {"id": "r5", "tournament_id": "t2", "user_id": paula["id"], "status": "confirmed"},
    ])
    for user, stream_id in ((paula, "s-paula"), (leon, "s-leon"), (mira, "s-mira"), (kai, "s-kai")):
        await live(flow, user, stream_id)

    rows = (await flow.get("/api/tournaments/sommer-cup/streams")).json()
    assert [row["username"] for row in rows] == ["paula", "kai"], "Leon ohne öffentliches Profil, Mira mit Twitch auf privat fehlen"
    assert rows[0]["public_profile_url"] == "/u/paula" and rows[0]["stream_url"] == "https://twitch.tv/paula" and rows[0]["viewer_count"] == 12
    assert "user_id" in rows[0] and "twitch_login" in rows[0]
    assert (await flow.get("/api/tournaments/geheim/streams")).status_code == 404
    assert (await flow.get("/api/tournaments/gibt-es-nicht/streams")).status_code == 404


@pytest.mark.asyncio
async def test_discord_announces_each_stream_start_once(flow, posted):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    await flow.put("/api/settings/discord", json={"channels": {"events": EVENTS_CHANNEL}, "events": {"tournament.stream_live": True},
                                                  "bot_token": "test" * 6 + ".fake." + "token" * 8, "bot_enabled": True})
    paula = await streamer(flow, "paula")
    hidden = await streamer(flow, "leon", public=False)
    await flow.db.tournaments.insert_many([
        {"id": "t1", "slug": "sommer-cup", "title": "Sommer-Cup", "status": "live", "is_public": True, "visibility": "public"},
        {"id": "t3", "slug": "vorbei", "title": "Vorbei", "status": "completed", "is_public": True},
        {"id": "t4", "slug": "intern", "title": "Intern", "status": "live", "is_public": True, "visibility": "members"},
    ])
    await flow.db.tournament_registrations.insert_many([
        {"id": "r1", "tournament_id": "t1", "user_id": paula["id"], "status": "confirmed"},
        {"id": "r2", "tournament_id": "t3", "user_id": paula["id"], "status": "confirmed"},
        {"id": "r3", "tournament_id": "t4", "user_id": paula["id"], "status": "confirmed"},
        {"id": "r4", "tournament_id": "t1", "user_id": hidden["id"], "status": "confirmed"},
    ])
    await live(flow, paula, "s-1", title="Finale!")
    await live(flow, hidden, "s-2")

    first = await tournament_streams.sync(flow.db)
    assert first["announced"] == 1, first
    assert len(posted) == 1 and posted[0]["channel_id"] == EVENTS_CHANNEL
    embed = posted[0]["embed"]
    assert embed["title"] == "🔴 Paula streamt den Sommer-Cup" and "Finale!" in embed["description"] and embed["url"] == "https://twitch.tv/paula"
    assert "Leon" not in str(posted), "kein öffentliches Profil = keine Meldung"

    assert (await tournament_streams.sync(flow.db))["announced"] == 0, "genau einmal je Stream-Start"
    assert len(posted) == 1
    await flow.db.live_streams.update_one({"user_id": paula["id"]}, {"$set": {"stream_id": "s-9"}})
    assert (await tournament_streams.sync(flow.db))["announced"] == 1, "ein neuer Stream ist ein neuer Start"
    records = await flow.db.tournament_stream_announcements.find({}, {"_id": 0}).to_list(10)
    assert sorted(r["stream_id"] for r in records) == ["s-1", "s-9"] and all(r["outcome"] == "sent" for r in records)

    samples = (await flow.get("/api/settings/discord/samples")).json()
    assert any(entry["key"] == "tournament.stream_live" for entry in samples["entries"]), "die Vorschau kennt die Meldung"
