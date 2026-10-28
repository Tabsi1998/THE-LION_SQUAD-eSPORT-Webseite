"""Co-Teams (#1649, Review P3): ein Co-Team je Season nur in einer Staffel - auch bei gleichzeitigem Zuteilen
(Sperre je Season und eindeutiger ``league_squad_key``); belegte Teams nennt der Dialog mit Grund; ein Co-Team
bleibt bis zum Ende der Staffel (Löschen, Auflösen), egal mit welchem Status. Erfundene Namen."""

import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import InterleavedReads, make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from squad_world import league_world, squad_registration  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def live_match(flow, *, captain: bool = True) -> dict:
    world = await league_world(flow)
    users = world["users"]
    if captain:
        await flow.db.team_squads.update_one(
            {"id": world["squad_a"]["id"]},
            {"$set": {"captain_id": users["Spieler1"]["id"], "vice_captain_id": users["Spieler2"]["id"]}},
        )
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"status": "live"}})
    lions_reg = await squad_registration(flow, world["tournament"], world["lions"], world["squad_a"])
    falcons_reg = await squad_registration(flow, world["tournament"], world["falcons"], world["horst"])
    match = {
        "id": new_id(),
        "tournament_id": world["tournament"]["id"],
        "stage_id": new_id(),
        "match_type": "duel",
        "status": "scheduled",
        "scheduled_at": (now_utc() + timedelta(minutes=10)).isoformat(),
        "slots": [
            {"slot": 1, "status": "filled", "registration_id": lions_reg["id"]},
            {"slot": 2, "status": "filled", "registration_id": falcons_reg["id"]},
        ],
    }
    await flow.db.matches_v2.insert_one(dict(match))
    return {**world, "match": match, "regs": [lions_reg, falcons_reg]}


async def two_staffeln(flow) -> tuple[dict, dict]:
    season_id = new_id()
    world = await league_world(
        flow, league_context={"league_id": new_id(), "season_id": season_id, "division_id": new_id(), "staffel": "A"}
    )
    staffel_b = await flow.create_tournament(
        team_mode="team",
        team_size=4,
        format="league",
        game_id="cod",
        status="registration_closed",
        max_participants=8,
        league_context={"league_id": new_id(), "season_id": season_id, "division_id": new_id(), "staffel": "B"},
    )
    await flow.db.tournament_registrations.create_index("league_squad_key", unique=True, sparse=True)
    return world, staffel_b


@pytest.mark.asyncio
async def test_assigning_the_same_squad_to_two_staffeln_at_once_lets_one_win(flow, monkeypatch):
    import routes.tournament_registration_routes as registration_routes

    world, staffel_b = await two_staffeln(flow)
    flow.act_as(world["staff"])
    gate = InterleavedReads(flow.db, "tournament_registrations", timeout=0.5)
    monkeypatch.setattr(registration_routes, "get_db", lambda: gate)
    body = {"team_id": world["lions"]["id"], "squad_id": world["squad_a"]["id"]}

    first, second = await asyncio.gather(
        flow.post(f"/api/tournaments/{world['tournament']['id']}/squad-registrations", json=body),
        flow.post(f"/api/tournaments/{staffel_b['id']}/squad-registrations", json=body),
    )

    assert sorted([first.status_code, second.status_code]) == [200, 409], (first.text, second.text)
    loser = first if first.status_code == 409 else second
    assert "anderen Staffel" in loser.json()["detail"]
    assert await flow.db.tournament_registrations.count_documents({"squad_id": world["squad_a"]["id"]}) == 1


@pytest.mark.asyncio
async def test_the_season_index_answers_with_a_german_sentence(flow, monkeypatch):
    """Greift erst der Index (Prüfung übersprungen), kommt trotzdem der Satz zur Season."""
    from services import squad_registration as service

    world, staffel_b = await two_staffeln(flow)
    flow.act_as(world["staff"])
    body = {"team_id": world["lions"]["id"], "squad_id": world["squad_a"]["id"]}
    first = await flow.post(f"/api/tournaments/{staffel_b['id']}/squad-registrations", json=body)
    assert first.status_code == 200, first.text
    stored = await flow.db.tournament_registrations.find_one({"id": first.json()["registration"]["id"]}, {"_id": 0})
    assert stored["league_squad_key"].endswith(f":{world['squad_a']['id']}")

    original = service._staffel_state

    async def blind(db, tournament):
        taken, seats, _other = await original(db, tournament)
        return taken, seats, set()

    monkeypatch.setattr(service, "_staffel_state", blind)
    second = await flow.post(f"/api/tournaments/{world['tournament']['id']}/squad-registrations", json=body)

    assert second.status_code == 409
    assert second.json()["detail"] == "Dieses Co-Team spielt in dieser Season schon in einer anderen Staffel."


@pytest.mark.asyncio
async def test_a_removed_or_withdrawn_squad_frees_its_season_key(flow):
    world, staffel_b = await two_staffeln(flow)
    flow.act_as(world["staff"])
    body = {"team_id": world["lions"]["id"], "squad_id": world["squad_a"]["id"]}
    placed = await flow.post(f"/api/tournaments/{staffel_b['id']}/squad-registrations", json=body)
    reg_id = placed.json()["registration"]["id"]

    removed = await flow.delete(f"/api/tournaments/{staffel_b['id']}/squad-registrations/{reg_id}")
    assert removed.status_code == 200
    moved = await flow.post(f"/api/tournaments/{world['tournament']['id']}/squad-registrations", json=body)
    assert moved.status_code == 200, moved.text

    # Austritt über den Umbauplan gibt den Schlüssel frei (die Anmeldung bleibt in der Staffel stehen).
    moved_id = moved.json()["registration"]["id"]
    removal_url = f"/api/tournaments/{world['tournament']['id']}/registrations/{moved_id}/removal"
    plan = await flow.post(removal_url, json={"kind": "withdrawn", "reason": "Kader zerfallen"})
    assert plan.status_code == 200, plan.text
    confirmed = await flow.post(removal_url, json={"kind": "withdrawn", "plan_id": plan.json()["plan"]["id"]})
    assert confirmed.status_code == 200, confirmed.text
    stored = await flow.db.tournament_registrations.find_one({"id": moved_id}, {"_id": 0})
    assert stored["status"] == "withdrawn" and "league_squad_key" not in stored
    again = await flow.post(f"/api/tournaments/{staffel_b['id']}/squad-registrations", json=body)
    assert again.status_code == 200, again.text


@pytest.mark.asyncio
async def test_the_dialog_names_a_team_that_already_stood_in_the_staffel(flow):
    world = await league_world(flow)
    flow.act_as(world["staff"])
    reg = await squad_registration(flow, world["tournament"], world["lions"], world["squad_a"])
    await flow.db.tournament_registrations.update_one({"id": reg["id"]}, {"$set": {"status": "withdrawn"}})

    data = (await flow.get(f"/api/tournaments/{world['tournament']['id']}/squad-candidates")).json()
    lions = next(team for team in data["teams"] if team["id"] == world["lions"]["id"])
    reasons = {squad["name"]: squad["problems"] for squad in lions["squads"]}

    assert lions["in_staffel"] is True
    assert any("ausgetreten" in text for text in reasons["Rudel B"]), reasons
    refused = await flow.post(
        f"/api/tournaments/{world['tournament']['id']}/squad-registrations",
        json={"team_id": world["lions"]["id"], "squad_id": world["squad_b"]["id"]},
    )
    assert refused.status_code == 409
    assert "ausgetreten" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_a_squad_stays_until_the_staffel_ends_whatever_its_status(flow):
    world = await live_match(flow)
    users = world["users"]
    await flow.db.tournament_registrations.update_one(
        {"id": world["regs"][0]["id"]}, {"$set": {"status": "disqualified"}}
    )
    flow.act_as(users["Leitung"])
    url = f"/api/teams/{world['lions']['id']}/squads/{world['squad_a']['id']}"

    refused = await flow.delete(url)
    assert refused.status_code == 409

    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"status": "completed"}})
    allowed = await flow.delete(url)
    assert allowed.status_code == 200, allowed.text


@pytest.mark.asyncio
async def test_dissolving_a_team_with_a_squad_in_a_running_staffel_is_refused(flow):
    world = await live_match(flow)
    users = world["users"]
    # Auch ausgetreten bleibt das Co-Team bis zum Ende der Staffel in Tabelle und Spielplan.
    await flow.db.tournament_registrations.update_one({"id": world["regs"][0]["id"]}, {"$set": {"status": "withdrawn"}})
    flow.act_as(users["Leitung"])

    refused = await flow.delete(f"/api/teams/{world['lions']['id']}", params={"confirm": "Loewen"})

    assert refused.status_code == 409, refused.text
    assert "Testturnier" in refused.json()["detail"]
    assert await flow.db.teams.find_one({"id": world["lions"]["id"]}) is not None
    assert await flow.db.team_squads.count_documents({"team_id": world["lions"]["id"]}) == 2
