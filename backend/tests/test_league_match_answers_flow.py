"""Spiel-Antworten auf das Nötige beschränkt, Eingabegrenzen und Anmeldung bei Staffeln (#2201). Erfundene Namen."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import world as league_world  # noqa: E402
from models import now_utc  # noqa: E402
from services.access_links import hash_access_token, new_access_token  # noqa: E402
from squad_world import make_team  # noqa: E402

NOTE = "Passt nach der Arbeit"
INTERNAL = ("note", "actor", "actor_user_id", "decision_note", "decision_user_id")


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def when(days: int = 2) -> str:
    return (now_utc() + timedelta(days=days)).isoformat()


async def with_proposal(flow, world) -> tuple[str, str]:
    url = f"/api/matches/{world['match']['id']}"
    flow.act_as(world["users"]["Kapitaen"])
    answer = await flow.post(f"{url}/schedule-proposals", json={"scheduled_at": when(), "note": NOTE})
    assert answer.status_code == 200, answer.text
    return url, answer.json()["id"]


async def proposals_as(flow, url: str, user: dict | None) -> tuple[list[dict], list[dict]]:
    flow.act_as(user)
    page = await flow.get(f"{url}/page")
    listed = await flow.get(f"{url}/schedule-proposals")
    assert page.status_code == 200 and listed.status_code == 200, page.text
    return page.json()["schedule_proposals"], listed.json()


@pytest.mark.asyncio
async def test_people_outside_the_match_see_only_when_and_status(flow):
    world = await league_world(flow)
    url, _proposal = await with_proposal(flow, world)
    for viewer in (None, world["users"]["Fremd"]):
        page, listed = await proposals_as(flow, url, viewer)
        for rows in (page, listed):
            assert len(rows) == 1
            assert rows[0]["scheduled_at"] and rows[0]["status"] == "pending"
            assert not set(INTERNAL) & set(rows[0]), rows[0]


@pytest.mark.asyncio
async def test_a_decision_stays_inside_too(flow):
    world = await league_world(flow)
    url, proposal = await with_proposal(flow, world)
    flow.act_as(world["users"]["Falke1"])
    assert (await flow.post(f"{url}/schedule-proposals/{proposal}/decision", json={"action": "decline", "note": "Passt nicht"})).status_code == 200
    page, _listed = await proposals_as(flow, url, None)
    assert not set(INTERNAL) & set(page[0])


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["Kapitaen", "Mila", "LoeLeitung", "Falke1", "Falke2"])
async def test_people_of_the_match_see_note_and_person(flow, name):
    world = await league_world(flow)
    url, _proposal = await with_proposal(flow, world)
    page, _listed = await proposals_as(flow, url, world["users"][name])
    assert page[0]["note"] == NOTE and page[0]["actor"]["display_name"]


@pytest.mark.asyncio
async def test_the_lead_sees_note_and_person(flow):
    world = await league_world(flow)
    url, _proposal = await with_proposal(flow, world)
    page, _listed = await proposals_as(flow, url, world["staff"])
    assert page[0]["note"] == NOTE and page[0]["actor_user_id"] == world["users"]["Kapitaen"]["id"]


# ---------------------------------------------------------------- Eingabegrenzen

@pytest.mark.asyncio
async def test_notes_and_reasons_have_a_limit(flow):
    world = await league_world(flow)
    url = f"/api/matches/{world['match']['id']}"
    flow.act_as(world["users"]["Kapitaen"])
    assert (await flow.post(f"{url}/schedule-proposals", json={"scheduled_at": when(), "note": "x" * 501})).status_code == 422
    assert (await flow.post(f"{url}/dispute", json={"reason": "x" * 1001})).status_code == 422
    accepted = await flow.post(f"{url}/schedule-proposals", json={"scheduled_at": when(), "note": "x" * 500})
    assert accepted.status_code == 200, accepted.text
    flow.act_as(world["users"]["Falke1"])
    too_long = await flow.post(f"{url}/schedule-proposals/{accepted.json()['id']}/decision", json={"action": "decline", "note": "x" * 501})
    assert too_long.status_code == 422
    assert (await flow.post(f"{url}/dispute", json={"reason": "x" * 1000})).status_code == 200


# ---------------------------------------------------------------- Anmeldung bei Staffeln

async def stored_link(flow, tournament_id: str) -> str:
    token = new_access_token()
    await flow.db.access_links.insert_one({
        "id": new_id(), "target_type": "tournament", "target_id": tournament_id, "grants": ["view", "register"],
        "token_hash": hash_access_token(token), "expires_at": None, "max_uses": None, "use_count": 0, "user_id": None,
        "email": None, "note": None, "is_active": True})
    return token


REGISTRATION = {"accept_rules": True, "accept_privacy": True}


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["draft", "live", "registration_open"])
async def test_a_staffel_takes_no_self_registration_with_any_link(flow, status):
    world = await league_world(flow)
    tid = world["tournament"]["id"]
    await flow.db.tournaments.update_one({"id": tid}, {"$set": {"status": status, "registration_enabled": True}})
    token = await stored_link(flow, tid)
    before = await flow.db.tournament_registrations.count_documents({"tournament_id": tid})
    team = await make_team(flow, "Dritte", leader=world["users"]["Fremd"], members=[])
    flow.act_as(world["users"]["Fremd"])
    answer = await flow.post(f"/api/tournaments/{tid}/register?access={token}", json={**REGISTRATION, "team_id": team["id"]})
    assert answer.status_code == 400, answer.text
    assert "Co-Team" in answer.json()["detail"]
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": tid}) == before


@pytest.mark.asyncio
async def test_links_for_a_staffel_open_nothing_but_the_view(flow):
    world = await league_world(flow)
    admin = await flow.add_user(role="superadmin", name="Oberleitung")
    flow.act_as(admin)
    body = {"target_type": "tournament", "target_id": world["tournament"]["id"]}
    refused = await flow.post("/api/access-links", json={**body, "grants": ["view", "register"]})
    assert refused.status_code == 409, refused.text
    assert (await flow.post("/api/access-links", json={**body, "grants": ["view"]})).status_code == 200


@pytest.mark.asyncio
async def test_other_tournaments_keep_their_link(flow):
    """Regression: Außerhalb der Liga meldet ein Link mit Anmelderecht weiter an, auch im Entwurf."""
    tournament = await flow.create_tournament(status="draft", visibility="private")
    admin = await flow.add_user(role="superadmin", name="Oberleitung")
    flow.act_as(admin)
    created = await flow.post("/api/access-links", json={"target_type": "tournament", "target_id": tournament["id"], "grants": ["register"]})
    assert created.status_code == 200, created.text
    token = await stored_link(flow, tournament["id"])
    flow.act_as(await flow.add_user(name="Anna"))
    answer = await flow.post(f"/api/tournaments/{tournament['id']}/register?access={token}", json=REGISTRATION)
    assert answer.status_code == 200, answer.text
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": tournament["id"]}) == 1
