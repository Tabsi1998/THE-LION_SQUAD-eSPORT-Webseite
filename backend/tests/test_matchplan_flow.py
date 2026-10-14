"""Matchplan-Seite (#1557) - was die Seite vom Server braucht, durch die echten Routen.

Puffer je Spiel: die Turnierleitung stellt ihn auf der Matchplan-Seite ein, der Planer rechnet ihn in jede Dauer.
Fristen online: die Seite zeigt je Spiel, wann es offen ist, wann „nicht erschienen“ greift und wann eine Meldung von
selbst gilt - gerechnet vom Server (services/match_deadlines), nicht in der Website.
"""
import pathlib
import sys
from datetime import datetime, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id, now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def built(flow, count=4, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(count, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    return staff, tournament, registrations


def on_site(**extra):
    start = (now_utc() + timedelta(hours=1)).replace(microsecond=0)
    return {"event_mode": "local", "schedule_mode": "fixed_by_staff", "result_entry_mode": None,
            "start_date": start.isoformat(), "match_duration_minutes": 20, **extra}


@pytest.mark.asyncio
async def test_the_buffer_set_on_the_tournament_lengthens_every_planned_match(flow):
    _staff, tournament, _regs = await built(flow, **on_site())
    await flow.db.stations.insert_one({"id": new_id(), "name": "1", "device_type": "switch2", "tournament_id": tournament["id"],
                                       "status": "free", "current_match_id": None})
    before = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    assert {item["duration_minutes"] for item in before["assignments"]} == {20}

    saved = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"match_buffer_minutes": 5})
    assert saved.status_code == 200, saved.text
    assert (await flow.db.tournaments.find_one({"id": tournament["id"]}))["match_buffer_minutes"] == 5

    after = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    assert {item["duration_minutes"] for item in after["assignments"]} == {25}
    first, second = sorted(after["assignments"], key=lambda item: item["scheduled_at"])[:2]
    gap = datetime.fromisoformat(second["scheduled_at"]) - datetime.fromisoformat(first["scheduled_at"])
    assert gap >= timedelta(minutes=25), "eine Station: das zweite Spiel beginnt erst nach Spiel und Puffer"


@pytest.mark.asyncio
async def test_a_buffer_outside_the_allowed_range_is_refused(flow):
    _staff, tournament, _regs = await built(flow, **on_site())
    refused = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"match_buffer_minutes": 500})
    assert refused.status_code == 422


@pytest.mark.asyncio
async def test_online_deadlines_name_opening_no_show_and_result_per_match(flow):
    start = (now_utc() - timedelta(minutes=10)).replace(microsecond=0)
    _staff, tournament, _regs = await built(flow, event_mode="online", schedule_mode="player_proposal", start_date=start.isoformat(),
                                            no_show_minutes_online=20)
    await flow.start(tournament)
    matches = sorted(await flow.matches(tournament), key=lambda row: (row["round"], row.get("match_key") or ""))
    first = matches[0]
    final = matches[-1]
    reporter = flow.registration_of(first, 0)
    await flow.db.matches_v2.update_one({"id": first["id"]}, {"$set": {"reports": [
        {"registration_id": reporter, "at": now_utc().isoformat(), "results": []}]}})

    response = await flow.get(f"/api/tournaments/{tournament['id']}/schedule/deadlines")
    assert response.status_code == 200, response.text
    rows = {row["match_id"]: row for row in response.json()["matches"]}
    open_match = next(row for match_id, row in rows.items() if match_id not in {first["id"], final["id"]})
    assert open_match["opened_at"] == start.isoformat()
    assert open_match["no_show_minutes"] == 20
    assert open_match["no_show_due_at"] == (start + timedelta(minutes=20)).isoformat()
    assert rows[first["id"]]["no_show_due_at"] is None, "mit einer Meldung gibt es kein „nicht erschienen“ mehr"
    assert rows[first["id"]]["result_due_at"] is not None
    assert rows[final["id"]]["no_show_due_at"] is None and rows[final["id"]]["opened_at"] is None, \
        "das Finale ist erst offen, wenn beide Seiten feststehen"


@pytest.mark.asyncio
async def test_deadlines_are_only_for_the_tournament_team(flow):
    _staff, tournament, _regs = await built(flow, event_mode="online", schedule_mode="player_proposal")
    flow.act_as(await flow.add_user())
    response = await flow.get(f"/api/tournaments/{tournament['id']}/schedule/deadlines")
    assert response.status_code == 403
