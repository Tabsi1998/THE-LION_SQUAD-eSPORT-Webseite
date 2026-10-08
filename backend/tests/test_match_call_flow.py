"""Aufruf beim Reservieren der Station (#1137).

Entscheidung des Betreibers (07.10.2026): Vor Ort mit fester Zeit reicht der Aufruf beim Reservieren - mit Countdown
aufs Handy und auf den TV, ohne Erinnerung 10 Minuten vorher. Genau eine Nachricht je Reservierung an alle Spieler des
Spiels; noch einmal speichern schickt nichts; die Planung schickt nichts; die Start-Mail sagt „startet jetzt“.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services.match_calls import report_by  # noqa: E402
from services.match_reminder import schedule_match_reminders  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def on_site(flow, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, event_mode="local", schedule_mode="fixed_by_staff",
                                                                     result_entry_mode=None, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    match = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[0]
    station = {"id": new_id(), "name": "3", "device_type": "switch2", "tournament_id": tournament["id"], "status": "free",
               "current_match_id": None, "notes": "Kabel intern"}
    await flow.db.stations.insert_one(dict(station))
    players = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    return staff, tournament, match, station, players


async def calls(flow) -> list[dict]:
    return await flow.db.notifications.find({"kind": "match_call"}, {"_id": 0}).to_list(50)


def test_report_by_matches_the_tv_board():
    called = "2026-10-10T12:00:00+00:00"
    assert report_by({}, called, 2).isoformat() == "2026-10-10T12:02:00+00:00", "ohne Uhrzeit: Zeit zum Antreten ab dem Aufruf"
    assert report_by({"scheduled_at": "2026-10-10T12:10:00+00:00"}, called, 2).isoformat() == "2026-10-10T12:10:00+00:00"
    assert report_by({"scheduled_at": "2026-10-10T11:50:00+00:00"}, called, 5).isoformat() == "2026-10-10T12:05:00+00:00", \
        "lag die Zeit schon vor dem Aufruf (Verspätung), gilt wieder die Zeit zum Antreten"


@pytest.mark.asyncio
async def test_reserving_calls_the_players_once_and_starting_says_now(flow):
    staff, _tournament, match, station, players = await on_site(flow)
    reserved = await flow.post(f"/api/stations/{station['id']}/assign/{match['id']}")
    assert reserved.status_code == 200, reserved.text

    first = await calls(flow)
    expected = {players[slot["registration_id"]]["id"] for slot in match["slots"]}
    assert {row["user_id"] for row in first} == expected
    assert first[0]["title"] == "Du bist dran: Station 3 · Switch 2"
    assert "antreten" in first[0]["body"] and "Kabel intern" not in first[0]["body"], "die Station im Klartext, nie interne Notizen"

    # Dieselbe Reservierung noch einmal speichern: „aufgerufen um“ bleibt - keine zweite Nachricht.
    again = await flow.post(f"/api/stations/{station['id']}/assign/{match['id']}")
    assert again.status_code == 200
    after_repeat = await calls(flow)
    assert len(after_repeat) == len(first)

    # Countdown aufs Handy: die Matchseite hat „antreten bis“ vom Server.
    flow.act_as(players[match["slots"][0]["registration_id"]])
    page = (await flow.get(f"/api/matches/{match['id']}/page")).json()
    assert page["call"]["station_text"] == "Station 3 · Switch 2" and page["call"]["report_by"]

    flow.act_as(staff)
    started = await flow.post(f"/api/stations/{station['id']}/assign/{match['id']}?start_now=true")
    assert started.status_code == 200, started.text
    begun = await flow.db.notifications.find({"kind": "match_station"}, {"_id": 0}).to_list(10)
    assert {row["user_id"] for row in begun} == expected
    mail = await flow.db.mail_jobs.find_one({"template_key": "match_reminder"}, {"_id": 0})
    assert mail["subject"].startswith("Match startet jetzt") and "Dein Match startet jetzt" in mail["html"]
    after_start = await calls(flow)
    assert len(after_start) == len(first), "der Start ist kein zweiter Aufruf"
    flow.act_as(players[match["slots"][0]["registration_id"]])
    page_after = (await flow.get(f"/api/matches/{match['id']}/page")).json()
    assert page_after["call"] is None, "gestartet: der Aufruf ist vorbei"


@pytest.mark.asyncio
async def test_planning_sends_nothing_and_on_site_fixed_times_get_no_ten_minute_reminder(flow):
    _staff, tournament, match, _station, _players = await on_site(flow, start_date=(now_utc() + timedelta(minutes=10)).isoformat())
    planned = await flow.post(f"/api/stations/auto-assign?tournament_id={tournament['id']}&plan=true")
    assert planned.status_code == 200, planned.text
    assert planned.json()["planned"] is True
    after_plan = await calls(flow)
    assert after_plan == [], "ein Plan ist kein Aufruf"

    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": (now_utc() + timedelta(minutes=10)).isoformat()}})
    result = await schedule_match_reminders()
    assert result["notifications"] == 0 and result["actual_start_only"] >= 1, "vor Ort mit fester Zeit: der Aufruf ersetzt die Erinnerung"
