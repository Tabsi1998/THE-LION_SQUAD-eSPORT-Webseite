"""Rechte und Datenschutz für Gäste (#1665, Paket P8, Entscheidung Nr. 286): Ein Gast ist ein Konto ohne Mitgliedschaft - es hat dieselben
Rechte wie jedes andere Konto ohne Mitgliedschaft, keine eigene Rolle. Dieser Test geht die Routentabelle der Anwendung durch (Inventar,
keine Liste von Hand; ``route_inventory``) und prüft aus Sicht von Captain und Teamleitung eines Gastteams:

- **Verwaltung:** Jede Route unter ``/api/admin/leagues`` und ``/api/admin/league-rules`` antwortet mit 403 - mit gültigem Inhalt, damit
  nicht schon die Form (422) antwortet.
- **Fremdes ändern:** Jede schreibende Route unter fremdem Spiel, fremder Staffel, fremdem Team und fremder Ligaseite bekommt einen
  gültigen Inhalt und echte fremde Kennungen (Verfahren, Terminvorschlag, Antrag, MOSS-Anforderung). Erlaubt ist nur 401 oder 403; jede
  andere Absage steht mit Grund in ``NOT_A_RIGHT`` (die Route handelt nur mit Eigenem oder ist in einer Staffel abgeschaltet). Die
  Sammlungen der Liga und der Teams bleiben gleich.
- **Lesen:** Jede GET-Route der Anwendung (Pfad mit den Kennungen der Gast-Staffel, Pflichtangaben gefüllt, dazu Suche und
  Link-Vorschau) - nirgends steht der nicht freigegebene Schulname, nirgends ein fremder Grund.
- **Eigenes Team:** Für das eigene Spiel geht, was das Team braucht.

Eine neue Route ist von selbst dabei. Erfundene Namen.
"""

import asyncio
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
from route_inventory import app_routes, example_body, required_query  # noqa: E402

SCHOOL = "Geheimschule Probeberg"
REASON = "Geheimer Grund der Leitung"
ADMIN_PREFIXES = ("/api/admin/leagues", "/api/admin/league-rules")
# Schreiben außerhalb des eigenen Teams: alles unter diesen Adressen, mit fremden Kennungen gefüllt.
FOREIGN_PREFIXES = ("/api/matches/{match_id}", "/api/tournaments/{tid}", "/api/teams/{team_id}", "/api/leagues/")
# Was in den Sammlungen der Liga und der Teams steht - vor und nach allen Versuchen gleich.
WATCHED = ("leagues", "league_seasons", "league_divisions", "league_applications", "league_staff", "league_rules", "league_rosters",
           "league_transfers", "league_rule_consents", "tournaments", "tournament_registrations", "matches_v2", "match_reports_v2",
           "match_schedule_proposals", "teams", "team_squads", "team_members", "team_invites", "competition_sanctions",
           "league_final_tables", "match_proof_photos")

# Fremde Schreibrouten, die vor jedem Recht mit einer anderen Absage als 403 antworten - je mit Grund. Jede andere Route muss 401
# oder 403 sagen; eine neue Route mit 404, 400, 409 oder 422 lässt den Test scheitern, bis sie hier begründet steht.
NOT_A_RIGHT = {
    ("POST", "/api/teams/{team_id}/leave"): (400, "nur für Mitglieder oder Kader des Teams - ein Fremder verlässt nichts"),
    ("POST", "/api/teams/{team_id}/members/{user_id}/role"): (400, "Rolle aus dem Inhalt wird vor dem Recht geprüft; geändert wird nichts"),
    ("POST", "/api/teams/{team_id}/transfer-leader"): (400, "ohne gewählte Person bricht die Route vor dem Recht ab; geändert wird nichts"),
    ("POST", "/api/tournaments/{tid}/register"): (400, "in einer Liga-Staffel gibt es keine Einzelanmeldung, nur Co-Teams über Antrag"),
    ("DELETE", "/api/matches/{match_id}/proofs/{proof_id}"): (404, "nur eigene Nachweise: fremde gibt es für die Person nicht"),
    ("PATCH", "/api/tournaments/{tid}/my-registration"): (404, "handelt nur mit der eigenen Anmeldung - in der fremden Staffel gibt es keine"),
    ("POST", "/api/tournaments/{tid}/checkin"): (404, "handelt nur mit der eigenen Anmeldung - in der fremden Staffel gibt es keine"),
    ("POST", "/api/teams/{team_id}/restore"): (404, "nur aufgelöste eigene Teams lassen sich wiederherstellen"),
    ("POST", "/api/matches/{match_id}/reschedule"): (409, "die Staffel hat keine Verschiebung eingeschaltet - abgeschaltet vor dem Recht"),
    ("POST", "/api/matches/{match_id}/reschedule/{request_id}/decision"): (409, "wie oben: ohne Verschiebung in der Staffel"),
    # Verfahren (E.2): Für Unbeteiligte gibt es sie nicht - 404 ist hier die Absage selbst (``league_protest_routes._context``), auch mit
    # der echten Kennung „verfahren-b“ des fremden Spiels.
    **{(method, f"/api/matches/{{match_id}}{tail}"): (404, "Verfahren sind für Unbeteiligte unsichtbar - 404 ist die Absage")
       for method, tail in (("PATCH", "/procedures/{procedure_id}"), ("POST", "/appeals"), ("POST", "/procedures/{procedure_id}/assign"),
                            ("POST", "/procedures/{procedure_id}/decision"), ("POST", "/procedures/{procedure_id}/moss-requests"),
                            ("POST", "/procedures/{procedure_id}/moss-requests/{request_id}/excuse"),
                            ("POST", "/procedures/{procedure_id}/statement"), ("POST", "/procedures/{procedure_id}/statement/extend"),
                            ("POST", "/procedures/{procedure_id}/withdraw"))},
}


@pytest.fixture(autouse=True)
def _signing_key(monkeypatch):
    # Manche Routen signieren beim Lesen (Spamschutz, Vor-Ort-Zugang) - wie in test_league_rights_matrix_flow.
    monkeypatch.setenv("JWT_SECRET", "nur-fuer-tests-" + "x" * 32)


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def guest_world(flow) -> dict:
    """Staffel A: Löwen (Gastteam einer Schule, Name nicht freigegeben) gegen Falken (Vereinsteam). Staffel B: zwei fremde Teams mit
    einem offenen Verfahren samt MOSS-Anforderung, einem Terminvorschlag und einem offenen Antrag - echte fremde Kennungen."""
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
    # Echte Kennungen in Staffel B, damit die Routen bis zum Recht kommen.
    await flow.db.matches_v2.update_one({"id": b["match"]["id"]}, {"$set": {"disputes": [{
        "id": "verfahren-b", "kind": "protest", "state": "open", "user_id": b["users"]["Kapitaen"]["id"], "registration_id": b["reg_a"]["id"],
        "at": now, "reason_key": "other", "category": "other", "reason": REASON, "moss_requests": [{"id": "moss-b", "state": "requested"}],
        "additions": [], "statement": {"registration_id": b["reg_h"]["id"], "until": now}}]}})
    await flow.db.match_schedule_proposals.insert_one({
        "id": "vorschlag-b", "match_id": b["match"]["id"], "tournament_id": b["tournament"]["id"], "status": "pending", "kind": "proposal",
        "actor_registration_id": b["reg_a"]["id"], "actor_user_id": b["users"]["Kapitaen"]["id"], "scheduled_at": now, "created_at": now})
    await flow.db.league_applications.insert_one({
        "id": "antrag-b", "league_id": league_id, "season_id": b["season_id"], "team_id": b["falcons"]["id"], "squad_id": b["horst"]["id"],
        "team_name": "Falken", "squad_name": "Horst", "display_name": "Falken · Horst", "status": "submitted",
        "active_key": f"{b['season_id']}:{b['horst']['id']}", "applied_by": b["users"]["Falke1"]["id"], "history": [],
        "created_at": now, "updated_at": now})
    return {"a": a, "b": b, "league_id": league_id}


def values(w: dict, *, foreign: bool, path: str = "") -> dict:
    a, b = w["a"], w["b"]
    target = b if foreign else a
    # Schreiben: das fremde Team; Lesen: das Gastteam selbst - dort stünde der Schulname, wenn er irgendwo durchrutschte.
    team = (b["falcons"] if path.startswith("/api/teams") else b["lions"]) if foreign else a["lions"]
    return {
        "league_id": w["league_id"], "season_id": target["season_id"], "division_id": "liga-1", "tid": target["tournament"]["id"],
        "tournament_id": target["tournament"]["id"], "match_id": target["match"]["id"], "reg_id": target["reg_h"]["id"],
        "registration_id": target["reg_h"]["id"], "team_id": team["id"], "squad_id": target["horst"]["id"],
        "user_id": target["users"]["Falke1"]["id"], "league_slug": "probeliga", "season_slug": "season-2" if foreign else "season-1",
        "staffel_ref": target["tournament"]["id"], "team_ref": team["id"], "slug_or_id": "probeliga", "slug": "probeliga",
        "scope": "league_season", "scope_id": target["season_id"], "kind": "promotion", "level": "1", "version": "1",
        "username": target["users"]["Kapitaen"]["username"], "procedure_id": "verfahren-b", "request_id": "moss-b",
        "proposal_id": "vorschlag-b", "application_id": "antrag-b", "id": team["id"],
    }


def fill(path: str, w: dict, *, foreign: bool) -> str:
    """Kennungen in die Adresse: beim Schreiben die eines fremden Spiels, einer fremden Staffel und eines fremden Teams."""
    known = values(w, foreign=foreign, path=path)
    return re.sub(r"{([^}:]+)(?::[^}]+)?}", lambda match: str(known.get(match.group(1), "unbekannt")), path)


def foreign_overrides(w: dict) -> dict:
    """Inhalte, die die Form allein nicht erraten kann - damit die Route bis zum Recht kommt."""
    b = w["b"]
    return {
        ("POST", "/api/leagues/{league_slug}/{season_slug}/applications"): {
            "squad_id": b["horst"]["id"], "accept_rules": True, "accept_privacy": True},
        ("POST", "/api/matches/{match_id}/report"): two_nil(b),
        ("POST", "/api/tournaments/{tid}/bracket/apply"): {"expected_plan_hash": "0" * 64},
        ("POST", "/api/tournaments/{tid}/live-queue/move"): {"to_station_id": "andere-station"},
        ("POST", "/api/tournaments/{tid}/registrations/{reg_id}/removal"): {"kind": "withdrawn"},
    }


# Hochladen geht als Formular, nicht als JSON.
MULTIPART = {
    ("POST", "/api/matches/{match_id}/proof-photos"): {"files": {"file": ("beweis.png", b"\x89PNG\r\n\x1a\n", "image/png")}},
    ("POST", "/api/matches/{match_id}/proofs"): {"data": {"kind": "report", "link": "https://example.test/video"}},
}


async def send(flow, method: str, path: str, url: str, overrides: dict):
    if (method, path) in MULTIPART:
        return await flow.client.request(method, url, **MULTIPART[(method, path)])
    body = example_body(method, path, overrides.get((method, path)))
    query = required_query(method, path)
    return await flow.client.request(method, url, params=query or None, **({"json": body} if body is not None else {}))


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
        response = await send(flow, method, path, fill(path, w, foreign=False), {})
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
    assert len(routes) > 100, "das Inventar findet Spiele, Staffeln, Teams und Ligaseiten"
    before = await snapshot(flow)
    overrides = foreign_overrides(w)
    flow.act_as(guests(w)[who])
    wrong = []
    for method, path in routes:
        response = await send(flow, method, path, fill(path, w, foreign=True), overrides)
        expected = NOT_A_RIGHT.get((method, path))
        if response.status_code in (401, 403) or (expected and response.status_code == expected[0]):
            continue
        wrong.append(f"{response.status_code} {method} {path}: {response.text[:120]}")
    assert not wrong, "außerhalb des eigenen Teams sagt jede Route 403 - oder steht mit Grund in NOT_A_RIGHT:\n" + "\n".join(wrong)
    assert await snapshot(flow) == before, "und nichts ist geändert"


def test_every_exception_still_belongs_to_a_route():
    routes = set(app_routes())
    assert set(NOT_A_RIGHT) <= routes, "eine begründete Ausnahme ohne Route - aufräumen"


@pytest.mark.asyncio
async def test_a_guest_can_not_apply_withdraw_or_report_for_other_teams(flow):
    w = await guest_world(flow)
    a, b = w["a"], w["b"]
    flow.act_as(a["users"]["Kapitaen"])
    foreign = await flow.post("/api/leagues/probeliga/season-1/applications",
                              json={"squad_id": a["horst"]["id"], "accept_rules": True, "accept_privacy": True})
    assert foreign.status_code in (403, 409), foreign.text
    withdraw = await flow.post("/api/leagues/probeliga/season-2/applications/antrag-b/withdraw", json={})
    assert withdraw.status_code == 403, withdraw.text
    report = await flow.post(f"/api/matches/{b['match']['id']}/report", json=two_nil(b))
    assert report.status_code == 403, report.text
    checkin = await flow.post(f"/api/matches/{b['match']['id']}/checkin", json={"registration_id": b["reg_a"]["id"], "present": []})
    assert checkin.status_code == 403, checkin.text


@pytest.mark.asyncio
async def test_a_squad_member_who_left_the_team_still_leaves_the_squad_and_strangers_get_nothing(flow):
    """Auf main ging es: Wer nicht mehr im Team, aber noch in einem Kader steht, nimmt sich über „Verlassen“ heraus. Wer weder noch,
    bekommt 400 - und die fremde Teamleitung keine Nachricht „hat verlassen“."""
    w = await guest_world(flow)
    a = w["a"]
    mila = a["users"]["Mila"]
    await flow.db.teams.update_one({"id": a["lions"]["id"]}, {"$pull": {"member_ids": mila["id"]}})
    flow.act_as(mila)
    assert (await flow.post(f"/api/teams/{a['lions']['id']}/leave", json={})).status_code == 200
    squad = await flow.db.team_squads.find_one({"id": a["squad_a"]["id"]}, {"_id": 0})
    assert mila["id"] not in squad["member_ids"]
    stranger = a["users"]["Fremd"]
    flow.act_as(stranger)
    refused = await flow.post(f"/api/teams/{a['falcons']['id']}/leave", json={})
    assert refused.status_code == 400
    told = await flow.db.notifications.find({"user_id": a["users"]["FalLeitung"]["id"], "kind": "team_member_left"}).to_list(10)
    assert told == []


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
    assert REASON not in page.text, "kein fremdes Verfahren"


# Lesen: GET-Routen, die hier nichts sagen können - mit Grund.
NOT_READ = {
    "/api/changes/stream": "Ereignisstrom (SSE) ohne Ende - liefert nur Namen von Bereichen, keine Inhalte",
}


def extra_reads(w: dict) -> list[str]:
    """Abfragen mit Inhalt, den die Form nicht errät: Suche nach dem Gastteam, Link-Vorschauen seiner Seiten."""
    a = w["a"]
    team = a["lions"]["id"]
    return [f"/api/search?q={a['lions']['name']}", f"/api/teams?q={a['lions']['name']}", "/api/leagues",
            f"/api/seo/meta?path=/teams/{team}", f"/api/seo/preview?path=/teams/{team}", "/api/seo/meta?path=/liga/probeliga/season-1",
            f"/api/tournaments/{a['tournament']['id']}", f"/api/league-rules/league_season/{a['season_id']}",
            "/api/league-rules/league/liga"]


@pytest.mark.asyncio
@pytest.mark.parametrize("viewer", ["anonym", "fremder_gast", "vereinsmitglied", "gegner"])
async def test_the_school_name_and_foreign_reasons_never_reach_third_parties(flow, viewer):
    w = await guest_world(flow)
    a, b = w["a"], w["b"]
    member = dict(a["users"]["Fremd"], is_club_member=True)
    person = {"anonym": None, "fremder_gast": b["users"]["Kapitaen"], "vereinsmitglied": member, "gegner": a["users"]["Falke1"]}[viewer]
    await flow.db.users.update_many({}, {"$set": {"privacy_public_profile": True}})
    flow.act_as(person)
    reads = [path for method, path in app_routes() if method == "GET" and path not in NOT_READ]
    assert len(reads) > 400, "alle GET-Routen, nicht nur die der Liga"
    urls = [(path, fill(path, w, foreign=False)) for path in reads] + [(url, url) for url in extra_reads(w)]
    wanted = {"q": a["lions"]["name"], "path": f"/teams/{a['lions']['id']}"}
    answered = 0
    for path, url in urls:
        query = required_query("GET", path, wanted)
        try:
            response = await asyncio.wait_for(flow.client.get(url, params=query or None), timeout=20)
        except Exception as problem:  # noqa: BLE001 - eine Route, die selbst scheitert, verrät nichts; sie steht in der Meldung
            pytest.fail(f"{url}: {type(problem).__name__}")
        text = response.content.decode("utf-8", errors="ignore")
        answered += response.status_code == 200
        assert SCHOOL not in text, url
        if viewer != "gegner":
            # Den Grund einer Ablehnung sieht das eigene Team (Captain, Vertreter, Leitung) - nur der Gegner ist hier dieses Team.
            assert REASON not in text, url
    assert answered > 60, "die Prüfung hat echte Antworten gelesen"
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
