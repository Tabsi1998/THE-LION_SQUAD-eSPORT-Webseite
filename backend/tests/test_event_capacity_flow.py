"""Plätze eines Events über alle Anmeldewege (#1037): Website, App, Discord und Zugangslink laufen durch
``event_registration.register``, die Turnierleitung über die Bearbeitung einer Anmeldung (Nachrücken, Check-in,
Begleitpersonen). Gezählt wird in Plätzen - die Person plus ihre Begleitpersonen.

Kommen zwei Anmeldungen im selben Moment, darf die Rechnung „ist noch Platz?“ nicht für beide den alten Stand
sehen: Die Tests lassen beide Anfragen nach dem Zählen aufeinander warten, so wie mehrere Worker auf echtem
MongoDB. Ohne Platzsperre würden beide den letzten Platz bekommen."""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import event_registration  # noqa: E402

ACTIVE = {"registered", "checked_in"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    # Wie database.py beim Start: eine Sperre je Ressource.
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def counting_meets_after_summary(monkeypatch, parties: int = 2, timeout: float = 0.3):
    """Die ersten ``parties`` Platzrechnungen warten nach dem Zählen aufeinander - erst dann schreibt eine.

    ``InterleavedReads`` hält nur ``find_one`` an; gezählt wird hier über ``find(...).to_list``. Wer die Rechnung
    unter einer Sperre macht, wartet hier höchstens ``timeout`` und kommt dann einzeln durch."""
    barrier = asyncio.Barrier(parties)
    original = event_registration.summary
    state = {"gated": 0}

    async def gated(*args, **kwargs):
        result = await original(*args, **kwargs)
        if state["gated"] < parties:
            state["gated"] += 1
            try:
                await asyncio.wait_for(barrier.wait(), timeout)
            except (asyncio.TimeoutError, asyncio.BrokenBarrierError):
                pass
        return result

    monkeypatch.setattr(event_registration, "summary", gated)


async def create_event(flow, **extra) -> dict:
    boss = await flow.add_user(role="superadmin", name="chefin")
    flow.act_as(boss)
    payload = {"name": "Herbst-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
               "start_date": (now_utc() + timedelta(days=10)).isoformat(), "location": "Vereinsheim", **extra}
    response = await flow.post("/api/events", json=payload)
    assert response.status_code == 200, response.text
    event = await flow.db.events.find_one({"id": response.json()["id"]}, {"_id": 0})
    return event, boss


async def active_seats(flow, event) -> int:
    regs = await flow.db.event_registrations.find({"event_id": event["id"]}, {"_id": 0}).to_list(100)
    return sum(event_registration.seats(r) for r in regs if r.get("status") in ACTIVE)


@pytest.mark.asyncio
async def test_two_people_at_the_same_moment_get_the_last_seat_only_once(flow, monkeypatch):
    event, _boss = await create_event(flow, max_participants=1)
    paula = await flow.add_user(role="player", name="paula")
    otto = await flow.add_user(role="player", name="otto")
    counting_meets_after_summary(monkeypatch)

    first, second = await asyncio.gather(
        event_registration.register(flow.db, event, paula, via="web"),
        event_registration.register(flow.db, event, otto, via="discord"),
    )

    assert sorted([first["status"], second["status"]]) == ["registered", "waitlist"]
    assert await active_seats(flow, event) == 1


@pytest.mark.asyncio
async def test_companions_count_as_seats_also_at_the_same_moment(flow, monkeypatch):
    event, _boss = await create_event(flow, max_participants=3, allow_companions=True, max_companions_per_registration=2)
    paula = await flow.add_user(role="player", name="paula")
    otto = await flow.add_user(role="player", name="otto")
    counting_meets_after_summary(monkeypatch)

    first, second = await asyncio.gather(
        event_registration.register(flow.db, event, paula, companion_count=1, via="web"),
        event_registration.register(flow.db, event, otto, companion_count=1, via="web"),
    )

    assert sorted([first["status"], second["status"]]) == ["registered", "waitlist"]
    assert await active_seats(flow, event) == 2


@pytest.mark.asyncio
async def test_moving_up_from_the_waitlist_and_a_new_registration_do_not_share_one_seat(flow, monkeypatch):
    event, boss = await create_event(flow, max_participants=1)
    bert = await flow.add_user(role="player", name="bert")
    anna = await flow.add_user(role="player", name="anna")
    cleo = await flow.add_user(role="player", name="cleo")
    assert (await event_registration.register(flow.db, event, bert))["status"] == "registered"
    waiting = await event_registration.register(flow.db, event, anna)
    assert waiting["status"] == "waitlist"
    await event_registration.cancel(flow.db, event, bert)

    # Die Turnierleitung holt Anna von der Warteliste, während sich Cleo anmeldet.
    counting_meets_after_summary(monkeypatch)
    flow.act_as(boss)
    promoted, fresh = await asyncio.gather(
        flow.client.patch(f"/api/events/{event['id']}/registrations/{waiting['id']}", json={"status": "registered"}),
        event_registration.register(flow.db, event, cleo, via="web"),
    )

    assert await active_seats(flow, event) == 1
    if promoted.status_code == 200:
        assert fresh["status"] == "waitlist"
    else:
        assert promoted.status_code == 400 and "Kapazität" in promoted.text
        assert fresh["status"] == "registered"


@pytest.mark.asyncio
async def test_without_a_limit_both_get_in_and_the_order_stays_untouched(flow, monkeypatch):
    event, _boss = await create_event(flow)
    paula = await flow.add_user(role="player", name="paula")
    otto = await flow.add_user(role="player", name="otto")
    counting_meets_after_summary(monkeypatch)

    first, second = await asyncio.gather(
        event_registration.register(flow.db, event, paula),
        event_registration.register(flow.db, event, otto),
    )

    assert first["status"] == second["status"] == "registered"
    assert await flow.db.mutation_locks.count_documents({}) == 0, "die Platzsperre bleibt nicht liegen"
