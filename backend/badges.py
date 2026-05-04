"""TLS ARENA · Achievement / Badge system.

Badges are immutable definitions (seeded on startup). Users earn them automatically
via trigger hooks (e.g. after match completion, F1 lap submission, tournament registration).
"""
import logging
from database import get_db
from models import now_utc, new_id

logger = logging.getLogger("tls-arena.badges")

# -------- Badge Catalog --------
# Each: code (unique key), name, description, tier, category, icon (lucide name), points (season bonus)
BADGE_CATALOG = [
    # Tournaments
    {"code": "first_tournament", "name": "Erste Anmeldung", "description": "Melde dich für dein erstes Turnier an.",
     "tier": "bronze", "category": "tournament", "icon": "flag", "points": 5},
    {"code": "first_checkin", "name": "Erster Check-in", "description": "Melde dich erfolgreich beim ersten Turnier an.",
     "tier": "bronze", "category": "tournament", "icon": "check-circle", "points": 5},
    {"code": "first_win", "name": "First Blood", "description": "Gewinne dein erstes Match.",
     "tier": "bronze", "category": "match", "icon": "target", "points": 10},
    {"code": "podium_finisher", "name": "Podium Finisher", "description": "Erreiche Top 3 in einem Turnier.",
     "tier": "silver", "category": "tournament", "icon": "medal", "points": 25},
    {"code": "tournament_champion", "name": "Turniersieger", "description": "Gewinne ein ganzes Turnier.",
     "tier": "gold", "category": "tournament", "icon": "trophy", "points": 50},
    {"code": "grand_champion", "name": "Grand Champion", "description": "Gewinne 3 Turniere.",
     "tier": "platinum", "category": "tournament", "icon": "crown", "points": 150},
    {"code": "veteran_10", "name": "Veteran I", "description": "Nimm an 10 Turnieren teil.",
     "tier": "silver", "category": "tournament", "icon": "shield", "points": 20},
    {"code": "veteran_25", "name": "Veteran II", "description": "Nimm an 25 Turnieren teil.",
     "tier": "gold", "category": "tournament", "icon": "shield-check", "points": 75},

    # Matches
    {"code": "win_streak_3", "name": "Drei in Folge", "description": "Gewinne 3 Matches am Stück.",
     "tier": "silver", "category": "match", "icon": "flame", "points": 20},
    {"code": "win_streak_5", "name": "Ungeschlagen", "description": "Gewinne 5 Matches am Stück.",
     "tier": "gold", "category": "match", "icon": "zap", "points": 40},
    {"code": "clutch_reverse", "name": "Clutch", "description": "Gewinne ein Match nach Comeback-Score.",
     "tier": "gold", "category": "match", "icon": "sparkles", "points": 30},

    # Fast Lap
    {"code": "first_lap", "name": "Erster Versuch", "description": "Trage deine erste Fast-Lap-Zeit ein.",
     "tier": "bronze", "category": "fastlap", "icon": "flag", "points": 5},
    {"code": "laps_10", "name": "10 Runden", "description": "Fahre 10 Fast-Lap Versuche.",
     "tier": "silver", "category": "fastlap", "icon": "flag", "points": 15},
    {"code": "laps_50", "name": "50 Runden", "description": "Fahre 50 Fast-Lap Versuche.",
     "tier": "gold", "category": "fastlap", "icon": "flag-triangle-right", "points": 60},
    {"code": "lap_pole_position", "name": "Pole Position", "description": "Fahre die schnellste Zeit auf einer Strecke.",
     "tier": "gold", "category": "fastlap", "icon": "trophy", "points": 40},
    {"code": "lap_sub_target", "name": "Sub-Grenze", "description": "Knacke die Sekunden-Zielzeit eines Admins (markiert).",
     "tier": "platinum", "category": "fastlap", "icon": "timer", "points": 100},

    # Community
    {"code": "dispute_free_20", "name": "Fair Play", "description": "20 Matches ohne Dispute.",
     "tier": "silver", "category": "community", "icon": "heart-handshake", "points": 30},
    {"code": "dispute_free_50", "name": "Sportsmanship", "description": "50 Matches ohne Dispute.",
     "tier": "gold", "category": "community", "icon": "heart-handshake", "points": 75},
    {"code": "team_founder", "name": "Team-Gründer", "description": "Gründe ein eigenes Team.",
     "tier": "bronze", "category": "community", "icon": "users", "points": 10},
    {"code": "clan_member", "name": "Clan-Mitglied", "description": "Werde offizielles Team-Mitglied.",
     "tier": "bronze", "category": "community", "icon": "users", "points": 5},

    # Season
    {"code": "season_top10", "name": "Season Top 10", "description": "Erreiche Top 10 in einer Saison.",
     "tier": "gold", "category": "season", "icon": "trending-up", "points": 75},
    {"code": "season_champion", "name": "Season Champion", "description": "Gewinne die Saisonwertung.",
     "tier": "platinum", "category": "season", "icon": "crown", "points": 200},
]

BADGE_BY_CODE = {b["code"]: b for b in BADGE_CATALOG}


async def seed_badges():
    """Upsert badge catalog on startup."""
    db = get_db()
    for b in BADGE_CATALOG:
        await db.badges.update_one(
            {"code": b["code"]},
            {"$set": {**b, "id": b["code"]},
             "$setOnInsert": {"created_at": now_utc().isoformat()}},
            upsert=True,
        )


async def award_badge(user_id: str, code: str, context: dict | None = None) -> bool:
    """Award a badge if not already held. Returns True if newly awarded."""
    db = get_db()
    if code not in BADGE_BY_CODE:
        return False
    existing = await db.user_badges.find_one({"user_id": user_id, "badge_code": code})
    if existing:
        return False
    badge = BADGE_BY_CODE[code]
    doc = {
        "id": new_id(),
        "user_id": user_id,
        "badge_code": code,
        "earned_at": now_utc().isoformat(),
        "context": context or {},
    }
    await db.user_badges.insert_one(doc)
    # Discord notification
    try:
        from discord_service import send_discord
        user = await db.users.find_one({"id": user_id},
                                        {"display_name": 1, "username": 1, "slug": 1}) or {}
        tier_colors = {"bronze": 0xCD7F32, "silver": 0xC0C0C0, "gold": 0xFFD700, "platinum": 0x29B6E8}
        await send_discord(
            f"🏅 Neues Badge · {badge['name']}",
            f"**{user.get('display_name') or user.get('username') or 'Fahrer'}** hat **{badge['name']}** freigeschaltet!\n_{badge['description']}_",
            color=tier_colors.get(badge["tier"], 0x29B6E8),
            url=f"/u/{user.get('username') or user_id}",
            fields=[
                {"name": "Tier", "value": badge["tier"].upper(), "inline": True},
                {"name": "Punkte", "value": f"+{badge['points']}", "inline": True},
            ],
            event_key="badge.awarded",
        )
    except Exception as e:
        logger.debug(f"Discord badge trigger failed: {e}")
    return True


# -------- Event Hooks --------
async def on_tournament_registered(user_id: str, tournament_id: str):
    """User just registered for a tournament."""
    db = get_db()
    await award_badge(user_id, "first_tournament", {"tournament_id": tournament_id})
    count = await db.tournament_registrations.count_documents({"user_id": user_id})
    if count >= 10:
        await award_badge(user_id, "veteran_10", {"count": count})
    if count >= 25:
        await award_badge(user_id, "veteran_25", {"count": count})


async def on_checked_in(user_id: str, tournament_id: str):
    await award_badge(user_id, "first_checkin", {"tournament_id": tournament_id})


async def on_match_completed(winner_user_id: str, loser_user_id: str | None,
                             tournament_id: str, match_id: str):
    """Award match-based badges to both players. winner_user_id may be None."""
    db = get_db()
    if winner_user_id:
        await award_badge(winner_user_id, "first_win", {"match_id": match_id})
        # Streak: count consecutive recent wins in this tournament
        recent_matches = await db.matches.find(
            {"tournament_id": tournament_id, "status": "completed",
             "$or": [{"winner_id": {"$exists": True}}]},
            {"_id": 0},
        ).sort("updated_at", -1).to_list(20)
        # Map registration -> user
        reg_map = {r["id"]: r.get("user_id")
                   for r in await db.tournament_registrations.find(
                       {"tournament_id": tournament_id}, {"_id": 0}).to_list(500)}
        streak = 0
        for m in recent_matches:
            w = reg_map.get(m.get("winner_id"))
            lost = reg_map.get(m.get("loser_id"))
            if w == winner_user_id:
                streak += 1
            elif lost == winner_user_id:
                break
        if streak >= 3:
            await award_badge(winner_user_id, "win_streak_3", {"streak": streak})
        if streak >= 5:
            await award_badge(winner_user_id, "win_streak_5", {"streak": streak})


async def on_tournament_completed(tournament_id: str, placements: list[dict]):
    """placements: list of {user_id, rank}"""
    db = get_db()
    for p in placements:
        uid = p.get("user_id")
        rank = p.get("rank")
        if not uid:
            continue
        if rank and rank <= 3:
            await award_badge(uid, "podium_finisher", {"tournament_id": tournament_id, "rank": rank})
        if rank == 1:
            await award_badge(uid, "tournament_champion", {"tournament_id": tournament_id})
            # Count total wins
            wins = 0
            async for reg in db.tournament_registrations.find({"user_id": uid}):
                tid = reg.get("tournament_id")
                matches = await db.matches.find(
                    {"tournament_id": tid, "final_position": 1, "winner_id": reg["id"]}).to_list(5)
                if matches:
                    wins += 1
            if wins >= 3:
                await award_badge(uid, "grand_champion", {"wins": wins})


async def on_lap_submitted(user_id: str, challenge_id: str, track_id: str,
                           was_new_leader: bool, is_invalid: bool = False):
    if is_invalid:
        return
    db = get_db()
    await award_badge(user_id, "first_lap", {"challenge_id": challenge_id})
    if was_new_leader:
        await award_badge(user_id, "lap_pole_position", {"challenge_id": challenge_id, "track_id": track_id})
    total = await db.f1_lap_times.count_documents({"user_id": user_id, "is_invalid": {"$ne": True}})
    if total >= 10:
        await award_badge(user_id, "laps_10", {"total": total})
    if total >= 50:
        await award_badge(user_id, "laps_50", {"total": total})


async def on_team_created(user_id: str, team_id: str):
    await award_badge(user_id, "team_founder", {"team_id": team_id})


async def on_team_joined(user_id: str, team_id: str):
    await award_badge(user_id, "clan_member", {"team_id": team_id})
