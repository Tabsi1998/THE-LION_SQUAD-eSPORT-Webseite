"""Kampflos-Wertungen von Co-Teams in den Strafen (#2201, D-2). Erfundene Namen.

Co-Team-Anmeldungen haben ``user_id: None``, deshalb fand die Strafenliste sie nie. Es ist eine Teamstrafe: Captain,
Vertreter und die Leitung des Hauptteams sehen sie unter „Meine Strafen“, nicht der ganze Kader. In der Admin-Liste steht
sie einmal, unter dem Co-Team. Anmeldungen ohne Co-Team bleiben, wie sie sind.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import world as league_world  # noqa: E402
from squad_world import make_team  # noqa: E402

NOTE = "Nicht erschienen laut Spielprotokoll"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def forfeited(flow, world) -> None:
    flow.act_as(world["staff"])
    answer = await flow.post(f"/api/matches/{world['match']['id']}/forfeit",
                             json={"forfeit_registration_id": world["reg_a"]["id"], "note": NOTE})
    assert answer.status_code == 200, answer.text


async def my_forfeits(flow, user: dict) -> list[dict]:
    flow.act_as(user)
    answer = await flow.get("/api/penalties/me")
    assert answer.status_code == 200, answer.text
    return [row for row in answer.json()["items"] if row["kind"] == "match_forfeit"]


@pytest.mark.asyncio
async def test_captain_vice_and_main_team_lead_see_the_team_forfeit_not_the_roster(flow):
    world = await league_world(flow)
    users = world["users"]
    await flow.db.team_squads.update_one({"id": world["squad_a"]["id"]}, {"$set": {"vice_captain_id": users["Mila"]["id"]}})
    await make_ida_co_lead(flow, world)
    await forfeited(flow, world)

    for name in ("Kapitaen", "Mila", "LoeLeitung", "Ida"):
        rows = await my_forfeits(flow, users[name])
        assert len(rows) == 1, name
        assert rows[0]["ref_id"] == world["match"]["id"] and rows[0]["reason"] == NOTE
        assert rows[0]["label"] == "Kampflos verloren"
        assert "Rudel A" in rows[0]["context_subtitle"]
        assert "admin_url" not in rows[0]

    assert await my_forfeits(flow, users["Tom"]) == [], "der übrige Kader sieht die Teamstrafe nicht"
    assert await my_forfeits(flow, users["Fremd"]) == []
    assert await my_forfeits(flow, users["Falke1"]) == [], "die Gegenseite auch nicht"
    assert await my_forfeits(flow, users["FalLeitung"]) == []


async def make_ida_co_lead(flow, world) -> None:
    """Ida ist Co-Leitung der Löwen - sie steht im Co-Team „Rudel B“, nicht in „Rudel A“."""
    ida = world["users"]["Ida"]["id"]
    await flow.db.teams.update_one({"id": world["lions"]["id"]}, {"$set": {"co_leader_ids": [ida]}})
    await flow.db.team_members.update_one({"team_id": world["lions"]["id"], "user_id": ida}, {"$set": {"role": "co_leader"}})


@pytest.mark.asyncio
async def test_lead_roles_from_team_members_count_too(flow):
    """Die Leitung kann auch nur in ``team_members`` stehen (``match_audience.teams_by_id``)."""
    world = await league_world(flow)
    ida = world["users"]["Ida"]
    await flow.db.team_members.update_one({"team_id": world["lions"]["id"], "user_id": ida["id"]}, {"$set": {"role": "co_leader"}})
    await forfeited(flow, world)
    assert len(await my_forfeits(flow, ida)) == 1


@pytest.mark.asyncio
async def test_a_withdrawn_forfeit_disappears_for_the_team_too(flow):
    world = await league_world(flow)
    await forfeited(flow, world)
    corrected = {"results": [{"registration_id": world["reg_a"]["id"], "rank": 1, "score": 2},
                             {"registration_id": world["reg_h"]["id"], "rank": 2, "score": 0}],
                 "reason": "Korrektur laut Protokoll"}
    answer = await flow.post(f"/api/matches/{world['match']['id']}/result?force=true", json=corrected)
    assert answer.status_code == 200, answer.text
    assert await my_forfeits(flow, world["users"]["Kapitaen"]) == []


@pytest.mark.asyncio
async def test_the_admin_list_names_the_team_once(flow):
    world = await league_world(flow)
    users = world["users"]
    await flow.db.team_squads.update_one({"id": world["squad_a"]["id"]}, {"$set": {"vice_captain_id": users["Mila"]["id"]}})
    await forfeited(flow, world)
    # Der Eingang hängt am Bereich Turnierleitung, die Strafen einer Staffel gehören der Liga (#2203): nur mit beidem.
    flow.act_as(await flow.add_user(role="tournament_admin", name="Nur Turniere"))
    assert "match_forfeit" not in (await flow.get("/api/admin/penalties?kind=match_forfeit")).json()["counts"]
    admin = await flow.add_user(role="tournament_admin", name="Oberleitung")
    admin["areas"] = ["leagues"]
    flow.act_as(admin)
    answer = await flow.get("/api/admin/penalties?kind=match_forfeit")
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["counts"]["match_forfeit"] == 1, "eine Wertung, ein Eintrag - nicht je verantwortlicher Person"
    row = body["items"][0]
    assert row["ref_id"] == world["match"]["id"] and row["reason"] == NOTE
    assert row["team_name"] == "Loewen · Rudel A" and row["user_username"] is None
    assert row["issued_by_name"] == world["staff"]["display_name"]
    assert row["admin_url"] == f"/admin/tournaments/{world['tournament']['id']}"

    # Nach einer Person gefiltert: was sie unter „Meine Strafen“ sieht.
    filtered = await flow.get(f"/api/admin/penalties?user_id={users['Mila']['id']}&kind=match_forfeit")
    assert [item["ref_id"] for item in filtered.json()["items"]] == [world["match"]["id"]]
    assert (await flow.get(f"/api/admin/penalties?user_id={users['Tom']['id']}&kind=match_forfeit")).json()["items"] == []


@pytest.mark.asyncio
async def test_registrations_without_a_co_team_stay_as_they_are(flow):
    """Regression: Einzelanmeldung zählt bei der Person; ein Team ohne Co-Team und ohne Person bleibt ohne Eintrag."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, players, registrations = await flow.with_participants(2, format="single_elim", event_mode="online")
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    await flow.start(tournament)
    match = (await flow.matches(tournament))[0]
    answer = await flow.post(f"/api/matches/{match['id']}/forfeit",
                             json={"forfeit_registration_id": registrations[0]["id"], "note": NOTE})
    assert answer.status_code == 200, answer.text
    assert len(await my_forfeits(flow, players[0])) == 1
    assert await my_forfeits(flow, players[1]) == []

    leader = await flow.add_user(name="Teamchefin")
    team = await make_team(flow, "Ohne Co-Team", leader=leader)
    registration = {"id": new_id(), "tournament_id": tournament["id"], "team_id": team["id"], "user_id": None,
                    "display_name": "Ohne Co-Team", "status": "approved"}
    await flow.db.tournament_registrations.insert_one(dict(registration))
    await flow.db.matches_v2.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "stage_id": new_id(), "match_type": "duel", "status": "forfeit",
        "results": [{"registration_id": registration["id"], "rank": 2, "forfeit": True, "note": NOTE}],
        "slots": [{"slot": 1, "registration_id": registration["id"]}], "completed_at": "2026-11-01T10:00:00+00:00"})
    assert await my_forfeits(flow, leader) == []
