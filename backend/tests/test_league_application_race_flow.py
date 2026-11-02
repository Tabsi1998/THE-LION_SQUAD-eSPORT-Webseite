"""Gleichzeitige Anmeldungen und Entscheidungen (docs/LIGA.md, B.4, #2205). Exklusiv ist das nur auf echtem MongoDB (``FLOW_MONGO_URL``); mongomock führt alles
nacheinander aus, das Ergebnis muss dort genauso stimmen. Die Dienste werden direkt gerufen, weil die Harness je Anfrage nur eine Person kennt. Erfundene Namen."""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_application_world import application_world, decide, inbox_url, submit, submitted  # noqa: E402
from league_start_world import ok  # noqa: E402
from services import league_applications as applications  # noqa: E402
from services.league_service import LeagueProblem  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def no_preview(_db, _tournament, _actor_id):
    return None


async def attempt(coroutine):
    try:
        await coroutine
        return "ok"
    except LeagueProblem as problem:
        return problem.status


async def fresh_season(flow, w: dict) -> tuple[dict, dict]:
    league = await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 0})
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    return league, season


@pytest.mark.asyncio
async def test_the_last_seat_goes_only_once(flow):
    w = await application_world(flow, application_slots=1, teams=3)
    apps = [await submitted(flow, w, side) for side in w["teams"]]
    flow.act_as(w["lead"])

    answers = await asyncio.gather(*(flow.post(f"{inbox_url(w)}/{row['id']}/accept", json={}) for row in apps))

    assert sorted(answer.status_code for answer in answers) == [200, 409, 409], [answer.text for answer in answers]
    assert await flow.db.league_applications.count_documents({"status": "accepted"}) == 1


@pytest.mark.asyncio
async def test_the_last_seat_goes_only_once_with_a_staffel(flow):
    w = await application_world(flow, application_slots=1, teams=2)
    apps = [await submitted(flow, w, side) for side in w["teams"]]
    flow.act_as(w["lead"])

    answers = await asyncio.gather(*(flow.post(f"{inbox_url(w)}/{row['id']}/accept", json={"tournament_id": w["tid"]}) for row in apps))

    assert sorted(answer.status_code for answer in answers) == [200, 409], [answer.text for answer in answers]
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": w["tid"]}) == 1


@pytest.mark.asyncio
async def test_a_second_parallel_application_of_one_squad_is_refused(flow):
    w = await application_world(flow)
    side = w["teams"][0]

    first, second = await asyncio.gather(submit(flow, w, side), submit(flow, w, side))

    assert sorted([first.status_code, second.status_code]) == [200, 409], (first.text, second.text)
    assert await flow.db.league_applications.count_documents({"squad_id": side["squad"]["id"]}) == 1
    assert await flow.db.league_rule_consents.count_documents({"squad_id": side["squad"]["id"]}) == 1


@pytest.mark.asyncio
async def test_the_index_refuses_a_second_open_application_without_the_lock(flow):
    if not flow.real_mongo:
        pytest.skip("nur echtes MongoDB kennt den Index")
    w = await application_world(flow)
    side = w["teams"][0]
    await submitted(flow, w, side)
    stored = await flow.db.league_applications.find_one({"squad_id": side["squad"]["id"]}, {"_id": 0})
    from pymongo.errors import DuplicateKeyError

    with pytest.raises(DuplicateKeyError):
        await flow.db.league_applications.insert_one({"id": "zweiter", "season_id": w["season"]["id"], "squad_id": side["squad"]["id"], "active_key": stored["active_key"]})


@pytest.mark.asyncio
async def test_withdrawing_against_accepting_leaves_one_clean_state(flow):
    w = await application_world(flow, application_slots=2)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    league, season = await fresh_season(flow, w)

    answers = await asyncio.gather(attempt(applications.withdraw(flow.db, league, season, application["id"], side["captain"])),
                                   attempt(applications.accept(flow.db, league, season, application["id"], w["tid"], w["lead"], refresh_previews=no_preview)))

    row = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    registrations = await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]})
    assert "ok" in answers
    if row["status"] == "withdrawn":
        assert registrations == 0 and "active_key" not in row
    else:
        assert row["status"] == "accepted" and registrations == 1 and row["assignment"]["registration_id"]


@pytest.mark.asyncio
async def test_rejecting_against_accepting_counts_once(flow):
    w = await application_world(flow)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    flow.act_as(w["lead"])

    answers = await asyncio.gather(flow.post(f"{inbox_url(w)}/{application['id']}/accept", json={"tournament_id": w["tid"]}),
                                   flow.post(f"{inbox_url(w)}/{application['id']}/reject", json={"reason": "Lieber doch nicht"}))

    assert sorted(answer.status_code for answer in answers) == [200, 409], [answer.text for answer in answers]
    row = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    assert (row["status"] == "accepted") is (await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 1)


@pytest.mark.asyncio
async def test_two_assignments_of_one_application_write_one_registration(flow):
    w = await application_world(flow, staffeln=2)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "accept"))
    flow.act_as(w["lead"])

    answers = await asyncio.gather(flow.post(f"{inbox_url(w)}/{application['id']}/assign", json={"tournament_id": w["tids"][0]}),
                                   flow.post(f"{inbox_url(w)}/{application['id']}/assign", json={"tournament_id": w["tids"][1]}))

    assert sorted(answer.status_code for answer in answers) == [200, 409], [answer.text for answer in answers]
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 1


@pytest.mark.asyncio
async def test_the_special_way_and_the_inbox_do_not_seat_a_squad_twice(flow):
    w = await application_world(flow, staffeln=2)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    flow.act_as(w["lead"])

    answers = await asyncio.gather(
        flow.post(f"{inbox_url(w)}/{application['id']}/accept", json={"tournament_id": w["tids"][0]}),
        flow.post(f"/api/tournaments/{w['tids'][1]}/squad-registrations", json={"team_id": side["team"]["id"], "squad_id": side["squad"]["id"]}))

    assert sorted(answer.status_code for answer in answers) == [200, 409], [answer.text for answer in answers]
    assert await flow.db.tournament_registrations.count_documents({"squad_id": side["squad"]["id"]}) == 1
    row = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    assert row["status"] == "accepted" and row["assignment"]["registration_id"]
