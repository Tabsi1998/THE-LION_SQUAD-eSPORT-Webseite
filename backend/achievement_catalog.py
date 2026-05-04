"""Achievement Catalog (Phase B v4) — Groups & Tiers.

Levels:
  1 = Bronze, 2 = Silber, 3 = Gold, 4 = Platin, 5 = Special-Rot.

Categories:
  match, tournament, fastlap, club, special, negative.

Negative groups stay hidden from any public/profile listing — only admins see them.
Special groups are admin-curated (public flag controls visibility).
"""

# ---------- GROUPS ----------
ACHIEVEMENT_GROUPS = [
    # --- Match (Spielen, Siegen) ---
    {"code": "match_master", "name": "Match Master", "category": "match", "icon": "swords",
     "accent_color": "#29B6E8", "description": "Sammle Matches im aktiven Wettbewerb.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 110},
    {"code": "victory_count", "name": "Sieger-Serie", "category": "match", "icon": "trophy",
     "accent_color": "#FFD700", "description": "Gewinne Matches gegen echte Gegner.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 111},
    {"code": "win_streak", "name": "Heißer Lauf", "category": "match", "icon": "flame",
     "accent_color": "#FF8A3D", "description": "Gewinne Matches in Folge.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 112},
    {"code": "clutch_master", "name": "Clutch Master", "category": "match", "icon": "sparkles",
     "accent_color": "#A855F7", "description": "Drehe Matches im Comeback.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 113},
    {"code": "fairplay", "name": "Fair Play", "category": "match", "icon": "heart-handshake",
     "accent_color": "#00FF88", "description": "Spiele Matches ohne Disputes.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 114},
    {"code": "marathoner", "name": "Marathon-Krieger", "category": "match", "icon": "timer",
     "accent_color": "#29B6E8", "description": "Spiele besonders lange Sessions.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 115},
    {"code": "early_bird_match", "name": "Frühaufsteher", "category": "match", "icon": "sun",
     "accent_color": "#FFD700", "description": "Match vor 08:00 Uhr.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 116},
    {"code": "night_owl_match", "name": "Nachteule", "category": "match", "icon": "moon",
     "accent_color": "#6D5BFF", "description": "Match zwischen 02:00–05:00 Uhr.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 117},

    # --- Turnier ---
    {"code": "tournament_veteran", "name": "Turnier-Veteran", "category": "tournament", "icon": "shield",
     "accent_color": "#29B6E8", "description": "Tritt bei mehreren Turnieren an.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 200},
    {"code": "tournament_champion", "name": "Champion", "category": "tournament", "icon": "crown",
     "accent_color": "#FFD700", "description": "Hol dir den ersten Platz.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 201},
    {"code": "podium_collector", "name": "Podium-Sammler", "category": "tournament", "icon": "medal",
     "accent_color": "#FFD700", "description": "Erreiche Top-3-Platzierungen.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 202},
    {"code": "multitalent", "name": "Multitalent", "category": "tournament", "icon": "layers",
     "accent_color": "#29B6E8", "description": "Tritt in verschiedenen Spielen an.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 203},
    {"code": "format_master", "name": "Format-Master", "category": "tournament", "icon": "git-branch",
     "accent_color": "#A855F7", "description": "Erfolge in verschiedenen Formaten (SE/DE/Swiss).",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 204},
    {"code": "checkin_streak", "name": "Verlässlich", "category": "tournament", "icon": "check-check",
     "accent_color": "#00FF88", "description": "Check-in pünktlich, mehrfach in Folge.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 205},
    {"code": "registration_speed", "name": "Schnellanmelder", "category": "tournament", "icon": "zap",
     "accent_color": "#FFD700", "description": "Sei früh dran bei Anmeldungen.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 206},
    {"code": "season_climber", "name": "Saison-Aufsteiger", "category": "tournament", "icon": "trending-up",
     "accent_color": "#29B6E8", "description": "Erreiche hohe Plätze in einer Saison.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 207},

    # --- Fast Lap ---
    {"code": "fastlap_volume", "name": "Lap Counter", "category": "fastlap", "icon": "flag",
     "accent_color": "#29B6E8", "description": "Sammle gültige Fast-Lap-Runden.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 300},
    {"code": "pole_position_collector", "name": "Pole-Sammler", "category": "fastlap", "icon": "trophy",
     "accent_color": "#FFD700", "description": "Bestzeiten auf verschiedenen Strecken.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 301},
    {"code": "sub_target_breaker", "name": "Sub-Target", "category": "fastlap", "icon": "timer",
     "accent_color": "#A855F7", "description": "Knacke Admin-Zielzeiten.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 302},
    {"code": "championship_top", "name": "Championship Top", "category": "fastlap", "icon": "crown",
     "accent_color": "#FFD700", "description": "Top-Platzierungen in der Championship.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 303},
    {"code": "track_master", "name": "Track Master", "category": "fastlap", "icon": "map",
     "accent_color": "#29B6E8", "description": "Befahre verschiedene Strecken aktiv.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 304},

    # --- Verein ---
    {"code": "membership_tenure", "name": "Im Rudel", "category": "club", "icon": "crown",
     "accent_color": "#FFD700", "description": "Vereinsmitgliedschaft & Loyalität.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 400},
    {"code": "event_attendance", "name": "Stammgast", "category": "club", "icon": "calendar-check",
     "accent_color": "#29B6E8", "description": "Nimm an Vereinsevents teil.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 401},
    {"code": "discord_active", "name": "Discord-Aktiv", "category": "club", "icon": "message-circle",
     "accent_color": "#5865F2", "description": "Aktive Beiträge in der Community.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 402},
    {"code": "team_founder", "name": "Team-Gründer", "category": "club", "icon": "users",
     "accent_color": "#A855F7", "description": "Gründe ein Team.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 403},
    {"code": "team_loyalty", "name": "Clan-Loyalität", "category": "club", "icon": "shield",
     "accent_color": "#29B6E8", "description": "Bleib einem Team treu.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 404},
    {"code": "platform_diversity", "name": "Plattform-Held", "category": "club", "icon": "cpu",
     "accent_color": "#29B6E8", "description": "Spiele auf mehreren Plattformen.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 405},
    {"code": "achievement_collector", "name": "Trophäenjäger", "category": "club", "icon": "trophy",
     "accent_color": "#FFD700", "description": "Schalte viele Achievements frei.",
     "public": True, "is_special": False, "is_negative": False, "sort_order": 406},

    # --- Special (admin-curated) ---
    {"code": "ehrenloewe", "name": "Ehrenlöwe", "category": "special", "icon": "crown",
     "accent_color": "#FF3B30", "description": "Hall of Fame — manuelle Ehrung durch den Vorstand.",
     "public": True, "is_special": True, "is_negative": False, "sort_order": 500},
    {"code": "gamers_heaven", "name": "Gamers Heaven", "category": "special", "icon": "rocket",
     "accent_color": "#FF3B30", "description": "Teilnahme am Gamers-Heaven-Event.",
     "public": True, "is_special": True, "is_negative": False, "sort_order": 501},
    {"code": "lan_founder", "name": "LAN Founder", "category": "special", "icon": "server",
     "accent_color": "#FF3B30", "description": "Erste LAN-Party des Vereins live dabei gewesen.",
     "public": True, "is_special": True, "is_negative": False, "sort_order": 502},
    {"code": "beta_tester", "name": "Beta-Tester", "category": "special", "icon": "flask",
     "accent_color": "#FF3B30", "description": "Hat die Plattform vor Launch getestet.",
     "public": True, "is_special": True, "is_negative": False, "sort_order": 503},
    {"code": "streamer_verified", "name": "Verified Streamer", "category": "special", "icon": "tv",
     "accent_color": "#9146FF", "description": "Offiziell verifizierter Streamer-Account.",
     "public": True, "is_special": True, "is_negative": False, "sort_order": 504},
    {"code": "sponsor_friend", "name": "Sponsor-Friend", "category": "special", "icon": "handshake",
     "accent_color": "#FF3B30", "description": "Vom Vorstand für Unterstützung gewürdigt.",
     "public": True, "is_special": True, "is_negative": False, "sort_order": 505},

    # --- Negative (intern, hidden) ---
    {"code": "neg_attendance", "name": "Anwesenheits-Mängel", "category": "negative", "icon": "user-x",
     "accent_color": "#FF3B30", "description": "Verpasste Termine, AFK & Co.",
     "public": False, "is_special": False, "is_negative": True, "sort_order": 900},
    {"code": "neg_fairplay", "name": "Fairplay-Verstöße", "category": "negative", "icon": "alert-octagon",
     "accent_color": "#FF3B30", "description": "Disputes, Toxic Behaviour, Verwarnungen.",
     "public": False, "is_special": False, "is_negative": True, "sort_order": 901},
    {"code": "neg_fastlap", "name": "Fast-Lap-Pannen", "category": "negative", "icon": "ban",
     "accent_color": "#FF3B30", "description": "Ungültige Runden, DNFs, Crashes.",
     "public": False, "is_special": False, "is_negative": True, "sort_order": 902},
    {"code": "neg_team", "name": "Team-Probleme", "category": "negative", "icon": "users-x",
     "accent_color": "#FF3B30", "description": "Team-bezogene negative Vorfälle.",
     "public": False, "is_special": False, "is_negative": True, "sort_order": 903},
    {"code": "neg_misc", "name": "Sonstige Mängel", "category": "negative", "icon": "frown",
     "accent_color": "#FF3B30", "description": "Verschiedene leichte Fauxpas.",
     "public": False, "is_special": False, "is_negative": True, "sort_order": 904},
]

# ---------- TIERS ----------
# levels: 1=Bronze, 2=Silber, 3=Gold, 4=Platin, 5=Special-Rot
def _t(code, group_code, level, name, description, *, condition_key=None,
       progress_target=None, points=10, icon=None, manual_only=False):
    return {
        "code": code, "group_code": group_code, "level": level,
        "name": name, "description": description,
        "condition_key": condition_key, "progress_target": progress_target,
        "points": points, "icon": icon, "manual_only": manual_only,
    }


ACHIEVEMENT_TIERS = [
    # --- match_master: 10/30/75/150 matches played ---
    _t("match_master_b", "match_master", 1, "Match Master · Bronze", "Spiele 10 Matches.",
       condition_key="matches_played", progress_target=10, points=10, icon="swords"),
    _t("match_master_s", "match_master", 2, "Match Master · Silber", "Spiele 30 Matches.",
       condition_key="matches_played", progress_target=30, points=25, icon="swords"),
    _t("match_master_g", "match_master", 3, "Match Master · Gold", "Spiele 75 Matches.",
       condition_key="matches_played", progress_target=75, points=60, icon="swords"),
    _t("match_master_p", "match_master", 4, "Match Master · Platin", "Spiele 150 Matches.",
       condition_key="matches_played", progress_target=150, points=150, icon="swords"),

    # --- victory_count: 1/10/30/75 wins ---
    _t("victory_count_b", "victory_count", 1, "First Blood", "Gewinne dein erstes Match.",
       condition_key="matches_won", progress_target=1, points=10, icon="trophy"),
    _t("victory_count_s", "victory_count", 2, "Doppelte Krone", "Gewinne 10 Matches.",
       condition_key="matches_won", progress_target=10, points=25, icon="trophy"),
    _t("victory_count_g", "victory_count", 3, "Dauer-Gewinner", "Gewinne 30 Matches.",
       condition_key="matches_won", progress_target=30, points=60, icon="trophy"),
    _t("victory_count_p", "victory_count", 4, "Sieger-Maschine", "Gewinne 75 Matches.",
       condition_key="matches_won", progress_target=75, points=150, icon="trophy"),

    # --- win_streak: 3/5/8/12 in a row ---
    _t("win_streak_b", "win_streak", 1, "Drei in Folge", "Gewinne 3 Matches am Stück.",
       condition_key="match_streak_max", progress_target=3, points=15, icon="flame"),
    _t("win_streak_s", "win_streak", 2, "Heißer Lauf", "Gewinne 5 Matches am Stück.",
       condition_key="match_streak_max", progress_target=5, points=30, icon="flame"),
    _t("win_streak_g", "win_streak", 3, "Unaufhaltsam", "Gewinne 8 Matches am Stück.",
       condition_key="match_streak_max", progress_target=8, points=80, icon="flame"),
    _t("win_streak_p", "win_streak", 4, "Legendär", "Gewinne 12 Matches am Stück.",
       condition_key="match_streak_max", progress_target=12, points=200, icon="flame"),

    # --- clutch_master: 1/3/7/15 clutches (event-driven) ---
    _t("clutch_master_b", "clutch_master", 1, "Clutch", "Comeback-Sieg.",
       condition_key="clutch_count", progress_target=1, points=15, icon="sparkles"),
    _t("clutch_master_s", "clutch_master", 2, "Drama-Held", "3 Comebacks.",
       condition_key="clutch_count", progress_target=3, points=35, icon="sparkles"),
    _t("clutch_master_g", "clutch_master", 3, "Comeback-King", "7 Comebacks.",
       condition_key="clutch_count", progress_target=7, points=80, icon="sparkles"),
    _t("clutch_master_p", "clutch_master", 4, "Mr. Houdini", "15 Comebacks.",
       condition_key="clutch_count", progress_target=15, points=200, icon="sparkles"),

    # --- fairplay: 5/20/50/100 dispute-free matches ---
    _t("fairplay_b", "fairplay", 1, "Fair Player", "5 Matches ohne Dispute.",
       condition_key="dispute_free_matches", progress_target=5, points=10, icon="heart-handshake"),
    _t("fairplay_s", "fairplay", 2, "Sportsmanship", "20 Matches ohne Dispute.",
       condition_key="dispute_free_matches", progress_target=20, points=30, icon="heart-handshake"),
    _t("fairplay_g", "fairplay", 3, "Vorbild", "50 Matches ohne Dispute.",
       condition_key="dispute_free_matches", progress_target=50, points=75, icon="heart-handshake"),
    _t("fairplay_p", "fairplay", 4, "Ritter-Modus", "100 Matches ohne Dispute.",
       condition_key="dispute_free_matches", progress_target=100, points=200, icon="heart-handshake"),

    # --- marathoner: long matches (>1h, >2h) — track via durations ---
    _t("marathoner_b", "marathoner", 1, "Langläufer", "Spiele ein Match >60 min.",
       condition_key="long_matches_60", progress_target=1, points=15, icon="timer"),
    _t("marathoner_s", "marathoner", 2, "Marathon", "Spiele ein Match >120 min.",
       condition_key="long_matches_120", progress_target=1, points=40, icon="timer"),
    _t("marathoner_g", "marathoner", 3, "Iron-Gamer", "5 Matches >120 min.",
       condition_key="long_matches_120", progress_target=5, points=100, icon="timer"),

    # --- early_bird_match / night_owl_match: single tier ---
    _t("early_bird_match_p", "early_bird_match", 4, "Frühaufsteher", "Match zwischen 05–08 Uhr.",
       condition_key="matches_early", progress_target=1, points=15, icon="sun"),
    _t("night_owl_match_p", "night_owl_match", 4, "Nachteule", "Match zwischen 02–05 Uhr.",
       condition_key="matches_late", progress_target=1, points=15, icon="moon"),

    # --- tournament_veteran: 1/5/15/40 ---
    _t("tournament_veteran_b", "tournament_veteran", 1, "Erste Anmeldung", "Tritt einem Turnier bei.",
       condition_key="tournaments_registered", progress_target=1, points=5, icon="shield"),
    _t("tournament_veteran_s", "tournament_veteran", 2, "Veteran I", "5 Turnier-Teilnahmen.",
       condition_key="tournaments_registered", progress_target=5, points=20, icon="shield"),
    _t("tournament_veteran_g", "tournament_veteran", 3, "Veteran II", "15 Turnier-Teilnahmen.",
       condition_key="tournaments_registered", progress_target=15, points=60, icon="shield"),
    _t("tournament_veteran_p", "tournament_veteran", 4, "Veteran III", "40 Turnier-Teilnahmen.",
       condition_key="tournaments_registered", progress_target=40, points=200, icon="shield"),

    # --- tournament_champion: 1/3/7/15 wins ---
    _t("champion_b", "tournament_champion", 1, "Turniersieger", "Gewinne ein Turnier.",
       condition_key="tournaments_won", progress_target=1, points=50, icon="crown"),
    _t("champion_s", "tournament_champion", 2, "Doppelter Champion", "Gewinne 3 Turniere.",
       condition_key="tournaments_won", progress_target=3, points=120, icon="crown"),
    _t("champion_g", "tournament_champion", 3, "Grand Champion", "Gewinne 7 Turniere.",
       condition_key="tournaments_won", progress_target=7, points=300, icon="crown"),
    _t("champion_p", "tournament_champion", 4, "Hall of Fame", "Gewinne 15 Turniere.",
       condition_key="tournaments_won", progress_target=15, points=600, icon="crown"),

    # --- podium_collector: 1/5/15/30 ---
    _t("podium_b", "podium_collector", 1, "Podium-Finisher", "Eine Top-3-Platzierung.",
       condition_key="podium_finishes", progress_target=1, points=25, icon="medal"),
    _t("podium_s", "podium_collector", 2, "Stamm-Podest", "5 Top-3-Platzierungen.",
       condition_key="podium_finishes", progress_target=5, points=80, icon="medal"),
    _t("podium_g", "podium_collector", 3, "Podest-König", "15 Top-3-Platzierungen.",
       condition_key="podium_finishes", progress_target=15, points=200, icon="medal"),
    _t("podium_p", "podium_collector", 4, "Podest-Legende", "30 Top-3-Platzierungen.",
       condition_key="podium_finishes", progress_target=30, points=400, icon="medal"),

    # --- multitalent: distinct games ---
    _t("multitalent_b", "multitalent", 1, "Wechselspieler", "2 verschiedene Spiele.",
       condition_key="distinct_games_registered", progress_target=2, points=15, icon="layers"),
    _t("multitalent_s", "multitalent", 2, "Multitalent", "3 verschiedene Spiele.",
       condition_key="distinct_games_registered", progress_target=3, points=30, icon="layers"),
    _t("multitalent_g", "multitalent", 3, "Allrounder", "5 verschiedene Spiele.",
       condition_key="distinct_games_registered", progress_target=5, points=75, icon="layers"),
    _t("multitalent_p", "multitalent", 4, "Universal-Held", "8 verschiedene Spiele.",
       condition_key="distinct_games_registered", progress_target=8, points=200, icon="layers"),

    # --- format_master: distinct formats ---
    _t("format_master_b", "format_master", 1, "Format-Anfänger", "Tritt in 2 Formaten an.",
       condition_key="distinct_formats", progress_target=2, points=15, icon="git-branch"),
    _t("format_master_s", "format_master", 2, "Format-Profi", "Tritt in 3 Formaten an.",
       condition_key="distinct_formats", progress_target=3, points=40, icon="git-branch"),
    _t("format_master_g", "format_master", 3, "Format-Master", "Tritt in 4 Formaten an.",
       condition_key="distinct_formats", progress_target=4, points=100, icon="git-branch"),

    # --- checkin_streak: 3/5/10 in a row ---
    _t("checkin_streak_b", "checkin_streak", 1, "Pünktlich", "3 Check-ins in Folge.",
       condition_key="checkins_in_a_row", progress_target=3, points=10, icon="check-check"),
    _t("checkin_streak_s", "checkin_streak", 2, "Verlässlich", "5 Check-ins in Folge.",
       condition_key="checkins_in_a_row", progress_target=5, points=30, icon="check-check"),
    _t("checkin_streak_g", "checkin_streak", 3, "Felsen", "10 Check-ins in Folge.",
       condition_key="checkins_in_a_row", progress_target=10, points=80, icon="check-check"),

    # --- registration_speed: registrations within first hour ---
    _t("registration_speed_b", "registration_speed", 1, "Schnell-Anmelder", "Eine schnelle Anmeldung.",
       condition_key="fast_registrations", progress_target=1, points=10, icon="zap"),
    _t("registration_speed_s", "registration_speed", 2, "Lichtgeschwindigkeit", "5 schnelle Anmeldungen.",
       condition_key="fast_registrations", progress_target=5, points=30, icon="zap"),

    # --- season_climber ---
    _t("season_climber_b", "season_climber", 1, "Top 25", "Saison-Top-25.",
       condition_key="best_season_rank_inv", progress_target=25, points=40, icon="trending-up"),
    _t("season_climber_s", "season_climber", 2, "Top 10", "Saison-Top-10.",
       condition_key="best_season_rank_inv", progress_target=10, points=80, icon="trending-up"),
    _t("season_climber_g", "season_climber", 3, "Top 3", "Saison-Top-3.",
       condition_key="best_season_rank_inv", progress_target=3, points=200, icon="trending-up"),
    _t("season_climber_p", "season_climber", 4, "Saison-Champion", "Saison-Sieger.",
       condition_key="best_season_rank_inv", progress_target=1, points=500, icon="crown"),

    # --- fastlap_volume: 10/50/150/500 ---
    _t("fastlap_volume_b", "fastlap_volume", 1, "Erster Versuch", "10 gültige Runden.",
       condition_key="fastlap_valid_count", progress_target=10, points=10, icon="flag"),
    _t("fastlap_volume_s", "fastlap_volume", 2, "Stammfahrer", "50 gültige Runden.",
       condition_key="fastlap_valid_count", progress_target=50, points=40, icon="flag"),
    _t("fastlap_volume_g", "fastlap_volume", 3, "Vielfahrer", "150 gültige Runden.",
       condition_key="fastlap_valid_count", progress_target=150, points=120, icon="flag"),
    _t("fastlap_volume_p", "fastlap_volume", 4, "Lap-Maschine", "500 gültige Runden.",
       condition_key="fastlap_valid_count", progress_target=500, points=400, icon="flag"),

    # --- pole_position_collector: 1/3/7/15 distinct tracks with pole ---
    _t("pole_b", "pole_position_collector", 1, "Erste Pole", "1 Pole Position.",
       condition_key="pole_count", progress_target=1, points=20, icon="trophy"),
    _t("pole_s", "pole_position_collector", 2, "Stamm-Pole", "3 Pole Positions.",
       condition_key="pole_count", progress_target=3, points=60, icon="trophy"),
    _t("pole_g", "pole_position_collector", 3, "Pole-Master", "7 Pole Positions.",
       condition_key="pole_count", progress_target=7, points=150, icon="trophy"),
    _t("pole_p", "pole_position_collector", 4, "Pole-Legende", "15 Pole Positions.",
       condition_key="pole_count", progress_target=15, points=400, icon="trophy"),

    # --- sub_target_breaker ---
    _t("sub_target_b", "sub_target_breaker", 1, "Sub-Target", "Knacke 1 Zielzeit.",
       condition_key="sub_target_count", progress_target=1, points=30, icon="timer"),
    _t("sub_target_s", "sub_target_breaker", 2, "Sub-Master", "Knacke 5 Zielzeiten.",
       condition_key="sub_target_count", progress_target=5, points=100, icon="timer"),
    _t("sub_target_g", "sub_target_breaker", 3, "Sub-Legende", "Knacke 12 Zielzeiten.",
       condition_key="sub_target_count", progress_target=12, points=250, icon="timer"),

    # --- championship_top ---
    _t("championship_top_b", "championship_top", 1, "Top 10", "Top-10-Platz Championship.",
       condition_key="best_championship_rank_inv", progress_target=10, points=40, icon="crown"),
    _t("championship_top_s", "championship_top", 2, "Top 5", "Top-5 Championship.",
       condition_key="best_championship_rank_inv", progress_target=5, points=80, icon="crown"),
    _t("championship_top_g", "championship_top", 3, "Top 3", "Podest Championship.",
       condition_key="best_championship_rank_inv", progress_target=3, points=200, icon="crown"),
    _t("championship_top_p", "championship_top", 4, "Champion", "Championship-Sieger.",
       condition_key="best_championship_rank_inv", progress_target=1, points=500, icon="crown"),

    # --- track_master: distinct tracks driven ---
    _t("track_master_b", "track_master", 1, "Strecken-Sammler", "Fahre auf 3 Strecken.",
       condition_key="distinct_tracks", progress_target=3, points=15, icon="map"),
    _t("track_master_s", "track_master", 2, "Strecken-Profi", "Fahre auf 7 Strecken.",
       condition_key="distinct_tracks", progress_target=7, points=50, icon="map"),
    _t("track_master_g", "track_master", 3, "Welten-Tour", "Fahre auf 15 Strecken.",
       condition_key="distinct_tracks", progress_target=15, points=150, icon="map"),

    # --- membership_tenure: 0/90/180/365 days ---
    _t("membership_join", "membership_tenure", 1, "Offiziell im Rudel", "Offizielles Vereinsmitglied.",
       condition_key="membership_days", progress_target=1, points=50, icon="crown"),
    _t("membership_silver", "membership_tenure", 2, "Mitgliedschaft Silber", "6 Monate Vereinsmitglied.",
       condition_key="membership_days", progress_target=180, points=100, icon="badge"),
    _t("membership_gold", "membership_tenure", 3, "Mitgliedschaft Gold", "12 Monate Vereinsmitglied.",
       condition_key="membership_days", progress_target=365, points=200, icon="badge"),
    _t("membership_platin", "membership_tenure", 4, "Mitgliedschaft Platin", "24 Monate Vereinsmitglied.",
       condition_key="membership_days", progress_target=730, points=400, icon="award"),

    # --- event_attendance: 1/5/15/30 ---
    _t("event_attendance_b", "event_attendance", 1, "Erstes Event", "Eintritt zum ersten Event.",
       condition_key="events_attended", progress_target=1, points=10, icon="calendar-check"),
    _t("event_attendance_s", "event_attendance", 2, "Stammgast", "5 Events besucht.",
       condition_key="events_attended", progress_target=5, points=30, icon="calendar-check"),
    _t("event_attendance_g", "event_attendance", 3, "Inventar", "15 Events besucht.",
       condition_key="events_attended", progress_target=15, points=80, icon="calendar-check"),
    _t("event_attendance_p", "event_attendance", 4, "Vereins-Fixstern", "30 Events besucht.",
       condition_key="events_attended", progress_target=30, points=200, icon="calendar-check"),

    # --- discord_active: messages_sent (manual or via integration) ---
    _t("discord_active_b", "discord_active", 1, "Hallo Welt", "Erste Discord-Aktivität.",
       condition_key="discord_messages", progress_target=1, points=5, icon="message-circle", manual_only=True),
    _t("discord_active_s", "discord_active", 2, "Talker", "100 Discord-Nachrichten.",
       condition_key="discord_messages", progress_target=100, points=20, icon="message-circle", manual_only=True),
    _t("discord_active_g", "discord_active", 3, "Quasselstrippe", "500 Discord-Nachrichten.",
       condition_key="discord_messages", progress_target=500, points=80, icon="message-circle", manual_only=True),

    # --- team_founder: single ---
    _t("team_founder_p", "team_founder", 4, "Team-Gründer", "Gründe ein eigenes Team.",
       condition_key="teams_founded", progress_target=1, points=30, icon="users"),

    # --- team_loyalty: days in same team ---
    _t("team_loyalty_b", "team_loyalty", 1, "Newcomer", "Erste 30 Tage im Team.",
       condition_key="team_days_max", progress_target=30, points=15, icon="shield"),
    _t("team_loyalty_s", "team_loyalty", 2, "Stamm", "180 Tage im Team.",
       condition_key="team_days_max", progress_target=180, points=50, icon="shield"),
    _t("team_loyalty_g", "team_loyalty", 3, "Veteran", "365 Tage im Team.",
       condition_key="team_days_max", progress_target=365, points=120, icon="shield"),
    _t("team_loyalty_p", "team_loyalty", 4, "Forever Clan", "730 Tage im Team.",
       condition_key="team_days_max", progress_target=730, points=300, icon="shield"),

    # --- platform_diversity ---
    _t("platform_diversity_b", "platform_diversity", 1, "Multi-Plattform", "2 Plattformen.",
       condition_key="distinct_platforms", progress_target=2, points=15, icon="cpu"),
    _t("platform_diversity_s", "platform_diversity", 2, "Plattform-Held", "3 Plattformen.",
       condition_key="distinct_platforms", progress_target=3, points=40, icon="cpu"),
    _t("platform_diversity_g", "platform_diversity", 3, "All-Rounder", "4+ Plattformen.",
       condition_key="distinct_platforms", progress_target=4, points=100, icon="cpu"),

    # --- achievement_collector: 5/15/30/60 ---
    _t("achievement_collector_b", "achievement_collector", 1, "Sammler", "5 Achievements.",
       condition_key="achievements_unlocked", progress_target=5, points=20, icon="trophy"),
    _t("achievement_collector_s", "achievement_collector", 2, "Trophäenjäger", "15 Achievements.",
       condition_key="achievements_unlocked", progress_target=15, points=50, icon="trophy"),
    _t("achievement_collector_g", "achievement_collector", 3, "Trophäen-König", "30 Achievements.",
       condition_key="achievements_unlocked", progress_target=30, points=120, icon="trophy"),
    _t("achievement_collector_p", "achievement_collector", 4, "Komplettist", "60 Achievements.",
       condition_key="achievements_unlocked", progress_target=60, points=300, icon="trophy"),

    # --- Special / manual-only awards ---
    _t("ehrenloewe_p", "ehrenloewe", 5, "Ehrenlöwe", "Manuelle Ehrung — Hall of Fame.",
       points=1000, icon="crown", manual_only=True),
    _t("gamers_heaven_p", "gamers_heaven", 5, "Gamers Heaven Teilnehmer", "Live beim Gamers-Heaven-Event dabei.",
       points=100, icon="rocket", manual_only=True),
    _t("lan_founder_p", "lan_founder", 5, "LAN Founder", "Erste LAN-Party live mitgemacht.",
       points=200, icon="server", manual_only=True),
    _t("beta_tester_p", "beta_tester", 5, "Beta-Tester", "Plattform vor Launch getestet.",
       points=150, icon="flask", manual_only=True),
    _t("streamer_verified_p", "streamer_verified", 5, "Verified Streamer", "Offiziell verifizierter Streamer.",
       points=80, icon="tv", manual_only=True),
    _t("sponsor_friend_p", "sponsor_friend", 5, "Sponsor-Friend", "Vom Vorstand für Unterstützung gewürdigt.",
       points=300, icon="handshake", manual_only=True),

    # --- Negative (intern, hidden) — single tier each ---
    _t("neg_afk", "neg_attendance", 1, "AFK-Legende", "Check-in verpasst.",
       condition_key="afk_count", progress_target=1, points=0, icon="user-x"),
    _t("neg_no_show", "neg_attendance", 1, "No-Show", "Turnier-Anmeldung ohne Antritt.",
       condition_key="no_show_count", progress_target=1, points=0, icon="user-x"),
    _t("neg_late_checkin", "neg_attendance", 1, "Spätzünder", "3+ verspätete Check-ins.",
       condition_key="late_checkins", progress_target=3, points=0, icon="clock"),
    _t("neg_ghost", "neg_attendance", 1, "Geist", "Mehrere Anmeldungen ohne je zu erscheinen.",
       condition_key="ghost_count", progress_target=2, points=0, icon="ghost"),

    _t("neg_dispute", "neg_fairplay", 1, "Streitwert", "Eröffneter Dispute.",
       condition_key="disputes_opened", progress_target=1, points=0, icon="alert-octagon"),
    _t("neg_dispute_loop", "neg_fairplay", 1, "Streit-Schleife", "5+ Disputes innerhalb einer Saison.",
       condition_key="disputes_opened_season", progress_target=5, points=0, icon="messages-square"),
    _t("neg_chat_warning", "neg_fairplay", 1, "Verbalakrobat", "Chat-Verwarnung erhalten.",
       condition_key="chat_warnings", progress_target=1, points=0, icon="message-square-warning"),
    _t("neg_rage_quit", "neg_fairplay", 1, "Rage Quitter", "Match abgebrochen <30 % Spielzeit.",
       condition_key="rage_quits", progress_target=1, points=0, icon="x-circle"),
    _t("neg_controller_throw", "neg_fairplay", 1, "Controller-Wurf", "Hardware-Schaden gemeldet.",
       condition_key="hardware_incidents", progress_target=1, points=0, icon="alert-octagon"),

    _t("neg_invalid_lap", "neg_fastlap", 1, "Wandmagnet", "5+ ungültige Runden in einer Challenge.",
       condition_key="invalid_laps_session", progress_target=5, points=0, icon="zap-off"),
    _t("neg_dnf", "neg_fastlap", 1, "DNF-Sammler", "5 DNFs in einer Saison.",
       condition_key="dnfs_season", progress_target=5, points=0, icon="x-octagon"),
    _t("neg_offroad", "neg_fastlap", 1, "Offroad-Künstler", "10+ Mal von der Strecke.",
       condition_key="offroad_count", progress_target=10, points=0, icon="map-off"),
    _t("neg_reverse", "neg_fastlap", 1, "Rückwärtsgang", "Komplette Runde rückwärts.",
       condition_key="reverse_lap_count", progress_target=1, points=0, icon="rotate-ccw"),
    _t("neg_slowest", "neg_fastlap", 1, "Schneckenrennen", "Langsamste Zeit auf einer Strecke.",
       condition_key="slowest_lap_count", progress_target=1, points=0, icon="snail"),
    _t("neg_ghost_lap", "neg_fastlap", 1, "Phantom-Runde", "Zeit gemeldet, aber kein Beweis.",
       condition_key="unproven_laps", progress_target=1, points=0, icon="cloud-off"),

    _t("neg_team_no_show", "neg_team", 1, "Geisterclan", "Komplettes Team nicht erschienen.",
       condition_key="team_no_show_count", progress_target=1, points=0, icon="ghost"),
    _t("neg_team_friendly_fire", "neg_team", 1, "Friendly-Fire-Champ", "3+ Teamkills in einem Match.",
       condition_key="team_kills", progress_target=3, points=0, icon="crosshair"),
    _t("neg_team_late", "neg_team", 1, "Verspäteter Clan", "Team verpasst Check-in komplett.",
       condition_key="team_late_count", progress_target=1, points=0, icon="clock"),
    _t("neg_team_revolving", "neg_team", 1, "Drehtür", "50%+ Member-Wechsel pro Saison.",
       condition_key="team_member_churn", progress_target=50, points=0, icon="door-open"),

    _t("neg_holzmedaille", "neg_misc", 1, "Holzmedaille", "Knapp am Podest vorbei: 4. Platz.",
       condition_key="rank_4_count", progress_target=1, points=0, icon="frown"),
    _t("neg_nullachter", "neg_misc", 1, "Null-Achter", "Verloren mit 0:8 oder schlechter.",
       condition_key="zero_eight_losses", progress_target=1, points=0, icon="frown"),
    _t("neg_tilt_master", "neg_misc", 1, "Tilt Master", "3 Niederlagen in Folge.",
       condition_key="loss_streak", progress_target=3, points=0, icon="alert-triangle"),
    _t("neg_warmup_master", "neg_misc", 1, "Aufwärm-Spezialist", "Warmup länger als Match.",
       condition_key="long_warmup_count", progress_target=1, points=0, icon="thermometer-snowflake"),
    _t("neg_snack_break", "neg_misc", 1, "Snack-Break-Pro", "Match-Pause länger als Match.",
       condition_key="long_break_count", progress_target=1, points=0, icon="cookie"),
]

GROUP_BY_CODE = {g["code"]: g for g in ACHIEVEMENT_GROUPS}
TIER_BY_CODE = {t["code"]: t for t in ACHIEVEMENT_TIERS}
