"""Dieselbe Person steht nie auf beiden Seiten desselben Spiels (docs/LIGA.md, #2202 D-6): nicht beim Melden, nicht beim
Bestätigen, nicht beim Nachtragen, nicht in der Korrektur der Leitung. Altbestand hält keine Korrektur auf. Erfundene
Namen."""

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


async def both_kaders(flow) -> dict:
    """Mila steht im Kader beider Seiten - etwa, weil sie während der Season das Co-Team gewechselt hat."""
    w = await world(flow)
    mila = w["users"]["Mila"]["id"]
    await flow.db.teams.update_one({"id": w["falcons"]["id"]}, {"$addToSet": {"member_ids": mila}})
    await flow.db.team_members.insert_one({"team_id": w["falcons"]["id"], "user_id": mila, "role": "member"})
    await flow.db.team_squads.update_one({"id": w["horst"]["id"]}, {"$addToSet": {"member_ids": mila}})
    return w


def lineups(w: dict, a: list[str] | None, h: list[str] | None) -> dict:
    rows = {}
    if a:
        rows[w["reg_a"]["id"]] = ids(w, *a)
    if h:
        rows[w["reg_h"]["id"]] = ids(w, *h)
    return rows


async def decided(flow, w: dict, a: list[str], h: list[str] | None = None) -> None:
    body = two_nil(w)
    games = [{**game, "mode_label": None, "map_name": None, "map_image_url": None, "scores": game.get("scores") or {},
              "lineups": lineups(w, a, h)} for game in body["games"]]
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {
        "games": games, "status": "completed", "results": body["results"], "completed_at": "2026-10-20T10:00:00+00:00"}})


def correction(w: dict, a: list[str] | None, h: list[str] | None) -> dict:
    body = two_nil(w)
    body["reason"] = "Aufstellung korrigiert"
    for game in body["games"]:
        game["lineups"] = lineups(w, a, h)
    return body


@pytest.mark.asyncio
async def test_confirming_refuses_a_player_who_stands_in_the_other_sides_report(flow):
    w = await both_kaders(flow)
    flow.act_as(w["users"]["Kapitaen"])
    first = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    assert first.status_code == 200, first.text

    flow.act_as(w["users"]["Falke1"])
    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Falke1", "Mila")))

    assert refused.status_code == 422
    assert "Mila" in refused.json()["detail"] and "beiden Seiten" in refused.json()["detail"]
    stored = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert stored["status"] != "completed", "das Ergebnis steht nicht fest"
    assert len(stored["reports"]) == 1

    fine = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Falke1", "Falke2")))
    assert fine.status_code == 200, fine.text
    assert (await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0}))["status"] == "completed"


@pytest.mark.asyncio
async def test_the_first_report_refuses_a_player_on_the_other_side_too(flow):
    w = await both_kaders(flow)
    flow.act_as(w["users"]["Falke1"])
    first = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Falke1", "Mila")))
    assert first.status_code == 200, first.text

    flow.act_as(w["users"]["Kapitaen"])
    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))

    assert refused.status_code == 422 and "beiden Seiten" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_the_rule_spans_all_maps_of_the_match_not_only_the_same_map(flow):
    w = await both_kaders(flow)
    flow.act_as(w["users"]["Kapitaen"])
    body = two_nil(w)
    body["games"][0]["lineup"] = ids(w, "Kapitaen", "Mila")
    body["games"][1]["lineup"] = ids(w, "Kapitaen", "Tom")
    first = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body)
    assert first.status_code == 200, first.text

    flow.act_as(w["users"]["Falke1"])
    other = two_nil(w)
    other["games"][0]["lineup"] = ids(w, "Falke1", "Falke2")
    other["games"][1]["lineup"] = ids(w, "Falke1", "Mila")
    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=other)

    assert refused.status_code == 422 and "beiden Seiten" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_amending_refuses_a_player_who_plays_for_the_other_side(flow):
    w = await both_kaders(flow)
    await decided(flow, w, ["Kapitaen", "Mila"])
    flow.act_as(w["staff"])
    lineup = ids(w, "Falke1", "Mila")

    refused = await flow.put(f"/api/matches/{w['match']['id']}/lineups", json={
        "registration_id": w["reg_h"]["id"], "reason": "Nachtrag der Leitung",
        "games": [{"position": 1, "lineup": lineup}, {"position": 2, "lineup": lineup}]})

    assert refused.status_code == 422 and "beiden Seiten" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_a_staff_result_refuses_one_person_on_both_sides(flow):
    w = await both_kaders(flow)
    flow.act_as(w["staff"])

    refused = await flow.post(f"/api/matches/{w['match']['id']}/result",
                              json=correction(w, ["Kapitaen", "Mila"], ["Falke1", "Mila"]))

    assert refused.status_code == 422 and "beiden Seiten" in refused.json()["detail"]
    fine = await flow.post(f"/api/matches/{w['match']['id']}/result",
                           json=correction(w, ["Kapitaen", "Mila"], ["Falke1", "Falke2"]))
    assert fine.status_code == 200, fine.text


@pytest.mark.asyncio
async def test_a_staff_correction_may_move_a_player_to_the_other_side(flow):
    """Die Korrektur ersetzt beide Aufstellungen - verglichen wird also, was sie schickt, nicht der alte Stand."""
    w = await both_kaders(flow)
    await decided(flow, w, ["Kapitaen", "Mila"], ["Falke1", "Falke2"])
    flow.act_as(w["staff"])

    moved = await flow.post(f"/api/matches/{w['match']['id']}/result?force=true",
                            json=correction(w, ["Kapitaen", "Tom"], ["Falke1", "Mila"]))

    assert moved.status_code == 200, moved.text


# ---------------------------------------------------------------- Altbestand


@pytest.mark.asyncio
async def test_old_data_on_both_sides_does_not_stop_a_correction(flow):
    w = await both_kaders(flow)
    await decided(flow, w, ["Kapitaen", "Mila"], ["Falke1", "Mila"])
    flow.act_as(w["staff"])
    body = correction(w, ["Kapitaen", "Mila"], ["Falke1", "Mila"])
    body["games"][0]["scores"] = {w["reg_a"]["id"]: 251, w["reg_h"]["id"]: 180}

    corrected = await flow.post(f"/api/matches/{w['match']['id']}/result?force=true", json=body)

    assert corrected.status_code == 200, corrected.text
    stored = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert stored["games"][0]["scores"][w["reg_a"]["id"]] == 251


@pytest.mark.asyncio
async def test_old_data_on_both_sides_does_not_stop_an_amendment(flow):
    w = await both_kaders(flow)
    await decided(flow, w, ["Kapitaen", "Mila"], ["Falke1", "Mila"])
    flow.act_as(w["staff"])
    lineup = ids(w, "Falke2", "Mila")

    amended = await flow.put(f"/api/matches/{w['match']['id']}/lineups", json={
        "registration_id": w["reg_h"]["id"], "reason": "Nachtrag der Leitung",
        "games": [{"position": 1, "lineup": lineup}, {"position": 2, "lineup": lineup}]})

    assert amended.status_code == 200, amended.text


@pytest.mark.asyncio
async def test_old_data_does_not_let_a_second_person_onto_both_sides(flow):
    w = await both_kaders(flow)
    tom = w["users"]["Tom"]["id"]
    await flow.db.teams.update_one({"id": w["falcons"]["id"]}, {"$addToSet": {"member_ids": tom}})
    await flow.db.team_members.insert_one({"team_id": w["falcons"]["id"], "user_id": tom, "role": "member"})
    await flow.db.team_squads.update_one({"id": w["horst"]["id"]}, {"$addToSet": {"member_ids": tom}})
    await decided(flow, w, ["Kapitaen", "Mila"], ["Falke1", "Mila"])
    flow.act_as(w["staff"])

    refused = await flow.post(f"/api/matches/{w['match']['id']}/result?force=true",
                              json=correction(w, ["Tom", "Mila"], ["Tom", "Mila"]))

    assert refused.status_code == 422 and "Tom" in refused.json()["detail"]


async def kept_entries(flow) -> list[dict]:
    return await flow.db.audit_logs.find({"action": "match.lineup.both_sides_kept"}, {"_id": 0}).to_list(None)


@pytest.mark.asyncio
async def test_a_correction_that_keeps_old_data_on_both_sides_stands_in_the_log_without_names(flow):
    w = await both_kaders(flow)
    await decided(flow, w, ["Kapitaen", "Mila"], ["Falke1", "Mila"])
    flow.act_as(w["staff"])

    corrected = await flow.post(f"/api/matches/{w['match']['id']}/result?force=true",
                                json=correction(w, ["Kapitaen", "Mila"], ["Falke1", "Mila"]))

    assert corrected.status_code == 200, corrected.text
    rows = await kept_entries(flow)
    assert len(rows) == 1
    assert rows[0]["target_id"] == w["tournament"]["id"] and rows[0]["actor_id"] == w["staff"]["id"]
    assert rows[0]["data"] == {"match_id": w["match"]["id"], "people": 1}, "ohne Namen und Kennungen der Personen"


@pytest.mark.asyncio
async def test_an_amendment_that_keeps_old_data_on_both_sides_stands_in_the_log(flow):
    w = await both_kaders(flow)
    await decided(flow, w, ["Kapitaen", "Mila"], ["Falke1", "Mila"])
    flow.act_as(w["staff"])
    lineup = ids(w, "Falke2", "Mila")

    amended = await flow.put(f"/api/matches/{w['match']['id']}/lineups", json={
        "registration_id": w["reg_h"]["id"], "reason": "Nachtrag der Leitung",
        "games": [{"position": 1, "lineup": lineup}, {"position": 2, "lineup": lineup}]})

    assert amended.status_code == 200, amended.text
    assert [row["data"]["people"] for row in await kept_entries(flow)] == [1]


@pytest.mark.asyncio
async def test_a_correction_that_clears_the_old_data_leaves_no_log_entry(flow):
    w = await both_kaders(flow)
    await decided(flow, w, ["Kapitaen", "Mila"], ["Falke1", "Mila"])
    flow.act_as(w["staff"])

    corrected = await flow.post(f"/api/matches/{w['match']['id']}/result?force=true",
                                json=correction(w, ["Kapitaen", "Mila"], ["Falke1", "Falke2"]))

    assert corrected.status_code == 200, corrected.text
    assert await kept_entries(flow) == []


@pytest.mark.asyncio
async def test_an_ordinary_correction_leaves_no_log_entry(flow):
    w = await both_kaders(flow)
    await decided(flow, w, ["Kapitaen", "Mila"], ["Falke1", "Falke2"])
    flow.act_as(w["staff"])

    corrected = await flow.post(f"/api/matches/{w['match']['id']}/result?force=true",
                                json=correction(w, ["Kapitaen", "Mila"], ["Falke1", "Falke2"]))

    assert corrected.status_code == 200, corrected.text
    assert await kept_entries(flow) == []


# ---------------------------------------------------------------- Kompatibel


@pytest.mark.asyncio
async def test_the_app_can_still_confirm_without_maps(flow):
    w = await both_kaders(flow)
    flow.act_as(w["users"]["Kapitaen"])
    body = two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))
    first = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body)
    assert first.status_code == 200, first.text

    flow.act_as(w["users"]["Falke1"])
    confirmed = await flow.post(f"/api/matches/{w['match']['id']}/report", json={"results": body["results"]})

    assert confirmed.status_code == 200, confirmed.text
    stored = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert stored["status"] == "completed" and stored["lineups_missing"] == [w["reg_h"]["id"]]
