"""Gewinne: Liste nach Status, Zähler der offenen eigenen Gewinne und Anmeldepflicht (#932).

Die Leitung filtert die Gewinn-Liste nach Status; der Zähler für den Hinweis im Dashboard zählt eigene und Team-Gewinne,
die offen oder bereit sind - abgeholte, verfallene und fremde nicht; ohne Anmeldung gibt es weder die Liste noch die
eigenen Gewinne.

Ersetzt:
- test_phase_8_9_10.py::test_prizes_crud (Restlücke: Status-Filter und open-count)
- test_phase_8_9_10.py::test_prizes_unauthorized
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def pickup(flow, status: str, *, user: dict | None = None, team_id: str | None = None, place: int = 1) -> str:
    pickup_id = new_id()
    await flow.db.prize_pickups.insert_one({
        "id": pickup_id, "tournament_id": "t-1", "source_type": "tournament", "place": place, "label": f"{place}. Platz",
        "value": "Pokal", "status": status, "user_id": (user or {}).get("id"), "team_id": team_id,
        "created_at": f"2026-11-0{place}T10:00:00+00:00",
    })
    return pickup_id


@pytest.mark.asyncio
async def test_status_filter_and_open_count(flow):
    anna, bert = await flow.add_user(name="anna"), await flow.add_user(name="bert")
    await flow.db.teams.insert_one({"id": "team-1", "name": "Löwen", "tag": "LOW", "member_ids": [anna["id"], bert["id"]]})
    own_pending = await pickup(flow, "pending", user=anna, place=1)
    await pickup(flow, "ready", user=anna, place=2)
    await pickup(flow, "picked_up", user=anna, place=3)
    await pickup(flow, "expired", user=anna, place=4)
    team_pending = await pickup(flow, "pending", team_id="team-1", place=5)
    await pickup(flow, "ready", user=bert, place=6)

    flow.act_as(await flow.add_staff())
    pending = await flow.get("/api/prizes?status=pending")
    assert pending.status_code == 200, pending.text
    assert {row["id"] for row in pending.json()} == {own_pending, team_pending}
    assert len((await flow.get("/api/prizes")).json()) == 6

    # Anna: zwei eigene offene bzw. bereite und der Team-Gewinn - nicht abgeholt, nicht verfallen, nicht Berts.
    flow.act_as(anna)
    count = await flow.get("/api/prizes/me/open-count")
    assert count.status_code == 200, count.text
    assert count.json() == {"count": 3}

    # Bert: sein eigener bereiter und der Team-Gewinn.
    flow.act_as(bert)
    assert (await flow.get("/api/prizes/me/open-count")).json() == {"count": 2}

    flow.act_as(await flow.add_user(name="cleo"))
    assert (await flow.get("/api/prizes/me/open-count")).json() == {"count": 0}


@pytest.mark.asyncio
async def test_prize_lists_need_a_login(flow):
    flow.act_as(None)
    listed = await flow.get("/api/prizes")
    assert listed.status_code == 401, listed.text
    mine = await flow.get("/api/prizes/me")
    assert mine.status_code == 401, mine.text
