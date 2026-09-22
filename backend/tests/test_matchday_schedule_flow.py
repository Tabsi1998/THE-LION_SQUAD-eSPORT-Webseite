"""Geltenden Termin in die Partie schreiben (#235): Standardzeit vom Lauf, Heimrecht nach Vorschlag,
„vereinbart“ nach Annahme - und ein von Hand gesetzter Termin bleibt, wie er ist."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services.matchday_schedule import persist_all_matchday_schedules, persist_matchday_schedule  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def league(flow, *, start: datetime):
    tournament = {"id": "t1", "slug": "liga", "title": "Liga", "format": "league", "status": "live", "is_public": True, "visibility": "public",
                  "start_date": start.isoformat(), "schedule_mode": "player_proposal", "match_schedule_response_hours": 48,
                  "created_at": now_utc().isoformat()}
    await flow.db.tournaments.insert_one(tournament)
    return tournament


async def player_with_registration(flow, name, reg_id):
    user = await flow.add_user(role="player", name=name)
    await flow.db.tournament_registrations.insert_one({"id": reg_id, "tournament_id": "t1", "user_id": user["id"], "status": "approved", "display_name": name})
    return user


@pytest.mark.asyncio
async def test_default_then_home_then_agreed_are_written_with_their_source(flow):
    start = (now_utc() - timedelta(days=1)).replace(microsecond=0)
    await league(flow, start=start)
    home = await player_with_registration(flow, "heim", "reg-home")
    away = await player_with_registration(flow, "gast", "reg-away")
    await flow.db.matches_v2.insert_one({"id": "m1", "tournament_id": "t1", "matchday_number": 1, "round": 1, "status": "pending", "match_type": "duel",
                                          "slots": [{"slot": 1, "registration_id": "reg-home"}, {"slot": 2, "registration_id": "reg-away"}], "created_at": now_utc().isoformat()})

    # Niemand hat etwas vorgeschlagen: der Lauf schreibt die Standardzeit - Erinnerungen können sie jetzt lesen.
    assert (await persist_all_matchday_schedules(flow.db)) == {"tournaments": 1, "written": 1}
    match = await flow.db.matches_v2.find_one({"id": "m1"}, {"_id": 0})
    assert match["schedule_source"] == "default" and match["status"] == "scheduled" and match["scheduled_at"]
    assert (await persist_all_matchday_schedules(flow.db))["written"] == 0, "zweiter Lauf schreibt nichts"

    # Die Heimseite schlägt vor: Heimrecht gilt, bis jemand etwas anderes annimmt.
    home_time = (start + timedelta(days=2)).replace(hour=19, minute=0)
    flow.act_as(home)
    proposed = await flow.post("/api/matches/m1/schedule-proposals", json={"scheduled_at": home_time.isoformat()})
    assert proposed.status_code == 200, proposed.text
    await persist_matchday_schedule(flow.db, await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0}))
    match = await flow.db.matches_v2.find_one({"id": "m1"}, {"_id": 0})
    assert match["schedule_source"] == "home" and match["scheduled_at"] == home_time.isoformat()

    # Der Gast nimmt an: vereinbart - sofort in der Partie, nicht erst beim nächsten Lauf.
    flow.act_as(away)
    decided = await flow.post(f"/api/matches/m1/schedule-proposals/{proposed.json()['id']}/decision", json={"action": "accept"})
    assert decided.status_code == 200, decided.text
    match = await flow.db.matches_v2.find_one({"id": "m1"}, {"_id": 0})
    assert match["schedule_source"] == "accepted" and match["scheduled_at"] == home_time.isoformat()
    assert (await persist_all_matchday_schedules(flow.db))["written"] == 0


@pytest.mark.asyncio
async def test_a_time_set_by_staff_survives_the_run(flow):
    start = (now_utc() - timedelta(days=1)).replace(microsecond=0)
    await league(flow, start=start)
    await player_with_registration(flow, "heim", "reg-home")
    await player_with_registration(flow, "gast", "reg-away")
    await flow.db.matches_v2.insert_one({"id": "m1", "tournament_id": "t1", "matchday_number": 1, "round": 1, "status": "pending", "match_type": "duel",
                                          "slots": [{"slot": 1, "registration_id": "reg-home"}, {"slot": 2, "registration_id": "reg-away"}], "created_at": now_utc().isoformat()})
    staff = await flow.add_user(role="tournament_admin", name="tl")
    flow.act_as(staff)
    manual_time = (start + timedelta(days=3)).replace(hour=17, minute=30, tzinfo=timezone.utc)
    updated = await flow.put("/api/matches/m1", json={"scheduled_at": manual_time.isoformat()})
    assert updated.status_code == 200, updated.text
    assert updated.json()["schedule_source"] == "manual"

    assert (await persist_all_matchday_schedules(flow.db))["written"] == 0, "von Hand gesetzt bleibt"
    match = await flow.db.matches_v2.find_one({"id": "m1"}, {"_id": 0})
    assert match["scheduled_at"] == manual_time.isoformat() and match["schedule_source"] == "manual"

    # Termin leeren: die Regel gilt wieder, der Lauf schreibt die Standardzeit.
    assert (await flow.put("/api/matches/m1", json={"scheduled_at": None})).status_code == 200
    assert (await persist_all_matchday_schedules(flow.db))["written"] == 1
    assert (await flow.db.matches_v2.find_one({"id": "m1"}, {"_id": 0}))["schedule_source"] == "default"
