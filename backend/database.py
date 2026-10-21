"""MongoDB database connection + index setup."""
import logging
import os
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import OperationFailure

logger = logging.getLogger(__name__)

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


async def ensure_event_photo_indexes(db) -> None:
    """Fotos vom Event (#1185, #1186): eindeutige Schlüssel, auf denen „genau einmal“ und die Höchstzahl ruhen.
    Steht hier und nicht in services/event_photos.py, damit database.py nichts aus services braucht (#1420)."""
    await db.gallery_album_notices.create_index([("album_id", 1), ("user_id", 1)], unique=True)
    await db.gallery_submission_quota.create_index([("album_id", 1), ("owner_id", 1)], unique=True)


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
    await db.team_invites.create_index("id", unique=True)
    await db.team_invites.create_index([("team_id", 1), ("user_id", 1), ("status", 1)])
    await db.team_invites.create_index([("user_id", 1), ("status", 1), ("created_at", -1)])
    await db.team_chat_messages.create_index("id", unique=True)
    await db.team_chat_messages.create_index([("team_id", 1), ("created_at", -1)])
    # Games
    await db.games.create_index("id", unique=True)
    await db.games.create_index("slug", unique=True)
    await db.games.create_index("slug_history")
    await db.games.create_index("parent_game_id")
    await db.games.create_index("identity_source_game_id")
    # Map-Bibliothek je Spiel und Map-Pools je Wettbewerb mit Versionen (#1616)
    await db.game_maps.create_index("id", unique=True)
    await db.game_maps.create_index([("game_id", 1), ("slug", 1)], unique=True)
    await db.map_pools.create_index("id", unique=True)
    await db.map_pools.create_index([("scope", 1), ("scope_id", 1), ("version", -1)], unique=True)
    await db.map_pools.create_index([("tournament_id", 1), ("scope", 1)])
    await db.map_pools.create_index("game_id")
    # Maps in Ergebnisblättern der Team-Liga (#1616): nur fürs Löschen einer Map gefragt (``game_maps.in_results``).
    await db.reference_round_results.create_index("matches.maps.map_id", sparse=True)
    await db.reference_round_results.create_index("pending_draft.matches.maps.map_id", sparse=True)
    await db.reference_round_result_revisions.create_index("content.matches.maps.map_id", sparse=True)
    # Game servers
    await db.game_servers.create_index("id", unique=True)
    await db.game_servers.create_index("slug", unique=True)
    await db.game_servers.create_index("slug_history")
    await db.game_servers.create_index("game_id")
    await db.game_servers.create_index([("is_active", 1), ("visibility", 1), ("status", 1)])
    await db.game_servers.create_index([("sync_provider", 1), ("is_active", 1)])
    # Tournaments
    await db.tournaments.create_index("id", unique=True)
    await db.tournaments.create_index("slug", unique=True)
    await db.tournaments.create_index("slug_history")
    await db.tournaments.create_index("creation_key", unique=True, sparse=True)
    await db.tournaments.create_index("status")
    await db.tournaments.create_index("game_id")
    await db.tournaments.create_index("event_id")
    await db.tournaments.create_index("engine_version")
    await db.tournaments.create_index("ruleset_version")
    # Registrations
    await db.tournament_registrations.create_index("id", unique=True)
    await db.tournament_registrations.create_index([("tournament_id", 1), ("user_id", 1)])
    await db.tournament_registrations.create_index("identity_key", unique=True, sparse=True)
    # Events
    await db.events.create_index("id", unique=True)
    await db.events.create_index("slug", unique=True)
    await db.events.create_index("slug_history")
    await db.event_registrations.create_index("id", unique=True)
    await db.event_registrations.create_index([("event_id", 1), ("user_id", 1)], unique=True)
    await db.event_registrations.create_index([("event_id", 1), ("status", 1)])
    # Nachricht an alle Angemeldeten (#1372): das Protokoll je Event, neueste zuerst.
    await db.event_messages.create_index([("event_id", 1), ("created_at", -1)])
    # F1
    await db.f1_challenges.create_index("id", unique=True)
    await db.f1_challenges.create_index("slug", unique=True)
    await db.f1_challenges.create_index("slug_history")
    await db.f1_tracks.create_index("id", unique=True)
    await db.f1_tracks.create_index("challenge_id")
    await db.f1_lap_times.create_index("id", unique=True)
    await db.f1_lap_times.create_index([("challenge_id", 1), ("track_id", 1), ("user_id", 1)])
    # Fast Lap vor Ort (#1585): Versuche je Gast, die Gäste einer Challenge und die Liste „Am Start / Als Nächstes“.
    await db.f1_lap_times.create_index([("challenge_id", 1), ("track_id", 1), ("guest_id", 1)])
    await db.f1_guests.create_index("id", unique=True)
    await db.f1_guests.create_index([("challenge_id", 1), ("number", 1)])
    await db.f1_guests.create_index([("created_at", 1), ("name_expired_at", 1)])
    await db.f1_queue.create_index("id", unique=True)
    await db.f1_queue.create_index([("challenge_id", 1), ("order", 1)])
    # Erfolge II (#613): festgeschriebene Saison-Ranglisten und die täglichen Rang-Schnappschüsse
    await db.season_standings.create_index([("season_id", 1), ("rank", 1)])
    await db.season_standings.create_index([("user_id", 1), ("season_id", 1)])
    await db.season_rank_snapshots.create_index([("season_id", 1), ("user_id", 1), ("day", 1)], unique=True)
    await db.season_rank_snapshots.create_index([("user_id", 1), ("day", 1)])
    await db.f1_lap_times.create_index([("challenge_id", 1), ("track_id", 1), ("time_ms", 1)])
    # Stations
    await db.stations.create_index("id", unique=True)
    await db.stations.create_index("tournament_id")
    await db.stations.create_index([("tournament_id", 1), ("status", 1)])
    # News + sponsors
    await db.news_posts.create_index("id", unique=True)
    await db.news_posts.create_index("slug", unique=True)
    await db.news_posts.create_index("slug_history")
    await db.sponsors.create_index("id", unique=True)
    await db.partners.create_index("id", unique=True)
    await db.references.create_index("id", unique=True)
    await db.references.create_index("game_id")
    await db.references.create_index("status")
    await db.references.create_index([("is_active", 1), ("visibility", 1), ("start_date", -1)])
    # Externe Serien (#1741): Spur, Serie, Termine, Teilnehmer, ein Blatt je Termin samt Revisionen, Stände je Runde,
    # Aliase über alle Serien und Captains je Serie.
    await db.reference_lineages.create_index("id", unique=True)
    await db.reference_lineages.create_index("slug", unique=True)
    await db.reference_lineages.create_index("slug_history")
    await db.reference_lineages.create_index([("is_archived", 1), ("order_index", 1)])
    await db.reference_series.create_index("id", unique=True)
    await db.reference_series.create_index([("lineage_id", 1), ("season_slug", 1)], unique=True)
    await db.reference_series.create_index([("lineage_id", 1), ("season_slug_history", 1)])
    await db.reference_series.create_index("status")
    await db.reference_series.create_index("reference_id")
    await db.references.create_index("series_id")
    await db.reference_rounds.create_index("id", unique=True)
    await db.reference_rounds.create_index([("series_id", 1), ("order", 1)])
    await db.reference_rounds.create_index([("club_day", 1), ("status", 1)])
    # „Läuft gerade“ (#1748): nächster offener Termin je Serie (series_id in …, club_day >= heute).
    await db.reference_rounds.create_index([("series_id", 1), ("club_day", 1)])
    await db.reference_participants.create_index("id", unique=True)
    await db.reference_participants.create_index([("series_id", 1), ("name_normalized", 1)])
    await db.reference_participants.create_index("profile_id")
    # Zuordnung (#1743): offene Namen über alle Serien und die Teilnehmer, die ein Alias zugeordnet hat.
    await db.reference_participants.create_index([("name_normalized", 1), ("link_status", 1)])
    await db.reference_participants.create_index("alias_id")
    await db.reference_round_results.create_index("id", unique=True)
    await db.reference_round_results.create_index("round_id", unique=True)
    await db.reference_round_results.create_index([("series_id", 1), ("status", 1)])
    await db.reference_round_result_revisions.create_index("id", unique=True)
    await db.reference_round_result_revisions.create_index([("result_id", 1), ("version", -1)])
    await db.reference_round_result_revisions.create_index("series_id")
    await db.reference_standings.create_index([("series_id", 1), ("round_id", 1), ("scope", 1)], unique=True)
    await db.reference_standings.create_index([("series_id", 1), ("scope", 1), ("round_seq", -1)])
    await db.reference_aliases.create_index("id", unique=True)
    await db.reference_aliases.create_index([("name_normalized", 1), ("game_id", 1)], unique=True)
    await db.reference_aliases.create_index("profile_id")
    await db.reference_series_staff.create_index("id", unique=True)
    await db.reference_series_staff.create_index([("series_id", 1), ("user_id", 1), ("role", 1)], unique=True)
    await db.reference_series_staff.create_index("user_id")
    # Notifications
    await db.notifications.create_index("id", unique=True)
    await db.notifications.create_index("user_id")
    await db.notifications.create_index([("user_id", 1), ("read", 1), ("created_at", -1)])
    await db.mobile_push_tokens.create_index("token", unique=True)
    # App-Releases (#250): ein Eintrag je Build.
    await db.app_releases.create_index("build", unique=True)
    await db.mobile_push_tokens.create_index([("user_id", 1), ("enabled", 1), ("updated_at", -1)])
    await db.mobile_push_tokens.create_index([("enabled", 1), ("last_ticket_status", 1), ("last_ticket_at", -1)])
    await db.mobile_push_tokens.create_index([("last_receipt_checked_at", -1)])
    await db.mobile_client_logs.create_index("id", unique=True)
    await db.mobile_client_logs.create_index("received_at")
    await db.mobile_client_logs.create_index([("status", 1), ("level", 1), ("received_at", -1)])
    await db.mobile_client_logs.create_index([("status", 1), ("priority_rank", 1), ("received_at", -1)])
    await db.mobile_client_logs.create_index([("user_id", 1), ("received_at", -1)])
    await db.mobile_client_logs.create_index([("user_id", 1), ("session_id", 1), ("fingerprint", 1), ("last_seen_at", -1)])
    await db.mobile_client_logs.create_index("expires_at", expireAfterSeconds=0)
    await db.direct_messages.create_index("id", unique=True)
    await db.direct_messages.create_index([("sender_id", 1), ("recipient_id", 1), ("created_at", -1)])
    await db.direct_messages.create_index([("recipient_id", 1), ("read_at", 1), ("created_at", -1)])
    # Alle Chats an einem Ort (#1148): „gelesen bis“ je Person und Unterhaltung.
    await db.chat_reads.create_index([("user_id", 1), ("key", 1)], unique=True)
    await db.friendships.create_index("id", unique=True)
    await db.friendships.create_index("pair_key", unique=True)
    await db.friendships.create_index([("requester_id", 1), ("status", 1), ("updated_at", -1)])
    await db.friendships.create_index([("recipient_id", 1), ("status", 1), ("updated_at", -1)])
    await db.user_blocks.create_index([("blocker_id", 1), ("blocked_id", 1)], unique=True)
    await db.user_blocks.create_index([("blocked_id", 1), ("created_at", -1)])
    await db.user_reports.create_index("id", unique=True)
    await db.user_reports.create_index([("status", 1), ("created_at", -1)])
    await db.user_reports.create_index([("target_user_id", 1), ("created_at", -1)])
    # Betriebssicht (#233): Fehlergruppen und langsame Anfragen, 30 Tage per TTL.
    await db.ops_errors.create_index("fingerprint", unique=True)
    await db.ops_errors.create_index([("resolved_at", 1), ("last_seen_at", -1)])
    await db.ops_errors.create_index("expires_at", expireAfterSeconds=0)
    await db.ops_slow_requests.create_index("at")
    await db.ops_slow_requests.create_index([("route", 1), ("at", -1)])
    await db.ops_slow_requests.create_index("expires_at", expireAfterSeconds=0)
    # Betrieb II (#265): Web Vitals 30 Tage, Check-Läufe 7 Tage, Alarm-Drosselung.
    await db.ops_vitals.create_index([("at", -1)])
    await db.ops_vitals.create_index("expires_at", expireAfterSeconds=0)
    await db.ops_check_runs.create_index([("at", -1)])
    await db.ops_check_runs.create_index("expires_at", expireAfterSeconds=0)
    await db.ops_alert_state.create_index("key", unique=True)
    # Audit
    await db.audit_logs.create_index("id", unique=True)
    await db.audit_logs.create_index("created_at")
    # Cross-worker mutation leases.  These protect multi-document tournament
    # operations when multiple API workers receive the same action at once.
    await db.mutation_locks.create_index("resource", unique=True)
    await db.mutation_locks.create_index("expires_at", expireAfterSeconds=0)
    # Which competition write path actually runs.  Needed to decide - with
    # numbers instead of assumptions - when the classic store may be retired.
    await db.competition_write_usage.create_index([("created_at", -1)])
    await db.competition_write_usage.create_index([("engine", 1), ("capability", 1), ("created_at", -1)])
    await db.competition_write_usage.create_index("created_at", expireAfterSeconds=180 * 24 * 3600)
    # Auth helpers
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.password_reset_tokens.create_index("token_hash")
    await db.password_reset_tokens.create_index([("user_id", 1), ("used", 1)])
    await db.email_verification_tokens.create_index("token_hash", unique=True)
    await db.email_verification_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.email_verification_tokens.create_index([("user_id", 1), ("used", 1)])
    await db.consent_records.create_index([("user_id", 1), ("recorded_at", -1)])
    await db.mfa_login_challenges.create_index("ticket_hash", unique=True)
    await db.mfa_login_challenges.create_index("expires_at", expireAfterSeconds=0)
    await db.passkeys.create_index("user_id")
    await db.passkey_challenges.create_index("expires_at", expireAfterSeconds=0)
    await db.passkey_challenges.create_index("user_id")
    # Plattform verknüpfen (#1027): ein Ablauf je Start, nach zehn Minuten räumt MongoDB ihn selbst weg.
    await db.platform_link_flows.create_index("flow_hash", unique=True)
    await db.platform_link_flows.create_index("expires_at", expireAfterSeconds=0)
    await db.platform_link_flows.create_index("user_id")
    await db.login_attempts.create_index("identifier")
    await db.login_attempts.create_index("created_at", expireAfterSeconds=3600)
    await db.rate_limits.create_index("key")
    await db.rate_limits.create_index("created_at", expireAfterSeconds=86400)
    await db.rate_limits.create_index("expires_at", expireAfterSeconds=0)
    await db.access_links.create_index("id", unique=True)
    await db.access_links.create_index("token_hash", unique=True)
    await db.access_links.create_index([("target_type", 1), ("target_id", 1), ("is_active", 1)])
    await db.access_links.create_index("expires_at")
    await db.refresh_tokens.create_index("id", unique=True)
    await db.refresh_tokens.create_index("jti", unique=True)
    await db.refresh_tokens.create_index("user_id")
    await db.refresh_tokens.create_index([("family_id", 1), ("revoked", 1)])
    await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.auth_sessions.create_index("family_id", unique=True)
    await db.auth_sessions.create_index("id", unique=True)
    await db.auth_sessions.create_index("user_id")
    await db.auth_sessions.create_index("expires_at", expireAfterSeconds=0)
    # Phase 2/3 collections
    await db.settings.create_index("id", unique=True)
    await db.schema_migrations.create_index("version", unique=True)
    await db.site_banners.create_index("id", unique=True)
    await db.site_banners.create_index([("enabled", 1), ("priority", -1), ("updated_at", -1)])
    await db.site_banner_stats.create_index("id", unique=True)
    await db.email_logs.create_index("created_at")
    await db.seasons.create_index("id", unique=True)
    await db.seasons.create_index("slug", unique=True)
    await db.seasons.create_index("slug_history")
    await db.tournament_groups.create_index("id", unique=True)
    await db.tournament_groups.create_index("tournament_id")
    await db.tournament_staff_assignments.create_index("id", unique=True)
    await db.tournament_staff_assignments.create_index("tournament_id")
    await db.tournament_staff_assignments.create_index([("tournament_id", 1), ("user_id", 1), ("role", 1), ("scope", 1), ("scope_id", 1)])
    await db.tournament_staff_assignments.create_index("user_id")
    await db.tournament_stages.create_index("id", unique=True)
    await db.tournament_stages.create_index([("tournament_id", 1), ("number", 1)])
    await db.tournament_stages.create_index("creation_key", unique=True, sparse=True)
    await db.matches_v2.create_index("id", unique=True)
    await db.matches_v2.create_index([("tournament_id", 1), ("stage_id", 1)])
    await db.matches_v2.create_index([("stage_id", 1), ("match_key", 1)])
    # Die Minuten-Jobs (#1940): Turniere mit wartender Auslosung bzw. offenen Spielen - gesucht von den Spielen her
    # (services/live_sweep). Der erste nur über die wenigen Spiele, die gerade auf ihr Los warten.
    await db.matches_v2.create_index([("tournament_id", 1)], name="draw_ready_pending",
                                     partialFilterExpression={"draw_ready": {"$type": "object"}})
    await db.matches_v2.create_index([("status", 1), ("tournament_id", 1)])
    await db.match_schedule_proposals.create_index("id", unique=True)
    await db.match_schedule_proposals.create_index([("match_id", 1), ("created_at", -1)])
    await db.match_chat_messages.create_index("id", unique=True)
    await db.match_chat_messages.create_index([("match_id", 1), ("created_at", -1)])
    await db.match_reports_v2.create_index("id", unique=True)
    await db.match_reports_v2.create_index("match_id")
    await db.tournament_chat_messages.create_index("id", unique=True)
    await db.tournament_chat_messages.create_index([("tournament_id", 1), ("created_at", -1)])
    # Membership / club system
    await db.memberships.create_index("user_id", unique=True)
    await db.memberships.create_index("member_number", unique=True, sparse=True)
    await db.memberships.create_index("member_status")
    await db.member_benefits.create_index("id", unique=True)
    await db.user_socials.create_index([("user_id", 1), ("platform", 1)], unique=True)
    # Gallery
    await db.gallery_albums.create_index("id", unique=True)
    await db.gallery_albums.create_index("slug", unique=True)
    await db.gallery_albums.create_index("slug_history")
    await db.gallery_albums.create_index("event_id")
    await db.gallery_photos.create_index("id", unique=True)
    await db.gallery_photos.create_index("album_id")
    await db.gallery_submissions.create_index("id", unique=True)
    await db.gallery_submissions.create_index([("album_id", 1), ("owner_id", 1)])
    await db.gallery_submissions.create_index("status")
    # Fotos vom Event (#1185, #1186): Quittung je Album und Person, Zähler je Person und Album - beide eindeutig.
    await ensure_event_photo_indexes(db)
    # News indexes for category / pinning
    await db.news_posts.create_index("category")
    await db.news_posts.create_index([("pinned", -1), ("created_at", -1)])
    # Events
    await db.events.create_index("event_type")
    await db.events.create_index("status")
    # Documents
    await db.documents.create_index("id", unique=True)
    # Papierkram (#615): das erste Öffnen je Person und Dokument.
    await db.document_opens.create_index([("user_id", 1), ("doc_id", 1)], unique=True)
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
    await db.mail_jobs.create_index([("status", 1), ("updated_at", 1)])
    await db.mail_jobs.create_index("dedupe_key")
    await db.mail_jobs.create_index("created_at")
    # Media ownership for user-facing media pickers
    await db.media_uploads.create_index("id", unique=True)
    await db.media_uploads.create_index("filename", unique=True)
    await db.media_uploads.create_index("owner_id")
    await db.media_uploads.create_index("media_scope")
    await db.media_uploads.create_index([("owner_id", 1), ("media_scope", 1)])
    await db.pending_file_cleanups.create_index("filename", unique=True)
    # Nacharbeit mit Grenze (#1046): der Aufräum-Job sucht die fälligen, Betrieb → Checks zählt nach Status.
    await db.pending_file_cleanups.create_index([("status", 1), ("next_attempt_at", 1)])
    await db.upload_events.create_index("id", unique=True)
    await db.upload_events.create_index("created_at")
    await db.upload_events.create_index([("status", 1), ("created_at", -1)])
    await db.upload_events.create_index([("media_scope", 1), ("created_at", -1)])
    await db.upload_events.create_index("expires_at", expireAfterSeconds=0)
    # Phase 9: Prize pickups
    await db.prize_pickups.create_index("id", unique=True)
    await db.prize_pickups.create_index("tournament_id")
    await db.prize_pickups.create_index("source_type")
    await db.prize_pickups.create_index("fastlap_challenge_id")
    await db.prize_pickups.create_index("user_id")
    await db.prize_pickups.create_index("team_id")
    await db.prize_pickups.create_index("status")
    await db.prize_pickups.create_index([("tournament_id", 1), ("place", 1), ("user_id", 1)])
    await db.prize_pickups.create_index([("tournament_id", 1), ("place", 1), ("team_id", 1)])
    # Phase D refinements
    await db.contact_messages.create_index("id", unique=True)
    await db.contact_messages.create_index([("status", 1), ("created_at", -1)])
    await db.board_positions.create_index("id", unique=True)
    await db.board_positions.create_index("slug", unique=True)
    await db.board_positions.create_index("slug_history")
    await db.board_positions.create_index("order_index")
    await db.club_member_profiles.create_index("id", unique=True)
    await db.club_member_profiles.create_index("slug", unique=True)
    await db.club_member_profiles.create_index("slug_history")
    await db.club_member_profiles.create_index("gamertag")
    await db.club_member_profiles.create_index("order_index")
    # Erfolge sofort (#301): eine Person steht höchstens einmal in der Schlange.
    await db.achievement_eval_queue.create_index("user_id", unique=True)
    await db.achievement_eval_queue.create_index("due_at")
    await db.achievement_outbox.create_index([("user_id", 1), ("created_at", 1)])
    # Dolibarr (#316): ein Dokument je Konto und Installation; `member_key` trägt nur eine
    # bestätigte Zuordnung - zwei Konten können nie dasselbe Mitglied beanspruchen.
    await db.dolibarr_links.create_index([("user_id", 1), ("instance", 1)], unique=True)
    await db.dolibarr_links.create_index("member_key", unique=True, sparse=True)
    await db.dolibarr_links.create_index("status")
    await db.dolibarr_pending.create_index("key", unique=True)
    # Signierte Webhooks (#1540): jede Ereignis-Kennung einmal je Installation, nach sieben Tagen vergessen.
    await db.dolibarr_webhook_events.create_index("key", unique=True)
    await db.dolibarr_webhook_events.create_index("expires_at", expireAfterSeconds=0)
    # Teilnahmen in der Akte (#847): eine Meldung je Kennung und Installation; der Abgleich liest nach Tag.
    await db.dolibarr_participations.create_index("key", unique=True)
    await db.dolibarr_participations.create_index([("instance", 1), ("day", 1)])
    # Rechnungsaufträge (#317): je Buchung höchstens ein offener Auftrag.
    await db.billing_orders.create_index("id", unique=True)
    await db.billing_orders.create_index([("kind", 1), ("registration_id", 1), ("status", 1)])
    await db.billing_orders.create_index([("status", 1), ("created_at", 1)])
    # Geschäftspartner von Nicht-Mitgliedern je Installation (#316)
    await db.billing_customers.create_index([("user_id", 1), ("instance", 1)], unique=True)
    # Prüfcodes der Mitgliedskarte (#346): fünf Minuten, dann weg.
    await db.member_card_tokens.create_index("token", unique=True)
    await db.member_card_tokens.create_index("expires_at", expireAfterSeconds=0)
    # Persönlicher Kalender-Link (#1189): je Konto einer, gefunden über den Hash des Tokens.
    await db.calendar_feed_tokens.create_index("user_id", unique=True)
    await db.calendar_feed_tokens.create_index("token_hash", unique=True)
    # Einlass bei der Generalversammlung (#845): je Versammlung und Mitglied ein Stand, die letzten Zahlen je Versammlung.
    await db.meeting_admissions.create_index([("meeting_id", 1), ("member_id", 1)], unique=True)
    await db.meeting_admission_counts.create_index("meeting_id", unique=True)
    # Letzter verlässlicher Stand der eigenen Rechnungen (#296) - für den Ausfall, nie für PDFs.
    await db.dolibarr_invoice_cache.create_index("user_id", unique=True)
    await db.dolibarr_invoice_cache.create_index("expires_at", expireAfterSeconds=0)
    # Ehrungen fürs öffentliche Profil (#848): ein Zwischenstand je Konto.
    await db.dolibarr_honours.create_index("user_id", unique=True)
    await db.dolibarr_pending.create_index("due_at")
    await db.live_streams.create_index("user_id", unique=True)
    await db.live_streams.create_index("twitch_login")
    await db.twitch_stream_sessions.create_index("stream_id", unique=True)
    await db.twitch_stream_sessions.create_index([("user_id", 1), ("started_at", -1)])
    await db.twitch_stream_sessions.create_index("is_live")
    # Adventkalender (#641): ein Türchen je Jahr und Tag; eine Person öffnet jedes höchstens einmal.
    await db.advent_doors.create_index([("year", 1), ("day", 1)], unique=True)
    await db.advent_openings.create_index([("user_id", 1), ("year", 1), ("day", 1)], unique=True)
    await db.advent_openings.create_index([("year", 1), ("day", 1)])
    await db.advent_views.create_index([("year", 1), ("day", 1)], unique=True)
    # Geschenkte Saison-Sticker (#736): der Nikolaus bringt jeder Person einen je Jahr.
    await db.user_stickers.create_index([("user_id", 1), ("source", 1), ("year", 1)], unique=True)
    # Ostereiersuche (#646): ein Jahr je Suche, jedes Ei einmal je Jahr, jede Person findet jedes Ei einmal.
    await db.easter_hunts.create_index("year", unique=True)
    await db.easter_eggs.create_index([("year", 1), ("egg_no", 1)], unique=True)
    await db.easter_eggs.create_index([("hunt_id", 1), ("route", 1), ("channel", 1)])
    await db.easter_finds.create_index([("hunt_id", 1), ("user_id", 1), ("egg_no", 1)], unique=True)
    await db.easter_finds.create_index("user_id")
    await db.easter_progress.create_index([("hunt_id", 1), ("user_id", 1)], unique=True)
    await db.easter_progress.create_index([("hunt_id", 1), ("completed_at", 1)])
    await db.easter_progress.create_index("user_id")
    # Saison-Gewinne (#641): eine Verlosung je Quelle, eine Teilnahme je Person.
    await db.season_raffles.create_index("id", unique=True)
    await db.season_raffles.create_index("source_key", unique=True)
    await db.season_raffle_entries.create_index([("raffle_id", 1), ("user_id", 1)], unique=True)
    await db.season_raffle_entries.create_index("user_id")
    await init_audit_indexes(db)


async def unique_index(collection, keys, name: str, **options) -> bool:
    """Eindeutiger Index, der den Start nicht gefährdet (#930). Liegen in der Sammlung schon Dubletten, scheitert der
    Aufbau - dann bleibt ein gewöhnlicher Index und eine Warnung im Log, der Server startet trotzdem. Sind die
    Dubletten bereinigt, greift der eindeutige beim nächsten Start von selbst (der gewöhnliche macht ihm vorher Platz:
    zwei Indizes auf denselben Feldern lässt MongoDB nicht zu).

    Sichtbar ist das nicht nur im Log (#1043): Betrieb → Checks zeigt jeden fehlenden eindeutigen Index
    (``blocked_unique_indexes``). Bereinigt wird nie hier, sondern mit ``scripts/unique_index_duplicates.py``."""
    unique, plain = f"{name}_unique", f"{name}_plain"
    existing = await collection.index_information()
    if unique in existing:
        return True
    if plain in existing:
        await collection.drop_index(plain)
    try:
        await collection.create_index(keys, unique=True, name=unique, **options)
        return True
    except OperationFailure as exc:
        # Ohne den Text der Datenbank: der nennt den doppelten Schlüssel, und der kann eine Kennung der Person sein.
        logger.warning("[indexes] %s: Dubletten verhindern den eindeutigen Index %s - gewöhnlicher Index angelegt "
                       "(Fehlercode %s; Betrieb → Checks, scripts/unique_index_duplicates.py)",
                       collection.name, unique, getattr(exc, "code", None))
        await collection.create_index(keys, name=plain, **options)
        return False


FASTLAP_PRIZE_KEY = [("source_type", 1), ("fastlap_challenge_id", 1), ("fastlap_source_key", 1), ("place", 1), ("user_id", 1)]
# Gewöhnliche Indizes, die ein eindeutiger aus der Vollprüfung ersetzt (gleiche Felder) - beim Start weg damit.
REPLACED_INDEXES = (
    ("prize_pickups", "_".join(f"{field}_{direction}" for field, direction in FASTLAP_PRIZE_KEY)),
)

# Vollprüfung Oktober 2026 (#930): diese Sammlungen werden bei fast jeder Anfrage gelesen und hatten keinen Index;
# „einmal je …“ war bisher nur im Code geprüft, zwei gleichzeitige Anfragen konnten zwei Zeilen anlegen.
AUDIT_UNIQUE_INDEXES: tuple[tuple[str, Any, str, dict], ...] = (
    ("user_xp", "user_id", "user", {}),
    # Stand der Zähler und Signale der Erfolge: je Konto eine Zeile bzw. eine je Signal - bei jeder Auswertung und
    # seit #615 bei jedem Abruf der Abstimmungen gelesen.
    ("user_achievement_stats", "user_id", "user", {}),
    ("user_signals", [("user_id", 1), ("name", 1)], "user_name", {}),
    ("news_reads", [("user_id", 1), ("news_id", 1)], "user_news", {}),
    ("discord_memberships", [("user_id", 1), ("guild_id", 1)], "user_guild", {}),
    ("youtube_videos", [("channel_id", 1), ("video_id", 1)], "channel_video", {}),
    # Ein fremdes Konto gehört zu höchstens einem Nutzer. Verknüpfungen ohne Kennung der Plattform bleiben außen vor.
    ("platform_links", [("platform", 1), ("external_id", 1)], "platform_external",
     {"partialFilterExpression": {"external_id": {"$type": "string"}}}),
    # Je Person und Plattform eine Verknüpfung (#1027) - link_account legt sie in einem Schritt an.
    ("platform_links", [("user_id", 1), ("platform", 1)], "user_platform", {}),
    # Discord (#631): je Person und Tag bzw. je Server und Tag genau eine Zeile - der Bot zählt bei jeder Nachricht hoch.
    ("discord_activity", [("user_id", 1), ("day", 1)], "user_day", {}),
    ("discord_guild_stats", [("guild_id", 1), ("day", 1)], "guild_day", {}),
    ("discord_guild_active", [("guild_id", 1), ("day", 1), ("user_id", 1)], "guild_day_user", {}),
    # Je eingefrorenem Preis höchstens ein Rechnungsauftrag (#1184). Nur Aufträge mit Schlüssel zählen - ältere haben
    # keinen und können den Aufbau nie blockieren; Dubletten ließen ohnehin nur einen gewöhnlichen Index zurück.
    ("billing_orders", "booking_key", "booking_key", {"partialFilterExpression": {"booking_key": {"$exists": True}}}),
    # Je Konto, Mitglied, Zweck, Entscheidung und Fassung höchstens ein offener Einwilligungsauftrag (#1537): zwei
    # gleichzeitige Klicks schicken dieselbe Kennung an Dolibarr. Abgeschlossene Aufträge bleiben außen vor.
    ("consent_decisions", [("user_id", 1), ("member_id", 1), ("code", 1), ("decision", 1), ("version", 1)], "open_decision",
     {"partialFilterExpression": {"status": {"$in": ["sent", "pending"]}}}),
    # Fast Lap (#1584): je Platz, Quelle und Person ein Gewinn, je Saison, Strecke und Person eine Punktezeile - der
    # Abgleich nach einer Korrektur schreibt per Upsert darauf.
    ("prize_pickups", FASTLAP_PRIZE_KEY, "fastlap_place_user", {"partialFilterExpression": {"source_type": "fastlap"}}),
    ("season_points", [("season_id", 1), ("source_type", 1), ("source_id", 1), ("user_id", 1)], "fastlap_source_user",
     {"partialFilterExpression": {"source_type": "fastlap"}}),
)
AUDIT_INDEXES: tuple[tuple[str, Any], ...] = (
    ("platform_links", "user_id"),
    ("moderation_sanctions", [("user_id", 1), ("status", 1)]),  # bei jeder Chat-Nachricht gelesen
    ("moderation_strikes", "user_id"),
    # Frist nach der Kontolöschung (#1029): der tägliche Job sucht danach.
    ("consent_records", "erase_after"),
    ("consent_decisions", "erase_after"),
    ("moderation_strikes", "erase_after"),
    ("moderation_sanctions", "erase_after"),
    ("user_reports", "erase_after"),
    ("match_reports_v2", "erase_after"),
    ("contact_messages", "erase_after"),
    ("moderation_strikes", [("source", 1), ("ref_id", 1)]),
    ("team_members", [("team_id", 1), ("user_id", 1)]),
    ("team_members", "user_id"),
    ("membership_applications", [("user_id", 1), ("status", 1)]),
    ("membership_applications", "status"),
    ("media_scans", "state"),
    ("media_scans", "owner_id"),
    ("billing_cases", [("order_id", 1), ("status", 1)]),
    ("billing_cases", "status"),
    ("tournament_awards", [("tournament_id", 1), ("registration_id", 1)]),
    ("tournament_awards", "registration_id"),
    ("team_squads", "team_id"),
    ("chat_attachments", "owner_id"),
    ("chat_attachments", [("status", 1), ("created_at", 1)]),
    ("stream_watches", [("user_id", 1), ("day", 1), ("key", 1)]),
    ("match_commendations", [("match_id", 1), ("from_registration_id", 1)]),
    ("match_commendations", "to_registration_id"),
    ("match_commendations", "from_user_id"),
    ("club_member_profiles", "user_id"),
    ("club_member_profiles", "dolibarr_member_id"),
    # Felder, nach denen Startseite und Listen filtern oder sortieren.
    ("news_posts", [("published", 1), ("published_at", -1)]),
    ("seasons", "status"),
    ("tournaments", "start_date"),
    ("events", "start_date"),
    ("f1_challenges", "start_date"),
    # Statistik je Server (#631): Auskunft und Löschen je Konto, Aufräumen und Fenster je Tag.
    ("discord_guild_active", "user_id"),
    ("discord_guild_active", "day"),
)


async def merge_duplicate_platform_links(db) -> int:
    """Vor dem eindeutigen Index user_platform (#1027): Gibt es für eine Person und Plattform mehrere Zeilen, bleibt
    die zuletzt verknüpfte - sie ist die, die das Profilfeld zuletzt gefüllt hat. Läuft nur, solange der eindeutige
    Index fehlt; danach kann keine Dublette mehr entstehen."""
    if "user_platform_unique" in await db.platform_links.index_information():
        return 0
    groups = await db.platform_links.aggregate([
        {"$group": {"_id": {"user_id": "$user_id", "platform": "$platform"}, "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": 1}}},
    ]).to_list(None)
    removed = 0
    for group in groups:
        rows = await db.platform_links.find(dict(group["_id"]), {"_id": 1}).sort([("linked_at", -1), ("_id", -1)]).to_list(None)
        stale = [row["_id"] for row in rows[1:]]
        if stale:
            removed += (await db.platform_links.delete_many({"_id": {"$in": stale}})).deleted_count
    if removed:
        logger.warning("[indexes] platform_links: %s doppelte Verknüpfungen zusammengeführt", removed)
    return removed


async def blocked_unique_indexes(db) -> list[str]:
    """Welche eindeutigen Indizes aus der Vollprüfung noch fehlen - für Betrieb → Checks (#1043). Gelesen wird der Stand
    in der Datenbank, nicht der des letzten Starts: nach einer Bereinigung samt Index ist die Prüfung gleich grün."""
    blocked = []
    for collection, _keys, name, _options in AUDIT_UNIQUE_INDEXES:
        if f"{name}_unique" not in await getattr(db, collection).index_information():
            blocked.append(f"{collection}.{name}")
    return blocked


async def init_audit_indexes(db) -> dict:
    """Die Indizes aus der Vollprüfung. Gibt zurück, welche eindeutigen an Dubletten gescheitert sind."""
    await merge_duplicate_platform_links(db)
    for collection, name in REPLACED_INDEXES:
        if name in await getattr(db, collection).index_information():
            await getattr(db, collection).drop_index(name)
    blocked = []
    for collection, keys, name, options in AUDIT_UNIQUE_INDEXES:
        if not await unique_index(getattr(db, collection), keys, name, **options):
            blocked.append(f"{collection}.{name}")
    for collection, keys in AUDIT_INDEXES:
        await getattr(db, collection).create_index(keys)
    return {"unique": len(AUDIT_UNIQUE_INDEXES) - len(blocked), "blocked": blocked, "plain": len(AUDIT_INDEXES)}


async def close_client():
    global _client
    if _client is not None:
        _client.close()
        _client = None
