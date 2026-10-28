"""Liga-Kader mit Spiel-ID je Season (docs/LIGA.md, #2108). Erfundene Namen und IDs.

Die Liga spielt ein Spiel, dessen Hauptspiel eine Pflicht-ID hat („Activision-ID“) - wie im Profil gilt die ID des
Hauptspiels auch für die Version. Geprüft: Hinweis beim Zuteilen, festgehaltene ID bleibt nach einer Profiländerung,
Freigabe mit Grund und Protokoll, Aufstellung ohne ID abgelehnt (422), Stichtag für neue Spieler, Sichtbarkeit der IDs
für die Lobby, Auskunft und Löschung."""

import json
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import GAME_ID, ids, staffel, two_nil, world  # noqa: E402

MAIN_SLUG = "probe-hauptspiel"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def profile_ids(value: str | None) -> dict:
    return {"game_ids": {MAIN_SLUG: {"activision_id": value}}} if value else {"game_ids": {}}


async def set_id(flow, user: dict, value: str | None) -> None:
    await flow.db.users.update_one({"id": user["id"]}, {"$set": profile_ids(value)})


async def id_world(flow, *, without: tuple[str, ...] = (), deadline: str | None = None) -> dict:
    """Die Welt aus ``league_match_world`` mit Spiel (Version eines Hauptspiels mit Pflicht-ID), Liga und Season.
    Jeder hat eine ID im Profil, außer den genannten."""
    await flow.db.games.insert_one({
        "id": "probe-main", "slug": MAIN_SLUG, "name": "Probe Hauptspiel", "kind": "game",
        "player_id_fields": [{"key": "activision_id", "label": "Activision-ID", "required": True}],
    })
    await flow.db.games.insert_one({
        "id": GAME_ID, "slug": "probe-shooter", "name": "Probe Shooter", "kind": "edition",
        "parent_game_id": "probe-main",
    })
    w = await world(flow)
    await flow.db.leagues.insert_one({"id": "liga", "name": "Testliga", "slug": "testliga", "game_id": GAME_ID})
    season = {"id": w["season_id"], "league_id": "liga", "name": "Season 1", "slug": "season-1", "number": 1,
              "status": "active", "visibility": "public"}
    if deadline:
        season["roster_deadline"] = deadline
    await flow.db.league_seasons.insert_one(dict(season))
    for index, (name, user) in enumerate(w["users"].items()):
        if name not in without:
            await set_id(flow, user, f"Testloewe{name}#{1000000 + index}")
    w["season"] = season
    return w


async def roster_entry(flow, w: dict, name: str) -> dict | None:
    return await flow.db.league_rosters.find_one(
        {"season_id": w["season_id"], "user_id": w["users"][name]["id"]}, {"_id": 0})


async def page(flow, w: dict) -> dict:
    response = await flow.get(f"/api/matches/{w['match']['id']}/page")
    assert response.status_code == 200, response.text
    return response.json()


async def assign_squad_b(flow, w: dict):
    """Rudel B (Tom, Ida, LoeLeitung) kommt in eine zweite Staffel derselben Season."""
    other = await staffel(flow, w["season_id"], "B")
    w["staffel_b"] = other
    flow.act_as(w["staff"])
    return await flow.post(f"/api/tournaments/{other['id']}/squad-registrations",
                           json={"team_id": w["lions"]["id"], "squad_id": w["squad_b"]["id"]})


@pytest.mark.asyncio
async def test_assigning_shows_each_players_id_and_warns_about_missing_ones(flow):
    w = await id_world(flow, without=("Ida",))
    other = await staffel(flow, w["season_id"], "B")
    flow.act_as(w["staff"])

    candidates = (await flow.get(f"/api/tournaments/{other['id']}/squad-candidates")).json()

    assert candidates["id_label"] == "Activision-ID"
    lions = next(team for team in candidates["teams"] if team["id"] == w["lions"]["id"])
    squad = next(row for row in lions["squads"] if row["id"] == w["squad_b"]["id"])
    players = {row["name"]: row for row in squad["players"]}
    assert players["Tom"]["ok"] and players["Tom"]["text"].startswith("TestloeweTom#"), "Hauptspiel-ID gilt"
    assert players["Ida"]["ok"] is False and players["Ida"]["state"] == "missing"
    assert "Activision-ID fehlt im Profil" in players["Ida"]["reason"]
    assert squad["problems"] == [], "eine fehlende ID hält das Zuteilen nicht auf"

    response = await flow.post(f"/api/tournaments/{other['id']}/squad-registrations",
                               json={"team_id": w["lions"]["id"], "squad_id": w["squad_b"]["id"]})

    assert response.status_code == 200, response.text
    assert response.json()["ids_missing"] == ["Ida"]
    tom = await roster_entry(flow, w, "Tom")
    assert tom["player_ids"] == {"activision_id": tom["id_text"]} and tom["locked_at"] and tom["added_via"] == "assign"
    ida = await roster_entry(flow, w, "Ida")
    assert ida["locked_at"] is None and ida["player_ids"] == {}
    told = await flow.db.notifications.find({"meta.reason": {"$in": ["league_id_missing", "league_id_missing_team"]}},
                                            {"_id": 0}).to_list(10)
    assert {(row["user_id"], row["meta"]["reason"]) for row in told} == {
        (w["users"]["Ida"]["id"], "league_id_missing"),
        (w["users"]["LoeLeitung"]["id"], "league_id_missing_team"),
    }, "der Spieler und die Leitung des Hauptteams (Rudel B hat keinen Captain)"


@pytest.mark.asyncio
async def test_a_player_without_id_cannot_be_lined_up_until_it_is_in_the_profile(flow):
    w = await id_world(flow, without=("Mila",))
    flow.act_as(w["users"]["Kapitaen"])

    roster = {row["name"]: row for row in (await page(flow, w))["league"]["roster"]}
    assert roster["Mila"]["lineup_blocked"] and "Activision-ID" in roster["Mila"]["lineup_blocked"]
    assert roster["Tom"]["lineup_blocked"] is None and roster["Tom"]["game_id_text"].startswith("TestloeweTom#")

    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    assert refused.status_code == 422
    assert "Mila kann nicht aufgestellt werden" in refused.json()["detail"]

    await set_id(flow, w["users"]["Mila"], "TestloeweMila#7654321")
    accepted = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))

    assert accepted.status_code == 200, accepted.text
    mila = await roster_entry(flow, w, "Mila")
    assert mila["id_text"] == "TestloeweMila#7654321" and mila["locked_via"] == "lineup", "beim ersten Aufstellen festgehalten"


@pytest.mark.asyncio
async def test_the_locked_id_stays_after_a_profile_change_until_the_league_approves(flow):
    w = await id_world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    first = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    assert first.status_code == 200, first.text
    locked = (await roster_entry(flow, w, "Mila"))["id_text"]

    await set_id(flow, w["users"]["Mila"], "NeuerName#1111111")
    flow.act_as(w["users"]["Mila"])
    mine = (await flow.get("/api/me/league-ids")).json()["items"]
    assert [(row["title"], row["state"], row["text"], row["changed"]) for row in mine] == [
        ("Testliga · Season 1", "locked", locked, True)]
    flow.act_as(w["users"]["Kapitaen"])
    roster = {row["name"]: row for row in (await page(flow, w))["league"]["roster"]}
    assert roster["Mila"]["game_id_text"] == locked and roster["Mila"]["lineup_blocked"] is None

    flow.act_as(w["staff"])
    url = f"/api/admin/leagues/seasons/{w['season_id']}/roster/{w['users']['Mila']['id']}/approve"
    short = await flow.post(url, json={"reason": "neu"})
    assert short.status_code == 422 and "Grund" in short.json()["detail"]
    overview = (await flow.get(f"/api/admin/leagues/seasons/{w['season_id']}/roster")).json()
    squad = next(row for row in overview["squads"] if row["registration_id"] == w["reg_a"]["id"])
    mila = next(row for row in squad["players"] if row["name"] == "Mila")
    assert (mila["state"], mila["text"], mila["profile_text"], mila["changed"]) == (
        "locked", locked, "NeuerName#1111111", True)
    assert overview["counts"]["changed"] == 1

    approved = await flow.post(url, json={"reason": "Konto gewechselt, per Discord belegt"})

    assert approved.status_code == 200, approved.text
    assert approved.json()["text"] == "NeuerName#1111111" and approved.json()["changed"] is False
    entry = await roster_entry(flow, w, "Mila")
    assert entry["approvals"][-1]["old_text"] == locked and entry["approvals"][-1]["new_text"] == "NeuerName#1111111"
    assert entry["approvals"][-1]["reason"] == "Konto gewechselt, per Discord belegt"
    logged = await flow.db.audit_logs.find({"action": "league.roster.approve"}, {"_id": 0}).to_list(5)
    assert len(logged) == 1 and logged[0]["actor_id"] == w["staff"]["id"]
    assert "NeuerName" not in json.dumps(logged[0]["data"]), "das Protokoll nennt keine ID"
    again = await flow.post(url, json={"reason": "noch einmal freigeben"})
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_only_staff_manages_the_roster(flow):
    w = await id_world(flow)
    flow.act_as(w["users"]["Kapitaen"])

    assert (await flow.get(f"/api/admin/leagues/seasons/{w['season_id']}/roster")).status_code == 403
    response = await flow.post(
        f"/api/admin/leagues/seasons/{w['season_id']}/roster/{w['users']['Mila']['id']}/approve",
        json={"reason": "ich gebe mich frei"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_new_players_after_the_deadline_wait_for_approval(flow):
    w = await id_world(flow, deadline="2026-01-01")
    flow.act_as(w["users"]["LoeLeitung"])
    squad = w["squad_a"]
    members = [*squad["member_ids"], w["users"]["Ida"]["id"]]

    changed = await flow.patch(f"/api/teams/{w['lions']['id']}/squads/{squad['id']}", json={"member_ids": members})

    assert changed.status_code == 200, changed.text
    ida = await roster_entry(flow, w, "Ida")
    assert ida["late"] is True and ida["added_via"] == "squad_join" and ida["locked_at"] is None
    flow.act_as(w["users"]["Kapitaen"])
    roster = {row["name"]: row for row in (await page(flow, w))["league"]["roster"]}
    assert "Stichtag" in roster["Ida"]["lineup_blocked"]
    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Ida")))
    assert refused.status_code == 422 and "Stichtag" in refused.json()["detail"]

    flow.act_as(w["staff"])
    approved = await flow.post(
        f"/api/admin/leagues/seasons/{w['season_id']}/roster/{w['users']['Ida']['id']}/approve",
        json={"reason": "Ersatz nach Verletzung"})
    assert approved.status_code == 200, approved.text
    flow.act_as(w["users"]["Kapitaen"])
    accepted = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Ida")))
    assert accepted.status_code == 200, accepted.text


@pytest.mark.asyncio
async def test_without_a_deadline_new_players_are_recorded_right_away(flow):
    w = await id_world(flow)
    flow.act_as(w["users"]["LoeLeitung"])
    squad = w["squad_a"]

    changed = await flow.patch(f"/api/teams/{w['lions']['id']}/squads/{squad['id']}",
                               json={"member_ids": [*squad["member_ids"], w["users"]["Ida"]["id"]]})

    assert changed.status_code == 200, changed.text
    ida = await roster_entry(flow, w, "Ida")
    assert ida["late"] is False and ida["locked_via"] == "squad_join" and ida["id_text"].startswith("TestloeweIda#")


@pytest.mark.asyncio
async def test_the_deadline_is_a_season_setting(flow):
    w = await id_world(flow)
    flow.act_as(w["staff"])
    url = f"/api/admin/leagues/seasons/{w['season_id']}/roster-settings"

    assert (await flow.put(url, json={"roster_deadline": "morgen"})).status_code == 422
    saved = await flow.put(url, json={"roster_deadline": "2026-12-01"})
    assert saved.status_code == 200 and saved.json()["roster_deadline"] == "2026-12-01"
    assert (await flow.db.league_seasons.find_one({"id": w["season_id"]}))["roster_deadline"] == "2026-12-01"
    cleared = await flow.put(url, json={"roster_deadline": None})
    assert cleared.json()["roster_deadline"] is None
    assert "roster_deadline" not in await flow.db.league_seasons.find_one({"id": w["season_id"]}, {"_id": 0})
    logged = await flow.db.audit_logs.count_documents({"action": "league.season.roster_deadline"})
    assert logged == 2


@pytest.mark.asyncio
async def test_lobby_ids_are_shown_to_the_match_and_staff_only(flow):
    w = await id_world(flow, without=("Falke3",))

    flow.act_as(w["users"]["Mila"])
    lobby = {row["registration_id"]: row for row in (await page(flow, w))["league"]["lobby_ids"]}
    falcons = {row["name"]: row for row in lobby[w["reg_h"]["id"]]["players"]}
    assert falcons["Falke1"]["text"].startswith("TestloeweFalke1#")
    assert falcons["Falke3"]["ok"] is False and falcons["Falke3"]["text"] is None
    flow.act_as(w["staff"])
    assert len((await page(flow, w))["league"]["lobby_ids"]) == 2

    for viewer in (None, w["users"]["Fremd"]):
        flow.act_as(viewer)
        seen = await page(flow, w)
        assert seen["league"]["lobby_ids"] == []
        assert "Testloewe" not in json.dumps(seen), "keine ID für Gäste und Unbeteiligte"


@pytest.mark.asyncio
async def test_staff_lineups_follow_the_same_rule(flow):
    w = await id_world(flow, without=("Falke2",))
    flow.act_as(w["staff"])
    body = two_nil(w)
    for game in body["games"]:
        game["lineups"] = {w["reg_a"]["id"]: ids(w, "Kapitaen", "Mila"), w["reg_h"]["id"]: ids(w, "Falke1", "Falke2")}

    refused = await flow.post(f"/api/matches/{w['match']['id']}/result", json=body)

    assert refused.status_code == 422, refused.text
    assert "Falke2 kann nicht aufgestellt werden" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_export_contains_the_roster_and_erasure_removes_it(flow):
    w = await id_world(flow)
    response = await assign_squad_b(flow, w)
    assert response.status_code == 200, response.text
    tom = w["users"]["Tom"]
    from routes.dsgvo_routes import _user_data_export
    from services.account_erasure import erase_related

    exported = await _user_data_export(flow.db, tom["id"])
    assert [row["season_id"] for row in exported["league_rosters"]] == [w["season_id"]]
    assert exported["league_rosters"][0]["id_text"].startswith("TestloeweTom#")

    await erase_related(flow.db, {"id": tom["id"]}, "2026-10-28T10:00:00+00:00")

    assert await flow.db.league_rosters.count_documents({"user_id": tom["id"]}) == 0


@pytest.mark.asyncio
async def test_games_without_a_required_id_change_nothing(flow):
    w = await world(flow)
    flow.act_as(w["users"]["Kapitaen"])

    league = (await page(flow, w))["league"]
    response = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))

    assert response.status_code == 200, response.text
    assert all(row["lineup_blocked"] is None for row in league["roster"])
    assert league["lobby_ids"] == [] and league["id_label"] is None
    assert await flow.db.league_rosters.count_documents({}) == 0
