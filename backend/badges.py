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
       requires_membership=False, can_showcase=True,
       progress_target=None, condition_key=None, severity=None):
    return {
        "code": code, "name": name, "description": description,
        "tier": tier, "category": category, "icon": icon, "points": points,
        "audience": audience, "secret": secret, "negative": negative,
        "requires_membership": requires_membership, "can_showcase": can_showcase,
        "progress_target": progress_target, "condition_key": condition_key,
        "severity": severity,
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
       tier="silver", category="tournament", icon="shield", points=20, audience="community",
       progress_target=10, condition_key="tournaments_registered"),
    _b("veteran_25", "Veteran II", "Nimm an 25 Turnieren teil.",
       tier="gold", category="tournament", icon="shield-check", points=75, audience="community",
       progress_target=25, condition_key="tournaments_registered"),

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
       tier="silver", category="fastlap", icon="flag", points=15, audience="community",
       progress_target=10, condition_key="fastlap_valid_count"),
    _b("laps_50", "50 Runden", "Fahre 50 Fast-Lap Versuche.",
       tier="gold", category="fastlap", icon="flag-triangle-right", points=60, audience="community",
       progress_target=50, condition_key="fastlap_valid_count"),
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

    # ---------- Phase B v3 — Positive Fun (public, showcaseable) ----------
    _b("first_dispute_resolved", "Friedenstifter", "Dein erster Dispute wurde gütlich gelöst.",
       tier="bronze", category="community", icon="handshake", points=10, audience="public"),
    _b("nightowl", "Nachteule", "Spiele ein Match zwischen 02:00 und 05:00 Uhr.",
       tier="bronze", category="fun", icon="moon", points=5, audience="public"),
    _b("early_bird", "Frühaufsteher", "Spiele ein Match zwischen 05:00 und 08:00 Uhr.",
       tier="bronze", category="fun", icon="sun", points=5, audience="public"),
    _b("perfect_attendance", "100 % Anwesenheit", "Check-in ohne Verspätung bei 5 Turnieren in Folge.",
       tier="silver", category="community", icon="check-check", points=25, audience="public",
       progress_target=5, condition_key="checkins_in_a_row"),
    _b("comeback_king", "Comeback-King", "Verliere ein Match, gewinne das nächste.",
       tier="silver", category="match", icon="rotate-cw", points=15, audience="public"),
    _b("multi_game", "Multitalent", "Nimm an Turnieren in 3 verschiedenen Spielen teil.",
       tier="silver", category="tournament", icon="layers", points=25, audience="public",
       progress_target=3, condition_key="distinct_games_registered"),
    _b("multi_platform", "Plattform-Held", "Spiele auf 2+ Plattformen.",
       tier="silver", category="community", icon="cpu", points=20, audience="public",
       progress_target=2, condition_key="distinct_platforms"),
    _b("season_silver", "Season Silber", "Erreiche Top 25 in einer Saison.",
       tier="silver", category="season", icon="trending-up", points=40, audience="public"),
    _b("invite_friend", "Bring a Friend", "Lade einen Freund ein, der sich registriert.",
       tier="silver", category="community", icon="user-plus", points=20, audience="public"),
    _b("streamer_spotted", "Streamer Spotted", "Verlinke einen Twitch-Stream in deinem Profil.",
       tier="bronze", category="community", icon="tv", points=10, audience="public"),
    _b("photo_op", "Photo Op", "Werde im Album eines Vereinsevents getaggt.",
       tier="bronze", category="community", icon="camera", points=10, audience="community"),
    _b("event_attendance_5", "Stammgast", "Nimm an 5 Vereinsevents teil.",
       tier="silver", category="community", icon="calendar-check", points=30, audience="community",
       progress_target=5, condition_key="events_attended"),
    _b("badge_collector_10", "Sammler", "Schalte 10 Badges frei.",
       tier="silver", category="community", icon="layers", points=30, audience="public",
       progress_target=10, condition_key="badges_unlocked"),
    _b("badge_collector_25", "Trophäenjäger", "Schalte 25 Badges frei.",
       tier="gold", category="community", icon="trophy", points=80, audience="public",
       progress_target=25, condition_key="badges_unlocked"),

    # ---------- Phase B v3 — Negative Fun: Player (mehr Würze) ----------
    _b("ghost_player", "Geist", "Anmeldung ohne jemals zu erscheinen.",
       tier="bronze", category="fun", icon="ghost", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="medium"),
    _b("rage_quitter", "Rage Quitter", "Match abgebrochen mit weniger als 30 % Spielzeit.",
       tier="bronze", category="fun", icon="x-circle", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="medium"),
    _b("nullachter", "Null-Achter", "Verloren mit 0:8 oder schlechter.",
       tier="bronze", category="fun", icon="frown", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),
    _b("tilt_master", "Tilt Master", "3 Niederlagen in Folge.",
       tier="bronze", category="fun", icon="alert-triangle", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),
    _b("captain_obvious", "Captain Obvious", "Score gemeldet, der nie bestätigt wurde.",
       tier="bronze", category="fun", icon="circle-help", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),
    _b("disconnect_diva", "DC-Diva", "3 Disconnects in einer Session.",
       tier="bronze", category="fun", icon="wifi-off", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="medium"),
    _b("snack_break", "Snack-Break-Pro", "Match-Pause länger als der eigene Match.",
       tier="bronze", category="fun", icon="cookie", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),
    _b("forgot_to_register", "Anmeldung? Welche Anmeldung?", "Turnier verpasst trotz angekündigter Teilnahme.",
       tier="bronze", category="fun", icon="bell-off", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="medium"),
    _b("backseat_pro", "Backseat-Profi", "5 Kommentare ohne selbst zu spielen.",
       tier="bronze", category="fun", icon="armchair", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),
    _b("toxic_chat_warning", "Verbalakrobat", "Chat-Verwarnung erhalten.",
       tier="bronze", category="fun", icon="message-square-warning", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="savage"),
    _b("no_show_admin", "Admin-Schreck", "Admin musste 3-mal nachhaken.",
       tier="bronze", category="fun", icon="megaphone-off", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="medium"),
    _b("controller_throw", "Controller-Wurf", "Hardware-Schaden gemeldet.",
       tier="bronze", category="fun", icon="alert-octagon", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="savage"),
    _b("lucky_loser", "Lucky Loser", "Erstes Match verloren — trotzdem ins Finale.",
       tier="bronze", category="fun", icon="dice-3", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),
    _b("flagged_screenshot", "Beweisfoto vergessen", "Score ohne Proof eingereicht (3-mal).",
       tier="bronze", category="fun", icon="image-off", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),
    _b("warmup_master", "Aufwärm-Spezialist", "Warmup länger als das eigentliche Match.",
       tier="bronze", category="fun", icon="thermometer-snowflake", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),

    # ---------- Phase B v3 — Negative Fun: Team (7) ----------
    _b("team_one_man", "Einzelkämpfer", "Team-Match mit nur einem aktiven Spieler.",
       tier="bronze", category="fun", icon="user-minus", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="medium"),
    _b("team_no_show", "Geisterclan", "Team komplett im No-Show-Modus.",
       tier="bronze", category="fun", icon="ghost", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="savage"),
    _b("team_friendly_fire", "Friendly Fire Champ", "Eigentor / Teamkill > 3 in einem Match.",
       tier="bronze", category="fun", icon="crosshair", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),
    _b("team_late_arrival", "Verspäteter Clan", "Komplettes Team verpasst Check-in.",
       tier="bronze", category="fun", icon="clock-alert", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="medium"),
    _b("team_dispute_loop", "Streit-Verein", "5+ offene Disputes als Team.",
       tier="bronze", category="fun", icon="messages-square", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="savage"),
    _b("team_drama_queen", "Drama-Queen-Team", "Team mit den meisten Forum-Beschwerden.",
       tier="bronze", category="fun", icon="theater", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),
    _b("team_revolving_door", "Drehtür", "Mehr als 50 % Mitgliederwechsel pro Saison.",
       tier="bronze", category="fun", icon="door-open", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),

    # ---------- Phase B v3 — Negative Fun: Fast Lap (8) ----------
    _b("offroad_artist", "Offroad-Künstler", "Mehr als 10 Mal von der Strecke abgekommen.",
       tier="bronze", category="fun", icon="map-off", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),
    _b("reverse_gear", "Rückwärtsgang", "Eine ganze Runde rückwärts gefahren.",
       tier="bronze", category="fun", icon="rotate-ccw", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),
    _b("slowest_lap", "Schneckenrennen", "Langsamste Rundenzeit auf einer Strecke.",
       tier="bronze", category="fun", icon="snail", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),
    _b("crash_test_dummy", "Crash-Test", "5+ Crashes in einer einzigen Session.",
       tier="bronze", category="fun", icon="car-front", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="medium"),
    _b("invalid_streak", "Ungültig-Marathon", "10+ ungültige Runden in einer Challenge.",
       tier="bronze", category="fun", icon="ban", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="medium"),
    _b("pit_lane_pro", "Boxengassen-Profi", "Mehr als 3 Pit-Stops pro Runde.",
       tier="bronze", category="fun", icon="construction", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="mild"),
    _b("dnf_legend", "DNF-Legende", "5 Did-Not-Finish Einträge in einer Saison.",
       tier="bronze", category="fun", icon="x-octagon", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="medium"),
    _b("ghost_lap", "Phantom-Runde", "Zeit gemeldet, aber kein Beweis.",
       tier="bronze", category="fun", icon="cloud-off", points=0,
       audience="public", negative=True, can_showcase=False, secret=True, severity="savage"),
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


# ---------- Phase B v3 — Progress Aggregator ----------
async def compute_user_progress(user_id: str) -> dict[str, int]:
    """Aggregate counters used by progress_target / condition_key fields.

    Returns dict {condition_key: current_count} to be merged into badge listings.
    """
    db = get_db()
    progress: dict[str, int] = {}

    progress["tournaments_registered"] = await db.tournament_registrations.count_documents({"user_id": user_id})
    progress["fastlap_valid_count"] = await db.f1_lap_times.count_documents({"user_id": user_id, "is_invalid": {"$ne": True}})
    progress["badges_unlocked"] = await db.user_badges.count_documents({"user_id": user_id})
    progress["events_attended"] = await db.event_registrations.count_documents({"user_id": user_id, "checked_in": True}) if "event_registrations" in await db.list_collection_names() else 0

    # Distinct games via tournament -> game_id
    regs = await db.tournament_registrations.find({"user_id": user_id}, {"_id": 0, "tournament_id": 1}).to_list(500)
    tids = list({r["tournament_id"] for r in regs if r.get("tournament_id")})
    distinct_games = 0
    if tids:
        games = await db.tournaments.distinct("game_id", {"id": {"$in": tids}})
        distinct_games = len([g for g in games if g])
    progress["distinct_games_registered"] = distinct_games

    # Distinct platforms from user profile
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "main_platforms": 1, "main_platform": 1})
    platforms = set()
    if user:
        for p in (user.get("main_platforms") or []):
            if p:
                platforms.add(p)
        if user.get("main_platform"):
            platforms.add(user.get("main_platform"))
    progress["distinct_platforms"] = len(platforms)

    # Streak counters — best-effort (placeholders, computed conservatively)
    progress["checkins_in_a_row"] = 0  # filled by tournament hook on success

    return progress
