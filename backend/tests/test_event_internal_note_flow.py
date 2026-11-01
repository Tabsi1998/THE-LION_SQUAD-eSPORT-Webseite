"""Die interne Notiz der Turnierleitung (#2127): Wer sie nicht sehen soll, bekommt sie auf keinem Weg - auch nicht nach
Storno und Neuanmeldung oder mit dem Bereich Vereinsverwaltung. Namen sind erfunden."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow, **extra):
    lead = await flow.add_user(role="tournament_admin", name="leitung")
    flow.act_as(lead)
    response = await flow.post("/api/events", json={"name": "Herbst-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
                                                    "show_participants": True, "start_date": (now_utc() + timedelta(days=3)).isoformat(), **extra})
    assert response.status_code == 200, response.text
    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    registration = (await flow.post(f"/api/events/{response.json()['id']}/registrations", json={"companion_count": 0})).json()
    flow.act_as(lead)
    return lead, response.json(), player, registration


@pytest.mark.asyncio
async def test_neuanmeldung_nach_storno_zeigt_die_notiz_nicht(flow):
    _lead, event, player, first = await setup(flow)
    written = await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"internal_note": "nur intern", "status": "cancelled"})
    assert written.status_code == 200, written.text

    flow.act_as(player)
    again = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})
    assert again.status_code == 200, again.text
    body = again.json()
    assert "internal_note" not in body and body["status"] == "registered" and body["can_cancel"] is True
    assert "nur intern" not in again.text
    # Die Notiz selbst bleibt für die Leitung.
    stored = await flow.db.event_registrations.find_one({"id": first["id"]}, {"_id": 0})
    assert stored["internal_note"] == "nur intern"
