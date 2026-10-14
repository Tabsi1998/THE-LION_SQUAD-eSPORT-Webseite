"""Planen mit Vorschau, Übernehmen auf einmal (#1552) - durch die echten Routen.

Vor Ort: der Planer schreibt Zeit und Station zusammen, mit Quelle. Online: keine Stationen, keine
Stations-Warnungen, der Spieltag-Lauf schreibt Wiener Zeit. Eine lokale Ein-Tages-Gruppenphase lässt der Lauf
in Ruhe. Antwortfrist und Eskalation laufen über das Turnier.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import TournamentCreate, new_id, now_utc  # noqa: E402
from services.matchday_schedule import persist_all_matchday_schedules  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def stations(flow, tournament, *names):
    docs = []
    for name in names:
        doc = {"id": new_id(), "name": name, "device_type": "switch2", "tournament_id": tournament["id"], "status": "free",
               "current_match_id": None, "notes": None}
        await flow.db.stations.insert_one(dict(doc))
        docs.append(doc)
    return docs


async def built(flow, count=4, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    status = fields.pop("status", None)
    tournament, users, registrations = await flow.with_participants(count, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    if status == "live":
        await flow.start(tournament)
    return staff, tournament, users, registrations


def on_site_fields(**extra):
    start = (now_utc() + timedelta(hours=1)).replace(microsecond=0)
    return {"event_mode": "local", "schedule_mode": "fixed_by_staff", "result_entry_mode": None, "start_date": start.isoformat(), **extra}


@pytest.mark.asyncio
async def test_planning_shows_a_preview_and_applying_writes_time_and_station_at_once(flow):
    _staff, tournament, _users, _registrations = await built(flow, **on_site_fields())
    first, second = await stations(flow, tournament, "1", "2")

    planned = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")
    assert planned.status_code == 200, planned.text
    plan = planned.json()
    assert plan["mode"] == "stations" and len(plan["assignments"]) == 3 and plan["warnings"] == []
    assert all(not match.get("scheduled_at") and not match.get("station_id") for match in await flow.matches(tournament)), \
        "die Vorschau schreibt nichts"

    applied = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply", json={"fingerprint": plan["fingerprint"]})
    assert applied.status_code == 200, applied.text
    assert applied.json()["written"] == 3
    matches = {match["match_key"]: match for match in await flow.matches(tournament)}
    first_round = [match for match in matches.values() if match["round"] == 1]
    final = next(match for match in matches.values() if match["round"] == 2)
    assert {match["station_id"] for match in first_round} == {first["id"], second["id"]}
    assert all(match["schedule_source"] == "planner" and match["status"] == "scheduled" for match in first_round)
    assert final["schedule_source"] == "planner" and final["schedule_forecast"] is True and final["status"] == "pending"
    assert final["scheduled_at"] > first_round[0]["scheduled_at"]

    check = await flow.get(f"/api/tournaments/{tournament['id']}/planning-check")
    assert check.status_code == 200
    assert [item for item in check.json()["errors"] if item["type"] == "station_overlap"] == []


@pytest.mark.asyncio
async def test_an_outdated_preview_is_refused_instead_of_applied(flow):
    _staff, tournament, _users, _registrations = await built(flow, **on_site_fields())
    await stations(flow, tournament, "1")
    stale = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply", json={"fingerprint": "veraltet"})
    assert stale.status_code == 409, stale.text
    assert "Planen" in stale.json()["detail"]


@pytest.mark.asyncio
async def test_a_time_set_by_hand_stays_through_apply(flow):
    _staff, tournament, _users, _registrations = await built(flow, **on_site_fields())
    station, _other = await stations(flow, tournament, "1", "2")
    match = sorted(await flow.matches(tournament), key=lambda row: (row["round"], row["match_key"]))[0]
    fixed = (now_utc() + timedelta(hours=2)).replace(microsecond=0)
    updated = await flow.put(f"/api/matches/{match['id']}", json={"scheduled_at": fixed.isoformat(), "station_id": station["id"]})
    assert updated.status_code == 200, updated.text

    applied = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply", json={})
    assert applied.status_code == 200, applied.text
    kept = await flow.reload(match)
    assert kept["schedule_source"] == "manual" and kept["scheduled_at"] == fixed.isoformat() and kept["station_id"] == station["id"]


@pytest.mark.asyncio
async def test_an_online_tournament_gets_no_stations_and_no_station_warnings(flow):
    _staff, tournament, _users, _registrations = await built(flow, event_mode="online", schedule_mode="player_proposal",
                                                             start_date=now_utc().isoformat())
    await stations(flow, tournament, "1")

    planned = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")
    assert planned.status_code == 200, planned.text
    assert planned.json()["mode"] == "none" and planned.json()["assignments"] == []

    legacy = await flow.post(f"/api/stations/auto-assign?tournament_id={tournament['id']}&plan=true")
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["assigned"] == 0
    assert all(not match.get("station_id") for match in await flow.matches(tournament))

    check = await flow.get(f"/api/tournaments/{tournament['id']}/planning-check")
    assert check.status_code == 200
    assert [item for item in check.json()["warnings"] if item["type"] == "missing_station"] == []


@pytest.mark.asyncio
async def test_the_matchday_run_leaves_a_local_one_day_group_phase_alone(flow):
    _staff, tournament, _users, _registrations = await built(flow, format="groups", status="live", **on_site_fields())
    assert any(match.get("round") for match in await flow.matches(tournament))
    assert (await persist_all_matchday_schedules(flow.db)) == {"tournaments": 1, "written": 0}


@pytest.mark.asyncio
async def test_the_matchday_run_writes_vienna_time_for_an_online_league(flow):
    start = (now_utc() - timedelta(days=1)).replace(microsecond=0)
    _staff, tournament, _users, _registrations = await built(flow, format="league", status="live", event_mode="online",
                                                             schedule_mode="player_proposal", start_date=start.isoformat())
    assert (await persist_all_matchday_schedules(flow.db))["written"] > 0
    from zoneinfo import ZoneInfo
    for match in await flow.matches(tournament):
        if not match.get("scheduled_at"):
            continue
        from datetime import datetime
        local = datetime.fromisoformat(match["scheduled_at"]).astimezone(ZoneInfo("Europe/Vienna"))
        assert local.strftime("%a %H:%M") == "Sun 20:00", match["scheduled_at"]


def test_the_response_time_is_part_of_the_tournament():
    assert TournamentCreate(title="Liga", game_id="g").match_schedule_response_hours == 72
    assert TournamentCreate(title="Liga", game_id="g", match_schedule_response_hours=24).match_schedule_response_hours == 24
    assert TournamentCreate(title="Cup", game_id="g").match_break_minutes == 5


@pytest.mark.asyncio
async def test_the_response_time_of_the_tournament_sets_the_deadline_and_runs_out_to_the_staff(flow):
    start = (now_utc() - timedelta(days=1)).replace(microsecond=0)
    staff, tournament, users, registrations = await built(flow, count=2, format="league", status="live", event_mode="online",
                                                          schedule_mode="player_proposal", start_date=start.isoformat(),
                                                          match_schedule_response_hours=24)
    match = sorted(await flow.matches(tournament), key=lambda row: row["round"])[0]
    home = next(user for user, reg in zip(users, registrations) if reg["id"] == match["slots"][0]["registration_id"])
    flow.act_as(home)
    proposed = await flow.post(f"/api/matches/{match['id']}/schedule-proposals", json={"scheduled_at": (start + timedelta(days=2)).isoformat()})
    assert proposed.status_code == 200, proposed.text
    stored = await flow.reload(match)
    from datetime import datetime
    deadline = datetime.fromisoformat(stored["schedule_deadline_at"])
    assert timedelta(hours=23) < deadline - now_utc() <= timedelta(hours=24)

    # Die Frist läuft ab: der Lauf eskaliert an die Turnierleitung - einmal.
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"schedule_deadline_at": (now_utc() - timedelta(minutes=1)).isoformat()}})
    await persist_all_matchday_schedules(flow.db)
    escalated = await flow.reload(match)
    assert escalated["schedule_status"] == "escalated" and escalated.get("schedule_escalated_at")
    notes = await flow.db.notifications.find({"kind": "schedule_escalation"}, {"_id": 0}).to_list(20)
    assert {note["user_id"] for note in notes} == {staff["id"]}
    await persist_all_matchday_schedules(flow.db)
    assert len(await flow.db.notifications.find({"kind": "schedule_escalation"}, {"_id": 0}).to_list(20)) == len(notes)
