"""Co-Teams (#1649, Review P3): wer das Hauptteam verlässt oder entfernt wird, spielt nicht mehr im Co-Team -
Kader, Captain und Vertreter zählen nur, solange sie im Hauptteam sind; fehlt der Co-Team-Eintrag, zählt nur die
Leitung. Erfundene Namen."""

import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services import match_audience  # noqa: E402
from squad_world import ids, league_world, squad_registration  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def live_match(flow, *, captain: bool = True) -> dict:
    world = await league_world(flow)
    users = world["users"]
    if captain:
        await flow.db.team_squads.update_one(
            {"id": world["squad_a"]["id"]},
            {"$set": {"captain_id": users["Spieler1"]["id"], "vice_captain_id": users["Spieler2"]["id"]}},
        )
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"status": "live"}})
    lions_reg = await squad_registration(flow, world["tournament"], world["lions"], world["squad_a"])
    falcons_reg = await squad_registration(flow, world["tournament"], world["falcons"], world["horst"])
    match = {
        "id": new_id(),
        "tournament_id": world["tournament"]["id"],
        "stage_id": new_id(),
        "match_type": "duel",
        "status": "scheduled",
        "scheduled_at": (now_utc() + timedelta(minutes=10)).isoformat(),
        "slots": [
            {"slot": 1, "status": "filled", "registration_id": lions_reg["id"]},
            {"slot": 2, "status": "filled", "registration_id": falcons_reg["id"]},
        ],
    }
    await flow.db.matches_v2.insert_one(dict(match))
    return {**world, "match": match, "regs": [lions_reg, falcons_reg]}


@pytest.mark.asyncio
async def test_a_removed_member_leaves_the_roster_chat_and_notices(flow):
    world = await live_match(flow)
    users = world["users"]
    flow.act_as(users["Leitung"])

    kicked = await flow.delete(f"/api/teams/{world['lions']['id']}/members/{users['Spieler3']['id']}")
    assert kicked.status_code == 200, kicked.text

    for key in ("squad_a", "squad_b"):
        squad = await flow.db.team_squads.find_one({"id": world[key]["id"]}, {"_id": 0})
        assert users["Spieler3"]["id"] not in squad["member_ids"], key
    players = await match_audience.player_user_ids(flow.db, world["regs"])
    assert users["Spieler3"]["id"] not in players
    flow.act_as(users["Spieler3"])
    chat = await flow.post(f"/api/matches/{world['match']['id']}/chat", json={"message": "Noch da?"})
    assert chat.status_code == 403

    # Wer selbst geht, verlässt die Kader genauso.
    flow.act_as(users["Spieler4"])
    left = await flow.post(f"/api/teams/{world['lions']['id']}/leave")
    assert left.status_code == 200, left.text
    squad = await flow.db.team_squads.find_one({"id": world["squad_a"]["id"]}, {"_id": 0})
    assert users["Spieler4"]["id"] not in squad["member_ids"]


@pytest.mark.asyncio
async def test_a_captain_outside_the_team_counts_as_missing_and_the_leadership_steps_in(flow):
    """Altdaten oder ein Rennen: der Captain steht nicht mehr im Hauptteam - dann handelt die Leitung."""
    world = await live_match(flow)
    users = world["users"]
    gone = [users["Spieler1"]["id"], users["Spieler2"]["id"]]
    await flow.db.teams.update_one({"id": world["lions"]["id"]}, {"$pull": {"member_ids": {"$in": gone}}})
    await flow.db.team_members.delete_many({"team_id": world["lions"]["id"], "user_id": {"$in": gone}})

    responsible = await match_audience.responsible_user_ids(flow.db, world["regs"])
    players = await match_audience.player_user_ids(flow.db, world["regs"])

    assert responsible == ids(users, "Leitung", "CoLeitung", "FalkenLeitung")
    assert not players & set(gone), "auch nicht mehr Spieler"
    lead_reg = await match_audience.responsible_registration(flow.db, world["tournament"]["id"], users["Leitung"]["id"])
    assert lead_reg["id"] == world["regs"][0]["id"]
    assert await match_audience.responsible_registration(flow.db, world["tournament"]["id"], gone[0]) is None
    flow.act_as(users["Spieler1"])
    refused = await flow.post(f"/api/matches/{world['match']['id']}/chat", json={"message": "Ich bin Captain"})
    assert refused.status_code == 403


@pytest.mark.asyncio
async def test_a_role_goes_only_to_team_members(flow):
    world = await league_world(flow)
    users = world["users"]
    # Altbestand: jemand steht noch im Kader, ist aber nicht mehr im Team.
    await flow.db.team_squads.update_one(
        {"id": world["squad_a"]["id"]}, {"$push": {"member_ids": users["Fremd"]["id"]}}
    )
    flow.act_as(users["Leitung"])

    refused = await flow.put(
        f"/api/teams/{world['lions']['id']}/squads/{world['squad_a']['id']}/roles",
        json={"captain_id": users["Fremd"]["id"]},
    )

    assert refused.status_code == 400
    assert "Mitglied des Teams" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_without_the_squad_document_only_the_leadership_counts(flow):
    world = await live_match(flow)
    users = world["users"]
    await flow.db.team_squads.delete_one({"id": world["squad_a"]["id"]})

    lions = [world["regs"][0]]
    assert await match_audience.responsible_user_ids(flow.db, lions) == ids(users, "Leitung", "CoLeitung")
    assert await match_audience.player_user_ids(flow.db, lions) == ids(users, "Leitung", "CoLeitung")
