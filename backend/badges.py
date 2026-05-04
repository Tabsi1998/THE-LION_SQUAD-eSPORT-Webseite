"""Phase 6 — Achievements with audiences (members-only, secret, negative-fun, etc.).

Each badge entry now defines:
* `audience` — public / community / members_only / admins_only / hidden_secret
* `negative` — true for tongue-in-cheek "Holzmedaille" style awards (not showcaseable)
* `secret` — hidden until earned
* `requires_membership` — only club members can earn it
"""
import logging
from database import get_db
from models import now_utc, new_id

logger = logging.getLogger("tls.badges")


# Helper to keep the catalog readable
def _b(code, name, description, *, tier="bronze", category="tournament", icon="flag",
       points=5, audience="public", secret=False, negative=False,
       requires_membership=False, can_showcase=True):
    return {
        "code": code, "name": name, "description": description,
        "tier": tier, "category": category, "icon": icon, "points": points,
        "audience": audience, "secret": secret, "negative": negative,
        "requires_membership": requires_membership, "can_showcase": can_showcase,
    }


BADGE_CATALOG = [
    # ---------- Public / Community: Tournaments ----------
    _b("first_tournament", "Erste Anmeldung", "Melde dich für dein erstes Turnier an.",
       tier="bronze", category="tournament", icon="flag", points=5, audience="community"),
    _b("first_checkin", "Erster Check-in", "Melde dich erfolgreich beim ersten Turnier an.",
       tier="bronze", category="tournament", icon="check-circle", points=5, audience="community"),
    _b("first_win", "First Blood", "Gewinne dein erstes Match.",
       tier="bronze", category="match", icon="target", points=10, audience="community"),
    _b("podium_finisher", "Podium Finisher", "Erreiche Top 3 in einem Turnier.",
       tier="silver", category="tournament", icon="medal", points=25, audience="public"),
    _b("tournament_champion", "Turniersieger", "Gewinne ein ganzes Turnier.",
       tier="gold", category="tournament", icon="trophy", points=50, audience="public"),
    _b("grand_champion", "Grand Champion", "Gewinne 3 Turniere.",
       tier="platinum", category="tournament", icon="crown", points=150, audience="public"),
    _b("veteran_10", "Veteran I", "Nimm an 10 Turnieren teil.",
       tier="silver", category="tournament", icon="shield", points=20, audience="community"),
    _b("veteran_25", "Veteran II", "Nimm an 25 Turnieren teil.",
       tier="gold", category="tournament", icon="shield-check", points=75, audience="community"),

    # Matches
    _b("win_streak_3", "Drei in Folge", "Gewinne 3 Matches am Stück.",
       tier="silver", category="match", icon="flame", points=20, audience="public"),
    _b("win_streak_5", "Ungeschlagen", "Gewinne 5 Matches am Stück.",
       tier="gold", category="match", icon="zap", points=40, audience="public"),
    _b("clutch_reverse", "Clutch", "Gewinne ein Match nach Comeback-Score.",
       tier="gold", category="match", icon="sparkles", points=30, audience="public"),

    # Fast Lap
    _b("first_lap", "Erster Versuch", "Trage deine erste Fast-Lap-Zeit ein.",
       tier="bronze", category="fastlap", icon="flag", points=5, audience="community"),
    _b("laps_10", "10 Runden", "Fahre 10 Fast-Lap Versuche.",
       tier="silver", category="fastlap", icon="flag", points=15, audience="community"),
    _b("laps_50", "50 Runden", "Fahre 50 Fast-Lap Versuche.",
       tier="gold", category="fastlap", icon="flag-triangle-right", points=60, audience="community"),
    _b("lap_pole_position", "Pole Position", "Fahre die schnellste Zeit auf einer Strecke.",
       tier="gold", category="fastlap", icon="trophy", points=40, audience="public"),
    _b("lap_sub_target", "Sub-Grenze", "Knacke die Sekunden-Zielzeit eines Admins.",
       tier="platinum", category="fastlap", icon="timer", points=100, audience="public"),

    # Community
    _b("dispute_free_20", "Fair Play", "20 Matches ohne Dispute.",
       tier="silver", category="community", icon="heart-handshake", points=30, audience="public"),
    _b("dispute_free_50", "Sportsmanship", "50 Matches ohne Dispute.",
       tier="gold", category="community", icon="heart-handshake", points=75, audience="public"),
    _b("team_founder", "Team-Gründer", "Gründe ein eigenes Team.",
       tier="bronze", category="community", icon="users", points=10, audience="community"),
    _b("clan_member", "Clan-Mitglied", "Werde offizielles Team-Mitglied.",
       tier="bronze", category="community", icon="users", points=5, audience="community"),

    # Season
    _b("season_top10", "Season Top 10", "Erreiche Top 10 in einer Saison.",
       tier="gold", category="season", icon="trending-up", points=75, audience="public"),
    _b("season_champion", "Season Champion", "Gewinne die Saisonwertung.",
       tier="platinum", category="season", icon="crown", points=200, audience="public"),

    # ---------- Members-only ----------
    _b("offiziell_im_rudel", "Offiziell im Rudel", "Du bist offizielles Vereinsmitglied.",
       tier="gold", category="club", icon="crown", points=50,
       audience="members_only", requires_membership=True),
    _b("vereinsmitglied_bronze", "Vereinsmitglied Bronze", "3 Monate offizielles Vereinsmitglied.",
       tier="bronze", category="club", icon="badge", points=30,
       audience="members_only", requires_membership=True),
    _b("vereinsmitglied_silber", "Vereinsmitglied Silber", "6 Monate offizielles Vereinsmitglied.",
       tier="silver", category="club", icon="badge", points=60,
       audience="members_only", requires_membership=True),
    _b("vereinsmitglied_gold", "Vereinsmitglied Gold", "12 Monate offizielles Vereinsmitglied.",
       tier="gold", category="club", icon="badge", points=100,
       audience="members_only", requires_membership=True),
    _b("vereinsmitglied_platin", "Vereinsmitglied Platin", "24 Monate offizielles Vereinsmitglied.",
       tier="platinum", category="club", icon="award", points=200,
       audience="members_only", requires_membership=True),
    _b("ehrenloewe", "Ehrenlöwe", "Manuell durch den Vorstand vergeben — Hall of Fame.",
       tier="platinum", category="club", icon="crown", points=300,
       audience="members_only", requires_membership=True, secret=True),

    # ---------- Negative Fun (auto-awarded, not showcaseable, not visible until earned) ----------
    _b("holzmedaille", "Holzmedaille", "Knapp am Podest vorbei — 4. Platz.",
       tier="bronze", category="fun", icon="frown", points=0,
       audience="public", negative=True, can_showcase=False, secret=True),
    _b("afk_legende", "AFK-Legende", "Check-in verpasst.",
       tier="bronze", category="fun", icon="user-x", points=0,
       audience="public", negative=True, can_showcase=False, secret=True),
    _b("wandmagnet", "Wandmagnet", "Mehrere ungültige Fast-Lap-Runden in einer Challenge.",
       tier="bronze", category="fun", icon="zap-off", points=0,
       audience="public", negative=True, can_showcase=False, secret=True),
    _b("last_minute_panic", "Last Minute Panic", "Anmeldung in den letzten 5 Minuten.",
       tier="bronze", category="fun", icon="clock", points=0,
       audience="public", negative=True, can_showcase=False, secret=True),
    _b("controller_leer", "Controller leer", "Match-Start verzögert > 5 min.",
       tier="bronze", category="fun", icon="battery-low", points=0,
       audience="public", negative=True, can_showcase=False, secret=True),
    _b("ehrenvoll_untergegangen", "Ehrenvoll untergegangen", "Klare Niederlage im Finale.",
       tier="bronze", category="fun", icon="skull", points=0,
       audience="public", negative=True, can_showcase=False, secret=True),
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


def _user_can_see_badge(badge: dict, user: dict | None) -> bool:
    """Catalog visibility — does this user even know the badge exists?"""
    if badge.get("secret"):
        # Secrets are hidden until earned (handled elsewhere). Catalog hides them.
        return False
    aud = badge.get("audience", "public")
    if aud == "public":
        return True
    if not user:
        return False
    if aud == "admins_only":
        return user.get("role") in ("club_admin", "superadmin")
    if aud == "community":
        return True
    if aud == "members_only":
        return bool(user.get("is_club_member") or user.get("role") in (
            "moderator", "tournament_admin", "club_admin", "superadmin"
        ))
    return True


async def award_badge(user_id: str, code: str, context: dict | None = None) -> bool:
    """Award a badge if not already held. Enforces `requires_membership`.
    Returns True if newly awarded."""
    db = get_db()
    if code not in BADGE_BY_CODE:
        return False
    badge = BADGE_BY_CODE[code]
    if badge.get("requires_membership"):
        member = await db.memberships.find_one({"user_id": user_id})
        if not member or member.get("member_status") not in ("active", "honorary"):
            return False
    existing = await db.user_badges.find_one({"user_id": user_id, "badge_code": code})
    if existing:
        return False
    doc = {
        "id": new_id(),
        "user_id": user_id,
        "badge_code": code,
        "earned_at": now_utc().isoformat(),
        "context": context or {},
    }
    await db.user_badges.insert_one(doc)
    # Discord notification (positive badges only)
    if not badge.get("negative"):
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


# -------- Members-only auto-awards --------
async def evaluate_membership_badges(user_id: str):
    """After membership status change — award tenure badges (Bronze/Silber/Gold/Platin)."""
    db = get_db()
    m = await db.memberships.find_one({"user_id": user_id})
    if not m or m.get("member_status") not in ("active", "honorary"):
        return
    await award_badge(user_id, "offiziell_im_rudel", {"member_number": m.get("member_number")})
    if m.get("member_since"):
        from datetime import datetime, timezone
        try:
            since = datetime.fromisoformat(m["member_since"].replace("Z", "+00:00"))
            if since.tzinfo is None:
                since = since.replace(tzinfo=timezone.utc)
            days = (datetime.now(timezone.utc) - since).days
            if days >= 90:
                await award_badge(user_id, "vereinsmitglied_bronze", {"days": days})
            if days >= 180:
                await award_badge(user_id, "vereinsmitglied_silber", {"days": days})
            if days >= 365:
                await award_badge(user_id, "vereinsmitglied_gold", {"days": days})
            if days >= 730:
                await award_badge(user_id, "vereinsmitglied_platin", {"days": days})
        except (ValueError, TypeError):
            pass


# -------- Event Hooks --------
async def on_tournament_registered(user_id: str, tournament_id: str):
    db = get_db()
    await award_badge(user_id, "first_tournament", {"tournament_id": tournament_id})
    count = await db.tournament_registrations.count_documents({"user_id": user_id})
    if count >= 10:
        await award_badge(user_id, "veteran_10", {"count": count})
    if count >= 25:
        await award_badge(user_id, "veteran_25", {"count": count})
    # Last-minute panic check
    from datetime import datetime, timezone
    t = await db.tournaments.find_one({"id": tournament_id})
    if t and t.get("registration_open_until"):
        try:
            close = datetime.fromisoformat(t["registration_open_until"].replace("Z", "+00:00"))
            if close.tzinfo is None:
                close = close.replace(tzinfo=timezone.utc)
            if (close - datetime.now(timezone.utc)).total_seconds() < 300:
                await award_badge(user_id, "last_minute_panic", {"tournament_id": tournament_id})
        except (ValueError, TypeError):
            pass


async def on_checked_in(user_id: str, tournament_id: str):
    await award_badge(user_id, "first_checkin", {"tournament_id": tournament_id})


async def on_match_completed(winner_user_id: str, loser_user_id: str | None,
                             tournament_id: str, match_id: str):
    db = get_db()
    if winner_user_id:
        await award_badge(winner_user_id, "first_win", {"match_id": match_id})
        recent_matches = await db.matches.find(
            {"tournament_id": tournament_id, "status": "completed"},
            {"_id": 0},
        ).sort("updated_at", -1).to_list(20)
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
    db = get_db()
    for p in placements:
        uid = p.get("user_id")
        rank = p.get("rank")
        if not uid:
            continue
        if rank == 4:
            await award_badge(uid, "holzmedaille", {"tournament_id": tournament_id})
        if rank and rank <= 3:
            await award_badge(uid, "podium_finisher", {"tournament_id": tournament_id, "rank": rank})
        if rank == 1:
            await award_badge(uid, "tournament_champion", {"tournament_id": tournament_id})
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
    db = get_db()
    if is_invalid:
        # Wandmagnet: 5+ invalid laps in same challenge
        invalids = await db.f1_lap_times.count_documents(
            {"user_id": user_id, "challenge_id": challenge_id, "is_invalid": True}
        )
        if invalids >= 5:
            await award_badge(user_id, "wandmagnet", {"challenge_id": challenge_id, "invalids": invalids})
        return
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
