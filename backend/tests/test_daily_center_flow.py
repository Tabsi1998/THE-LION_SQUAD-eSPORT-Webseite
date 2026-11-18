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
    await flow.db.user_reports.insert_one({"id": "r1", "status": "open"})
    await flow.db.user_reports.insert_one({"id": "r2", "status": "accepted"})
    await flow.db.contact_messages.insert_one({"id": "c1", "status": "new"})
    await flow.db.contact_messages.insert_one({"id": "c2", "status": "done"})
    await flow.db.events.insert_one({"id": "e1", "slug": "lan", "name": "LAN heute", "status": "scheduled", "start_date": (start + timedelta(hours=15)).isoformat(), "location": "Vereinsheim"})
    await flow.db.events.insert_one({"id": "e2", "slug": "morgen", "name": "Morgen", "status": "scheduled", "start_date": (end + timedelta(hours=15)).isoformat()})
    await flow.db.events.insert_one({"id": "e3", "slug": "laeuft", "name": "Mehrtägig", "status": "live", "start_date": (start - timedelta(days=1)).isoformat(), "end_date": (end + timedelta(days=1)).isoformat()})
    await flow.db.events.insert_one({"id": "e4", "slug": "vorbei", "name": "Gestern ohne Ende", "status": "scheduled", "start_date": (start - timedelta(hours=5)).isoformat()})

    counts = await task_counts(flow.db, now)
    assert counts == {"reported_results": 1, "moderation_reports": 1, "contact_messages": 1, "schedule_deadlines": 1, "billing_cases": 0, "sponsors_expiring": 0}

    today = await today_items(flow.db, now)
    assert [item["title"] for item in today] == ["Mehrtägig", "Herbst-Cup – A1", "LAN heute", "Check-in: Liga", "Herbst-Cup – A2"]
    assert today[4]["detail"] == "PC 3" and today[4]["url"] == "/matches/m2"
    assert today[3]["url"] == "/admin/tournaments/t2"

    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    dashboard = (await flow.get("/api/admin/dashboard")).json()
    assert dashboard["daily_tasks"]["reported_results"] == 1 and len(dashboard["today"]) == 5


STAFFEL_CONTEXT = {"league_id": "l-1", "season_id": "s-1", "division_id": "d-1", "staffel": "A"}


@pytest.mark.asyncio
async def test_the_tournament_tiles_count_without_staffeln_and_league_disputes_stand_apart(flow):
    """Paket D (#2262): Die Kacheln der Turniere führen in die Turnierliste - die zeigt keine Staffeln mehr, also zählen sie dort auch
    nicht. Streitfälle der Liga stehen getrennt und führen in den Leitstand ihrer Season (bei mehreren Seasons auf die Liga)."""
    now = now_utc()
    await flow.db.tournaments.insert_one({"id": "t1", "slug": "cup", "title": "Herbst-Cup", "status": "live", "is_public": True})
    await flow.db.tournaments.insert_one({"id": "s1", "slug": "staffel-a", "title": "Staffel A", "status": "live", "format": "league",
                                          "is_public": True, "league_context": STAFFEL_CONTEXT})
    soon = (now + timedelta(hours=3)).isoformat()
    for match_id, tid, fields in (("m1", "t1", {"status": "disputed"}), ("m2", "s1", {"status": "disputed"}), ("m3", "s1", {"status": "disputed"}),
                                  ("m4", "s1", {"status": "waiting_result"}), ("m5", "t1", {"status": "waiting_result"}),
                                  ("m6", "s1", {"status": "pending", "schedule_status": "proposed", "schedule_deadline_at": soon})):
        await flow.db.matches_v2.insert_one({"id": match_id, "tournament_id": tid, **fields})

    counts = await task_counts(flow.db, now)
    assert counts["reported_results"] == 1 and counts["schedule_deadlines"] == 0

    flow.act_as(await flow.add_user(role="tournament_admin", name="Turnierleitung"))
    data = (await flow.get("/api/admin/dashboard")).json()
    assert data["open_disputes"] == 1 and data["active_tournaments"] == 1 and data["total_tournaments"] == 1
    assert "league_disputes" not in data, "die Turnierleitung allein leitet keine Liga (#2203)"

    league = await flow.add_user(name="Ligaleitung")
    league["areas"] = ["leagues"]
    await flow.db.users.update_one({"id": league["id"]}, {"$set": {"areas": ["leagues"]}})
    flow.act_as(league)
    data = (await flow.get("/api/admin/dashboard")).json()
    assert data["league_disputes"] == {"count": 2, "season_id": "s-1"}
    assert "open_disputes" not in data

    # Streitfälle in zwei Seasons: kein einzelner Leitstand - der Weg führt auf die Liga.
    await flow.db.tournaments.insert_one({"id": "s2", "slug": "staffel-b", "title": "Staffel B", "status": "live", "format": "league",
                                          "league_context": {**STAFFEL_CONTEXT, "season_id": "s-2", "staffel": "B"}})
    await flow.db.matches_v2.insert_one({"id": "m7", "tournament_id": "s2", "status": "disputed"})
    assert (await flow.get("/api/admin/dashboard")).json()["league_disputes"] == {"count": 3, "season_id": None}
