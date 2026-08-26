"""Live-Durchspielen einer Call-of-Duty-Liga (Round Robin, 6 Teams à 2 Spieler).

Nutzt die echte Turnier-Engine (bracket_engine.generate_bracket + match_rules)
und schreibt in dieselben Collections wie die App, damit Bracket/Tabelle auf den
öffentlichen Seiten korrekt erscheinen.
"""
import asyncio
import random
import secrets
import sys
import time

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from database import get_db
from models import new_id, now_utc
from auth import hash_password
from bracket_engine import generate_bracket, compute_round_robin_standings
from match_rules import loser_for_winner
from services.competition_versions import new_competition_version_fields, persist_competition_versions

DEMO_PASSWORD = "DemoLion2026!!"

# 12 CoD-Gamertags → 6 Teams à 2
PLAYERS = [
    ("cod_reaper", "Reaper", "AT"), ("cod_ghost", "Ghost", "DE"),
    ("cod_viper", "Viper", "AT"), ("cod_frost", "Frost", "CH"),
    ("cod_havoc", "Havoc", "DE"), ("cod_blaze", "Blaze", "AT"),
    ("cod_sniper", "Sn1per", "DE"), ("cod_recon", "Recon", "AT"),
    ("cod_titan", "Titan", "CH"), ("cod_wraith", "Wraith", "DE"),
    ("cod_nova", "Nova", "AT"), ("cod_zero", "Zero", "DE"),
]
TEAMS = [
    ("Phoenix Ops", "PHX"), ("Venom Squad", "VNM"), ("Raven Six", "RVN"),
    ("Overwatch Elite", "OVR"), ("Sentinel Crew", "SNT"), ("Havoc Union", "HVOC"),
]
TOURNAMENT_SLUG = "cod-mwiii-liga-2026"


async def upsert_game(db):
    g = await db.games.find_one({"slug": "call-of-duty-mwiii"}, {"_id": 0})
    if g:
        return g["id"]
    gid = new_id()
    await db.games.insert_one({
        "id": gid, "name": "Call of Duty: Modern Warfare III", "slug": "call-of-duty-mwiii",
        "kind": "standalone", "short_name": "CoD MWIII",
        "logo_url": None, "cover_url": None, "platforms": ["PC", "PlayStation", "Xbox"],
        "genre": "FPS",
        "supports_solo": True, "supports_teams": True, "supports_ffa": False,
        "supports_time_trial": False, "supports_grand_prix": False,
        "default_team_size": 2, "default_format": "round_robin",
        "player_id_fields": [], "parent_game_id": None,
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })
    print(f"  + Spiel angelegt: Call of Duty: Modern Warfare III")
    return gid


async def upsert_players(db):
    ids = []
    for username, display, country in PLAYERS:
        existing = await db.users.find_one({"username": username}, {"_id": 0, "id": 1})
        if existing:
            ids.append(existing["id"])
            continue
        uid = new_id()
        await db.users.insert_one({
            "id": uid, "email": f"{username}@demo.lionsquad.at", "username": username,
            "password_hash": hash_password(DEMO_PASSWORD), "display_name": display,
            "avatar_url": None, "role": "player", "discord_name": username,
            "country": country, "favorite_games": [], "privacy_public_profile": True,
            "bio": f"CoD Pro: {display}", "is_active": True, "is_banned": False,
            "accepted_privacy": True,
            "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
        })
        ids.append(uid)
    return ids


async def upsert_teams(db, player_ids):
    team_ids = []
    for i, (name, tag) in enumerate(TEAMS):
        members = player_ids[i * 2: i * 2 + 2]
        existing = await db.teams.find_one({"tag": tag}, {"_id": 0, "id": 1})
        if existing:
            await db.teams.update_one({"id": existing["id"]}, {"$set": {
                "member_ids": members, "leader_id": members[0], "co_leader_ids": [members[1]],
            }})
            team_ids.append((existing["id"], name, tag, members))
            continue
        tid = new_id()
        await db.teams.insert_one({
            "id": tid, "name": name, "tag": tag, "description": f"CoD-Team {name}",
            "logo_url": None, "discord_link": None, "social_links": {},
            "leader_id": members[0], "co_leader_ids": [members[1]], "member_ids": members,
            "join_code": secrets.token_urlsafe(6), "is_public": True,
            "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
        })
        team_ids.append((tid, name, tag, members))
    return team_ids


async def reset_tournament(db, game_id):
    old = await db.tournaments.find_one({"slug": TOURNAMENT_SLUG}, {"_id": 0, "id": 1})
    if old:
        await db.matches.delete_many({"tournament_id": old["id"]})
        await db.tournament_registrations.delete_many({"tournament_id": old["id"]})
        await db.tournaments.delete_one({"id": old["id"]})
    tid = new_id()
    doc = {
        "id": tid, "title": "CoD MWIII Pro Liga 2026", "slug": TOURNAMENT_SLUG,
        "description": "Deutschsprachige Call-of-Duty-Liga im Modus jeder-gegen-jeden. "
                       "6 Teams à 2 Spieler, einfache Runde, Search & Destroy (first to 6).",
        "game_id": game_id, "platform": "PC", "event_id": None,
        "format": "round_robin", "format_label": "Liga · Jeder gegen Jeden",
        "team_mode": "team", "team_size": 2, "substitutes_allowed": False,
        "max_participants": 6, "min_participants": 2,
        "registration_enabled": False, "block_club_member_registration": False,
        "is_public": True, "is_invite_only": False,
        "rules": "Search & Destroy, first to 6 Runden. Sieg = 3 Punkte, Remis = 1, Niederlage = 0.",
        "best_of": 1, "bronze_match": False, "match_duration_minutes": 25,
        "seeding_mode": "manual", "randomize_advancement_rounds": False,
        "event_mode": "online", "result_entry_mode": "staff_only",
        "season_weight": 2.0, "visibility": "public",
        "status": "live",
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    }
    doc.update(new_competition_version_fields("round_robin"))
    await db.tournaments.insert_one(doc)
    return doc


async def create_registrations(db, tid, teams):
    regs = []
    for seed, (team_id, name, tag, members) in enumerate(teams, start=1):
        reg = {
            "id": new_id(), "tournament_id": tid, "user_id": members[0], "team_id": team_id,
            "status": "approved", "ingame_name": f"[{tag}] {name}",
            "player_ids": {}, "accepted_rules": True, "accepted_privacy": True,
            "seed": seed, "display_name": f"[{tag}] {name}", "registration_type": "team",
            "source": "league_script", "is_guest": False,
            "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
        }
        await db.tournament_registrations.insert_one(reg)
        regs.append(reg)
    return regs


def realistic_score(rng):
    """S&D first-to-6. Winner 6, loser 0..5 (gelegentlich 6:5-Krimi)."""
    loser = rng.choices([0, 1, 2, 3, 4, 5], weights=[6, 10, 16, 20, 22, 26])[0]
    return 6, loser


def print_table(rows, reg_names):
    header = f"{'#':>2}  {'Team':<22} {'Sp':>2} {'S':>2} {'U':>2} {'N':>2} {'Rd+':>4} {'Rd-':>4} {'Diff':>5} {'Pkt':>4}"
    print(header)
    print("  " + "-" * (len(header) - 2))
    for r in rows:
        diff = r["score_for"] - r["score_against"]
        print(f"{r['rank']:>2}  {reg_names.get(r['registration_id'], '?'):<22} "
              f"{r['played']:>2} {r['won']:>2} {r['drawn']:>2} {r['lost']:>2} "
              f"{r['score_for']:>4} {r['score_against']:>4} {diff:>+5} {r['points']:>4}")


async def main():
    db = get_db()
    rng = random.Random(20260826)
    print("=== CoD MWIII Pro Liga 2026 — Setup ===")
    game_id = await upsert_game(db)
    player_ids = await upsert_players(db)
    print(f"  + {len(player_ids)} Spieler bereit")
    teams = await upsert_teams(db, player_ids)
    print(f"  + {len(teams)} Teams bereit: " + ", ".join(f"[{t[2]}]" for t in teams))
    tournament = await reset_tournament(db, game_id)
    tid = tournament["id"]
    regs = await create_registrations(db, tid, teams)
    reg_names = {r["id"]: r["display_name"] for r in regs}
    print(f"  + Turnier '{tournament['title']}' live · {len(regs)} Teams angemeldet\n")

    # Spielplan generieren (echte Engine)
    matches = generate_bracket(tournament, regs, preview=False)
    await db.matches.insert_many([dict(m) for m in matches])
    await persist_competition_versions(db, tournament, "classic")
    rounds = sorted({m["round"] for m in matches})
    print(f"=== Spielplan generiert: {len(matches)} Spiele über {len(rounds)} Spieltage ===\n")

    # Live durchspielen — Spieltag für Spieltag
    for rnd in rounds:
        day_matches = [m for m in matches if m["round"] == rnd]
        print(f"--- Spieltag {rnd} ---")
        for m in day_matches:
            sa, sb = realistic_score(rng)
            if rng.random() < 0.5:
                sa, sb = sb, sa
            winner = m["participant_a_id"] if sa > sb else m["participant_b_id"]
            loser = loser_for_winner({**m}, winner)
            await db.matches.update_one({"id": m["id"]}, {"$set": {
                "score_a": sa, "score_b": sb, "winner_id": winner, "loser_id": loser,
                "status": "completed", "updated_at": now_utc().isoformat(),
            }})
            m.update({"score_a": sa, "score_b": sb, "winner_id": winner,
                      "loser_id": loser, "status": "completed"})
            na = reg_names.get(m["participant_a_id"], "?")
            nb = reg_names.get(m["participant_b_id"], "?")
            mark = "◄" if sa > sb else "►"
            print(f"   {na:<22} {sa}:{sb} {mark} {nb}")
        time.sleep(0.4)
        current = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(500)
        table = compute_round_robin_standings(current, regs)
        print()
        print_table(table, reg_names)
        print()

    # Turnier abschließen + Endplatzierungen in Registrierungen schreiben
    final = compute_round_robin_standings(
        await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(500), regs)
    for row in final:
        await db.tournament_registrations.update_one(
            {"id": row["registration_id"]}, {"$set": {"final_position": row["rank"]}})
    winner_reg = next((r for r in regs if r["id"] == final[0]["registration_id"]), None)
    winner_team_id = winner_reg["team_id"] if winner_reg else None
    await db.tournaments.update_one({"id": tid}, {"$set": {
        "status": "completed", "winner_team_id": winner_team_id,
        "updated_at": now_utc().isoformat(),
    }})

    print("=== 🏆 ENDSTAND ===")
    print_table(final, reg_names)
    champ = reg_names.get(final[0]["registration_id"], "?")
    print(f"\n🏆 MEISTER: {champ}  ({final[0]['points']} Punkte)")
    print(f"\nTurnier-Slug: {TOURNAMENT_SLUG}  ·  ID: {tid}")


if __name__ == "__main__":
    asyncio.run(main())
