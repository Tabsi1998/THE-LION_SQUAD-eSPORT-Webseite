"""Event-Anmeldung zurückziehen (#1223): nur bis zum Beginn des Events und nicht nach dem Check-in. Die Event-Antwort sagt
es mit ``own_registration.can_cancel``, und der Dienst prüft es beim Stornieren selbst - für Website, App und Discord
dieselbe Regel. Wer zu spät storniert, bekommt einen Satz; Anmeldung und Rechnungsauftrag bleiben unverändert."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_registration, event_registration  # noqa: E402

DISCORD_ID = "300000000000000011"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup_event(flow, **extra):
    boss = await flow.add_user(role="superadmin", name="chefin")
    flow.act_as(boss)
    payload = {"name": "Herbst-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
               "start_date": (now_utc() + timedelta(days=10)).isoformat(), "location": "Vereinsheim", **extra}
    response = await flow.post("/api/events", json=payload)
    assert response.status_code == 200, response.text
    event = response.json()
    paula = await flow.add_user(role="player", name="paula")
    await flow.db.platform_links.insert_one({"id": "l-paula", "user_id": paula["id"], "platform": "discord", "external_id": DISCORD_ID, "handle": "paula"})
    flow.act_as(paula)
    registered = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})
    assert registered.status_code == 200, registered.text
    return event, paula


async def own(flow, event):
    response = await flow.get(f"/api/events/{event['slug']}")
    assert response.status_code == 200, response.text
    return response.json()["own_registration"]


async def move_start(flow, event, delta):
    await flow.db.events.update_one({"id": event["id"]}, {"$set": {"start_date": (now_utc() + delta).isoformat()}})


def test_rule_before_and_after_start_check_in_and_waitlist():
    event = {"status": "registration_open", "start_date": "2026-11-14T08:00:00+00:00"}
    before = "2026-11-14T07:59:00+00:00"
    after = "2026-11-14T08:00:00+00:00"
    assert event_registration.can_cancel(event, {"status": "registered"}, now=before)
    assert not event_registration.can_cancel(event, {"status": "registered"}, now=after)
    assert event_registration.can_cancel(event, {"status": "waitlist"}, now=before)
    assert not event_registration.can_cancel(event, {"status": "waitlist"}, now=after)
    assert not event_registration.can_cancel(event, {"status": "checked_in"}, now=before)
    assert not event_registration.can_cancel(event, {"status": "cancelled"}, now=before)
    assert not event_registration.can_cancel(event, None, now=before)
    assert not event_registration.can_cancel({**event, "status": "completed"}, {"status": "registered"}, now=before)
    assert "eingecheckt" in event_registration.cancel_block_reason(event, {"status": "checked_in"}, now=before)
    assert "begonnen" in event_registration.cancel_block_reason(event, {"status": "registered"}, now=after)
    # Ohne Beginn gilt nur der Status.
    assert event_registration.can_cancel({"status": "registration_open"}, {"status": "registered"}, now=after)


@pytest.mark.asyncio
async def test_before_the_start_the_page_offers_it_and_cancelling_works(flow):
    event, _paula = await setup_event(flow)
    assert (await own(flow, event))["can_cancel"] is True
    response = await flow.delete(f"/api/events/{event['id']}/registrations/me")
    assert response.status_code == 200, response.text
    stored = await flow.db.event_registrations.find_one({"event_id": event["id"]}, {"_id": 0})
    assert stored["status"] == "cancelled"


@pytest.mark.asyncio
async def test_after_the_start_the_server_refuses_and_nothing_changes(flow):
    event, _paula = await setup_event(flow)
    await move_start(flow, event, -timedelta(hours=1))
    assert (await own(flow, event))["can_cancel"] is False
    response = await flow.delete(f"/api/events/{event['id']}/registrations/me")
    assert response.status_code == 409
    assert "begonnen" in response.json()["detail"]
    stored = await flow.db.event_registrations.find_one({"event_id": event["id"]}, {"_id": 0})
    assert stored["status"] == "registered"
    assert not await flow.db.audit_logs.find_one({"action": "event.registration.cancel"})


@pytest.mark.asyncio
async def test_after_check_in_the_server_refuses(flow):
    event, _paula = await setup_event(flow)
    await flow.db.event_registrations.update_one({"event_id": event["id"]}, {"$set": {"status": "checked_in"}})
    assert (await own(flow, event))["can_cancel"] is False
    response = await flow.delete(f"/api/events/{event['id']}/registrations/me")
    assert response.status_code == 409
    assert "eingecheckt" in response.json()["detail"]
    stored = await flow.db.event_registrations.find_one({"event_id": event["id"]}, {"_id": 0})
    assert stored["status"] == "checked_in"


@pytest.mark.asyncio
async def test_waitlist_can_withdraw_before_the_start(flow):
    event, _paula = await setup_event(flow, max_participants=1)
    other = await flow.add_user(role="player", name="otto")
    flow.act_as(other)
    waiting = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})
    assert waiting.status_code == 200, waiting.text
    assert waiting.json()["status"] == "waitlist"
    assert (await own(flow, event))["can_cancel"] is True
    response = await flow.delete(f"/api/events/{event['id']}/registrations/me")
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_discord_uses_the_same_rule(flow):
    event, _paula = await setup_event(flow)
    await move_start(flow, event, -timedelta(minutes=5))
    asked = await discord_registration.answer_abmelden(flow.db, DISCORD_ID, f"event:{event['id']}")
    assert "begonnen" in (asked.get("content") or "")
    assert not [button for button in asked.get("buttons", []) if button.get("custom_id")]
    clicked = await discord_registration.withdraw(flow.db, DISCORD_ID, "event", event["id"])
    assert "begonnen" in (clicked.get("content") or "")
    assert await discord_registration.own_choices(flow.db, DISCORD_ID) == []
    stored = await flow.db.event_registrations.find_one({"event_id": event["id"]}, {"_id": 0})
    assert stored["status"] == "registered"
