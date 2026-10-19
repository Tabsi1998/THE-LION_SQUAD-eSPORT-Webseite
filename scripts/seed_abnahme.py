"""Befüllt den lokalen Abnahme-Stand (docs/entwicklung/abnahme-lokal.md) realistisch - über die echten Routen.

Nur für den Abnahme-Stack `lsw-abnahme` auf diesem Rechner: Testkonten mit Testwerten, keine echten Personen, keine
echten Geheimnisse. Das Skript startet auf dem Rechner und läuft im Backend-Container weiter (dort sind App-Code,
Datenbank und Umgebung). Konten entstehen direkt in der Datenbank (wie in der Flow-Testumgebung, mit Passwort und
Zwei-Faktor), alles andere über die Routen der App, angemeldet wie im Browser:

  * Spiel Mario Kart 8 Deluxe (Grand Prix 12 Min.), 16 Spieler, ein Helfer, die Turnierleitung, ein Admin
  * Vor-Ort-Cup mit Vorschau-Baum (Anmeldung offen): FFA 16, Winner und Loser Bracket, Gegner gemischt, 4 Stationen
  * derselbe Cup nach dem Check-in-Ende: fixer Baum, Plan übernommen, live, zwei Läufe gewertet, einer läuft
  * Online-Turnier (K.-o., 8 Spieler, live, ein Ergebnis) und eine Liga (6 Spieler, Spieltag 1 gespielt)
  * Gruppen-Turnier online (8 Spieler, 2 Gruppen, erste Runde gespielt)
  * Liga beendet und Ergebnisse veröffentlicht, mit geteiltem 1. Platz (drei gleich auf) - für Podest und Sieger-Moment
  * Praxis 14.10. (Fabian): Vor-Ort-Cup OHNE Stationen, einmal mit Vorschau-Baum, einmal nach dem Check-in mit der alten
    Matchplanung (feste Zeiten, LE vor LC, G/LF/Finale 30 Min.) auf einer Station, die danach gelöscht wurde
  * eine Fast Lap mit Strecke und Zeiten
  * Weiterkommen in vier Modi (#1590), je vor Ort und live, Turnierleitung eingeteilt: fester Baum (K.-o. 8, Runde 1
    halb gespielt), Auslosung nach der Runde (K.-o. 8, drei von vier Spielen fertig), Show-Auslosung (FFA 16, drei von
    vier Läufen fertig - der vierte macht die Runde fertig), sofort zufällig (K.-o. 8, noch kein Ergebnis)

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

# Mehrere Stände nebeneinander: eigener Projektname (ABNAHME_PROJECT) und eigene Stand-Datei (ABNAHME_STATE).
PROJECT = os.environ.get("ABNAHME_PROJECT", "lsw-abnahme")
# Der Seed schreibt nur in den Abnahme-Stand: Datenbankname wie in `.env.abnahme.example`, keine Produktion, Adressen nur
# auf diesem Rechner. Zeigen ABNAHME_PROJECT oder der Compose-Ordner auf einen fremden Stack, bricht er ab (s. unten).
ABNAHME_DB_NAME = "tls_abnahme"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
PRODUCTION = {"production", "prod"}
MONGO_HOSTS = {"mongodb", *LOCAL_HOSTS}
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
    target = pathlib.Path(os.environ.get("ABNAHME_STATE") or root / ".local-testing" / "abnahme" / "state.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(state, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for row in completed.stdout.splitlines():
        if not row.startswith(marker):
            print(row)
    print(f"Stand geschrieben: {target}")
    return 0


# ------------------------------------------------------------------------------------------------ im Backend-Container


def mongo_hosts(url: str) -> list[str] | None:
    """Die Hosts einer Mongo-Adresse (auch mehrere, durch Komma) - None, wenn es keine einfache mongodb://-Adresse ist
    (mongodb+srv:// zeigt immer auf einen entfernten Cluster)."""
    if not url.startswith("mongodb://"):
        return None
    hosts = url[len("mongodb://"):].split("/", 1)[0].split("?", 1)[0].rsplit("@", 1)[-1]
    return [entry[1:entry.find("]")] if entry.startswith("[") else entry.split(":", 1)[0] for entry in hosts.split(",")]


def mongo_is_local(url: str) -> bool:
    # Nur der Compose-Dienst „mongodb“ des Abnahme-Stacks oder dieser Rechner (Codex zu #1610).
    hosts = mongo_hosts(url)
    return bool(hosts) and all(host in MONGO_HOSTS for host in hosts)


def abnahme_target_problems(env) -> list[str]:
    """Was dagegen spricht, in diese Umgebung zu schreiben - leer heißt: ein lokaler Abnahme-Stand."""
    from urllib.parse import urlsplit

    problems = []
    if not str(env.get("DB_NAME") or "").startswith(ABNAHME_DB_NAME):
        problems.append(f"Datenbank {env.get('DB_NAME')!r} ist nicht die der Abnahme ({ABNAHME_DB_NAME})")
    if {str(env.get(key) or "").strip().lower() for key in ("APP_ENV", "ENV", "ENVIRONMENT")} & PRODUCTION:
        problems.append("Umgebung ist Produktion")
    # FRONTEND_URL setzt der Abnahme-Stand immer; PUBLIC_BACKEND_URL ist dort nur Build-Argument des Frontends und
    # fehlt im Backend - geprüft wird sie nur, wenn sie gesetzt ist (wie guard_environment im Fast-Lap-Seed).
    for key, required in (("FRONTEND_URL", True), ("PUBLIC_BACKEND_URL", False)):
        value = str(env.get(key) or "")
        if not value and not required:
            continue
        host = urlsplit(value).hostname
        if host not in LOCAL_HOSTS:
            problems.append(f"{key} zeigt auf {host or '(leer)'!r}, nicht auf diesen Rechner")
    if not mongo_is_local(str(env.get("MONGO_URL") or "")):
        problems.append("MONGO_URL zeigt nicht auf die Datenbank des Abnahme-Stacks (Dienst mongodb) oder diesen Rechner")
    return problems


def ensure_abnahme_target(env) -> None:
    """Hart abbrechen, bevor irgendetwas geschrieben wird, wenn das kein lokaler Abnahme-Stand ist."""
    problems = abnahme_target_problems(env)
    if problems:
        raise SystemExit("Seed abgebrochen, das ist kein lokaler Abnahme-Stand: " + "; ".join(problems))


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
    # Begleitperson für den Vor-Ort-Zugang (#1592): Konto ohne Mitgliedschaft, nirgends angemeldet.
    users["guest"] = await upsert("gast", "gast@abnahme.lionsquad.at", "Begleitung Gast", "player", False)
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


async def duel(admin: Session, match: dict, winner: str, loser: str, scores=(3, 1), draw: bool = False):
    """Ein Duell werten: Sieger Platz 1, Verlierer Platz 2 - unentschieden beide Platz 1 mit gleichem Stand."""
    await admin.call("POST", f"/api/matches/{match['id']}/result", json={"results": [
        {"registration_id": winner, "rank": 1, "score": scores[0]},
        {"registration_id": loser, "rank": 1 if draw else 2, "score": scores[0] if draw else scores[1]},
    ]})


def pair(match: dict) -> list:
    return [slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")]


async def play_round(admin: Session, tid: str, round_number: int):
    """Alle offenen Duelle einer Runde: der erste Platz gewinnt, das erste Spiel endet unentschieden."""
    rows = sorted([row for row in (await matches_of(admin, tid)).values() if int(row.get("round") or 0) == round_number],
                  key=lambda row: row.get("match_key") or "")
    for index, match in enumerate(rows):
        players = pair(match)
        if len(players) == 2 and match.get("status") not in {"completed", "forfeit", "bye"}:
            await duel(admin, match, players[0], players[1], scores=(3, index % 3), draw=index == 0)


async def matches_of(admin: Session, tid: str) -> dict:
    rows = await admin.call("GET", f"/api/tournaments/{tid}/matches-v2")
    return {row.get("match_key"): row for row in rows if not row.get("is_preview")}


# Die alte Matchplanung aus der Praxis: Start (Wiener Uhr am Turniertag), eigene Dauer, auf der Station oder nicht.
OLD_PLAN = {"A": ("15:30", None, True), "B": ("15:50", None, True), "C": ("16:10", None, True), "D": ("16:30", None, True),
            "E": ("16:50", None, True), "F": ("17:10", None, True), "LA": ("17:30", None, True), "LB": ("17:50", None, True),
            "G": ("18:10", 30, True), "LD": ("18:50", None, True), "LE": ("19:10", None, True), "LC": ("19:40", None, True),
            "LF": ("19:50", 30, False), "FINAL": ("20:20", 30, True)}


def vienna_on(day: datetime, clock: str) -> str:
    from zoneinfo import ZoneInfo
    hour, minute = (int(part) for part in clock.split(":"))
    local = datetime(day.year, day.month, day.day, hour, minute, tzinfo=ZoneInfo("Europe/Vienna"))
    return local.astimezone(timezone.utc).isoformat()


CUP_STRUCTURE = {"name": "Läufe", "stage_type": "ffa_custom_bracket", "match_type": "ffa",
                 "settings": {"schema": CUP_SCHEMA, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2}}
CUP_FIELDS = {"format": "ffa_custom_bracket", "event_mode": "local", "schedule_mode": "fixed_by_staff",
              "result_entry_mode": "staff_only", "match_buffer_minutes": 8, "match_break_minutes": 5,
              "randomize_advancement_rounds": True}


async def inside_main() -> None:
    ensure_abnahme_target(os.environ)
    sys.path.insert(0, "/app")
    from database import get_db
    from services import scheduler

    db = get_db()
    # Neu befüllen hebt die Sperre gegen Rateversuche bei der Anmeldung auf (nur hier, im geprüften Abnahme-Stand).
    await db.rate_limits.delete_many({"bucket": {"$regex": "^auth:"}})
    users = await ensure_accounts(db)
    admin = await Session.login(ACCOUNTS["admin"]["email"], True)
    state = {"accounts": {key: {"email": ACCOUNTS[key]["email"], "password": TEST_PASSWORD, "totp": TEST_TOTP_SECRET if ACCOUNTS[key]["mfa"] else None}
                          for key in ACCOUNTS}, "tournaments": {}}
    # Spieler 1 (NeonFalke) spielt überall mit: eigene Spiele, „Nur meine“, „Deine Gruppe“, „Du“, Sieger-Moment.
    state["accounts"]["player"] = {"email": "spieler01@abnahme.lionsquad.at", "password": TEST_PASSWORD, "totp": None}
    state["accounts"]["guest"] = {"email": "gast@abnahme.lionsquad.at", "password": TEST_PASSWORD, "totp": None}
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
        await play_round(admin, league["id"], 1)
        state["tournaments"]["league"] = league["id"]

        # Gruppen online: 8 Spieler in 2 Gruppen, erste Runde gespielt - „Deine Gruppe“ für Spieler 1.
        groups = await tournament(admin, game, f"Abnahme Gruppen ({stamp})", now_utc() - timedelta(hours=1),
                                  format="groups", event_mode="online", schedule_mode="player_proposal", max_participants=8)
        await register(admin, groups, users["players"][:8])
        await admin.call("POST", f"/api/tournaments/{groups['id']}/groups/generate", json={"group_count": 2})
        await admin.call("POST", f"/api/tournaments/{groups['id']}/status", json={"status": "live", "force": True})
        await play_round(admin, groups["id"], 1)
        state["tournaments"]["groups"] = groups["id"]

        # Liga beendet, Ergebnisse veröffentlicht: Spieler 1, 2 und 3 schlagen sich im Kreis und je den vierten mit 3:1 -
        # drei teilen sich Platz 1 (Podest mit geteiltem Platz, Sieger-Moment für Spieler 1).
        final = await tournament(admin, game, f"Abnahme Liga beendet ({stamp})", quarter(now_utc() - timedelta(days=30)),
                                 format="league", event_mode="online", schedule_mode="player_proposal", max_participants=4)
        await register(admin, final, users["players"][:4])
        await admin.call("POST", f"/api/tournaments/{final['id']}/bracket/from-format?preview=false")
        await admin.call("POST", f"/api/tournaments/{final['id']}/status", json={"status": "live", "force": True})
        regs = {reg["user_id"]: reg["id"] for reg in await admin.call("GET", f"/api/tournaments/{final['id']}/registrations")}
        one, two, three, four = (regs[player["id"]] for player in users["players"][:4])
        beats = {frozenset((one, two)): one, frozenset((two, three)): two, frozenset((three, one)): three}
        for match in (await matches_of(admin, final["id"])).values():
            players = pair(match)
            if len(players) != 2:
                continue
            winner = beats.get(frozenset(players)) or next(reg for reg in players if reg != four)
            await duel(admin, match, winner, next(reg for reg in players if reg != winner), scores=(3, 1))
        for status in ("completed", "results_published"):
            await admin.call("POST", f"/api/tournaments/{final['id']}/status", json={"status": status, "force": True})
        state["tournaments"]["league_published"] = final["id"]

        # Praxis 14.10.: Vor-Ort-Cup ohne Stationen - Vorschau-Baum.
        nostation = {**CUP_FIELDS, "match_buffer_minutes": None, "match_duration_minutes": 20}
        bare_draft = await tournament(admin, game, f"Abnahme Cup ohne Stationen, Vorschau ({stamp})",
                                      quarter(now_utc() + timedelta(days=17)), **nostation)
        await register(admin, bare_draft, users["players"])
        await admin.call("POST", f"/api/tournaments/{bare_draft['id']}/bracket/from-format?preview=true", json=CUP_STRUCTURE)
        await admin.call("POST", f"/api/tournaments/{bare_draft['id']}/staff", json={"user_id": users["lead"]["id"], "role": "organizer"})
        state["tournaments"]["practice_draft"] = bare_draft["id"]

        # ... und nach dem Check-in: Baum fix, die alte Matchplanung auf „Station A“ gespeichert, die Station danach gelöscht.
        # Zweimal: einmal zum Ansehen, einmal zum Lösen und Neuplanen in der Abnahme (verändert den Stand).
        day = quarter(now_utc() + timedelta(days=17))
        for key, label in (("practice_old_plan", "alte Planung"), ("practice_release", "alte Planung zum Lösen")):
            practice = await tournament(admin, game, f"Abnahme Cup {label} ({stamp})", datetime.fromisoformat(vienna_on(day, "15:30")), **nostation)
            await register(admin, practice, users["players"])
            await admin.call("POST", f"/api/tournaments/{practice['id']}/bracket/from-format?preview=false", json=CUP_STRUCTURE)
            await admin.call("POST", f"/api/tournaments/{practice['id']}/staff", json={"user_id": users["lead"]["id"], "role": "organizer"})
            old_station = await admin.call("POST", "/api/stations", json={"name": "Station A", "device_type": "switch", "tournament_id": practice["id"]})
            practice_matches = await matches_of(admin, practice["id"])
            for match_key, (clock, minutes, on_station) in OLD_PLAN.items():
                await admin.call("PATCH", f"/api/matches/{practice_matches[match_key]['id']}", json={
                    "scheduled_at": vienna_on(day, clock), "station_id": old_station["id"] if on_station else None, "duration_minutes": minutes})
            # Altdaten wie vor #1611 herstellen: das Station-Dokument direkt entfernen, die Spiele behalten ihre station_id (die
            # Route lehnt das Löschen ab, solange geplante Spiele daran hängen).
            await db.stations.delete_one({"id": old_station["id"]})
            state["tournaments"][key] = practice["id"]

        # Weiterkommen in vier Modi (#1590): je ein Vor-Ort-Turnier, live, zwei Stationen, geplant, Turnierleitung eingeteilt.
        # K.-o. mit 8 (fest, nach der Runde, sofort) bzw. FFA 16 mit Winner und Loser Bracket (Show), Minuten der
        # Show-Erinnerung 3, damit die Restzeit in der Abnahme sichtbar bleibt.
        modes = (("fixed", "Fester Baum", "single_elim", 2), ("draw_round", "Auslosung nach der Runde", "single_elim", 3),
                 ("draw_show", "Show-Auslosung", "ffa_custom_bracket", 3), ("instant", "Sofort zufällig", "single_elim", 0))
        for mode, label, fmt, played in modes:
            ffa = fmt == "ffa_custom_bracket"
            fields = {"format": fmt, "event_mode": "local", "schedule_mode": "fixed_by_staff", "result_entry_mode": "staff_only",
                      "advancement_mode": mode, "draw_show_minutes": 3, "match_duration_minutes": 12,
                      "max_participants": 16 if ffa else 8}
            cup = await tournament(admin, game, f"Abnahme {label} ({stamp})", quarter(now_utc() - timedelta(minutes=30)), **fields)
            await register(admin, cup, users["players"] if ffa else users["players"][:8])
            if ffa:
                await admin.call("POST", f"/api/tournaments/{cup['id']}/bracket/from-format?preview=false", json=CUP_STRUCTURE)
            else:
                await admin.call("POST", f"/api/tournaments/{cup['id']}/bracket/from-format?preview=false")
            await admin.call("POST", f"/api/tournaments/{cup['id']}/staff", json={"user_id": users["lead"]["id"], "role": "organizer"})
            await stations(admin, cup, 2)
            await admin.call("POST", f"/api/tournaments/{cup['id']}/status", json={"status": "live", "force": True})
            mode_plan = await admin.call("POST", f"/api/tournaments/{cup['id']}/schedule/plan")
            if mode_plan.get("mode") == "stations":
                await admin.call("POST", f"/api/tournaments/{cup['id']}/schedule/apply",
                                 json={"fingerprint": mode_plan["fingerprint"], "planned_at": mode_plan["planned_at"]})
            first_round = sorted((row for row in (await matches_of(admin, cup["id"])).values()
                                  if int(row.get("round") or 0) == 1 and str(row.get("section") or "WB").upper() == "WB"),
                                 key=lambda row: row.get("match_key") or "")
            for match in first_round[:played]:
                await result(admin, match)
            state["tournaments"][f"mode_{mode}"] = cup["id"]

        # Druckansicht (#1283): ein Event morgen mit Einlass und Anmeldeliste (Begleitung, Warteliste, einer schon da) und
        # daran ein Doppel-K.-o. mit 16 Duellen (Winner, Loser, Grand Final), live, geplant, die ersten Spiele gespielt.
        event_start = quarter(now_utc() + timedelta(days=1))
        event = await admin.call("POST", "/api/events", json={
            "name": f"Abnahme Event Druck ({stamp})", "status": "registration_open", "visibility": "public", "has_registration": True,
            "allow_companions": True, "max_companions_per_registration": 2, "max_participants": 3,
            "start_date": event_start.isoformat(), "end_date": (event_start + timedelta(hours=10)).isoformat(),
            "door_time": (event_start - timedelta(minutes=30)).isoformat()})
        for index, player in enumerate(users["players"][1:5]):
            visitor = await Session.login(player["email"], False)
            try:
                await visitor.call("POST", f"/api/events/{event['id']}/registrations", json={"companion_count": 1 if index == 0 else 0})
            finally:
                await visitor.close()
        lead_view = await admin.call("GET", f"/api/events/{event['id']}/lead", params={"filter": "all"})
        first = next(row for row in lead_view["registrations"] if row["status"] == "registered")
        await admin.call("PATCH", f"/api/events/{event['id']}/registrations/{first['id']}", json={"status": "checked_in"})
        double = await tournament(admin, game, f"Abnahme Doppel-K.-o. ({stamp})", event_start + timedelta(hours=1),
                                  format="double_elim", event_mode="local", schedule_mode="fixed_by_staff", result_entry_mode="staff_only",
                                  match_duration_minutes=12, event_id=event["id"],
                                  check_in_from=(event_start + timedelta(minutes=15)).isoformat())
        await register(admin, double, users["players"])
        await admin.call("POST", f"/api/tournaments/{double['id']}/bracket/from-format?preview=false")
        await admin.call("POST", f"/api/tournaments/{double['id']}/staff", json={"user_id": users["lead"]["id"], "role": "organizer"})
        await admin.call("POST", f"/api/tournaments/{double['id']}/staff", json={"user_id": users["helper"]["id"], "role": "stream_operator"})
        await stations(admin, double, 4)
        await admin.call("POST", f"/api/tournaments/{double['id']}/status", json={"status": "live", "force": True})
        double_plan = await admin.call("POST", f"/api/tournaments/{double['id']}/schedule/plan")
        if double_plan.get("mode") == "stations":
            await admin.call("POST", f"/api/tournaments/{double['id']}/schedule/apply",
                             json={"fingerprint": double_plan["fingerprint"], "planned_at": double_plan["planned_at"]})
        opening = sorted((row for row in (await matches_of(admin, double["id"])).values()
                          if int(row.get("round") or 0) == 1 and str(row.get("section") or "WB").upper() == "WB"),
                         key=lambda row: row.get("match_key") or "")
        for match in opening[:3]:
            await result(admin, match)
        state["tournaments"]["print_double"] = double["id"]
        state["print_event"] = {"id": event["id"], "slug": event.get("slug")}

        # Fast Lap mit einer Strecke und Zeiten.
        challenge = await admin.call("POST", "/api/f1/challenges", json={"title": f"Abnahme Fast Lap ({stamp})", "game_id": game["id"],
                                                                         "status": "live", "registration_enabled": False})
        track = await admin.call("POST", f"/api/f1/challenges/{challenge['id']}/tracks", json={"name": "Regenbogen-Boulevard"})
        for index, player in enumerate(users["players"][:8]):
            await admin.call("POST", f"/api/f1/challenges/{challenge['id']}/times",
                             json={"user_id": player["id"], "track_id": track["id"], "time_ms": 92_000 + index * 1_337})
        state["fastlap"] = challenge["id"]

        # Vor-Ort-Zugang (#1592): Mitglieder-Turnier vor Ort, Anmeldung offen - das Zeitfenster läuft.
        members_cup = await tournament(admin, game, f"Abnahme Mitglieder-Cup vor Ort ({stamp})", quarter(now_utc() + timedelta(hours=3)),
                                       format="single_elim", event_mode="local", visibility="members", max_participants=8,
                                       registration_open_from=(now_utc() - timedelta(hours=1)).isoformat(),
                                       end_date=(now_utc() + timedelta(hours=10)).isoformat())
        await register(admin, members_cup, users["players"][:3])
        state["tournaments"]["onsite_members"] = members_cup["id"]
    finally:
        await admin.close()
    slugs = {}
    for key, tid in state["tournaments"].items():
        slugs[key] = (await db.tournaments.find_one({"id": tid}, {"_id": 0, "slug": 1}) or {}).get("slug")
    state["slugs"] = slugs
    print("Konten: Admin, Turnierleitung, Helfer, 16 Spieler. Turniere:", ", ".join(state["tournaments"]))
    print("ABNAHME-STATE " + json.dumps(state, ensure_ascii=False))


if __name__ == "__main__":
    if "--inside" in sys.argv:
        os.chdir("/app")
        asyncio.run(inside_main())
    else:
        sys.exit(host_main())
