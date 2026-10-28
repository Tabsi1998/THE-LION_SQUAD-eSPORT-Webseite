"""``league_squad_key`` folgt jedem Statuswechsel einer Co-Team-Anmeldung (#1649, zweite Prüfung zu P3).

Abgelehnt, nicht erschienen, ausgetreten → das Co-Team ist in der Season wieder frei. Zurück auf aktiv → der Schlüssel
kommt wieder, außer das Co-Team spielt inzwischen in einer anderen Staffel (409). Ein abgebrochener Austritt behält
den Schlüssel. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from squad_world import league_world  # noqa: E402

SEASON_TAKEN = "Dieses Co-Team spielt in dieser Season schon in einer anderen Staffel."


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def season_with_two_staffeln(flow) -> dict:
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
    flow.act_as(world["staff"])
    body = {"team_id": world["lions"]["id"], "squad_id": world["squad_a"]["id"]}
    placed = await flow.post(f"/api/tournaments/{world['tournament']['id']}/squad-registrations", json=body)
    assert placed.status_code == 200, placed.text
    return {**world, "staffel_b": staffel_b, "body": body, "reg_a": placed.json()["registration"]}


async def stored(flow, reg_id: str) -> dict:
    return await flow.db.tournament_registrations.find_one({"id": reg_id}, {"_id": 0})


@pytest.mark.asyncio
async def test_rejecting_frees_the_squad_and_a_way_back_is_refused_once_it_plays_elsewhere(flow):
    world = await season_with_two_staffeln(flow)
    reg_url = f"/api/tournaments/{world['tournament']['id']}/registrations/{world['reg_a']['id']}"

    rejected = await flow.patch(reg_url, json={"status": "rejected"})
    assert rejected.status_code == 200, rejected.text
    assert "league_squad_key" not in await stored(flow, world["reg_a"]["id"])

    elsewhere = await flow.post(f"/api/tournaments/{world['staffel_b']['id']}/squad-registrations", json=world["body"])
    assert elsewhere.status_code == 200, elsewhere.text

    back = await flow.patch(reg_url, json={"status": "approved"})
    assert back.status_code == 409
    assert back.json()["detail"] == SEASON_TAKEN
    assert (await stored(flow, world["reg_a"]["id"]))["status"] == "rejected", "nichts geändert"


@pytest.mark.asyncio
async def test_back_to_active_sets_the_key_again_when_the_squad_is_free(flow):
    world = await season_with_two_staffeln(flow)
    reg_url = f"/api/tournaments/{world['tournament']['id']}/registrations/{world['reg_a']['id']}"
    await flow.patch(reg_url, json={"status": "rejected"})

    back = await flow.patch(reg_url, json={"status": "approved"})

    assert back.status_code == 200, back.text
    assert (await stored(flow, world["reg_a"]["id"]))["league_squad_key"].endswith(world["squad_a"]["id"])
    twice = await flow.post(f"/api/tournaments/{world['staffel_b']['id']}/squad-registrations", json=world["body"])
    assert twice.status_code == 409


@pytest.mark.asyncio
async def test_no_show_through_check_in_frees_the_squad_and_checking_in_again_respects_the_season(flow):
    world = await season_with_two_staffeln(flow)
    checkin_url = f"/api/tournaments/{world['tournament']['id']}/registrations/{world['reg_a']['id']}/checkin"

    no_show = await flow.post(checkin_url, json={"status": "no_show"})
    assert no_show.status_code == 200, no_show.text
    assert "league_squad_key" not in await stored(flow, world["reg_a"]["id"])

    elsewhere = await flow.post(f"/api/tournaments/{world['staffel_b']['id']}/squad-registrations", json=world["body"])
    assert elsewhere.status_code == 200, elsewhere.text
    again = await flow.post(checkin_url, json={"status": "checked_in"})
    assert again.status_code == 409
    assert again.json()["detail"] == SEASON_TAKEN
    assert (await stored(flow, world["reg_a"]["id"]))["status"] == "no_show"


@pytest.mark.asyncio
async def test_a_withdrawn_squad_coming_back_cannot_play_in_two_staffeln(flow):
    world = await season_with_two_staffeln(flow)
    removal_url = f"/api/tournaments/{world['tournament']['id']}/registrations/{world['reg_a']['id']}/removal"
    plan = await flow.post(removal_url, json={"kind": "withdrawn"})
    confirmed = await flow.post(removal_url, json={"kind": "withdrawn", "plan_id": plan.json()["plan"]["id"]})
    assert confirmed.status_code == 200, confirmed.text
    elsewhere = await flow.post(f"/api/tournaments/{world['staffel_b']['id']}/squad-registrations", json=world["body"])
    assert elsewhere.status_code == 200, elsewhere.text

    reg_url = f"/api/tournaments/{world['tournament']['id']}/registrations/{world['reg_a']['id']}"
    back = await flow.patch(reg_url, json={"status": "approved"})

    assert back.status_code == 409
    assert (await stored(flow, world["reg_a"]["id"]))["status"] == "withdrawn"


@pytest.mark.asyncio
async def test_registrations_without_squad_keep_their_status_flow(flow):
    """Regression: Anmeldungen ohne Co-Team ändern ihren Status wie bisher, ohne Schlüssel."""
    world = await season_with_two_staffeln(flow)
    plain = await flow.register(world["tournament"], world["users"]["Fremd"])
    reg_url = f"/api/tournaments/{world['tournament']['id']}/registrations/{plain['id']}"

    for status in ("rejected", "approved"):
        changed = await flow.patch(reg_url, json={"status": status})
        assert changed.status_code == 200, changed.text
        assert "league_squad_key" not in await stored(flow, plain["id"])
