"""Doppel-Einsatz-Index bei gehaltenen Ergebnissen (#1650, Prüfung P4).

Ein gehaltenes Ergebnis (10 Sekunden „Rückgängig“) blockiert seine Aufgestellten sofort, „Rückgängig“ gibt sie frei.
Steht ein Ergebnis ohne Maps fest (etwa „Nicht erschienen“), zählen offene Meldungen nicht mehr. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, world  # noqa: E402
from test_league_games_index_flow import report_b, second_staffel  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def staff_body(w: dict) -> dict:
    a, h = w["reg_a"]["id"], w["reg_h"]["id"]
    lineups = {a: ids(w, "Kapitaen", "Tom")}
    return {
        "results": [{"registration_id": a, "rank": 1, "score": 2}, {"registration_id": h, "rank": 2, "score": 0}],
        "games": [
            {"position": 1, "mode": "stellung", "map_id": "map-hafen", "winner_registration_id": a, "lineups": lineups},
            {"position": 2, "mode": "suchen", "map_id": "map-turm", "winner_registration_id": a, "lineups": lineups},
        ],
        "hold": True,
    }


@pytest.mark.asyncio
async def test_a_held_result_blocks_at_once_and_undo_frees(flow):
    w = await world(flow)
    b = await second_staffel(flow, w)
    flow.act_as(w["staff"])
    held = await flow.post(f"/api/matches/{w['match']['id']}/result", json=staff_body(w))
    assert held.status_code == 200, held.text
    assert held.json()["held"] is True

    blocked = await report_b(flow, w, b)
    assert blocked.status_code == 409, "im Halte-Fenster steht Tom schon fest"

    flow.act_as(w["staff"])
    undone = await flow.post(f"/api/matches/{w['match']['id']}/result/undo", json={})
    assert undone.status_code == 200, undone.text
    assert undone.json()["held"] is True
    freed = await report_b(flow, w, b)
    assert freed.status_code == 200, freed.text
