"""Befüllt einen lokalen Abnahme-Stand mit der CoD-Liga, Season 1 (docs/LIGA.md, P6, #2096) - über die echten Routen.

Nur für einen lokalen Abnahme-Stack (docs/entwicklung/abnahme-lokal.md): Testkonten mit Testwerten, erfundene Namen,
keine echten Personen, keine Markenbilder. Läuft wie ``scripts/seed_abnahme.py`` auf dem Rechner und im
Backend-Container weiter. Legt an - und lässt bei jedem weiteren Aufruf, was schon steht (idempotent):

  * Turnierleitung (Admin und Turnierleitung, beide mit Zwei-Faktor), acht Teamleitungen, 40 Spieler
  * Spiel „Call of Duty“ (falls es fehlt) mit drei Modi und fünf Test-Maps mit Platzhalterbild (Name auf Farbe)
  * Liga „CoD-Liga“, Season 1: Start Di 10.11.2026, 10 Wochen, Weihnachtspause 21.12.-3.1., nur Hinrunde, Best of 3,
    Teamgröße 4, Modus je Map Stellung - Suchen & Zerstören - Kontrolle, Map-Pool, Regeltext-Platzhalter,
    Meldeschluss 6.11., Sichtbarkeit „Nur Turnierleitung“ (auf „Öffentlich“ stellt der Obmann selbst)
  * Liga 1, Staffel A (Entwurf) und acht Hauptteams mit je einem Co-Team (4 bis 6 im Kader, Captain und Vertreter),
    der Staffel zugeteilt - der Spielplan entsteht erst mit „Liga starten“ in der Turnierverwaltung

Teams und Konten entstehen direkt in der Datenbank (wie Konten in seed_abnahme.py), Co-Teams, Liga, Season, Pool,
Liga N, Staffel und Zuteilung über die Routen der App, angemeldet wie im Browser. Ein erneuter Aufruf stellt die
Vorgaben der Season wieder auf den Stand oben (auch die Sichtbarkeit) und ergänzt, was fehlt; eine gestartete Staffel
bleibt, wie sie ist.

Aufruf (Stack läuft; Projektname und Compose-Ordner wie bei seed_abnahme_fastlap.py über ABNAHME_PROJECT und
ABNAHME_COMPOSE_DIR):

    python scripts/seed_abnahme_liga.py

Passwort und Zwei-Faktor-Geheimnis entstehen bei jedem Lauf neu und stehen nur in der Stand-Datei
``.local-testing/abnahme/state-liga.json`` (nicht im Repo; anderer Ort über ABNAHME_STATE).
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import pathlib
import secrets
import subprocess
import sys
from datetime import datetime, timezone
from urllib.parse import urlsplit

PROJECT = os.environ.get("ABNAHME_PROJECT", "lsw-abnahme")
# Eigene Konten (liga-…), damit dieser Seed die Zugänge der anderen Seeds nie überschreibt.
ACCOUNTS = {
    "admin": {"email": "liga-admin@abnahme.lionsquad.at", "display_name": "Liga Admin", "role": "superadmin", "mfa": True},
    "lead": {"email": "liga-leitung@abnahme.lionsquad.at", "display_name": "Liga Turnierleitung", "role": "tournament_admin", "mfa": True},
}
GAME = {"name": "Call of Duty", "slug": "call-of-duty", "platforms": ["pc", "ps5", "xbox"]}
MODES = [{"mode": "stellung", "label": "Stellung"}, {"mode": "suchen", "label": "Suchen & Zerstören"},
         {"mode": "kontrolle", "label": "Kontrolle"}]
# Erfundene Test-Maps: Name, Modi, Farbe des Platzhalterbilds.
MAPS = [("Hafenkante", ["stellung", "suchen", "kontrolle"], (32, 74, 110)),
        ("Nebelwerk", ["stellung", "suchen"], (78, 84, 96)),
        ("Turmruine", ["suchen", "kontrolle"], (112, 72, 40)),
        ("Salzmine", ["stellung", "kontrolle"], (60, 98, 70)),
        ("Bahnhof Nord", ["stellung", "suchen", "kontrolle"], (96, 48, 88))]
POOL = {"stellung": ["Hafenkante", "Nebelwerk", "Salzmine", "Bahnhof Nord"],
        "suchen": ["Hafenkante", "Nebelwerk", "Turmruine", "Bahnhof Nord"],
        "kontrolle": ["Hafenkante", "Turmruine", "Salzmine"]}
LEAGUE_NAME = "CoD-Liga"
SEASON = {
    "name": "Season 1", "start_date": "2026-11-10T00:00:00", "weeks_total": 10, "matchday_days": 7,
    "default_match_weekday": 6, "default_match_time": "20:00", "round_robin_legs": 1, "max_staffel_size": 8,
    "best_of": 3, "team_size": 4, "min_squad_size": 4, "game_mode_order": ["stellung", "suchen", "kontrolle"],
    "result_confirm_hours": 48, "lineup_amend_hours": 48, "registration_deadline": "2026-11-06",
    "blocked_periods": [{"start_date": "2026-12-21", "end_date": "2027-01-03", "label": "Weihnachtspause"}],
    "rules_text": ("## Regeln (Platzhalter)\n\nHier steht der Regeltext der Season: Ablauf, Termine, Maps und Modi, "
                   "Fairplay, Einspruch. Der Obmann ersetzt ihn vor dem Start."),
    "visibility": "admins",
}
# Acht erfundene Hauptteams: Name, Kürzel, Co-Team, Kadergröße des Co-Teams, Stamm der Spielernamen.
TEAMS = [("Nebelwölfe", "NBW", "Rudel", 4, "Nebel"), ("Sturmvögel", "STV", "Schwarm", 5, "Sturm"),
         ("Glutfüchse", "GLF", "Bau", 6, "Glut"), ("Frostluchse", "FRL", "Pfote", 4, "Frost"),
         ("Donnerdachse", "DOD", "Höhle", 5, "Donner"), ("Schattenraben", "SRB", "Horst", 6, "Schatten"),
         ("Steinböcke", "STB", "Grat", 4, "Stein"), ("Blitzmarder", "BLM", "Funke", 5, "Marder")]
# Spielernamen: Stamm des Teams und eine Endung (etwa „NebelEcho“) - erfunden, keine echten Personen.
ENDINGS = ["Blitz", "Echo", "Funke", "Kante", "Pixel", "Zacke"]


def host_main() -> int:
    root = pathlib.Path(__file__).resolve().parents[1]
    os.environ["ABNAHME_SEED_PASSWORD"] = secrets.token_urlsafe(18)
    os.environ["ABNAHME_SEED_TOTP"] = base64.b32encode(secrets.token_bytes(20)).decode("ascii")
    compose_dir = pathlib.Path(os.environ.get("ABNAHME_COMPOSE_DIR") or root)
    compose = ["docker", "compose", "-p", PROJECT, "--env-file", str(compose_dir / ".env.abnahme.example"),
               "-f", str(compose_dir / "docker-compose.yml"), "-f", str(compose_dir / "docker-compose.abnahme.yml")]
    source = pathlib.Path(__file__).read_text(encoding="utf-8")
    completed = subprocess.run([*compose, "exec", "-T", "-e", "ABNAHME_SEED_PASSWORD", "-e", "ABNAHME_SEED_TOTP",
                                "backend", "python", "-", "--inside"], input=source, text=True, encoding="utf-8",
                               capture_output=True, cwd=compose_dir)
    sys.stderr.write(completed.stderr[-4000:])
    marker = "ABNAHME-STATE "
    line = next((row for row in completed.stdout.splitlines() if row.startswith(marker)), None)
    if completed.returncode != 0 or not line:
        sys.stdout.write(completed.stdout[-4000:])
        return completed.returncode or 1
    target = pathlib.Path(os.environ.get("ABNAHME_STATE") or root / ".local-testing" / "abnahme" / "state-liga.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(json.loads(line[len(marker):]), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for row in completed.stdout.splitlines():
        if not row.startswith(marker):
            print(row)
    print(f"Stand geschrieben: {target}")
    return 0


# Nur ein lokaler Abnahme-Stand: Datenbank wie in .env.abnahme.example (tls_abnahme, auch mit Zusatz), keine Produktion,
# öffentliche Adressen nur auf diesem Rechner, Datenbank nur der Compose-Dienst „mongodb“ oder dieser Rechner. Sonst
# bricht der Seed ab, bevor er etwas schreibt (wie seed_abnahme.py und seed_abnahme_fastlap.py).
ABNAHME_DB_PREFIX = "tls_abnahme"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
PRODUCTION = {"production", "prod"}
MONGO_HOSTS = {"mongodb", *LOCAL_HOSTS}


def mongo_hosts(url: str) -> list[str] | None:
    """Die Hosts einer Mongo-Adresse (auch mehrere, durch Komma) - None, wenn es keine einfache mongodb://-Adresse ist
    (mongodb+srv:// zeigt immer auf einen entfernten Cluster)."""
    if not url.startswith("mongodb://"):
        return None
    hosts = url[len("mongodb://"):].split("/", 1)[0].split("?", 1)[0].rsplit("@", 1)[-1]
    return [entry[1:entry.find("]")] if entry.startswith("[") else entry.split(":", 1)[0] for entry in hosts.split(",")]


def mongo_is_local(url: str) -> bool:
    hosts = mongo_hosts(url)
    return bool(hosts) and all(host in MONGO_HOSTS for host in hosts)


def guard_environment(env) -> None:
    problems = []
    if not str(env.get("DB_NAME") or "").startswith(ABNAHME_DB_PREFIX):
        problems.append("Datenbank ist nicht die der Abnahme")
    if {str(env.get(key) or "").strip().lower() for key in ("APP_ENV", "ENV", "ENVIRONMENT")} & PRODUCTION:
        problems.append("Umgebung ist Produktion")
    # FRONTEND_URL setzt der Abnahme-Stand immer; PUBLIC_BACKEND_URL ist dort nur Build-Argument des Frontends und
    # fehlt im Backend - geprüft wird sie nur, wenn sie gesetzt ist.
    for key, required in (("FRONTEND_URL", True), ("PUBLIC_BACKEND_URL", False)):
        value = str(env.get(key) or "")
        if not value and not required:
            continue
        if (urlsplit(value).hostname or "") not in LOCAL_HOSTS:
            problems.append(f"{key} zeigt nicht auf diesen Rechner")
    if not mongo_is_local(str(env.get("MONGO_URL") or "")):
        problems.append("MONGO_URL zeigt nicht auf die Datenbank des Abnahme-Stacks")
    if problems:
        raise SystemExit("Abbruch, kein lokaler Abnahme-Stand: " + "; ".join(problems))


def credentials() -> tuple[str, str]:
    return os.environ["ABNAHME_SEED_PASSWORD"], os.environ["ABNAHME_SEED_TOTP"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Session:
    def __init__(self, client):
        self.client = client

    @classmethod
    async def login(cls, email: str):
        import httpx
        from services.totp import current_totp

        password, totp_secret = credentials()
        client = httpx.AsyncClient(base_url="http://127.0.0.1:8001", timeout=60)
        for _ in range(3):
            response = await client.post("/api/auth/login", json={"email": email, "password": password, "remember": True})
            assert response.status_code == 200, f"Anmeldung {email}: {response.status_code} {response.text}"
            body = response.json()
            if not body.get("mfa_required"):
                return cls(client)
            done = await client.post("/api/auth/mfa/complete", json={"ticket": body["mfa_ticket"], "code": current_totp(totp_secret)})
            if done.status_code == 200:
                return cls(client)
            # Jeder Code zählt einmal: im selben 30-Sekunden-Fenster auf den nächsten warten.
            await asyncio.sleep(31)
        raise AssertionError(f"Zwei-Faktor {email} nicht möglich")

    async def call(self, method: str, url: str, expect=(200,), **kwargs):
        token = self.client.cookies.get("csrf_token")
        response = await self.client.request(method, url, headers={"x-csrf-token": token} if token else {}, **kwargs)
        assert response.status_code in expect, f"{method} {url}: {response.status_code} {response.text[:600]}"
        return response.json() if response.content else None

    async def close(self):
        await self.client.aclose()


async def ensure_accounts(db) -> dict:
    from auth import password_fields
    from services.secret_store import encrypt_secret

    stamp = now_iso()
    password, totp_secret = credentials()

    async def upsert(key: str, email: str, display_name: str, role: str, mfa: bool) -> dict:
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        doc = {
            "id": existing["id"] if existing else f"abnahme-liga-{key}", "email": email, "username": email.split("@")[0],
            "display_name": display_name, "role": role, "is_active": True, "email_verified": True,
            "privacy_policy_version": "2026-08-26", "terms_version": "2026-08-26", "accepted_privacy": True,
            "accepted_terms": True, "consent_required": False, "consent_updated_at": stamp,
            "created_at": (existing or {}).get("created_at") or stamp, "updated_at": stamp, **password_fields(password),
        }
        if mfa:
            doc.update({"mfa_enabled": True, "mfa_secret": encrypt_secret(totp_secret), "mfa_recovery_code_hashes": []})
        await db.users.update_one({"email": email}, {"$set": doc, "$unset": {"mfa_totp_last_counter": ""}}, upsert=True)
        return doc

    users = {key: await upsert(key, a["email"], a["display_name"], a["role"], a["mfa"]) for key, a in ACCOUNTS.items()}
    teams = []
    number = 0
    for *_team, stem in TEAMS:
        people = []
        # Teamleitung plus sechs Mitglieder - das Co-Team nimmt davon 4 bis 6.
        for ending in ["Leitung", *ENDINGS]:
            number += 1
            role_key = f"spieler-{number:02d}"
            people.append(await upsert(role_key, f"liga-spieler{number:02d}@abnahme.lionsquad.at", f"{stem}{ending}",
                                       "player", False))
        teams.append(people)
    users["teams"] = teams
    return users


async def ensure_team(db, team_name: str, tag: str, people: list[dict]) -> dict:
    """Hauptteam mit Leitung und Mitgliedern, direkt in der Datenbank - wie ein Team, das es im Verein schon gibt."""
    leader, members = people[0], people[1:]
    existing = await db.teams.find_one({"tag": tag}, {"_id": 0})
    if existing and existing.get("name") != team_name:
        raise SystemExit(f"Das Kürzel {tag} trägt schon das Team {existing.get('name')!r} - Seed abgebrochen.")
    stamp = now_iso()
    team = existing or {"id": f"abnahme-liga-team-{tag.lower()}", "created_at": stamp, "join_code": secrets.token_urlsafe(6)}
    member_ids = list(dict.fromkeys([*(team.get("member_ids") or []), leader["id"], *(user["id"] for user in members)]))
    team.update({"name": team_name, "tag": tag, "leader_id": leader["id"], "co_leader_ids": team.get("co_leader_ids") or [],
                 "member_ids": member_ids, "is_public": True, "updated_at": stamp,
                 "description": "Testteam der lokalen Abnahme (erfunden)."})
    await db.teams.update_one({"id": team["id"]}, {"$set": team}, upsert=True)
    for user in people:
        role = "leader" if user is leader else "member"
        await db.team_members.update_one({"team_id": team["id"], "user_id": user["id"]},
                                         {"$set": {"team_id": team["id"], "user_id": user["id"], "role": role},
                                          "$setOnInsert": {"joined_at": stamp}}, upsert=True)
    return team


def placeholder_png(name: str, color: tuple[int, int, int]) -> bytes:
    """Platzhalterbild 16 : 9 - Fläche in einer Farbe, Name und „Test-Map“ darauf. Kein Markenbild."""
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (1280, 720), color)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 560, 1280, 720), fill=tuple(max(0, part - 28) for part in color))
    try:
        title, small = ImageFont.load_default(size=96), ImageFont.load_default(size=40)
    except (TypeError, OSError, ImportError):  # Pillow ohne Größe oder ohne FreeType: kleine Schrift
        title = small = ImageFont.load_default()
    draw.text((64, 400), name, fill=(240, 240, 240), font=title)
    draw.text((64, 600), "Test-Map · Platzhalter", fill=(210, 210, 210), font=small)
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


async def ensure_game(admin: Session, db) -> dict:
    game = await db.games.find_one({"slug": GAME["slug"]}, {"_id": 0})
    if not game:
        return await admin.call("POST", "/api/games", json={**GAME, "match_modes": MODES})
    known = {mode.get("mode") for mode in game.get("match_modes") or [] if isinstance(mode, dict)}
    missing = [mode for mode in MODES if mode["mode"] not in known]
    if missing:
        game = await admin.call("PATCH", f"/api/games/{game['id']}", json={"match_modes": [*(game.get("match_modes") or []), *missing]})
    return game


async def ensure_maps(admin: Session, game: dict) -> dict:
    listed = await admin.call("GET", f"/api/games/{game['id']}/maps")
    by_name = {row["name"]: row for row in listed["maps"]}
    maps = {}
    for name, modes, color in MAPS:
        current = by_name.get(name)
        if current and current.get("image_url"):
            maps[name] = current
            continue
        upload = await admin.call("POST", "/api/uploads/image", params={"media_scope": "admin"},
                                  files={"file": (f"testmap-{name.lower().replace(' ', '-')}.png", placeholder_png(name, color), "image/png")})
        if current:
            maps[name] = await admin.call("PATCH", f"/api/games/{game['id']}/maps/{current['id']}", json={"image_url": upload["url"]})
        else:
            maps[name] = await admin.call("POST", f"/api/games/{game['id']}/maps",
                                          json={"name": name, "modes": modes, "image_url": upload["url"],
                                                "note": "Test-Map der lokalen Abnahme (erfunden)"})
    return maps


async def ensure_league(admin: Session, game: dict, maps: dict) -> tuple[dict, dict, dict, dict]:
    listing = await admin.call("GET", "/api/admin/leagues")
    league = next((row for row in listing["leagues"] if row.get("game_id") == game["id"] and row.get("name") == LEAGUE_NAME), None)
    if not league:
        league = await admin.call("POST", "/api/admin/leagues", json={"name": LEAGUE_NAME, "game_id": game["id"]})
        league["seasons"] = []
    season = next((row for row in league.get("seasons") or [] if row.get("number") == 1), None)
    if season:
        # Wieder auf den Stand des Seeds - auch die Sichtbarkeit (die schaltet der Obmann in der Abnahme selbst).
        await admin.call("PATCH", f"/api/admin/leagues/seasons/{season['id']}", json=SEASON)
    else:
        season = await admin.call("POST", f"/api/admin/leagues/{league['id']}/seasons", json={**SEASON, "number": 1})
    view = await admin.call("GET", f"/api/admin/leagues/seasons/{season['id']}")
    if not view.get("map_pool"):
        await admin.call("PUT", f"/api/admin/leagues/seasons/{season['id']}/map-pool", json={"modes": [
            {"mode": mode, "map_ids": [maps[name]["id"] for name in names]} for mode, names in POOL.items()]})
    division = next((row for row in view["divisions"] if row.get("level") == 1), None)
    if not division:
        division = await admin.call("POST", f"/api/admin/leagues/seasons/{season['id']}/divisions", json={})
        division["staffeln"] = []
    staffel = next((row for row in division.get("staffeln") or [] if row.get("staffel") == "A"), None)
    if not staffel:
        staffel = await admin.call("POST", f"/api/admin/leagues/divisions/{division['id']}/staffeln", json={"staffel": "A"})
    return league, view["season"], division, staffel


async def ensure_squads(admin: Session, db, game: dict, tid: str, teams: list[dict]) -> list[dict]:
    """Je Hauptteam ein Co-Team mit Captain und Vertreter (über die Route der Teamleitung, hier als Admin) und die
    Zuteilung zur Staffel (Route der Turnierleitung) - beides nur, wenn es noch fehlt."""
    rows = []
    for (team_name, _tag, squad_word, size, _stem), (team, people) in zip(TEAMS, teams):
        roster = people[1:1 + size]
        name = f"{team_name} {squad_word}"
        squad = await db.team_squads.find_one({"team_id": team["id"], "name": name}, {"_id": 0})
        if not squad:
            squad = await admin.call("POST", f"/api/teams/{team['id']}/squads", json={
                "name": name, "game_id": game["id"], "member_ids": [user["id"] for user in roster],
                "captain_id": roster[0]["id"], "vice_captain_id": roster[1]["id"],
                "description": "Co-Team der lokalen Abnahme (erfunden)."})
        registration = await db.tournament_registrations.find_one({"tournament_id": tid, "squad_id": squad["id"]}, {"_id": 0})
        if not registration:
            registration = (await admin.call("POST", f"/api/tournaments/{tid}/squad-registrations",
                                             json={"team_id": team["id"], "squad_id": squad["id"]}))["registration"]
        rows.append({"team": team, "squad": squad, "registration": registration, "people": people})
    return rows


async def inside_main() -> None:
    guard_environment(os.environ)
    from database import get_db

    db = get_db()
    # Neu befüllen hebt die Sperre gegen Rateversuche bei der Anmeldung auf (nur hier, im geprüften Abnahme-Stand).
    await db.rate_limits.delete_many({"bucket": {"$regex": "^auth:"}})
    users = await ensure_accounts(db)
    teams = [(await ensure_team(db, name, tag, people), people) for (name, tag, *_rest), people in zip(TEAMS, users["teams"])]
    admin = await Session.login(ACCOUNTS["admin"]["email"])
    try:
        game = await ensure_game(admin, db)
        maps = await ensure_maps(admin, game)
        league, season, division, staffel = await ensure_league(admin, game, maps)
        tid = staffel.get("tournament_id")
        squads = await ensure_squads(admin, db, game, tid, teams)
    finally:
        await admin.close()
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0, "slug": 1, "status": 1, "title": 1})

    password, totp_secret = credentials()
    by_id = {user["id"]: user for _team, people in teams for user in people}
    first = squads[0]
    state = {
        "accounts": {key: {"email": ACCOUNTS[key]["email"], "password": password, "totp": totp_secret if ACCOUNTS[key]["mfa"] else None}
                     for key in ACCOUNTS},
        "league": {"id": league["id"], "slug": league["slug"], "name": league["name"]},
        "season": {"id": season["id"], "slug": season["slug"], "visibility": season.get("visibility")},
        "division": {"id": division["id"], "level": division.get("level")},
        "staffel": {"tournament_id": tid, "slug": tournament.get("slug"), "status": tournament.get("status"), "title": tournament.get("title")},
        "game": {"id": game["id"], "slug": game.get("slug")},
        "maps": {name: row["id"] for name, row in maps.items()},
        "teams": [{"name": row["team"]["name"], "team_id": row["team"]["id"], "squad_id": row["squad"]["id"],
                   "squad_name": row["squad"]["name"], "registration_id": row["registration"]["id"],
                   "leader": row["people"][0]["email"], "captain": by_id[row["squad"]["captain_id"]]["email"],
                   "vice_captain": by_id[row["squad"]["vice_captain_id"]]["email"]} for row in squads],
    }
    # Zugänge für Browser und Hand: Captain, Vertreter und ein Mitglied des ersten Co-Teams, dazu seine Teamleitung.
    member = next(uid for uid in first["squad"]["member_ids"] if uid not in (first["squad"]["captain_id"], first["squad"]["vice_captain_id"]))
    for key, user in (("captain", by_id[first["squad"]["captain_id"]]), ("vice_captain", by_id[first["squad"]["vice_captain_id"]]),
                      ("member", by_id[member]), ("team_lead", first["people"][0])):
        state["accounts"][key] = {"email": user["email"], "password": password, "totp": None}
    print(f"Liga: {league['name']} / {season.get('name')} / Liga {division.get('level')} / Staffel A "
          f"({tournament.get('status')}), {len(squads)} Co-Teams zugeteilt. Ligaseite: /liga/{league['slug']}/{season['slug']}")
    print("ABNAHME-STATE " + json.dumps(state, ensure_ascii=False))


if __name__ == "__main__":
    if "--inside" in sys.argv:
        os.chdir("/app")
        sys.path.insert(0, "/app")
        asyncio.run(inside_main())
    else:
        sys.exit(host_main())
