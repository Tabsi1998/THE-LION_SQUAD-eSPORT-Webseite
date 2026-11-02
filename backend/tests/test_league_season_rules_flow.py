"""Spielberechtigung (docs/LIGA.md, B.3, #2204): die Einstellungen je Season.

Neue Seasons bekommen die Vorgaben; Seasons von vorher tragen die Felder nicht und bleiben, wie sie sind. Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import league_service  # noqa: E402
from test_league_admin_flow import ADMIN, setup_league  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def new_season(flow, league: dict, **fields):
    return await flow.post(f"{ADMIN}/{league['id']}/seasons", json={"start_date": "2027-03-02T00:00:00", **fields})


@pytest.mark.asyncio
async def test_a_new_season_gets_the_rules_of_the_league_office(flow):
    _admin, _game, _league, season, _division, _maps = await setup_league(flow)

    assert season["min_squad_size"] == 3, "der Mindestkader liegt unter der Sollstärke"
    assert season["team_size"] == 4
    assert season["max_squad_size"] == 50
    assert season["one_team_per_season"] is True
    assert season["new_player_wait_days"] == 7
    assert season["transfer_windows"] == []
    assert season["min_age"] == 18
    assert season["unique_game_ids"] is True
    assert season["lineup_mode"] == "series"
    assert season["lineup_min_players"] == 3
    assert "roster_deadline" not in season, "der Stichtag ist optional"


@pytest.mark.asyncio
async def test_every_rule_can_be_set_per_season(flow):
    _admin, _game, league, _season, _division, _maps = await setup_league(flow)

    created = await new_season(flow, league, min_squad_size=5, max_squad_size=12, one_team_per_season=False,
                               new_player_wait_days=0, min_age=0, unique_game_ids=False, lineup_min_players=4,
                               transfer_windows=[{"start_date": "2027-04-01", "end_date": "2027-04-07", "label": "Frühjahr"}])

    assert created.status_code == 200, created.text
    body = created.json()
    assert (body["min_squad_size"], body["max_squad_size"], body["one_team_per_season"]) == (5, 12, False)
    assert (body["new_player_wait_days"], body["min_age"], body["unique_game_ids"]) == (0, 0, False)
    assert body["lineup_min_players"] == 4
    assert body["transfer_windows"] == [{"start_date": "2027-04-01", "end_date": "2027-04-07", "label": "Frühjahr"}]


@pytest.mark.asyncio
async def test_rules_per_map_keep_the_old_squad_rule(flow):
    _admin, _game, league, _season, _division, _maps = await setup_league(flow)

    per_map = await new_season(flow, league, lineup_mode="per_map")
    assert per_map.status_code == 200, per_map.text
    assert per_map.json()["min_squad_size"] == 4, "je Map braucht es mindestens die Teamgröße"

    too_small = await new_season(flow, league, lineup_mode="per_map", min_squad_size=3)
    assert too_small.status_code == 422
    assert "kleiner als die Teamgröße" in too_small.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize(("fields", "expected"), [
    ({"min_squad_size": 2}, "Mindestkader"),
    ({"max_squad_size": 2}, "Höchstkader"),
    ({"transfer_windows": [{"start_date": "2027-04-07", "end_date": "2027-04-01"}]}, "Transferfenster"),
])
async def test_rules_that_do_not_fit_are_refused(flow, fields, expected):
    _admin, _game, league, _season, _division, _maps = await setup_league(flow)

    created = await new_season(flow, league, **fields)

    assert created.status_code == 422, created.text
    assert expected in str(created.json()["detail"])


@pytest.mark.asyncio
async def test_the_staffel_carries_mode_and_minimum_and_they_are_synced_before_the_first_result(flow):
    _admin, _game, _league, season, division, _maps = await setup_league(flow)
    created = await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})
    assert created.status_code == 200, created.text
    staffel = await flow.db.tournaments.find_one({"id": created.json()["tournament_id"]}, {"_id": 0})
    assert staffel["lineup_mode"] == "series"
    assert staffel["lineup_min_players"] == 3
    assert staffel["min_squad_size"] == 3

    changed = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"lineup_min_players": 4, "min_squad_size": 4})
    assert changed.status_code == 200, changed.text
    synced = await flow.post(f"{ADMIN}/seasons/{season['id']}/sync", json={})
    assert synced.status_code == 200, synced.text
    stored = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    assert stored["lineup_min_players"] == 4
    assert stored["min_squad_size"] == 4


@pytest.mark.asyncio
async def test_an_older_season_without_the_fields_stays_as_it_was(flow):
    _admin, _game, _league, season, division, _maps = await setup_league(flow)
    fields = ("max_squad_size", "one_team_per_season", "new_player_wait_days", "transfer_windows", "min_age",
              "unique_game_ids", "lineup_mode", "lineup_min_players")
    await flow.db.league_seasons.update_one({"id": season["id"]}, {
        "$unset": {key: "" for key in fields}, "$set": {"min_squad_size": 4}})
    old = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})

    settings = league_service.effective_settings(old, division)
    assert settings["min_squad_size"] == 4
    created = await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})
    assert created.status_code == 200, created.text
    stored = await flow.db.tournaments.find_one({"id": created.json()["tournament_id"]}, {"_id": 0})
    assert "lineup_mode" not in stored, "ohne Feld bleibt die Aufstellung je Map"
    assert "lineup_min_players" not in stored

    # Eine Teamgröße darüber lässt den Mindestkader wie bisher mitwachsen.
    grown = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"team_size": 5})
    assert grown.status_code == 200, grown.text
    assert grown.json()["min_squad_size"] == 5


@pytest.mark.asyncio
async def test_the_form_gets_the_rules_as_defaults(flow):
    await setup_league(flow)

    overview = await flow.get(ADMIN)

    defaults = overview.json()["season_defaults"]
    assert defaults["max_squad_size"] == 50
    assert defaults["lineup_mode"] == "series"
    assert defaults["min_squad_size"] == 3
