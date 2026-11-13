"""Öffentliche Antworten zu den Zusatzfeldern je Map (docs/LIGA.md, C.3, #1617): „wiederholt“, „zugesprochen“, Seite und die nicht
gespielten Maps stehen auch öffentlich da, der Nachweis (``proof_id``) und der Grund einer Wiederholung (``replay_reason``, #2268)
bleiben bei Beteiligten und Leitung. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import world  # noqa: E402
from services.league_page import public_match  # noqa: E402
from services.match_public_view import public_games  # noqa: E402

EXTRAS = {"status": "replayed", "replay_reason": "Verbindung brach ab", "host_registration_id": "a", "proof_id": "foto-1"}
GAMES = [
    {"position": 1, "mode": "stellung", "map_id": "hafen", "winner_registration_id": "a", "scores": {"a": 250, "b": 1},
     "lineups": {"a": ["u1"]}, **EXTRAS},
    {"position": 2, "mode": "suchen", "map_id": "turm", "winner_registration_id": "a", "scores": {}, "decision": "awarded"},
    {"position": 3, "mode": "stellung", "map_id": "nebel", "winner_registration_id": "a", "scores": {"a": 250, "b": 2}},
]
MATCH = {"id": "m1", "status": "completed", "best_of": 5, "games": GAMES,
         "slots": [{"slot": 1, "registration_id": "a"}, {"slot": 2, "registration_id": "b"}],
         "results": [{"registration_id": "a", "rank": 1, "score": 3}, {"registration_id": "b", "rank": 2, "score": 0}]}


def test_public_match_view_keeps_the_extras_but_not_the_proof_nor_the_replay_reason():
    games = public_games(GAMES)

    assert {key: games[0][key] for key in ("status", "host_registration_id")} == {"status": "replayed", "host_registration_id": "a"}
    assert "replay_reason" not in games[0]
    assert games[1]["decision"] == "awarded"
    assert all("proof_id" not in game and "lineups" not in game for game in games)
    assert "status" not in games[2] and "decision" not in games[2]


def test_league_page_shows_the_extras_and_the_maps_not_played():
    view = public_match(MATCH, {})

    assert view["games"][0]["status"] == "replayed" and "replay_reason" not in view["games"][0]
    assert view["games"][1]["decision"] == "awarded"
    assert all("proof_id" not in game for game in view["games"])
    # Ohne Zusatzfelder bleibt eine Map, wie sie vor C.3 öffentlich aussah.
    assert set(view["games"][2]) == {"position", "mode", "map_id", "map_name", "map_image_url", "winner_registration_id", "scores"}
    assert view["not_played"] == [4, 5]
    assert public_match({**MATCH, "status": "scheduled"}, {})["not_played"] == []


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_a_stranger_reads_the_extras_without_the_proof(flow):
    w = await world(flow)
    a, h = w["reg_a"]["id"], w["reg_h"]["id"]
    games = [{**GAMES[0], "map_id": "map-hafen", "winner_registration_id": a, "host_registration_id": a, "scores": {a: 250, h: 1}},
             {**GAMES[1], "map_id": "map-turm", "winner_registration_id": a}]
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {
        "status": "completed", "games": games,
        "results": [{"registration_id": a, "rank": 1, "score": 2}, {"registration_id": h, "rank": 2, "score": 0}]}})
    flow.act_as(w["users"]["Fremd"])

    page = await flow.get(f"/api/matches/{w['match']['id']}/page")

    assert page.status_code == 200, page.text
    body = page.json()
    shown = body["match"]["games"]
    assert shown[0]["status"] == "replayed" and shown[1]["decision"] == "awarded"
    assert "proof_id" not in str(body)
    # Den Grund der Wiederholung liest ein Fremder nirgends (#2268) - weder an der Map noch im Block der Liga.
    assert "Verbindung brach ab" not in str(body)

    # Der Captain einer beteiligten Seite liest ihn im Block der Liga.
    flow.act_as(w["users"]["Kapitaen"])
    own = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    assert "replay_reason" not in own["match"]["games"][0]
    assert own["league"]["games"][0]["replay_reason"] == "Verbindung brach ab"
