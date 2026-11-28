"""Solo-Staffel, Paket P1 (#1629, S6; docs/LIGA.md „Solo-Liga“): Staffel mit Personen, die Leitung teilt eine Person zu - und daneben
eine Team-Liga, die Co-Teams zuteilt wie vorher (Gegenprobe). Wege, die es für Spieler erst später gibt (Spielbetrieb P3,
Folge-Season P4), sind mit klarem Satz gesperrt. Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import league_participants  # noqa: E402
from league_solo_world import ADMIN, assign_person, make_league, make_staffel, solo_world  # noqa: E402
from squad_world import make_squad, make_team  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


# ---------------------------------------------------------------- S6: Staffel mit Personen, Person zuteilen

@pytest.mark.asyncio
async def test_a_solo_staffel_plays_with_persons_and_a_team_staffel_with_co_teams(flow):
    world = await solo_world(flow)
    team = await make_league(flow, world["game"], None, "Team Liga")
    _season, _division, team_tournament = await make_staffel(flow, team)

    assert world["tournament"]["team_mode"] == "solo"
    assert world["tournament"]["team_size"] == 1 and world["tournament"]["min_squad_size"] == 1
    assert team_tournament["team_mode"] == "team"
    assert team_tournament["team_size"] == 4


@pytest.mark.asyncio
async def test_the_lead_assigns_a_person_as_an_approved_single_registration(flow):
    world = await solo_world(flow)
    player = await flow.add_user(name="Duellant Eins")
    tid = world["tournament"]["id"]

    response = await assign_person(flow, world["tournament"], player)

    assert response.status_code == 200, response.text
    reg = response.json()["registration"]
    stored = await flow.db.tournament_registrations.find_one({"id": reg["id"]}, {"_id": 0})
    assert stored["user_id"] == player["id"] and stored["team_id"] is None and "squad_id" not in stored
    assert stored["registration_type"] == "solo"
    assert stored["registered_via"] == "league_assign" and stored["source"] == "staff_add"
    assert stored["status"] == "approved"
    assert stored["display_name"] == "Duellant Eins"
    assert stored["identity_key"] == f"{tid}:user:{player['id']}"
    assert stored["league_squad_key"] == f"{world['season']['id']}:user:{player['id']}"
    assert "identity_key" not in reg
    # Dieselben Leser wie jede Anmeldung: die Teilnehmerliste der Staffel nennt die Person.
    listed = (await flow.get(f"/api/tournaments/{tid}/registrations")).json()
    assert [row["user"]["id"] for row in listed] == [player["id"]]
    logged = await flow.db.audit_logs.find({"action": "league.player.assign"}, {"_id": 0}).to_list(5)
    assert len(logged) == 1 and logged[0]["data"]["user_id"] == player["id"]


@pytest.mark.asyncio
async def test_a_person_plays_in_one_staffel_per_season_only(flow):
    world = await solo_world(flow)
    player = await flow.add_user(name="Duellant Eins")
    second = await flow.post(f"{ADMIN}/divisions/{world['division']['id']}/staffeln", json={})
    other = await flow.db.tournaments.find_one({"id": second.json()["tournament_id"]}, {"_id": 0})

    first = await assign_person(flow, world["tournament"], player)
    again = await assign_person(flow, world["tournament"], player)
    elsewhere = await assign_person(flow, other, player)

    assert first.status_code == 200, first.text
    assert again.status_code == 409 and "schon in dieser Staffel" in again.json()["detail"]
    assert elsewhere.status_code == 409 and "in einer anderen Staffel" in elsewhere.json()["detail"]
    assert await flow.db.tournament_registrations.count_documents({"user_id": player["id"]}) == 1


@pytest.mark.asyncio
async def test_the_right_entry_for_the_right_staffel(flow):
    world = await solo_world(flow)
    team_league = await make_league(flow, world["game"], None, "Team Liga")
    _season, _division, team_tournament = await make_staffel(flow, team_league)
    player = await flow.add_user(name="Duellant Eins")
    leader = await flow.add_user(name="Teamleitung")
    lions = await make_team(flow, "Loewen", leader=leader, members=[player])
    squad = await make_squad(flow, lions, "Rudel A", [leader, player])

    team_in_solo = await flow.post(f"/api/tournaments/{world['tournament']['id']}/squad-registrations",
                                   json={"team_id": lions["id"], "squad_id": squad["id"]})
    person_in_team = await assign_person(flow, team_tournament, player)
    nothing = await flow.post(f"/api/tournaments/{world['tournament']['id']}/squad-registrations", json={})

    assert team_in_solo.status_code == 400 and team_in_solo.json()["detail"] == league_participants.WRONG_ENTRY_SOLO
    assert person_in_team.status_code == 400 and person_in_team.json()["detail"] == league_participants.WRONG_ENTRY_TEAM
    assert nothing.status_code == 400
    assert await flow.db.tournament_registrations.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_full_staffel_and_unknown_or_banned_accounts_are_refused(flow):
    world = await solo_world(flow)
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"max_participants": 2}})
    tournament = {**world["tournament"], "max_participants": 2}
    one, two, three = [await flow.add_user(name=f"Duellant {index}") for index in range(3)]
    banned = await flow.add_user(name="Gesperrt")
    await flow.db.users.update_one({"id": banned["id"]}, {"$set": {"is_banned": True}})

    assert (await assign_person(flow, tournament, one)).status_code == 200
    assert (await assign_person(flow, tournament, two)).status_code == 200
    full = await assign_person(flow, tournament, three)
    unknown = await assign_person(flow, tournament, {"id": "gibt-es-nicht"})
    blocked = await assign_person(flow, tournament, banned)

    assert full.status_code == 409 and "voll" in full.json()["detail"]
    assert unknown.status_code == 404
    assert blocked.status_code == 400 and "gesperrt" in blocked.json()["detail"]


@pytest.mark.asyncio
async def test_the_dialog_finds_persons_with_their_reasons(flow):
    world = await solo_world(flow)
    player = await flow.add_user(name="Duellant Eins")
    await flow.add_user(name="Duellant Zwei")
    await assign_person(flow, world["tournament"], player)

    found = await flow.get(f"/api/tournaments/{world['tournament']['id']}/squad-candidates", params={"q": "Duellant"})

    assert found.status_code == 200, found.text
    body = found.json()
    assert body["kind"] == "solo"
    rows = {row["display_name"]: row for row in body["people"]}
    assert set(rows) == {"Duellant Eins", "Duellant Zwei"}
    assert rows["Duellant Eins"]["problems"] and "schon in dieser Staffel" in rows["Duellant Eins"]["problems"][0]
    assert rows["Duellant Zwei"]["problems"] == []
    assert body["seats_taken"] == 1 and body["max_participants"] == 8
    assert "email" not in rows["Duellant Zwei"]


@pytest.mark.asyncio
async def test_removing_or_rejecting_a_person_frees_the_season_and_the_key_follows_the_status(flow):
    world = await solo_world(flow)
    player = await flow.add_user(name="Duellant Eins")
    second = await flow.post(f"{ADMIN}/divisions/{world['division']['id']}/staffeln", json={})
    other = await flow.db.tournaments.find_one({"id": second.json()["tournament_id"]}, {"_id": 0})
    reg = (await assign_person(flow, world["tournament"], player)).json()["registration"]

    removed = await flow.delete(f"/api/tournaments/{world['tournament']['id']}/squad-registrations/{reg['id']}")
    moved = await assign_person(flow, other, player)
    moved_url = f"/api/tournaments/{other['id']}/registrations/{moved.json()['registration']['id']}"
    rejected = await flow.patch(moved_url, json={"status": "rejected"})
    back = await assign_person(flow, world["tournament"], player)
    again = await flow.patch(moved_url, json={"status": "approved"})

    assert removed.status_code == 200, removed.text
    assert await flow.db.audit_logs.count_documents({"action": "league.player.remove"}) == 1
    assert moved.status_code == 200, moved.text
    assert rejected.status_code == 200, rejected.text
    stored = await flow.db.tournament_registrations.find_one({"id": moved.json()["registration"]["id"]}, {"_id": 0})
    assert "league_squad_key" not in stored
    assert back.status_code == 200, back.text
    # Wieder angenommen, während die Person schon in der anderen Staffel steht: derselbe Riegel wie beim Co-Team.
    assert again.status_code == 409, again.text
    assert again.json()["detail"] == "Diese Person spielt in dieser Season schon in einer anderen Staffel."


@pytest.mark.asyncio
async def test_the_existing_readers_show_a_solo_staffel_with_its_persons(flow):
    world = await solo_world(flow)
    players = [await flow.add_user(name=f"Duellant {index}") for index in range(3)]
    for player in players:
        assert (await assign_person(flow, world["tournament"], player)).status_code == 200
    season_id, tid = world["season"]["id"], world["tournament"]["id"]

    reads = {
        "season": await flow.get(f"{ADMIN}/seasons/{season_id}"),
        "desk": await flow.get(f"{ADMIN}/seasons/{season_id}/desk"),
        "roster": await flow.get(f"{ADMIN}/seasons/{season_id}/roster"),
        "applications": await flow.get(f"/api/admin/leagues/seasons/{season_id}/applications"),
        "staffel": await flow.get(f"/api/tournaments/{tid}", params={"include_draft": "true"}),
        "matches": await flow.get(f"/api/tournaments/{tid}/matches-v2"),
    }

    assert {name: response.status_code for name, response in reads.items()} == {name: 200 for name in reads}, \
        {name: response.text[:200] for name, response in reads.items() if response.status_code != 200}
    season_view = reads["season"].json()
    assert season_view["league"]["participant_kind"] == "solo"
    assert season_view["divisions"][0]["staffeln"][0]["participant_count"] == 3
    assert reads["staffel"].json()["team_mode"] == "solo"
    # Die Vorschau des Spielplans mischt die Personen wie Co-Teams - fest wird er erst mit dem Spielbetrieb (P3).
    previews = [match for match in reads["matches"].json() if match.get("is_preview")]
    assert previews and all(match.get("is_preview") for match in reads["matches"].json())


# ---------------------------------------------------------------- Gesperrt mit „folgt“

@pytest.mark.asyncio
async def test_a_solo_staffel_does_not_start_before_the_match_flow_exists(flow):
    world = await solo_world(flow)
    for index in range(2):
        await assign_person(flow, world["tournament"], await flow.add_user(name=f"Duellant {index}"))

    started = await flow.post(f"/api/tournaments/{world['tournament']['id']}/status", json={"status": "live"})

    assert started.status_code == 400
    assert started.json()["detail"] == league_participants.OPERATIONS_FOLLOW
    assert (await flow.db.tournaments.find_one({"id": world["tournament"]["id"]}))["status"] == "draft"


@pytest.mark.asyncio
async def test_a_solo_season_has_no_successor_yet(flow):
    world = await solo_world(flow)

    preview = await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor")
    created = await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/successor",
                              json={"confirm": True, "start_date": "2027-03-01T00:00:00"})

    assert preview.status_code == 200, preview.text
    assert preview.json()["problems"][0] == league_participants.SUCCESSOR_FOLLOWS
    assert preview.json()["can_create"] is False
    assert created.status_code == 409 and created.json()["detail"] == league_participants.SUCCESSOR_FOLLOWS


# ---------------------------------------------------------------- Gegenprobe: Team-Liga unverändert

@pytest.mark.asyncio
async def test_a_team_league_next_to_a_solo_league_assigns_co_teams_as_before(flow):
    world = await solo_world(flow)
    team_league = await make_league(flow, world["game"], None, "Team Liga")
    _season, _division, team_tournament = await make_staffel(flow, team_league)
    leader = await flow.add_user(name="Teamleitung")
    members = [await flow.add_user(name=f"Rudel {index}") for index in range(3)]
    lions = await make_team(flow, "Loewen", leader=leader, members=members)
    squad = await make_squad(flow, lions, "Rudel A", [leader, *members])
    player = await flow.add_user(name="Duellant Eins")

    team_reg = await flow.post(f"/api/tournaments/{team_tournament['id']}/squad-registrations",
                               json={"team_id": lions["id"], "squad_id": squad["id"]})
    solo_reg = await assign_person(flow, world["tournament"], player)
    candidates = await flow.get(f"/api/tournaments/{team_tournament['id']}/squad-candidates")

    assert team_reg.status_code == 200, team_reg.text
    stored = await flow.db.tournament_registrations.find_one({"id": team_reg.json()["registration"]["id"]}, {"_id": 0})
    assert stored["registration_type"] == "team" and stored["squad_id"] == squad["id"] and stored["user_id"] is None
    assert stored["league_squad_key"] == f"{_season['id']}:{squad['id']}"
    assert solo_reg.status_code == 200, solo_reg.text
    # Die Antwort für eine Team-Staffel bleibt die von vorher - ohne „kind“, mit Teams und Co-Teams.
    assert "kind" not in candidates.json() and candidates.json()["teams"][0]["squads"][0]["id"] == squad["id"]
    # Ohne Sortierung liefert echtes MongoDB keine feste Reihenfolge - verglichen wird die Menge.
    logged = await flow.db.audit_logs.find({"action": {"$in": ["league.squad.assign", "league.player.assign"]}}, {"_id": 0}).to_list(5)
    assert sorted(row["action"] for row in logged) == ["league.player.assign", "league.squad.assign"]
