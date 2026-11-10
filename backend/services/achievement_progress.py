"""Der alte Zähler-Block der Erfolge und die Profil-Vollständigkeit (#1420: aus badges.py herausgelöst).

``compute_user_progress`` rechnet die Zähler aus Turnieren, Spielen, Mitgliedschaft, Teams und Profil; die neuen
Zähler stehen in services/achievement_counters.py. Eigenes Modul, damit XP, Zähler und Migration den Block nutzen
können, ohne die Auswertung (badges.py) zu importieren - die importiert sie nämlich selbst.
"""
from datetime import datetime, timezone

from database import get_db
from services.private_fields import private_projection
from services.achievement_participation import load_participation


# ---------- Profile-Completeness (Phase C) ----------
PROFILE_FIELDS = [
    ("avatar_url", 1.0),
    ("banner_url", 0.6),
    ("bio", 1.0),
    ("country", 0.8),
    ("city", 0.6),
    ("birth_date", 0.6),
    ("main_platforms", 1.0),     # list, non-empty
    ("input_devices", 0.8),      # list
    ("favorite_games", 0.8),     # list
    ("discord_name", 0.8),
    ("twitch_handle", 0.6),
    ("privacy_public_profile", 0.4),  # explicit choice
]


def compute_profile_completeness(user: dict | None) -> int:
    """Return percent (0–100) of profile completeness using PROFILE_FIELDS weights."""
    if not user:
        return 0
    total = sum(w for _, w in PROFILE_FIELDS)
    score = 0.0
    for key, weight in PROFILE_FIELDS:
        v = user.get(key)
        if isinstance(v, list):
            if len(v) > 0:
                score += weight
        elif isinstance(v, bool):
            # privacy_public_profile counts when set (either true or false explicitly)
            if v is True or v is False:
                score += weight
        elif v not in (None, "", 0):
            score += weight
    return round(100 * score / total) if total else 0


# ---------------- Progress Counters ----------------
async def compute_user_progress(user_id: str) -> dict[str, int]:
    db = get_db()
    p: dict[str, int] = {}

    # Eine Grundlage für Spiele, Teilnahmen und Plätze (#2337, services/achievement_participation): gezählt wird für die,
    # die gespielt haben - auch im Team und in der Liga, nie ein Freilos. Turnierzähler, Plätze und Pokale ohne
    # Liga-Staffeln (docs/LIGA.md, 7).
    participation = await load_participation(db, user_id)
    # Turnierveteran, Multitalent, Formatvielfalt: Teilnahme statt Anmeldung - dieselbe Rechnung wie die Registry.
    p["tournaments_registered"] = participation.tournaments_played()
    p["distinct_games_registered"] = participation.distinct_games()
    p["distinct_formats"] = participation.distinct_formats()
    p.update(participation.match_progress())
    # Für „Saisons aktiv“ zählt weiter jede eigene Anmeldung zu einem Turnier.
    tids = sorted({
        registration["tournament_id"] for registration in participation.registrations.values()
        if registration.get("user_id") == user_id and registration.get("tournament_id")
        and not participation.is_league(registration["tournament_id"])
    })

    # Champion, Podest und Holzmedaille (#2337): der gespeicherte Rang der Auszeichnung, nur aus abgeschlossenen Turnieren
    # (keine Liga-Staffel) - nicht mehr der Zwischenstand eines laufenden Turniers.
    placements = (await participation.placements(db)).values()
    p["tournaments_won"] = sum(1 for placement in placements if 1 in placement.ranks)
    p["podium_finishes"] = sum(1 for placement in placements if placement.ranks & {1, 2, 3})
    p["rank_4_count"] = sum(1 for placement in placements if 4 in placement.ranks)

    official_lap_query = {
        "user_id": user_id,
        "is_invalid": {"$ne": True},
        "$or": [{"score_scope": {"$exists": False}}, {"score_scope": {"$ne": "club_reference"}}],
    }
    p["fastlap_valid_count"] = await db.f1_lap_times.count_documents(official_lap_query)
    distinct_tracks = await db.f1_lap_times.distinct("track_id", official_lap_query)
    p["distinct_tracks"] = len([t for t in distinct_tracks if t])
    pole_count = 0
    for tid in distinct_tracks:
        if not tid:
            continue
        # Pole aus der einen Rangfunktion (#1584): Strafe eingerechnet, Gleichstand - die früher gefahrene Zeit vorn.
        from services.fastlap_standings import load_laps, official_query, rank_laps
        ranked = rank_laps(await load_laps(db, official_query({"track_id": tid})))
        if ranked and ranked[0]["user_id"] == user_id:
            pole_count += 1
    p["pole_count"] = pole_count

    membership_days = 0
    m = await db.memberships.find_one({"user_id": user_id})
    if m and m.get("member_since") and m.get("member_status") in ("active", "honorary"):
        try:
            since = datetime.fromisoformat(m["member_since"].replace("Z", "+00:00"))
            if since.tzinfo is None:
                since = since.replace(tzinfo=timezone.utc)
            membership_days = max((datetime.now(timezone.utc) - since).days, 1)
        except (ValueError, TypeError):
            pass  # unlesbares Beitrittsdatum: dann bleibt es bei 0 Tagen von oben
    p["membership_days"] = membership_days

    if "event_registrations" in await db.list_collection_names():
        p["events_attended"] = await db.event_registrations.count_documents({
            "user_id": user_id,
            "$or": [{"status": "checked_in"}, {"checked_in": True}],
        })
    else:
        p["events_attended"] = 0

    season_rows = await db.season_points.find({"user_id": user_id}, {"_id": 0, "total_points": 1}).to_list(2000)
    p["season_points_total"] = int(sum(float(r.get("total_points") or 0) for r in season_rows))

    user = await db.users.find_one({"id": user_id}, private_projection())
    plats = set()
    if user:
        for x in (user.get("main_platforms") or []):
            if x:
                plats.add(x)
        if user.get("main_platform"):
            plats.add(user["main_platform"])
    p["distinct_platforms"] = len(plats)

    # seasons_active — distinct seasons where user has any registration
    seasons_active = 0
    if tids:
        season_ids = await db.tournaments.distinct("season_id", {"id": {"$in": tids}, "season_id": {"$ne": None}})
        seasons_active = len([s for s in season_ids if s])
    p["seasons_active"] = seasons_active

    # profile_completeness — same scoring used by /api/users/me/profile-completeness
    p["profile_completeness"] = compute_profile_completeness(user) if user else 0

    user_awards = await db.user_achievements.find({"user_id": user_id}, {"_id": 0}).to_list(1000)
    p["achievements_unlocked"] = len(user_awards)
    award_codes = list({a.get("tier_code") for a in user_awards if a.get("tier_code")})
    if award_codes:
        award_tiers = await db.achievements.find({"code": {"$in": award_codes}}, {"_id": 0}).to_list(1000)
        award_groups = await db.achievement_groups.find({}, {"_id": 0, "code": 1, "is_negative": 1}).to_list(500)
        group_is_negative = {g["code"]: bool(g.get("is_negative")) for g in award_groups}
        p["achievement_points"] = sum(
            int(t.get("points") or 0)
            for t in award_tiers
            if not group_is_negative.get(t.get("group_code"), False)
            and t.get("group_code") not in ("level_progression", "level_milestones")
        )
    else:
        p["achievement_points"] = 0

    teams = await db.teams.find(
        {"member_ids": user_id},
        {"_id": 0, "id": 1, "leader_id": 1, "created_by": 1, "created_at": 1},
    ).to_list(100)
    p["teams_founded"] = sum(1 for t in teams if t.get("leader_id") == user_id or t.get("created_by") == user_id)
    team_days_max = 0
    team_ids = [t["id"] for t in teams if t.get("id")]
    if team_ids:
        memberships = await db.team_members.find(
            {"team_id": {"$in": team_ids}, "user_id": user_id},
            {"_id": 0, "joined_at": 1, "team_id": 1},
        ).to_list(100)
        joined_by_team = {m.get("team_id"): m.get("joined_at") for m in memberships if m.get("team_id")}
        for team in teams:
            raw_joined = joined_by_team.get(team.get("id")) or team.get("created_at")
            try:
                joined = datetime.fromisoformat(str(raw_joined).replace("Z", "+00:00"))
                if joined.tzinfo is None:
                    joined = joined.replace(tzinfo=timezone.utc)
                team_days_max = max(team_days_max, max((datetime.now(timezone.utc) - joined).days, 1))
            except (ValueError, TypeError):
                continue
    p["team_days_max"] = team_days_max

    p["best_season_rank_inv"] = 0
    p["best_championship_rank_inv"] = 0

    # Phase E + Discord-Counter: discord_messages comes from manually maintained counter
    p["discord_messages"] = (user or {}).get("discord_messages_count", 0)
    p["twitch_live_sessions"] = (user or {}).get("twitch_live_sessions_count", 0)
    p["twitch_stream_minutes"] = (user or {}).get("twitch_stream_minutes", 0)
    p["friends_count"] = await db.friendships.count_documents({
        "status": "accepted",
        "$or": [{"requester_id": user_id}, {"recipient_id": user_id}],
    })
    p["direct_messages_sent"] = await db.direct_messages.count_documents({"sender_id": user_id})
    p["team_chat_messages_sent"] = await db.team_chat_messages.count_documents({"user_id": user_id})
    p["match_chat_messages_sent"] = await db.match_chat_messages.count_documents({"user_id": user_id})
    p["tournament_chat_messages_sent"] = await db.tournament_chat_messages.count_documents({"user_id": user_id})
    p["community_messages_sent"] = (
        p["direct_messages_sent"]
        + p["team_chat_messages_sent"]
        + p["match_chat_messages_sent"]
        + p["tournament_chat_messages_sent"]
    )

    for k in [
        "checkins_in_a_row", "fast_registrations", "clutch_count",
        "dispute_free_matches", "long_matches_60", "long_matches_120",
        "matches_early", "matches_late", "sub_target_count",
        "afk_count", "no_show_count", "late_checkins", "ghost_count",
        "disputes_opened", "disputes_opened_season", "chat_warnings", "rage_quits",
        "hardware_incidents", "invalid_laps_session", "dnfs_season",
        "offroad_count", "reverse_lap_count", "slowest_lap_count", "unproven_laps",
        "team_no_show_count", "team_kills", "team_late_count", "team_member_churn",
        "zero_eight_losses", "long_warmup_count", "long_break_count", "loss_streak",
        "twitch_live_sessions", "twitch_stream_minutes",
        "friends_count", "direct_messages_sent", "team_chat_messages_sent",
        "match_chat_messages_sent", "tournament_chat_messages_sent", "community_messages_sent",
    ]:
        p.setdefault(k, 0)

    return p
