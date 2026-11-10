"""``team_members.joined_at`` beim Anlegen einer Zeile (#2337, Review N3).

Rolle setzen und Teamleitung übergeben legen die Zeile in ``team_members`` an, wenn sie fehlt - bisher ohne ``joined_at``.
Beide Wege verlangen, dass die Person schon im Team steht (``teams.member_ids``); wann sie kam, ist nicht bekannt. Die neue
Zeile bekommt deshalb das Gründungsdatum des Teams, sonst den frühesten Beitritt der Person aus dem Protokoll, erst dann
„jetzt“: So verliert ein langjähriges Mitglied keine alten Teamspiele, und das Feld ist nie leer. Eine vorhandene Zeile
behält ihr Beitrittsdatum.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import achievement_play as play  # noqa: E402
from flow_harness import make_flow, new_id  # noqa: E402
import badges  # noqa: E402
from models import now_utc  # noqa: E402
from services import achievement_counters as counters  # noqa: E402

FOUNDED = "2026-01-01T00:00:00+00:00"
LATER = "2026-03-01T00:00:00+00:00"


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
    """Leitung (gegründet am 1.1.) und ein Mitglied mit Zeile seit März, dazu eine Person, die nur in ``member_ids`` steht."""
    lead, member, rowless = [await flow.add_user(name=name) for name in ("Leitung", "Mitglied", "Ohne Zeile")]
    team = await play.add_team(flow, "Lions", lead, [member], joined_at=FOUNDED)
    await flow.db.team_members.update_one({"team_id": team["id"], "user_id": member["id"]}, {"$set": {"joined_at": LATER}})
    await flow.db.teams.update_one({"id": team["id"]}, {"$addToSet": {"member_ids": rowless["id"]}})
    return team, lead, member, rowless


async def set_role(flow, team: dict, person: dict, role: str = "co_leader") -> None:
    response = await flow.post(f"/api/teams/{team['id']}/members/{person['id']}/role", json={"role": role})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_rolle_setzen_legt_die_zeile_mit_dem_gruendungsdatum_an(flow):
    team, lead, member, rowless = await team_with_rowless_member(flow)
    flow.act_as(lead)
    for person in (rowless, member):
        await set_role(flow, team, person)
    created = await row(flow, team, rowless)
    assert (created["role"], created["joined_at"]) == ("co_leader", FOUNDED), "wann sie kam, weiß niemand: seit der Gründung"
    kept = await row(flow, team, member)
    assert (kept["role"], kept["joined_at"]) == ("co_leader", LATER), "eine vorhandene Zeile behält ihr Beitrittsdatum"


@pytest.mark.asyncio
async def test_ohne_gruendungsdatum_gilt_der_frueheste_beitritt_aus_dem_protokoll_sonst_jetzt(flow):
    team, lead, _member, rowless = await team_with_rowless_member(flow)
    unknown = await flow.add_user(name="Ohne Spur")
    await flow.db.teams.update_one({"id": team["id"]}, {"$unset": {"created_at": ""}, "$addToSet": {"member_ids": unknown["id"]}})
    await flow.db.audit_logs.insert_many([
        {"id": new_id(), "action": "team.join", "target_id": team["id"], "actor_id": rowless["id"], "data": {"via": "invite"}, "created_at": "2026-05-01T10:00:00+00:00"},
        {"id": new_id(), "action": "team.join", "target_id": team["id"], "actor_id": rowless["id"], "data": {"via": "join_code"}, "created_at": "2026-02-01T10:00:00+00:00"},
        {"id": new_id(), "action": "team.join", "target_id": "anderes-team", "actor_id": rowless["id"], "data": {}, "created_at": "2025-01-01T10:00:00+00:00"},
    ])
    before = now_utc().isoformat()
    flow.act_as(lead)
    for person in (rowless, unknown):
        await set_role(flow, team, person)
    assert (await row(flow, team, rowless))["joined_at"] == "2026-02-01T10:00:00+00:00", "der früheste Beitritt zu diesem Team"
    assert (await row(flow, team, unknown))["joined_at"] >= before, "gar nichts bekannt: jetzt - aber nie leer"


@pytest.mark.asyncio
async def test_leitung_uebergeben_legt_fehlende_zeilen_mit_dem_gruendungsdatum_an(flow):
    team, lead, _member, rowless = await team_with_rowless_member(flow)
    await flow.db.team_members.delete_one({"team_id": team["id"], "user_id": lead["id"]})
    flow.act_as(lead)
    response = await flow.post(f"/api/teams/{team['id']}/transfer-leader", json={"new_leader_id": rowless["id"]})
    assert response.status_code == 200, response.text
    new_leader, old_leader = await row(flow, team, rowless), await row(flow, team, lead)
    assert (new_leader["role"], old_leader["role"]) == ("leader", "co_leader")
    assert (new_leader["joined_at"], old_leader["joined_at"]) == (FOUNDED, FOUNDED)


@pytest.mark.asyncio
async def test_langjaehriges_mitglied_ohne_zeile_behaelt_seine_alten_teamspiele(flow):
    """Das Team gewinnt ein Spiel mit einem Mitglied, das nur in ``member_ids`` steht. Bekommt es danach eine Rolle (die
    Zeile entsteht), zählt das Spiel weiter - mit „jetzt“ als Beitrittsdatum wäre es verloren."""
    staff, tournament, team, registration, (lead, _member, _bench), _rival_regs = await play.team_cup(flow)
    veteran = await flow.add_user(name="Seit Jahren dabei")
    await flow.db.teams.update_one({"id": team["id"]}, {"$addToSet": {"member_ids": veteran["id"]}})
    opening = next(match for match in await play.open_matches(flow, tournament) if registration["id"] in play.sides(match))
    await play.decide(flow, staff, opening, registration["id"])

    async def team_games(person: dict) -> tuple:
        found = await counters.compute(person["id"], {"matches_played", "team_match_wins"})
        return found["matches_played"], found["team_match_wins"]

    assert await team_games(veteran) == (1, 1)
    flow.act_as(lead)
    await set_role(flow, team, veteran)
    stored = await row(flow, team, veteran)
    assert stored["joined_at"] == team["created_at"]
    assert await team_games(veteran) == (1, 1), "die neue Zeile nimmt ihr das alte Spiel nicht"
