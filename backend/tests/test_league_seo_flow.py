"""Ligaseite (docs/LIGA.md, P5, #1625): SEO-Vorschau und Sitemap nur bei Season-Sichtbarkeit „öffentlich“. Nur erfundene
Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

ADMIN = "/api/admin/leagues"
SEASON_ONE = {"start_date": "2026-11-10T00:00:00", "visibility": "public",
              "blocked_periods": [{"start_date": "2026-12-21", "end_date": "2027-01-03", "label": "Weihnachtspause"}],
              "scoring_rules": {"match_points": {"win": 3, "draw": 0, "loss": 0}}}
PAGE = "/api/leagues/probe-shooter/season-1"


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
    season_doc = (await flow.post(f"{ADMIN}/{league['id']}/seasons", json={**SEASON_ONE, **(season or {})})).json()
    division = (await flow.post(f"{ADMIN}/seasons/{season_doc['id']}/divisions", json={})).json()
    created = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    staffel = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
    team_ids = []
    for index in range(1, teams + 1):
        team_id = f"team-{index}"
        team_ids.append(team_id)
        await flow.db.teams.insert_one({"id": team_id, "name": f"Probe {index}", "member_ids": []})
        await flow.db.tournament_registrations.insert_one({
            "id": f"reg-{index}", "tournament_id": staffel["id"], "team_id": team_id, "status": "approved",
            "registration_type": "team", "display_name": f"Probe {index} · Probe {index} B", "squad_name": f"Probe {index} B",
            "identity_key": f"{staffel['id']}:team:{team_id}"})
    started = await flow.post(f"/api/tournaments/{staffel['id']}/status", json={"status": "live"})
    assert started.status_code == 200, started.text
    return admin, season_doc, staffel, team_ids


@pytest.mark.asyncio
async def test_seo_and_sitemap_only_for_public_seasons(flow):
    from routes.seo_render_routes import league_season_meta

    admin, season, _staffel, _teams = await setup(flow)
    base = {"site_name": "Probe", "image": "/logo.png", "title": "Probe", "description": ""}
    meta = await league_season_meta(flow.db, "probe-shooter", "season-1", base, "https://example.test")
    assert meta["title"].startswith("Probe-Liga Season 1") and meta.get("robots") != "noindex, nofollow"
    sitemap = (await flow.get("/api/sitemap.xml")).text
    assert "/liga/probe-shooter/season-1</loc>" in sitemap and "/liga</loc>" in sitemap

    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": "members"})
    restricted = await league_season_meta(flow.db, "probe-shooter", "season-1", base, "https://example.test")
    assert restricted["robots"] == "noindex, nofollow" and "Probe-Liga" not in restricted["title"]
    sitemap = (await flow.get("/api/sitemap.xml")).text
    assert "/liga" not in sitemap

    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": "off"})
    with pytest.raises(Exception):
        await league_season_meta(flow.db, "probe-shooter", "season-1", base, "https://example.test")
