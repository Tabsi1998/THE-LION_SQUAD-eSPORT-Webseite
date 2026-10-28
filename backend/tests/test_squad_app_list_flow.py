"""Co-Teams (#1649, Review P3): die App zeigt eine Liga-Staffel unter „Meine Turniere“ nur Kader, Captain,
Vertreter und Hauptteam-Leitung. Erfundene Namen."""

import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from squad_world import league_world, squad_registration  # noqa: E402


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
async def test_the_app_lists_the_staffel_only_for_the_squad(flow):
    from routes.mobile_routes import _my_tournament_registrations

    world = await live_match(flow)
    users = world["users"]
    seen = {
        name: [reg["id"] for reg in await _my_tournament_registrations(users[name])]
        for name in ("Spieler3", "Spieler5", "Leitung")
    }

    assert seen["Spieler3"] == [world["regs"][0]["id"]]
    assert seen["Leitung"] == [world["regs"][0]["id"]]
    assert seen["Spieler5"] == [], "nicht im Kader von Rudel A"
