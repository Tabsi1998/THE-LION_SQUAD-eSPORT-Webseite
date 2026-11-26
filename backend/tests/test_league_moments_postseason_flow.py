"""Saisonende-Moment (#1639, docs/LIGA.md „F.8“) mit Playoffs und Relegation (F.6) - über die echten Routen.

Der Moment wartet, bis auch Playoffs und Relegation abgeschlossen sind; der Meister kommt aus dem Playoff-Finale, Auf- und Abstieg
aus der Relegation („über die Relegation“). Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_postseason_world import STAFFELN, build, close, create, matches_of, play_round, settle, sides, win  # noqa: E402
from league_start_world import ok  # noqa: E402

# Liga 1: Platz 3 spielt Relegation, Platz 4 steigt ab. Liga 2: Platz 1 steigt auf, Platz 2 spielt Relegation.
ZONES = {1: {"relegate": 1, "playoff_relegate": 1}, 2: {"promote": 1, "playoff_promote": 1}}
PUBLIC = {"visibility": "public"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def moments_of(flow, world: dict) -> dict[str, dict]:
    rows = await flow.db.league_moments.find({"season_id": world["season"]["id"]}, {"_id": 0}).to_list(None)
    return {row["squad_id"]: row for row in rows}


def reg(world: dict, level: int, index: int, staffel: int = 0) -> dict:
    return world["regs"][world["tids"][level][staffel]][index]


async def postseason_tournament(flow, world: dict, kind: str, level: int = 1) -> dict:
    return await flow.db.tournaments.find_one({"league_context.division_id": world["divisions"][level]["id"], "league_context.kind": kind},
                                              {"_id": 0})


@pytest.mark.asyncio
async def test_relegation_decides_who_moves_and_the_moment_waits_for_it(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason={"relegation": {"enabled": True}}, season=PUBLIC)
    await close(flow, world)
    # Alle regulären Staffeln sind zu, die Relegation fehlt noch: kein Moment.
    assert await moments_of(flow, world) == {}
    ok(await create(flow, world, "relegation"))
    tournament = await postseason_tournament(flow, world, "relegation")
    flow.act_as(world["lead"])
    for match in await matches_of(flow, tournament["id"]):
        upper, lower = sides(match)
        await win(flow, match, lower)  # der Zweite der unteren Liga gewinnt
    await settle(flow, tournament["id"])
    ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))
    found = await moments_of(flow, world)
    summary = {squad: (row["outcome"], row["from"]["level"], row["to"]["level"], row.get("via")) for squad, row in found.items()}
    assert summary == {
        reg(world, 1, 0)["squad_id"]: ("champion", 1, 1, None),
        reg(world, 1, 2)["squad_id"]: ("down", 1, 2, "relegation"),
        reg(world, 1, 3)["squad_id"]: ("down", 1, 2, None),
        reg(world, 2, 0)["squad_id"]: ("up", 2, 1, None),
        reg(world, 2, 1)["squad_id"]: ("up", 2, 1, "relegation"),
    }
    from services import league_moments

    up = found[reg(world, 2, 1)["squad_id"]]
    assert "über die Relegation" in league_moments.texts(up, "Playoff-Liga · Season 1")["line"]
    # Wer in der Relegation spielte, hatte Einsatz in dieser Season.
    assert up["player_ids"]


@pytest.mark.asyncio
async def test_the_champion_from_the_playoffs_gets_the_moment_after_the_final(flow):
    world = await build(flow, staffeln={1: [4, 4]}, season=PUBLIC,
                        postseason={"playoffs": {"enabled": True, "per_staffel": 2}, "champion_source": "playoffs"})
    await close(flow, world)
    # Die Tabellen stehen, die Playoffs fehlen: kein Meister, kein Moment.
    assert await moments_of(flow, world) == {}
    ok(await create(flow, world, "playoffs"))
    tournament = await postseason_tournament(flow, world, "playoff")
    for _round in range(6):
        if not await play_round(flow, world, tournament["id"]):
            break
    await settle(flow, tournament["id"])
    flow.act_as(world["lead"])
    closed = ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))
    found = await moments_of(flow, world)
    champions = [row for row in found.values() if row["outcome"] == "champion"]
    assert len(champions) == 1 and champions[0]["display_name"] == closed["champion"] and champions[0]["playoffs"] is True
    from services import league_moments

    assert league_moments.texts(champions[0], "Playoff-Liga · Season 1")["line"] == "Sieger der Playoffs."
    # Die Anmeldungen aus Tabelle und Playoffs zählen beide zum Einsatz.
    assert len(champions[0]["registration_ids"]) == 2
