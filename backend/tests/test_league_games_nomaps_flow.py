"""Doppel-Einsatz-Index bei Ergebnissen ohne Maps (#1650, Prüfung P4).

Ein gehaltenes Ergebnis (10 Sekunden „Rückgängig“) blockiert seine Aufgestellten sofort, „Rückgängig“ gibt sie frei.
Steht ein Ergebnis ohne Maps fest (etwa „Nicht erschienen“), zählen offene Meldungen nicht mehr. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, two_nil, world  # noqa: E402
from test_league_games_index_flow import report_b, second_staffel  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_a_result_without_maps_frees_the_open_reports(flow):
    w = await world(flow)
    b = await second_staffel(flow, w)
    flow.act_as(w["users"]["Kapitaen"])
    reported = await flow.post(
        f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Tom"))
    )
    assert reported.status_code == 200, reported.text
    blocked = await report_b(flow, w, b)
    assert blocked.status_code == 409

    flow.act_as(w["staff"])
    a, h = w["reg_a"]["id"], w["reg_h"]["id"]
    no_show = await flow.post(
        f"/api/matches/{w['match']['id']}/result",
        json={"results": [{"registration_id": a, "rank": 1}, {"registration_id": h, "rank": 2, "forfeit": True}]},
    )
    assert no_show.status_code == 200, no_show.text
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert "lineup_user_ids" not in match, "ohne Maps gilt keine Aufstellung mehr"

    freed = await report_b(flow, w, b)
    assert freed.status_code == 200, freed.text
