"""Co-Team einer Liga-Staffel zuteilen (docs/LIGA.md, Abschnitte 2 und 5; #1649, Teil von #1623).

``POST /api/tournaments/{tid}/squad-registrations`` - nur die Turnierleitung (Bereich „tournaments“, mit Zwei-Faktor).
Daraus wird eine freigegebene Team-Anmeldung mit ``squad_id``, Anzeige „Loewen · Rudel A“, Protokoll
``league.squad.assign``. Jede Prüfung hat einen deutschen Satz: Co-Team gehört zum Hauptteam, ist aktiv, richtiges
Spiel, Kader groß genug, alle im Hauptteam, Staffel nicht voll, nie zwei Co-Teams desselben Hauptteams in einer Staffel.
"""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from squad_world import ids, league_world, make_squad, squad_registration  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def assign_url(world: dict) -> str:
    return f"/api/tournaments/{world['tournament']['id']}/squad-registrations"


async def assign(flow, world: dict, team: str = "lions", squad: str = "squad_a"):
    return await flow.post(assign_url(world), json={"team_id": world[team]["id"], "squad_id": world[squad]["id"]})


@pytest.mark.asyncio
async def test_staff_assigns_a_squad_as_an_approved_team_registration(flow):
    world = await league_world(flow)
    flow.act_as(world["staff"])

    response = await assign(flow, world)

    assert response.status_code == 200, response.text
    reg = response.json()["registration"]
    stored = await flow.db.tournament_registrations.find_one({"id": reg["id"]}, {"_id": 0})
    assert stored["team_id"] == world["lions"]["id"]
    assert stored["squad_id"] == world["squad_a"]["id"]
    assert stored["squad_name"] == "Rudel A"
    assert stored["display_name"] == "Loewen · Rudel A"
    assert stored["registered_via"] == "league_assign"
    assert stored["registration_type"] == "team"
    assert stored["status"] == "approved"
    assert stored["user_id"] is None
    assert stored["identity_key"] == f"{world['tournament']['id']}:team:{world['lions']['id']}"
    assert "identity_key" not in reg
    logged = await flow.db.audit_logs.find({"action": "league.squad.assign"}, {"_id": 0}).to_list(5)
    assert len(logged) == 1
    assert logged[0]["data"]["squad_id"] == world["squad_a"]["id"]
    assert logged[0]["actor_id"] == world["staff"]["id"]

    # Öffentlich erscheint die Anmeldung als „Loewen · Rudel A“ mit dem Co-Team-Namen.
    flow.act_as(None)
    listed = (await flow.get(f"/api/tournaments/{world['tournament']['id']}/registrations")).json()
    assert [(row["display_name"], row.get("squad_name")) for row in listed] == [("Loewen · Rudel A", "Rudel A")]


@pytest.mark.asyncio
async def test_two_squads_of_the_same_team_never_share_a_staffel(flow):
    world = await league_world(flow)
    flow.act_as(world["staff"])
    first = await assign(flow, world)
    assert first.status_code == 200, first.text

    second = await assign(flow, world, squad="squad_b")

    assert second.status_code == 409
    assert "zwei Co-Teams" in second.json()["detail"]
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": world["tournament"]["id"]}) == 1
    falcons = await assign(flow, world, team="falcons", squad="horst")
    assert falcons.status_code == 200, falcons.text


@pytest.mark.asyncio
async def test_only_tournament_staff_assigns_and_removes(flow):
    world = await league_world(flow)
    users = world["users"]
    for name in ("Leitung", "CoLeitung", "Spieler1", "Fremd"):
        flow.act_as(users[name])
        refused = await assign(flow, world)
        assert refused.status_code == 403, (name, refused.text)
    no_mfa = await flow.add_user(role="tournament_admin", name="OhneZweiFaktor")
    flow.act_as({**no_mfa, "auth_mfa_verified": False})
    without_mfa = await assign(flow, world)
    assert without_mfa.status_code == 403
    assert await flow.db.tournament_registrations.count_documents({}) == 0

    flow.act_as(world["staff"])
    reg = (await assign(flow, world)).json()["registration"]
    # Die Teamleitung meldet ein zugeteiltes Co-Team nicht selbst ab - weder hier noch über die allgemeine Abmeldung.
    flow.act_as(users["Leitung"])
    by_squad_route = await flow.delete(f"{assign_url(world)}/{reg['id']}")
    assert by_squad_route.status_code == 403
    by_general_route = await flow.delete(f"/api/tournaments/{world['tournament']['id']}/registrations/{reg['id']}")
    assert by_general_route.status_code == 403
    assert await flow.db.tournament_registrations.find_one({"id": reg["id"]}) is not None


@pytest.mark.asyncio
async def test_every_check_has_a_clear_german_reason(flow):
    world = await league_world(flow)
    users = world["users"]
    lions = world["lions"]
    flow.act_as(world["staff"])

    async def refused(team_id: str, squad_id: str, code: int, words: str):
        response = await flow.post(assign_url(world), json={"team_id": team_id, "squad_id": squad_id})
        assert response.status_code == code, response.text
        assert words in response.json()["detail"], response.json()["detail"]

    # Co-Team eines anderen Teams
    await refused(lions["id"], world["horst"]["id"], 400, "gehört nicht zu diesem Team")
    # archiviert
    archived = await make_squad(flow, lions, "Alt", [users[f"Spieler{i}"] for i in (1, 2, 3, 4)], status="archived")
    await refused(lions["id"], archived["id"], 400, "archiviert")
    # anderes Spiel
    other_game = await make_squad(flow, lions, "Kart", [users[f"Spieler{i}"] for i in (1, 2, 3, 4)], game_id="kart")
    await refused(lions["id"], other_game["id"], 400, "anderes Spiel")
    # zu kleiner Kader (Teamgröße 4)
    small = await make_squad(flow, lions, "Klein", [users[f"Spieler{i}"] for i in (1, 2, 3)])
    await refused(lions["id"], small["id"], 400, "mindestens 4")
    # jemand im Kader ist nicht (mehr) im Hauptteam
    mixed = await make_squad(
        flow, lions, "Gemischt", [users["Spieler1"], users["Spieler2"], users["Spieler3"], users["Fremd"]]
    )
    await refused(lions["id"], mixed["id"], 400, "nicht mehr im Team")
    # unbekannt
    await refused(lions["id"], new_id(), 404, "Co-Team nicht gefunden")
    await refused(new_id(), world["squad_a"]["id"], 404, "Team nicht gefunden")
    assert await flow.db.tournament_registrations.count_documents({}) == 0

    # Ohne Spiel am Co-Team geht es (ältere Co-Teams tragen keins) - das Co-Team bleibt dabei unverändert.
    no_game = await make_squad(flow, lions, "Ohne Spiel", [users[f"Spieler{i}"] for i in (1, 2, 3, 4)])
    accepted = await flow.post(assign_url(world), json={"team_id": lions["id"], "squad_id": no_game["id"]})
    assert accepted.status_code == 200, accepted.text
    assert "game_id" not in await flow.db.team_squads.find_one({"id": no_game["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_a_full_staffel_takes_no_more_squads(flow):
    world = await league_world(flow, max_participants=2)
    flow.act_as(world["staff"])
    third_team_leader = await flow.add_user(name="DritteLeitung")
    await squad_registration(flow, world["tournament"], world["falcons"], world["horst"])
    filler = {
        "id": new_id(),
        "tournament_id": world["tournament"]["id"],
        "team_id": new_id(),
        "status": "checked_in",
        "display_name": "Dritte",
        "user_id": third_team_leader["id"],
    }
    await flow.db.tournament_registrations.insert_one(dict(filler))

    response = await assign(flow, world)

    assert response.status_code == 409
    assert "voll" in response.json()["detail"] and "2 von 2" in response.json()["detail"]
    # Abgelehnte und Wartende belegen keinen Platz.
    await flow.db.tournament_registrations.update_one({"id": filler["id"]}, {"$set": {"status": "rejected"}})
    seat_free = await assign(flow, world)
    assert seat_free.status_code == 200


@pytest.mark.asyncio
async def test_league_frame_values_are_respected_when_present(flow):
    """Mit Liga-Rahmen (P1, ``league_context``): Mindestkader aus dem Feld der Staffel (aus Season bzw. Liga N kopiert,
    nie unter der Teamgröße), ein Co-Team je Season nur in einer Staffel. Ohne Feld gilt die Teamgröße (Test oben)."""
    season_id, division_id = new_id(), new_id()
    world = await league_world(
        flow,
        min_squad_size=5,
        league_context={"league_id": new_id(), "season_id": season_id, "division_id": division_id, "staffel": "A"},
    )
    flow.act_as(world["staff"])

    too_small = await assign(flow, world)
    assert too_small.status_code == 400
    assert "mindestens 5" in too_small.json()["detail"]

    # Ein Mindestkader unter der Teamgröße zählt nicht - dann gilt die Teamgröße (4).
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"min_squad_size": 2}})
    staffel_b = await flow.create_tournament(
        team_mode="team",
        team_size=4,
        format="league",
        game_id="cod",
        league_context={"season_id": season_id, "division_id": new_id(), "staffel": "B"},
    )
    await squad_registration(flow, staffel_b, world["lions"], world["squad_a"])
    twice = await assign(flow, world)
    assert twice.status_code == 409
    assert "anderen Staffel" in twice.json()["detail"]
    ok = await assign(flow, world, squad="squad_b")
    assert ok.status_code == 200, ok.text


@pytest.mark.asyncio
async def test_only_team_tournaments_in_league_format_take_squads(flow):
    world = await league_world(flow)
    flow.act_as(world["staff"])
    cup = await flow.create_tournament(team_mode="team", team_size=4, format="single_elim", game_id="cod")
    solo_league = await flow.create_tournament(team_mode="solo", format="league", game_id="cod")
    for tournament in (cup, solo_league):
        response = await flow.post(
            f"/api/tournaments/{tournament['id']}/squad-registrations",
            json={"team_id": world["lions"]["id"], "squad_id": world["squad_a"]["id"]},
        )
        assert response.status_code == 400, response.text
        assert "Format Liga" in response.json()["detail"]


@pytest.mark.asyncio
async def test_removing_a_squad_is_logged_and_stops_once_the_schedule_is_fixed(flow):
    world = await league_world(flow)
    flow.act_as(world["staff"])
    reg = (await assign(flow, world)).json()["registration"]

    removed = await flow.delete(f"{assign_url(world)}/{reg['id']}")
    assert removed.status_code == 200, removed.text
    assert await flow.db.tournament_registrations.find_one({"id": reg["id"]}) is None
    logged = await flow.db.audit_logs.find({"action": "league.squad.remove"}, {"_id": 0}).to_list(5)
    assert [entry["data"]["squad_id"] for entry in logged] == [world["squad_a"]["id"]]

    # Eine Anmeldung ohne Co-Team nimmt dieser Weg nicht heraus.
    plain = await flow.register(world["tournament"], world["users"]["Fremd"])
    not_a_squad = await flow.delete(f"{assign_url(world)}/{plain['id']}")
    assert not_a_squad.status_code == 404

    again = (await assign(flow, world)).json()["registration"]
    await flow.db.matches_v2.insert_one(
        {
            "id": new_id(),
            "tournament_id": world["tournament"]["id"],
            "status": "scheduled",
            "slots": [{"slot": 1, "registration_id": again["id"]}],
        }
    )
    fixed = await flow.delete(f"{assign_url(world)}/{again['id']}")
    assert fixed.status_code == 409
    assert "Spielplan" in fixed.json()["detail"]


@pytest.mark.asyncio
async def test_the_dialog_lists_squads_with_their_reasons(flow):
    world = await league_world(flow)
    users = world["users"]
    await flow.db.team_squads.update_one(
        {"id": world["squad_a"]["id"]}, {"$set": {"captain_id": users["Spieler1"]["id"]}}
    )
    flow.act_as(world["staff"])

    data = (await flow.get(f"/api/tournaments/{world['tournament']['id']}/squad-candidates")).json()
    assert data["min_squad_size"] == 4 and data["max_participants"] == 8 and data["seats_taken"] == 0
    by_name = {squad["display_name"]: squad for team in data["teams"] for squad in team["squads"]}
    assert set(by_name) == {"Loewen · Rudel A", "Loewen · Rudel B", "Falken · Horst"}
    assert all(squad["problems"] == [] for squad in by_name.values())
    assert by_name["Loewen · Rudel A"]["captain"]["id"] == users["Spieler1"]["id"]
    assert set(by_name["Loewen · Rudel A"]["captain"]) == {"id", "username", "display_name"}, "nur was der Dialog zeigt"

    await assign(flow, world)
    data = (await flow.get(f"/api/tournaments/{world['tournament']['id']}/squad-candidates")).json()
    lions = next(team for team in data["teams"] if team["id"] == world["lions"]["id"])
    assert lions["in_staffel"] is True
    reasons = {squad["name"]: squad["problems"] for squad in lions["squads"]}
    assert any("zwei Co-Teams" in text for text in reasons["Rudel B"])

    flow.act_as(users["Leitung"])
    assert (await flow.get(f"/api/tournaments/{world['tournament']['id']}/squad-candidates")).status_code == 403


@pytest.mark.asyncio
async def test_the_assigned_squad_is_told_through_its_responsible_people(flow):
    world = await league_world(flow)
    users = world["users"]
    await flow.db.team_squads.update_one(
        {"id": world["squad_a"]["id"]},
        {"$set": {"captain_id": users["Spieler1"]["id"], "vice_captain_id": users["Spieler2"]["id"]}},
    )
    flow.act_as(world["staff"])

    assigned = await assign(flow, world)
    assert assigned.status_code == 200

    told = {
        row["user_id"]
        for row in await flow.db.notifications.find({}, {"_id": 0}).to_list(50)
        if (row.get("meta") or {}).get("tournament_id") == world["tournament"]["id"]
        or row.get("kind", "").startswith("tournament")
    }
    assert told == ids(users, "Spieler1", "Spieler2"), told
