"""Der Season-Stand folgt dem Start der ersten Staffel (#2201, D-15). Erfundene Namen.

Die Season zeigte „Startet bald“, bis jemand umstellte. Jetzt stellt der Server beim Start der ersten Staffel von Entwurf
auf „Läuft“, mit Protokoll. Ein von Hand gesetzter Stand bleibt.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_start_world import ADMIN, add_staffel, build, ok, start  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def season_of(flow, world) -> dict:
    return await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})


async def protocol(flow) -> list[dict]:
    return await flow.db.audit_logs.find({"action": "league.season.status"}, {"_id": 0}).to_list(5)


@pytest.mark.asyncio
async def test_starting_the_first_staffel_sets_the_season_running(flow):
    world = await build(flow, 4)
    assert (await season_of(flow, world))["status"] == "draft"
    ok(await start(flow, world))
    assert (await season_of(flow, world))["status"] == "active"
    rows = await protocol(flow)
    assert len(rows) == 1
    assert rows[0]["target_id"] == world["season"]["id"] and rows[0]["actor_id"] == world["lead"]["id"]
    assert rows[0]["data"] == {"from": "draft", "to": "active", "trigger": "staffel_start", "tournament_id": world["tid"]}


@pytest.mark.asyncio
@pytest.mark.parametrize("manual", ["completed", "archived", "active"])
async def test_a_manual_status_is_not_overwritten(flow, manual):
    world = await build(flow, 4)
    await flow.db.league_seasons.update_one({"id": world["season"]["id"]}, {"$set": {"status": manual}})
    ok(await start(flow, world))
    assert (await season_of(flow, world))["status"] == manual
    assert await protocol(flow) == []


@pytest.mark.asyncio
async def test_a_season_set_back_by_hand_stays_when_another_staffel_starts(flow):
    world = await build(flow, 4)
    second = await add_staffel(flow, world["lead"], world["division"]["id"], 4, game=world["game"], prefix="B")
    ok(await start(flow, world))
    flow.act_as(world["lead"])
    ok(await flow.patch(f"{ADMIN}/seasons/{world['season']['id']}", json={"status": "draft"}))
    ok(await start(flow, world, second))
    assert (await season_of(flow, world))["status"] == "draft", "die erste Staffel lief schon - der Stand ist von Hand"
    assert len(await protocol(flow)) == 1


@pytest.mark.asyncio
async def test_resuming_after_a_pause_changes_nothing(flow):
    world = await build(flow, 4)
    ok(await start(flow, world))
    flow.act_as(world["lead"])
    ok(await flow.post(f"/api/tournaments/{world['tid']}/status", json={"status": "paused"}))
    ok(await flow.patch(f"{ADMIN}/seasons/{world['season']['id']}", json={"status": "draft"}))
    ok(await start(flow, world))
    assert (await season_of(flow, world))["status"] == "draft"


@pytest.mark.asyncio
async def test_a_failed_start_leaves_the_season_alone(flow):
    world = await build(flow, 1)
    answer = await start(flow, world)
    assert answer.status_code in {400, 409}, answer.text
    assert (await season_of(flow, world))["status"] == "draft"
    assert await protocol(flow) == []


@pytest.mark.asyncio
async def test_other_tournaments_touch_no_season(flow):
    """Regression: Ein Liga-Format ohne Staffel kennt keine Season."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _registrations = await flow.with_participants(4, format="league", event_mode="online")
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    await flow.start(tournament)
    assert await protocol(flow) == []
