"""Punkte nach gewonnenen Maps (#2312, docs/LIGA.md E.1) über die echten Routen: Season umstellen (mit Protokoll),
auf die laufende Staffel übertragen, Tabelle auf Ligaseite, Turnierseite und in der Verwaltung. Eine beendete Staffel
behält ihre Punkteart. Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from test_league_table_e1_flow import ADMIN, TABLE, matches_of, page, result, setup  # noqa: E402

MAPS_ORDER = ["wins", "head_to_head", "score_diff", "lead_decision"]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def switch(flow, season_id, mode, tiebreakers=None):
    season = await flow.db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    rules = {**season["scoring_rules"], "match_points_mode": mode}
    if tiebreakers is not None:
        rules["table_tiebreakers"] = tiebreakers
    response = await flow.patch(f"{ADMIN}/seasons/{season_id}", json={"scoring_rules": rules})
    assert response.status_code == 200, response.text
    return response


async def sync(flow, season_id, staffel_id):
    response = await flow.post(f"{ADMIN}/seasons/{season_id}/sync")
    assert response.status_code == 200, response.text
    return next(row for row in response.json()["staffeln"] if row["tournament_id"] == staffel_id)


@pytest.mark.asyncio
async def test_switch_running_season_to_map_points(flow):
    admin, _league, staffel = await setup(flow)
    season_id = staffel["league_context"]["season_id"]
    assert staffel["scoring_rules"]["match_points_mode"] == "result", "neue Seasons bleiben bei Sieg/Niederlage"
    played = []
    for match in await matches_of(flow, staffel, 1):
        played.append(await result(flow, match, 3, 2))
    rows = (await page(flow, staffel))["standings"]
    assert sorted(row["points"] for row in rows) == [0, 0, 3, 3]

    await switch(flow, season_id, "maps", MAPS_ORDER)
    audit = await flow.db.audit_logs.find_one({"action": "league.season.table_points"}, {"_id": 0})
    assert audit["data"]["before"] == "result" and audit["data"]["after"] == "maps"
    assert audit["data"]["tiebreakers"] == MAPS_ORDER

    # Laufende Staffel mit Ergebnis: nur die Punkteart geht über, Best of und Co. bleiben „vor dem ersten Ergebnis“.
    row = await sync(flow, season_id, staffel["id"])
    assert "table_points" in row["applied"] and "before_result" not in row["applied"]
    stored = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0, "scoring_rules": 1})
    assert stored["scoring_rules"]["match_points_mode"] == "maps"
    assert stored["scoring_rules"]["table_tiebreakers"] == MAPS_ORDER

    flow.act_as(None)
    data = await page(flow, staffel)
    points = {row["registration_id"]: row["points"] for row in data["standings"]}
    for winner, loser in played:
        assert (points[winner], points[loser]) == (3, 2)
    assert data["staffel"]["table_rules"]["match_points_mode"] == "maps"
    assert data["staffel"]["table_rules"]["tiebreakers"] == MAPS_ORDER
    turnier = (await flow.get(f"/api/tournaments/{staffel['id']}/standings")).json()
    assert {row["registration_id"]: row["points"] for row in turnier} == points

    flow.act_as(admin)
    overview = (await flow.get(f"{TABLE}/{staffel['id']}/table")).json()
    assert overview["rules"]["match_points_mode"] == "maps"

    # Ein zweites Übertragen ändert nichts mehr.
    again = await sync(flow, season_id, staffel["id"])
    assert "table_points" not in again["applied"]


@pytest.mark.asyncio
async def test_finished_staffel_keeps_its_points_and_no_switch_no_audit(flow):
    _admin, _league, staffel = await setup(flow)
    season_id = staffel["league_context"]["season_id"]
    for match in await matches_of(flow, staffel, 1):
        await result(flow, match, 3, 1)
    # Speichern ohne Wechsel: kein Eintrag „Punkteart“.
    await switch(flow, season_id, "result")
    assert await flow.db.audit_logs.count_documents({"action": "league.season.table_points"}) == 0

    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"status": "completed"}})
    await switch(flow, season_id, "maps", MAPS_ORDER)
    row = await sync(flow, season_id, staffel["id"])
    assert "table_points" not in row["applied"]
    stored = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0, "scoring_rules": 1})
    assert stored["scoring_rules"]["match_points_mode"] == "result"
    rows = (await page(flow, staffel))["standings"]
    assert sorted(row["points"] for row in rows) == [0, 0, 3, 3]
