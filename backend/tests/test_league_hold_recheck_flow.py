"""Ein gehaltenes Ergebnis prüft beim Veröffentlichen die Person noch einmal (#2203): Wer in den 12 Sekunden sein Liga-Recht verliert
oder befangen wird, veröffentlicht nichts mehr. Andere Turniere wie bisher. Erfundene Namen."""

import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import ids, world  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def holder(flow, *capabilities, user=None) -> dict:
    person = user or await flow.add_user(name="Zuständig")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga", "user_id": person["id"], "capabilities": list(capabilities)})
    return person


def body(w: dict, **extra) -> dict:
    return {"results": [{"registration_id": w["reg_a"]["id"], "rank": 1, "score": 2},
                        {"registration_id": w["reg_h"]["id"], "rank": 2, "score": 0}], "hold": True, **extra}


async def hold(flow, w: dict, person: dict, **extra) -> None:
    flow.act_as(person)
    held = await flow.post(f"/api/matches/{w['match']['id']}/result", json=body(w, **extra))
    assert held.status_code == 200, held.text
    assert held.json()["held"] is True


async def publish(flow) -> int:
    from services.result_hold import publish_due_holds

    return await publish_due_holds(flow.db, now=now_utc() + timedelta(seconds=30))


async def stored(flow, w: dict) -> dict:
    return await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})


async def assert_discarded(flow, w: dict, person: dict) -> None:
    assert await publish(flow) == 0
    match = await stored(flow, w)
    assert "pending_result" not in match, "der Hold ist verworfen, nichts bleibt hängen"
    assert match["status"] == "scheduled" and not match.get("results")
    failed = await flow.db.audit_logs.find({"action": "match.result.hold_failed"}, {"_id": 0}).to_list(5)
    assert len(failed) == 1 and failed[0]["actor_id"] == person["id"]
    told = await flow.db.notifications.find({"user_id": person["id"], "meta.reason": "hold_failed"}, {"_id": 0}).to_list(5)
    assert len(told) == 1, "die Person erfährt, dass nichts gespeichert wurde"
    assert not await flow.db.audit_logs.find_one({"action": "match.result.submit"})


@pytest.mark.asyncio
async def test_an_unchanged_holder_publishes(flow):
    w = await world(flow)
    await hold(flow, w, await holder(flow, "results"))
    assert await publish(flow) == 1
    assert (await stored(flow, w))["status"] == "completed"


@pytest.mark.asyncio
async def test_removing_the_staff_row_discards_the_hold(flow):
    w = await world(flow)
    person = await holder(flow, "results")
    await hold(flow, w, person)
    await flow.db.league_staff.delete_many({"user_id": person["id"]})
    await assert_discarded(flow, w, person)


@pytest.mark.asyncio
async def test_losing_the_capability_discards_the_hold(flow):
    w = await world(flow)
    person = await holder(flow, "results", "roster")
    await hold(flow, w, person)
    await flow.db.league_staff.update_one({"user_id": person["id"]}, {"$set": {"capabilities": ["roster"]}})
    await assert_discarded(flow, w, person)


@pytest.mark.asyncio
async def test_losing_the_area_discards_the_hold(flow):
    w = await world(flow)
    person = await flow.add_user(name="Bereich Ligen")
    await flow.db.users.update_one({"id": person["id"]}, {"$set": {"areas": ["leagues"]}})
    await hold(flow, w, {**person, "areas": ["leagues"]})
    await flow.db.users.update_one({"id": person["id"]}, {"$set": {"areas": []}})
    await assert_discarded(flow, w, person)


@pytest.mark.asyncio
async def test_a_switched_off_second_factor_discards_the_hold(flow):
    w = await world(flow)
    person = await holder(flow, "results")
    await hold(flow, w, person)
    await flow.db.users.update_one({"id": person["id"]}, {"$set": {"mfa_enabled": False}})
    await assert_discarded(flow, w, person)


@pytest.mark.asyncio
async def test_a_banned_account_discards_the_hold(flow):
    w = await world(flow)
    person = await holder(flow, "results")
    await hold(flow, w, person)
    await flow.db.users.update_one({"id": person["id"]}, {"$set": {"is_banned": True}})
    assert await publish(flow) == 0
    assert "pending_result" not in await stored(flow, w)
    assert not (await stored(flow, w)).get("results")


@pytest.mark.asyncio
async def test_becoming_involved_discards_the_hold(flow):
    w = await world(flow)
    person = await holder(flow, "results")
    await hold(flow, w, person)
    await flow.db.team_squads.update_one({"id": w["squad_a"]["id"]}, {"$addToSet": {"member_ids": person["id"]}})
    await assert_discarded(flow, w, person)


@pytest.mark.asyncio
async def test_losing_disputes_discards_a_hold_on_a_disputed_match(flow):
    w = await world(flow)
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"status": "disputed", "status_before_dispute": "scheduled"}})
    person = await holder(flow, "results", "disputes")
    await hold(flow, w, person)
    await flow.db.league_staff.update_one({"user_id": person["id"]}, {"$set": {"capabilities": ["results"]}})
    assert await publish(flow) == 0
    assert "pending_result" not in await stored(flow, w)
    assert (await stored(flow, w))["status"] == "disputed"


@pytest.mark.asyncio
async def test_a_discarded_hold_frees_its_lineups(flow):
    w = await world(flow)
    person = await holder(flow, "results")
    lineups = {w["reg_a"]["id"]: ids(w, "Kapitaen", "Tom")}
    games = [{"position": 1, "mode": "stellung", "map_id": "map-hafen", "winner_registration_id": w["reg_a"]["id"], "lineups": lineups},
             {"position": 2, "mode": "suchen", "map_id": "map-turm", "winner_registration_id": w["reg_a"]["id"], "lineups": lineups}]
    await hold(flow, w, person, games=games)
    assert (await stored(flow, w)).get("lineup_user_ids"), "der Hold blockiert die Aufgestellten"
    await flow.db.league_staff.delete_many({"user_id": person["id"]})
    assert await publish(flow) == 0
    assert not (await stored(flow, w)).get("lineup_user_ids"), "verworfen: die Aufgestellten sind wieder frei"


@pytest.mark.asyncio
async def test_the_emergency_of_the_superadmin_stays_valid(flow):
    w = await world(flow)
    captain = w["users"]["Kapitaen"]
    await flow.db.users.update_one({"id": captain["id"]}, {"$set": {"role": "superadmin"}})
    await hold(flow, w, {**captain, "role": "superadmin"}, conflict_reason="Sonst niemand erreichbar")
    assert await publish(flow) == 1
    assert (await stored(flow, w))["status"] == "completed"


@pytest.mark.asyncio
async def test_a_superadmin_who_becomes_involved_without_a_reason_is_discarded(flow):
    w = await world(flow)
    superadmin = w["staff"]
    await hold(flow, w, superadmin)
    await flow.db.team_squads.update_one({"id": w["squad_a"]["id"]}, {"$addToSet": {"member_ids": superadmin["id"]}})
    await assert_discarded(flow, w, superadmin)


@pytest.mark.asyncio
async def test_an_emergency_needs_the_superadmin_at_publish_time_too(flow):
    w = await world(flow)
    captain = w["users"]["Kapitaen"]
    await flow.db.users.update_one({"id": captain["id"]}, {"$set": {"role": "superadmin"}})
    await hold(flow, w, {**captain, "role": "superadmin"}, conflict_reason="Sonst niemand erreichbar")
    await flow.db.users.update_one({"id": captain["id"]}, {"$set": {"role": "club_admin"}})
    assert await publish(flow) == 0
    assert not (await stored(flow, w)).get("results")


@pytest.mark.asyncio
async def test_other_tournaments_publish_as_before(flow):
    """Regression: Ein Helfer, dem der Einsatz entzogen wird, veröffentlicht in einem normalen Turnier weiter."""
    tournament, _users, regs = await flow.with_participants(2, status="live")
    match = {"id": new_id(), "tournament_id": tournament["id"], "stage_id": new_id(), "match_type": "duel", "status": "scheduled", "round": 1,
             "slots": [{"slot": 1, "status": "filled", "registration_id": regs[0]["id"]},
                       {"slot": 2, "status": "filled", "registration_id": regs[1]["id"]}]}
    await flow.db.matches_v2.insert_one(dict(match))
    helper = await flow.add_user(name="Helfer")
    await flow.db.tournament_staff_assignments.insert_one(
        {"id": new_id(), "tournament_id": tournament["id"], "user_id": helper["id"], "role": "referee", "scope": "tournament"})
    flow.act_as(helper)
    held = await flow.post(f"/api/matches/{match['id']}/result", json={
        "results": [{"registration_id": regs[0]["id"], "rank": 1, "score": 2}, {"registration_id": regs[1]["id"], "rank": 2, "score": 0}], "hold": True})
    assert held.status_code == 200, held.text
    await flow.db.tournament_staff_assignments.delete_many({"user_id": helper["id"]})
    assert await publish(flow) == 1
