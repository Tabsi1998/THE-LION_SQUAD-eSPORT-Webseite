"""Befangenheit, Vergabe der Zuständigen und was die Turnierleitung in Staffeln noch sieht (docs/LIGA.md, Abschnitt 12, #2203).
Plus Regression: Helfer und Turnierleitung in normalen Turnieren wie bisher. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import world  # noqa: E402
from models import now_utc  # noqa: E402
from squad_world import make_squad, make_team, squad_registration  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def holder(flow, w, *capabilities, name="Zuständig", user=None, league_id=None) -> dict:
    person = user or await flow.add_user(name=name)
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league_id or "liga", "user_id": person["id"],
                                           "capabilities": list(capabilities), "created_at": now_utc().isoformat()})
    return person


def result_body(w, **extra) -> dict:
    return {"results": [{"registration_id": w["reg_a"]["id"], "rank": 1, "score": 2},
                        {"registration_id": w["reg_h"]["id"], "rank": 2, "score": 0}], **extra}


async def overrides(flow) -> list[dict]:
    return await flow.db.audit_logs.find({"action": "league.conflict.override"}, {"_id": 0}).to_list(50)


# ---------------------------------------------------------------- Wer gilt als beteiligt

@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["Kapitaen", "Mila", "LoeLeitung", "Falke1", "FalLeitung"])
async def test_every_person_of_a_side_is_involved(flow, name):
    from services.league_permissions import conflict_of_interest

    w = await world(flow)
    assert await conflict_of_interest(flow.db, w["users"][name], w["match"]) == {"kind": "involved", "override": False}


@pytest.mark.asyncio
async def test_a_team_member_outside_the_squad_is_not_involved(flow):
    from services.league_permissions import conflict_of_interest

    w = await world(flow)
    assert await conflict_of_interest(flow.db, w["users"]["Ida"], w["match"]) is None, "Ida steht in keinem Kader dieses Spiels"
    assert await conflict_of_interest(flow.db, w["users"]["Fremd"], w["match"]) is None


@pytest.mark.asyncio
async def test_vice_captain_and_co_lead_are_involved(flow):
    from league_match_world import duel, staffel
    from services.league_permissions import conflict_of_interest

    leader, co_lead, captain, vice = [await flow.add_user(name=name) for name in ("Leitung", "CoLeitung", "Kapitän", "Vertretung")]
    team = await make_team(flow, "Adler", leader=leader, co_leaders=[co_lead], members=[captain, vice])
    squad = await make_squad(flow, team, "Horst", [captain, vice], captain=captain, vice=vice)
    other_lead = await flow.add_user(name="Anderes Team")
    other = await make_team(flow, "Dachse", leader=other_lead)
    other_squad = await make_squad(flow, other, "Bau", [other_lead])
    tournament = await staffel(flow, new_id())
    match = await duel(flow, tournament, await squad_registration(flow, tournament, team, squad),
                       await squad_registration(flow, tournament, other, other_squad))
    for person in (leader, co_lead, captain, vice):
        assert (await conflict_of_interest(flow.db, person, match))["kind"] == "involved"


@pytest.mark.asyncio
async def test_someone_in_a_lineup_stays_involved_after_leaving_the_squad(flow):
    from services.league_permissions import conflict_of_interest

    w = await world(flow)
    gone = await flow.add_user(name="Gegangen")
    match = {**w["match"], "games": [{"position": 1, "lineups": {w["reg_a"]["id"]: [gone["id"]]}}]}
    assert (await conflict_of_interest(flow.db, gone, match))["kind"] == "involved"


@pytest.mark.asyncio
async def test_own_decision_never_has_an_override(flow):
    """Für E.3: Den Einspruch entscheidet nie, wer die Ausgangsentscheidung traf - auch nicht der Superadmin."""
    from fastapi import HTTPException

    from services.league_permissions import conflict_of_interest, require_no_conflict

    w = await world(flow)
    superadmin = w["staff"]
    assert await conflict_of_interest(flow.db, superadmin, w["match"], decided_by=superadmin["id"]) == {
        "kind": "own_decision", "override": False}
    with pytest.raises(HTTPException) as refused:
        await require_no_conflict(flow.db, superadmin, w["match"], action="appeal", conflict_reason="Ein guter Grund",
                                  decided_by=superadmin["id"])
    assert refused.value.status_code == 403
    assert await overrides(flow) == []
    second = await flow.add_user(role="superadmin", name="Zweiter Superadmin")
    assert await conflict_of_interest(flow.db, second, w["match"], decided_by=superadmin["id"]) is None


@pytest.mark.asyncio
async def test_tournaments_without_league_know_no_conflict(flow):
    from services.league_permissions import conflict_of_interest

    tournament, users, regs = await flow.with_participants(2, status="live")
    match = {"id": new_id(), "tournament_id": tournament["id"],
             "slots": [{"registration_id": regs[0]["id"]}, {"registration_id": regs[1]["id"]}]}
    assert await conflict_of_interest(flow.db, users[0], match) is None


# ---------------------------------------------------------------- Befangen im Spiel

ROUTES = [
    ("POST", "/api/matches/{match}/result", "results", "RESULT"),
    # Ergebnisregel übergehen (C.3, #1617): auch dann entscheidet im eigenen Spiel eine zweite Person.
    ("POST", "/api/matches/{match}/result", "results", "OVERRIDE"),
    ("POST", "/api/matches/{match}/result/undo", "results", {}),
    ("POST", "/api/matches/{match}/forfeit", "results", "FORFEIT"),
    ("POST", "/api/tournaments/{tid}/lead/no-show/{match}", "results", "NOSHOW"),
    ("PUT", "/api/matches/{match}/lineups", "results", "LINEUPS"),
    ("POST", "/api/matches/{match}/dispute/decision", "disputes", {"decision": "keep"}),
]


def conflict_call(w, url, body, **extra):
    a = w["reg_a"]["id"]
    if body == "RESULT":
        body = result_body(w)
    elif body == "OVERRIDE":
        body = {**result_body(w), "rule_override_reason": "Server stürzte ab"}
    elif body == "FORFEIT":
        body = {"forfeit_registration_id": a, "note": "Nicht angetreten"}
    elif body == "NOSHOW":
        body = {"action": "confirm", "registration_id": a}
    elif body == "LINEUPS":
        body = {"registration_id": a, "games": [{"position": 1, "lineup": ["x"]}], "reason": "Nachgetragen"}
    return url.replace("{match}", w["match"]["id"]).replace("{tid}", w["tournament"]["id"]), {**body, **extra}


@pytest.mark.asyncio
@pytest.mark.parametrize("method,url,capability,body", ROUTES)
@pytest.mark.parametrize("who", ["Kapitaen", "LoeLeitung", "Falke1"])
async def test_involved_holder_is_refused(flow, method, url, capability, body, who):
    w = await world(flow)
    person = await holder(flow, w, capability, user=w["users"][who])
    flow.act_as(person)
    target, payload = conflict_call(w, url, body)
    response = await flow.client.request(method, target, json=payload)
    assert response.status_code == 403
    assert "selbst beteiligt" in response.json()["detail"]
    assert await overrides(flow) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("method,url,capability,body", ROUTES)
async def test_uninvolved_holder_passes_the_conflict_check(flow, method, url, capability, body):
    w = await world(flow)
    flow.act_as(await holder(flow, w, capability))
    target, payload = conflict_call(w, url, body)
    response = await flow.client.request(method, target, json=payload)
    assert response.status_code != 403, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("method,url,capability,body", ROUTES)
async def test_area_holder_who_is_involved_is_refused_too(flow, method, url, capability, body):
    w = await world(flow)
    person = {**w["users"]["Kapitaen"], "areas": ["leagues"]}
    flow.act_as(person)
    target, payload = conflict_call(w, url, body)
    response = await flow.client.request(method, target, json=payload)
    assert response.status_code == 403
    assert "selbst beteiligt" in response.json()["detail"]


@pytest.mark.asyncio
async def test_club_admin_who_is_involved_has_no_override(flow):
    w = await world(flow)
    person = {**w["users"]["Kapitaen"], "role": "club_admin"}
    flow.act_as(person)
    target, payload = conflict_call(w, ROUTES[0][1], "RESULT", conflict_reason="Notfall, sonst bleibt es liegen")
    response = await flow.client.request("POST", target, json=payload)
    assert response.status_code == 403
    assert await overrides(flow) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("method,url,capability,body", ROUTES)
@pytest.mark.parametrize("reason", [None, "", "kurz"])
async def test_involved_superadmin_needs_a_reason(flow, method, url, capability, body, reason):
    w = await world(flow)
    flow.act_as({**w["users"]["Kapitaen"], "role": "superadmin"})
    target, payload = conflict_call(w, url, body, **({"conflict_reason": reason} if reason is not None else {}))
    response = await flow.client.request(method, target, json=payload)
    assert response.status_code == 403
    assert "Notausnahme" in response.json()["detail"]
    assert await overrides(flow) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("method,url,capability,body", ROUTES)
async def test_involved_superadmin_with_reason_passes_and_is_logged(flow, method, url, capability, body):
    w = await world(flow)
    person = {**w["users"]["Kapitaen"], "role": "superadmin"}
    flow.act_as(person)
    target, payload = conflict_call(w, url, body, conflict_reason="Sonst niemand erreichbar")
    response = await flow.client.request(method, target, json=payload)
    assert response.status_code != 403, response.text
    logged = await overrides(flow)
    assert len(logged) == 1, "genau ein Eintrag - auch wenn die Route zweimal prüft"
    assert logged[0]["actor_id"] == person["id"]
    assert logged[0]["data"]["reason"] == "Sonst niemand erreichbar"
    assert logged[0]["data"]["match_id"] == w["match"]["id"]


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", [12345, ["Ein langer Grund"], {"grund": "Ein langer Grund"}])
async def test_forfeit_reason_of_another_type_counts_as_missing(flow, reason):
    """Der Forfeit-Weg nimmt einen freien Inhalt an: Ein Grund, der kein Text ist, ist keiner - und kein 500."""
    w = await world(flow)
    flow.act_as({**w["users"]["Kapitaen"], "role": "superadmin"})
    response = await flow.post(f"/api/matches/{w['match']['id']}/forfeit",
                               json={"forfeit_registration_id": w["reg_a"]["id"], "note": "Nicht angetreten", "conflict_reason": reason})
    assert response.status_code == 403
    assert "Notausnahme" in response.json()["detail"]


@pytest.mark.asyncio
async def test_a_second_person_decides_instead(flow):
    w = await world(flow)
    flow.act_as(await holder(flow, w, "results", user=w["users"]["Kapitaen"]))
    target, payload = conflict_call(w, ROUTES[0][1], "RESULT")
    assert (await flow.client.post(target, json=payload)).status_code == 403
    flow.act_as(await holder(flow, w, "results"))
    response = await flow.client.post(target, json=payload)
    assert response.status_code == 200, response.text
    stored = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert stored["status"] == "completed"


@pytest.mark.asyncio
async def test_the_own_side_still_acts_as_a_side(flow):
    """Der Captain meldet und plant weiter - nur entscheiden darf er nicht."""
    from league_match_world import ids, two_nil

    w = await world(flow)
    flow.act_as(await holder(flow, w, "results", "disputes", user=w["users"]["Kapitaen"]))
    reported = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    assert reported.status_code == 200, reported.text
    amended = await flow.put(f"/api/matches/{w['match']['id']}/lineups",
                             json={"games": [{"position": 1, "lineup": ids(w, "Kapitaen", "Mila")}]})
    assert amended.status_code != 403, amended.text


@pytest.mark.asyncio
async def test_correcting_a_disputed_result_needs_disputes_too(flow):
    w = await world(flow)
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"status": "disputed", "status_before_dispute": "scheduled"}})
    target, payload = conflict_call(w, ROUTES[0][1], "RESULT")
    flow.act_as(await holder(flow, w, "results"))
    assert (await flow.client.post(target, json=payload)).status_code == 403
    flow.act_as(await holder(flow, w, "results", "disputes"))
    assert (await flow.client.post(target, json=payload)).status_code != 403


@pytest.mark.asyncio
async def test_match_page_says_why(flow):
    w = await world(flow)
    url = f"/api/matches/{w['match']['id']}/page"

    flow.act_as(await holder(flow, w, "results", "disputes", user=w["users"]["Kapitaen"]))
    page = (await flow.get(url)).json()
    assert page["conflict"] == {"kind": "involved", "override": False}
    assert page["can_submit_result"] is False and page["can_forfeit"] is False and page["can_decide_dispute"] is False
    assert page["can_report_score"] is True, "als eigene Seite meldet er weiter"

    flow.act_as({**w["users"]["Kapitaen"], "role": "superadmin"})
    page = (await flow.get(url)).json()
    assert page["conflict"] == {"kind": "involved", "override": True}
    assert page["can_submit_result"] is True
    assert page["result_entry"]["conflict_override"] is True, "das Ergebnis-Fenster fragt nach dem Grund"

    flow.act_as(await holder(flow, w, "results"))
    page = (await flow.get(url)).json()
    assert page["conflict"] is None and page["can_submit_result"] is True and page["can_decide_dispute"] is False

    flow.act_as(w["users"]["Falke1"])
    page = (await flow.get(url)).json()
    assert page["conflict"] is None, "wer kein Liga-Recht hat, bekommt keine Meldung"


@pytest.mark.asyncio
async def test_lead_view_marks_the_match(flow):
    w = await world(flow)
    flow.act_as(await holder(flow, w, "results", user=w["users"]["Kapitaen"]))
    view = (await flow.get(f"/api/tournaments/{w['tournament']['id']}/lead")).json()
    row = next(item for item in view["matches"] if item["id"] == w["match"]["id"])
    assert row["can_enter"] is False and row["conflict"] is True and row["conflict_override"] is False

    flow.act_as({**w["users"]["Kapitaen"], "role": "superadmin"})
    view = (await flow.get(f"/api/tournaments/{w['tournament']['id']}/lead")).json()
    row = next(item for item in view["matches"] if item["id"] == w["match"]["id"])
    assert row["can_enter"] is True and row["conflict"] is False and row["conflict_override"] is True

    flow.act_as(await holder(flow, w, "results"))
    view = (await flow.get(f"/api/tournaments/{w['tournament']['id']}/lead")).json()
    row = next(item for item in view["matches"] if item["id"] == w["match"]["id"])
    assert row["can_enter"] is True and row["conflict"] is False


# ---------------------------------------------------------------- Turnierleitung und Helfer in der Staffel

@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["organizer", "referee", "scorekeeper", "station_manager"])
async def test_helpers_change_no_results_in_a_staffel(flow, role):
    w = await world(flow)
    helper = await flow.add_user(name="Helfer")
    await flow.db.tournament_staff_assignments.insert_one(
        {"id": new_id(), "tournament_id": w["tournament"]["id"], "user_id": helper["id"], "role": role, "scope": "tournament"})
    flow.act_as(helper)
    match = w["match"]["id"]
    assert (await flow.post(f"/api/matches/{match}/result", json=result_body(w))).status_code == 403
    assert (await flow.post(f"/api/matches/{match}/forfeit", json={"forfeit_registration_id": w["reg_a"]["id"], "note": "Nicht da"})).status_code == 403
    assert (await flow.post(f"/api/tournaments/{w['tournament']['id']}/lead/no-show/{match}",
                            json={"action": "confirm", "registration_id": w["reg_a"]["id"]})).status_code == 403
    page = (await flow.get(f"/api/matches/{match}/page")).json()
    assert page["can_submit_result"] is False and page["can_forfeit"] is False
    assert (await flow.get(f"/api/tournaments/{w['tournament']['id']}/lead")).status_code == 200, "lesen bleibt"
    view = (await flow.get(f"/api/tournaments/{w['tournament']['id']}")).json()
    assert view["can_manage_results"] is False and view["can_use_staff_tools"] is True


@pytest.mark.asyncio
async def test_tournament_lead_only_reads_what_everyone_reads(flow):
    w = await world(flow)
    lead = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(lead)
    tid = w["tournament"]["id"]

    view = (await flow.get(f"/api/tournaments/{tid}")).json()
    assert view["can_manage_results"] is False and view["can_manage_structure"] is False
    assert view["can_use_staff_tools"] is False and view["league_capabilities"] == []
    assert "season_admin_path" not in (view.get("league_links") or {})
    assert (await flow.get(f"/api/tournaments/{tid}/bracket")).status_code == 200, "öffentlich bleibt öffentlich"
    assert (await flow.get(f"/api/tournaments/{tid}/standings")).status_code == 200

    match = (await flow.get(f"/api/matches/{w['match']['id']}")).json()
    assert "admin_note" not in match and "reports" not in match or match.get("reports") in (None, [])
    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    assert page["can_submit_result"] is False and page["can_act"] is False


@pytest.mark.asyncio
async def test_hidden_staffel_is_not_there_for_the_tournament_lead(flow):
    w = await world(flow)
    tid = w["tournament"]["id"]
    await flow.db.tournaments.update_one({"id": tid}, {"$set": {"status": "draft", "is_public": False, "visibility": "public"}})

    flow.act_as(await flow.add_user(role="tournament_admin", name="Turnierleitung"))
    assert (await flow.get(f"/api/tournaments/{tid}")).status_code == 404
    listed = (await flow.get("/api/tournaments?include_drafts=true&managed=true")).json()
    assert tid not in [row["id"] for row in listed]

    flow.act_as(await holder(flow, w, "results"))
    assert (await flow.get(f"/api/tournaments/{tid}")).status_code == 200
    listed = (await flow.get("/api/tournaments?include_drafts=true&managed=true")).json()
    assert tid in [row["id"] for row in listed]

    flow.act_as(await holder(flow, w, "results", league_id="andere"))
    assert (await flow.get(f"/api/tournaments/{tid}")).status_code == 404

    area = await flow.add_user(name="Bereich Ligen")
    area["areas"] = ["leagues"]
    flow.act_as(area)
    assert (await flow.get(f"/api/tournaments/{tid}")).status_code == 200
    listed = (await flow.get("/api/tournaments?include_drafts=true&managed=true")).json()
    assert tid in [row["id"] for row in listed]


@pytest.mark.asyncio
async def test_season_visibility_admins_follows_league_rights(flow):
    from services.league_service import can_see_season

    season = {"id": "s", "league_id": "liga", "visibility": "admins"}
    assert not await can_see_season(await flow.add_user(role="tournament_admin"), season)
    w = await world(flow)
    assert await can_see_season(await holder(flow, w, "roster"), season)
    assert not await can_see_season(await holder(flow, w, "roster", league_id="andere"), season)
    area = await flow.add_user(name="Bereich Ligen")
    area["areas"] = ["leagues"]
    assert await can_see_season(area, season)


@pytest.mark.asyncio
async def test_disputes_reach_league_staff_not_the_tournament_lead(flow):
    from services.tournament_permissions import result_staff_user_ids

    w = await world(flow)
    lead = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    helper = await flow.add_user(name="Helfer")
    await flow.db.tournament_staff_assignments.insert_one(
        {"id": new_id(), "tournament_id": w["tournament"]["id"], "user_id": helper["id"], "role": "referee", "scope": "tournament"})
    decider = await holder(flow, w, "disputes")
    roster = await holder(flow, w, "roster")
    grant = await flow.add_user(name="Bereich Ligen")
    await flow.db.users.update_one({"id": grant["id"]}, {"$set": {"areas": ["leagues"]}})

    ids = await result_staff_user_ids(flow.db, w["match"])
    assert decider["id"] in ids and grant["id"] in ids and w["staff"]["id"] in ids
    assert lead["id"] not in ids and helper["id"] not in ids and roster["id"] not in ids


@pytest.mark.asyncio
async def test_duty_lists_the_own_leagues(flow):
    w = await world(flow)
    await flow.db.leagues.insert_one({"id": "liga", "name": "Probeliga", "slug": "probeliga"})
    flow.act_as(await holder(flow, w, "roster", "results"))
    duty = (await flow.get("/api/users/me/duty")).json()
    assert duty["leagues"] == [{"id": "liga", "name": "Probeliga", "slug": "probeliga", "capabilities": ["results", "roster"]}]


@pytest.mark.asyncio
async def test_league_area_uses_the_staff_stream(flow):
    from services.change_events import visibility_scope_for_user

    confirmed = {"id": "a", "role": "player", "areas": ["leagues"], "mfa_enabled": True, "auth_mfa_verified": True}
    assert visibility_scope_for_user(confirmed) == "staff"
    assert visibility_scope_for_user({**confirmed, "auth_mfa_verified": False}) == "public"


@pytest.mark.asyncio
async def test_tournament_lead_duty_has_no_staffel(flow):
    w = await world(flow)
    flow.act_as(await flow.add_user(role="tournament_admin", name="Turnierleitung"))
    duty = (await flow.get("/api/users/me/duty")).json()
    assert w["tournament"]["id"] not in [row.get("id") for row in duty["lead_today"]]


# ---------------------------------------------------------------- Seitentüren am Bereich Turnierleitung

async def both_rights(flow) -> dict:
    person = await flow.add_user(role="tournament_admin", name="Beides")
    person["areas"] = ["leagues"]
    return person


@pytest.mark.asyncio
async def test_access_links_at_a_staffel_need_league_rights_too(flow):
    w = await world(flow)
    tid = w["tournament"]["id"]
    body = {"target_type": "tournament", "target_id": tid, "grants": ["view"]}
    flow.act_as(await both_rights(flow))
    made = await flow.post("/api/access-links", json=body)
    assert made.status_code == 200, made.text

    flow.act_as(await flow.add_user(role="tournament_admin", name="Nur Turniere"))
    assert (await flow.post("/api/access-links", json=body)).status_code == 403
    assert (await flow.get(f"/api/access-links?target_type=tournament&target_id={tid}")).status_code == 403
    assert tid not in [row.get("target_id") for row in (await flow.get("/api/access-links")).json()]
    revoked = await flow.delete(f"/api/access-links/{made.json()['id']}")
    assert revoked.status_code == 403


@pytest.mark.asyncio
async def test_tv_keys_at_a_staffel_need_league_rights_too(flow):
    w = await world(flow)
    tid = w["tournament"]["id"]
    flow.act_as(await flow.add_user(role="tournament_admin", name="Nur Turniere"))
    assert (await flow.post("/api/tv/keys", json={"tournament_id": tid, "label": "Beamer"})).status_code == 403
    assert (await flow.get(f"/api/tv/keys?tournament_id={tid}")).status_code == 403
    flow.act_as(await both_rights(flow))
    assert (await flow.post("/api/tv/keys", json={"tournament_id": tid, "label": "Beamer"})).status_code == 200


@pytest.mark.asyncio
async def test_stations_at_a_staffel_need_league_rights_too(flow):
    w = await world(flow)
    tid = w["tournament"]["id"]
    body = {"name": "PC 1", "device_type": "pc", "tournament_id": tid}
    flow.act_as(await flow.add_user(role="tournament_admin", name="Nur Turniere"))
    assert (await flow.post("/api/stations", json=body)).status_code == 403
    assert (await flow.post("/api/stations/bulk", json={"tournament_id": tid, "count": 2})).status_code == 403
    flow.act_as(await both_rights(flow))
    assert (await flow.post("/api/stations", json=body)).status_code == 200


@pytest.mark.asyncio
async def test_a_staffel_stays_out_of_the_event_program(flow):
    w = await world(flow)
    event = {"id": new_id(), "name": "Probe-Event", "slug": "probe-event", "status": "published", "start_date": "2027-01-01"}
    await flow.db.events.insert_one(dict(event))
    flow.act_as(await flow.add_user(role="tournament_admin", name="Nur Turniere"))
    response = await flow.post(f"/api/events/{event['id']}/program", json={"kind": "tournament", "item_id": w["tournament"]["id"]})
    assert response.status_code == 409
    assert (await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})).get("event_id") is None


@pytest.mark.asyncio
async def test_operational_matches_follow_league_rights(flow):
    from services.match_overview import operational_match_overviews

    w = await world(flow)
    match = w["match"]["id"]
    lead = await flow.add_user(role="tournament_admin", name="Nur Turniere")
    assert match not in [row["id"] for row in await operational_match_overviews(flow.db, lead)]
    helper = await flow.add_user(name="Helfer")
    await flow.db.tournament_staff_assignments.insert_one(
        {"id": new_id(), "tournament_id": w["tournament"]["id"], "user_id": helper["id"], "role": "referee", "scope": "tournament"})
    assert match not in [row["id"] for row in await operational_match_overviews(flow.db, helper)]
    decider = await holder(flow, w, "results")
    assert match in [row["id"] for row in await operational_match_overviews(flow.db, decider)]
    assert match not in [row["id"] for row in await operational_match_overviews(flow.db, await holder(flow, w, "roster"))]


@pytest.mark.asyncio
async def test_the_list_hides_the_plans_of_a_staffel_from_the_tournament_lead(flow):
    w = await world(flow)
    tid = w["tournament"]["id"]
    await flow.db.tournaments.update_one({"id": tid}, {"$set": {"participant_removal_plan": {"id": "plan"}}})
    flow.act_as(await flow.add_user(role="tournament_admin", name="Nur Turniere"))
    rows = (await flow.get("/api/tournaments?include_drafts=true&managed=true")).json()
    assert "participant_removal_plan" not in next(row for row in rows if row["id"] == tid)
    assert "participant_removal_plan" not in (await flow.get(f"/api/tournaments/{tid}")).json()
    # Am Turnier selbst: wer ihn bestätigen darf - in der Staffel „Teams freigeben“ (Austritt) oder „Season konfigurieren“.
    flow.act_as(await holder(flow, w, "applications"))
    assert "participant_removal_plan" in (await flow.get(f"/api/tournaments/{tid}")).json()
    flow.act_as(await holder(flow, w, "roster"))
    assert "participant_removal_plan" not in (await flow.get(f"/api/tournaments/{tid}")).json()


# ---------------------------------------------------------------- Vergabe der Zuständigen

async def league_with_area(flow) -> tuple[dict, dict, dict]:
    w = await world(flow)
    await flow.db.leagues.insert_one({"id": "liga", "name": "Probeliga", "slug": "probeliga", "status": "active"})
    area = await flow.add_user(name="Ligaleitung")
    area["areas"] = ["leagues"]
    return w, area, await flow.add_user(name="Zielperson")


@pytest.mark.asyncio
async def test_grant_update_revoke_are_logged_and_told(flow):
    w, area, target = await league_with_area(flow)
    flow.act_as(area)
    url = f"/api/admin/leagues/liga/staff/{target['id']}"

    granted = await flow.put(url, json={"capabilities": ["results", "manage", "results"]})
    assert granted.status_code == 200, granted.text
    assert granted.json()["capabilities"] == ["manage", "results"]
    again = await flow.put(url, json={"capabilities": ["manage", "results"]})
    assert again.json()["idempotent_replay"] is True
    assert await flow.db.league_staff.count_documents({"league_id": "liga", "user_id": target["id"]}) == 1

    assert (await flow.put(url, json={"capabilities": ["roster"]})).status_code == 200
    removed = await flow.delete(url)
    assert removed.json() == {"ok": True, "idempotent_replay": False}
    removed_again = await flow.delete(url)
    assert removed_again.json()["idempotent_replay"] is True

    logged = await flow.db.audit_logs.find({"action": {"$regex": "^league.staff"}}, {"_id": 0}).sort("created_at", 1).to_list(10)
    assert [row["action"] for row in logged] == ["league.staff.grant", "league.staff.update", "league.staff.revoke"]
    assert logged[0]["data"] == {"user_id": target["id"], "capabilities": ["manage", "results"], "from": []}
    assert logged[1]["data"]["from"] == ["manage", "results"]
    assert logged[2]["actor_id"] == area["id"]
    told = await flow.db.notifications.find({"user_id": target["id"], "kind": "rights_change"}, {"_id": 0}).to_list(10)
    assert len(told) == 3
    assert "Probeliga" in told[0]["body"] and "Liga verwalten" in told[0]["body"]


@pytest.mark.asyncio
@pytest.mark.parametrize("capabilities,status", [([], 422), (["gibtsnicht"], 422), (["results", "gibtsnicht"], 422)])
async def test_grant_refuses_bad_lists(flow, capabilities, status):
    w, area, target = await league_with_area(flow)
    flow.act_as(area)
    assert (await flow.put(f"/api/admin/leagues/liga/staff/{target['id']}", json={"capabilities": capabilities})).status_code == status
    assert await flow.db.league_staff.count_documents({}) == 0


@pytest.mark.asyncio
async def test_grant_refuses_unknown_and_banned_accounts_and_leagues(flow):
    w, area, target = await league_with_area(flow)
    flow.act_as(area)
    assert (await flow.put("/api/admin/leagues/liga/staff/niemand", json={"capabilities": ["roster"]})).status_code == 404
    await flow.db.users.update_one({"id": target["id"]}, {"$set": {"is_banned": True}})
    assert (await flow.put(f"/api/admin/leagues/liga/staff/{target['id']}", json={"capabilities": ["roster"]})).status_code == 404
    assert (await flow.put(f"/api/admin/leagues/keine/staff/{w['users']['Ida']['id']}", json={"capabilities": ["roster"]})).status_code == 404


@pytest.mark.asyncio
async def test_manage_holder_reads_but_cannot_grant_himself_more(flow):
    w, area, target = await league_with_area(flow)
    manager = await holder(flow, w, "manage")
    flow.act_as(manager)
    listed = (await flow.get("/api/admin/leagues/liga/staff")).json()
    assert listed["can_grant"] is False
    assert [row["user_id"] for row in listed["staff"]] == [manager["id"]]
    assert listed["staff"][0]["second_factor"] is True
    assert (await flow.put(f"/api/admin/leagues/liga/staff/{manager['id']}", json={"capabilities": list(("manage", "results"))})).status_code == 403
    refused = await flow.delete(f"/api/admin/leagues/liga/staff/{target['id']}")
    assert refused.status_code == 403


@pytest.mark.asyncio
async def test_staff_only_sees_his_leagues_with_his_capabilities(flow):
    w, area, _target = await league_with_area(flow)
    await flow.db.leagues.insert_one({"id": "andere", "name": "Andere", "slug": "andere", "status": "active"})
    await flow.db.league_seasons.insert_one({"id": "s-andere", "league_id": "andere", "number": 1, "name": "S", "slug": "s", "status": "draft"})
    person = await holder(flow, w, "roster")
    flow.act_as(person)
    listed = (await flow.get("/api/admin/leagues")).json()
    assert [row["id"] for row in listed["leagues"]] == ["liga"]
    assert listed["leagues"][0]["capabilities"] == ["roster"] and listed["can_create"] is False
    assert (await flow.get("/api/admin/leagues/seasons/s-andere")).status_code == 403

    flow.act_as(area)
    listed = (await flow.get("/api/admin/leagues")).json()
    assert {row["id"] for row in listed["leagues"]} == {"liga", "andere"} and listed["can_create"] is True


@pytest.mark.asyncio
async def test_deleting_a_league_ends_its_staff(flow):
    _w, area, _target = await league_with_area(flow)
    await flow.db.leagues.insert_one({"id": "leer", "name": "Leer", "slug": "leer", "status": "active"})
    person = await flow.add_user(name="Zuständig")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "leer", "user_id": person["id"], "capabilities": ["roster"]})
    flow.act_as(area)
    response = await flow.client.request("DELETE", "/api/admin/leagues/leer", json={"reason": "Testfall aufräumen"})
    assert response.status_code == 200, response.text
    assert await flow.db.league_staff.count_documents({"league_id": "leer"}) == 0


@pytest.mark.asyncio
async def test_me_tells_about_duty_and_areas(flow):
    from routes.auth_routes import with_areas

    w = await world(flow)
    person = await holder(flow, w, "roster")
    assert (await with_areas(person))["has_league_staff"] is True
    assert (await with_areas(w["users"]["Fremd"]))["has_league_staff"] is False
    assert "leagues" in (await with_areas(w["staff"]))["areas"]
    assert "leagues" not in (await with_areas(await flow.add_user(role="tournament_admin")))["areas"]
    assert "leagues" in (await with_areas(await flow.add_user(role="club_admin")))["areas"]


@pytest.mark.asyncio
async def test_superadmin_grants_the_area_with_the_usual_route(flow):
    w = await world(flow)
    target = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(w["staff"])
    response = await flow.put(f"/api/users/{target['id']}/areas", json={"areas": ["leagues"]})
    assert response.status_code == 200, response.text
    assert (await flow.db.users.find_one({"id": target["id"]}, {"_id": 0, "areas": 1}))["areas"] == ["leagues"]
    told = await flow.db.notifications.find_one({"user_id": target["id"], "kind": "rights_change"}, {"_id": 0})
    assert "Ligen" in told["body"]


@pytest.mark.asyncio
async def test_no_migration_grants_rights(flow):
    """Keine automatische Vergabe: Der Start ändert an Konten mit Turnierleitung nichts."""
    from database import init_indexes

    target = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    await init_indexes()
    stored = await flow.db.users.find_one({"id": target["id"]}, {"_id": 0})
    assert "areas" not in stored
    assert await flow.db.league_staff.count_documents({}) == 0


# ---------------------------------------------------------------- Regression: normale Turniere wie bisher

async def normal_match(flow, **tournament_fields):
    tournament, users, regs = await flow.with_participants(2, status="live", **tournament_fields)
    match = {"id": new_id(), "tournament_id": tournament["id"], "stage_id": new_id(), "match_type": "duel", "status": "scheduled", "round": 1,
             "slots": [{"slot": 1, "status": "filled", "registration_id": regs[0]["id"]},
                       {"slot": 2, "status": "filled", "registration_id": regs[1]["id"]}]}
    await flow.db.matches_v2.insert_one(dict(match))
    return tournament, users, regs, match


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["organizer", "referee", "scorekeeper", "station_manager"])
async def test_helpers_keep_results_in_normal_tournaments(flow, role):
    from services.tournament_permissions import has_match_result_permission

    tournament, _users, _regs, match = await normal_match(flow)
    helper = await flow.add_user(name="Helfer")
    await flow.db.tournament_staff_assignments.insert_one(
        {"id": new_id(), "tournament_id": tournament["id"], "user_id": helper["id"], "role": role, "scope": "tournament"})
    assert await has_match_result_permission(helper, match) is True
    assert await has_match_result_permission(await flow.add_user(name="Niemand"), match) is False


@pytest.mark.asyncio
async def test_tournament_lead_keeps_everything_in_normal_tournaments(flow):
    tournament, _users, regs, match = await normal_match(flow)
    lead = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(lead)
    view = (await flow.get(f"/api/tournaments/{tournament['id']}")).json()
    assert view["can_manage_results"] and view["can_manage_structure"] and view["can_manage_participants"]
    assert "league_capabilities" not in view
    body = {"results": [{"registration_id": regs[0]["id"], "rank": 1, "score": 2}, {"registration_id": regs[1]["id"], "rank": 2, "score": 0}]}
    assert (await flow.post(f"/api/matches/{match['id']}/result", json=body)).status_code == 200
    assert (await flow.get(f"/api/exports/tournaments/{tournament['id']}/participants.pdf")).status_code == 200
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/staff")).status_code == 200


@pytest.mark.asyncio
async def test_involved_lead_of_a_normal_tournament_still_enters(flow):
    """Befangenheit gibt es nur in der Liga: Eine Turnierleitung, die mitspielt, bleibt wie bisher."""
    tournament, users, regs, match = await normal_match(flow)
    flow.act_as({**users[0], "role": "tournament_admin"})
    body = {"results": [{"registration_id": regs[0]["id"], "rank": 1, "score": 2}, {"registration_id": regs[1]["id"], "rank": 2, "score": 0}]}
    assert (await flow.post(f"/api/matches/{match['id']}/result", json=body)).status_code == 200
    assert await overrides(flow) == []


@pytest.mark.asyncio
async def test_leagues_area_gives_nothing_in_normal_tournaments(flow):
    tournament, _users, regs, match = await normal_match(flow)
    area = await flow.add_user(name="Bereich Ligen")
    area["areas"] = ["leagues"]
    flow.act_as(area)
    assert (await flow.patch(f"/api/tournaments/{tournament['id']}", json={"description": "Neu"})).status_code == 403
    body = {"results": [{"registration_id": regs[0]["id"], "rank": 1, "score": 2}, {"registration_id": regs[1]["id"], "rank": 2, "score": 0}]}
    assert (await flow.post(f"/api/matches/{match['id']}/result", json=body)).status_code == 403
    assert (await flow.get(f"/api/exports/tournaments/{tournament['id']}/participants.pdf")).status_code == 403


@pytest.mark.asyncio
async def test_tournament_lead_without_second_factor_hears_the_same(flow):
    tournament, *_rest = await normal_match(flow)
    lead = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    lead["auth_mfa_verified"] = False
    flow.act_as(lead)
    response = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"description": "Neu"})
    assert response.status_code == 403
    assert "Zwei-Faktor" in response.json()["detail"]


@pytest.mark.asyncio
async def test_missing_second_factor_is_named_for_league_rights(flow):
    w = await world(flow)
    person = await holder(flow, w, "manage")
    person["auth_mfa_verified"] = False
    flow.act_as(person)
    response = await flow.patch("/api/admin/leagues/liga", json={"description": "Neu"})
    assert response.status_code == 403
    assert "Zwei-Faktor" in response.json()["detail"]
    area = await flow.add_user(name="Bereich Ligen")
    area["areas"] = ["leagues"]
    area["auth_mfa_verified"] = False
    flow.act_as(area)
    response = await flow.post(f"/api/matches/{w['match']['id']}/result", json=result_body(w))
    assert response.status_code == 403
