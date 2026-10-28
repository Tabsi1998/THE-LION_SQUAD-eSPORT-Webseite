"""Terminvorschläge in der Liga respektieren Sperrzeiten (docs/LIGA.md, Abschnitt 5; P2-Helfer in matchday_schedule).

Ein Vorschlag oder Gegenvorschlag in einer Sperrzeit wird mit Satz abgelehnt, die Antwortfrist läuft über eine
Sperrzeit nicht ab. Turniere ohne Sperrzeiten bleiben wie bisher. Erfundene Namen."""

import pathlib
import sys
from datetime import datetime, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import world  # noqa: E402
from models import now_utc  # noqa: E402

CHRISTMAS = [{"start_date": "2026-12-21", "end_date": "2027-01-03", "label": "Weihnachtspause"}]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_a_proposal_in_a_blocked_period_is_refused(flow):
    w = await world(flow)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"blocked_periods": CHRISTMAS}})
    url = f"/api/matches/{w['match']['id']}/schedule-proposals"
    flow.act_as(w["users"]["Kapitaen"])

    refused = await flow.post(url, json={"scheduled_at": "2026-12-27T19:00:00+00:00"})
    assert refused.status_code == 409
    assert "Weihnachtspause" in refused.json()["detail"] and "21.12.2026 bis 3.1.2027" in refused.json()["detail"]

    accepted = await flow.post(url, json={"scheduled_at": "2027-01-10T19:00:00+00:00"})
    assert accepted.status_code == 200, accepted.text

    flow.act_as(w["users"]["Falke1"])
    counter = await flow.post(
        f"{url}/{accepted.json()['id']}/decision",
        json={"action": "counter", "scheduled_at": "2026-12-31T19:00:00+00:00"},
    )
    assert counter.status_code == 409


@pytest.mark.asyncio
async def test_the_answer_deadline_does_not_run_through_a_blocked_period(flow):
    w = await world(flow)
    today = now_utc().date()
    pause = [
        {
            "start_date": (today + timedelta(days=1)).isoformat(),
            "end_date": (today + timedelta(days=2)).isoformat(),
            "label": "Pause",
        }
    ]
    await flow.db.tournaments.update_one(
        {"id": w["tournament"]["id"]}, {"$set": {"blocked_periods": pause, "match_schedule_response_hours": 24}}
    )
    flow.act_as(w["users"]["Kapitaen"])

    proposed = await flow.post(
        f"/api/matches/{w['match']['id']}/schedule-proposals",
        json={"scheduled_at": (now_utc() + timedelta(days=10)).isoformat()},
    )

    assert proposed.status_code == 200, proposed.text
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    deadline = datetime.fromisoformat(match["schedule_deadline_at"])
    assert deadline > now_utc() + timedelta(hours=40), "zwei Pausentage zählen nicht mit"


@pytest.mark.asyncio
async def test_without_blocked_periods_the_deadline_stays_as_today(flow):
    w = await world(flow)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"match_schedule_response_hours": 24}})
    flow.act_as(w["users"]["Kapitaen"])
    before = now_utc()

    proposed = await flow.post(
        f"/api/matches/{w['match']['id']}/schedule-proposals",
        json={"scheduled_at": (before + timedelta(days=3)).isoformat()},
    )

    assert proposed.status_code == 200, proposed.text
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    deadline = datetime.fromisoformat(match["schedule_deadline_at"])
    assert before + timedelta(hours=24) <= deadline <= now_utc() + timedelta(hours=24)
