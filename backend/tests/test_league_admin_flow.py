"""Liga-Rahmen (docs/LIGA.md, P1, #1622): Liga → Season → Liga N → Staffel anlegen, Vorgaben übertragen, Rechte.

Eine Staffel ist ein Turnier mit ``league_context``. Beim Anlegen kopiert der Liga-Service alle Vorgaben der Season (und
der Liga N) ins Turnier, prüft „Runden ≤ aktive Wochen“ und übernimmt den Map-Pool der Season als eigene Version.
Später übertragene Vorgaben halten die Grenzen aus Abschnitt 3 ein. Nur erfundene Namen.
"""
import pathlib
import sys
from datetime import date

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import league_service, map_pools  # noqa: E402
from services.scoring_rules import normalize_rules  # noqa: E402

ADMIN = "/api/admin/leagues"
SHOOTER = {
    "name": "Probe Shooter",
    "slug": "probe-shooter",
    "match_modes": [
        {"mode": "stellung", "label": "Stellung"},
        {"mode": "snd", "label": "Suchen & Zerstören"},
    ],
}
# Season 1 laut Fabians Entscheidungen (27.10.): Di 10.11. 00:00 Wien, 10 Wochen, Weihnachtspause 21.12.–3.1.
SEASON_ONE = {
    "start_date": "2026-11-10T00:00:00",
    "blocked_periods": [{"start_date": "2026-12-21", "end_date": "2027-01-03", "label": "Weihnachtspause"}],
    "rules_text": "## Regeln\nFair spielen.",
    "registration_deadline": "2026-11-06",
}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup_league(flow, *, season: dict | None = None, with_pool: bool = True):
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = (await flow.post("/api/games", json=SHOOTER)).json()
    maps = {}
    for name, modes in (("Hafenkante", ["stellung", "snd"]), ("Nebelwerk", ["snd"])):
        created = await flow.post(f"/api/games/{game['id']}/maps", json={"name": name, "modes": modes})
        assert created.status_code == 200, created.text
        maps[name] = created.json()
    league = await flow.post(ADMIN, json={"name": "Probe-Liga", "game_id": game["id"]})
    assert league.status_code == 200, league.text
    league = league.json()
    created = await flow.post(f"{ADMIN}/{league['id']}/seasons", json={**SEASON_ONE, **(season or {})})
    assert created.status_code == 200, created.text
    season_doc = created.json()
    if with_pool:
        pool = await flow.put(f"{ADMIN}/seasons/{season_doc['id']}/map-pool", json={"modes": [
            {"mode": "stellung", "map_ids": [maps["Hafenkante"]["id"]]},
            {"mode": "snd", "map_ids": [maps["Nebelwerk"]["id"], maps["Hafenkante"]["id"]]}]})
        assert pool.status_code == 200, pool.text
    division = await flow.post(f"{ADMIN}/seasons/{season_doc['id']}/divisions", json={})
    assert division.status_code == 200, division.text
    return admin, game, league, season_doc, division.json(), maps


async def audit_actions(flow) -> list[str]:
    return [row["action"] for row in await flow.db.audit_logs.find({}, {"_id": 0}).to_list(None)]


# ---------------------------------------------------------------- Anlegen mit Vorgaben

@pytest.mark.asyncio
async def test_a_season_starts_with_the_documented_defaults(flow):
    _admin, game, league, season, division, _maps = await setup_league(flow)

    assert league["slug"] == "probe-shooter"  # Vorgabe: der Slug des Spiels
    assert league["participant_kind"] == "team" and league["status"] == "active"
    assert season["number"] == 1 and season["name"] == "Season 1" and season["slug"] == "season-1"
    assert season["weeks_total"] == 10 and season["matchday_days"] == 7
    assert season["default_match_weekday"] == 6 and season["default_match_time"] == "20:00"
    assert season["round_robin_legs"] == 1 and season["max_staffel_size"] == 8
    assert season["best_of"] == 3 and season["team_size"] == 4 and season["min_squad_size"] == 4
    assert season["result_confirm_hours"] == 48 and season["lineup_amend_hours"] == 48
    assert season["visibility"] == "off" and season["status"] == "draft"
    assert season["scoring_rules"] == normalize_rules({})
    assert season["start_date"] == "2026-11-09T23:00:00+00:00"  # 00:00 Wien
    assert season["blocked_periods"][0]["label"] == "Weihnachtspause"
    assert season["registration_deadline"] == "2026-11-06"
    assert division["level"] == 1 and division["overrides"] == {}

    view = (await flow.get(f"{ADMIN}/seasons/{season['id']}")).json()
    assert view["calendar"]["blocked_weeks"] == [7, 8]
    assert view["calendar"]["active_weeks"] == 8
    assert view["calendar"]["max_teams_per_staffel"] == 8
    assert view["map_pool"]["origin"] == "league_season"
    assert view["divisions"][0]["label"] == "Liga 1"
    assert await audit_actions(flow) == ["league.create", "league.season.create", "league.season.map_pool.save",
                                         "league.division.create"]


@pytest.mark.asyncio
async def test_creating_a_staffel_copies_every_setting_into_the_tournament(flow):
    _admin, game, league, season, division, maps = await setup_league(flow)

    created = await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})
    assert created.status_code == 200, created.text
    staffel = created.json()
    assert staffel["staffel"] == "A"
    tournament = await flow.db.tournaments.find_one({"id": staffel["tournament_id"]}, {"_id": 0})

    assert tournament["league_context"] == {"league_id": league["id"], "season_id": season["id"],
                                            "division_id": division["id"], "staffel": "A"}
    assert tournament["title"] == "Probe-Liga Season 1 · Liga 1 · Staffel A"
    assert tournament["slug"] == "probe-shooter-season-1-liga-1-a"
    expected = {
        "game_id": game["id"], "format": "league", "team_mode": "team", "team_size": 4, "best_of": 3,
        "max_participants": 8, "min_participants": 2, "start_date": "2026-11-09T23:00:00+00:00",
        "end_date": "2027-01-18T22:59:59+00:00", "matchday_days": 7, "default_match_weekday": 6,
        "default_match_time": "20:00", "result_confirm_hours_league": 48, "rules": "## Regeln\nFair spielen.",
        "result_entry_mode": "player_confirmed", "registration_enabled": False, "discord_registration": False,
        "discord_skip": True, "season_weight": 0, "visibility": "internal", "is_public": False, "status": "draft",
        "round_robin_legs": 1, "matchday_blocked_weeks": [7, 8], "matchday_weeks_total": 10,
        "scoring_rules": normalize_rules({}), "game_mode_order": [], "lineup_amend_hours": 48,
    }
    assert {key: tournament.get(key) for key in expected} == expected

    pool = await map_pools.effective_pool(flow.db, tournament)
    assert pool["origin"] == "tournament"
    assert [(group["mode"], [item["name"] for item in group["maps"]]) for group in pool["modes"]] == [
        ("stellung", ["Hafenkante"]), ("snd", ["Nebelwerk", "Hafenkante"])]
    assert "league.staffel.create" in await audit_actions(flow)

    second = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    assert second["staffel"] == "B"
    again = await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={"staffel": "a"})
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_division_overrides_win_over_the_season(flow):
    _admin, _game, _league, season, _division, _maps = await setup_league(flow)
    second = await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={
        "nickname": "Elite", "overrides": {"best_of": 5, "team_size": 5, "max_staffel_size": 6,
                                           "scoring_rules": {"match_points": {"win": 2, "draw": 1, "loss": 0}}}})
    assert second.status_code == 200, second.text
    division = second.json()
    assert division["level"] == 2
    assert division["overrides"]["scoring_rules"]["match_points"] == {"win": 2, "draw": 1, "loss": 0}

    staffel = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    tournament = await flow.db.tournaments.find_one({"id": staffel["tournament_id"]}, {"_id": 0})
    assert (tournament["best_of"], tournament["team_size"], tournament["max_participants"]) == (5, 5, 6)
    assert tournament["scoring_rules"]["match_points"] == {"win": 2, "draw": 1, "loss": 0}

    unknown = await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={"overrides": {"weeks_total": 3}})
    assert unknown.status_code == 422
    small = await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions",
                            json={"overrides": {"team_size": 5, "min_squad_size": 4}})
    assert small.status_code == 422 and "Mindestkader" in small.json()["detail"]


# ---------------------------------------------------------------- Runden ≤ aktive Wochen

def test_season_one_blocks_the_two_christmas_weeks_only():
    season = {"start_date": "2026-11-09T23:00:00+00:00", "weeks_total": 10, "matchday_days": 7,
              "blocked_periods": SEASON_ONE["blocked_periods"]}
    assert league_service.blocked_weeks(season) == [7, 8]
    weeks = league_service.week_days(season)
    assert weeks[0] == (date(2026, 11, 10), date(2026, 11, 16))
    assert weeks[5] == (date(2026, 12, 15), date(2026, 12, 21))  # nur der Montag liegt in der Pause
    assert league_service.rounds_needed(8, 1) == 7
    assert league_service.rounds_needed(9, 1) == 9
    assert league_service.rounds_needed(8, 2) == 14
    assert league_service.rounds_problem(8, 1, 10, [7, 8]) is None


@pytest.mark.asyncio
async def test_nine_teams_do_not_fit_season_one_and_the_message_points_to_a_second_staffel(flow):
    _admin, _game, _league, season, division, _maps = await setup_league(flow, season={"max_staffel_size": 9})

    refused = await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})
    assert refused.status_code == 422
    detail = refused.json()["detail"]
    assert "9 Spielwochen" in detail and "8 aktive Wochen" in detail
    assert "höchstens 8" in detail and "zweite Staffel" in detail
    assert await flow.db.tournaments.count_documents({}) == 0

    # Hin- und Rückrunde mit 8 Teams braucht 14 Wochen - ebenfalls abgelehnt.
    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"max_staffel_size": 8, "round_robin_legs": 2})
    assert (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).status_code == 422


# ---------------------------------------------------------------- Vorgaben übertragen

async def _staffel(flow, division) -> dict:
    created = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    return await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_sync_before_the_start_applies_everything(flow):
    _admin, _game, _league, season, division, maps = await setup_league(flow)
    staffel = await _staffel(flow, division)

    changed = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={
        "visibility": "public", "rules_text": "Neu", "best_of": 5, "weeks_total": 12, "default_match_time": "19:30"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["staffeln_to_sync"] == 1
    untouched = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    assert untouched["best_of"] == 3  # erst nach dem Übertragen
    assert untouched["visibility"] == "public"  # die Sichtbarkeit gilt sofort

    await flow.put(f"{ADMIN}/seasons/{season['id']}/map-pool", json={"modes": [
        {"mode": "snd", "map_ids": [maps["Nebelwerk"]["id"]]}]})
    synced = await flow.post(f"{ADMIN}/seasons/{season['id']}/sync")
    assert synced.status_code == 200, synced.text
    result = synced.json()["staffeln"][0]
    assert result["skipped"] == []
    after = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    assert (after["visibility"], after["is_public"], after["rules"]) == ("public", True, "Neu")
    assert after["best_of"] == 5 and after["matchday_weeks_total"] == 12 and after["default_match_time"] == "19:30"
    assert after["status"] == "draft"  # die Sichtbarkeit startet keine Staffel
    pool = await map_pools.effective_pool(flow.db, after)
    assert [group["mode"] for group in pool["modes"]] == ["snd"]
    assert "league.staffel.sync" in await audit_actions(flow)


@pytest.mark.asyncio
async def test_sync_keeps_the_calendar_after_the_start_and_the_scoring_after_the_first_result(flow):
    _admin, _game, _league, season, division, _maps = await setup_league(flow)
    staffel = await _staffel(flow, division)
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"status": "live"}})
    await flow.db.matches_v2.insert_one({"id": "m1", "tournament_id": staffel["id"], "status": "completed",
                                         "slots": []})

    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={
        "visibility": "members", "rules_text": "Später", "best_of": 5, "weeks_total": 12})
    result = (await flow.post(f"{ADMIN}/seasons/{season['id']}/sync")).json()["staffeln"][0]

    assert sorted(item["group"] for item in result["skipped"]) == ["before_result", "before_start"]
    after = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    assert (after["visibility"], after["is_public"], after["rules"]) == ("members", True, "Später")
    assert after["best_of"] == 3 and after["matchday_weeks_total"] == 10


@pytest.mark.asyncio
async def test_sync_refuses_a_calendar_that_no_longer_fits(flow):
    _admin, _game, _league, season, division, _maps = await setup_league(flow)
    staffel = await _staffel(flow, division)
    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"weeks_total": 8, "rules_text": "Kurz"})

    result = (await flow.post(f"{ADMIN}/seasons/{season['id']}/sync")).json()["staffeln"][0]
    assert [item["group"] for item in result["skipped"]] == ["before_start"]
    assert "zweite Staffel" in result["skipped"][0]["reason"]
    after = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    assert after["matchday_weeks_total"] == 10 and after["rules"] == "Kurz"


# ---------------------------------------------------------------- Prüfungen der Eingaben

@pytest.mark.asyncio
async def test_season_input_is_checked(flow):
    _admin, _game, league, season, _division, _maps = await setup_league(flow)
    url = f"{ADMIN}/seasons/{season['id']}"
    assert (await flow.patch(url, json={"best_of": 4})).status_code == 422
    assert (await flow.patch(url, json={"weeks_total": 0})).status_code == 422
    assert (await flow.patch(url, json={"visibility": "secret"})).status_code == 422
    assert (await flow.patch(url, json={"default_match_time": "25:00"})).status_code == 422
    assert (await flow.patch(url, json={"min_squad_size": 3})).status_code == 422
    assert (await flow.patch(url, json={"game_mode_order": ["unbekannt"]})).status_code == 422
    assert (await flow.patch(url, json={"blocked_periods": [
        {"start_date": "2027-01-03", "end_date": "2026-12-21"}]})).status_code == 422
    bad_points = await flow.patch(url, json={"scoring_rules": {"table_tiebreakers": ["los"]}})
    assert bad_points.status_code == 422 and "Gleichstand" in bad_points.json()["detail"]
    ok = await flow.patch(url, json={"game_mode_order": ["snd", "stellung"], "team_size": 5})
    assert ok.status_code == 200, ok.text
    assert ok.json()["min_squad_size"] == 5  # Mindestkader wächst mit der Teamgröße mit
    duplicate = await flow.post(f"{ADMIN}/{league['id']}/seasons", json={**SEASON_ONE, "number": 1})
    assert duplicate.status_code == 409
    second = await flow.post(f"{ADMIN}/{league['id']}/seasons", json=SEASON_ONE)
    assert second.status_code == 200 and second.json()["number"] == 2


# ---------------------------------------------------------------- Rechte

@pytest.mark.asyncio
async def test_only_the_tournament_lead_with_two_factor_manages_leagues(flow):
    _admin, game, league, season, division, _maps = await setup_league(flow)
    member = await flow.add_user(name="mitglied")
    member["is_club_member"] = True
    unconfirmed = await flow.add_user(role="tournament_admin", name="ohne-2fa")
    unconfirmed["auth_mfa_verified"] = False
    calls = [
        ("get", ADMIN, None),
        ("post", ADMIN, {"name": "Fremde Liga", "game_id": game["id"]}),
        ("patch", f"{ADMIN}/{league['id']}", {"name": "Umbenannt"}),
        ("post", f"{ADMIN}/{league['id']}/seasons", SEASON_ONE),
        ("get", f"{ADMIN}/seasons/{season['id']}", None),
        ("patch", f"{ADMIN}/seasons/{season['id']}", {"visibility": "public"}),
        ("post", f"{ADMIN}/seasons/{season['id']}/divisions", {}),
        ("post", f"{ADMIN}/divisions/{division['id']}/staffeln", {}),
        ("post", f"{ADMIN}/seasons/{season['id']}/sync", None),
        ("delete", f"{ADMIN}/seasons/{season['id']}/map-pool", None),
    ]
    for person, expected in ((None, 401), (member, 403), (unconfirmed, 403)):
        flow.act_as(person)
        for method, url, body in calls:
            kwargs = {"json": body} if body is not None else {}
            response = await getattr(flow, method)(url, **kwargs)
            assert response.status_code == expected, (person and person["username"], method, url)
    assert await flow.db.tournaments.count_documents({}) == 0
    assert (await flow.db.leagues.find_one({"id": league["id"]}))["name"] == "Probe-Liga"

    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    flow.act_as(lead)
    assert (await flow.get(ADMIN)).status_code == 200


@pytest.mark.asyncio
async def test_league_context_cannot_be_set_through_the_tournament_routes(flow):
    _admin, game, league, season, division, _maps = await setup_league(flow)
    context = {"league_id": league["id"], "season_id": season["id"], "division_id": division["id"], "staffel": "Z"}
    created = await flow.post("/api/tournaments", json={"title": "Normales Turnier", "game_id": game["id"],
                                                        "league_context": context, "round_robin_legs": 1})
    assert created.status_code == 200, created.text
    stored = await flow.db.tournaments.find_one({"id": created.json()["id"]}, {"_id": 0})
    assert "league_context" not in stored and "round_robin_legs" not in stored

    updated = await flow.patch(f"/api/tournaments/{stored['id']}", json={"league_context": context,
                                                                         "matchday_blocked_weeks": [1]})
    assert updated.status_code == 200, updated.text
    stored = await flow.db.tournaments.find_one({"id": stored["id"]}, {"_id": 0})
    assert "league_context" not in stored and "matchday_blocked_weeks" not in stored

    staffel = await _staffel(flow, division)
    await flow.patch(f"/api/tournaments/{staffel['id']}", json={"league_context": None, "title": "Umbenannt"})
    stored = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    assert stored["league_context"]["staffel"] == "A" and stored["title"] == "Umbenannt"
