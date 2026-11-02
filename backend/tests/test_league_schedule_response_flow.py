"""Antwortfrist und Ablehnung von Terminvorschlägen (#2201, D-8 und D-9). Erfundene Namen.

D-8: Die Frist gehört zum Vorschlag. Ein neuer Vorschlag oder Gegenvorschlag bekommt eine neue, die Annahme beendet sie.
D-9: Eine Ablehnung, nach der ein Termin gilt, meldet nichts mehr an die Leitung und zeigt nicht „abgelehnt“.
"""
import pathlib
import sys
from datetime import datetime, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import world as league_world  # noqa: E402
from models import now_utc  # noqa: E402
from services.matchday_schedule import persist_all_matchday_schedules  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def when(days: int = 2) -> str:
    return (now_utc() + timedelta(days=days)).isoformat()


async def live_world(flow, **fields) -> dict:
    """Staffel, seit gestern live, Spiel ohne Termin am ersten Spieltag."""
    world = await league_world(flow)
    start = (now_utc() - timedelta(days=1)).replace(microsecond=0)
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {
        "start_date": start.isoformat(), "match_schedule_response_hours": 72, **fields}})
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"scheduled_at": None, "status": "ready"}})
    return world


def url(world: dict) -> str:
    return f"/api/matches/{world['match']['id']}/schedule-proposals"


async def propose(flow, world, user: str, days: int = 2) -> dict:
    flow.act_as(world["users"][user])
    answer = await flow.post(url(world), json={"scheduled_at": when(days)})
    assert answer.status_code == 200, answer.text
    return answer.json()


async def decide(flow, world, user: str, proposal: dict, **body) -> dict:
    flow.act_as(world["users"][user])
    answer = await flow.post(f"{url(world)}/{proposal['id']}/decision", json=body)
    assert answer.status_code == 200, answer.text
    return answer.json()


async def expire(flow, world) -> None:
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]},
                                        {"$set": {"schedule_deadline_at": (now_utc() - timedelta(hours=1)).isoformat()}})


def fresh_deadline(match: dict) -> bool:
    return timedelta(hours=71) < datetime.fromisoformat(match["schedule_deadline_at"]) - now_utc() <= timedelta(hours=72)


async def escalations(flow) -> list[dict]:
    return await flow.db.notifications.find({"kind": "schedule_escalation"}, {"_id": 0}).to_list(50)


# ---------------------------------------------------------------- D-8

@pytest.mark.asyncio
async def test_accepting_ends_the_deadline(flow):
    world = await live_world(flow)
    first = await propose(flow, world, "Kapitaen")
    await decide(flow, world, "Falke1", first, action="accept")
    stored = await flow.reload(world["match"])
    assert stored["schedule_status"] == "accepted"
    assert stored.get("schedule_deadline_at") is None


@pytest.mark.asyncio
async def test_moving_an_agreed_time_after_the_deadline_gets_a_new_one(flow):
    world = await live_world(flow)
    first = await propose(flow, world, "Kapitaen")
    await expire(flow, world)
    await decide(flow, world, "Falke1", first, action="accept")
    # Stand von vor dem Fix: Die Annahme ließ die abgelaufene Frist stehen.
    await expire(flow, world)

    await propose(flow, world, "Kapitaen", 3)
    stored = await flow.reload(world["match"])
    assert stored["schedule_status"] == "proposed" and fresh_deadline(stored)
    flow.act_as(world["users"]["Falke1"])
    page = (await flow.get(f"/api/matches/{world['match']['id']}/page")).json()
    assert page["match"]["schedule_status"] == "proposed", "nicht sofort „Turnierleitung nötig“"
    assert page["match"]["schedule_deadline_at"] == stored["schedule_deadline_at"]


@pytest.mark.asyncio
async def test_a_counter_proposal_gets_a_new_deadline(flow):
    world = await live_world(flow)
    first = await propose(flow, world, "Kapitaen")
    await expire(flow, world)
    await decide(flow, world, "Falke1", first, action="counter", scheduled_at=when(3))
    stored = await flow.reload(world["match"])
    assert stored["schedule_status"] == "proposed" and fresh_deadline(stored)


@pytest.mark.asyncio
async def test_a_new_proposal_after_an_escalation_can_escalate_again(flow):
    world = await live_world(flow)
    await propose(flow, world, "Kapitaen")
    await expire(flow, world)
    await persist_all_matchday_schedules(flow.db)
    escalated = await flow.reload(world["match"])
    assert escalated["schedule_status"] == "escalated" and escalated.get("schedule_escalated_at")
    first_notes = len(await escalations(flow))
    assert first_notes >= 1

    await propose(flow, world, "Falke1", 3)
    renewed = await flow.reload(world["match"])
    assert renewed["schedule_status"] == "proposed" and renewed.get("schedule_escalated_at") is None
    await persist_all_matchday_schedules(flow.db)
    assert (await flow.reload(world["match"]))["schedule_status"] == "proposed", "die neue Frist läuft noch"

    await expire(flow, world)
    await persist_all_matchday_schedules(flow.db)
    assert (await flow.reload(world["match"]))["schedule_status"] == "escalated"
    assert len(await escalations(flow)) == 2 * first_notes, "je abgelaufener Frist eine Nachricht"


@pytest.mark.asyncio
async def test_a_deadline_in_the_break_still_does_not_count_the_break(flow):
    """Regression: die neue Frist rechnet weiter über ``response_deadline`` - die Pause zählt nicht."""
    day = (now_utc() + timedelta(days=1)).date()
    world = await live_world(flow, blocked_periods=[{"start_date": day.isoformat(),
                                                     "end_date": (day + timedelta(days=9)).isoformat(), "label": "Pause"}])
    await propose(flow, world, "Kapitaen", 12)
    stored = await flow.reload(world["match"])
    assert datetime.fromisoformat(stored["schedule_deadline_at"]) - now_utc() > timedelta(hours=72 + 24 * 8)


# ---------------------------------------------------------------- andere Turniere

async def online_cup(flow, **fields) -> tuple[dict, dict, dict]:
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(
        2, format="single_elim", event_mode="online", schedule_mode="player_proposal",
        match_schedule_response_hours=24, **fields)
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    await flow.start(tournament)
    match = (await flow.matches(tournament))[0]
    by_reg = {reg["id"]: user for user, reg in zip(users, registrations)}
    return match, by_reg[match["slots"][0]["registration_id"]], by_reg[match["slots"][1]["registration_id"]]


@pytest.mark.asyncio
async def test_a_cup_keeps_a_deadline_set_in_the_match_settings(flow):
    """Regression: Eine fest eingestellte Frist in der Zukunft gilt weiter; ohne sie jetzt plus Antwortzeit des Turniers."""
    match, home, _away = await online_cup(flow)
    flow.act_as(home)
    answer = await flow.post(f"/api/matches/{match['id']}/schedule-proposals", json={"scheduled_at": when(1)})
    assert answer.status_code == 200, answer.text
    stored = await flow.reload(match)
    assert timedelta(hours=23) < datetime.fromisoformat(stored["schedule_deadline_at"]) - now_utc() <= timedelta(hours=24)

    fixed = (now_utc() + timedelta(days=9)).replace(microsecond=0).isoformat()
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"settings": {"schedule_deadline_at": fixed}}})
    second = await flow.post(f"/api/matches/{match['id']}/schedule-proposals", json={"scheduled_at": when(2)})
    assert second.status_code == 200, second.text
    assert (await flow.reload(match))["schedule_deadline_at"] == fixed
