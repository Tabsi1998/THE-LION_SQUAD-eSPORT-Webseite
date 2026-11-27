"""Gemeinsamer Aufbau der Solo-Liga-Tests (#1629, P1): Spiel, Liga, Season, Liga N und Staffel über die Verwaltung.
Nur erfundene Namen."""
from __future__ import annotations

ADMIN = "/api/admin/leagues"
DUELL = {"name": "Probe Duell", "slug": "probe-duell", "match_modes": [{"mode": "duell", "label": "Duell"}]}
SEASON = {"start_date": "2026-11-10T00:00:00"}


async def make_game(flow, **extra) -> dict:
    created = await flow.post("/api/games", json={**DUELL, **extra})
    assert created.status_code == 200, created.text
    return created.json()


async def make_league(flow, game: dict, kind: str | None, name: str) -> dict:
    body = {"name": name, "game_id": game["id"], "slug": name.lower().replace(" ", "-")}
    if kind:
        body["participant_kind"] = kind
    created = await flow.post(ADMIN, json=body)
    assert created.status_code == 200, created.text
    return created.json()


async def make_staffel(flow, league: dict, season_body: dict | None = None) -> tuple[dict, dict, dict]:
    season = await flow.post(f"{ADMIN}/{league['id']}/seasons", json={**SEASON, **(season_body or {})})
    assert season.status_code == 200, season.text
    season = season.json()
    division = await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={})
    assert division.status_code == 200, division.text
    staffel = await flow.post(f"{ADMIN}/divisions/{division.json()['id']}/staffeln", json={})
    assert staffel.status_code == 200, staffel.text
    tournament = await flow.db.tournaments.find_one({"id": staffel.json()["tournament_id"]}, {"_id": 0})
    return season, division.json(), tournament


async def assign_person(flow, tournament: dict, user: dict):
    return await flow.post(f"/api/tournaments/{tournament['id']}/squad-registrations", json={"user_id": user["id"]})


async def solo_world(flow) -> dict:
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = await make_game(flow)
    league = await make_league(flow, game, "solo", "Duell Liga")
    season, division, tournament = await make_staffel(flow, league)
    return {"admin": admin, "game": game, "league": league, "season": season, "division": division, "tournament": tournament}
