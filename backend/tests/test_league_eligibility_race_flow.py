"""Gleichzeitige Aufnahmen und Entscheidungen (docs/LIGA.md, B.3, #2204). Exklusiv ist das nur auf echtem MongoDB (``FLOW_MONGO_URL``); mongomock
führt alles nacheinander aus, das Ergebnis muss dort genauso stimmen. Erfundene Namen."""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import league_eligibility, league_roster  # noqa: E402
from test_league_eligibility_flow import rules  # noqa: E402
from test_league_roster_flow import set_id  # noqa: E402
from test_league_squad_rules_flow import ADULT, born  # noqa: E402
from test_league_transfers_flow import OPEN_WINDOW, admin_url, ask, transfer_world  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def newcomer(flow, w: dict, name: str = "Neuling") -> dict:
    person = await flow.add_user(name=name)
    w["users"][name] = person
    await flow.db.teams.update_one({"id": w["lions"]["id"]}, {"$addToSet": {"member_ids": person["id"]}})
    await flow.db.team_members.insert_one({"team_id": w["lions"]["id"], "user_id": person["id"], "role": "member"})
    await born(flow, w, name, ADULT)
    return person


async def add(flow, w: dict, squad: str, person: dict):
    current = (await flow.db.team_squads.find_one({"id": w[squad]["id"]}))["member_ids"]
    return await flow.patch(f"/api/teams/{w['lions']['id']}/squads/{w[squad]['id']}", json={"member_ids": [*current, person["id"]]})


@pytest.mark.asyncio
async def test_two_parallel_additions_put_a_person_into_one_squad_only(flow):
    w = await transfer_world(flow)
    person = await newcomer(flow, w)
    flow.act_as(w["users"]["LoeLeitung"])

    first, second = await asyncio.gather(add(flow, w, "squad_a", person), add(flow, w, "squad_b", person))

    assert sorted([first.status_code, second.status_code]) == [200, 409], (first.text, second.text)
    holders = await flow.db.team_squads.count_documents({"member_ids": person["id"], "id": {"$in": [w["squad_a"]["id"], w["squad_b"]["id"]]}})
    assert holders == 1, "nie in zwei Co-Teams derselben Season"


@pytest.mark.asyncio
async def test_parallel_additions_never_pass_the_largest_squad(flow):
    w = await transfer_world(flow, max_squad_size=4)
    one, two = await newcomer(flow, w, "NeuEins"), await newcomer(flow, w, "NeuZwei")
    flow.act_as(w["users"]["LoeLeitung"])

    answers = await asyncio.gather(add(flow, w, "squad_a", one), add(flow, w, "squad_a", two))

    assert all(row.status_code in (200, 409, 422) for row in answers), [row.text for row in answers]
    assert len((await flow.db.team_squads.find_one({"id": w["squad_a"]["id"]}))["member_ids"]) <= 4


@pytest.mark.asyncio
async def test_a_game_id_can_only_be_locked_once_when_two_arrive_together(flow):
    w = await transfer_world(flow)
    await rules(flow, w, unique_game_ids=True)
    await flow.db.league_rosters.create_index([("season_id", 1), ("id_keys", 1)], unique=True, name="league_roster_unique_id",
                                              partialFilterExpression={"id_keys": {"$exists": True}})
    one, two = w["users"]["Mila"]["id"], w["users"]["Kapitaen"]["id"]
    for name in ("Mila", "Kapitaen"):
        await set_id(flow, w["users"][name], "Gleich#1234567")
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    # Beide haben gelesen, bevor der andere geschrieben hat.
    first = await league_roster.context_for_tournament(flow.db, tournament, [one])
    second = await league_roster.context_for_tournament(flow.db, tournament, [two])

    await asyncio.gather(
        league_roster.record_members(flow.db, first, [one], via="assign", actor_id=None, squad_id=w["squad_a"]["id"]),
        league_roster.record_members(flow.db, second, [two], via="assign", actor_id=None, squad_id=w["squad_a"]["id"]),
    )

    rows = await flow.db.league_rosters.find({"season_id": w["season_id"]}, {"_id": 0}).to_list(10)
    assert len(rows) == 2, "beide stehen im Kader"
    assert sum(1 for row in rows if row.get("locked_at")) == 1, "die ID gehört einer Person"
    ctx = await league_eligibility.context_for_tournament(flow.db, tournament, [one, two])
    states = sorted(league_eligibility.status(ctx, uid, w["squad_a"]["id"])["state"] for uid in (one, two))
    assert states == ["locked", "taken"]


@pytest.mark.asyncio
async def test_two_decisions_on_one_transfer_count_once(flow):
    w = await transfer_world(flow)
    row = (await ask(flow, w)).json()
    flow.act_as(w["staff"])

    answers = await asyncio.gather(flow.post(f"{admin_url(w)}/{row['id']}/approve", json={}),
                                   flow.post(f"{admin_url(w)}/{row['id']}/reject", json={"reason": "Lieber doch nicht"}))

    assert sorted(answer.status_code for answer in answers) == [200, 409], [answer.text for answer in answers]
    stored = await flow.db.league_transfers.find_one({"id": row["id"]}, {"_id": 0})
    in_target = w["users"]["Ida"]["id"] in (await flow.db.team_squads.find_one({"id": w["squad_a"]["id"]}))["member_ids"]
    assert in_target is (stored["status"] == "approved")


@pytest.mark.asyncio
async def test_two_parallel_requests_leave_one_open(flow):
    w = await transfer_world(flow, windows=OPEN_WINDOW)
    await flow.db.league_transfers.create_index([("season_id", 1), ("user_id", 1)], unique=True, name="league_transfer_one_open",
                                                partialFilterExpression={"status": "pending"})

    answers = await asyncio.gather(ask(flow, w), ask(flow, w))

    assert sorted(answer.status_code for answer in answers) == [200, 409], [answer.text for answer in answers]
    assert await flow.db.league_transfers.count_documents({"status": "pending"}) == 1
