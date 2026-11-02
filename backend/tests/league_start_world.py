"""Aufbau über die echten Routen für Tests rund um „Liga starten“ (#2201). Erfundene Namen.

Eine Liga mit Season, Liga 1 und Staffel A im Entwurf, dazu ``teams`` Hauptteams mit je einem zugeteilten Co-Team. Der Start
liegt relativ zu heute, damit nichts mit dem Kalender ausläuft.
"""
from __future__ import annotations

from datetime import timedelta

from league_match_world import OLD_RULES
from models import now_utc
from squad_world import make_team

ADMIN = "/api/admin/leagues"
GAME = {"name": "Probe-Shooter", "slug": "probe-shooter", "match_modes": [{"mode": "flagge", "label": "Flagge"}]}


def ok(response, code: int = 200):
    assert response.status_code == code, response.text
    return response.json()


def season_body(**extra) -> dict:
    start = (now_utc() + timedelta(days=8)).date().isoformat()
    return {"start_date": f"{start}T00:00:00", "weeks_total": 24, "round_robin_legs": 1, "best_of": 3, "team_size": 4,
            "max_staffel_size": 16, "rules_text": "Regeln der Probe-Season", "visibility": "admins", **extra}


async def add_staffel(flow, lead: dict, division_id: str, teams: int, *, game: dict, prefix: str) -> str:
    flow.act_as(lead)
    staffel = ok(await flow.post(f"{ADMIN}/divisions/{division_id}/staffeln", json={}))
    tid = staffel["tournament_id"]
    for index in range(teams):
        players = [await flow.add_user(name=f"{prefix}{index}S{number}") for number in range(5)]
        team = await make_team(flow, f"Team {prefix}{index}", leader=players[0], members=players[1:])
        flow.act_as(players[0])
        squad = ok(await flow.post(f"/api/teams/{team['id']}/squads", json={
            "name": f"Team {prefix}{index} Eins", "game_id": game["id"], "member_ids": [user["id"] for user in players[1:]],
            "captain_id": players[1]["id"], "vice_captain_id": players[2]["id"]}))
        flow.act_as(lead)
        ok(await flow.post(f"/api/tournaments/{tid}/squad-registrations", json={"team_id": team["id"], "squad_id": squad["id"]}))
    return tid


async def build(flow, teams: int, **season) -> dict:
    lead = await flow.add_staff()
    flow.act_as(lead)
    game = ok(await flow.post("/api/games", json=GAME))
    league = ok(await flow.post(ADMIN, json={"name": "Probe-Liga", "game_id": game["id"]}))
    season_row = ok(await flow.post(f"{ADMIN}/{league['id']}/seasons", json={**OLD_RULES, **season_body(**season)}))
    division = ok(await flow.post(f"{ADMIN}/seasons/{season_row['id']}/divisions", json={}))
    tid = await add_staffel(flow, lead, division["id"], teams, game=game, prefix="A")
    return {"lead": lead, "game": game, "league": league, "season": season_row, "division": division, "tid": tid}


async def start(flow, world: dict, tid: str | None = None):
    flow.act_as(world["lead"])
    return await flow.post(f"/api/tournaments/{tid or world['tid']}/status", json={"status": "live"})
