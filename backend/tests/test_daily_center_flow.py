"""Tageszentrale (#227): die neuen Zähler und „Termine heute“ als Liste - nach Vereinstag, nicht UTC."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services.daily_center import CLUB_TZ, club_day_window, task_counts, today_items  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def test_the_day_is_the_club_day_not_utc():
    # 23:30 Wiener Zeit ist noch „heute“, obwohl es in UTC schon 21:30 ist - und umgekehrt beginnt der Tag um 22:00 UTC.
    late = datetime(2026, 10, 31, 22, 30, tzinfo=timezone.utc)   # 23:30 in Wien (MEZ)
    start, end = club_day_window(late)
    assert start.astimezone(CLUB_TZ).strftime("%Y-%m-%d %H:%M") == "2026-10-31 00:00"
    assert end.astimezone(CLUB_TZ).strftime("%Y-%m-%d %H:%M") == "2026-11-01 00:00"
    assert start <= late < end


@pytest.mark.asyncio
async def test_counts_and_today_list(flow):
    now = now_utc()
    start, end = club_day_window(now)
    in_day = start + timedelta(hours=18)
    await flow.db.tournaments.insert_one({"id": "t1", "slug": "cup", "title": "Herbst-Cup", "status": "live", "is_public": True})
    await flow.db.tournaments.insert_one({"id": "t2", "slug": "liga", "title": "Liga", "status": "checkin_open", "is_public": True, "check_in_from": in_day.isoformat()})
    await flow.db.matches_v2.insert_one({"id": "m1", "tournament_id": "t1", "status": "waiting_result", "match_key": "A1", "scheduled_at": (start + timedelta(hours=10)).isoformat()})
    await flow.db.matches_v2.insert_one({"id": "m2", "tournament_id": "t1", "status": "scheduled", "match_key": "A2", "scheduled_at": (start + timedelta(hours=20)).isoformat(), "station_label": "PC 3"})
    await flow.db.matches_v2.insert_one({"id": "m3", "tournament_id": "t1", "status": "scheduled", "match_key": "B1", "scheduled_at": (end + timedelta(hours=1)).isoformat()})
    await flow.db.matches_v2.insert_one({"id": "m4", "tournament_id": "t1", "status": "pending", "schedule_status": "proposed", "schedule_deadline_at": (now + timedelta(hours=3)).isoformat()})
    await flow.db.matches_v2.insert_one({"id": "m5", "tournament_id": "t1", "status": "pending", "schedule_status": "proposed", "schedule_deadline_at": (now + timedelta(days=3)).isoformat()})
    await flow.db.matches.insert_one({"id": "old1", "tournament_id": "t1", "status": "waiting_result"})
    await flow.db.user_reports.insert_one({"id": "r1", "status": "open"})
    await flow.db.user_reports.insert_one({"id": "r2", "status": "accepted"})
    await flow.db.contact_messages.insert_one({"id": "c1", "status": "new"})
    await flow.db.contact_messages.insert_one({"id": "c2", "status": "done"})
    await flow.db.events.insert_one({"id": "e1", "slug": "lan", "name": "LAN heute", "status": "scheduled", "start_date": (start + timedelta(hours=15)).isoformat(), "location": "Vereinsheim"})
    await flow.db.events.insert_one({"id": "e2", "slug": "morgen", "name": "Morgen", "status": "scheduled", "start_date": (end + timedelta(hours=15)).isoformat()})
    await flow.db.events.insert_one({"id": "e3", "slug": "laeuft", "name": "Mehrtägig", "status": "live", "start_date": (start - timedelta(days=1)).isoformat(), "end_date": (end + timedelta(days=1)).isoformat()})
    await flow.db.events.insert_one({"id": "e4", "slug": "vorbei", "name": "Gestern ohne Ende", "status": "scheduled", "start_date": (start - timedelta(hours=5)).isoformat()})

    counts = await task_counts(flow.db, now)
    assert counts == {"reported_results": 2, "moderation_reports": 1, "contact_messages": 1, "schedule_deadlines": 1, "billing_cases": 0}

    today = await today_items(flow.db, now)
    assert [item["title"] for item in today] == ["Mehrtägig", "Herbst-Cup – A1", "LAN heute", "Check-in: Liga", "Herbst-Cup – A2"]
    assert today[4]["detail"] == "PC 3" and today[4]["url"] == "/matches/m2"
    assert today[3]["url"] == "/admin/tournaments/t2"

    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    dashboard = (await flow.get("/api/admin/dashboard")).json()
    assert dashboard["daily_tasks"]["reported_results"] == 2 and len(dashboard["today"]) == 5
