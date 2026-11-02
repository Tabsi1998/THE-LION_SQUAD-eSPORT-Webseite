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


# ---------------------------------------------------------------- D-9

async def status_of(flow, world) -> dict:
    return await flow.reload(world["match"])


@pytest.mark.asyncio
async def test_a_decline_keeps_the_default_time_and_does_not_escalate(flow):
    world = await live_world(flow)
    first = await propose(flow, world, "Kapitaen")
    await decide(flow, world, "Falke1", first, action="decline")
    stored = await status_of(flow, world)
    assert stored.get("schedule_status") is None, "es gilt der Standardtermin - nicht „abgelehnt“"
    assert stored.get("schedule_deadline_at") is None
    assert stored["schedule_source"] == "default" and stored["scheduled_at"]
    await persist_all_matchday_schedules(flow.db)
    assert await escalations(flow) == []
    flow.act_as(world["users"]["Falke1"])
    page = (await flow.get(f"/api/matches/{world['match']['id']}/page")).json()
    assert page["match"].get("schedule_status") is None


@pytest.mark.asyncio
async def test_a_decline_keeps_the_agreed_time(flow):
    world = await live_world(flow)
    first = await propose(flow, world, "Kapitaen")
    accepted = await decide(flow, world, "Falke1", first, action="accept")
    second = await propose(flow, world, "Falke1", 3)
    await decide(flow, world, "Kapitaen", second, action="decline")
    stored = await status_of(flow, world)
    assert stored["schedule_status"] == "accepted" and stored.get("schedule_deadline_at") is None
    assert stored["scheduled_at"] == accepted["scheduled_at"]
    await persist_all_matchday_schedules(flow.db)
    assert await escalations(flow) == []


@pytest.mark.asyncio
async def test_a_decline_with_another_open_proposal_stays_open(flow):
    world = await live_world(flow)
    first = await propose(flow, world, "Kapitaen")
    await propose(flow, world, "Falke1", 3)
    deadline = (await status_of(flow, world))["schedule_deadline_at"]
    await decide(flow, world, "Falke1", first, action="decline")
    stored = await status_of(flow, world)
    assert stored["schedule_status"] == "proposed" and stored["schedule_deadline_at"] == deadline


@pytest.mark.asyncio
async def test_a_decline_without_any_time_stays_declined_and_runs_out_to_the_lead(flow):
    """Woche von einem Tag, die den Standardtag nicht enthält: Hier fehlt wirklich ein Termin."""
    world = await live_world(flow, matchday_days=1)
    tournament = await flow.db.tournaments.find_one({"id": world["tournament"]["id"]}, {"_id": 0})
    start = datetime.fromisoformat(tournament["start_date"])
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"default_match_weekday": (start.weekday() + 3) % 7}})
    first = await propose(flow, world, "Kapitaen")
    await decide(flow, world, "Falke1", first, action="decline")
    stored = await status_of(flow, world)
    assert stored["schedule_status"] == "declined" and stored["schedule_deadline_at"] and not stored.get("scheduled_at")
    await expire(flow, world)
    await persist_all_matchday_schedules(flow.db)
    assert (await status_of(flow, world))["schedule_status"] == "escalated"
    notes = await escalations(flow)
    assert notes and "Bitte einen Termin festlegen" in notes[0]["body"]


@pytest.mark.asyncio
@pytest.mark.parametrize("old_status", ["declined", "escalated"])
async def test_old_declined_matches_with_a_time_are_settled_by_the_job(flow, old_status):
    """Altbestand: abgelehnt mit stehen gebliebener Frist, obwohl ein Termin gilt - keine Nachricht, kein „abgelehnt“."""
    world = await live_world(flow)
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {
        "schedule_status": old_status, "schedule_deadline_at": (now_utc() - timedelta(hours=3)).isoformat(),
        "scheduled_at": when(1), "schedule_source": "default", "status": "scheduled"}})
    await persist_all_matchday_schedules(flow.db)
    stored = await status_of(flow, world)
    assert stored.get("schedule_status") is None and stored.get("schedule_deadline_at") is None
    assert await escalations(flow) == []


@pytest.mark.asyncio
async def test_an_open_proposal_past_its_deadline_still_escalates(flow):
    """Regression: Ein unbeantworteter Vorschlag meldet sich weiter bei der Leitung."""
    world = await live_world(flow)
    await propose(flow, world, "Kapitaen")
    await expire(flow, world)
    await persist_all_matchday_schedules(flow.db)
    assert (await status_of(flow, world))["schedule_status"] == "escalated"
    assert await escalations(flow)


@pytest.mark.asyncio
async def test_a_cup_stays_declined(flow):
    """Regression: Ein Pokal hat keinen Standardtermin, die Ablehnung bleibt sichtbar und die Frist stehen."""
    match, home, away = await online_cup(flow)
    flow.act_as(home)
    proposal = (await flow.post(f"/api/matches/{match['id']}/schedule-proposals", json={"scheduled_at": when(1)})).json()
    deadline = (await flow.reload(match))["schedule_deadline_at"]
    flow.act_as(away)
    answer = await flow.post(f"/api/matches/{match['id']}/schedule-proposals/{proposal['id']}/decision", json={"action": "decline"})
    assert answer.status_code == 200, answer.text
    stored = await flow.reload(match)
    assert stored["schedule_status"] == "declined" and stored["schedule_deadline_at"] == deadline
