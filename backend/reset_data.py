"""Explicit development/test-only database reset command."""
from __future__ import annotations

import argparse
import asyncio
import os

from database import close_client, get_db
from runtime_config import resolve_app_environment


RESET_CONFIRMATION = "RESET-ALL-DATA"
RESET_COLLECTIONS = [
    "users", "teams", "team_members", "games", "events", "tournaments",
    "game_servers", "tournament_registrations", "matches", "f1_challenges",
    "f1_tracks", "f1_lap_times", "stations", "news_posts", "sponsors",
    "partners", "seasons", "references", "tournament_groups", "memberships",
    "member_benefits", "user_socials", "gallery_albums", "gallery_photos",
    "documents", "season_points", "audit_logs", "email_logs", "notifications",
    "password_reset_tokens", "login_attempts", "user_achievements", "achievements",
    "achievement_groups", "mail_jobs", "media_uploads", "prize_pickups",
    "club_member_profiles", "tournament_staff_assignments", "event_registrations",
    "tournament_stages", "matches_v2", "match_reports_v2",
    "match_schedule_proposals", "match_chat_messages", "direct_messages",
    "team_chat_messages", "team_invites",
]


async def reset_database(expected_database: str, confirmation: str) -> None:
    app_env = resolve_app_environment()
    if app_env == "production":
        raise RuntimeError("Database reset is blocked in production.")
    actual_database = os.environ.get("DB_NAME", "").strip()
    if not actual_database or expected_database != actual_database:
        raise RuntimeError("--database must exactly match the configured DB_NAME.")
    if confirmation != RESET_CONFIRMATION:
        raise RuntimeError(f"--confirm must exactly equal {RESET_CONFIRMATION}.")

    db = get_db()
    try:
        for collection in RESET_COLLECTIONS:
            result = await db[collection].delete_many({})
            print(f"[reset] {collection}: deleted {result.deleted_count}")
    finally:
        await close_client()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, help="Must match DB_NAME exactly.")
    parser.add_argument("--confirm", required=True, help=f"Must equal {RESET_CONFIRMATION}.")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(reset_database(args.database, args.confirm))
