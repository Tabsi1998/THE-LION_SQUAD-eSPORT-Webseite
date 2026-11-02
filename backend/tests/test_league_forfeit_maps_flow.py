"""Maps fallen bei einer Kampflos-Wertung weg (#2201, D-12). Erfundene Namen.

Eine Wertung über ``/forfeit`` ließ die Maps des Spiels stehen. Tabelle und Matchseite zeigten dann ein 2:0 auf Maps zu
einem Spiel, das kampflos gewertet ist. Wie im Ergebnis-Fenster fallen sie weg, ``match_reports_v2`` hält sie fest.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, two_nil, world as league_world  # noqa: E402

NOTE = "Nachträglich als nicht angetreten gewertet"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def played(flow, world) -> dict:
    """Beide Seiten melden 2:0 mit Maps und Aufstellung - das Ergebnis gilt."""
    url = f"/api/matches/{world['match']['id']}/report"
    flow.act_as(world["users"]["Kapitaen"])
    first = await flow.post(url, json=two_nil(world, lineup=ids(world, "Kapitaen", "Mila")))
    assert first.status_code == 200, first.text
    flow.act_as(world["users"]["Falke1"])
    second = await flow.post(url, json=two_nil(world, lineup=ids(world, "Falke1", "Falke2"), side="reg_h"))
    assert second.status_code == 200, second.text
    stored = await flow.reload(world["match"])
    assert stored["status"] == "completed" and len(stored["games"]) == 2
    return stored


@pytest.mark.asyncio
async def test_a_forfeit_drops_the_maps_and_keeps_them_in_the_report_history(flow):
    world = await league_world(flow)
    before = await played(flow, world)
    flow.act_as(world["staff"])
    answer = await flow.post(f"/api/matches/{world['match']['id']}/forfeit?force=true",
                             json={"forfeit_registration_id": world["reg_a"]["id"], "note": NOTE})
    assert answer.status_code == 200, answer.text
    stored = await flow.reload(world["match"])
    assert stored["status"] == "forfeit"
    assert stored["games"] == [] and stored["lineups_missing"] == []
    assert not stored.get("lineup_user_ids"), "wer auf den Maps stand, zählt nicht mehr für den Doppel-Einsatz"
    report = await flow.db.match_reports_v2.find_one({"id": stored["result_meta"]["report_id"]}, {"_id": 0})
    assert report["games"] == [] and report["previous_games"] == before["games"]
    assert report["previous_results"] == before["results"]


@pytest.mark.asyncio
async def test_a_forfeit_without_maps_writes_no_maps(flow):
    world = await league_world(flow)
    flow.act_as(world["staff"])
    answer = await flow.post(f"/api/matches/{world['match']['id']}/forfeit",
                             json={"forfeit_registration_id": world["reg_a"]["id"], "note": NOTE})
    assert answer.status_code == 200, answer.text
    stored = await flow.reload(world["match"])
    assert "games" not in stored and "lineups_missing" not in stored
    report = await flow.db.match_reports_v2.find_one({"id": stored["result_meta"]["report_id"]}, {"_id": 0})
    assert "games" not in report


@pytest.mark.asyncio
async def test_a_cup_forfeit_stays_without_maps(flow):
    """Regression: Ein Pokal kennt keine Maps am Spiel."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, registrations = await flow.with_participants(2, format="single_elim", event_mode="online")
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    await flow.start(tournament)
    match = (await flow.matches(tournament))[0]
    answer = await flow.post(f"/api/matches/{match['id']}/forfeit",
                             json={"forfeit_registration_id": registrations[0]["id"], "note": NOTE})
    assert answer.status_code == 200, answer.text
    stored = await flow.reload(match)
    assert stored["status"] == "forfeit" and "games" not in stored
