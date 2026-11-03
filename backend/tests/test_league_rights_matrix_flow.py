"""Rechte-Matrix der Liga (docs/LIGA.md, Abschnitt 12, #2203): jede Route gegen jede Art von Person.

Die Tabelle ``ROUTES`` ist dieselbe wie im Vertrag. Jede Zeile läuft gegen alle Personen aus ``ACTORS``; erlaubt heißt „der
Wächter lässt durch“ (irgendetwas außer 401 und 403, auch eine fachliche Absage wie 409), verboten heißt 403.
Erfundene Namen.
"""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import world  # noqa: E402
from models import now_utc  # noqa: E402

AREA = "AREA"  # nur der Bereich Ligen
ANY = "ANY"  # jede Zuständigkeit dieser Liga
READ = "READ"  # jede Zuständigkeit und die Helfer mit Lese-Rolle
CAPABILITIES = ("manage", "season", "applications", "roster", "matches", "results", "disputes", "sanctions", "rules")

ACTORS = ("superadmin", "club_admin", "leagues_grant", "cap_right", "cap_other", "other_league", "tournaments_role",
          "tournaments_grant", "helper_organizer", "helper_referee", "helper_scorekeeper", "helper_station", "moderator",
          "player", "no_mfa_area", "no_mfa_cap")
DELETE_BODY = {"reason": "Testfall aufräumen"}
RESULT_BODY = "RESULT"
OVERRIDE_BODY = "OVERRIDE"
FORFEIT_BODY = "FORFEIT"
POOL_BODY = {"modes": [{"mode": "stellung", "map_ids": ["map-hafen"]}]}
RULE_TEXT = {"title": "Regelwerk", "body_md": "# Fairplay\nText", "annexes": []}
RULE_PUBLISH = {"revision": 1, "valid_from": "2030-01-01", "change_reason": "Ein Grund"}


def route(method: str, url: str, needs, body=None):
    return pytest.param(method, url, needs, body, id=f"{method} {url}")


# Die Spalten: Methode, Adresse (mit {league}, {season}, {division}, {tid}, {match}, {user}), Recht, Inhalt.
ROUTES = [
    # Verwaltung der Liga
    route("POST", "/api/admin/leagues", AREA, {"name": "Neue Liga", "game_id": "probe-shooter"}),
    route("GET", "/api/admin/leagues/{league}/delete-plan", AREA),
    route("DELETE", "/api/admin/leagues/{league}", AREA, DELETE_BODY),
    route("PUT", "/api/admin/leagues/{league}/staff/{user}", AREA, {"capabilities": ["results"]}),
    route("DELETE", "/api/admin/leagues/{league}/staff/{user}", AREA),
    route("GET", "/api/admin/leagues/{league}/staff", "manage"),
    route("PATCH", "/api/admin/leagues/{league}", "manage", {"description": "Neu"}),
    route("POST", "/api/admin/leagues/{league}/seasons", "manage", {"name": "Season Neu"}),
    route("GET", "/api/admin/leagues/seasons/{season}/delete-plan", "manage"),
    route("DELETE", "/api/admin/leagues/seasons/{season}", "manage", DELETE_BODY),
    route("GET", "/api/admin/leagues/seasons/{season}", ANY),
    route("PATCH", "/api/admin/leagues/seasons/{season}", "season", {"name": "Season Umbenannt"}),
    route("PATCH", "/api/admin/leagues/seasons/{season}", "rules", {"rules_text": "Neue Regeln"}),
    route("PUT", "/api/admin/leagues/seasons/{season}/map-pool", "season", POOL_BODY),
    route("DELETE", "/api/admin/leagues/seasons/{season}/map-pool", "season"),
    # Maps und Pools (#2207, C.2)
    route("GET", "/api/admin/leagues/seasons/{season}/map-pool/versions", ANY),
    route("GET", "/api/admin/leagues/seasons/{season}/map-pool/compare?base=1&target=1", ANY),
    route("POST", "/api/admin/leagues/seasons/{season}/map-pool/remove-map", "season", {"map_id": "map-hafen", "reason": "Grund genug"}),
    route("GET", "/api/admin/leagues/seasons/{season}/readiness", ANY),
    route("POST", "/api/admin/leagues/seasons/{season}/sync", "season"),
    # Ergebnisregeln (C.3, #1617)
    route("GET", "/api/admin/leagues/seasons/{season}/result-rules", ANY),
    route("PUT", "/api/admin/leagues/seasons/{season}/result-rules", "season", {"scores_required": True, "rules": {}}),
    # Check-in (D.2, #1652): Regeln je Season
    route("GET", "/api/admin/leagues/seasons/{season}/checkin-rules", ANY),
    route("PUT", "/api/admin/leagues/seasons/{season}/checkin-rules", "season", {"min_present": 2}),
    route("POST", "/api/admin/leagues/seasons/{season}/divisions", "season", {"level": 7}),
    route("PATCH", "/api/admin/leagues/divisions/{division}", "season", {"nickname": "Neu"}),
    route("GET", "/api/admin/leagues/divisions/{division}/delete-plan", "season"),
    route("DELETE", "/api/admin/leagues/divisions/{division}", "season", DELETE_BODY),
    route("POST", "/api/admin/leagues/divisions/{division}/staffeln", "season", {}),
    route("DELETE", "/api/admin/leagues/staffeln/{tid}", "season", DELETE_BODY),
    route("GET", "/api/admin/leagues/seasons/{season}/roster", "roster"),
    route("POST", "/api/admin/leagues/seasons/{season}/roster/{user}/approve", "roster", {"reason": "Geprüft"}),
    route("PUT", "/api/admin/leagues/seasons/{season}/roster-settings", "roster", {"roster_deadline": None}),
    # Selbstanmeldung (#2205): Eingang der Leitung
    route("GET", "/api/admin/leagues/seasons/{season}/applications", "applications"),
    route("POST", "/api/admin/leagues/seasons/{season}/applications/nix/review", "applications"),
    route("POST", "/api/admin/leagues/seasons/{season}/applications/nix/accept", "applications", {}),
    route("POST", "/api/admin/leagues/seasons/{season}/applications/nix/reject", "applications", {"reason": "Grund genug"}),
    route("POST", "/api/admin/leagues/seasons/{season}/applications/nix/waitlist", "applications", {}),
    route("POST", "/api/admin/leagues/seasons/{season}/applications/nix/assign", "applications", {"tournament_id": "{tid}"}),
    # Regelwerk (#1646): je Season und liga-weit
    *[entry for target in ("league_season/{season}", "league/{league}") for entry in (
        route("GET", f"/api/admin/league-rules/{target}", "rules"),
        route("PUT", f"/api/admin/league-rules/{target}/draft", "rules", RULE_TEXT),
        route("POST", f"/api/admin/league-rules/{target}/draft/from-version", "rules", {}),
        route("DELETE", f"/api/admin/league-rules/{target}/draft", "rules"),
        route("POST", f"/api/admin/league-rules/{target}/preview", "rules", RULE_TEXT),
        route("POST", f"/api/admin/league-rules/{target}/publish", "rules", RULE_PUBLISH),
    )],
    # Staffel: verwalten
    route("PATCH", "/api/tournaments/{tid}", "manage", {"description": "Neu"}),
    route("POST", "/api/tournaments/{tid}/status", "manage", {"status": "paused"}),
    route("POST", "/api/tournaments/{tid}/lock", "manage"),
    route("POST", "/api/tournaments/{tid}/unlock", "manage"),
    route("PUT", "/api/tournaments/{tid}/pause", "manage", {"paused_until": None}),
    route("PUT", "/api/tournaments/{tid}/round-sponsors", "manage", {"items": []}),
    route("GET", "/api/tournaments/{tid}/onsite-access", "manage"),
    route("PUT", "/api/tournaments/{tid}/onsite-access", "manage", {"enabled": False}),
    route("POST", "/api/tournaments/{tid}/onsite-access/renew", "manage"),
    route("POST", "/api/tournaments/{tid}/staff", "manage", {"user_id": "{user}", "role": "referee"}),
    # Staffel: Aufbau
    route("DELETE", "/api/tournaments/{tid}", "season"),
    route("POST", "/api/tournaments/{tid}/bracket/plan", "season", {}),
    route("POST", "/api/tournaments/{tid}/bracket/apply", "season", {"expected_plan_hash": "0" * 64, "expected_base_structure_hash": "0" * 64}),
    route("POST", "/api/tournaments/{tid}/bracket/from-format", "season", {}),
    route("POST", "/api/tournaments/{tid}/reset-bracket", "season"),
    route("POST", "/api/tournaments/{tid}/stages", "season", {"name": "Neu", "stage_type": "league"}),
    route("POST", "/api/tournaments/{tid}/swiss/next-round", "season"),
    route("POST", "/api/tournaments/{tid}/swiss/undo-round", "season"),
    route("POST", "/api/tournaments/{tid}/groups/generate", "season", {}),
    route("POST", "/api/tournaments/{tid}/heat-rebuild/check", "season"),
    route("GET", "/api/map-pools/tournaments/{tid}/admin", "season"),
    route("PUT", "/api/map-pools/tournaments/{tid}", "season", POOL_BODY),
    route("DELETE", "/api/map-pools/tournaments/{tid}", "season"),
    # Staffel: Teams
    route("GET", "/api/tournaments/{tid}/squad-candidates", "applications"),
    route("POST", "/api/tournaments/{tid}/squad-registrations", "applications", {"team_id": "x", "squad_id": "y"}),
    route("DELETE", "/api/tournaments/{tid}/squad-registrations/{reg}", "applications"),
    route("GET", "/api/tournaments/{tid}/assignable-users", "applications"),
    route("POST", "/api/tournaments/{tid}/registrations", "applications", {"user_id": "{user}"}),
    route("PATCH", "/api/tournaments/{tid}/registrations/{reg}", "applications", {"notes": "Hinweis"}),
    route("DELETE", "/api/tournaments/{tid}/registrations/{reg}", "applications"),
    route("POST", "/api/tournaments/{tid}/registrations/{reg}/removal", "applications",
          {"kind": "withdrawn", "reason": "Grund genug"}),
    route("POST", "/api/tournaments/{tid}/registrations/{reg}/removal/reject", "applications", {"plan_id": "x"}),
    # Staffel: Spiele betreuen
    route("POST", "/api/tournaments/{tid}/registrations/{reg}/checkin", "matches", {"status": "checked_in"}),
    route("GET", "/api/tournaments/{tid}/print/checkin", "matches"),
    route("POST", "/api/tournaments/{tid}/schedule/plan", "matches"),
    route("POST", "/api/tournaments/{tid}/schedule/release", "matches", {}),
    route("POST", "/api/tournaments/{tid}/live-queue/call", "matches", {"station_id": "s", "match_id": "m"}),
    route("POST", "/api/tournaments/{tid}/live-queue/start", "matches", {"station_id": "s", "match_id": "m"}),
    route("GET", "/api/team-day/{tid}/lineups", "matches"),
    route("PATCH", "/api/matches/{match}", "matches", {"admin_note": "Hinweis"}),
    # Check-in (D.2, #1652): für eine Seite eintragen und starten als Leitung - Captains handeln als Seite, nicht hier.
    route("POST", "/api/matches/{match}/checkin", "matches", {"present": [], "registration_id": "{reg}", "reason": "Grund genug"}),
    route("POST", "/api/matches/{match}/checkin/start", "matches", {}),
    # Staffel: lesen
    route("GET", "/api/tournaments/{tid}/staff", READ),
    route("GET", "/api/tournaments/{tid}/lead", READ),
    route("GET", "/api/tournaments/{tid}/planning-check", READ),
    route("GET", "/api/tournaments/{tid}/match-plan.csv", READ),
    route("GET", "/api/tournaments/{tid}/schedule/deadlines", READ),
    # Spiel: entscheiden
    route("POST", "/api/matches/{match}/result", "results", RESULT_BODY),
    # Ergebnisregel übergehen (C.3, #1617): Liga-Leitung mit „Ergebnisse“, mit Grund - Captains und andere Rechte nie.
    route("POST", "/api/matches/{match}/result?force=true", "results", OVERRIDE_BODY),
    route("POST", "/api/matches/{match}/result/undo", "results", {}),
    route("POST", "/api/matches/{match}/forfeit", "results", FORFEIT_BODY),
    route("PUT", "/api/matches/{match}/lineups", "results", "LINEUPS"),
    route("POST", "/api/tournaments/{tid}/lead/no-show/{match}", "results", "NOSHOW"),
    route("POST", "/api/tournaments/{tid}/matches-v2/recalculate-advancement", "results"),
    route("POST", "/api/matches/{match}/dispute/decision", "disputes", {"decision": "keep", "note": "Bleibt so"}),
    route("POST", "/api/matches/{match}/dispute", "disputes", {"reason": "Falsches Ergebnis"}),
    # PDF
    route("GET", "/api/exports/tournaments/{tid}/participants.pdf", ANY),
    route("GET", "/api/exports/tournaments/{tid}/checkin.pdf", ANY),
    route("GET", "/api/exports/tournaments/{tid}/matches.pdf", ANY),
    route("GET", "/api/exports/tournaments/{tid}/stations.pdf", ANY),
    route("GET", "/api/exports/tournaments/{tid}/registration-qr.pdf", ANY),
]


@pytest.fixture(autouse=True)
def _signing_key(monkeypatch):
    # Der Vor-Ort-Zugang signiert mit dem Schlüssel der Sitzungen.
    monkeypatch.setenv("JWT_SECRET", "nur-fuer-tests-" + "x" * 32)


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def rights_world(flow) -> dict:
    """Die Spielwelt mit echter Liga, Season und Liga N, dazu eine zweite Liga und ein freies Konto als Ziel."""
    w = await world(flow)
    league_id = w["tournament"]["league_context"]["league_id"]
    now = now_utc().isoformat()
    await flow.db.leagues.insert_one({"id": league_id, "name": "Probeliga", "slug": "probeliga", "game_id": "probe-shooter",
                                      "status": "active", "created_at": now})
    await flow.db.leagues.insert_one({"id": "andere", "name": "Andere Liga", "slug": "andere", "game_id": "probe-shooter",
                                      "status": "active", "created_at": now})
    await flow.db.league_seasons.insert_one({"id": w["season_id"], "league_id": league_id, "number": 1, "name": "Season 1",
                                             "slug": "season-1", "status": "draft", "visibility": "public",
                                             "start_date": "2027-01-04", "weeks_total": 10, "created_at": now})
    await flow.db.league_divisions.insert_one({"id": "liga-1", "season_id": w["season_id"], "league_id": league_id, "level": 1,
                                               "status": "active", "overrides": {}, "created_at": now})
    w["league_id"] = league_id
    w["target"] = await flow.add_user(name="Zielperson")
    return w


async def actor(flow, w: dict, kind: str, needs) -> dict:
    """Eine Person der Matrix. ``cap_right`` hält genau das verlangte Recht, ``cap_other`` alles andere."""
    tid = w["tournament"]["id"]

    async def holder(capabilities, league_id=None, **fields) -> dict:
        user = await flow.add_user(name=f"Zuständig {new_id()[:6]}")
        user.update(fields)
        await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
        await flow.db.league_staff.insert_one({
            "id": new_id(), "league_id": league_id or w["league_id"], "user_id": user["id"],
            "capabilities": list(capabilities), "created_at": now_utc().isoformat(), "created_by": "test"})
        return user

    async def helper(role) -> dict:
        user = await flow.add_user(name=f"Helfer {new_id()[:6]}")
        await flow.db.tournament_staff_assignments.insert_one({
            "id": new_id(), "tournament_id": tid, "user_id": user["id"], "role": role, "scope": "tournament", "is_active": True})
        return user

    wanted = [needs] if needs in CAPABILITIES else ["roster"] if needs in (ANY, READ) else []
    if kind == "superadmin":
        return w["staff"]
    if kind == "club_admin":
        return await flow.add_user(role="club_admin", name="Club-Admin")
    if kind == "leagues_grant":
        user = await flow.add_user(name="Ligaleitung")
        user["areas"] = ["leagues"]
        return user
    if kind == "cap_right":
        return await holder(wanted or list(CAPABILITIES))
    if kind == "cap_other":
        return await holder([cap for cap in CAPABILITIES if cap not in wanted] if wanted else ["roster"])
    if kind == "other_league":
        return await holder(list(CAPABILITIES), league_id="andere")
    if kind == "tournaments_role":
        return await flow.add_user(role="tournament_admin", name="Turnierleitung")
    if kind == "tournaments_grant":
        user = await flow.add_user(name="Freigabe Turniere")
        user["areas"] = ["tournaments"]
        return user
    if kind == "helper_organizer":
        return await helper("organizer")
    if kind == "helper_referee":
        return await helper("referee")
    if kind == "helper_scorekeeper":
        return await helper("scorekeeper")
    if kind == "helper_station":
        return await helper("station_manager")
    if kind == "moderator":
        return await flow.add_user(role="moderator", name="Moderation")
    if kind == "player":
        return w["users"]["Fremd"]
    if kind == "no_mfa_area":
        user = await flow.add_user(name="Ligaleitung ohne 2FA")
        user["areas"] = ["leagues"]
        user["auth_mfa_verified"] = False
        return user
    if kind == "no_mfa_cap":
        user = await holder(wanted or list(CAPABILITIES))
        user["auth_mfa_verified"] = False
        return user
    raise AssertionError(kind)


def allowed(kind: str, needs) -> bool:
    if kind in ("superadmin", "club_admin", "leagues_grant"):
        return True
    if needs == AREA:
        return False
    if kind == "cap_right":
        return True
    if needs in (ANY, READ) and kind == "cap_other":
        return True
    if needs == READ and kind.startswith("helper_"):
        return True
    return False


def fill(text: str, w: dict) -> str:
    return (text.replace("{league}", w["league_id"]).replace("{season}", w["season_id"]).replace("{division}", "liga-1")
            .replace("{tid}", w["tournament"]["id"]).replace("{match}", w["match"]["id"]).replace("{reg}", w["reg_a"]["id"])
            .replace("{user}", w["target"]["id"]))


def fill_body(body, w: dict):
    a, h = w["reg_a"]["id"], w["reg_h"]["id"]
    if body in (RESULT_BODY, OVERRIDE_BODY):
        return {"results": [{"registration_id": a, "rank": 1, "score": 2}, {"registration_id": h, "rank": 2, "score": 0}],
                "reason": "Korrektur laut Protokoll",
                **({"rule_override_reason": "Server stürzte ab"} if body == OVERRIDE_BODY else {})}
    if body == FORFEIT_BODY:
        return {"forfeit_registration_id": a, "note": "Nicht angetreten"}
    if body == "LINEUPS":
        return {"registration_id": a, "games": [{"position": 1, "lineup": ["x"]}], "reason": "Nachgetragen"}
    if body == "NOSHOW":
        return {"action": "confirm", "registration_id": a}
    if isinstance(body, dict):
        return {key: fill(value, w) if isinstance(value, str) else value for key, value in body.items()}
    return body


async def call(flow, method: str, url: str, body):
    kwargs = {"json": body} if body is not None else {}
    return await flow.client.request(method, url, **kwargs)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ACTORS)
@pytest.mark.parametrize("method,url,needs,body", ROUTES)
async def test_matrix(flow, method, url, needs, body, kind):
    w = await rights_world(flow)
    person = await actor(flow, w, kind, needs)
    flow.act_as(person)

    response = await call(flow, method, fill(url, w), fill_body(body, w))

    if allowed(kind, needs):
        assert response.status_code not in (401, 403), f"{kind} darf hier: {response.text}"
    else:
        assert response.status_code == 403, f"{kind} darf hier nicht ({response.status_code}): {response.text}"
