"""Nebenwirkungen, die scheitern, halten die Kernaktion nicht auf - werden aber geloggt (#934).

Vorher verschluckten `except Exception: pass` den Fehler: Aufruf an die Station, „Turnier beendet“ und die XP für eine
Chatnachricht gingen verloren, ohne dass es im Log stand. Die Kernaktion (Reservierung, Statuswechsel, Nachricht)
bleibt erfolgreich; der Fehler steht als Warnung im Log, ohne Inhalte der Nachricht.
"""
import logging
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


class Broken(RuntimeError):
    pass


async def broken(*_args, **_kwargs):
    raise Broken("vertraulich")


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def warnings_about(caplog, text: str) -> list[logging.LogRecord]:
    return [record for record in caplog.records if record.levelno == logging.WARNING and text in record.getMessage()]


@pytest.mark.asyncio
async def test_reservation_succeeds_when_the_call_fails_and_the_failure_is_logged(flow, monkeypatch, caplog):
    from routes import station_routes

    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _registrations = await flow.with_participants(4, event_mode="local", schedule_mode="fixed_by_staff",
                                                                      result_entry_mode=None)
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")).status_code == 200
    await flow.start(tournament)
    match = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[0]
    station = {"id": new_id(), "name": "3", "device_type": "switch2", "tournament_id": tournament["id"], "status": "free",
               "current_match_id": None}
    await flow.db.stations.insert_one(dict(station))

    monkeypatch.setattr(station_routes, "notify_match_called", broken)
    caplog.set_level(logging.WARNING)
    reserved = await flow.post(f"/api/stations/{station['id']}/assign/{match['id']}")

    assert reserved.status_code == 200, reserved.text
    logged = warnings_about(caplog, "Aufruf für Match")
    assert logged and match["id"] in logged[0].getMessage() and "Broken" in logged[0].getMessage()
    assert "vertraulich" not in caplog.text, "nur die Fehlerart, kein Fehlertext"


@pytest.mark.asyncio
async def test_finishing_a_tournament_succeeds_when_the_notice_fails_and_the_failure_is_logged(flow, monkeypatch, caplog):
    from services import registration_notifications

    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _registrations = await flow.with_participants(2)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "live"}})

    monkeypatch.setattr(registration_notifications, "notify_tournament_finished", broken)
    caplog.set_level(logging.WARNING)
    done = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "completed"})

    assert done.status_code == 200, done.text
    assert (await flow.db.tournaments.find_one({"id": tournament["id"]}))["status"] == "completed"
    logged = warnings_about(caplog, "Turnier beendet")
    assert logged and tournament["id"] in logged[0].getMessage() and "Broken" in logged[0].getMessage()


@pytest.mark.asyncio
async def test_a_direct_message_is_sent_when_xp_fails_and_the_failure_is_logged(flow, monkeypatch, caplog):
    from services import xp

    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    monkeypatch.setattr(xp, "grant", broken)
    caplog.set_level(logging.WARNING)
    flow.act_as(bob)
    sent = await flow.post(f"/api/messages/direct/{alice['id']}", json={"message": "Geheimer Text"})

    assert sent.status_code == 200, sent.text
    logged = warnings_about(caplog, "community_chat")
    assert logged and sent.json()["id"] in logged[0].getMessage()
    assert "Geheimer Text" not in caplog.text and "vertraulich" not in caplog.text
