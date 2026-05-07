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
    await db.partners.create_index("id", unique=True)
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
    await db.refresh_tokens.create_index("id", unique=True)
    await db.refresh_tokens.create_index("jti", unique=True)
    await db.refresh_tokens.create_index("user_id")
    await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)
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
    # Season points (Phase 7)
    await db.season_points.create_index("id", unique=True)
    await db.season_points.create_index("season_id")
    await db.season_points.create_index([("season_id", 1), ("user_id", 1)])
    await db.season_points.create_index([("season_id", 1), ("team_id", 1)])
    await db.season_points.create_index([("user_id", 1), ("source_type", 1), ("created_at", -1)])
    # Achievements v4 (Phase B Final) — replaces legacy badges/user_badges
    await db.achievement_groups.create_index("code", unique=True)
    await db.achievement_groups.create_index("category")
    await db.achievement_groups.create_index("is_negative")
    await db.achievements.create_index("code", unique=True)
    await db.achievements.create_index([("group_code", 1), ("level", 1)])
    await db.user_achievements.create_index([("user_id", 1), ("tier_code", 1)], unique=True)
    await db.user_achievements.create_index([("user_id", 1), ("earned_at", -1)])
    # Phase 8: Mail queue
    await db.mail_jobs.create_index("id", unique=True)
    await db.mail_jobs.create_index([("status", 1), ("next_attempt_at", 1)])
    await db.mail_jobs.create_index("dedupe_key")
    await db.mail_jobs.create_index("created_at")
    # Media ownership for user-facing media pickers
    await db.media_uploads.create_index("id", unique=True)
    await db.media_uploads.create_index("filename", unique=True)
    await db.media_uploads.create_index("owner_id")
    await db.media_uploads.create_index("media_scope")
    # Phase 9: Prize pickups
    await db.prize_pickups.create_index("id", unique=True)
    await db.prize_pickups.create_index("tournament_id")
    await db.prize_pickups.create_index("user_id")
    await db.prize_pickups.create_index("status")
    await db.prize_pickups.create_index([("tournament_id", 1), ("place", 1), ("user_id", 1)])
    # Phase D refinements
    await db.contact_messages.create_index("id", unique=True)
    await db.contact_messages.create_index([("status", 1), ("created_at", -1)])
    await db.board_positions.create_index("id", unique=True)
    await db.board_positions.create_index("slug", unique=True)
    await db.board_positions.create_index("order_index")
    await db.club_member_profiles.create_index("id", unique=True)
    await db.club_member_profiles.create_index("slug", unique=True)
    await db.club_member_profiles.create_index("gamertag")
    await db.club_member_profiles.create_index("order_index")


async def close_client():
    global _client
    if _client is not None:
        _client.close()
        _client = None
