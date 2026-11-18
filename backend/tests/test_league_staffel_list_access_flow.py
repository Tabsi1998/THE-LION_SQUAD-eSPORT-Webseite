"""Turnierliste der Verwaltung für Liga-Zuständige (#2463). Erfundene Namen.

Wer nur den Bereich Ligen hat oder in einer Liga zuständig ist (``league_staff``), öffnet die Turnierliste und sieht dort nur die
Staffeln, die er leitet (docs/LIGA.md, B.1, ``StaffelAccess.covers``): mit dem Bereich alle Staffeln, als Zuständiger die seiner Ligen.
Gewöhnliche Turniere stehen für sie nicht in der Liste - auch öffentliche nicht -, und ohne bestätigte Zwei-Faktor-Anmeldung gilt
weder Bereich noch Zuständigkeit. Ändern dürfen sie aus der Liste nichts, was ihnen der Server nicht ohnehin gibt.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import staffel, world  # noqa: E402
from models import now_utc  # noqa: E402

MANAGED_LIST = "/api/tournaments?include_drafts=true&managed=true&limit=500"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def holder(flow, *capabilities, league_id="liga", name="Zuständig") -> dict:
    person = await flow.add_user(name=name)
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league_id, "user_id": person["id"],
                                           "capabilities": list(capabilities), "created_at": now_utc().isoformat()})
    return person


async def scene(flow) -> dict:
    """Eine Staffel der Liga „liga“ (gestartet), eine Staffel im Entwurf einer anderen Liga, ein öffentliches Turnier, ein Turnier-Entwurf."""
    w = await world(flow)
    foreign = await staffel(flow, new_id(), "B")
    await flow.db.tournaments.update_one({"id": foreign["id"]}, {"$set": {"league_context.league_id": "andere", "status": "draft"}})
    cup = await flow.create_tournament(title="Probe-Cup")
    draft_cup = await flow.create_tournament(title="Entwurfs-Cup", status="draft")
    return {"own": w["tournament"]["id"], "foreign": foreign["id"], "cup": cup["id"], "draft_cup": draft_cup["id"]}


async def listed(flow, person) -> set[str]:
    flow.act_as(person)
    response = await flow.get(MANAGED_LIST)
    assert response.status_code == 200
    return {row["id"] for row in response.json()}


@pytest.mark.asyncio
async def test_a_league_holder_sees_only_the_staffeln_of_his_league(flow):
    s = await scene(flow)
    person = await holder(flow, "matches")
    assert await listed(flow, person) == {s["own"]}
    rows = (await flow.get(MANAGED_LIST)).json()
    assert rows[0]["league_label"], "die Liste kennzeichnet die Staffel"


@pytest.mark.asyncio
async def test_the_leagues_area_sees_every_staffel_and_no_tournament(flow):
    s = await scene(flow)
    area = await flow.add_user(name="Bereich Ligen")
    area["areas"] = ["leagues"]
    await flow.db.users.update_one({"id": area["id"]}, {"$set": {"areas": ["leagues"]}})
    assert await listed(flow, area) == {s["own"], s["foreign"]}


@pytest.mark.asyncio
async def test_another_league_stays_invisible(flow):
    s = await scene(flow)
    other = await holder(flow, "manage", "season", league_id="andere", name="Andere Liga")
    ids = await listed(flow, other)
    assert ids == {s["foreign"]}
    assert s["own"] not in ids


@pytest.mark.asyncio
async def test_ordinary_tournaments_stay_invisible_for_league_holders(flow):
    s = await scene(flow)
    for person in (await holder(flow, "results"), await holder(flow, "manage", league_id="andere", name="Andere")):
        ids = await listed(flow, person)
        assert s["cup"] not in ids and s["draft_cup"] not in ids


@pytest.mark.asyncio
async def test_without_a_right_the_list_is_empty_and_changes_are_refused(flow):
    s = await scene(flow)
    member = await flow.add_user(name="Mitglied")
    # Die Liste bleibt für alle abrufbar (Gewinne, Stationen und Captains fragen sie auch) - nur steht nichts darin.
    assert await listed(flow, member) == set()
    response = await flow.post(f"/api/tournaments/{s['own']}/status", json={"status": "paused"})
    assert response.status_code == 403
    response = await flow.delete(f"/api/tournaments/{s['own']}")
    assert response.status_code in (403, 404)
    assert await flow.db.tournaments.count_documents({"id": s["own"], "status": "live"}) == 1


@pytest.mark.asyncio
async def test_without_second_factor_the_league_right_gives_no_list(flow):
    s = await scene(flow)
    person = await holder(flow, "manage")
    await flow.db.users.update_one({"id": person["id"]}, {"$set": {"mfa_enabled": False, "auth_mfa_verified": False}})
    person.update({"mfa_enabled": False, "auth_mfa_verified": False})
    assert s["own"] not in await listed(flow, person)


@pytest.mark.asyncio
async def test_a_league_holder_changes_no_ordinary_tournament_and_no_foreign_staffel(flow):
    s = await scene(flow)
    flow.act_as(await holder(flow, "manage", "season"))
    response = await flow.post(f"/api/tournaments/{s['cup']}/status", json={"status": "cancelled"})
    assert response.status_code == 403
    response = await flow.post(f"/api/tournaments/{s['foreign']}/status", json={"status": "cancelled"})
    assert response.status_code in (403, 404)
    response = await flow.delete(f"/api/tournaments/{s['draft_cup']}")
    assert response.status_code == 403
    assert await flow.db.tournaments.count_documents({"id": {"$in": [s["cup"], s["foreign"], s["draft_cup"]]}}) == 3
    assert await flow.db.tournaments.count_documents({"id": s["cup"], "status": "cancelled"}) == 0


@pytest.mark.asyncio
async def test_the_web_tournament_list_shows_no_staffel_for_anyone(flow):
    """Paket D (#2262, Nr. 192): Die Turnierliste der Verwaltung fragt mit ``league=exclude`` - die Turnierleitung sieht ihre Turniere,
    der Bereich Ligen und Liga-Zuständige dort nichts. Ohne Angabe bleibt die Vorgabe ``include`` (die App ohne neuen Build)."""
    s = await scene(flow)
    lead = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    area = await flow.add_user(name="Bereich Ligen")
    await flow.db.users.update_one({"id": area["id"]}, {"$set": {"areas": ["leagues"]}})
    area["areas"] = ["leagues"]
    for person, expected in ((lead, {s["cup"], s["draft_cup"]}), (area, set()), (await holder(flow, "manage"), set())):
        flow.act_as(person)
        response = await flow.get(MANAGED_LIST + "&league=exclude")
        assert response.status_code == 200, response.text
        assert {row["id"] for row in response.json()} == expected, person["display_name"]
    assert await listed(flow, area) == {s["own"], s["foreign"]}, "ohne Angabe wie bisher"
