"""Öffentliche Ligaseite (docs/LIGA.md, P5, #1625): je Staffel Tabelle, Spielwochen mit Pause, Ergebnisse mit Maps -
ohne Aufstellungen; Teamseite mit Abschnitt „Liga“; SEO und Sitemap nur bei „öffentlich“. Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

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


async def finish(flow, staffel, *, games=lambda home, away: []):
    match = await flow.db.matches_v2.find_one({"tournament_id": staffel["id"], "round": 1, "is_preview": {"$ne": True}},
                                              {"_id": 0})
    home, away = [slot["registration_id"] for slot in match["slots"]]
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
        "status": "completed",
        "results": [{"registration_id": home, "score": 2, "rank": 1, "outcome": "winner"},
                    {"registration_id": away, "score": 1, "rank": 2, "outcome": "loser"}],
        "games": games(home, away),
    }})
    return match, home, away


@pytest.mark.asyncio
async def test_a_staffel_page_has_table_weeks_with_the_break_and_results_with_maps(flow):
    _admin, _season, staffel, _teams = await setup(flow)
    lineup_user = new_id()
    match, home, away = await finish(flow, staffel, games=lambda home, away: [
        {"position": 2, "mode": "snd", "map_id": "m2", "map_name": "Nebelwerk", "map_image_url": None,
         "winner_registration_id": away, "lineups": {home: [lineup_user]}},
        {"position": 1, "mode": "snd", "map_id": "m1", "map_name": "Hafenkante", "map_image_url": "/x.webp",
         "winner_registration_id": None, "scores": {}, "lineups": {home: [lineup_user]}},
    ])
    flow.act_as(None)

    response = await flow.get(f"{PAGE}/staffeln/{staffel['slug']}")
    assert response.status_code == 200, response.text
    page = response.json()
    assert page["staffel"]["staffel"] == "A" and page["staffel"]["division_label"] == "Liga 1"
    points = {row["registration_id"]: row["points"] for row in page["standings"]}
    assert points[home] == 3 and points[away] == 0  # Punkte der Season: 3/0/0
    assert [row["display_name"] for row in page["teams"]][:1] == ["Probe 1 · Probe 1 B"]

    kinds = [(week["week"], week["kind"], week.get("matchday")) for week in page["weeks"]]
    assert kinds[:6] == [(n, "matchday", n) for n in range(1, 4)] + [(4, "reserve", 4), (5, "reserve", 5),
                                                                       (6, "reserve", 6)]
    assert kinds[6][:2] == (7, "pause") and kinds[7][:2] == (8, "pause")
    assert page["weeks"][6]["label"] == "Weihnachtspause"
    assert len(page["weeks"]) == 10

    first = next(row for row in page["weeks"][0]["matches"] if row["id"] == match["id"])
    assert first["done"] and first["winner_registration_id"] == home
    assert (first["home"]["score"], first["away"]["score"]) == (2, 1)
    assert first["home"]["team_id"] in {"team-1", "team-2", "team-3", "team-4"}
    assert [game["map_name"] for game in first["games"]] == ["Hafenkante", "Nebelwerk"]
    assert "lineups" not in first["games"][0] and lineup_user not in response.text
    open_match = next(row for row in page["weeks"][1]["matches"])
    assert not open_match["done"] and open_match["home"]["score"] is None and open_match["scheduled_at"]


@pytest.mark.asyncio
async def test_staffel_pages_follow_the_season_and_the_tournament_visibility(flow):
    admin, season, staffel, _teams = await setup(flow, season={"visibility": "members"})
    flow.act_as(None)
    assert (await flow.get(f"{PAGE}/staffeln/{staffel['slug']}")).status_code == 404
    member = await flow.add_user(name="mitglied")
    member["is_club_member"] = True
    flow.act_as(member)
    assert (await flow.get(f"{PAGE}/staffeln/{staffel['id']}")).status_code == 200
    flow.act_as(admin)
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"status": "draft"}})
    flow.act_as(member)
    assert (await flow.get(f"{PAGE}/staffeln/{staffel['id']}")).status_code == 404
    assert (await flow.get(f"{PAGE}/staffeln/unbekannt")).status_code == 404


@pytest.mark.asyncio
async def test_the_team_page_shows_its_co_teams_staffel_once(flow):
    _admin, _season, staffel, teams = await setup(flow)
    flow.act_as(None)
    overview = (await flow.get(f"/api/teams/{teams[0]}/overview")).json()
    # „upcoming“ behält die Staffel für die App (gekennzeichnet), das Web blendet sie über in_league_section aus.
    assert [(row["tournament"]["id"], row.get("in_league_section")) for row in overview["upcoming"]] == [
        (staffel["id"], True)]
    entry = overview["league"][0]
    assert entry["staffel_label"] == "Liga 1 · Staffel A"
    assert entry["display_name"] == "Probe 1 · Probe 1 B" and entry["squad_name"] == "Probe 1 B"
    assert entry["link"] == f"/liga/probe-shooter/season-1#staffel-{staffel['slug']}"
    assert (entry["league"]["name"], entry["season"]["name"]) == ("Probe-Liga", "Season 1")


@pytest.mark.asyncio
async def test_the_league_section_follows_the_staffel_not_the_season_status(flow):
    admin, season, staffel, teams = await setup(flow)
    # Season schon „beendet“ markiert, die Staffel läuft aber noch: der Abschnitt bleibt.
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"status": "completed"}})
    flow.act_as(None)
    assert len((await flow.get(f"/api/teams/{teams[0]}/overview")).json()["league"]) == 1
    # Staffel abgeschlossen: weg - wie bei „Angemeldet für“.
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"status": "completed"}})
    assert (await flow.get(f"/api/teams/{teams[0]}/overview")).json()["league"] == []


@pytest.mark.asyncio
async def test_the_staffel_route_checks_only_its_own_staffel(flow, monkeypatch):
    """Keine Liste aller Staffeln und keine Teilnehmerzählung je Staffel - nur die eine Staffel wird geprüft."""
    from services import league_service

    _admin, _season, staffel, _teams = await setup(flow)

    async def no_listing(*args, **kwargs):
        raise AssertionError("staffeln_of darf hier nicht laufen")

    monkeypatch.setattr(league_service, "staffeln_of", no_listing)
    flow.act_as(None)
    response = await flow.get(f"{PAGE}/staffeln/{staffel['slug']}")
    assert response.status_code == 200, response.text
    assert response.json()["staffel"]["staffel"] == "A" and response.json()["staffel"]["division_label"] == "Liga 1"
