"""Öffentliche Season-Seite (#2268): was gespielt wird (Regel je Modus), Terminregeln, Teams mit Bild, Unterseiten Spieltage und
Teams in Vorschau und Sitemap - und nichts von dem, was nur die Leitung braucht. Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

ADMIN = "/api/admin/leagues"
SEASON_ONE = {"start_date": "2026-11-10T00:00:00", "visibility": "public", "readiness_override_reason": "Testaufbau ohne Prüfung",
              "best_of": 3, "team_size": 4, "game_mode_order": ["stellung", "suchen", "stellung"]}
PAGE = "/api/leagues/probe-shooter/season-1"
BASE = {"site_name": "Probe", "image": "/logo.png", "title": "Probe", "description": ""}
MODES = [{"mode": "stellung", "label": "Stellung"}, {"mode": "suchen", "label": "Suchen & Zerstören"}]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow, *, start: bool = True):
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = (await flow.post("/api/games", json={"name": "Probe Shooter", "slug": "probe-shooter", "match_modes": MODES})).json()
    league = (await flow.post(ADMIN, json={"name": "Probe-Liga", "game_id": game["id"]})).json()
    season = (await flow.post(f"{ADMIN}/{league['id']}/seasons", json=SEASON_ONE)).json()
    division = (await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={})).json()
    created = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    staffel = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
    for index in range(1, 5):
        await flow.db.teams.insert_one({"id": f"team-{index}", "name": f"Probe {index}", "member_ids": [],
                                        "logo_url": f"/api/static/uploads/probe-{index}.png" if index != 4 else None})
        await flow.db.tournament_registrations.insert_one({
            "id": f"reg-{index}", "tournament_id": staffel["id"], "team_id": f"team-{index}", "status": "approved",
            "registration_type": "team", "display_name": f"Probe {index} · Probe {index} B", "squad_name": f"Probe {index} B",
            "identity_key": f"{staffel['id']}:team:team-{index}"})
    if start:
        started = await flow.post(f"/api/tournaments/{staffel['id']}/status", json={"status": "live"})
        assert started.status_code == 200, started.text
    return admin, season, staffel


@pytest.mark.asyncio
async def test_the_season_says_what_is_played_and_how_dates_work_without_lead_values(flow):
    _admin, season, _staffel = await setup(flow)
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {
        "result_rules": {"stellung": {"kind": "score", "target": 250, "time_limit_minutes": 10, "draw_allowed": False},
                         "suchen": {"kind": "rounds", "target": 6, "round_limit": 11, "overtime": True},
                         "kaputt": {"target": 3}},
        "schedule_rules": {"home_rule": True, "home_rule_hours": 72, "reschedule_notice_hours": 24, "reschedule_max": 2,
                           "reschedule_same_week": False, "result_reminder_hours": 24, "result_overdue_hours": 48}}})
    flow.act_as(None)
    body = (await flow.get(PAGE)).json()
    # Altbestand in Minuten kommt in Sekunden; eine Regel ohne Art fällt weg.
    assert body["season"]["result_rules"] == {
        "stellung": {"kind": "score", "target": 250, "time_limit_seconds": 600, "draw_allowed": False},
        "suchen": {"kind": "rounds", "target": 6, "round_limit": 11, "overtime": True}}
    # Erinnerung und „überfällig“ sind Arbeitswerte der Leitung - nicht öffentlich.
    assert body["season"]["schedule_rules"] == {"home_rule": True, "home_rule_hours": 72, "reschedule_notice_hours": 24,
                                                "reschedule_max": 2, "reschedule_same_week": False}
    assert body["season"]["game_mode_order"] == ["stellung", "suchen", "stellung"]


@pytest.mark.asyncio
async def test_an_older_season_without_rules_shows_none(flow):
    _admin, season, _staffel = await setup(flow, start=False)
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$unset": {"result_rules": "", "schedule_rules": ""}})
    flow.act_as(None)
    body = (await flow.get(PAGE)).json()
    assert body["season"]["result_rules"] == {} and body["season"]["schedule_rules"] is None


@pytest.mark.asyncio
async def test_teams_of_a_staffel_carry_the_logo_of_their_team_page(flow):
    _admin, _season, staffel = await setup(flow)
    flow.act_as(None)
    body = (await flow.get(f"{PAGE}/staffeln/{staffel['id']}")).json()
    logos = {row["team_id"]: row["logo_url"] for row in body["teams"]}
    assert logos == {"team-1": "/api/static/uploads/probe-1.png", "team-2": "/api/static/uploads/probe-2.png",
                     "team-3": "/api/static/uploads/probe-3.png", "team-4": None}
    # Mehr als Name, Teamseite und Bild steht dort nicht.
    assert set(body["teams"][0]) == {"id", "display_name", "team_id", "squad_name", "logo_url"}


@pytest.mark.asyncio
async def test_a_team_that_is_not_public_keeps_its_logo_to_itself(flow):
    _admin, _season, staffel = await setup(flow)
    await flow.db.teams.update_one({"id": "team-2"}, {"$set": {"is_public": False}})
    flow.act_as(None)
    body = (await flow.get(f"{PAGE}/staffeln/{staffel['id']}")).json()
    logos = {row["team_id"]: row["logo_url"] for row in body["teams"]}
    assert logos["team-2"] is None and logos["team-1"] == "/api/static/uploads/probe-1.png"
    assert "probe-2.png" not in str(body)


@pytest.mark.asyncio
async def test_matchdays_and_teams_have_their_own_preview_and_sitemap_entry(flow):
    from fastapi import HTTPException

    from routes.seo_render_routes import league_season_meta

    _admin, season, _staffel = await setup(flow)
    meta = await league_season_meta(flow.db, "probe-shooter", "season-1", BASE, "https://example.test", "spieltage")
    assert meta["canonical"] == "https://example.test/liga/probe-shooter/season-1/spieltage"
    assert meta["title"].startswith("Spieltage · Probe-Liga Season 1")
    assert "Best of 3 · 4 gegen 4 · Stellung und Suchen & Zerstören" in meta["description"]
    teams = await league_season_meta(flow.db, "probe-shooter", "season-1", BASE, "https://example.test", "teams")
    assert teams["canonical"].endswith("/season-1/teams") and teams["title"].startswith("Teams · ")
    # Die Übersicht sagt, was gespielt wird.
    overview = await league_season_meta(flow.db, "probe-shooter", "season-1", BASE, "https://example.test")
    assert overview["canonical"].endswith("/season-1") and "Stellung und Suchen & Zerstören" in overview["description"]
    sitemap = (await flow.get("/api/sitemap.xml")).text
    assert "/liga/probe-shooter/season-1/spieltage</loc>" in sitemap and "/liga/probe-shooter/season-1/teams</loc>" in sitemap

    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": "members"})
    restricted = await league_season_meta(flow.db, "probe-shooter", "season-1", BASE, "https://example.test", "spieltage")
    assert restricted["robots"] == "noindex, nofollow" and "Probe-Liga" not in restricted["title"]
    assert "/liga/" not in (await flow.get("/api/sitemap.xml")).text
    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": "off"})
    with pytest.raises(HTTPException) as hidden:
        await league_season_meta(flow.db, "probe-shooter", "season-1", BASE, "https://example.test", "teams")
    assert hidden.value.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("hidden", [{"visibility": "members"}, {"visibility": "internal"}, {"is_public": False}])
async def test_a_staffel_that_is_not_public_keeps_matchdays_out_of_the_sitemap(flow, hidden):
    _admin, _season, staffel = await setup(flow)
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": hidden})
    sitemap = (await flow.get("/api/sitemap.xml")).text
    assert "/liga/probe-shooter/season-1</loc>" in sitemap
    assert "/season-1/spieltage</loc>" not in sitemap and "/season-1/teams</loc>" not in sitemap


@pytest.mark.asyncio
async def test_a_staffel_of_an_archived_liga_n_keeps_matchdays_out_of_the_sitemap(flow):
    _admin, season, staffel = await setup(flow)
    await flow.db.league_divisions.update_many({"season_id": season["id"]}, {"$set": {"status": "archived"}})
    sitemap = (await flow.get("/api/sitemap.xml")).text
    assert "/season-1/spieltage</loc>" not in sitemap


@pytest.mark.asyncio
async def test_a_season_in_draft_lists_no_matchdays_in_the_sitemap(flow):
    await setup(flow, start=False)
    sitemap = (await flow.get("/api/sitemap.xml")).text
    assert "/liga/probe-shooter/season-1</loc>" in sitemap
    assert "/season-1/spieltage</loc>" not in sitemap and "/season-1/teams</loc>" not in sitemap
