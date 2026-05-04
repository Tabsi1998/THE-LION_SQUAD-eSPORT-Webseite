"""MongoDB database connection + index setup."""
import os
from motor.motor_asyncio import AsyncIOMotorClient

_client = None
_db = None


def get_client():
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return _client


def get_db():
    global _db
    if _db is None:
        _db = get_client()[os.environ["DB_NAME"]]
    return _db


async def init_indexes():
    db = get_db()
    # Users
    await db.users.create_index("email", unique=True)
    await db.users.create_index("username", unique=True)
    await db.users.create_index("id", unique=True)
    # Teams
    await db.teams.create_index("id", unique=True)
    await db.teams.create_index("join_code", unique=True, sparse=True)
    await db.teams.create_index("tag")
    # Games
    await db.games.create_index("id", unique=True)
    await db.games.create_index("slug", unique=True)
    # Tournaments
    await db.tournaments.create_index("id", unique=True)
    await db.tournaments.create_index("slug", unique=True)
    await db.tournaments.create_index("status")
    await db.tournaments.create_index("game_id")
    await db.tournaments.create_index("event_id")
    # Registrations
    await db.tournament_registrations.create_index("id", unique=True)
    await db.tournament_registrations.create_index([("tournament_id", 1), ("user_id", 1)])
    # Matches
    await db.matches.create_index("id", unique=True)
    await db.matches.create_index("tournament_id")
    await db.matches.create_index("status")
    # Events
    await db.events.create_index("id", unique=True)
    await db.events.create_index("slug", unique=True)
    # F1
    await db.f1_challenges.create_index("id", unique=True)
    await db.f1_challenges.create_index("slug", unique=True)
    await db.f1_tracks.create_index("id", unique=True)
    await db.f1_tracks.create_index("challenge_id")
    await db.f1_lap_times.create_index("id", unique=True)
    await db.f1_lap_times.create_index([("challenge_id", 1), ("track_id", 1), ("user_id", 1)])
    await db.f1_lap_times.create_index([("challenge_id", 1), ("track_id", 1), ("time_ms", 1)])
    # Stations
    await db.stations.create_index("id", unique=True)
    # News + sponsors
    await db.news_posts.create_index("id", unique=True)
    await db.sponsors.create_index("id", unique=True)
    # Notifications
    await db.notifications.create_index("id", unique=True)
    await db.notifications.create_index("user_id")
    # Audit
    await db.audit_logs.create_index("id", unique=True)
    await db.audit_logs.create_index("created_at")
    # Auth helpers
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.login_attempts.create_index("identifier")
    await db.login_attempts.create_index("created_at", expireAfterSeconds=3600)
    # Phase 2/3 collections
    await db.settings.create_index("id", unique=True)
    await db.email_logs.create_index("created_at")
    await db.seasons.create_index("id", unique=True)
    await db.seasons.create_index("slug", unique=True)
    await db.tournament_groups.create_index("id", unique=True)
    await db.tournament_groups.create_index("tournament_id")
    # Membership / club system
    await db.memberships.create_index("user_id", unique=True)
    await db.memberships.create_index("member_number", unique=True, sparse=True)
    await db.memberships.create_index("member_status")
    await db.member_benefits.create_index("id", unique=True)
    await db.user_socials.create_index([("user_id", 1), ("platform", 1)], unique=True)
    # Gallery
    await db.gallery_albums.create_index("id", unique=True)
    await db.gallery_albums.create_index("slug", unique=True)
    await db.gallery_albums.create_index("event_id")
    await db.gallery_photos.create_index("id", unique=True)
    await db.gallery_photos.create_index("album_id")
    # News indexes for category / pinning
    await db.news_posts.create_index("category")
    await db.news_posts.create_index([("pinned", -1), ("created_at", -1)])
    # Events
    await db.events.create_index("event_type")
    await db.events.create_index("status")
    # Documents
    await db.documents.create_index("id", unique=True)
    await db.documents.create_index("category")
    await db.documents.create_index([("pinned", -1), ("order_index", 1)])


async def close_client():
    global _client
    if _client is not None:
        _client.close()
        _client = None
