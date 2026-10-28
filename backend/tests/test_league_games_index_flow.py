"""Doppel-Einsatz-Index nur aus geltenden Aufstellungen (#1650, Review P4).

Wer aus einer Aufstellung herausfällt - durch eine neue Meldung, einen Nachtrag oder „Rückgängig“ -, darf danach am
selben Spieltag für ein anderes Team derselben Season spielen. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import duel, ids, staffel, two_nil, world  # noqa: E402
from squad_world import squad_registration  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def second_staffel(flow, w: dict) -> dict:
    """Staffel B derselben Season: Rudel B (mit Tom) gegen Horst am selben Spieltag."""
    staffel_b = await staffel(flow, w["season_id"], "B")
    reg_b = await squad_registration(flow, staffel_b, w["lions"], w["squad_b"])
    rivals = await squad_registration(flow, staffel_b, w["falcons"], w["horst"])
    match = await duel(flow, staffel_b, reg_b, rivals, matchday=1)
    body = {
        "results": [
            {"registration_id": reg_b["id"], "rank": 1, "score": 2},
            {"registration_id": rivals["id"], "rank": 2, "score": 0},
        ],
        "games": [
            {
                "position": 1,
                "mode": "stellung",
                "map_id": "map-hafen",
                "winner_registration_id": reg_b["id"],
                "lineup": ids(w, "Tom", "Ida"),
            },
            {
                "position": 2,
                "mode": "suchen",
                "map_id": "map-turm",
                "winner_registration_id": reg_b["id"],
                "lineup": ids(w, "Tom", "Ida"),
            },
        ],
    }
    return {"match": match, "body": body}


async def report_b(flow, w: dict, b: dict):
    flow.act_as(w["users"]["LoeLeitung"])  # Rudel B hat keinen Captain - die Teamleitung handelt dort
    return await flow.post(f"/api/matches/{b['match']['id']}/report", json=b["body"])


@pytest.mark.asyncio
async def test_a_new_report_without_the_person_frees_them(flow):
    w = await world(flow)
    b = await second_staffel(flow, w)
    flow.act_as(w["users"]["Kapitaen"])
    url = f"/api/matches/{w['match']['id']}/report"
    with_tom = await flow.post(url, json=two_nil(w, lineup=ids(w, "Kapitaen", "Tom")))
    assert with_tom.status_code == 200, with_tom.text
    blocked = await report_b(flow, w, b)
    assert blocked.status_code == 409

    flow.act_as(w["users"]["Kapitaen"])
    changed = await flow.post(url, json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    assert changed.status_code == 200, changed.text
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert w["users"]["Tom"]["id"] not in match["lineup_user_ids"], "nur die letzte Meldung je Seite zählt"
    freed = await report_b(flow, w, b)
    assert freed.status_code == 200, freed.text


@pytest.mark.asyncio
async def test_an_amendment_that_removes_the_person_frees_them(flow):
    w = await world(flow)
    b = await second_staffel(flow, w)
    flow.act_as(w["users"]["Kapitaen"])
    await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Tom")))
    flow.act_as(w["users"]["Falke1"])
    confirmed = await flow.post(f"/api/matches/{w['match']['id']}/report", json={"results": two_nil(w)["results"]})
    assert confirmed.status_code == 200, confirmed.text
    blocked = await report_b(flow, w, b)
    assert blocked.status_code == 409

    flow.act_as(w["users"]["Kapitaen"])
    amended = await flow.put(
        f"/api/matches/{w['match']['id']}/lineups",
        json={
            "games": [
                {"position": 1, "lineup": ids(w, "Kapitaen", "Mila")},
                {"position": 2, "lineup": ids(w, "Kapitaen", "Mila")},
            ]
        },
    )
    assert amended.status_code == 200, amended.text
    freed = await report_b(flow, w, b)
    assert freed.status_code == 200, freed.text


@pytest.mark.asyncio
async def test_undo_frees_the_person_from_the_taken_back_result(flow):
    w = await world(flow)
    b = await second_staffel(flow, w)
    a, h = w["reg_a"]["id"], w["reg_h"]["id"]
    flow.act_as(w["staff"])
    games = [
        {
            "position": 1,
            "mode": "stellung",
            "map_id": "map-hafen",
            "winner_registration_id": a,
            "lineups": {a: ids(w, "Kapitaen", "Tom")},
        },
        {
            "position": 2,
            "mode": "suchen",
            "map_id": "map-turm",
            "winner_registration_id": a,
            "lineups": {a: ids(w, "Kapitaen", "Tom")},
        },
    ]
    entered = await flow.post(
        f"/api/matches/{w['match']['id']}/result",
        json={
            "results": [{"registration_id": a, "rank": 1, "score": 2}, {"registration_id": h, "rank": 2, "score": 0}],
            "games": games,
        },
    )
    assert entered.status_code == 200, entered.text
    blocked = await report_b(flow, w, b)
    assert blocked.status_code == 409

    flow.act_as(w["staff"])
    undone = await flow.post(f"/api/matches/{w['match']['id']}/result/undo", json={})
    assert undone.status_code == 200, undone.text
    freed = await report_b(flow, w, b)
    assert freed.status_code == 200, freed.text
