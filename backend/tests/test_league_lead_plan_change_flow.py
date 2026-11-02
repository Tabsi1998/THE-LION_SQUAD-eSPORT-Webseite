"""Termin und Best of je Spiel durch die Turnierleitung (#2201, D-11). Erfundene Namen.

Die Änderung lief still: kein Eintrag im Protokoll, keine Nachricht. Jetzt steht sie mit altem und neuem Wert in
``audit_logs``, und in Spielwochen erfahren es die Verantwortlichen beider Seiten - einmal je Änderung.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, world as league_world  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def when(days: int = 2) -> str:
    return (now_utc() + timedelta(days=days)).replace(microsecond=0).isoformat()


async def audits(flow) -> list[dict]:
    return await flow.db.audit_logs.find({"action": "match.plan.change"}, {"_id": 0}).sort("created_at", 1).to_list(20)


async def notes(flow) -> list[dict]:
    return await flow.db.notifications.find({"kind": "match_schedule", "meta.reason": "schedule_lead_changed"}, {"_id": 0}).to_list(50)


async def patch(flow, world, **body):
    flow.act_as(world["staff"])
    answer = await flow.patch(f"/api/matches/{world['match']['id']}", json=body)
    assert answer.status_code == 200, answer.text
    return answer.json()


@pytest.mark.asyncio
async def test_a_new_time_is_logged_and_tells_both_sides_once(flow):
    world = await league_world(flow)
    before = world["match"]["scheduled_at"]
    target = when()
    await patch(flow, world, scheduled_at=target)
    rows = await audits(flow)
    assert len(rows) == 1 and rows[0]["actor_id"] == world["staff"]["id"]
    assert rows[0]["target_id"] == world["tournament"]["id"] and rows[0]["data"]["match_id"] == world["match"]["id"]
    change = rows[0]["data"]["changes"]["scheduled_at"]
    assert change["from"] == before and change["to"] == target
    sent = await notes(flow)
    assert {row["user_id"] for row in sent} == set(ids(world, "Kapitaen", "Falke1")), "die Verantwortlichen beider Seiten"
    assert "Die Turnierleitung" in sent[0]["body"] and "Uhr" in sent[0]["body"]
    assert sent[0]["url"] == f"/matches/{world['match']['id']}"

    replay = await patch(flow, world, scheduled_at=target)
    assert replay["idempotent_replay"] is True
    assert len(await audits(flow)) == 1 and len(await notes(flow)) == 2, "derselbe Termin noch einmal ändert nichts"


@pytest.mark.asyncio
async def test_the_same_moment_written_differently_is_no_change(flow):
    world = await league_world(flow)
    target = when()
    await patch(flow, world, scheduled_at=target)
    await patch(flow, world, scheduled_at=target.replace("+00:00", "Z"))
    assert len(await audits(flow)) == 1 and len(await notes(flow)) == 2


@pytest.mark.asyncio
async def test_moving_back_and_forth_tells_every_real_change(flow):
    world = await league_world(flow)
    first, second = when(2), when(3)
    for target in (first, second, first):
        await patch(flow, world, scheduled_at=target)
    assert len(await audits(flow)) == 3
    assert len(await notes(flow)) == 6


@pytest.mark.asyncio
async def test_best_of_of_one_match_is_logged_and_told(flow):
    world = await league_world(flow)
    await patch(flow, world, best_of=5)
    rows = await audits(flow)
    assert rows[0]["data"]["changes"] == {"best_of": {"from": None, "to": 5}}
    sent = await notes(flow)
    assert {row["user_id"] for row in sent} == set(ids(world, "Kapitaen", "Falke1"))
    assert "Best of 5" in sent[0]["body"]


@pytest.mark.asyncio
async def test_clearing_the_time_says_that_the_rule_applies_again(flow):
    world = await league_world(flow)
    await patch(flow, world, scheduled_at=None)
    assert (await audits(flow))[0]["data"]["changes"]["scheduled_at"]["to"] is None
    assert "Terminregel" in (await notes(flow))[0]["body"]


@pytest.mark.asyncio
async def test_other_fields_stay_silent(flow):
    world = await league_world(flow)
    await patch(flow, world, admin_note="Nur für die Leitung")
    assert await audits(flow) == [] and await notes(flow) == []


@pytest.mark.asyncio
async def test_a_cup_is_logged_but_tells_nobody(flow):
    """Regression: Außerhalb von Spielwochen plant die Leitung viele Spiele um, dort bleibt es ohne Nachricht."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _registrations = await flow.with_participants(2, format="single_elim", event_mode="online")
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    await flow.start(tournament)
    match = (await flow.matches(tournament))[0]
    answer = await flow.patch(f"/api/matches/{match['id']}", json={"scheduled_at": when()})
    assert answer.status_code == 200, answer.text
    assert len(await audits(flow)) == 1
    assert await notes(flow) == []
