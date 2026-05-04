"""Seed admin user + demo data (games, players, tournament, F1 challenge)."""
import os
import random
from datetime import datetime, timezone, timedelta
from database import get_db
from auth import hash_password
from models import new_id, now_utc


async def seed_admin():
    db = get_db()
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@thelionsquad.at").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "TLSAdmin2026!")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        doc = {
            "id": new_id(),
            "email": admin_email,
            "username": "admin",
            "password_hash": hash_password(admin_password),
            "display_name": "TLS Admin",
            "avatar_url": None,
            "role": "superadmin",
            "discord_name": None, "discord_id": None,
            "switch_code": None, "steam_id": None, "epic_id": None,
            "psn_id": None, "xbox_id": None, "riot_id": None,
            "country": "AT", "state": None,
            "favorite_games": [],
            "privacy_public_profile": False,
            "bio": "The Lion Squad eSports Club Admin",
            "is_active": True, "is_banned": False,
            "accepted_privacy": True,
            "created_at": now_utc().isoformat(),
            "updated_at": now_utc().isoformat(),
        }
        await db.users.insert_one(doc)
        print(f"[seed] Admin created: {admin_email} / {admin_password}")
    else:
        # Ensure admin role
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"role": "superadmin", "is_active": True, "is_banned": False}},
        )
        print(f"[seed] Admin exists: {admin_email}")


DEMO_GAMES = [
    {"slug": "mario-kart-8-deluxe", "name": "Mario Kart 8 Deluxe", "short_name": "MK8DX",
     "genre": "Racing", "platforms": ["Nintendo Switch"],
     "supports_solo": True, "supports_teams": True, "supports_ffa": True, "supports_time_trial": True,
     "default_team_size": 1, "default_format": "single_elim",
     "cover_url": "https://images.unsplash.com/photo-1606803565048-3eb01df96b9c?w=800"},
    {"slug": "super-smash-bros-ultimate", "name": "Super Smash Bros. Ultimate", "short_name": "SSBU",
     "genre": "Fighting", "platforms": ["Nintendo Switch"],
     "supports_solo": True, "supports_teams": True, "default_team_size": 1,
     "default_format": "double_elim",
     "cover_url": "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=800"},
    {"slug": "f1-25", "name": "F1 25", "short_name": "F1-25",
     "genre": "Racing Sim", "platforms": ["PC", "PS5", "Xbox"],
     "supports_time_trial": True, "supports_grand_prix": True, "default_team_size": 1,
     "default_format": "time_trial",
     "cover_url": "https://images.unsplash.com/photo-1771440571270-e27b63085a48?w=800"},
    {"slug": "rocket-league", "name": "Rocket League", "short_name": "RL",
     "genre": "Sports", "platforms": ["PC", "PS5", "Xbox", "Nintendo Switch"],
     "supports_teams": True, "default_team_size": 3, "default_format": "double_elim",
     "cover_url": "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800"},
    {"slug": "valorant", "name": "Valorant", "short_name": "VAL",
     "genre": "Tactical Shooter", "platforms": ["PC"],
     "supports_teams": True, "default_team_size": 5, "default_format": "double_elim",
     "cover_url": "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=800"},
    {"slug": "league-of-legends", "name": "League of Legends", "short_name": "LoL",
     "genre": "MOBA", "platforms": ["PC"],
     "supports_teams": True, "default_team_size": 5, "default_format": "groups",
     "cover_url": "https://images.unsplash.com/photo-1593305841991-05c297ba4575?w=800"},
]


DEMO_PLAYERS = [
    ("leon_king", "Leon King", "AT"),
    ("mira_dash", "Mira Dash", "DE"),
    ("kai_blitz", "Kai Blitz", "AT"),
    ("nova_zero", "Nova Zero", "CH"),
    ("ace_racer", "Ace Racer", "DE"),
    ("vince_gg", "Vince GG", "AT"),
    ("pixelhawk", "PixelHawk", "AT"),
    ("shady_ninja", "Shady Ninja", "DE"),
    ("ava_spike", "Ava Spike", "AT"),
    ("rex_turbo", "Rex Turbo", "DE"),
    ("juno_xx", "Juno XX", "AT"),
    ("omega_mx", "Omega MX", "CH"),
    ("neo_drift", "Neo Drift", "AT"),
    ("zara_byte", "Zara Byte", "DE"),
    ("viper_7", "Viper 7", "AT"),
    ("echo_dash", "Echo Dash", "AT"),
    ("max_chrome", "Max Chrome", "DE"),
    ("lux_raven", "Lux Raven", "AT"),
    ("blaze_tk", "Blaze TK", "CH"),
    ("kilo_flux", "Kilo Flux", "DE"),
]

DEMO_TRACKS = [
    ("Silverstone", "GB", "https://images.pexels.com/photos/19818015/pexels-photo-19818015.jpeg?w=1200"),
    ("Monza", "IT", "https://images.pexels.com/photos/19817939/pexels-photo-19817939.jpeg?w=1200"),
    ("Spa-Francorchamps", "BE", "https://images.unsplash.com/photo-1549399736-4ff57e3b6b52?w=1200"),
    ("Red Bull Ring", "AT", "https://images.unsplash.com/photo-1541773367336-d3f5ee8f7c4d?w=1200"),
]


async def seed_demo_data():
    db = get_db()
    # Only seed if games collection is empty
    if await db.games.count_documents({}) > 0:
        print("[seed] Demo data already exists, skipping.")
        return

    # Games
    game_docs = []
    for g in DEMO_GAMES:
        doc = {**g, "id": new_id(), "logo_url": None,
               "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat()}
        doc.setdefault("supports_solo", True)
        doc.setdefault("supports_teams", False)
        doc.setdefault("supports_ffa", False)
        doc.setdefault("supports_time_trial", False)
        doc.setdefault("supports_grand_prix", False)
        game_docs.append(doc)
    await db.games.insert_many(game_docs)
    mk_id = next(g["id"] for g in game_docs if g["slug"] == "mario-kart-8-deluxe")
    smash_id = next(g["id"] for g in game_docs if g["slug"] == "super-smash-bros-ultimate")
    f1_id = next(g["id"] for g in game_docs if g["slug"] == "f1-25")

    # Players
    player_ids = []
    user_docs = []
    for username, display, country in DEMO_PLAYERS:
        uid = new_id()
        user_docs.append({
            "id": uid,
            "email": f"{username}@demo.thelionsquad.at",
            "username": username,
            "password_hash": hash_password("demo123"),
            "display_name": display,
            "avatar_url": None,
            "role": "player",
            "discord_name": username, "discord_id": None,
            "switch_code": None, "steam_id": None, "epic_id": None,
            "psn_id": None, "xbox_id": None, "riot_id": None,
            "country": country, "state": None,
            "favorite_games": [],
            "privacy_public_profile": True,
            "bio": f"Demo player: {display}",
            "is_active": True, "is_banned": False,
            "accepted_privacy": True,
            "created_at": now_utc().isoformat(),
            "updated_at": now_utc().isoformat(),
        })
        player_ids.append(uid)
    await db.users.insert_many(user_docs)

    # Teams
    team_names = [
        ("TLS Red", "TLSR"), ("TLS Blue", "TLSB"), ("TLS Academy", "TLSA"),
        ("Shadow Pride", "SHDW"), ("Neon Kings", "NEON"),
    ]
    import secrets
    for i, (name, tag) in enumerate(team_names):
        leader = player_ids[i * 3]
        members = player_ids[i * 3: i * 3 + 3]
        await db.teams.insert_one({
            "id": new_id(), "name": name, "tag": tag,
            "description": f"Demo team {name}",
            "logo_url": None, "discord_link": None, "social_links": {},
            "leader_id": leader, "co_leader_ids": [members[1]] if len(members) > 1 else [],
            "member_ids": members, "join_code": secrets.token_urlsafe(6),
            "is_public": True,
            "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
        })

    # Event
    event_id = new_id()
    start = datetime.now(timezone.utc) + timedelta(days=7)
    await db.events.insert_one({
        "id": event_id, "slug": "tls-winter-clash-2026",
        "name": "TLS Winter Clash 2026",
        "description": "Das große Winter-Event des Lion Squad. Multi-Game Turniere + F1 Fast Lap Challenge live vor Ort.",
        "start_date": start.isoformat(), "end_date": (start + timedelta(days=2)).isoformat(),
        "location": "The Lion Squad HQ, Wien",
        "is_online": False, "is_hybrid": True,
        "banner_url": "https://images.pexels.com/photos/7915213/pexels-photo-7915213.jpeg",
        "contact": "events@thelionsquad.at",
        "status": "upcoming",
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })

    admin = await db.users.find_one({"role": "superadmin"})
    admin_id = admin["id"] if admin else None

    # Mario Kart Tournament (Single Elim, 16 players)
    mk_tid = new_id()
    await db.tournaments.insert_one({
        "id": mk_tid, "slug": "mario-kart-winter-cup",
        "title": "Mario Kart Winter Cup",
        "description": "Das klassische Mario Kart Turnier. Single Elimination, Best of 3.",
        "game_id": mk_id, "platform": "Nintendo Switch",
        "event_id": event_id,
        "format": "single_elim", "team_mode": "solo", "team_size": 1,
        "substitutes_allowed": False,
        "max_participants": 32, "min_participants": 4,
        "registration_open_from": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(),
        "registration_open_until": start.isoformat(),
        "check_in_from": (start - timedelta(hours=2)).isoformat(),
        "check_in_until": start.isoformat(),
        "start_date": start.isoformat(), "end_date": start.isoformat(),
        "is_public": True, "is_invite_only": False,
        "rules": "Standard Mario Kart 8 Regeln. 150cc, alle Items, 4 Rennen pro Match.",
        "prize_pool": "1. Platz: TLS Merch Paket | 2. Platz: 50€ Gutschein | 3. Platz: TLS T-Shirt",
        "best_of": 3, "bronze_match": True,
        "stream_link": "https://twitch.tv/thelionsquad",
        "discord_link": "https://discord.gg/thelionsquad",
        "location": "TLS HQ", "banner_url": None,
        "seeding_mode": "random",
        "status": "registration_open",
        "created_by": admin_id,
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })
    # Register 16 players
    for i, pid in enumerate(player_ids[:16]):
        user = user_docs[i]
        await db.tournament_registrations.insert_one({
            "id": new_id(), "tournament_id": mk_tid, "user_id": pid,
            "team_id": None, "status": "approved",
            "ingame_name": user["display_name"], "discord": user["discord_name"],
            "platform_id": None, "notes": None,
            "accepted_rules": True, "accepted_privacy": True, "seed": None,
            "display_name": user["display_name"],
            "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
        })

    # Smash Tournament - Double Elim, Draft
    await db.tournaments.insert_one({
        "id": new_id(), "slug": "smash-showdown-q1",
        "title": "Smash Showdown Q1",
        "description": "Super Smash Bros. Ultimate. Double Elimination, Best of 5 im Finale.",
        "game_id": smash_id, "platform": "Nintendo Switch",
        "event_id": event_id,
        "format": "double_elim", "team_mode": "solo", "team_size": 1,
        "substitutes_allowed": False,
        "max_participants": 16, "min_participants": 4,
        "registration_open_from": now_utc().isoformat(),
        "registration_open_until": (start + timedelta(days=14)).isoformat(),
        "start_date": (start + timedelta(days=14)).isoformat(),
        "is_public": True, "is_invite_only": False,
        "rules": "Standard Smash Regeln. 3 Stocks, 7 Minuten.",
        "prize_pool": None, "best_of": 3, "bronze_match": False,
        "stream_link": None, "discord_link": None,
        "location": None, "banner_url": None,
        "seeding_mode": "random",
        "status": "registration_open",
        "created_by": admin_id,
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })

    # F1 Fast Lap Challenge (Championship with 4 tracks)
    f1_cid = new_id()
    await db.f1_challenges.insert_one({
        "id": f1_cid, "slug": "f1-winter-championship",
        "title": "F1 Winter Championship 2026",
        "description": "Vier Strecken, schnellste Rundenzeit gewinnt. Championship mit Punkten pro Rennen.",
        "game_id": f1_id, "event_id": event_id,
        "vehicle": "F1 2025 - Beliebig", "weather": "Trocken",
        "assists_allowed": "Bremsassistent nein, Lenkassistent nein, ABS optional",
        "controller_type": "Lenkrad oder Controller erlaubt",
        "platform": "PC / PS5 / Xbox",
        "max_attempts": None, "unlimited_attempts": True,
        "start_date": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
        "end_date": (start + timedelta(days=7)).isoformat(),
        "is_championship": True,
        "points_per_position": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
        "banner_url": "https://images.unsplash.com/photo-1771440571270-e27b63085a48",
        "status": "live",
        "created_by": admin_id,
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })
    # Tracks
    track_ids = []
    for i, (name, country, image) in enumerate(DEMO_TRACKS):
        tid = new_id()
        await db.f1_tracks.insert_one({
            "id": tid, "challenge_id": f1_cid, "name": name,
            "country": country, "image_url": image, "order_index": i,
            "created_at": now_utc().isoformat(),
        })
        track_ids.append(tid)

    # Lap times for each track for random subset of players
    base_times = {0: 80000, 1: 82000, 2: 106000, 3: 64500}  # ms per track
    for t_idx, tid in enumerate(track_ids):
        base = base_times[t_idx]
        participants = random.sample(player_ids, 12)
        for p_idx, pid in enumerate(participants):
            # 1-3 attempts
            for attempt in range(random.randint(1, 3)):
                variation = random.randint(-200, 3500)
                time_ms = base + variation + p_idx * random.randint(50, 150)
                await db.f1_lap_times.insert_one({
                    "id": new_id(), "challenge_id": f1_cid, "track_id": tid,
                    "user_id": pid, "time_ms": time_ms, "penalty_seconds": 0,
                    "is_invalid": False, "proof_url": None, "admin_note": None,
                    "attempt_number": attempt + 1,
                    "created_by": admin_id,
                    "created_at": now_utc().isoformat(),
                    "updated_at": now_utc().isoformat(),
                })

    # Stations
    stations = [
        ("Switch Station 1", "switch"), ("Switch Station 2", "switch"),
        ("Switch Station 3", "switch"), ("Switch 2 Station 1", "switch2"),
        ("PC Station 1", "pc"), ("PC Station 2", "pc"),
        ("Racing Rig Alpha", "racing_rig"), ("Beamer Hauptbühne", "beamer"),
        ("Stream Setup", "stream_setup"), ("Admin Desk", "admin_desk"),
    ]
    for name, device in stations:
        await db.stations.insert_one({
            "id": new_id(), "name": name, "device_type": device,
            "event_id": event_id, "game_id": None, "notes": None,
            "status": "free", "current_match_id": None, "queue_match_ids": [],
            "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
        })

    # News
    await db.news_posts.insert_many([
        {"id": new_id(), "slug": "welcome-tls-arena", "title": "Willkommen in der TLS ARENA",
         "excerpt": "Das neue Home der The Lion Squad eSports Turniere ist da.",
         "content": "Die TLS ARENA ist unsere neue zentrale Plattform für alle Turniere, F1 Fast Lap Challenges, Ligen und Events. Registriert euch, erstellt Teams und sichert euch eure Plätze für das Winter Clash 2026!",
         "banner_url": None, "published": True,
         "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat()},
        {"id": new_id(), "slug": "winter-clash-2026", "title": "Winter Clash 2026 - Anmeldung offen",
         "excerpt": "Mario Kart Winter Cup und Smash Showdown - jetzt anmelden!",
         "content": "Unser Winter Event startet in wenigen Wochen. Mario Kart Winter Cup (32 Spieler, Single Elim, Best of 3) und Smash Showdown Q1 (16 Spieler, Double Elim). Dazu die große F1 Fast Lap Championship mit 4 legendären Strecken.",
         "banner_url": None, "published": True,
         "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat()},
    ])

    print(f"[seed] Demo data created: {len(game_docs)} games, {len(player_ids)} players, 2 tournaments, F1 championship with {len(track_ids)} tracks, {len(stations)} stations.")
