"""Testwelt der Liga-Gesamtabnahme G.1 (#1632, docs/liga/abnahme.md) - direkt auf dem Rechner, ohne Docker-Stand.

Läuft gegen das Backend aus ``scripts/run_liga_g1.sh`` (uvicorn, ``G1_API``) und dessen MongoDB. Legt je Lauf neu an,
alles mit einem Lauf-Kürzel im Namen, damit ein zweiter Lauf auf derselben Datenbank nie auf alte Daten trifft:

  * Leitung: Superadmin, zwei Liga-Leitungen (Bereich Ligen), eine befangene Liga-Leitung (spielt selbst im ersten
    Co-Team), eine Turnierleitung ohne Bereich Ligen - alle mit Zwei-Faktor
  * 16 erfundene Hauptteams mit Teamleitung und je einem Co-Team (Captain, Vertreter, zwei Spieler), ein Spieler ohne Team
  * das Spiel (noch ohne Modi und Maps - die stellt die Spec ein, Szenario 2)

Liga, Season, Staffel, Anmeldung und alles Weitere entstehen in der Spec über die echte API. Konten und Teams schreibt
der Seed direkt in die Datenbank (wie ``seed_abnahme_liga.py``), Co-Teams über die Route. Nur synthetische Namen.

Passwort und Zwei-Faktor-Geheimnis entstehen bei jedem Lauf neu und stehen nur in der Stand-Datei (``G1_STATE``,
nicht im Repo). Die Zeit-Helfer der Spec (kein Warten in Echtzeit, es gibt keine einstellbare Uhr im Testbetrieb):

    python scripts/seed_liga_g1.py --job deadlines --tournament <id> --minutes 20   # Fristen-Job „jetzt + 20 Minuten“
    python scripts/seed_liga_g1.py --job veto --tournament <id> --minutes 2          # Veto-Zeitüberschreitung
    python scripts/seed_liga_g1.py --job age --tournament <id> --days 3              # Ergebnisse „vor 3 Tagen“ bestätigt
    python scripts/seed_liga_g1.py --job legacy --season <id>                        # Season ohne neue Felder (Altdaten)

Die Antwort eines Jobs steht als JSON in der letzten Zeile.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import pathlib
import secrets
import sys
from datetime import datetime, timedelta, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from seed_abnahme_liga import guard_environment  # noqa: E402

G1_DB_PREFIX = "tls_abnahme_g1"
DOMAIN = "abnahme.lionsquad.at"
# Erfundene Hauptteams: Name und Kürzel-Stamm. Spielernamen aus Stamm und Endung - keine echten Personen.
TEAMS = ["Nebelwölfe", "Sturmvögel", "Glutfüchse", "Frostluchse", "Donnerdachse", "Schattenraben", "Steinböcke",
         "Blitzmarder", "Eisotter", "Moorkatzen", "Talfalken", "Felsadler", "Waldkäuze", "Sandwiesel", "Gipfelgämsen",
         "Flussbiber"]
ENDINGS = ["Leitung", "Echo", "Funke", "Kante", "Pixel"]
STAFF = {
    "admin": ("Abnahme Admin", "superadmin", None),
    "lead": ("Abnahme Ligaleitung", "tournament_admin", ["leagues"]),
    "lead2": ("Abnahme Zweitleitung", "tournament_admin", ["leagues"]),
    "biased": ("Abnahme Befangen", "tournament_admin", ["leagues"]),
    "tournament": ("Abnahme Turnierleitung", "tournament_admin", None),
}


def guard(env) -> None:
    """Wie im Abnahme-Seed (lokal, keine Produktion) - und nur die eigene Datenbank der G.1-Abnahme."""
    guard_environment(env)
    if not str(env.get("DB_NAME") or "").startswith(G1_DB_PREFIX):
        raise SystemExit(f"Abbruch: DB_NAME muss mit {G1_DB_PREFIX} beginnen.")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Session:
    def __init__(self, client):
        self.client = client

    @classmethod
    async def login(cls, email: str, password: str, totp_secret: str | None):
        import httpx
        from services.totp import current_totp

        client = httpx.AsyncClient(base_url=os.environ.get("G1_API", "http://127.0.0.1:8011"), timeout=60)
        for _ in range(3):
            response = await client.post("/api/auth/login", json={"email": email, "password": password, "remember": True})
            assert response.status_code == 200, f"Anmeldung: {response.status_code}"
            body = response.json()
            if not body.get("mfa_required"):
                return cls(client)
            done = await client.post("/api/auth/mfa/complete", json={"ticket": body["mfa_ticket"], "code": current_totp(totp_secret)})
            if done.status_code == 200:
                return cls(client)
            await asyncio.sleep(31)  # jeder Code zählt einmal
        raise AssertionError("Zwei-Faktor nicht möglich")

    async def call(self, method: str, url: str, expect=(200,), **kwargs):
        token = self.client.cookies.get("csrf_token")
        response = await self.client.request(method, url, headers={"x-csrf-token": token} if token else {}, **kwargs)
        assert response.status_code in expect, f"{method} {url}: {response.status_code} {response.text[:600]}"
        return response.json() if response.content else None

    async def close(self):
        await self.client.aclose()


async def upsert_user(db, run: str, key: str, display_name: str, role: str, password: str, totp_secret: str | None,
                      areas: list[str] | None = None) -> dict:
    from auth import password_fields
    from services.secret_store import encrypt_secret

    stamp = now_iso()
    email = f"g1-{run}-{key}@{DOMAIN}"
    doc = {
        "id": f"g1-{run}-{key}", "email": email, "username": f"g1{run}{key}".replace("-", ""), "display_name": display_name,
        "role": role, "is_active": True, "email_verified": True, "privacy_policy_version": "2026-08-26",
        "terms_version": "2026-08-26", "accepted_privacy": True, "accepted_terms": True, "consent_required": False,
        "consent_updated_at": stamp, "created_at": stamp, "updated_at": stamp, **password_fields(password),
        # Mindestalter neuer Seasons (#2204) - erfundenes Datum. Öffentliches Profil für die Profil-Prüfung (F.4).
        "birth_date": "1990-03-03", "privacy_public_profile": True,
    }
    if areas:
        doc["areas"] = areas
    if totp_secret:
        doc.update({"mfa_enabled": True, "mfa_secret": encrypt_secret(totp_secret), "mfa_recovery_code_hashes": []})
    await db.users.update_one({"email": email}, {"$set": doc}, upsert=True)
    return doc


async def make_team(db, run: str, index: int, name: str, people: list[dict]) -> dict:
    leader = people[0]
    stamp = now_iso()
    team = {"id": f"g1-{run}-team-{index:02d}", "name": f"{name} {run}", "tag": f"G{index:02d}{run[-3:]}".upper(),
            "leader_id": leader["id"], "co_leader_ids": [], "member_ids": [user["id"] for user in people], "is_public": True,
            "created_at": stamp, "updated_at": stamp, "join_code": secrets.token_urlsafe(6),
            "description": "Testteam der Liga-Gesamtabnahme (erfunden)."}
    await db.teams.insert_one(dict(team))
    for user in people:
        await db.team_members.insert_one({"team_id": team["id"], "user_id": user["id"],
                                          "role": "leader" if user is leader else "member", "joined_at": stamp})
    return team


async def seed() -> dict:
    guard(os.environ)
    from database import get_db

    db = get_db()
    await db.rate_limits.delete_many({"bucket": {"$regex": "^auth:"}})
    run = datetime.now(timezone.utc).strftime("%m%d%H%M%S")
    password = secrets.token_urlsafe(18)
    totp_secret = base64.b32encode(secrets.token_bytes(20)).decode("ascii")

    staff = {key: await upsert_user(db, run, key, name, role, password, totp_secret, areas)
             for key, (name, role, areas) in STAFF.items()}
    outsider = await upsert_user(db, run, "aussen", "Ohne Team", "player", password, None)
    teams = []
    for index, name in enumerate(TEAMS):
        stem = name[:5]
        people = [await upsert_user(db, run, f"t{index:02d}-{ending.lower()}", f"{stem}{ending}{index:02d}", "player", password, None)
                  for ending in ENDINGS]
        if index == 0:
            people.append(staff["biased"])  # die befangene Leitung spielt im ersten Co-Team mit
        teams.append((await make_team(db, run, index, name, people), people))

    admin = await Session.login(staff["admin"]["email"], password, totp_secret)
    try:
        game = await admin.call("POST", "/api/games", json={"name": f"Abnahme-Shooter {run}", "slug": f"abnahme-shooter-{run}",
                                                           "platforms": ["pc", "ps5", "xbox"]})
        rows = []
        for (team, people), name in zip(teams, TEAMS):
            roster = people[1:]
            squad = await admin.call("POST", f"/api/teams/{team['id']}/squads", json={
                "name": f"{name} Co", "game_id": game["id"], "member_ids": [user["id"] for user in roster],
                "captain_id": roster[0]["id"], "vice_captain_id": roster[1]["id"],
                "description": "Co-Team der Liga-Gesamtabnahme (erfunden)."})
            rows.append({"team_id": team["id"], "team_name": team["name"], "squad_id": squad["id"], "squad_name": squad["name"],
                         "leader": people[0]["id"], "captain": roster[0]["id"], "vice": roster[1]["id"],
                         "members": [user["id"] for user in roster]})
    finally:
        await admin.close()

    accounts = {key: {"email": doc["email"], "password": password, "totp": totp_secret, "id": doc["id"]} for key, doc in staff.items()}
    accounts["outsider"] = {"email": outsider["email"], "password": password, "totp": None, "id": outsider["id"]}
    for index, (_team, people) in enumerate(teams):
        for role, user in (("captain", people[1]), ("vice", people[2]), ("member", people[3]), ("leader", people[0])):
            accounts[f"{role}-{index}"] = {"email": user["email"], "password": password, "totp": None, "id": user["id"]}
    return {"run": run, "game": {"id": game["id"], "slug": game["slug"]}, "accounts": accounts, "teams": rows}


async def job(name: str, tournament_id: str | None, season_id: str | None, minutes: float, days: float) -> dict:
    """Zeit-Helfer: der echte Job mit verschobenem „jetzt“ - nur für eine Staffel; oder Ergebnisse zurückdatieren."""
    guard(os.environ)
    from database import get_db
    from models import now_utc

    db = get_db()
    if name == "legacy":
        return await legacy_season(db, season_id)
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "creation_key": 0, "billing": 0})
    if not tournament:
        raise SystemExit("Staffel gibt es hier nicht.")
    later = now_utc() + timedelta(minutes=minutes)
    if name == "deadlines":
        from services import match_deadline_sweep

        async def only_this_staffel(*_args, **_kwargs):
            return [tournament] if tournament.get("status") == "live" else []

        match_deadline_sweep.live_tournaments_with = only_this_staffel
        return await match_deadline_sweep.sweep(db, now=later)
    if name == "veto":
        from services import league_veto_sweep

        return await league_veto_sweep.sweep(db, [tournament], now=later)
    # „age“: die Testzeit läuft für diese Staffel um ``days`` Tage weiter - Protest- und Einspruchsfristen (48 h) gegen
    # Ergebnisse, Entscheidungen und Strafen sind dann vorbei, wie nach einer echten Spielwoche. Nur Zeitstempel, keine
    # Ergebnisse, keine Entscheidungen.
    shift = timedelta(days=days)

    def earlier(value):
        if isinstance(value, str) and value:
            return (datetime.fromisoformat(value.replace("Z", "+00:00")) - shift).isoformat()
        return value

    moved = 0
    async for row in db.matches_v2.find({"tournament_id": tournament_id, "status": {"$in": ["completed", "forfeit"]}},
                                         {"_id": 0, "id": 1, "completed_at": 1, "result_meta": 1, "disputes": 1}):
        update = {}
        for path, value in (("completed_at", row.get("completed_at")),
                            ("result_meta.confirmed_at", (row.get("result_meta") or {}).get("confirmed_at"))):
            if isinstance(value, str) and value:
                update[path] = earlier(value)
        for position, entry in enumerate(row.get("disputes") or []):
            if isinstance(entry, dict) and entry.get("appeal_until"):
                update[f"disputes.{position}.appeal_until"] = earlier(entry["appeal_until"])
        if update:
            await db.matches_v2.update_one({"id": row["id"]}, {"$set": update})
            moved += 1
    sanctions = 0
    async for row in db.competition_sanctions.find({"tournament_id": tournament_id, "appeal_until": {"$type": "string"}},
                                                    {"_id": 0, "id": 1, "appeal_until": 1}):
        await db.competition_sanctions.update_one({"id": row["id"]}, {"$set": {"appeal_until": earlier(row["appeal_until"])}})
        sanctions += 1
    return {"aged": moved, "sanctions": sanctions}


# Felder, die erst mit dem Liga-Masterplan (#2211) dazukamen. Eine Season von davor hat sie nicht - so sieht der Altbestand
# aus, den die Abnahme lesen und bespielen muss (docs/LIGA.md: „Ohne Feld verhält sich alles wie heute“).
LEGACY_UNSET = ["lineup_mode", "lineup_min_players", "min_age", "new_player_wait_days", "one_team_per_season", "unique_game_ids",
                "checkin_rules", "veto_rules", "veto_presets", "scores_required", "result_rules", "scoring_rules",
                "protest_hours", "statement_hours", "protest_target_hours", "protest_escalate_hours", "appeal_hours",
                "moss_upload_hours", "evidence_keep_days", "contested_result_mode", "protest_reasons", "rewards", "reward_players",
                "schedule_rules", "reminder_rules", "entry_policy", "sibling_squads_in_staffel", "application_waitlist",
                "application_auto_accept"]


async def legacy_season(db, season_id: str | None) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0, "id": 1})
    if not season:
        raise SystemExit("Season gibt es hier nicht.")
    unset = {key: "" for key in LEGACY_UNSET}
    result = await db.league_seasons.update_one({"id": season_id}, {"$unset": unset})
    staffeln = await db.tournaments.update_many({"league_context.season_id": season_id}, {"$unset": unset})
    return {"season": result.modified_count, "staffeln": staffeln.modified_count}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", choices=("deadlines", "veto", "age", "legacy"))
    parser.add_argument("--tournament")
    parser.add_argument("--season")
    parser.add_argument("--minutes", type=float, default=0.0)
    parser.add_argument("--days", type=float, default=0.0)
    args = parser.parse_args()
    os.chdir(ROOT / "backend")
    if args.job:
        print(json.dumps(asyncio.run(job(args.job, args.tournament, args.season, args.minutes, args.days)), ensure_ascii=False, default=str))
        return 0
    state = asyncio.run(seed())
    target = pathlib.Path(os.environ.get("G1_STATE") or ROOT / ".local-testing" / "liga-g1" / "state.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(state, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"G.1-Testwelt angelegt (Lauf {state['run']}): {len(state['teams'])} Co-Teams. Stand: {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
