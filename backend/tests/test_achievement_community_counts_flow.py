"""Erfolge sauber zählen (#2338): Chat, Discord, Verein und Profil - je Fund ein Ablauf gegen die echten Zähler."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import achievement_progress  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def stamp(day: str, hour: int, minute: int = 0) -> str:
    return f"{day}T{hour:02d}:{minute:02d}:00+00:00"


# ---------------------------------------------------------------- Chat (H3, H4)

@pytest.mark.asyncio
async def test_plauderer_has_one_definition_whatever_source_triggers_it(flow):
    """H3: früher rechnete die Registry „Turnier- und Match-Chat“, der alte Block „alle Chats“ - der Wert sprang je nach
    Auslöser. Jetzt gilt der Katalog-Text: Turnier- und Match-Chat."""
    me = await flow.add_user(name="plauderin")
    db = flow.db
    await db.direct_messages.insert_many([{"id": f"d{i}", "sender_id": me["id"], "recipient_id": "x", "message": "hi", "created_at": stamp("2026-09-01", 10)} for i in range(3)])
    await db.team_chat_messages.insert_many([{"id": f"t{i}", "team_id": "tm", "user_id": me["id"], "message": "hi", "created_at": stamp("2026-09-01", 10)} for i in range(2)])
    await db.tournament_chat_messages.insert_one({"id": "tc", "tournament_id": "t", "user_id": me["id"], "message": "hi", "created_at": stamp("2026-09-01", 10)})
    await db.match_chat_messages.insert_one({"id": "mc", "match_id": "m", "user_id": me["id"], "message": "gg", "created_at": stamp("2026-09-01", 11)})

    partial = await counters.refresh(me["id"], {"team"})
    community = await counters.refresh(me["id"], {"community"})
    full = await counters.refresh(me["id"])
    assert partial["community_messages_sent"] == community["community_messages_sent"] == full["community_messages_sent"] == 2
    assert "community_messages_sent" not in counters.REGISTRY, "nur eine Rechnung"
    assert (full["direct_messages_sent"], full["team_chat_messages_sent"]) == (3, 2)


@pytest.mark.asyncio
async def test_held_rejected_and_deleted_messages_never_count(flow):
    me = await flow.add_user(name="filterfall")
    db = flow.db
    rows = [
        {"id": "ok", "moderation": None},
        {"id": "flagged", "moderation": {"state": "flagged"}},
        {"id": "released", "moderation": {"state": "released"}},
        {"id": "held", "moderation": {"state": "held"}},
        {"id": "rejected", "moderation": {"state": "rejected"}},
        {"id": "gone", "deleted_at": stamp("2026-09-02", 9)},
    ]
    for collection, field in achievement_progress.CHAT_COLLECTIONS.values():
        await db[collection].insert_many([{**{k: v for k, v in row.items() if v is not None}, "id": f"{collection}-{row['id']}", field: me["id"],
                                           "message": "x", "created_at": stamp("2026-09-02", 8), "sticker": {"id": f"s-{row['id']}"}} for row in rows])
    values = await counters.compute(me["id"])
    for key in ("direct_messages_sent", "team_chat_messages_sent", "match_chat_messages_sent", "tournament_chat_messages_sent"):
        assert values[key] == 3, key
    assert values["community_messages_sent"] == 6
    assert values["stickers_collected"] == 3, "auch Sticker zählen nur aus sichtbaren Nachrichten"


@pytest.mark.asyncio
async def test_at_most_fifty_counted_messages_per_vienna_day(flow):
    me = await flow.add_user(name="vielschreiber")
    db = flow.db
    # 60 am 1.9. (Wien), dazu 3 um 22:30 UTC - in Wien schon der 2.9. - und 2 am 3.9.
    busy = [stamp("2026-09-01", 8 + i // 60, i % 60) for i in range(60)]
    late = [stamp("2026-09-01", 22, 30 + i) for i in range(3)]
    other = [stamp("2026-09-03", 12, i) for i in range(2)]
    await db.team_chat_messages.insert_many([{"id": f"tm{i}", "team_id": "tm", "user_id": me["id"], "message": "x", "created_at": when} for i, when in enumerate(busy + late + other)])
    # Offene Chats: 40 Turnier- und 40 Match-Nachrichten am selben Tag - zusammen gedeckelt, je Chat nicht.
    await db.tournament_chat_messages.insert_many([{"id": f"tc{i}", "tournament_id": "t", "user_id": me["id"], "message": "x", "created_at": stamp("2026-09-05", 10, i)} for i in range(40)])
    await db.match_chat_messages.insert_many([{"id": f"mc{i}", "match_id": "m", "user_id": me["id"], "message": "x", "created_at": stamp("2026-09-05", 11, i)} for i in range(40)])
    values = await counters.compute(me["id"])
    assert values["team_chat_messages_sent"] == 50 + 3 + 2
    assert values["tournament_chat_messages_sent"] == 40 and values["match_chat_messages_sent"] == 40
    assert values["community_messages_sent"] == 50, "Plauderer: ein Deckel für Turnier- und Match-Chat zusammen"


# ---------------------------------------------------------------- Events (H12)

@pytest.mark.asyncio
async def test_club_events_are_internal_by_visibility_or_type_and_cancelled_events_never_count(flow):
    me = await flow.add_user(name="vereinsmensch")
    db = flow.db
    await db.events.insert_many([
        {"id": "e-members", "name": "Mitgliederabend", "visibility": "members", "event_type": "general", "status": "completed"},
        {"id": "e-evening", "name": "Vereinsabend", "visibility": "public", "event_type": "club_evening", "status": "completed"},
        {"id": "e-internal", "name": "Klausur", "visibility": "community", "event_type": "internal", "status": "completed"},
        {"id": "e-public", "name": "LAN", "visibility": "public", "event_type": "lan_party", "status": "completed"},
        {"id": "e-cancelled", "name": "Abgesagt", "visibility": "internal", "event_type": "club_evening", "status": "cancelled"},
        {"id": "e-noshow", "name": "Nicht da", "visibility": "public", "event_type": "club_evening", "status": "completed"},
    ])
    await db.event_registrations.insert_many([
        {"id": "r1", "event_id": "e-members", "user_id": me["id"], "status": "checked_in"},
        {"id": "r2", "event_id": "e-evening", "user_id": me["id"], "status": "checked_in"},
        {"id": "r3", "event_id": "e-internal", "user_id": me["id"], "checked_in": True, "status": "registered"},
        {"id": "r4", "event_id": "e-public", "user_id": me["id"], "status": "checked_in"},
        {"id": "r5", "event_id": "e-cancelled", "user_id": me["id"], "status": "checked_in"},
        {"id": "r6", "event_id": "e-noshow", "user_id": me["id"], "checked_in": True, "status": "no_show"},
    ])
    values = await counters.compute(me["id"], {"club_events_attended", "events_attended"})
    assert values["club_events_attended"] == 3, "Sichtbarkeit Mitglieder, Art Vereinsabend, Art intern"
    assert values["events_attended"] == 4, "abgesagt und nicht erschienen zählen nicht"


# ---------------------------------------------------------------- Datenbewusst (H10)

async def privacy(user_id: str) -> int:
    return (await counters.compute(user_id, {"privacy_reviewed"}, legacy=False))["privacy_reviewed"]


@pytest.mark.asyncio
async def test_data_aware_needs_a_saved_privacy_setting_not_the_registration_default(flow):
    me = await flow.add_user(name="datenbewusst")
    db = flow.db
    # So legt die Registrierung das Konto an (routes/auth_routes.py).
    await db.users.update_one({"id": me["id"]}, {"$set": {"privacy_public_profile": False, "profile_visibility": {}, "dm_privacy": "everyone"}})
    assert await privacy(me["id"]) == 0, "die Voreinstellung zählt nicht"
    flow.act_as(me)
    response = await flow.patch("/api/users/me", json={"bio": "Hallo"})
    assert response.status_code == 200, response.text
    assert await privacy(me["id"]) == 0, "ein anderes Feld ist keine Privatsphäre-Einstellung"
    response = await flow.patch("/api/users/me", json={"dm_privacy": "friends"})
    assert response.status_code == 200, response.text
    assert (await db.users.find_one({"id": me["id"]}))["privacy_reviewed_at"]
    assert await privacy(me["id"]) == 1


@pytest.mark.asyncio
async def test_data_aware_also_counts_after_a_data_export(flow):
    me = await flow.add_user(name="auskunft")
    await flow.db.users.update_one({"id": me["id"]}, {"$set": {"privacy_public_profile": False, "profile_visibility": {}}})
    flow.act_as(me)
    response = await flow.get("/api/dsgvo/export-my-data")
    assert response.status_code == 200
    assert await privacy(me["id"]) == 1
    entry = await flow.db.achievement_eval_queue.find_one({"user_id": me["id"]}, {"_id": 0})
    assert entry and "profile" in entry["sources"]


# ---------------------------------------------------------------- Twitch (M4)

def fake_twitch(monkeypatch, streams: list[dict]):
    from services import twitch_service

    async def token(_creds):
        return "token", ""

    class Answer:
        status_code = 200
        text = ""

        def json(self):
            return {"data": list(streams)}

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, *args, **kwargs):
            return Answer()

    monkeypatch.setattr(twitch_service, "_get_app_token", token)
    monkeypatch.setattr(twitch_service.httpx, "AsyncClient", Client)


@pytest.mark.asyncio
async def test_twitch_sessions_and_minutes_only_count_for_the_linked_channel(flow, monkeypatch):
    from datetime import timedelta

    from models import now_utc
    from services import twitch_service
    from services.secret_store import encrypt_secret

    db = flow.db
    await db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "twitch_client_id": "cid", "twitch_client_secret": encrypt_secret("geheim")}}, upsert=True)
    typed = await flow.add_user(name="getippt")
    linked = await flow.add_user(name="verknuepft")
    await db.users.update_one({"id": typed["id"]}, {"$set": {"twitch_handle": "fremderkanal"}})
    await db.users.update_one({"id": linked["id"]}, {"$set": {"twitch_handle": "eigenerkanal", "platform_verified": {"twitch": True}}})
    await db.platform_links.insert_one({"id": "tw-l", "user_id": linked["id"], "platform": "twitch", "external_id": "9001", "handle": "eigenerkanal"})
    started = (now_utc() - timedelta(minutes=30)).isoformat()
    fake_twitch(monkeypatch, [
        {"id": "st-typed", "user_login": "fremderkanal", "started_at": started, "viewer_count": 3},
        {"id": "st-linked", "user_login": "eigenerkanal", "started_at": started, "viewer_count": 3},
    ])
    await twitch_service.fetch_live_streams()
    assert await db.live_streams.count_documents({}) == 2, "beide Streams stehen weiter auf der Seite"
    fake_twitch(monkeypatch, [])
    await twitch_service.fetch_live_streams()

    stored_typed = await db.users.find_one({"id": typed["id"]})
    stored_linked = await db.users.find_one({"id": linked["id"]})
    assert not stored_typed.get("twitch_live_sessions_count") and not stored_typed.get("twitch_stream_minutes")
    assert stored_linked["twitch_live_sessions_count"] == 1 and stored_linked["twitch_stream_minutes"] >= 30

    # Auch ein schon gezählter Stand zählt nur mit Verknüpfung.
    await db.users.update_one({"id": typed["id"]}, {"$set": {"twitch_live_sessions_count": 7, "twitch_stream_minutes": 600}})
    keys = {"twitch_live_sessions", "twitch_stream_minutes"}
    assert {k: v for k, v in (await counters.compute(typed["id"], keys)).items() if k in keys} == {"twitch_live_sessions": 0, "twitch_stream_minutes": 0}
    mine = await counters.compute(linked["id"], keys)
    assert mine["twitch_live_sessions"] == 1 and mine["twitch_stream_minutes"] >= 30


@pytest.mark.asyncio
async def test_clips_count_for_the_linked_twitch_account_not_a_typed_name(flow):
    db = flow.db
    typed = await flow.add_user(name="clipgetippt")
    linked = await flow.add_user(name="clipverknuepft")
    await db.users.update_one({"id": typed["id"]}, {"$set": {"twitch_handle": "clipper"}})
    await db.platform_links.insert_one({"id": "tw-c", "user_id": linked["id"], "platform": "twitch", "external_id": "77", "handle": "echtername"})
    await db.settings.insert_one({"id": "twitch_clips_state", "clips": [
        {"id": "c1", "creator_name": "clipper", "creator_id": "55"},
        {"id": "c2", "creator_name": "Anzeigename", "creator_id": "77"},
        {"id": "c3", "creator_name": "EchterName"},
    ]})
    assert (await counters.compute(typed["id"], {"clips_synced"}, legacy=False))["clips_synced"] == 0
    assert (await counters.compute(linked["id"], {"clips_synced"}, legacy=False))["clips_synced"] == 2, "an der Kennung, ältere am Namen"


def test_fetched_clips_keep_the_creator_id():
    from services import twitch_clips

    picked = twitch_clips.pick_clips([{"id": "a", "creator_name": "Paula", "creator_id": 123, "view_count": 1}])
    assert picked[0]["creator_id"] == "123"


# ---------------------------------------------------------------- Konto verknüpfen (M14)

@pytest.mark.asyncio
async def test_linking_an_account_queues_an_evaluation(flow):
    from services import platform_links

    me = await flow.add_user(name="verknuepferin")
    await platform_links.link_account(flow.db, me["id"], "twitch", {"external_id": "4711", "handle": "kanal"})
    entry = await flow.db.achievement_eval_queue.find_one({"user_id": me["id"]}, {"_id": 0})
    assert entry and {"profile", "stream"} <= set(entry["sources"])
    values = await counters.compute(me["id"], {"twitch_linked"}, legacy=False)
    assert values["twitch_linked"] == 1


# ---------------------------------------------------------------- Discord (H11, M9)

MAIN, SUB, OFF = "700000000000000001", "700000000000000002", "700000000000000009"


async def discord_world(db):
    await db.discord_guilds.insert_many([
        {"guild_id": MAIN, "name": "Haupt", "role": "main", "enabled": True},
        {"guild_id": SUB, "name": "Rocket League", "role": "sub", "enabled": True},
        {"guild_id": OFF, "name": "Aus", "role": "sub", "enabled": False},
    ])


@pytest.fixture
def bot(monkeypatch):
    from services import discord_runtime

    class FakeBot:
        def __init__(self):
            self.members: set[tuple[str, str]] = set()
            self.online = True

        async def member_status(self, guild_ids, discord_id):
            if not self.online:
                return {guild_id: None for guild_id in guild_ids}
            return {guild_id: (guild_id, discord_id) in self.members for guild_id in guild_ids}

    fake = FakeBot()
    monkeypatch.setattr(discord_runtime.bot, "member_status", fake.member_status)
    return fake


async def stage(user_id: str) -> tuple[int, int]:
    values = await counters.compute(user_id, {"discord_guilds_joined", "discord_servers_stage"}, legacy=False)
    return values["discord_guilds_joined"], values["discord_servers_stage"]


def test_stage_targets_never_exceed_the_number_of_servers():
    for enabled in range(1, 12):
        targets = [counters.servers_for_stage(level, enabled) for level in (1, 2, 3)]
        assert targets == sorted(targets) and max(targets) <= enabled and targets[-1] == enabled, (enabled, targets)
    assert [counters.servers_for_stage(level, 1) for level in (1, 2, 3)] == [1, 1, 1]
    assert [counters.servers_for_stage(level, 2) for level in (1, 2, 3)] == [1, 2, 2]
    assert [counters.servers_for_stage(level, 5) for level in (1, 2, 3)] == [1, 3, 5]


@pytest.mark.asyncio
async def test_linking_discord_syncs_the_servers_and_unlinking_stops_counting(flow, bot):
    from services import discord_guilds, platform_links

    me = await flow.add_user(name="discordlerin")
    db = flow.db
    await discord_world(db)
    bot.members |= {(MAIN, "111"), (SUB, "111"), (OFF, "111")}
    await platform_links.link_account(db, me["id"], "discord", {"external_id": "111", "handle": "lerin"})
    result = await discord_guilds.sync_memberships(db, me["id"])
    assert result["checked"] == 2, "nur eingeschaltete Server werden gefragt"
    assert await stage(me["id"]) == (2, 3), "zwei von zwei eingeschalteten Servern: alle drei Stufen"
    assert (await db.achievement_eval_queue.find_one({"user_id": me["id"]}, {"_id": 0}))["sources"], "danach ausgewertet"

    await platform_links.unlink(db, me["id"], "discord")
    assert await stage(me["id"]) == (0, 0), "getrennt zählt nichts mehr"
    assert await db.discord_memberships.count_documents({"user_id": me["id"]}) == 0


@pytest.mark.asyncio
async def test_entries_of_a_previous_discord_account_do_not_count(flow, bot):
    from services import discord_guilds

    me = await flow.add_user(name="wechslerin")
    db = flow.db
    await discord_world(db)
    await db.discord_memberships.insert_many([
        {"user_id": me["id"], "guild_id": MAIN, "member": True, "discord_id": "old"},
        {"user_id": me["id"], "guild_id": SUB, "member": True, "discord_id": "old"},
    ])
    await db.platform_links.insert_one({"id": "l-new", "user_id": me["id"], "platform": "discord", "external_id": "new"})
    assert await stage(me["id"]) == (0, 0), "gemerkt für das alte Konto"
    bot.members.add((SUB, "new"))
    await discord_guilds.sync_memberships(db, me["id"])
    assert await stage(me["id"]) == (1, 1)
    assert await db.discord_memberships.count_documents({"user_id": me["id"], "discord_id": "old"}) == 0


@pytest.mark.asyncio
async def test_nightly_sync_covers_everyone_linked_and_drops_orphans(flow, bot):
    from services import discord_guilds

    db = flow.db
    await discord_world(db)
    anna = await flow.add_user(name="anna")
    bert = await flow.add_user(name="bert")
    await db.platform_links.insert_many([
        {"id": "l-a", "user_id": anna["id"], "platform": "discord", "external_id": "201"},
        {"id": "l-b", "user_id": bert["id"], "platform": "discord", "external_id": "202"},
    ])
    await db.discord_memberships.insert_one({"user_id": "ohne-konto", "guild_id": MAIN, "member": True})
    bot.members |= {(MAIN, "201"), (SUB, "202")}
    result = await discord_guilds.sync_all_memberships(db)
    assert result == {"users": 2, "checked": 4, "orphaned": 1}
    assert await stage(anna["id"]) == (1, 1) and await stage(bert["id"]) == (1, 1)


@pytest.mark.asyncio
async def test_the_discord_sync_runs_every_night(monkeypatch):
    from services import scheduler

    monkeypatch.setattr(scheduler, "_scheduler", None)
    monkeypatch.setenv("SCHEDULER_JOBS", "discord_memberships")
    try:
        jobs = {job.id: job for job in scheduler.start_scheduler().get_jobs()}
    finally:
        scheduler.stop_scheduler()
    assert set(jobs) == {"discord_memberships"}
    assert "hour='3'" in str(jobs["discord_memberships"].trigger), "nachts"


@pytest.mark.asyncio
async def test_bot_offline_changes_nothing(flow, bot):
    from services import discord_guilds

    me = await flow.add_user(name="offline")
    db = flow.db
    await discord_world(db)
    await db.platform_links.insert_one({"id": "l-o", "user_id": me["id"], "platform": "discord", "external_id": "301"})
    await db.discord_memberships.insert_one({"user_id": me["id"], "guild_id": MAIN, "member": True, "discord_id": "301"})
    bot.online = False
    assert (await discord_guilds.sync_memberships(db, me["id"]))["checked"] == 0
    assert await stage(me["id"]) == (1, 1), "unbekannt heißt nicht „nein“"


@pytest.mark.asyncio
async def test_discord_messages_on_a_switched_off_server_do_not_count(flow):
    from services import discord_bot

    me = await flow.add_user(name="schreiberin")
    db = flow.db
    await discord_world(db)
    await db.platform_links.insert_one({"id": "l-s", "user_id": me["id"], "platform": "discord", "external_id": "401"})
    view = {"count_messages": True}
    assert await discord_bot.handle_message(db, view, MAIN, "401", False) == me["id"]
    assert await discord_bot.handle_message(db, view, OFF, "401", False) is None
    assert await discord_bot.handle_message(db, view, "700000000000000077", "401", False) is None, "unbekannter Server"
    assert (await db.users.find_one({"id": me["id"]}))["discord_messages_count"] == 1
