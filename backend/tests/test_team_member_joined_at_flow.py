"""``team_members.joined_at`` beim Anlegen einer Zeile (#2337, Review N3).

Rolle setzen und Teamleitung übergeben legen die Zeile in ``team_members`` an, wenn sie fehlt - bisher ohne ``joined_at``.
Für die Erfolge („wer war zum Zeitpunkt des Spiels im Team“) galt so jemand als schon immer dabei und bekam auch die
alten Spiele des Teams. Eine vorhandene Zeile behält ihr Beitrittsdatum.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import achievement_play as play  # noqa: E402
from flow_harness import make_flow  # noqa: E402
import badges  # noqa: E402
from services import achievement_counters as counters  # noqa: E402

OLD = "2026-01-01T00:00:00+00:00"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


async def row(flow, team: dict, user: dict) -> dict | None:
    return await flow.db.team_members.find_one({"team_id": team["id"], "user_id": user["id"]}, {"_id": 0})


async def team_with_rowless_member(flow):
    """Leitung und Mitglied mit Zeile, dazu eine Person, die nur in ``member_ids`` steht (Zeile fehlt)."""
    lead, member, rowless = [await flow.add_user(name=name) for name in ("Leitung", "Mitglied", "Ohne Zeile")]
    team = await play.add_team(flow, "Lions", lead, [member])
    await flow.db.teams.update_one({"id": team["id"]}, {"$addToSet": {"member_ids": rowless["id"]}})
    return team, lead, member, rowless


@pytest.mark.asyncio
async def test_rolle_setzen_legt_die_zeile_mit_beitrittsdatum_an(flow):
    team, lead, member, rowless = await team_with_rowless_member(flow)
    flow.act_as(lead)
    for person in (rowless, member):
        response = await flow.post(f"/api/teams/{team['id']}/members/{person['id']}/role", json={"role": "co_leader"})
        assert response.status_code == 200, response.text
    created = await row(flow, team, rowless)
    assert created["role"] == "co_leader" and created["joined_at"] and created["joined_at"] > OLD
    kept = await row(flow, team, member)
    assert kept["role"] == "co_leader" and kept["joined_at"] == OLD, "eine vorhandene Zeile behält ihr Beitrittsdatum"


@pytest.mark.asyncio
async def test_leitung_uebergeben_legt_fehlende_zeilen_mit_beitrittsdatum_an(flow):
    team, lead, _member, rowless = await team_with_rowless_member(flow)
    await flow.db.team_members.delete_one({"team_id": team["id"], "user_id": lead["id"]})
    flow.act_as(lead)
    response = await flow.post(f"/api/teams/{team['id']}/transfer-leader", json={"new_leader_id": rowless["id"]})
    assert response.status_code == 200, response.text
    new_leader, old_leader = await row(flow, team, rowless), await row(flow, team, lead)
    assert (new_leader["role"], old_leader["role"]) == ("leader", "co_leader")
    assert new_leader["joined_at"] > OLD and old_leader["joined_at"] > OLD


@pytest.mark.asyncio
async def test_neue_teamleitung_bekommt_keine_alten_spiele_des_teams(flow):
    """Das Team gewinnt ein Spiel, danach übernimmt jemand die Leitung, dessen Zeile dabei erst entsteht."""
    staff, tournament, team, registration, (lead, member, _bench), rival_regs = await play.team_cup(flow)
    opening = next(match for match in await play.open_matches(flow, tournament) if registration["id"] in play.sides(match))
    await play.decide(flow, staff, opening, registration["id"])
    successor = await flow.add_user(name="Nachfolge")
    await flow.db.teams.update_one({"id": team["id"]}, {"$addToSet": {"member_ids": successor["id"]}})
    flow.act_as(lead)
    response = await flow.post(f"/api/teams/{team['id']}/transfer-leader", json={"new_leader_id": successor["id"]})
    assert response.status_code == 200, response.text

    found = await counters.compute(successor["id"], {"matches_played", "team_match_wins"})
    assert (found["matches_played"], found["team_match_wins"]) == (0, 0), "das Spiel war vor ihrer Zeit"
    assert (await counters.compute(member["id"], {"matches_played"}))["matches_played"] == 1
