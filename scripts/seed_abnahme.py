"""Befüllt den lokalen Abnahme-Stand (docs/entwicklung/abnahme-lokal.md) realistisch - über die echten Routen.

Nur für den Abnahme-Stack `lsw-abnahme` auf diesem Rechner: Testkonten mit Testwerten, keine echten Personen, keine
echten Geheimnisse. Das Skript startet auf dem Rechner und läuft im Backend-Container weiter (dort sind App-Code,
Datenbank und Umgebung). Konten entstehen direkt in der Datenbank (wie in der Flow-Testumgebung, mit Passwort und
Zwei-Faktor), alles andere über die Routen der App, angemeldet wie im Browser:

  * Spiel Mario Kart 8 Deluxe (Grand Prix 12 Min.), 16 Spieler, ein Helfer, die Turnierleitung, ein Admin
  * Vor-Ort-Cup mit Vorschau-Baum (Anmeldung offen): FFA 16, Winner und Loser Bracket, Gegner gemischt, 4 Stationen
  * derselbe Cup nach dem Check-in-Ende: fixer Baum, Plan übernommen, live, zwei Läufe gewertet, einer läuft
  * Online-Turnier (K.-o., 8 Spieler, live, ein Ergebnis) und eine Liga (6 Spieler, Spielwochen)
  * eine Fast Lap mit Strecke und Zeiten

Aufruf (der Stack läuft, siehe Anleitung):

    python scripts/seed_abnahme.py

Schreibt Kennungen und Anmeldedaten für die Browser-Tests nach `.local-testing/abnahme/state.json` (nicht im Repo).
Mehrfach aufrufbar: Konten werden wiederverwendet, Turniere kommen jedes Mal neu dazu.
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import subprocess
import sys
from datetime import datetime, timedelta, timezone

PROJECT = "lsw-abnahme"
# Testwerte, nur für diesen lokalen Stack. Das TOTP-Geheimnis ist das Beispiel aus RFC 6238.
TEST_PASSWORD = "Abnahme-Testpasswort-2026"
TEST_TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
ACCOUNTS = {
    "admin": {"email": "admin@abnahme.lionsquad.at", "display_name": "Abnahme Admin", "role": "superadmin", "mfa": True},
    "lead": {"email": "turnierleitung@abnahme.lionsquad.at", "display_name": "Abnahme Turnierleitung", "role": "tournament_admin", "mfa": True},
    "helper": {"email": "helfer@abnahme.lionsquad.at", "display_name": "Abnahme Helfer", "role": "player", "mfa": False},
}
PLAYERS = ["NeonFalke", "KartKönigin", "LuckyLion", "PixelPaula", "DriftDaniel", "BoostBerta", "TurboTom", "SchnellSchnecke",
           "KurvenKarl", "NitroNina", "BlitzBea", "RaketenRudi", "SternSeppi", "GipfelGabi", "PistenPaul", "ZickZackZoe"]

CUP_SCHEMA = """[WB]
# Runde 1
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
# Runde 2
E=[W:A:1,W:A:2,W:B:1,W:B:2]
F=[W:C:1,W:C:2,W:D:1,W:D:2]
# Runde 3
G=[W:E:1,W:E:2,W:F:1,W:F:2]

[LB]
# Runde 1
LA=[L:A:1,L:A:2,L:B:1,L:B:2]
LB=[L:C:1,L:C:2,L:D:1,L:D:2]
# Runde 2
LC=[W:LA:1,W:LA:2,L:E:1,L:E:2]
LD=[W:LB:1,W:LB:2,L:F:1,L:F:2]
# Runde 3
LE=[W:LC:1,W:LC:2,W:LD:1,W:LD:2]
# Runde 4
LF=[W:LE:1,W:LE:2,L:G:1,L:G:2]

[FINAL]
# Finale
FINAL=[W:G:1,W:G:2,W:LF:1,W:LF:2]"""


# ---------------------------------------------------------------------------------------------------- auf dem Rechner

def host_main() -> int:
    root = pathlib.Path(__file__).resolve().parents[1]
    compose = ["docker", "compose", "-p", PROJECT, "--env-file", str(root / ".env.abnahme.example"),
               "-f", str(root / "docker-compose.yml"), "-f", str(root / "docker-compose.abnahme.yml")]
    source = pathlib.Path(__file__).read_text(encoding="utf-8")
    completed = subprocess.run([*compose, "exec", "-T", "backend", "python", "-", "--inside"], input=source,
                               text=True, encoding="utf-8", capture_output=True, cwd=root)
    sys.stderr.write(completed.stderr[-4000:])
    if completed.returncode != 0:
        sys.stdout.write(completed.stdout[-4000:])
        return completed.returncode
    marker = "ABNAHME-STATE "
    line = next((row for row in completed.stdout.splitlines() if row.startswith(marker)), None)
    if not line:
        sys.stdout.write(completed.stdout[-4000:])
        print("Kein Ergebnis vom Seed - siehe Ausgabe oben.")
        return 1
    state = json.loads(line[len(marker):])
    target = root / ".local-testing" / "abnahme" / "state.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(state, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for row in completed.stdout.splitlines():
        if not row.startswith(marker):
            print(row)
    print(f"Stand geschrieben: {target}")
    return 0


# ------------------------------------------------------------------------------------------------ im Backend-Container

def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def quarter(moment: datetime) -> datetime:
    moment = moment.replace(second=0, microsecond=0)
    return moment - timedelta(minutes=moment.minute % 15)


class Session:
    """Ein angemeldeter Browser: Cookies, CSRF-Kopf, Zwei-Faktor wie beim echten Anmelden."""

    def __init__(self, client):
        self.client = client

    @classmethod
    async def login(cls, email: str, mfa: bool):
        import httpx
        from services.totp import current_totp

        client = httpx.AsyncClient(base_url="http://127.0.0.1:8001", timeout=60)
        response = await client.post("/api/auth/login", json={"email": email, "password": TEST_PASSWORD, "remember": True})
        assert response.status_code == 200, f"Anmeldung {email}: {response.status_code} {response.text}"
        body = response.json()
        if body.get("mfa_required"):
            assert mfa, f"{email} verlangt Zwei-Faktor"
            completed = None
            for _ in range(3):
                completed = await client.post("/api/auth/mfa/complete", json={"ticket": body["mfa_ticket"], "code": current_totp(TEST_TOTP_SECRET)})
                if completed.status_code == 200:
                    break
                # Jeder Code zählt einmal: im selben 30-Sekunden-Fenster auf den nächsten warten.
                await asyncio.sleep(31)
                response = await client.post("/api/auth/login", json={"email": email, "password": TEST_PASSWORD, "remember": True})
                body = response.json()
            assert completed is not None and completed.status_code == 200, f"Zwei-Faktor {email}: {completed.text}"
        return cls(client)

    def _headers(self) -> dict:
        token = self.client.cookies.get("csrf_token")
        return {"x-csrf-token": token} if token else {}

    async def call(self, method: str, url: str, expect=(200,), **kwargs):
        response = await self.client.request(method, url, headers=self._headers(), **kwargs)
        assert response.status_code in expect, f"{method} {url}: {response.status_code} {response.text[:600]}"
        return response.json() if response.content else None

    async def close(self):
        await self.client.aclose()


async def ensure_accounts(db) -> dict:
    from auth import password_fields
    from services.secret_store import encrypt_secret

    stamp = now_utc().isoformat()
    users = {}

    async def upsert(key: str, email: str, display_name: str, role: str, mfa: bool) -> dict:
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        user_id = existing["id"] if existing else f"abnahme-{key}"
        doc = {
            "id": user_id, "email": email, "username": email.split("@")[0], "display_name": display_name, "role": role,
            "is_active": True, "email_verified": True, "privacy_policy_version": "2026-08-26", "terms_version": "2026-08-26",
            "accepted_privacy": True, "accepted_terms": True, "consent_required": False, "consent_updated_at": stamp, "created_at": (existing or {}).get("created_at") or stamp,
            "updated_at": stamp, **password_fields(TEST_PASSWORD),
        }
        if mfa:
            doc.update({"mfa_enabled": True, "mfa_secret": encrypt_secret(TEST_TOTP_SECRET), "mfa_recovery_code_hashes": []})
        await db.users.update_one({"email": email}, {"$set": doc, "$unset": {"mfa_totp_last_counter": ""}}, upsert=True)
        return doc

    for key, account in ACCOUNTS.items():
        users[key] = await upsert(key, account["email"], account["display_name"], account["role"], account["mfa"])
    players = []
    for index, name in enumerate(PLAYERS, start=1):
        players.append(await upsert(f"spieler-{index:02d}", f"spieler{index:02d}@abnahme.lionsquad.at", name, "player", False))
    users["players"] = players
    return users


async def ensure_game(admin: Session, db) -> dict:
    existing = await db.games.find_one({"slug": "abnahme-mario-kart-8"}, {"_id": 0})
    if existing:
        return existing
    return await admin.call("POST", "/api/games", json={
        "name": "Mario Kart 8 Deluxe (Abnahme)", "slug": "abnahme-mario-kart-8", "platforms": ["switch"],
        "match_modes": [{"mode": "gp4", "label": "Grand Prix (4 Rennen)", "minutes": 12}],
        "station_devices": ["switch", "switch2"], "players_per_run_local": 4, "players_per_run_online": 12,
    })


async def tournament(admin: Session, game: dict, title: str, start: datetime, **fields) -> dict:
    body = {"title": title, "game_id": game["id"], "status": "registration_open", "start_date": start.isoformat(),
            "max_participants": 16, **fields}
    return await admin.call("POST", "/api/tournaments", json=body)


async def register(admin: Session, tournament_doc: dict, players: list, status: str = "approved"):
    for seed, player in enumerate(players, start=1):
        await admin.call("POST", f"/api/tournaments/{tournament_doc['id']}/registrations",
                         json={"user_id": player["id"], "display_name": player["display_name"], "status": status, "seed": seed})


async def stations(admin: Session, tournament_doc: dict, count: int) -> list:
    created = []
    for index in range(1, count + 1):
        created.append(await admin.call("POST", "/api/stations", json={
            "name": f"Switch {index}", "device_type": "switch2", "tournament_id": tournament_doc["id"]}))
    return created


async def result(admin: Session, match: dict):
    ranking = [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]
    await admin.call("POST", f"/api/matches/{match['id']}/result", json={
        "results": [{"registration_id": reg, "rank": index + 1, "score": max(0, 15 - 3 * index)} for index, reg in enumerate(ranking)]})


async def matches_of(admin: Session, tid: str) -> dict:
    rows = await admin.call("GET", f"/api/tournaments/{tid}/matches-v2")
    return {row.get("match_key"): row for row in rows if not row.get("is_preview")}


CUP_STRUCTURE = {"name": "Läufe", "stage_type": "ffa_custom_bracket", "match_type": "ffa",
                 "settings": {"schema": CUP_SCHEMA, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2}}
CUP_FIELDS = {"format": "ffa_custom_bracket", "event_mode": "local", "schedule_mode": "fixed_by_staff",
              "result_entry_mode": "staff_only", "match_buffer_minutes": 8, "match_break_minutes": 5,
              "randomize_advancement_rounds": True}


async def inside_main() -> None:
    sys.path.insert(0, "/app")
    from database import get_db
    from services import scheduler

    db = get_db()
    users = await ensure_accounts(db)
    admin = await Session.login(ACCOUNTS["admin"]["email"], True)
    state = {"accounts": {key: {"email": ACCOUNTS[key]["email"], "password": TEST_PASSWORD, "totp": TEST_TOTP_SECRET if ACCOUNTS[key]["mfa"] else None}
                          for key in ACCOUNTS}, "tournaments": {}}
    try:
        game = await ensure_game(admin, db)
        stamp = now_utc().strftime("%d.%m. %H:%M")

        # Vor Ort, Baum noch Vorschau: Anmeldung offen, so steht der Cup bis zum Turniertag.
        draft = await tournament(admin, game, f"Abnahme Cup Vorschau ({stamp})", quarter(now_utc() + timedelta(days=2)), **CUP_FIELDS)
        await register(admin, draft, users["players"])
        await admin.call("POST", f"/api/tournaments/{draft['id']}/bracket/from-format?preview=true", json=CUP_STRUCTURE)
        await stations(admin, draft, 4)
        await admin.call("POST", f"/api/tournaments/{draft['id']}/staff", json={"user_id": users["lead"]["id"], "role": "organizer"})
        await admin.call("POST", f"/api/tournaments/{draft['id']}/staff", json={"user_id": users["helper"]["id"], "role": "referee"})
        state["tournaments"]["local_draft"] = draft["id"]

        # Vor Ort nach dem Check-in-Ende: fixer Baum aus den Eingecheckten, Plan übernommen, live mit Verzug.
        start = quarter(now_utc() - timedelta(minutes=45))
        live = await tournament(admin, game, f"Abnahme Cup live ({stamp})", start, **CUP_FIELDS)
        await register(admin, live, users["players"])
        await admin.call("POST", f"/api/tournaments/{live['id']}/bracket/from-format?preview=true", json=CUP_STRUCTURE)
        await stations(admin, live, 4)
        await admin.call("POST", f"/api/tournaments/{live['id']}/staff", json={"user_id": users["lead"]["id"], "role": "organizer"})
        await admin.call("POST", f"/api/tournaments/{live['id']}/status", json={"status": "check_in"})
        await db.tournament_registrations.update_many({"tournament_id": live["id"]}, {"$set": {"status": "checked_in"}})
        await db.tournaments.update_one({"id": live["id"]}, {"$set": {"check_in_until": (now_utc() - timedelta(minutes=1)).isoformat()}})
        await scheduler._safe_status_transitions()
        plan = await admin.call("POST", f"/api/tournaments/{live['id']}/schedule/plan")
        if plan.get("mode") == "stations":
            await admin.call("POST", f"/api/tournaments/{live['id']}/schedule/apply",
                             json={"fingerprint": plan["fingerprint"], "planned_at": plan["planned_at"]})
        current = await admin.call("GET", f"/api/tournaments/{live['id']}?include_draft=true")
        if current.get("status") != "live":
            await admin.call("POST", f"/api/tournaments/{live['id']}/status", json={"status": "live", "force": True})
        by_key = await matches_of(admin, live["id"])
        for key in ("A", "B"):
            if key in by_key:
                await result(admin, by_key[key])
        by_key = await matches_of(admin, live["id"])
        running = by_key.get("C")
        if running and running.get("station_id"):
            await admin.call("POST", f"/api/stations/{running['station_id']}/assign/{running['id']}?start_now=true")
        state["tournaments"]["local_live"] = live["id"]

        # Online-Abend: K.-o., 8 Spieler, läuft seit 10 Minuten, ein Ergebnis.
        online = await tournament(admin, game, f"Abnahme Online-Abend ({stamp})", now_utc() - timedelta(minutes=10),
                                  format="single_elim", event_mode="online", schedule_mode="player_proposal", max_participants=8)
        await register(admin, online, users["players"][:8])
        await admin.call("POST", f"/api/tournaments/{online['id']}/bracket/from-format?preview=false")
        await admin.call("POST", f"/api/tournaments/{online['id']}/status", json={"status": "live", "force": True})
        first = sorted((await matches_of(admin, online["id"])).values(), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))
        if first:
            await result(admin, first[0])
        state["tournaments"]["online"] = online["id"]

        # Liga online: 6 Spieler, Spielwochen.
        league = await tournament(admin, game, f"Abnahme Liga ({stamp})", quarter(now_utc() - timedelta(days=8)),
                                  format="league", event_mode="online", schedule_mode="player_proposal", max_participants=6,
                                  matchday_days=7, default_match_weekday=6, default_match_time="20:00")
        await register(admin, league, users["players"][:6])
        await admin.call("POST", f"/api/tournaments/{league['id']}/bracket/from-format?preview=false")
        await admin.call("POST", f"/api/tournaments/{league['id']}/status", json={"status": "live", "force": True})
        state["tournaments"]["league"] = league["id"]

        # Fast Lap mit einer Strecke und Zeiten.
        challenge = await admin.call("POST", "/api/f1/challenges", json={"title": f"Abnahme Fast Lap ({stamp})", "game_id": game["id"],
                                                                         "status": "live", "registration_enabled": False})
        track = await admin.call("POST", f"/api/f1/challenges/{challenge['id']}/tracks", json={"name": "Regenbogen-Boulevard"})
        for index, player in enumerate(users["players"][:8]):
            await admin.call("POST", f"/api/f1/challenges/{challenge['id']}/times",
                             json={"user_id": player["id"], "track_id": track["id"], "time_ms": 92_000 + index * 1_337})
        state["fastlap"] = challenge["id"]
    finally:
        await admin.close()
    print("Konten: Admin, Turnierleitung, Helfer, 16 Spieler. Turniere:", ", ".join(state["tournaments"]))
    print("ABNAHME-STATE " + json.dumps(state, ensure_ascii=False))


if __name__ == "__main__":
    if "--inside" in sys.argv:
        os.chdir("/app")
        asyncio.run(inside_main())
    else:
        sys.exit(host_main())
