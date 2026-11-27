"""Rechte und Datenschutz für Gäste (#1665, Paket P8, Entscheidung Nr. 286): Ein Gast ist ein Konto ohne Mitgliedschaft - es hat dieselben
Rechte wie jedes andere Konto ohne Mitgliedschaft, keine eigene Rolle. Dieser Test geht alle Liga-Routen aus der Routentabelle der
Anwendung durch (Inventar, keine Liste von Hand) und prüft aus Sicht von Captain und Teamleitung eines Gastteams:

- keine Route der Liga-Verwaltung lässt sie durch;
- außerhalb des eigenen Teams ändert keine Route etwas - fremde Spiele, fremde Staffeln, fremde Teams und Anträge anderer;
- fremde Beweise, Strafen, Gründe und Kader sehen sie nicht, Vereinsinternes auch nicht;
- der Schulname ohne Freigabe der Teamleitung steht in keiner Antwort an Dritte;
- für das eigene Team geht, was es braucht (Spielseite, Termin, Ergebnis).

Eine neue Route ist von selbst dabei. Erfundene Namen.
"""

import json
import pathlib
import re
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import ids, two_nil, world  # noqa: E402
from models import now_utc  # noqa: E402

SCHOOL = "Geheimschule Probeberg"
REASON = "Geheimer Grund der Leitung"
ADMIN_PREFIXES = ("/api/admin/leagues", "/api/admin/league-rules")
# Schreiben außerhalb des eigenen Teams: alles unter diesen Adressen, mit fremden Kennungen gefüllt.
FOREIGN_PREFIXES = ("/api/matches/{match_id}", "/api/tournaments/{tid}", "/api/teams/{team_id}", "/api/leagues/")
# Lesen für die Prüfung auf den Schulnamen: öffentliche Liga, Staffel, Spiel, Team, Profil.
READ_PREFIXES = ("/api/leagues/", "/api/matches/{match_id}", "/api/tournaments/{tid}", "/api/teams/{team_id}", "/api/users/public/")
# Was in den Sammlungen der Liga und der Teams steht - vor und nach allen Versuchen gleich.
WATCHED = ("leagues", "league_seasons", "league_divisions", "league_applications", "league_staff", "league_rules", "league_rosters",
           "league_transfers", "league_rule_consents", "tournaments", "tournament_registrations", "matches_v2", "match_reports_v2",
           "match_schedule_proposals", "teams", "team_squads", "team_members", "team_invites", "competition_sanctions",
           "league_final_tables", "match_proof_photos")


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def app_routes() -> list[tuple[str, str]]:
    """Die Routentabelle der Anwendung: eingebundene Router bleiben in dieser FastAPI-Version Hüllen (``original_router``)."""
    import server

    found: set[tuple[str, str]] = set()

    def walk(routes):
        for route in routes or []:
            original = getattr(route, "original_router", None)
            if original is not None:
                walk(getattr(original, "routes", []))
                continue
            nested = getattr(route, "routes", None)
            if nested and not getattr(route, "methods", None):
                walk(nested)
                continue
            for method in getattr(route, "methods", None) or ():
                if method not in {"HEAD", "OPTIONS"}:
                    found.add((method, route.path))

    walk(server.app.routes)
    return sorted(found)


async def guest_world(flow) -> dict:
    """Staffel A: Löwen (Gastteam einer Schule, Name nicht freigegeben) gegen Falken (Vereinsteam). Staffel B: zwei fremde Teams."""
    a = await world(flow)
    b = await world(flow, letter="B")
    league_id = a["tournament"]["league_context"]["league_id"]
    now = now_utc().isoformat()
    await flow.db.leagues.insert_one({"id": league_id, "name": "Probeliga", "slug": "probeliga", "game_id": "probe-shooter",
                                      "status": "active", "created_at": now})
    for number, w in enumerate((a, b), start=1):
        await flow.db.league_seasons.insert_one({"id": w["season_id"], "league_id": league_id, "number": number, "name": f"Season {number}",
                                                 "slug": f"season-{number}", "status": "active", "visibility": "public", "created_at": now})
    await flow.db.league_divisions.insert_one({"id": "liga-1", "season_id": a["season_id"], "league_id": league_id, "level": 1,
                                               "status": "active", "overrides": {}, "created_at": now})
    await flow.db.teams.update_one({"id": a["lions"]["id"]}, {"$set": {"guest_team": {
        "kind": "school", "name": SCHOOL, "school_name_public": False, "confirmed_at": now, "confirmed_kind": "school",
        "confirmed_name": SCHOOL, "updated_at": now}}})
    # Die Falken sind Mitglieder des Vereins - der Gast sieht trotzdem nichts von ihnen, was nicht öffentlich ist.
    for name in ("FalLeitung", "Falke1", "Falke2", "Falke3"):
        a["users"][name]["is_club_member"] = True
    # Fremdes, das der Gast nie lesen darf: abgelehnter Antrag mit Grund, Strafe mit Grund an einem fremden Co-Team.
    await flow.db.league_applications.insert_one({
        "id": new_id(), "league_id": league_id, "season_id": a["season_id"], "team_id": a["falcons"]["id"], "squad_id": a["horst"]["id"],
        "team_name": "Falken", "squad_name": "Horst", "display_name": "Falken · Horst", "status": "rejected", "decision_reason": REASON,
        "applied_by": a["users"]["Falke1"]["id"], "history": [], "created_at": now, "updated_at": now})
    await flow.db.competition_sanctions.insert_one({
        "id": new_id(), "league_id": league_id, "season_id": a["season_id"], "tournament_id": a["tournament"]["id"],
        "squad_id": a["horst"]["id"], "team_id": a["falcons"]["id"], "kind": "warning", "reason": REASON, "state": "confirmed",
        "revoked_at": None, "created_at": now})
    return {"a": a, "b": b, "league_id": league_id}


def fill(path: str, w: dict, *, foreign: bool) -> str:
    """Kennungen in die Adresse: beim Schreiben die eines fremden Spiels, einer fremden Staffel und eines fremden Teams."""
    a, b = w["a"], w["b"]
    target = b if foreign else a
    team = (b["falcons"] if foreign else a["falcons"]) if "{team_id}" in path and path.startswith("/api/teams") else target["lions"]
    values = {
        "league_id": w["league_id"], "season_id": target["season_id"], "division_id": "liga-1", "tid": target["tournament"]["id"],
        "tournament_id": target["tournament"]["id"], "match_id": target["match"]["id"], "reg_id": target["reg_h"]["id"],
        "registration_id": target["reg_h"]["id"], "team_id": team["id"], "squad_id": target["horst"]["id"],
        "user_id": target["users"]["Falke1"]["id"], "league_slug": "probeliga", "season_slug": "season-2" if foreign else "season-1",
        "staffel_ref": target["tournament"]["id"], "team_ref": target["lions"]["id"], "slug_or_id": "probeliga",
        "scope": "league_season", "scope_id": target["season_id"], "kind": "promotion", "level": "1", "version": "1",
        "username": target["users"]["Falke1"]["username"],
    }
    return re.sub(r"{([^}:]+)(?::[^}]+)?}", lambda match: str(values.get(match.group(1), "unbekannt")), path)


async def snapshot(flow) -> dict:
    out = {}
    for name in WATCHED:
        rows = await getattr(flow.db, name).find({}, {"_id": 0}).to_list(5000)
        out[name] = sorted(json.dumps(row, sort_keys=True, default=str) for row in rows)
    return out


def guests(w: dict) -> dict:
    a = w["a"]
    return {"captain": a["users"]["Kapitaen"], "team_lead": a["users"]["LoeLeitung"]}


# ---------------------------------------------------------------- Verwaltung


@pytest.mark.asyncio
@pytest.mark.parametrize("who", ["captain", "team_lead"])
async def test_a_guest_reaches_no_route_of_the_league_administration(flow, who):
    w = await guest_world(flow)
    routes = [(method, path) for method, path in app_routes() if path.startswith(ADMIN_PREFIXES)]
    assert len(routes) > 100, "das Inventar findet die Routen der Liga-Verwaltung"
    before = await snapshot(flow)
    flow.act_as(guests(w)[who])
    passed = []
    for method, path in routes:
        response = await flow.client.request(method, fill(path, w, foreign=False), **({} if method == "GET" else {"json": {}}))
        if response.status_code != 403:
            passed.append(f"{method} {path}: {response.status_code}")
    assert passed == [], "ein Gast bekommt in der Verwaltung überall 403"
    assert await snapshot(flow) == before


# ---------------------------------------------------------------- Nichts ändern außerhalb des eigenen Teams


@pytest.mark.asyncio
@pytest.mark.parametrize("who", ["captain", "team_lead"])
async def test_a_guest_changes_nothing_outside_his_own_team(flow, who):
    w = await guest_world(flow)
    routes = [(method, path) for method, path in app_routes()
              if method != "GET" and path.startswith(FOREIGN_PREFIXES) and not path.startswith(ADMIN_PREFIXES)]
    assert len(routes) > 60, "das Inventar findet Spiele, Staffeln, Teams und Ligaseiten"
    before = await snapshot(flow)
    flow.act_as(guests(w)[who])
    through = []
    for method, path in routes:
        response = await flow.client.request(method, fill(path, w, foreign=True), json={})
        if response.status_code < 400:
            through.append(f"{method} {path}: {response.status_code}")
    assert through == [], "außerhalb des eigenen Teams geht nichts durch"
    assert await snapshot(flow) == before, "und nichts ist geändert"


@pytest.mark.asyncio
async def test_a_guest_can_not_apply_withdraw_or_report_for_other_teams(flow):
    w = await guest_world(flow)
    a, b = w["a"], w["b"]
    flow.act_as(a["users"]["Kapitaen"])
    foreign = await flow.post("/api/leagues/probeliga/season-1/applications",
                              json={"squad_id": a["horst"]["id"], "accept_rules": True, "accept_privacy": True})
    assert foreign.status_code in (403, 409), foreign.text
    report = await flow.post(f"/api/matches/{b['match']['id']}/report", json=two_nil(b))
    assert report.status_code == 403, report.text
    checkin = await flow.post(f"/api/matches/{b['match']['id']}/checkin", json={"registration_id": b["reg_a"]["id"], "present": []})
    assert checkin.status_code == 403, checkin.text


# ---------------------------------------------------------------- Nichts sehen, was ihn nichts angeht


@pytest.mark.asyncio
async def test_a_guest_sees_no_foreign_proofs_sanctions_reasons_or_rosters(flow):
    w = await guest_world(flow)
    a, b = w["a"], w["b"]
    flow.act_as(a["users"]["Kapitaen"])
    proofs = await flow.get(f"/api/matches/{b['match']['id']}/proofs?kind=report")
    assert proofs.status_code in (403, 404), proofs.text
    assert (await flow.get(f"/api/teams/{a['falcons']['id']}/squads")).status_code == 403, "fremde Kader nur für das Team selbst"
    mine = await flow.get("/api/me/league-applications")
    assert mine.status_code == 200 and REASON not in mine.text and a["horst"]["id"] not in mine.text
    page = await flow.get(f"/api/matches/{b['match']['id']}/page")
    assert page.status_code == 200
    body = page.json()
    assert body["can_act"] is False and body["acting_registration_id"] is None
    assert not any(uid in page.text for uid in ids(b, "Kapitaen", "Mila", "Falke2", "Falke3")), "keine fremden Konten aus Kadern"


@pytest.mark.asyncio
@pytest.mark.parametrize("viewer", ["anonym", "fremder_gast", "vereinsmitglied", "gegner"])
async def test_the_school_name_and_foreign_reasons_never_reach_third_parties(flow, viewer):
    w = await guest_world(flow)
    a, b = w["a"], w["b"]
    member = dict(a["users"]["Fremd"], is_club_member=True)
    person = {"anonym": None, "fremder_gast": b["users"]["Kapitaen"], "vereinsmitglied": member, "gegner": a["users"]["Falke1"]}[viewer]
    if person:
        await flow.db.users.update_many({}, {"$set": {"privacy_public_profile": True}})
    flow.act_as(person)
    routes = [path for method, path in app_routes() if method == "GET" and path.startswith(READ_PREFIXES)]
    seen = 0
    for path in routes:
        response = await flow.get(fill(path, w, foreign=False))
        if response.status_code != 200 or not response.headers.get("content-type", "").startswith("application/json"):
            continue
        seen += 1
        assert SCHOOL not in response.text, path
        if viewer != "gegner":
            # Den Grund einer Ablehnung sieht das eigene Team (Captain, Vertreter, Leitung) - nur der Gegner ist hier dieses Team.
            assert REASON not in response.text, path
    assert seen > 15, "die Prüfung hat echte Antworten gelesen"
    # Die Plakette selbst ist öffentlich - nur „Gast“.
    team = (await flow.get(f"/api/teams/{a['lions']['id']}")).json()
    assert team["guest_badge"] == {"label": "Gast", "org": None}


@pytest.mark.asyncio
async def test_club_internal_seasons_stay_with_members(flow):
    w = await guest_world(flow)
    a = w["a"]
    await flow.db.league_seasons.update_one({"id": a["season_id"]}, {"$set": {"visibility": "members"}})
    flow.act_as(a["users"]["Kapitaen"])
    assert (await flow.get("/api/leagues/probeliga/season-1")).status_code == 404, "„Nur Mitglieder“ auch nicht für Gäste im Kader"
    flow.act_as(a["users"]["Falke1"])
    assert (await flow.get("/api/leagues/probeliga/season-1")).status_code == 200


# ---------------------------------------------------------------- Was das eigene Team braucht


@pytest.mark.asyncio
async def test_a_guest_team_does_what_it_needs_for_its_own_match(flow):
    w = await guest_world(flow)
    a = w["a"]
    flow.act_as(a["users"]["Kapitaen"])
    page = (await flow.get(f"/api/matches/{a['match']['id']}/page")).json()
    assert page["can_act"] is True and page["acting_registration_id"] == a["reg_a"]["id"]
    report = await flow.post(f"/api/matches/{a['match']['id']}/report", json=two_nil(a, lineup=ids(a, "Kapitaen", "Mila")))
    assert report.status_code == 200, report.text
