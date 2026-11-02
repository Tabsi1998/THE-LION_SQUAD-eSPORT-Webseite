"""Aufbau über die echten Routen für die Tests zur Selbstanmeldung (docs/LIGA.md, B.4, #2205). Erfundene Namen.

Eine Liga mit öffentlicher Season, Liga 1 mit Staffel A im Entwurf, gültigem Regelwerk und offenem Anmeldefenster. Dazu ``teams`` Hauptteams mit je
einem Co-Team: Kader aus vier Spielern, Captain und Vertreter. Die Staffel ist leer, nur die Anträge füllen sie.
"""
from __future__ import annotations

from datetime import timedelta

from league_rules_world import ADMIN_LEAGUES, GAME, publish
from league_start_world import ok, season_body
from models import now_utc
from squad_world import make_team


def window(*, opens_in_hours: float = -1, closes_in_hours: float = 48) -> dict:
    now = now_utc()
    return {"application_opens_at": (now + timedelta(hours=opens_in_hours)).isoformat(),
            "application_closes_at": (now + timedelta(hours=closes_in_hours)).isoformat()}


def base_url(world: dict) -> str:
    return f"/api/leagues/{world['league']['slug']}/{world['season']['slug']}"


def inbox_url(world: dict) -> str:
    return f"{ADMIN_LEAGUES}/seasons/{world['season']['id']}/applications"


async def add_team(flow, world: dict, name: str, *, players: int = 4) -> dict:
    """Ein Hauptteam mit einem Co-Team: ``players`` Spieler, der erste ist Captain, der zweite Vertreter. Dazu eine Teamleitung ohne Rolle."""
    lead = await flow.add_user(name=f"{name} Leitung")
    people = [await flow.add_user(name=f"{name} S{number}") for number in range(players)]
    team = await make_team(flow, name, leader=lead, members=people)
    flow.act_as(lead)
    squad = ok(await flow.post(f"/api/teams/{team['id']}/squads", json={
        "name": f"{name} Eins", "game_id": world["game"]["id"], "member_ids": [user["id"] for user in people],
        "captain_id": people[0]["id"], "vice_captain_id": people[1]["id"] if players > 1 else None}))
    return {"team": team, "squad": squad, "lead": lead, "people": people, "captain": people[0],
            "vice": people[1] if players > 1 else None, "member": people[-1]}


async def application_world(flow, *, teams: int = 3, rules: bool = True, open_window: bool = True, visibility: str = "public",
                            staffeln: int = 1, **season) -> dict:
    lead = await flow.add_staff()
    flow.act_as(lead)
    game = ok(await flow.post("/api/games", json=GAME))
    league = ok(await flow.post(ADMIN_LEAGUES, json={"name": "Anmelde-Liga", "game_id": game["id"]}))
    fields = {**(window() if open_window else {}), **season}
    row = ok(await flow.post(f"{ADMIN_LEAGUES}/{league['id']}/seasons", json=season_body(visibility=visibility, **fields)))
    division = ok(await flow.post(f"{ADMIN_LEAGUES}/seasons/{row['id']}/divisions", json={}))
    tids = [ok(await flow.post(f"{ADMIN_LEAGUES}/divisions/{division['id']}/staffeln", json={}))["tournament_id"] for _ in range(staffeln)]
    world = {"lead": lead, "game": game, "league": league, "season": row, "division": division, "tid": tids[0], "tids": tids}
    world["teams"] = [await add_team(flow, world, f"Team{chr(65 + index)}") for index in range(teams)]
    if rules:
        world["rule"] = await publish(flow, world)
    return world


async def submit(flow, world: dict, side: dict, *, actor: dict | None = None, **body):
    """Einreichen wie das Web: mit der Fassung, die es zeigt, und beiden Zustimmungen."""
    flow.act_as(actor or side["captain"])
    payload = {"squad_id": side["squad"]["id"], "rule_version_id": (world.get("rule") or {}).get("id"), "accept_rules": True, "accept_privacy": True, **body}
    return await flow.post(f"{base_url(world)}/applications", json=payload)


async def submitted(flow, world: dict, side: dict) -> dict:
    return ok(await submit(flow, world, side))


async def decide(flow, world: dict, application: dict, action: str, *, actor: dict | None = None, **body):
    flow.act_as(actor or world["lead"])
    return await flow.post(f"{inbox_url(world)}/{application['id']}/{action}", json=body)
