"""Map-Wiederholung in einer Serie (#2096, Browser-Durchlauf): dieselbe Map im selben Modus nur einmal je Serie
(Vorgabe), dieselbe Map in einem anderen Modus geht. Die Season stellt es ein: nie, nur anderer Modus, immer - die
Staffel trägt den Wert. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, world  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def series(w: dict, maps: list[tuple[str, str]]) -> dict:
    """Rudel A gewinnt 2:1 - Map 1 und 3 für Rudel A, Map 2 für Horst; je Map (Modus, Map)."""
    a, h = w["reg_a"]["id"], w["reg_h"]["id"]
    winners = [a, h, a][: len(maps)]
    return {
        "results": [{"registration_id": a, "rank": 1, "score": 2}, {"registration_id": h, "rank": 2, "score": len(maps) - 2}],
        "games": [{"position": index, "mode": mode, "map_id": map_id, "winner_registration_id": winner,
                   "lineup": ids(w, "Kapitaen", "Mila")}
                  for index, ((mode, map_id), winner) in enumerate(zip(maps, winners), start=1)],
    }


async def report(flow, w: dict, maps: list[tuple[str, str]]):
    flow.act_as(w["users"]["Kapitaen"])
    return await flow.post(f"/api/matches/{w['match']['id']}/report", json=series(w, maps))


@pytest.mark.asyncio
async def test_the_same_map_in_the_same_mode_is_refused_by_default(flow):
    w = await world(flow)

    refused = await report(flow, w, [("stellung", "map-hafen"), ("suchen", "map-turm"), ("stellung", "map-hafen")])

    assert refused.status_code == 422
    assert refused.json()["detail"] == ("Map 3: Hafen (Stellung) lief schon als Map 1 – dieselbe Map im selben Modus "
                                        "nur einmal je Serie.")
    other_mode = await report(flow, w, [("stellung", "map-nebel"), ("suchen", "map-nebel"), ("stellung", "map-hafen")])
    assert other_mode.status_code == 200, other_mode.text


@pytest.mark.asyncio
async def test_never_allows_each_map_once_and_always_allows_any(flow):
    w = await world(flow)
    twice = [("stellung", "map-nebel"), ("suchen", "map-nebel"), ("stellung", "map-hafen")]

    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"map_repeat": "never"}})
    refused = await report(flow, w, twice)
    assert refused.status_code == 422
    assert "Nebel lief schon als Map 1" in refused.json()["detail"] and "jede Map nur einmal" in refused.json()["detail"]

    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"map_repeat": "always"}})
    same = await report(flow, w, [("stellung", "map-hafen"), ("suchen", "map-turm"), ("stellung", "map-hafen")])
    assert same.status_code == 200, same.text


@pytest.mark.asyncio
async def test_staff_entries_follow_the_same_rule(flow):
    w = await world(flow)
    a, h = w["reg_a"]["id"], w["reg_h"]["id"]
    flow.act_as(w["staff"])
    body = {"results": [{"registration_id": a, "rank": 1, "score": 2}, {"registration_id": h, "rank": 2, "score": 1}],
            "games": [{"position": 1, "mode": "stellung", "map_id": "map-hafen", "winner_registration_id": a},
                      {"position": 2, "mode": "suchen", "map_id": "map-turm", "winner_registration_id": h},
                      {"position": 3, "mode": "stellung", "map_id": "map-hafen", "winner_registration_id": a}]}

    refused = await flow.post(f"/api/matches/{w['match']['id']}/result", json=body)

    assert refused.status_code == 422 and "lief schon als Map 1" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_the_season_sets_it_and_the_staffel_carries_it(flow):
    from test_league_admin_flow import setup_league

    _admin, _game, _league, season, division, _maps = await setup_league(flow)
    assert season["map_repeat"] == "other_mode"
    assert (await flow.patch(f"/api/admin/leagues/seasons/{season['id']}", json={"map_repeat": "sometimes"})).status_code == 422
    changed = await flow.patch(f"/api/admin/leagues/seasons/{season['id']}", json={"map_repeat": "never"})
    assert changed.status_code == 200 and changed.json()["map_repeat"] == "never", changed.text

    created = (await flow.post(f"/api/admin/leagues/divisions/{division['id']}/staffeln", json={})).json()
    staffel = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
    assert staffel["map_repeat"] == "never"

    # Vor dem ersten Ergebnis geht eine Änderung über „Vorgaben übertragen“ an die Staffel.
    await flow.patch(f"/api/admin/leagues/seasons/{season['id']}", json={"map_repeat": "always"})
    synced = await flow.post(f"/api/admin/leagues/seasons/{season['id']}/sync")
    assert synced.status_code == 200, synced.text
    assert (await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0}))["map_repeat"] == "always"
