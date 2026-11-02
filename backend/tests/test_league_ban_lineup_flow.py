"""Eine Kontosperre gilt auch in der Liga (docs/LIGA.md, #2202 D-4): Wer gesperrt ist, lässt sich nicht aufstellen und zählt
nicht als Verantwortlicher eines Co-Teams. Altbestand bleibt bei Korrektur und Nachtrag. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, two_nil, world  # noqa: E402
from test_league_roster_flow import assign_squad_b, id_world, page  # noqa: E402

from services import match_audience  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def ban(flow, user: dict) -> None:
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"is_banned": True}})


async def decided(flow, w: dict, *names: str) -> None:
    """Ein entschiedenes Spiel, in dem die Genannten schon für Rudel A aufgestellt sind."""
    body = two_nil(w)
    games = [{**game, "mode_label": None, "map_name": None, "map_image_url": None, "scores": game.get("scores") or {},
              "lineups": {w["reg_a"]["id"]: ids(w, *names)}} for game in body["games"]]
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {
        "games": games, "status": "completed", "results": body["results"], "completed_at": "2026-10-20T10:00:00+00:00"}})


# ---------------------------------------------------------------- Aufstellen


@pytest.mark.asyncio
async def test_a_banned_player_cannot_be_lined_up_even_with_a_valid_id(flow):
    w = await id_world(flow)
    await ban(flow, w["users"]["Mila"])
    flow.act_as(w["users"]["Kapitaen"])

    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))

    assert refused.status_code == 422
    assert "Mila kann nicht aufgestellt werden" in refused.json()["detail"] and "gesperrt" in refused.json()["detail"]
    stored = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert not stored.get("reports"), "die abgelehnte Meldung steht nicht am Spiel"


@pytest.mark.asyncio
async def test_a_ban_also_counts_in_games_without_a_required_id(flow):
    w = await world(flow)
    await ban(flow, w["users"]["Mila"])
    flow.act_as(w["users"]["Kapitaen"])

    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))

    assert refused.status_code == 422 and "gesperrt" in refused.json()["detail"]
    fine = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Tom")))
    assert fine.status_code == 200, fine.text


@pytest.mark.asyncio
async def test_the_match_page_marks_a_banned_player_for_the_own_side(flow):
    w = await id_world(flow)
    await ban(flow, w["users"]["Mila"])
    flow.act_as(w["users"]["Kapitaen"])

    league = (await page(flow, w))["league"]

    blocked = {row["name"]: row["lineup_blocked"] for row in league["roster"]}
    assert "gesperrt" in blocked["Mila"] and blocked["Tom"] is None


@pytest.mark.asyncio
async def test_the_other_side_does_not_learn_about_a_ban_from_the_lobby_list(flow):
    w = await id_world(flow)
    await ban(flow, w["users"]["Mila"])

    flow.act_as(w["users"]["Falke1"])
    theirs = (await page(flow, w))["league"]["lobby_ids"]
    side = next(row for row in theirs if row["registration_id"] == w["reg_a"]["id"])
    assert "Mila" not in [player["name"] for player in side["players"]]
    assert "gesperrt" not in str(theirs)

    flow.act_as(w["users"]["Kapitaen"])
    own = (await page(flow, w))["league"]["lobby_ids"]
    side = next(row for row in own if row["registration_id"] == w["reg_a"]["id"])
    assert "gesperrt" in next(player["reason"] for player in side["players"] if player["name"] == "Mila")


@pytest.mark.asyncio
async def test_a_staff_correction_keeps_a_banned_player_who_was_already_lined_up(flow):
    w = await world(flow)
    await decided(flow, w, "Kapitaen", "Mila")
    await ban(flow, w["users"]["Mila"])
    flow.act_as(w["staff"])
    body = two_nil(w)
    body["reason"] = "Punkte korrigiert"
    for game in body["games"]:
        game["lineups"] = {w["reg_a"]["id"]: ids(w, "Kapitaen", "Mila")}

    corrected = await flow.post(f"/api/matches/{w['match']['id']}/result?force=true", json=body)
    assert corrected.status_code == 200, corrected.text

    # Neu aufstellen lässt sich ein gesperrtes Konto auch von der Leitung nicht.
    await ban(flow, w["users"]["Tom"])
    for game in body["games"]:
        game["lineups"] = {w["reg_a"]["id"]: ids(w, "Kapitaen", "Tom")}
    refused = await flow.post(f"/api/matches/{w['match']['id']}/result?force=true", json=body)
    assert refused.status_code == 422 and "Tom kann nicht aufgestellt werden" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_amending_keeps_a_banned_player_who_was_already_lined_up(flow):
    w = await world(flow)
    await decided(flow, w, "Kapitaen", "Mila")
    await ban(flow, w["users"]["Mila"])
    flow.act_as(w["staff"])
    lineup = ids(w, "Kapitaen", "Mila")

    amended = await flow.put(f"/api/matches/{w['match']['id']}/lineups", json={
        "registration_id": w["reg_a"]["id"], "reason": "Nachtrag der Leitung",
        "games": [{"position": 1, "lineup": lineup}, {"position": 2, "lineup": lineup}]})

    assert amended.status_code == 200, amended.text


# ---------------------------------------------------------------- Kaderübersicht und Hinweise


@pytest.mark.asyncio
async def test_the_season_overview_counts_banned_players_with_their_own_state(flow):
    w = await id_world(flow)
    await ban(flow, w["users"]["Mila"])
    flow.act_as(w["staff"])

    overview = (await flow.get(f"/api/admin/leagues/seasons/{w['season_id']}/roster")).json()

    squad = next(row for row in overview["squads"] if row["registration_id"] == w["reg_a"]["id"])
    mila = next(row for row in squad["players"] if row["name"] == "Mila")
    assert mila["state"] == "banned" and mila["ok"] is False and "gesperrt" in mila["reason"]
    assert mila["text"], "die festgehaltene oder gemeldete ID bleibt sichtbar"
    assert overview["counts"]["banned"] == 1 and overview["counts"]["missing"] == 0


@pytest.mark.asyncio
async def test_assigning_does_not_tell_a_banned_player_that_his_id_is_missing(flow):
    w = await id_world(flow)
    await ban(flow, w["users"]["Ida"])

    assigned = await assign_squad_b(flow, w)

    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["ids_missing"] == []
    told = await flow.db.notifications.find({"meta.reason": {"$in": ["league_id_missing", "league_id_missing_team"]}},
                                            {"_id": 0}).to_list(None)
    assert told == []


@pytest.mark.asyncio
async def test_approving_a_new_id_of_a_banned_player_still_records_the_old_one(flow):
    w = await id_world(flow)
    other = await assign_squad_b(flow, w)
    assert other.status_code == 200, other.text
    await flow.db.users.update_one({"id": w["users"]["Tom"]["id"]}, {"$set": {
        "is_banned": True, "game_ids": {"probe-hauptspiel": {"activision_id": "NeuerName#7654321"}}}})
    flow.act_as(w["staff"])

    approved = await flow.post(f"/api/admin/leagues/seasons/{w['season_id']}/roster/{w['users']['Tom']['id']}/approve",
                               json={"reason": "Konto gewechselt"})

    assert approved.status_code == 200, approved.text
    entry = await flow.db.league_rosters.find_one({"season_id": w["season_id"], "user_id": w["users"]["Tom"]["id"]}, {"_id": 0})
    assert entry["approvals"][-1]["old_text"], "die bisherige ID bleibt im Protokoll"
    assert approved.json()["state"] == "banned", "die Freigabe hebt die Sperre nicht auf"


# ---------------------------------------------------------------- Verantwortliche


@pytest.mark.asyncio
async def test_a_banned_captain_hands_over_to_the_vice(flow):
    w = await world(flow)
    await flow.db.team_squads.update_one({"id": w["squad_a"]["id"]}, {"$set": {"vice_captain_id": w["users"]["Mila"]["id"]}})
    await ban(flow, w["users"]["Kapitaen"])

    who = await match_audience.responsible_user_ids(flow.db, [w["reg_a"]])

    assert who == set(ids(w, "Mila"))


@pytest.mark.asyncio
async def test_with_captain_and_vice_banned_the_team_leadership_acts(flow):
    w = await world(flow)
    await flow.db.team_squads.update_one({"id": w["squad_a"]["id"]}, {"$set": {"vice_captain_id": w["users"]["Mila"]["id"]}})
    await ban(flow, w["users"]["Kapitaen"])
    await ban(flow, w["users"]["Mila"])

    who = await match_audience.responsible_user_ids(flow.db, [w["reg_a"]])
    assert who == set(ids(w, "LoeLeitung")), "sonst erreicht niemanden eine Nachricht"

    found = await match_audience.responsible_registration(flow.db, w["tournament"]["id"], w["users"]["LoeLeitung"]["id"])
    assert found and found["id"] == w["reg_a"]["id"], "die Leitung darf jetzt handeln"
    gone = await match_audience.responsible_registration(flow.db, w["tournament"]["id"], w["users"]["Kapitaen"]["id"])
    assert gone is None

    flow.act_as(w["users"]["LoeLeitung"])
    report = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Tom", "Mila")))
    assert report.status_code == 422, "Mila ist gesperrt"


@pytest.mark.asyncio
async def test_a_banned_captain_no_longer_sees_team_penalties_as_responsible(flow):
    w = await world(flow)
    await ban(flow, w["users"]["Kapitaen"])
    teams = await match_audience.teams_by_id(flow.db, [w["reg_a"]])

    who = match_audience.team_penalty_ids(w["reg_a"], teams[w["lions"]["id"]])

    assert who == set(ids(w, "LoeLeitung"))


@pytest.mark.asyncio
async def test_registrations_without_a_squad_keep_their_rule(flow):
    """Ein Team ohne Co-Team und ein Einzelspieler: nichts ändert sich - auch nicht durch eine Sperre."""
    w = await world(flow)
    await ban(flow, w["users"]["FalLeitung"])
    plain = {"id": "reg-plain", "team_id": w["falcons"]["id"], "user_id": w["users"]["Falke1"]["id"]}

    who = await match_audience.responsible_user_ids(flow.db, [plain])

    assert who == set(ids(w, "FalLeitung", "Falke1")), "wie bisher; die Nachricht filtert erst users_for"
