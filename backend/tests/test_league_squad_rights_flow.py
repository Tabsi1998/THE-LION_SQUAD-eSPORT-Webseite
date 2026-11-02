"""Co-Teams in nicht beendeten Staffeln (#2203, docs/LIGA.md Abschnitt 12): Kader, Captain, Vertreter, Status und Löschen ändern nur
das eigene Team und die Liga-Leitung mit „Kader prüfen“ - nicht die Rolle oder Freigabe Turnierleitung. Alle anderen Co-Teams bleiben,
wie sie sind. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import world  # noqa: E402

ALLOWED = ("leader", "co_lead", "roster", "area", "club_admin", "superadmin")
REFUSED = ("tournament_role", "tournament_grant", "other_capability", "other_league", "member", "roster_no_mfa", "player")


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def holder(flow, *capabilities, league_id="liga", **fields) -> dict:
    person = await flow.add_user(name="Zuständig")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league_id, "user_id": person["id"], "capabilities": list(capabilities)})
    person.update(fields)
    return person


async def squad_world(flow) -> dict:
    w = await world(flow)
    co_lead = await flow.add_user(name="CoLeitung")
    await flow.db.teams.update_one({"id": w["lions"]["id"]}, {"$addToSet": {"co_leader_ids": co_lead["id"], "member_ids": co_lead["id"]}})
    w["co_lead"] = co_lead
    return w


async def actor(flow, w: dict, kind: str) -> dict:
    if kind == "leader":
        return w["users"]["LoeLeitung"]
    if kind == "co_lead":
        return w["co_lead"]
    if kind == "roster":
        return await holder(flow, "roster")
    if kind == "roster_no_mfa":
        return await holder(flow, "roster", auth_mfa_verified=False)
    if kind == "other_capability":
        return await holder(flow, "results", "matches", "manage", "season", "applications", "disputes", "sanctions", "rules")
    if kind == "other_league":
        return await holder(flow, "roster", league_id="andere")
    if kind == "area":
        person = await flow.add_user(name="Bereich Ligen")
        person["areas"] = ["leagues"]
        return person
    if kind == "club_admin":
        return await flow.add_user(role="club_admin", name="Club-Admin")
    if kind == "superadmin":
        return w["staff"]
    if kind == "tournament_role":
        return await flow.add_user(role="tournament_admin", name="Turnierleitung")
    if kind == "tournament_grant":
        person = await flow.add_user(name="Freigabe Turniere")
        person["areas"] = ["tournaments"]
        return person
    if kind == "member":
        return w["users"]["Mila"]
    if kind == "player":
        return w["users"]["Fremd"]
    raise AssertionError(kind)


def url(w: dict, squad: str = "squad_a") -> str:
    return f"/api/teams/{w['lions']['id']}/squads/{w[squad]['id']}"


CHANGES = [
    ("PATCH", "", {"status": "archived"}),
    ("PATCH", "", {"member_ids": "KADER"}),
    ("PUT", "/roles", {"vice_captain_id": "MILA"}),
    ("DELETE", "", None),
]


def payload(w: dict, body):
    if body is None:
        return {}
    if body.get("member_ids") == "KADER":
        return {"json": {"member_ids": [w["users"][name]["id"] for name in ("Kapitaen", "Mila")]}}
    if body.get("vice_captain_id") == "MILA":
        return {"json": {"vice_captain_id": w["users"]["Mila"]["id"]}}
    return {"json": body}


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path,body", CHANGES)
@pytest.mark.parametrize("kind", ALLOWED)
async def test_own_team_and_league_rights_change_a_squad_in_a_staffel(flow, method, path, body, kind):
    w = await squad_world(flow)
    flow.act_as(await actor(flow, w, kind))
    response = await flow.client.request(method, url(w) + path, **payload(w, body))
    assert response.status_code != 403, response.text
    # Löschen bleibt gesperrt, solange die Staffel läuft - aber aus der Sache, nicht aus dem Recht.
    assert response.status_code == (409 if method == "DELETE" else 200), response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path,body", CHANGES)
@pytest.mark.parametrize("kind", REFUSED)
async def test_nobody_else_changes_a_squad_in_a_staffel(flow, method, path, body, kind):
    w = await squad_world(flow)
    before = await flow.db.team_squads.find_one({"id": w["squad_a"]["id"]}, {"_id": 0})
    flow.act_as(await actor(flow, w, kind))
    response = await flow.client.request(method, url(w) + path, **payload(w, body))
    assert response.status_code == 403, response.text
    assert await flow.db.team_squads.find_one({"id": w["squad_a"]["id"]}, {"_id": 0}) == before


@pytest.mark.asyncio
async def test_missing_second_factor_is_named(flow):
    w = await squad_world(flow)
    flow.act_as(await actor(flow, w, "roster_no_mfa"))
    response = await flow.patch(url(w), json={"status": "archived"})
    assert "Zwei-Faktor" in response.json()["detail"]


@pytest.mark.asyncio
async def test_the_own_role_can_still_be_given_up(flow):
    w = await squad_world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    response = await flow.put(url(w) + "/roles", json={"captain_id": None})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["tournament_role", "tournament_grant"])
async def test_squads_outside_a_staffel_stay_with_the_tournament_lead(flow, kind):
    w = await squad_world(flow)
    flow.act_as(await actor(flow, w, kind))
    response = await flow.patch(url(w, "squad_b"), json={"status": "archived"})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["completed", "results_published", "archived", "cancelled"])
async def test_a_finished_staffel_frees_the_squad_again(flow, status):
    w = await squad_world(flow)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"status": status}})
    flow.act_as(await actor(flow, w, "tournament_role"))
    response = await flow.patch(url(w), json={"status": "archived"})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_a_league_format_tournament_without_a_league_is_no_staffel(flow):
    w = await squad_world(flow)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$unset": {"league_context": ""}})
    flow.act_as(await actor(flow, w, "tournament_role"))
    response = await flow.patch(url(w), json={"status": "archived"})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_in_two_leagues_roster_is_needed_in_both(flow):
    from league_match_world import staffel
    from squad_world import squad_registration

    w = await squad_world(flow)
    other = await staffel(flow, new_id(), "B")
    await flow.db.tournaments.update_one({"id": other["id"]}, {"$set": {"league_context.league_id": "andere"}})
    await squad_registration(flow, other, w["lions"], w["squad_a"])
    flow.act_as(await holder(flow, "roster"))
    assert (await flow.patch(url(w), json={"status": "archived"})).status_code == 403


@pytest.mark.asyncio
async def test_a_change_by_league_rights_is_logged(flow):
    w = await squad_world(flow)
    person = await holder(flow, "roster")
    flow.act_as(person)
    assert (await flow.patch(url(w), json={"status": "archived"})).status_code == 200
    logged = await flow.db.audit_logs.find({"action": "league.squad.edit"}, {"_id": 0}).to_list(5)
    assert len(logged) == 1 and logged[0]["actor_id"] == person["id"]
    assert logged[0]["data"]["squad_id"] == w["squad_a"]["id"] and "status" in logged[0]["data"]["fields"]


@pytest.mark.asyncio
async def test_a_role_change_by_league_rights_is_logged_too(flow):
    w = await squad_world(flow)
    person = await holder(flow, "roster")
    flow.act_as(person)
    response = await flow.put(url(w) + "/roles", json={"vice_captain_id": w["users"]["Mila"]["id"]})
    assert response.status_code == 200, response.text
    logged = await flow.db.audit_logs.find({"action": "league.squad.edit"}, {"_id": 0}).to_list(5)
    assert len(logged) == 1 and logged[0]["actor_id"] == person["id"]
    assert logged[0]["data"] == {"squad_id": w["squad_a"]["id"], "fields": ["vice_captain_id"]}


@pytest.mark.asyncio
async def test_the_own_team_does_not_write_the_league_entry(flow):
    w = await squad_world(flow)
    flow.act_as(w["users"]["LoeLeitung"])
    response = await flow.put(url(w) + "/roles", json={"vice_captain_id": w["users"]["Mila"]["id"]})
    assert response.status_code == 200, response.text
    assert await flow.db.audit_logs.find({"action": "league.squad.edit"}, {"_id": 0}).to_list(5) == []


@pytest.mark.asyncio
async def test_the_list_says_which_squads_can_be_changed(flow):
    w = await squad_world(flow)
    list_url = f"/api/teams/{w['lions']['id']}/squads"

    flow.act_as(await actor(flow, w, "tournament_role"))
    rows = {row["id"]: row for row in (await flow.get(list_url)).json()}
    assert rows[w["squad_a"]["id"]]["can_edit"] is False and rows[w["squad_b"]["id"]]["can_edit"] is True

    flow.act_as(await actor(flow, w, "leader"))
    rows = {row["id"]: row for row in (await flow.get(list_url)).json()}
    assert rows[w["squad_a"]["id"]]["can_edit"] is True and rows[w["squad_b"]["id"]]["can_edit"] is True

    flow.act_as(await actor(flow, w, "member"))
    rows = {row["id"]: row for row in (await flow.get(list_url)).json()}
    assert rows[w["squad_a"]["id"]]["can_edit"] is False


@pytest.mark.asyncio
async def test_a_roster_holder_reads_only_the_squads_of_his_league(flow):
    w = await squad_world(flow)
    list_url = f"/api/teams/{w['lions']['id']}/squads"
    flow.act_as(await holder(flow, "roster"))
    rows = (await flow.get(list_url)).json()
    assert [row["id"] for row in rows] == [w["squad_a"]["id"]] and rows[0]["can_edit"] is True
    flow.act_as(await holder(flow, "roster", league_id="andere"))
    assert (await flow.get(list_url)).status_code == 403
    flow.act_as(await holder(flow, "results"))
    assert (await flow.get(list_url)).status_code == 403


@pytest.mark.asyncio
async def test_the_roster_overview_offers_what_the_sheet_needs(flow):
    w = await squad_world(flow)
    await flow.db.league_seasons.insert_one({"id": w["season_id"], "league_id": "liga", "number": 1, "name": "Season 1", "slug": "s1", "status": "draft"})
    flow.act_as(await holder(flow, "roster"))
    body = (await flow.get(f"/api/admin/leagues/seasons/{w['season_id']}/roster")).json()
    row = next(item for item in body["squads"] if item["registration_id"] == w["reg_a"]["id"])
    assert row["team_id"] == w["lions"]["id"] and row["squad_id"] == w["squad_a"]["id"]
    assert row["squad_status"] == "active" and row["captain_id"] == w["users"]["Kapitaen"]["id"] and row.get("vice_captain_id") is None
    assert set(row["member_ids"]) == {w["users"][name]["id"] for name in ("Kapitaen", "Mila", "Tom")}
    names = {person["name"] for person in row["team_members"]}
    assert {"LoeLeitung", "Kapitaen", "Mila", "Tom", "Ida"} <= names
    assert all(set(person) == {"id", "name"} for person in row["team_members"]), "nur Name und Kennung"
