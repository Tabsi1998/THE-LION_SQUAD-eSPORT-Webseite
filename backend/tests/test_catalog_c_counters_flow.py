"""Katalog C (#614): die neuen Zähler aus echten Daten - Discord-Nachrichten, offene Chats, Fotos, Sticker, App-Stufe,
Turnier-Streams, Clips - und die Migration alt → neu samt Hand-Gruppen (Mentor behält die Höhe)."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import achievement_migration as migration  # noqa: E402

KEYS = {"discord_messages", "community_messages_sent", "gallery_uploads_approved", "stickers_collected", "app_user_stage",
        "own_tournament_streams", "clips_synced", "events_attended", "friends_count", "direct_messages_sent"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


def sticker(sticker_id: str) -> dict:
    return {"id": sticker_id, "pack_id": "lions", "name": sticker_id, "url": f"/stickers/{sticker_id}.webp", "width": 128, "height": 128}


async def world(db, me: dict, other: dict):
    await db.users.update_one({"id": me["id"]}, {"$set": {"discord_messages_count": 120, "twitch_handle": "@LionStreamer"}})
    await db.tournament_chat_messages.insert_many([
        {"id": "tc1", "tournament_id": "t1", "user_id": me["id"], "text": "GL HF", "created_at": "2026-09-01T18:00:00+00:00"},
        {"id": "tc2", "tournament_id": "t1", "user_id": me["id"], "text": "", "sticker": sticker("s1"), "created_at": "2026-09-01T18:01:00+00:00"},
        {"id": "tc3", "tournament_id": "t1", "user_id": me["id"], "text": "", "sticker": sticker("s2"), "created_at": "2026-09-01T18:02:00+00:00"},
        {"id": "tc4", "tournament_id": "t1", "user_id": other["id"], "text": "", "sticker": sticker("s9"), "created_at": "2026-09-01T18:03:00+00:00"},
    ])
    await db.match_chat_messages.insert_many([
        {"id": "mc1", "match_id": "m1", "user_id": me["id"], "text": "gg", "created_at": "2026-09-01T19:00:00+00:00"},
        {"id": "mc2", "match_id": "m1", "user_id": me["id"], "text": "", "sticker": sticker("s1"), "created_at": "2026-09-01T19:01:00+00:00"},
    ])
    await db.direct_messages.insert_many([
        {"id": "dm1", "sender_id": me["id"], "recipient_id": other["id"], "text": "", "sticker": sticker("s3"), "created_at": "2026-09-02T10:00:00+00:00"},
        {"id": "dm2", "sender_id": other["id"], "recipient_id": me["id"], "text": "", "sticker": sticker("s4"), "created_at": "2026-09-02T10:01:00+00:00"},
    ])
    await db.gallery_photos.insert_many([
        {"id": "ph1", "album_id": "a1", "uploaded_by": me["id"], "uploaded_at": "2026-08-01T10:00:00+00:00"},
        {"id": "ph2", "album_id": "a1", "uploaded_by": me["id"], "uploaded_at": "2026-08-02T10:00:00+00:00"},
        {"id": "ph3", "album_id": "a1", "uploaded_by": other["id"], "uploaded_at": "2026-08-03T10:00:00+00:00"},
    ])
    await db.tournament_stream_announcements.insert_many([
        {"id": "an1", "tournament_id": "t1", "stream_id": "st1", "user_id": me["id"], "announced_at": "2026-09-01T18:00:00+00:00"},
        {"id": "an2", "tournament_id": "t1", "stream_id": "st2", "user_id": me["id"], "announced_at": "2026-09-01T20:00:00+00:00"},
        {"id": "an3", "tournament_id": "t2", "stream_id": "st3", "user_id": me["id"], "announced_at": "2026-09-08T18:00:00+00:00"},
        {"id": "an4", "tournament_id": "t3", "stream_id": "st4", "user_id": other["id"], "announced_at": "2026-09-09T18:00:00+00:00"},
    ])
    await db.settings.insert_one({"id": "twitch_clips_state", "clips": [
        {"id": "c1", "creator_name": "lionstreamer", "title": "Ace"},
        {"id": "c2", "creator_name": "LionStreamer", "title": "Clutch"},
        {"id": "c3", "creator_name": "somebody", "title": "Fail"},
    ]})
    await db.event_registrations.insert_one({"id": "er1", "event_id": "e1", "user_id": me["id"], "status": "checked_in"})
    await db.friendships.insert_one({"id": "f1", "user_id": me["id"], "friend_id": other["id"], "status": "accepted", "requester_id": me["id"], "addressee_id": other["id"]})


@pytest.mark.asyncio
async def test_community_und_creator_zaehler(flow):
    me = await flow.add_user(name="Streamerin")
    other = await flow.add_user(name="Andere")
    await world(flow.db, me, other)
    values = await counters.compute(me["id"], KEYS)
    assert values["discord_messages"] == 120
    assert values["community_messages_sent"] == 5, "drei im Turnier-Chat, zwei im Match-Chat; Direktnachrichten zählen hier nicht"
    assert values["stickers_collected"] == 3, "s1 (zweimal), s2, s3 - der Sticker der anderen zählt nicht"
    assert values["gallery_uploads_approved"] == 2
    assert values["own_tournament_streams"] == 2, "t1 (zwei Streams) und t2; t3 gehört der anderen"
    assert values["clips_synced"] == 2, "Groß- und Kleinschreibung des Twitch-Namens egal, das @ auch"
    assert values["events_attended"] == 1
    assert values["direct_messages_sent"] == 1
    theirs = await counters.compute(other["id"], {"clips_synced", "own_tournament_streams", "stickers_collected"})
    assert theirs["clips_synced"] == 0, "ohne Twitch-Namen keine Clips"
    assert theirs["own_tournament_streams"] == 1
    assert theirs["stickers_collected"] == 2


@pytest.mark.asyncio
async def test_app_stufe_aus_app_tagen_und_push(flow):
    me = await flow.add_user(name="Appnutzerin")
    assert (await counters.compute(me["id"], {"app_user_stage"}))["app_user_stage"] == 0
    days = {f"2026-08-{day:02d}": 1 for day in range(1, 32)}
    await flow.db[counters.SIGNALS].insert_one({"user_id": me["id"], "name": "app_open", "days": dict(list(days.items())[:3]), "count": 3})
    assert (await counters.compute(me["id"], {"app_user_stage"}))["app_user_stage"] == 1, "drei Tage: App genutzt"
    await flow.db[counters.SIGNALS].update_one({"user_id": me["id"], "name": "app_open"}, {"$set": {"days": days, "count": 31}})
    assert (await counters.compute(me["id"], {"app_user_stage"}))["app_user_stage"] == 2, "31 Tage ohne Push"
    await flow.db.mobile_push_tokens.insert_one({"id": "tok", "user_id": me["id"], "token": "x"})
    assert (await counters.compute(me["id"], {"app_user_stage"}))["app_user_stage"] == 3


@pytest.mark.asyncio
async def test_katalog_c_ersetzt_alte_gruppen_und_mentor_behaelt_die_hoehe(flow):
    db = flow.db
    assert catalog.GROUP_MAPPING["discord_active"] == "discord_messages"
    assert catalog.GROUP_MAPPING["level_progression"] == "level_milestones"
    assert catalog.GROUP_MAPPING["mentor_path"] == "mentor"
    for old in catalog.REPLACED_C:
        assert old not in catalog.GROUP_BY_CODE, old
        assert await db.achievements.find_one({"group_code": old}, {"_id": 0}) is None, old
    for code in ("discord_messages_7", "friends_1", "mentor_5", "twitch_sessions_7", "level_milestones_7", "passkey_1", "app_user_3"):
        assert await db.achievements.find_one({"code": code}, {"_id": 0, "code": 1}) is not None, code
    assert (await db.achievements.find_one({"code": "passkey_1"}, {"_id": 0}))["material"] == "silver"
    assert (await db.achievements.find_one({"code": "mentor_5"}, {"_id": 0}))["manual_only"] is True
    # Migration einer Hand-Gruppe: eine alte Vergabe auf Stufe 2 von „Mentor-Pfad“ wird zu Mentor I und II - mit dem alten Datum.
    me = await flow.add_user(name="Mentorin")
    await db.achievement_groups.insert_one({"id": "mentor_path", "code": "mentor_path", "name": "Mentor-Pfad", "category": "club"})
    await db.achievements.insert_many([
        {"id": "mentor_path_b", "code": "mentor_path_b", "group_code": "mentor_path", "level": 1, "material": "bronze", "rank": 3, "manual_only": True},
        {"id": "mentor_path_s", "code": "mentor_path_s", "group_code": "mentor_path", "level": 2, "material": "silver", "rank": 4, "manual_only": True},
    ])
    await db.user_achievements.insert_one({"id": "old-mentor", "user_id": me["id"], "tier_code": "mentor_path_s", "group_code": "mentor_path", "level": 2, "earned_at": "2025-11-11T11:00:00+00:00"})
    await db.settings.update_one({"id": migration.MARKER_ID}, {"$set": {"applied": []}}, upsert=True)
    report = await migration.apply_group_mapping(db, {"mentor_path": "mentor"}, compute_progress=counters.compute)
    plan = report["groups"][0]
    assert plan["mode"] == "remap" and plan["moves"][0]["new_tiers"] == ["mentor_1", "mentor_2"]
    mine = await db.user_achievements.find({"user_id": me["id"]}, {"_id": 0, "tier_code": 1, "earned_at": 1}).sort("tier_code", 1).to_list(10)
    assert [(row["tier_code"], row["earned_at"]) for row in mine] == [("mentor_1", "2025-11-11T11:00:00+00:00"), ("mentor_2", "2025-11-11T11:00:00+00:00")]
    assert await db.achievements.find_one({"group_code": "mentor_path"}, {"_id": 0}) is None
