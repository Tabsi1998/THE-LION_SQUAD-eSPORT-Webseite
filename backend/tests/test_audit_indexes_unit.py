"""Die Indizes aus der Vollprüfung (#930). mongomock merkt nicht, wenn ein Index fehlt - deshalb hält dieser Test die
Liste gegen eine Erwartung. Und: ein eindeutiger Index, der an alten Dubletten scheitert, darf den Start nicht
verhindern."""
import asyncio
import logging

import pytest
from mongomock_motor import AsyncMongoMockClient
from pymongo.errors import DuplicateKeyError

import database

# Was mindestens da sein muss: Sammlung -> Indexnamen (gewöhnliche tragen den Namen, den MongoDB selbst bildet).
EXPECTED = {
    "user_xp": {"user_unique"},
    "news_reads": {"user_news_unique"},
    "discord_memberships": {"user_guild_unique"},
    "youtube_videos": {"channel_video_unique"},
    "platform_links": {"platform_external_unique", "user_id_1"},
    "moderation_sanctions": {"user_id_1_status_1"},
    "moderation_strikes": {"user_id_1", "source_1_ref_id_1"},
    "team_members": {"team_id_1_user_id_1", "user_id_1"},
    "membership_applications": {"user_id_1_status_1", "status_1"},
    "media_scans": {"state_1", "owner_id_1"},
    "billing_cases": {"order_id_1_status_1", "status_1"},
    "tournament_awards": {"tournament_id_1_registration_id_1", "registration_id_1"},
    "team_squads": {"team_id_1"},
    "chat_attachments": {"owner_id_1", "status_1_created_at_1"},
    "stream_watches": {"user_id_1_day_1_key_1"},
    "match_commendations": {"match_id_1_from_registration_id_1", "to_registration_id_1", "from_user_id_1"},
    "club_member_profiles": {"user_id_1", "dolibarr_member_id_1"},
    "news_posts": {"published_1_published_at_-1"},
    "seasons": {"status_1"},
    "tournaments": {"start_date_1"},
    "events": {"start_date_1"},
    "f1_challenges": {"start_date_1"},
    "discord_activity": {"user_day_unique"},
    "discord_guild_stats": {"guild_day_unique"},
    "discord_guild_active": {"guild_day_user_unique", "user_id_1", "day_1"},
}


def fresh():
    return AsyncMongoMockClient()["indizes"]


async def names(db, collection: str) -> set[str]:
    return set(await getattr(db, collection).index_information())


def test_every_index_of_the_audit_exists_and_the_list_has_no_strays():
    async def scenario():
        db = fresh()
        summary = await database.init_audit_indexes(db)
        assert summary == {"unique": len(database.AUDIT_UNIQUE_INDEXES), "blocked": [], "plain": len(database.AUDIT_INDEXES)}
        for collection, wanted in EXPECTED.items():
            assert wanted <= await names(db, collection), collection
        listed = {row[0] for row in database.AUDIT_UNIQUE_INDEXES} | {row[0] for row in database.AUDIT_INDEXES}
        assert listed == set(EXPECTED), "neuer Index? Dann gehört er auch in die Erwartung dieses Tests"
    asyncio.run(scenario())


def test_the_unique_indexes_really_refuse_a_second_row():
    async def scenario():
        db = fresh()
        await database.init_audit_indexes(db)
        await db.user_xp.insert_one({"user_id": "u1", "total": 10})
        with pytest.raises(DuplicateKeyError):
            await db.user_xp.insert_one({"user_id": "u1", "total": 5})
        await db.platform_links.insert_one({"platform": "discord", "external_id": "42", "user_id": "u1"})
        with pytest.raises(DuplicateKeyError):
            await db.platform_links.insert_one({"platform": "discord", "external_id": "42", "user_id": "u2"})
        # Dieselbe Kennung auf einer anderen Plattform und Verknüpfungen ohne Kennung stören einander nicht.
        await db.platform_links.insert_one({"platform": "twitch", "external_id": "42", "user_id": "u2"})
        await db.platform_links.insert_one({"platform": "steam", "user_id": "u1"})
        await db.platform_links.insert_one({"platform": "steam", "user_id": "u2"})
    asyncio.run(scenario())


def test_old_duplicates_do_not_stop_the_start_and_the_unique_index_follows_once_they_are_gone(caplog):
    async def scenario():
        db = fresh()
        await db.user_xp.insert_one({"user_id": "u1", "total": 10})
        await db.user_xp.insert_one({"user_id": "u1", "total": 5})
        with caplog.at_level(logging.WARNING, logger="database"):
            summary = await database.init_audit_indexes(db)
        assert summary["blocked"] == ["user_xp.user"] and summary["unique"] == len(database.AUDIT_UNIQUE_INDEXES) - 1
        assert "user_plain" in await names(db, "user_xp") and "user_unique" not in await names(db, "user_xp")
        assert any("user_xp" in record.getMessage() and "Dubletten" in record.getMessage() for record in caplog.records)
        # Ein zweiter Start mit denselben Dubletten ändert nichts und scheitert nicht.
        assert (await database.init_audit_indexes(db))["blocked"] == ["user_xp.user"]

        await db.user_xp.delete_one({"total": 5})
        assert (await database.init_audit_indexes(db))["blocked"] == []
        found = await names(db, "user_xp")
        assert "user_unique" in found and "user_plain" not in found, "der gewöhnliche Index macht dem eindeutigen Platz"
        assert (await database.init_audit_indexes(db))["unique"] == len(database.AUDIT_UNIQUE_INDEXES), "ein weiterer Start lässt alles stehen"
    asyncio.run(scenario())


def test_the_whole_index_setup_calls_the_audit_block():
    async def scenario(monkeypatch_db):
        await database.init_indexes()
        assert "user_unique" in await names(monkeypatch_db, "user_xp")
        assert "user_id_1_status_1" in await names(monkeypatch_db, "moderation_sanctions")
    db = fresh()
    original = database.get_db
    database.get_db = lambda: db
    try:
        asyncio.run(scenario(db))
    finally:
        database.get_db = original
