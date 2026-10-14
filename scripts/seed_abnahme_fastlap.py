"""Befüllt einen lokalen Abnahme-Stand mit Fast Lap vor Ort (#1585) - über die echten Routen.

Nur für einen lokalen Abnahme-Stack (docs/entwicklung/abnahme-lokal.md, eingeführt mit #1605): Testkonten mit
Testwerten, keine echten Personen. Läuft wie ``scripts/seed_abnahme.py`` auf dem Rechner und im Backend-Container
weiter. Legt an:

  * Admin, Turnierleitung (beide mit Zwei-Faktor), Helfer, sechs Spieler
  * ein Event „Abnahme LAN“ mit zwei Simulatoren als Stationen
  * die Fast Lap „vor Ort“ im Event (live, 3 Versuche, Preis für Platz 1), der Helfer im Fast-Lap-Team, Zeiten von
    vier Spielern und zwei Gästen („Anna K.“, „Lena 🏎️“), dazu „Am Start / Als Nächstes“
  * eine zweite Fast Lap „zum Veröffentlichen“ (live, ein Gast auf Platz 1, Preis für Platz 1)

Aufruf (Stack läuft; Projektname und Stand-Datei wie bei seed_abnahme.py über ABNAHME_PROJECT/ABNAHME_STATE):

    python scripts/seed_abnahme_fastlap.py

Die Compose-Dateien des Abnahme-Stands liegen im Ordner aus ABNAHME_COMPOSE_DIR (Vorgabe: dieser Repo-Ordner).
Schreibt Kennungen und Zugänge nach ``.local-testing/abnahme/state-fastlap.json`` (nicht im Repo).
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import pathlib
import secrets
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

PROJECT = os.environ.get("ABNAHME_PROJECT", "lsw-abnahme")
# Eigene Testkonten (fastlap-…), damit dieser Seed die Zugänge von seed_abnahme.py nie überschreibt. Passwort und
# Zwei-Faktor-Geheimnis entstehen bei jedem Lauf neu und stehen nur in der Stand-Datei (nicht im Repo).
ACCOUNTS = {
    "admin": {"email": "fastlap-admin@abnahme.lionsquad.at", "display_name": "Abnahme Admin", "role": "superadmin", "mfa": True},
    "lead": {"email": "fastlap-leitung@abnahme.lionsquad.at", "display_name": "Abnahme Turnierleitung", "role": "tournament_admin", "mfa": True},
    "helper": {"email": "fastlap-helfer@abnahme.lionsquad.at", "display_name": "Abnahme Helfer", "role": "player", "mfa": False},
}
PLAYERS = ["NeonFalke", "KartKönigin", "LuckyLion", "PixelPaula", "DriftDaniel", "Anna Konto"]


def host_main() -> int:
    root = pathlib.Path(__file__).resolve().parents[1]
    os.environ["ABNAHME_SEED_PASSWORD"] = secrets.token_urlsafe(18)
    os.environ["ABNAHME_SEED_TOTP"] = base64.b32encode(secrets.token_bytes(20)).decode("ascii")
    compose_dir = pathlib.Path(os.environ.get("ABNAHME_COMPOSE_DIR") or root)
    compose = ["docker", "compose", "-p", PROJECT, "--env-file", str(compose_dir / ".env.abnahme.example"),
               "-f", str(compose_dir / "docker-compose.yml"), "-f", str(compose_dir / "docker-compose.abnahme.yml")]
    source = pathlib.Path(__file__).read_text(encoding="utf-8")
    completed = subprocess.run([*compose, "exec", "-T", "-e", "ABNAHME_SEED_PASSWORD", "-e", "ABNAHME_SEED_TOTP", "backend", "python", "-", "--inside"], input=source,
                               text=True, encoding="utf-8", capture_output=True, cwd=compose_dir)
    sys.stderr.write(completed.stderr[-4000:])
    marker = "ABNAHME-STATE "
    line = next((row for row in completed.stdout.splitlines() if row.startswith(marker)), None)
    if completed.returncode != 0 or not line:
        sys.stdout.write(completed.stdout[-4000:])
        return completed.returncode or 1
    target = pathlib.Path(os.environ.get("ABNAHME_STATE") or root / ".local-testing" / "abnahme" / "state-fastlap.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(json.loads(line[len(marker):]), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Stand geschrieben: {target}")
    return 0


# Nur ein lokaler Abnahme-Stand: Datenbank wie in .env.abnahme.example (tls_abnahme, auch mit Zusatz), keine Produktion,
# öffentliche Adressen nur auf diesem Rechner. Sonst bricht der Seed ab, bevor er etwas schreibt (Codex-Prüfung #1598).
ABNAHME_DB_PREFIX = "tls_abnahme"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
PRODUCTION = {"production", "prod"}


def guard_environment(env) -> None:
    problems = []
    if not str(env.get("DB_NAME") or "").startswith(ABNAHME_DB_PREFIX):
        problems.append("Datenbank ist nicht die der Abnahme")
    if {str(env.get(key) or "").strip().lower() for key in ("APP_ENV", "ENV", "ENVIRONMENT")} & PRODUCTION:
        problems.append("Umgebung ist Produktion")
    for key in ("FRONTEND_URL", "PUBLIC_BACKEND_URL"):
        if (urlsplit(str(env.get(key) or "")).hostname or "") not in LOCAL_HOSTS:
            problems.append(f"{key} zeigt nicht auf diesen Rechner")
    if problems:
        raise SystemExit("Abbruch, kein lokaler Abnahme-Stand: " + "; ".join(problems))


def credentials() -> tuple[str, str]:
    return os.environ["ABNAHME_SEED_PASSWORD"], os.environ["ABNAHME_SEED_TOTP"]


class Session:
    def __init__(self, client):
        self.client = client

    @classmethod
    async def login(cls, email: str, mfa: bool):
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
            assert mfa, f"{email} verlangt Zwei-Faktor"
            done = await client.post("/api/auth/mfa/complete", json={"ticket": body["mfa_ticket"], "code": current_totp(totp_secret)})
            if done.status_code == 200:
                return cls(client)
            await asyncio.sleep(31)
        raise AssertionError(f"Zwei-Faktor {email} nicht möglich")

    async def call(self, method: str, url: str, expect=(200,), **kwargs):
        token = self.client.cookies.get("csrf_token")
        response = await self.client.request(method, url, headers={"x-csrf-token": token} if token else {}, **kwargs)
        assert response.status_code in expect, f"{method} {url}: {response.status_code} {response.text[:600]}"
        return response.json() if response.content else None


async def ensure_accounts(db) -> dict:
    from auth import password_fields
    from services.secret_store import encrypt_secret

    stamp = datetime.now(timezone.utc).isoformat()
    password, totp_secret = credentials()

    async def upsert(key: str, email: str, display_name: str, role: str, mfa: bool) -> dict:
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        doc = {
            "id": existing["id"] if existing else f"abnahme-{key}" if key.startswith("fastlap-") else f"abnahme-fastlap-{key}", "email": email, "username": email.split("@")[0],
            "display_name": display_name, "role": role, "is_active": True, "email_verified": True,
            "privacy_policy_version": "2026-08-26", "terms_version": "2026-08-26", "accepted_privacy": True, "accepted_terms": True,
            "consent_required": False, "consent_updated_at": stamp, "created_at": (existing or {}).get("created_at") or stamp,
            "updated_at": stamp, **password_fields(password),
        }
        if mfa:
            doc.update({"mfa_enabled": True, "mfa_secret": encrypt_secret(totp_secret), "mfa_recovery_code_hashes": []})
        await db.users.update_one({"email": email}, {"$set": doc, "$unset": {"mfa_totp_last_counter": ""}}, upsert=True)
        return doc

    users = {key: await upsert(key, a["email"], a["display_name"], a["role"], a["mfa"]) for key, a in ACCOUNTS.items()}
    users["players"] = [await upsert(f"fastlap-spieler-{i:02d}", f"fastlap-spieler{i:02d}@abnahme.lionsquad.at", name, "player", False)
                        for i, name in enumerate(PLAYERS, start=1)]
    return users


async def inside_main() -> None:
    guard_environment(os.environ)
    from database import get_db

    db = get_db()
    users = await ensure_accounts(db)
    admin = await Session.login(ACCOUNTS["admin"]["email"], True)
    lead = await Session.login(ACCOUNTS["lead"]["email"], True)
    stamp = datetime.now(timezone.utc).strftime("%H%M%S")
    start = datetime.now(timezone.utc) - timedelta(hours=1)
    event = await admin.call("POST", "/api/events", json={
        "name": f"Abnahme LAN ({stamp})", "status": "live", "visibility": "public",
        "start_date": start.isoformat(), "end_date": (start + timedelta(hours=10)).isoformat(), "location": "Vereinsheim"})
    stations = [await admin.call("POST", "/api/stations", json={"name": name, "device_type": "racing_rig", "event_id": event["id"]})
                for name in ("Simulator 1", "Simulator 2")]
    players = users["players"]
    challenges = {}
    for key, title in (("onsite", "vor Ort"), ("publish", "zum Veröffentlichen")):
        body = {"title": f"Abnahme Fast Lap {title} ({stamp})", "status": "live", "visibility": "public",
                "prize_places": [{"place": 1, "label": "1. Platz", "value": "Pokal"}],
                "start_date": start.isoformat(), "end_date": (start + timedelta(hours=10)).isoformat()}
        challenge = await admin.call("POST", f"/api/events/{event['id']}/fastlaps", json=body)
        await admin.call("PATCH", f"/api/f1/challenges/{challenge['id']}", json={"status": "live"})
        track = await admin.call("POST", f"/api/f1/challenges/{challenge['id']}/tracks",
                                 json={"name": "Spielberg", "country": "Österreich", "order_index": 0})
        await admin.call("POST", f"/api/f1/challenges/{challenge['id']}/staff", json={"user_id": users["helper"]["id"], "role": "scorekeeper"})
        challenges[key] = {"id": challenge["id"], "slug": challenge.get("slug"), "track": track["id"]}

    onsite = challenges["onsite"]
    for player, ms in zip(players[:4], (81234, 82010, 82845, 84100)):
        await lead.call("POST", f"/api/f1/challenges/{onsite['id']}/times", json={"user_id": player["id"], "track_id": onsite["track"], "time_ms": ms})
    anna = await lead.call("POST", f"/api/f1/challenges/{onsite['id']}/guests", json={"display_name": "Anna K."})
    lena = await lead.call("POST", f"/api/f1/challenges/{onsite['id']}/guests", json={"display_name": "Lena 🏎️"})
    await lead.call("POST", f"/api/f1/challenges/{onsite['id']}/times", json={"guest_id": anna["id"], "track_id": onsite["track"], "time_ms": 83300})
    await lead.call("POST", f"/api/f1/challenges/{onsite['id']}/queue", json={"user_id": players[4]["id"], "track_id": onsite["track"], "station": "Simulator 1"})
    await lead.call("POST", f"/api/f1/challenges/{onsite['id']}/queue", json={"guest_id": lena["id"], "track_id": onsite["track"]})
    await lead.call("POST", f"/api/f1/challenges/{onsite['id']}/queue/next", json={"station": "Simulator 1"})
    await lead.call("POST", f"/api/f1/challenges/{onsite['id']}/queue", json={"user_id": players[1]["id"], "track_id": onsite["track"]})

    pub = challenges["publish"]
    guest = await lead.call("POST", f"/api/f1/challenges/{pub['id']}/guests", json={"display_name": "Schneller Gast"})
    await lead.call("POST", f"/api/f1/challenges/{pub['id']}/times", json={"guest_id": guest["id"], "track_id": pub["track"], "time_ms": 79000})
    await lead.call("POST", f"/api/f1/challenges/{pub['id']}/times", json={"user_id": players[0]["id"], "track_id": pub["track"], "time_ms": 80500})
    await lead.call("POST", f"/api/f1/challenges/{pub['id']}/times", json={"user_id": players[2]["id"], "track_id": pub["track"], "time_ms": 81500})

    password, totp_secret = credentials()
    state = {
        "accounts": {key: {"email": ACCOUNTS[key]["email"], "password": password, "totp": totp_secret if ACCOUNTS[key]["mfa"] else None}
                     for key in ACCOUNTS},
        "players": {p["display_name"]: p["id"] for p in players},
        "event": event["id"], "stations": [s["name"] for s in stations],
        "fastlap": {"onsite": {**onsite, "anna": anna["id"], "lena": lena["id"]}, "publish": {**pub, "guest": guest["id"]}},
    }
    state["accounts"]["player"] = {"email": players[0]["email"], "password": password, "totp": None}
    print("ABNAHME-STATE " + json.dumps(state, ensure_ascii=False))


if __name__ == "__main__":
    if "--inside" in sys.argv:
        os.chdir("/app")
        sys.path.insert(0, "/app")
        asyncio.run(inside_main())
    else:
        sys.exit(host_main())
