"""Mitspieler für den Probelauf (#1635): spielt Spieler, Helfer und Fahrer - Schritt für Schritt, auf Befehl.

Drehbuch: ``docs/entwicklung/probelauf.md``. Die Turnierleitung (Fabian) bedient Web, Handy und TV selbst; dieses Skript
übernimmt die übrigen Rollen über die echten Routen, angemeldet wie im Browser - jede Phase einzeln, damit man live sieht,
was passiert:

  aufbau        Event „Probelauf“ mit Probelauf-Cup (vor Ort, nur Mitglieder, FFA 16 mit Winner und Loser Bracket,
                Show-Auslosung, 4 Stationen), Sofort-Cup (K.-o. 8, sofort zufällig, schon live) und Fast Lap (zwei
                Simulatoren); Turnierleitung und Helfer eingeteilt
  anmelden      15 Spieler scannen den Vor-Ort-QR-Code und melden sich an (Platz 16 ist für die Begleitperson am Handy
                der Turnierleitung); ``--warteliste``: danach kommt Spieler 16 - der Cup ist voll, Warteliste
  gast          die Begleitperson über den QR-Code - nur, falls das Handy nicht mitspielt
  checkin       der Helfer am Einlass checkt die ersten 8 ein (``--alle``: alle Bestätigten außer dem, der nicht kommt)
  checkin-ende  Check-in-Ende wie am Abend: die Zeit „Check-in endet“ ist um, der Server macht den Baum fest
  station       der Helfer ruft an freien Stationen auf und startet (``--anzahl``, ``--nur-aufrufen``)
  ergebnisse    der Helfer trägt die Ergebnisse laufender Spiele ein (``--anzahl``)
  spielen       Stationen und Ergebnisse im Kreis, bis nichts mehr bereit ist - etwa bis zur nächsten Show-Auslosung
  fristen       die Fristen prüfen wie der Server am Abend jede Minute („nicht erschienen“ vorschlagen, „Ergebnis
                fehlt“) - im Abnahme-Stand laufen diese Jobs nicht von selbst
  melden        ein Spieler meldet im Online-Abend des Seeds ein Ergebnis; die Gegenseite bestätigt am Handy
  fastlap       der Helfer am Simulator 2: Fahrer in die Liste, an den Start, Zeit eintragen; der letzte fährt Bestzeit
  stand         Überblick: Status, Anmeldungen, Spiele, Stationen

Aufruf (Abnahme-Stand läuft und ist mit ``scripts/seed_abnahme.py`` befüllt):

    python scripts/probelauf_mitspieler.py aufbau
    python scripts/probelauf_mitspieler.py spielen --anzahl 4
    python scripts/probelauf_mitspieler.py spielen --turnier sofort

Nur gegen einen lokalen Abnahme-Stand: der Projektname muss mit ``lsw-abnahme`` beginnen, und im Container bricht das
Skript vor jedem Schreiben ab, wenn Datenbank, Umgebung oder Adressen nicht die eines lokalen Abnahme-Stands sind (wie
``seed_abnahme.py``). Konten und Testwerte kommen aus ``seed_abnahme.py``; Passwörter, Codes und Cookies erscheinen nie in
der Ausgabe. Kennungen (keine Zugänge) stehen in ``.local-testing/abnahme/probelauf-<Projekt>.json`` (nicht im Repo).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import pathlib
import random
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

PROJECT = os.environ.get("ABNAHME_PROJECT", "lsw-abnahme")
# lsw-abnahme, lsw-abnahme-2, lsw-abnahme-1635 … - nie der Stack der Website selbst.
PROJECT_PATTERN = re.compile(r"^lsw-abnahme(-[a-z0-9][a-z0-9-]*)?$")
PHASES = ("aufbau", "anmelden", "gast", "checkin", "checkin-ende", "station", "ergebnisse", "spielen", "fristen",
          "melden", "fastlap", "stand")
MARKER = "PROBELAUF-STATE "

# Wie seed_abnahme.py: nur die Datenbank der Abnahme, keine Produktion, Adressen nur auf diesem Rechner.
ABNAHME_DB_NAME = "tls_abnahme"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
PRODUCTION = {"production", "prod"}
MONGO_HOSTS = {"mongodb", *LOCAL_HOSTS}

# Testkonten aus scripts/seed_abnahme.py. Passwort und Zwei-Faktor-Geheimnis stehen nur dort: der Rechner liest sie aus
# dem Seed und reicht sie als Umgebung an den Container (nie auf der Befehlszeile, nie in der Ausgabe).
ADMIN = "admin@abnahme.lionsquad.at"
LEAD = "turnierleitung@abnahme.lionsquad.at"
HELPER = "helfer@abnahme.lionsquad.at"
GUEST = "gast@abnahme.lionsquad.at"
PLAYER = "spieler{:02d}@abnahme.lionsquad.at"
# Spieler 15 kommt nicht (Turnierleitung setzt „Nicht erschienen“), Spieler 16 rückt von der Warteliste nach.
NO_SHOW = 15
WAITLIST = 16

CUP_SCHEMA = """[WB]
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
E=[W:A:1,W:A:2,W:B:1,W:B:2]
F=[W:C:1,W:C:2,W:D:1,W:D:2]
G=[W:E:1,W:E:2,W:F:1,W:F:2]

[LB]
LA=[L:A:1,L:A:2,L:B:1,L:B:2]
LB=[L:C:1,L:C:2,L:D:1,L:D:2]
LC=[W:LA:1,W:LA:2,L:E:1,L:E:2]
LD=[W:LB:1,W:LB:2,L:F:1,L:F:2]
LE=[W:LC:1,W:LC:2,W:LD:1,W:LD:2]
LF=[W:LE:1,W:LE:2,L:G:1,L:G:2]

[FINAL]
FINAL=[W:G:1,W:G:2,W:LF:1,W:LF:2]"""
# Check-in erst in 20 Minuten (Durchlauf 2, 20.10.): bis dahin ist Phase 2 durch, und die Turnierleitung startet den
# Check-in in Phase 3 selbst - wie am Abend, wenn die Gruppe früher da ist.
CHECK_IN_OPENS_MINUTES = 20
# Gewinne für Platz 1 bis 3 (Testwerte): Phase 13 prüft, dass beim Veröffentlichen die Gewinne angelegt werden.
CUP_PRIZES = [
    {"group": "overall", "place": 1, "label": "1. Platz", "value": "Pokal (Probelauf)"},
    {"group": "overall", "place": 2, "label": "2. Platz", "value": "Medaille (Probelauf)"},
    {"group": "overall", "place": 3, "label": "3. Platz", "value": "Urkunde (Probelauf)"},
]
CUP_STRUCTURE = {"name": "Läufe", "stage_type": "ffa_custom_bracket", "match_type": "ffa",
                 "settings": {"schema": CUP_SCHEMA, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2}}
DONE = {"completed", "forfeit", "bye", "cancelled"}
STATUS_TEXT = {"pending": "Ausstehend", "approved": "Bestätigt", "waitlist": "Warteliste", "checked_in": "Eingecheckt",
               "no_show": "Nicht erschienen", "rejected": "Abgelehnt", "withdrawn": "Ausgetreten", "disqualified": "Disqualifiziert"}


# ---------------------------------------------------------------------------------------------------- auf dem Rechner

def project_problem(name: str) -> str | None:
    """Warum dieser Projektname kein lokaler Abnahme-Stand ist - None, wenn er passt."""
    if not PROJECT_PATTERN.match(name or ""):
        return f"Projekt {name!r} ist kein Abnahme-Stand (erwartet lsw-abnahme oder lsw-abnahme-<name>)"
    return None


def seed_credentials(root: pathlib.Path) -> tuple[str, str]:
    """Passwort und Zwei-Faktor-Geheimnis der Testkonten - aus seed_abnahme.py, damit es nur eine Quelle gibt."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("seed_abnahme", root / "scripts" / "seed_abnahme.py")
    seed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(seed)
    return seed.TEST_PASSWORD, seed.TEST_TOTP_SECRET


def state_path(root: pathlib.Path) -> pathlib.Path:
    return pathlib.Path(os.environ.get("PROBELAUF_STATE_FILE") or root / ".local-testing" / "abnahme" / f"probelauf-{PROJECT}.json")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mitspieler für den Probelauf (docs/entwicklung/probelauf.md)")
    parser.add_argument("phase", choices=PHASES)
    parser.add_argument("--anzahl", type=int, default=0, help="höchstens so viele (Spiele, Spieler, Fahrer)")
    parser.add_argument("--turnier", default="cup", help="cup (Probelauf-Cup) oder sofort (Sofort-Cup)")
    parser.add_argument("--alle", action="store_true", help="checkin: alle Bestätigten außer dem, der nicht kommt")
    parser.add_argument("--nur-aufrufen", action="store_true", help="station: nur aufrufen, nicht starten")
    parser.add_argument("--warteliste", action="store_true", help="anmelden: nur Spieler 16 (landet auf der Warteliste)")
    return parser.parse_args(argv)


def host_main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = parse_args(argv)
    problem = project_problem(PROJECT)
    if problem:
        print(f"Abbruch: {problem}.", file=sys.stderr)
        return 2
    root = pathlib.Path(__file__).resolve().parents[1]
    target = state_path(root)
    state = json.loads(target.read_text(encoding="utf-8")) if target.exists() else {}
    if args.phase != "aufbau" and not state:
        print(f"Kein Probelauf-Stand in {target} - zuerst: python scripts/probelauf_mitspieler.py aufbau", file=sys.stderr)
        return 2
    compose_dir = pathlib.Path(os.environ.get("ABNAHME_COMPOSE_DIR") or root)
    compose = ["docker", "compose", "-p", PROJECT, "--env-file", str(compose_dir / ".env.abnahme.example"),
               "-f", str(compose_dir / "docker-compose.yml"), "-f", str(compose_dir / "docker-compose.abnahme.yml")]
    password, totp_secret = seed_credentials(root)
    env = {**os.environ, "PROBELAUF_ARGS": json.dumps(vars(args)), "PROBELAUF_STATE": json.dumps(state),
           "PROBELAUF_PASSWORD": password, "PROBELAUF_TOTP": totp_secret}
    source = pathlib.Path(__file__).read_text(encoding="utf-8")
    process = subprocess.Popen(
        [*compose, "exec", "-T", "-e", "PROBELAUF_ARGS", "-e", "PROBELAUF_STATE", "-e", "PROBELAUF_PASSWORD", "-e", "PROBELAUF_TOTP",
         "backend", "python", "-", "--inside"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
        cwd=compose_dir, env=env)
    process.stdin.write(source)
    process.stdin.close()
    new_state = None
    for line in process.stdout:
        if line.startswith(MARKER):
            new_state = json.loads(line[len(MARKER):])
        else:
            print(line, end="", flush=True)
    code = process.wait()
    if new_state is not None:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(new_state, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return code


# ------------------------------------------------------------------------------------------------ im Backend-Container


def mongo_hosts(url: str) -> list[str] | None:
    if not url.startswith("mongodb://"):
        return None
    hosts = url[len("mongodb://"):].split("/", 1)[0].split("?", 1)[0].rsplit("@", 1)[-1]
    return [entry[1:entry.find("]")] if entry.startswith("[") else entry.split(":", 1)[0] for entry in hosts.split(",")]


def abnahme_target_problems(env) -> list[str]:
    """Was dagegen spricht, in diese Umgebung zu schreiben - leer heißt: ein lokaler Abnahme-Stand."""
    problems = []
    if not str(env.get("DB_NAME") or "").startswith(ABNAHME_DB_NAME):
        problems.append("Datenbank ist nicht die der Abnahme")
    if {str(env.get(key) or "").strip().lower() for key in ("APP_ENV", "ENV", "ENVIRONMENT")} & PRODUCTION:
        problems.append("Umgebung ist Produktion")
    for key, required in (("FRONTEND_URL", True), ("PUBLIC_BACKEND_URL", False)):
        value = str(env.get(key) or "")
        if not value and not required:
            continue
        if (urlsplit(value).hostname or "") not in LOCAL_HOSTS:
            problems.append(f"{key} zeigt nicht auf diesen Rechner")
    hosts = mongo_hosts(str(env.get("MONGO_URL") or ""))
    if not hosts or not all(host in MONGO_HOSTS for host in hosts):
        problems.append("MONGO_URL zeigt nicht auf die Datenbank des Abnahme-Stacks")
    return problems


def ensure_abnahme_target(env) -> None:
    problems = abnahme_target_problems(env)
    if problems:
        raise SystemExit("Probelauf abgebrochen, das ist kein lokaler Abnahme-Stand: " + "; ".join(problems))


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def quarter(moment: datetime) -> datetime:
    moment = moment.replace(second=0, microsecond=0)
    return moment - timedelta(minutes=moment.minute % 15)


def say(text: str) -> None:
    print(text, flush=True)


SESSION_CACHE = pathlib.Path("/tmp/probelauf-sitzungen.json")
AUTH_COOKIES = ("access_token", "refresh_token", "csrf_token")


class Session:
    """Ein angemeldeter Browser. Die Sitzung bleibt im Container gemerkt (nur dort), damit nicht jede Phase neu anmeldet -
    jede Zwei-Faktor-Anmeldung verbraucht ein 30-Sekunden-Fenster."""

    def __init__(self, client, email: str):
        self.client = client
        self.email = email

    @classmethod
    async def open(cls, email: str):
        import httpx

        client = httpx.AsyncClient(base_url="http://127.0.0.1:8001", timeout=60)
        cache = _read_cache()
        for name, value in (cache.get(email) or {}).items():
            client.cookies.set(name, value)
        if cache.get(email):
            me = await client.get("/api/auth/me")
            if me.status_code == 200 and ((me.json() or {}).get("email") or "").lower() == email:
                return cls(client, email)
            client.cookies.clear()
        await _login(client, email)
        cache[email] = {name: client.cookies.get(name) for name in AUTH_COOKIES if client.cookies.get(name)}
        SESSION_CACHE.write_text(json.dumps(cache), encoding="utf-8")
        return cls(client, email)

    async def call(self, method: str, url: str, expect=(200,), **kwargs):
        token = self.client.cookies.get("csrf_token")
        response = await self.client.request(method, url, headers={"x-csrf-token": token} if token else {}, **kwargs)
        if response.status_code not in expect:
            raise PhaseError(f"{method} {url.split('?')[0]}: {response.status_code} {response.text[:400]}")
        return response.json() if response.content else None

    async def close(self):
        await self.client.aclose()


class PhaseError(RuntimeError):
    pass


def _read_cache() -> dict:
    try:
        return json.loads(SESSION_CACHE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


async def _login(client, email: str) -> None:
    from services.totp import current_totp

    for _ in range(4):
        response = await client.post("/api/auth/login", json={"email": email, "password": os.environ["PROBELAUF_PASSWORD"], "remember": True})
        if response.status_code == 429:
            await asyncio.sleep(_retry_seconds(response.text))
            continue
        if response.status_code != 200:
            raise PhaseError(f"Anmeldung {email}: {response.status_code} - ist der Stand mit seed_abnahme.py befüllt?")
        body = response.json()
        if not body.get("mfa_required"):
            return
        done = await client.post("/api/auth/mfa/complete", json={"ticket": body["mfa_ticket"], "code": current_totp(os.environ["PROBELAUF_TOTP"])})
        if done.status_code == 200:
            return
        # Jeder Code zählt einmal: im selben 30-Sekunden-Fenster auf den nächsten warten.
        await asyncio.sleep(_retry_seconds(done.text) if done.status_code == 429 else 31)
    raise PhaseError(f"Anmeldung {email} nicht möglich")


def _retry_seconds(text: str) -> int:
    match = re.search(r"(\d+) Sekunden", text or "")
    return int(match.group(1)) + 2 if match else 31


class Context:
    def __init__(self, db, args: dict, state: dict):
        self.db = db
        self.args = args
        self.state = state
        self.sessions: dict[str, Session] = {}

    async def as_(self, email: str) -> Session:
        if email not in self.sessions:
            self.sessions[email] = await Session.open(email)
        return self.sessions[email]

    async def close(self):
        for session in self.sessions.values():
            await session.close()

    async def user(self, email: str) -> dict:
        user = await self.db.users.find_one({"email": email}, {"_id": 0, "id": 1, "display_name": 1, "email": 1})
        if not user:
            raise PhaseError(f"Konto {email} fehlt - zuerst python scripts/seed_abnahme.py")
        return user

    def tid(self) -> str:
        key = {"cup": "cup", "sofort": "instant"}.get(self.args.get("turnier") or "cup", self.args.get("turnier"))
        tid = (self.state.get("tournaments") or {}).get(key)
        if not tid:
            raise PhaseError(f"Turnier {self.args.get('turnier')!r} unbekannt - zuerst die Phase aufbau")
        return tid

    def limit(self, default: int) -> int:
        return int(self.args.get("anzahl") or 0) or default


async def matches_of(session: Session, tid: str) -> list[dict]:
    rows = await session.call("GET", f"/api/tournaments/{tid}/matches-v2")
    return [row for row in rows if not row.get("is_preview")]


def seated(match: dict) -> list[str]:
    return [slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")]


async def registration_names(ctx: Context, tid: str) -> dict:
    rows = await ctx.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0, "id": 1, "display_name": 1}).to_list(500)
    return {row["id"]: row.get("display_name") or "?" for row in rows}


# ------------------------------------------------------------------------------------------------------------ Phasen


def cup_settings(now: datetime, game_id: str, stamp: str) -> dict:
    """Der Probelauf-Cup wie am Abend: vor Ort, nur für Mitglieder (Begleitpersonen über den QR-Code), 16 Plätze, Läufe
    zu viert, Show-Auslosung, Gewinne für Platz 1 bis 3. Start in 45 Minuten (Anmeldung und Check-in davor), Check-in ab
    in 20 Minuten, „nicht erschienen“ nach 3 statt 10 Minuten. Liegt der echte Start später, stellt die Turnierleitung
    vor dem Planen den Turnierstart um."""
    return {
        "title": f"Probelauf-Cup ({stamp})", "game_id": game_id, "status": "registration_open",
        "start_date": quarter(now + timedelta(minutes=55)).isoformat(), "end_date": (now + timedelta(hours=7)).isoformat(),
        "registration_open_from": (now - timedelta(hours=1)).isoformat(),
        "check_in_from": (now + timedelta(minutes=CHECK_IN_OPENS_MINUTES)).isoformat(),
        "max_participants": 16, "visibility": "members", "format": "ffa_custom_bracket", "event_mode": "local",
        "schedule_mode": "fixed_by_staff", "result_entry_mode": "staff_only", "match_break_minutes": 5,
        "advancement_mode": "draw_show", "draw_show_minutes": 3, "no_show_minutes_on_site": 3,
        "prize_places": [dict(prize) for prize in CUP_PRIZES],
    }


async def phase_aufbau(ctx: Context) -> None:
    game = await ctx.db.games.find_one({"slug": "abnahme-mario-kart-8"}, {"_id": 0, "id": 1})
    if not game:
        raise PhaseError("Spiel der Abnahme fehlt - zuerst python scripts/seed_abnahme.py")
    lead, helper = await ctx.user(LEAD), await ctx.user(HELPER)
    admin = await ctx.as_(ADMIN)
    now = now_utc()
    from zoneinfo import ZoneInfo
    stamp = now.astimezone(ZoneInfo("Europe/Vienna")).strftime("%d.%m. %H:%M")
    event = await admin.call("POST", "/api/events", json={
        "name": f"Probelauf ({stamp})", "status": "live", "visibility": "public", "location": "Vereinsheim (Probelauf)",
        "start_date": (now - timedelta(hours=1)).isoformat(), "end_date": (now + timedelta(hours=8)).isoformat()})
    cup = await admin.call("POST", f"/api/events/{event['id']}/tournaments", json=cup_settings(now, game["id"], stamp))
    await admin.call("POST", f"/api/tournaments/{cup['id']}/bracket/from-format?preview=true", json=CUP_STRUCTURE)
    for index in range(1, 5):
        await admin.call("POST", "/api/stations", json={"name": f"Station {index}", "device_type": "switch2", "tournament_id": cup["id"]})
    await admin.call("POST", f"/api/tournaments/{cup['id']}/staff", json={"user_id": lead["id"], "role": "organizer"})
    await admin.call("POST", f"/api/tournaments/{cup['id']}/staff", json={"user_id": helper["id"], "role": "referee"})

    # Sofort zufällig: K.-o. 8, schon live und geplant - jedes Ergebnis setzt den Sieger sofort auf einen freien Platz.
    instant = await admin.call("POST", f"/api/events/{event['id']}/tournaments", json={
        "title": f"Sofort-Cup ({stamp})", "game_id": game["id"], "status": "registration_open",
        "start_date": quarter(now).isoformat(), "end_date": (now + timedelta(hours=7)).isoformat(), "max_participants": 8,
        "format": "single_elim", "event_mode": "local", "schedule_mode": "fixed_by_staff", "result_entry_mode": "staff_only",
        "advancement_mode": "instant", "match_duration_minutes": 12})
    for seed, number in enumerate(range(1, 9), start=1):
        player = await ctx.user(PLAYER.format(number))
        await admin.call("POST", f"/api/tournaments/{instant['id']}/registrations",
                         json={"user_id": player["id"], "display_name": player["display_name"], "status": "approved", "seed": seed})
    await admin.call("POST", f"/api/tournaments/{instant['id']}/bracket/from-format?preview=false")
    for index in (5, 6):
        await admin.call("POST", "/api/stations", json={"name": f"Station {index}", "device_type": "switch2", "tournament_id": instant["id"]})
    await admin.call("POST", f"/api/tournaments/{instant['id']}/staff", json={"user_id": lead["id"], "role": "organizer"})
    await admin.call("POST", f"/api/tournaments/{instant['id']}/staff", json={"user_id": helper["id"], "role": "referee"})
    await admin.call("POST", f"/api/tournaments/{instant['id']}/status", json={"status": "live", "force": True})
    plan = await admin.call("POST", f"/api/tournaments/{instant['id']}/schedule/plan")
    if plan.get("mode") == "stations":
        await admin.call("POST", f"/api/tournaments/{instant['id']}/schedule/apply",
                         json={"fingerprint": plan["fingerprint"], "planned_at": plan["planned_at"]})

    # Fast Lap im Event: zwei Simulatoren, 3 Versuche, der Helfer im Fast-Lap-Team.
    for name in ("Simulator 1", "Simulator 2"):
        await admin.call("POST", "/api/stations", json={"name": name, "device_type": "racing_rig", "event_id": event["id"]})
    challenge = await admin.call("POST", f"/api/events/{event['id']}/fastlaps", json={
        "title": f"Probelauf Fast Lap ({stamp})", "status": "live", "visibility": "public", "max_attempts": 3,
        "prize_places": [{"place": 1, "label": "1. Platz", "value": "Pokal"}],
        "start_date": (now - timedelta(hours=1)).isoformat(), "end_date": (now + timedelta(hours=8)).isoformat()})
    await admin.call("PATCH", f"/api/f1/challenges/{challenge['id']}", json={"status": "live"})
    track = await admin.call("POST", f"/api/f1/challenges/{challenge['id']}/tracks", json={"name": "Spielberg", "country": "Österreich", "order_index": 0})
    await admin.call("POST", f"/api/f1/challenges/{challenge['id']}/staff", json={"user_id": helper["id"], "role": "scorekeeper"})
    await admin.call("POST", f"/api/f1/challenges/{challenge['id']}/staff", json={"user_id": lead["id"], "role": "scorekeeper"})

    slugs = {}
    for key, doc in (("cup", cup), ("instant", instant)):
        slugs[key] = (await ctx.db.tournaments.find_one({"id": doc["id"]}, {"_id": 0, "slug": 1}) or {}).get("slug")
    ctx.state = {"event": event["id"], "event_slug": event.get("slug"), "tournaments": {"cup": cup["id"], "instant": instant["id"]},
                 "slugs": slugs, "fastlap": {"id": challenge["id"], "slug": challenge.get("slug"), "track": track["id"]},
                 "created_at": now.isoformat()}
    say(f"Event „Probelauf ({stamp})“ angelegt.")
    say(f"  Probelauf-Cup: /tournaments/{slugs['cup']}  (Verwaltung: /admin/tournaments/{cup['id']})")
    say(f"  Sofort-Cup:    /tournaments/{slugs['instant']}  (live, 4 Spiele bereit)")
    say(f"  Fast Lap:      /fastlap/{challenge.get('slug') or challenge['id']}  (TV: /display/f1/{challenge['id']})")
    say(f"  Event:         /events/{event.get('slug') or event['id']}  (Aufruf-Tafel: /display/event/{event['id']}/calls)")


async def onsite_token(ctx: Context, tid: str) -> str:
    access = await (await ctx.as_(ADMIN)).call("GET", f"/api/tournaments/{tid}/onsite-access")
    if not access.get("enabled") or not access.get("open_now"):
        raise PhaseError("Der Vor-Ort-Zugang ist aus oder gilt gerade nicht (Kasten „Vor-Ort-Anmeldung über QR“).")
    return access["path"].split("#", 1)[1]


async def scan_and_register(ctx: Context, email: str, tid: str, token: str) -> dict:
    """Wie am Handy: QR-Code scannen (der Code bleibt außerhalb jeder Adresse), dann „Mitspielen“."""
    session = await ctx.as_(email)
    await session.call("POST", "/api/tournaments/onsite/redeem", json={"token": token})
    return await session.call("POST", f"/api/tournaments/{tid}/register", expect=(200, 400, 409),
                              json={"accept_rules": True, "accept_privacy": True})


async def phase_anmelden(ctx: Context) -> None:
    tid = ctx.tid()
    token = await onsite_token(ctx, tid)
    # Spieler 1 bis 15 (oder die ersten --anzahl); mit --warteliste nur Spieler 16 - nach der Begleitperson ist der Cup
    # voll, er landet auf der Warteliste.
    numbers = [WAITLIST] if ctx.args.get("warteliste") else list(range(1, NO_SHOW + 1))[: ctx.limit(NO_SHOW)]
    for number in numbers:
        player = await ctx.user(PLAYER.format(number))
        reg = await scan_and_register(ctx, player["email"], tid, token)
        status = (reg or {}).get("status") or (reg or {}).get("detail") or "?"
        say(f"  {player['display_name']:<16} {STATUS_TEXT.get(status, status)}")
    say(f"Anmeldungen: {await registration_counts(ctx, tid)}")
    taken = await ctx.db.tournament_registrations.count_documents({"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}})
    if taken < 16:
        say(f"Frei: {16 - taken} - ein Platz ist für die Begleitperson (Handy der Turnierleitung, QR-Code am Aushang).")


async def phase_gast(ctx: Context) -> None:
    tid = ctx.tid()
    reg = await scan_and_register(ctx, GUEST, tid, await onsite_token(ctx, tid))
    status = (reg or {}).get('status') or (reg or {}).get('detail')
    say(f"Begleitperson: {STATUS_TEXT.get(status, status)}")


async def registration_counts(ctx: Context, tid: str) -> str:
    counts: dict[str, int] = {}
    async for row in ctx.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0, "status": 1}):
        counts[row.get("status")] = counts.get(row.get("status"), 0) + 1
    return ", ".join(f"{STATUS_TEXT.get(key, key)} {value}" for key, value in sorted(counts.items(), key=lambda item: str(item[0])))


async def phase_checkin(ctx: Context) -> None:
    tid = ctx.tid()
    status = (await ctx.db.tournaments.find_one({"id": tid}, {"_id": 0, "status": 1}) or {}).get("status")
    if status != "check_in":
        raise PhaseError(f"Der Cup steht auf {status!r} - erst „Check-in starten“ (Turnierleitung).")
    helper = await ctx.as_(HELPER)
    no_show = (await ctx.user(PLAYER.format(NO_SHOW)))["id"]
    rows = await helper.call("GET", f"/api/tournaments/{tid}/registrations")
    approved = sorted((row for row in rows if row.get("status") == "approved" and row.get("user_id") != no_show),
                      key=lambda row: row.get("created_at") or "")
    chosen = approved if ctx.args.get("alle") else approved[: ctx.limit(8)]
    for row in chosen:
        await helper.call("POST", f"/api/tournaments/{tid}/registrations/{row['id']}/checkin", json={"status": "checked_in"})
        say(f"  eingecheckt: {row.get('display_name')}")
    say(f"Anmeldungen: {await registration_counts(ctx, tid)}")


async def phase_checkin_ende(ctx: Context) -> None:
    """Am Abend schließt der Server den Check-in zur Zeit „Check-in endet“ von selbst. Im Abnahme-Stand läuft dieser Job
    nicht (nur result_holds und draw_show) - darum stößt ihn das Skript an, genau einmal."""
    from services import scheduler

    tid = ctx.tid()
    tournament = await ctx.db.tournaments.find_one({"id": tid}, {"_id": 0, "status": 1, "check_in_until": 1})
    if tournament.get("status") != "check_in":
        raise PhaseError(f"Der Cup steht auf {tournament.get('status')!r} - erst „Check-in starten“.")
    until = tournament.get("check_in_until")
    moment = datetime.fromisoformat(str(until).replace("Z", "+00:00")) if until else None
    if moment and moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    if not moment or moment > now_utc():
        await ctx.db.tournaments.update_one({"id": tid}, {"$set": {"check_in_until": (now_utc() - timedelta(minutes=1)).isoformat()}})
        say("„Check-in endet“ war nicht gesetzt oder liegt in der Zukunft - jetzt auf vor einer Minute gesetzt.")
    await scheduler._close_due_checkins(ctx.db, datetime.now(timezone.utc))
    real = await ctx.db.matches_v2.count_documents({"tournament_id": tid, "is_preview": {"$ne": True}})
    names = await registration_names(ctx, tid)
    say(f"Check-in zu: {real} Spiele im festen Baum. Anmeldungen: {await registration_counts(ctx, tid)}")
    for match in sorted(await ctx.db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}, "round": 1,
                                                       "section": {"$in": ["WB", "wb", None]}}, {"_id": 0}).to_list(50),
                        key=lambda row: row.get("match_key") or ""):
        say(f"  {match.get('match_key')}: {', '.join(names.get(reg, '?') for reg in seated(match))}")


async def queue_of(session: Session, tid: str) -> dict:
    return await session.call("GET", f"/api/tournaments/{tid}/live-queue")


async def call_and_start(ctx: Context, tid: str, budget: int, start: bool = True) -> int:
    helper = await ctx.as_(HELPER)
    queue = await queue_of(helper, tid)
    if not queue.get("applies"):
        raise PhaseError(f"Keine Warteschlange: {queue.get('reason')}")
    done = 0
    for station in queue.get("stations") or []:
        if done >= budget:
            break
        nxt = station.get("next")
        if station.get("running") or not nxt or not nxt.get("ready") or station.get("status") == "broken":
            continue
        body = {"station_id": station["id"], "match_id": nxt["match_id"]}
        if nxt.get("state") != "called":
            await helper.call("POST", f"/api/tournaments/{tid}/live-queue/call", json=body)
        if start:
            await helper.call("POST", f"/api/tournaments/{tid}/live-queue/start", json=body)
        say(f"  {station['name']}: {nxt.get('label')} {'gestartet' if start else 'aufgerufen'} ({', '.join(nxt.get('names') or [])})")
        done += 1
    return done


async def enter_results(ctx: Context, tid: str, budget: int) -> int:
    helper = await ctx.as_(HELPER)
    names = await registration_names(ctx, tid)
    # Laufend und ohne Ergebnis in der Ablage („Rückgängig“ läuft noch) - direkt aus der Datenbank gelesen.
    running = await ctx.db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}, "started_at": {"$nin": [None, ""]},
                                            "status": {"$nin": list(DONE)}, "pending_result": None}, {"_id": 0}).to_list(100)
    entered = []
    for match in sorted(running, key=lambda row: row.get("started_at") or "")[:budget]:
        order = seated(match)
        random.Random(match["id"]).shuffle(order)
        await helper.call("POST", f"/api/matches/{match['id']}/result", json={
            "results": [{"registration_id": reg, "rank": index + 1, "score": max(0, 15 - 3 * index)} for index, reg in enumerate(order)]})
        say(f"  Ergebnis {match.get('match_key')}: {' > '.join(names.get(reg, '?') for reg in order)}")
        entered.append(match["id"])
    if entered:
        # Zehn Sekunden „Rückgängig“, dann veröffentlicht der Server - erst danach rückt der Baum weiter.
        for _ in range(30):
            rows = {row["id"]: row for row in await matches_of(helper, tid)}
            if all(rows.get(mid, {}).get("status") in DONE for mid in entered):
                break
            await asyncio.sleep(2)
        else:
            say("  Achtung: nach 60 Sekunden ist noch nicht jedes Ergebnis veröffentlicht.")
    return len(entered)


async def phase_station(ctx: Context) -> None:
    count = await call_and_start(ctx, ctx.tid(), ctx.limit(99), start=not ctx.args.get("nur_aufrufen"))
    say(f"{count} Spiel(e) {'aufgerufen' if ctx.args.get('nur_aufrufen') else 'aufgerufen und gestartet'}.")


async def phase_ergebnisse(ctx: Context) -> None:
    count = await enter_results(ctx, ctx.tid(), ctx.limit(99))
    say(f"{count} Ergebnis(se) eingetragen." if count else "Kein laufendes Spiel ohne Ergebnis.")


async def phase_spielen(ctx: Context) -> None:
    tid = ctx.tid()
    budget = ctx.limit(99)
    played = 0
    stuck = False
    while played < budget:
        await call_and_start(ctx, tid, budget - played)
        count = await enter_results(ctx, tid, budget - played)
        if not count:
            stuck = True
            break
        played += count
    status = (await ctx.db.tournaments.find_one({"id": tid}, {"_id": 0, "status": 1}) or {}).get("status")
    left = await ctx.db.matches_v2.count_documents({"tournament_id": tid, "is_preview": {"$ne": True}, "status": {"$nin": list(DONE)}})
    say(f"{played} Spiel(e) gespielt. Offen: {left}. Status: {status}.")
    if left and stuck:
        say("Nichts mehr bereit: wartet auf die Show-Auslosung, einen Aufruf der Turnierleitung oder ein offenes Ergebnis.")


async def phase_fristen(ctx: Context) -> None:
    """Am Abend prüft der Server jede Minute die Fristen im Spiel (Job match_deadlines); der Abnahme-Stand lässt ihn aus
    (nur result_holds und draw_show). Hier genau einmal mit denselben Bausteinen wie services/match_deadline_sweep.sweep -
    aber nur für die Turniere des Probelaufs, sonst bekäme die Turnierleitung Vorschläge aus allen Seed-Turnieren."""
    from services import match_deadline_sweep as deadlines

    now = now_utc()
    proposed = 0
    for tid in (ctx.state.get("tournaments") or {}).values():
        tournament = await ctx.db.tournaments.find_one({"id": tid, "status": "live"}, {"_id": 0, "creation_key": 0, "billing": 0})
        if not tournament:
            continue
        stages = {row["id"]: row for row in await ctx.db.tournament_stages.find({"tournament_id": tid}, {"_id": 0}).to_list(50)}
        matches = await ctx.db.matches_v2.find({"tournament_id": tid, "status": {"$in": deadlines.SWEEP_STATUSES},
                                                "is_preview": {"$ne": True}}, {"_id": 0}).to_list(500)
        for match in matches:
            info = deadlines.no_show_deadline(match, tournament, stages.get(match.get("stage_id") or ""))
            if info and info["due_at"] <= now and not match.get("no_show_proposal"):
                proposed += await deadlines._propose_no_show(ctx.db, tournament, match, info, now)
    say(f"Fristen geprüft: {proposed} neue(r) Vorschlag/Vorschläge „nicht erschienen“.")
    if proposed:
        say("Turnierleitung: Reiter „Braucht Aufmerksamkeit“ - „<Name> nicht erschienen“ oder „+5 Min. verlängern“.")


async def phase_melden(ctx: Context) -> None:
    """Online-Abend aus seed_abnahme.py: ein Spieler meldet, die Gegenseite bestätigt am Handy („Stimmt“)."""
    tid = (await ctx.db.tournaments.find_one(
        {"title": {"$regex": "^Abnahme Online-Abend"}, "status": "live"}, {"_id": 0, "id": 1}, sort=[("created_at", -1)]) or {}).get("id")
    if not tid:
        raise PhaseError("Kein Online-Abend aus seed_abnahme.py gefunden")
    matches = await ctx.db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}, "status": {"$nin": list(DONE)}},
                                           {"_id": 0}).to_list(50)
    open_pair = next((row for row in sorted(matches, key=lambda row: row.get("match_key") or "") if len(seated(row)) == 2), None)
    if not open_pair:
        raise PhaseError("Im Online-Abend ist kein Duell offen")
    regs = {row["id"]: row for row in await ctx.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(50)}
    one, two = (regs[reg] for reg in seated(open_pair))
    reporter = await ctx.db.users.find_one({"id": one["user_id"]}, {"_id": 0, "email": 1})
    other = await ctx.db.users.find_one({"id": two["user_id"]}, {"_id": 0, "email": 1, "display_name": 1})
    session = await ctx.as_(reporter["email"])
    await session.call("POST", f"/api/matches/{open_pair['id']}/report", json={
        "results": [{"registration_id": one["id"], "rank": 1, "score": 3}, {"registration_id": two["id"], "rank": 2, "score": 1}],
        "note": "Probelauf: Meldung vom Skript"})
    slug = (await ctx.db.tournaments.find_one({"id": tid}, {"_id": 0, "slug": 1}) or {}).get("slug")
    say(f"{one.get('display_name')} meldet 3:1 gegen {two.get('display_name')} ({open_pair.get('match_key')}).")
    say(f"Bestätigen am Handy als {other.get('display_name')} ({other.get('email')}): /matches/{open_pair['id']}"
        f"  (Turnier /tournaments/{slug})")


async def phase_fastlap(ctx: Context) -> None:
    fastlap = ctx.state.get("fastlap") or {}
    cid, track = fastlap.get("id"), fastlap.get("track")
    if not cid:
        raise PhaseError("Keine Fast Lap im Probelauf-Stand - zuerst die Phase aufbau")
    helper = await ctx.as_(HELPER)
    rows = await helper.call("GET", f"/api/f1/challenges/{cid}/times")
    rows = rows.get("items", rows) if isinstance(rows, dict) else rows
    valid = [row.get("time_ms") for row in rows or [] if row.get("time_ms") and not row.get("is_invalid")]
    best = min(valid) if valid else 84_000
    round_no = len(fastlap.get("guests") or []) + 1
    guest = await helper.call("POST", f"/api/f1/challenges/{cid}/guests", json={"display_name": f"Gast Probelauf {round_no}"})
    fastlap.setdefault("guests", []).append(guest["id"])
    drivers = [{"user_id": (await ctx.user(PLAYER.format(number)))["id"]} for number in (9, 10)] + [{"guest_id": guest["id"]}]
    drivers = drivers[: ctx.limit(3)]
    for index, who in enumerate(drivers):
        entry = await helper.call("POST", f"/api/f1/challenges/{cid}/queue", json={**who, "track_id": track, "station": "Simulator 2"})
        await helper.call("POST", f"/api/f1/queue/{entry['id']}/start", json={"station": "Simulator 2"})
        name = entry.get("name") or entry.get("display_name") or ("Gast" if "guest_id" in who else "Fahrer")
        say(f"  Am Start an Simulator 2: {name}")
        await asyncio.sleep(8)
        last = index == len(drivers) - 1
        time_ms = best - 412 if last else best + 900 + 650 * index
        await helper.call("POST", f"/api/f1/challenges/{cid}/times", json={**who, "track_id": track, "time_ms": time_ms})
        await helper.call("DELETE", f"/api/f1/queue/{entry['id']}")
        minutes, rest = divmod(time_ms, 60_000)
        say(f"  Zeit {minutes}:{rest / 1000:06.3f}{'  - neue Bestzeit' if last else ''}")
        await asyncio.sleep(4)
    ctx.state["fastlap"] = fastlap


async def phase_stand(ctx: Context) -> None:
    for key, tid in (ctx.state.get("tournaments") or {}).items():
        doc = await ctx.db.tournaments.find_one({"id": tid}, {"_id": 0, "title": 1, "status": 1})
        if not doc:
            continue
        counts: dict[str, int] = {}
        async for row in ctx.db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}}, {"_id": 0, "status": 1}):
            counts[row.get("status")] = counts.get(row.get("status"), 0) + 1
        say(f"{doc['title']}: {doc['status']} · Anmeldungen {await registration_counts(ctx, tid)} · Spiele {counts or '-'}")
        if doc["status"] in {"live", "paused"}:
            queue = await queue_of(await ctx.as_(HELPER), tid)
            for station in queue.get("stations") or []:
                running = (station.get("running") or {}).get("label") or "-"
                nxt = station.get("next") or {}
                say(f"  {station['name']}: läuft {running} · als Nächstes {nxt.get('label') or '-'} ({nxt.get('state') or '-'})")


PHASE_FUNCTIONS = {"aufbau": phase_aufbau, "anmelden": phase_anmelden, "gast": phase_gast, "checkin": phase_checkin,
                   "checkin-ende": phase_checkin_ende, "station": phase_station, "ergebnisse": phase_ergebnisse,
                   "spielen": phase_spielen, "fristen": phase_fristen, "melden": phase_melden, "fastlap": phase_fastlap, "stand": phase_stand}


async def inside_main() -> int:
    ensure_abnahme_target(os.environ)
    sys.path.insert(0, "/app")
    from database import get_db

    args = json.loads(os.environ.get("PROBELAUF_ARGS") or "{}")
    ctx = Context(get_db(), args, json.loads(os.environ.get("PROBELAUF_STATE") or "{}"))
    code = 0
    try:
        await PHASE_FUNCTIONS[args["phase"]](ctx)
    except PhaseError as exc:
        say(f"Abbruch in Phase {args['phase']}: {exc}")
        code = 1
    finally:
        await ctx.close()
    print(MARKER + json.dumps(ctx.state, ensure_ascii=False), flush=True)
    return code


if __name__ == "__main__":
    if "--inside" in sys.argv:
        os.chdir("/app")
        sys.exit(asyncio.run(inside_main()))
    sys.exit(host_main(sys.argv[1:]))
