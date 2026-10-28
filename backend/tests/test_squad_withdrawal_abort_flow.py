"""Ein abgebrochener Austritt (ein zweiter Schreiber kam dem Umbau zuvor) behält den ``league_squad_key`` (#1649):
der Schlüssel fällt erst weg, wenn der Umbau geschrieben ist. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from squad_world import league_world  # noqa: E402

SEASON_TAKEN = "Dieses Co-Team spielt in dieser Season schon in einer anderen Staffel."


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def season_with_two_staffeln(flow) -> dict:
    season_id = new_id()
    world = await league_world(
        flow, league_context={"league_id": new_id(), "season_id": season_id, "division_id": new_id(), "staffel": "A"}
    )
    staffel_b = await flow.create_tournament(
        team_mode="team",
        team_size=4,
        format="league",
        game_id="cod",
        status="registration_closed",
        max_participants=8,
        league_context={"league_id": new_id(), "season_id": season_id, "division_id": new_id(), "staffel": "B"},
    )
    await flow.db.tournament_registrations.create_index("league_squad_key", unique=True, sparse=True)
    flow.act_as(world["staff"])
    body = {"team_id": world["lions"]["id"], "squad_id": world["squad_a"]["id"]}
    placed = await flow.post(f"/api/tournaments/{world['tournament']['id']}/squad-registrations", json=body)
    assert placed.status_code == 200, placed.text
    return {**world, "staffel_b": staffel_b, "body": body, "reg_a": placed.json()["registration"]}


async def stored(flow, reg_id: str) -> dict:
    return await flow.db.tournament_registrations.find_one({"id": reg_id}, {"_id": 0})


class _LosingMatchWrites:
    """Ein zweiter Schreiber kommt dem Umbau zuvor: jedes bedingte Schreiben eines Spiels trifft nichts mehr."""

    def __init__(self, db):
        self._db = db

    def __getattr__(self, name):
        target = getattr(self._db, name)
        if name != "matches_v2":
            return target

        class Matches:
            def __getattr__(self, attr):
                return getattr(target, attr)

            async def update_one(self, query, change, **kwargs):
                if "status" in query or len(query) > 1:

                    class Missed:
                        matched_count = 0
                        modified_count = 0

                    return Missed()
                return await target.update_one(query, change, **kwargs)

        return Matches()

    def __getitem__(self, name):
        return self.__getattr__(name)


@pytest.mark.asyncio
async def test_an_aborted_withdrawal_keeps_the_key(flow, monkeypatch):
    import routes.tournament_removal_routes as removal_routes

    world = await season_with_two_staffeln(flow)
    rival = await flow.post(
        f"/api/tournaments/{world['tournament']['id']}/squad-registrations",
        json={"team_id": world["falcons"]["id"], "squad_id": world["horst"]["id"]},
    )
    await flow.db.matches_v2.insert_one(
        {
            "id": new_id(),
            "tournament_id": world["tournament"]["id"],
            "stage_id": new_id(),
            "match_type": "duel",
            "status": "scheduled",
            "round": 1,
            "slots": [
                {"slot": 1, "status": "filled", "registration_id": world["reg_a"]["id"]},
                {"slot": 2, "status": "filled", "registration_id": rival.json()["registration"]["id"]},
            ],
        }
    )
    removal_url = f"/api/tournaments/{world['tournament']['id']}/registrations/{world['reg_a']['id']}/removal"
    plan = await flow.post(removal_url, json={"kind": "withdrawn"})
    assert plan.json()["plan"]["ops"], "der Austritt ändert ein Spiel - sonst gibt es keinen Abbruch"
    monkeypatch.setattr(removal_routes, "get_db", lambda: _LosingMatchWrites(flow.db))

    aborted = await flow.post(removal_url, json={"kind": "withdrawn", "plan_id": plan.json()["plan"]["id"]})

    assert aborted.status_code == 409, aborted.text
    reg = await stored(flow, world["reg_a"]["id"])
    assert reg["status"] == "approved"
    assert reg["league_squad_key"].endswith(world["squad_a"]["id"]), "Schlüssel bleibt beim Abbruch"
