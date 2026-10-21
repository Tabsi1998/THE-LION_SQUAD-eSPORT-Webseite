"""Wirksame Check-in-Zeiten (#1938): „Check-in starten“ vor der eingestellten Zeit setzt „Check-in öffnet“ auf jetzt,
ein früheres Ende (Turnier starten) setzt „Check-in endet“ auf den Zeitpunkt des Endes. Turnierseite, „Dein Stand“, TV
und App lesen damit, was wirklich galt - nicht „Check-in öffnet 10:56“ unter einem Cup, der schon läuft.
"""
import pathlib
import sys
from datetime import datetime, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import scheduler  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def at(minutes: float) -> str:
    return (now_utc() + timedelta(minutes=minutes)).isoformat()


def parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def near_now(value: str, seconds: int = 30) -> bool:
    return abs((parse(value) - now_utc()).total_seconds()) <= seconds


async def cup(flow, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(max_participants=4, status="registration_closed", event_mode="local", **fields)
    for index in range(4):
        user = await flow.add_user(name=f"Spieler {index + 1}")
        await flow.register(tournament, user, seed=index + 1, status="checked_in")
    return tournament


async def set_status(flow, tournament, status: str):
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": status, "force": True})
    assert response.status_code == 200, response.text
    return await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_starting_the_check_in_early_moves_its_begin_to_now(flow):
    planned_until = at(20)
    tournament = await cup(flow, check_in_from=at(8), check_in_until=planned_until, start_date=at(30))
    stored = await set_status(flow, tournament, "check_in")
    assert stored["status"] == "check_in"
    assert near_now(stored["check_in_from"]), "der Check-in läuft ab jetzt, nicht erst zur geplanten Zeit"
    assert stored["check_in_until"] == planned_until, "das geplante Ende bleibt"


@pytest.mark.asyncio
async def test_starting_the_check_in_without_a_time_records_its_begin(flow):
    tournament = await cup(flow, start_date=at(30))
    stored = await set_status(flow, tournament, "check_in")
    assert near_now(stored["check_in_from"])


@pytest.mark.asyncio
async def test_starting_the_check_in_on_time_keeps_the_planned_begin(flow):
    planned_from = at(-5)
    tournament = await cup(flow, check_in_from=planned_from, check_in_until=at(20), start_date=at(30))
    stored = await set_status(flow, tournament, "check_in")
    assert stored["check_in_from"] == planned_from


@pytest.mark.asyncio
async def test_starting_the_tournament_ends_the_check_in_now(flow):
    tournament = await cup(flow, check_in_from=at(-10), check_in_until=at(15), start_date=at(30))
    await set_status(flow, tournament, "check_in")
    stored = await set_status(flow, tournament, "live")
    assert stored["status"] == "live" and stored.get("check_in_closed_at")
    assert stored["check_in_until"] == stored["check_in_closed_at"], "das Check-in-Ende ist, wann es wirklich endete"
    assert near_now(stored["check_in_until"])


@pytest.mark.asyncio
async def test_the_planned_end_stays_when_the_check_in_ends_on_time(flow):
    tournament = await cup(flow, check_in_from=at(-30), check_in_until=at(20), start_date=at(60))
    await set_status(flow, tournament, "check_in")
    passed = at(-1)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"check_in_until": passed}})
    await scheduler._safe_status_transitions()
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert stored.get("check_in_closed_at") and stored["status"] == "check_in"
    assert stored["check_in_until"] == passed, "endet der Check-in zur geplanten Zeit, bleibt sie stehen"


@pytest.mark.asyncio
async def test_the_automatic_start_ends_an_open_check_in_in_one_run(flow):
    tournament = await cup(flow, check_in_from=at(-30), check_in_until=at(20), start_date=at(60), auto_start_enabled=True)
    await set_status(flow, tournament, "check_in")
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"start_date": at(-1)}})
    await scheduler._safe_status_transitions()
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert stored["status"] == "live", "der automatische Start klappt im selben Lauf"
    assert stored["check_in_until"] == stored["check_in_closed_at"]
