"""E.1 Tabelle (#1625, docs/LIGA.md): Gleichstand mit Entscheid der Leitung, Austritt mit allen Spielen für die Gegner und
„beide nicht erschienen“ - über die echten Routen, gelesen auf Ligaseite, Turnierseite und in der Verwaltung. Nur
erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402

ADMIN = "/api/admin/leagues"
TABLE = "/api/admin/leagues/staffeln"
PAGE = "/api/leagues/probe-shooter/season-1"
SEASON = {"start_date": "2026-11-10T00:00:00", "visibility": "public"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow, *, season: dict | None = None, teams: int = 4):
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = (await flow.post("/api/games", json={"name": "Probe Shooter", "slug": "probe-shooter"})).json()
    league = (await flow.post(ADMIN, json={"name": "Probe-Liga", "game_id": game["id"]})).json()
    season_doc = (await flow.post(f"{ADMIN}/{league['id']}/seasons", json={**SEASON, **(season or {})})).json()
    division = (await flow.post(f"{ADMIN}/seasons/{season_doc['id']}/divisions", json={})).json()
    created = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    staffel = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
    for index in range(1, teams + 1):
        await flow.db.teams.insert_one({"id": f"team-{index}", "name": f"Probe {index}", "member_ids": []})
        await flow.db.tournament_registrations.insert_one({
            "id": f"reg-{index}", "tournament_id": staffel["id"], "team_id": f"team-{index}", "status": "approved",
            "registration_type": "team", "display_name": f"Probe {index}", "identity_key": f"{staffel['id']}:team:team-{index}"})
    started = await flow.post(f"/api/tournaments/{staffel['id']}/status", json={"status": "live"})
    assert started.status_code == 200, started.text
    return admin, league, staffel


async def matches_of(flow, staffel, round_number=None):
    query = {"tournament_id": staffel["id"], "is_preview": {"$ne": True}}
    if round_number is not None:
        query["round"] = round_number
    return await flow.db.matches_v2.find(query, {"_id": 0}).sort("order", 1).to_list(100)


async def result(flow, match, home_score, away_score):
    home, away = [slot["registration_id"] for slot in match["slots"]]
    winner, loser = (home, away) if home_score > away_score else (away, home)
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
        "status": "completed", "completed_at": now_utc().isoformat(),
        "results": [{"registration_id": winner, "rank": 1, "score": max(home_score, away_score)},
                    {"registration_id": loser, "rank": 2, "score": min(home_score, away_score)}]}})
    return winner, loser


async def page(flow, staffel):
    response = await flow.get(f"{PAGE}/staffeln/{staffel['slug']}")
    assert response.status_code == 200, response.text
    return response.json()


async def two_ties(flow, staffel):
    """Spieltag 1: zwei Sieger 2:1, zwei Verlierer 1:2 - ohne Spiel untereinander stehen sie in allem gleich."""
    winners, losers = [], []
    for match in await matches_of(flow, staffel, 1):
        winner, loser = await result(flow, match, 2, 1)
        winners.append(winner)
        losers.append(loser)
    return winners, losers


@pytest.mark.asyncio
async def test_a_real_tie_is_shared_until_the_lead_decides_it_with_a_reason(flow):
    admin, _league, staffel = await setup(flow)
    winners, losers = await two_ties(flow, staffel)

    overview = (await flow.get(f"{TABLE}/{staffel['id']}/table")).json()
    assert overview["can_decide"] is True and overview["rules"]["tiebreakers"][-1] == "lead_decision"
    assert sorted(sorted(tie["registration_ids"]) for tie in overview["ties"]) == sorted([sorted(winners), sorted(losers)])

    # Nur bei echtem Gleichstand und mit Grund.
    mixed = await flow.put(f"{TABLE}/{staffel['id']}/table-decision", json={"registration_ids": [winners[0], losers[0]], "reason": "Losentscheid"})
    assert mixed.status_code == 409
    short = await flow.put(f"{TABLE}/{staffel['id']}/table-decision", json={"registration_ids": winners, "reason": "los"})
    assert short.status_code == 422
    ordered = [winners[1], winners[0]]
    response = await flow.put(f"{TABLE}/{staffel['id']}/table-decision",
                              json={"registration_ids": ordered, "reason": "Losentscheid vor beiden Captains"})
    assert response.status_code == 200, response.text
    decision = response.json()

    flow.act_as(None)
    rows = (await page(flow, staffel))["standings"]
    assert [row["registration_id"] for row in rows[:2]] == ordered and [row["rank"] for row in rows[:2]] == [1, 2]
    assert rows[0]["tiebreak"] == "lead_decision" and rows[0]["lead_decision"]["reason"] == "Losentscheid vor beiden Captains"
    assert [row["rank"] for row in rows[2:]] == [3, 3]
    turnier = (await flow.get(f"/api/tournaments/{staffel['id']}/standings")).json()
    assert [row["registration_id"] for row in turnier] == [row["registration_id"] for row in rows]

    flow.act_as(admin)
    overview = (await flow.get(f"{TABLE}/{staffel['id']}/table")).json()
    assert [entry["applies"] for entry in overview["decisions"]] == [True]
    audit = await flow.db.audit_logs.find_one({"action": "league.table.decision"}, {"_id": 0})
    assert audit["data"]["reason"] == "Losentscheid vor beiden Captains" and audit["target_id"] == staffel["id"]

    # Ändert ein Ergebnis den Gleichstand, gilt der Entscheid nicht mehr - er bleibt stehen.
    second = next(match for match in await matches_of(flow, staffel, 2)
                  if winners[1] in [slot["registration_id"] for slot in match["slots"]])
    await result(flow, second, 2, 0 if winners[1] == second["slots"][0]["registration_id"] else 2)
    overview = (await flow.get(f"{TABLE}/{staffel['id']}/table")).json()
    assert overview["decisions"][0]["id"] == decision["id"]

    removed = await flow.client.request("DELETE", f"{TABLE}/{staffel['id']}/table-decision/{decision['id']}", json={"reason": "Ergebnis korrigiert"})
    assert removed.status_code == 200, removed.text
    assert (await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0}))["table_decisions"] == []


@pytest.mark.asyncio
async def test_only_results_may_decide_and_never_about_the_own_team(flow):
    admin, league, staffel = await setup(flow)
    winners, _losers = await two_ties(flow, staffel)
    planner = await flow.add_user(name="Planerin")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league["id"], "user_id": planner["id"],
                                           "capabilities": ["matches"], "created_at": now_utc().isoformat()})
    flow.act_as(planner)
    assert (await flow.get(f"{TABLE}/{staffel['id']}/table")).status_code == 200
    denied = await flow.put(f"{TABLE}/{staffel['id']}/table-decision", json={"registration_ids": winners, "reason": "Losentscheid"})
    assert denied.status_code == 403

    judge = await flow.add_user(name="Leitung im Team")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league["id"], "user_id": judge["id"],
                                           "capabilities": ["results"], "created_at": now_utc().isoformat()})
    own = await flow.db.tournament_registrations.find_one({"id": winners[0]}, {"_id": 0})
    await flow.db.teams.update_one({"id": own["team_id"]}, {"$set": {"leader_id": judge["id"]}})
    flow.act_as(judge)
    conflict = await flow.put(f"{TABLE}/{staffel['id']}/table-decision", json={"registration_ids": winners, "reason": "Losentscheid"})
    assert conflict.status_code == 403
    flow.act_as(None)
    assert (await flow.get(f"{TABLE}/{staffel['id']}/table")).status_code == 401


@pytest.mark.asyncio
async def test_without_lead_decision_in_the_rules_the_place_stays_shared(flow):
    _admin, _league, staffel = await setup(flow, season={"scoring_rules": {"table_tiebreakers": ["head_to_head", "score_diff"]}})
    winners, _losers = await two_ties(flow, staffel)
    response = await flow.put(f"{TABLE}/{staffel['id']}/table-decision", json={"registration_ids": winners, "reason": "Losentscheid"})
    assert response.status_code == 409
    assert "teilen sich den Platz" in response.json()["detail"]


@pytest.mark.asyncio
async def test_a_team_that_withdraws_loses_every_game_and_stands_at_the_end(flow):
    _admin, _league, staffel = await setup(flow)
    first_round = await matches_of(flow, staffel, 1)
    leaver = first_round[0]["slots"][0]["registration_id"]
    beaten = first_round[0]["slots"][1]["registration_id"]
    await result(flow, first_round[0], 2, 0)  # das spätere Austrittsteam gewinnt 2:0
    for match in first_round[1:]:
        await result(flow, match, 2, 1)

    proposed = await flow.post(f"/api/tournaments/{staffel['id']}/registrations/{leaver}/removal",
                               json={"kind": "withdrawn", "reason": "Team aufgelöst"})
    assert proposed.status_code == 200, proposed.text
    plan = proposed.json()["plan"]
    assert plan["mode"] == "opponents" and "zählen für die Gegner" in plan["summary"]
    confirmed = await flow.post(f"/api/tournaments/{staffel['id']}/registrations/{leaver}/removal",
                                json={"kind": "withdrawn", "plan_id": plan["id"]})
    assert confirmed.status_code == 200, confirmed.text

    flow.act_as(None)
    data = await page(flow, staffel)
    rows = {row["registration_id"]: row for row in data["standings"]}
    assert data["standings"][-1]["registration_id"] == leaver
    assert rows[leaver]["exit"]["kind"] == "withdrawn" and rows[leaver]["exit"]["at"]
    assert rows[leaver]["points"] == 0 and rows[leaver]["played"] == 3
    assert rows[beaten]["points"] == 3 and rows[beaten]["forfeit_won"] == 1
    assert (rows[beaten]["score_for"], rows[beaten]["score_against"]) == (2, 0)  # Best of 3: 2:0 statt 0:2
    # Das echte Ergebnis bleibt im Spielplan sichtbar, mit dem Namen des Teams.
    played = next(match for week in data["weeks"] for match in week.get("matches") or [] if match["id"] == first_round[0]["id"])
    assert played["winner_registration_id"] == leaver and played["home"]["name"] == "Probe " + leaver.split("-")[1]
    assert leaver not in [team["id"] for team in data["teams"]]
    assert data["staffel"]["table_rules"]["exit_rule"] == "all_for_opponents"


@pytest.mark.asyncio
async def test_both_no_show_lose_and_the_lead_can_set_the_game_again(flow):
    admin, _league, staffel = await setup(flow)
    match = (await matches_of(flow, staffel, 1))[0]
    url = f"{TABLE}/{staffel['id']}/matches/{match['id']}/double-no-show"
    assert (await flow.post(url, json={"note": "kurz"})).status_code == 422
    response = await flow.post(url, json={"note": "Beide Teams nicht in der Lobby"})
    assert response.status_code == 200, response.text
    stored = response.json()
    assert stored["status"] == "forfeit" and stored["double_forfeit"] is True
    assert all(row["forfeit"] and row["rank"] == 2 for row in stored["results"])
    assert (await flow.post(url, json={"note": "Beide Teams nicht in der Lobby"})).status_code == 409

    flow.act_as(None)
    data = await page(flow, staffel)
    sides = [slot["registration_id"] for slot in match["slots"]]
    rows = {row["registration_id"]: row for row in data["standings"]}
    for side in sides:
        assert (rows[side]["played"], rows[side]["lost"], rows[side]["points"], rows[side]["score_for"]) == (1, 1, 0, 0)
        assert rows[side]["forfeit_lost"] == 1 and rows[side]["form"] == ["L"]
    shown = next(item for week in data["weeks"] for item in week.get("matches") or [] if item["id"] == match["id"])
    assert shown["double_forfeit"] is True and shown["winner_registration_id"] is None

    flow.act_as(admin)
    undone = await flow.client.request("DELETE", url, json={"reason": "Neuer Termin vereinbart"})
    assert undone.status_code == 200, undone.text
    assert undone.json()["status"] in {"scheduled", "ready"} and undone.json()["results"] == []
    assert "double_forfeit" not in undone.json()
    actions = {row["action"] for row in await flow.db.audit_logs.find({}, {"_id": 0, "action": 1}).to_list(500)}
    assert {"match.forfeit.double", "match.forfeit.double.undo"} <= actions

    other = (await matches_of(flow, staffel, 2))[0]
    await result(flow, other, 2, 1)
    refused = await flow.post(f"{TABLE}/{staffel['id']}/matches/{other['id']}/double-no-show", json={"note": "Beide nicht da"})
    assert refused.status_code == 409


NOTE = {"note": "Beide Teams nicht in der Lobby"}


@pytest.mark.asyncio
async def test_both_no_show_only_before_the_game_starts_and_with_the_side_effects(flow, monkeypatch):
    """Codex zu E.1: nicht nach Spielbeginn, nicht mit Meldung oder gehaltenem Ergebnis - und dieselben Nebenwirkungen wie
    beim kampflos (Station frei, Discord vorgemerkt), auch beim Neu ansetzen."""
    from services import discord_bracket, station_runtime

    _admin, _league, staffel = await setup(flow)
    refreshed, released = [], []
    monkeypatch.setattr(discord_bracket, "request_refresh", lambda tid: refreshed.append(tid))

    async def release(_db, match, _collection):
        released.append(match["id"])
    monkeypatch.setattr(station_runtime, "release_station_for_match", release)
    first, second = (await matches_of(flow, staffel, 1))[:2]
    side = first["slots"][0]["registration_id"]
    url = f"{TABLE}/{staffel['id']}/matches/{first['id']}/double-no-show"
    original = await flow.db.matches_v2.find_one({"id": first["id"]}, {"_id": 0})
    for change in ({"status": "in_progress", "started_at": now_utc().isoformat()}, {"status": "waiting_result"},
                   {"started_at": now_utc().isoformat()},
                   {"reports": [{"registration_id": side, "results": [{"registration_id": side, "rank": 1}]}]},
                   {"pending_result": {"id": "hold-1", "results": []}}):
        await flow.db.matches_v2.update_one({"id": first["id"]}, {"$set": change})
        refused = await flow.post(url, json=NOTE)
        assert refused.status_code == 409, change
        await flow.db.matches_v2.replace_one({"id": first["id"]}, dict(original))
    assert refreshed == [] and released == []

    await flow.db.matches_v2.update_one({"id": second["id"]}, {"$set": {"station_id": "station-1"}})
    url = f"{TABLE}/{staffel['id']}/matches/{second['id']}/double-no-show"
    response = await flow.post(url, json=NOTE)
    assert response.status_code == 200, response.text
    assert released == [second["id"]] and refreshed == [staffel["id"]]
    undone = await flow.client.request("DELETE", url, json={"reason": "Neuer Termin vereinbart"})
    assert undone.status_code == 200, undone.text
    assert refreshed == [staffel["id"], staffel["id"]]


@pytest.mark.asyncio
async def test_removing_a_decision_respects_the_conflict(flow):
    """Codex zu E.1: Zurücknehmen eines Entscheids prüft die Befangenheit - der Superadmin nur als Notausnahme mit Grund,
    die im Protokoll steht."""
    admin, league, staffel = await setup(flow)
    winners, _losers = await two_ties(flow, staffel)
    decision = (await flow.put(f"{TABLE}/{staffel['id']}/table-decision",
                               json={"registration_ids": winners[::-1], "reason": "Losentscheid vor Zeugen"})).json()
    own = await flow.db.tournament_registrations.find_one({"id": winners[0]}, {"_id": 0})
    judge = await flow.add_user(name="Leitung im Team")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league["id"], "user_id": judge["id"],
                                           "capabilities": ["results"], "created_at": now_utc().isoformat()})
    await flow.db.teams.update_one({"id": own["team_id"]}, {"$set": {"leader_id": judge["id"]}})
    remove = f"{TABLE}/{staffel['id']}/table-decision/{decision['id']}"
    flow.act_as(judge)
    assert (await flow.client.request("DELETE", remove, json={"reason": "Ergebnis korrigiert"})).status_code == 403

    await flow.db.teams.update_one({"id": own["team_id"]}, {"$set": {"leader_id": admin["id"]}})
    flow.act_as(admin)
    assert (await flow.client.request("DELETE", remove, json={"reason": "Ergebnis korrigiert"})).status_code == 403
    allowed = await flow.client.request("DELETE", remove, json={"reason": "Ergebnis korrigiert",
                                                                "conflict_reason": "Keine zweite Person erreichbar"})
    assert allowed.status_code == 200, allowed.text
    overrides = [row["data"]["action"] for row in await flow.db.audit_logs.find({"action": "league.conflict.override"}, {"_id": 0}).to_list(50)]
    assert "table_decision_remove" in overrides
