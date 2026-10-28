"""Eingaben beim Ergebnis je Map (#1650, Review P4): Name und Bild der Map setzt nur der Server, fremde Seiten in den
Punkten werden abgelehnt, und die Turnierleitung kann ein Liga-Spiel auch ohne Maps eintragen. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, two_nil, world  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_map_name_and_image_from_the_client_are_ignored(flow):
    w = await world(flow)
    body = two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))
    body["games"] = [
        {**game, "map_name": "Gefälschte Map", "map_image_url": "/uploads/fremd.webp", "mode_label": "X"}
        for game in body["games"]
    ]
    flow.act_as(w["users"]["Kapitaen"])

    response = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body)

    assert response.status_code == 200, response.text
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    stored = match["reports"][-1]["games"]
    assert [game["map_name"] for game in stored] == ["Hafen", "Turm"]
    assert [game["map_image_url"] for game in stored] == ["/uploads/maps/hafen.webp", "/uploads/maps/turm.webp"]
    assert [game["mode_label"] for game in stored] == ["Stellung", "Suchen & Zerstören"]


@pytest.mark.asyncio
async def test_scores_for_a_foreign_side_are_refused(flow):
    w = await world(flow)
    body = two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))
    body["games"][0]["scores"] = {w["reg_a"]["id"]: 250, "fremde-anmeldung": 10}
    flow.act_as(w["users"]["Kapitaen"])

    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body)

    assert refused.status_code == 422
    assert "Punkte gehören zu den beiden Seiten" in refused.json()["detail"]
    negative = two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))
    negative["games"][0]["scores"] = {w["reg_a"]["id"]: -5}
    also_refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=negative)
    assert also_refused.status_code == 422


@pytest.mark.asyncio
async def test_staff_enters_a_league_result_without_maps(flow):
    w = await world(flow)
    a, h = w["reg_a"]["id"], w["reg_h"]["id"]
    flow.act_as(w["staff"])

    entered = await flow.post(
        f"/api/matches/{w['match']['id']}/result",
        json={"results": [{"registration_id": a, "rank": 1}, {"registration_id": h, "rank": 2, "forfeit": True}]},
    )

    assert entered.status_code == 200, entered.text
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert match["status"] == "completed"
    assert "games" not in match and "lineups_missing" not in match
    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    assert page["league"]["games"] == []
