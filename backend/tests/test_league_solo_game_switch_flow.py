"""Schalter „Einzelspieler erlaubt“ am Spiel (#1629, Nr. 296): ``games.supports_solo``, Vorgabe an, ein Altspiel ohne Feld gilt als erlaubt.
Hat das Spiel schon eine Solo-Liga, geht Ausschalten nicht still durch - 409 mit dem Satz „Spiel hat Solo-Ligen: …“. Team-Ligen halten
den Schalter nie auf. Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_solo_world import make_game, make_league  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_switching_single_players_off_is_refused_while_a_solo_league_plays_the_game(flow):
    flow.act_as(await flow.add_staff())
    game = await make_game(flow)
    await make_league(flow, game, "solo", "Duell Liga")
    await make_league(flow, game, "solo", "Zweite Duell Liga")

    refused = await flow.patch(f"/api/games/{game['id']}", json={"supports_solo": False})

    assert refused.status_code == 409
    assert refused.json()["detail"].startswith("Spiel hat Solo-Ligen: Duell Liga, Zweite Duell Liga.")
    assert (await flow.db.games.find_one({"id": game["id"]}))["supports_solo"] is True
    # Andere Änderungen am selben Spiel gehen weiter durch - auch mit dem unveränderten Schalter.
    other = await flow.patch(f"/api/games/{game['id']}", json={"supports_solo": True, "genre": "Shooter"})
    assert other.status_code == 200, other.text


@pytest.mark.asyncio
async def test_an_archived_solo_league_still_counts(flow):
    flow.act_as(await flow.add_staff())
    game = await make_game(flow)
    league = await make_league(flow, game, "solo", "Duell Liga")
    await flow.patch(f"/api/admin/leagues/{league['id']}", json={"status": "archived"})

    refused = await flow.patch(f"/api/games/{game['id']}", json={"supports_solo": False})

    assert refused.status_code == 409
    assert "Duell Liga" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_without_a_solo_league_the_switch_is_free_and_team_leagues_never_block(flow):
    flow.act_as(await flow.add_staff())
    game = await make_game(flow)
    await make_league(flow, game, None, "Team Liga")

    off = await flow.patch(f"/api/games/{game['id']}", json={"supports_solo": False})
    stored = await flow.db.games.find_one({"id": game["id"]})
    on = await flow.patch(f"/api/games/{game['id']}", json={"supports_solo": True})

    assert off.status_code == 200, off.text
    assert stored["supports_solo"] is False
    assert on.status_code == 200 and on.json()["supports_solo"] is True


@pytest.mark.asyncio
async def test_an_old_game_without_the_field_allows_single_players(flow):
    flow.act_as(await flow.add_staff())
    game = await make_game(flow)
    await flow.db.games.update_one({"id": game["id"]}, {"$unset": {"supports_solo": ""}})

    listed = (await flow.get("/api/admin/leagues")).json()
    solo = await flow.post("/api/admin/leagues", json={"name": "Duell Liga", "game_id": game["id"], "participant_kind": "solo"})

    assert [row["supports_solo"] for row in listed["games"] if row["id"] == game["id"]] == [True]
    assert solo.status_code == 200, solo.text
