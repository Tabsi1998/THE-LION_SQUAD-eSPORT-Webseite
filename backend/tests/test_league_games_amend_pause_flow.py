"""Aufstellung nachtragen: die Frist ruht in einer Sperrzeit (docs/LIGA.md, #2096) - wie Termin- und
Bestätigungsfristen. Ohne Sperrzeit genau ``lineup_amend_hours`` nach dem Ergebnis. Erfundene Namen."""

import pathlib
import sys
from datetime import datetime, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, two_nil, world  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def app_confirmed(flow, w: dict) -> dict:
    """Melden mit Maps, Bestätigen aus der App - die Gegenseite muss ihre Aufstellung nachtragen."""
    flow.act_as(w["users"]["Kapitaen"])
    first = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    assert first.status_code == 200, first.text
    flow.act_as(w["users"]["Falke1"])
    second = await flow.post(f"/api/matches/{w['match']['id']}/report", json={"results": two_nil(w)["results"]})
    assert second.status_code == 200, second.text
    return await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})


async def amend_until(flow, w: dict) -> datetime:
    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    return datetime.fromisoformat(page["league"]["amend_until"])


@pytest.mark.asyncio
async def test_without_a_break_the_window_is_exactly_the_configured_hours(flow):
    w = await world(flow)
    match = await app_confirmed(flow, w)

    assert await amend_until(flow, w) == datetime.fromisoformat(match["completed_at"]) + timedelta(hours=48)


@pytest.mark.asyncio
async def test_days_in_a_blocked_period_do_not_count_for_the_amendment(flow):
    w = await world(flow)
    today = now_utc().date()
    pause = [{"start_date": (today + timedelta(days=1)).isoformat(),
              "end_date": (today + timedelta(days=2)).isoformat(), "label": "Pause"}]
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"blocked_periods": pause}})
    match = await app_confirmed(flow, w)
    done = datetime.fromisoformat(match["completed_at"])

    until = await amend_until(flow, w)

    assert until >= done + timedelta(hours=48 + 47), "zwei Pausentage zählen nicht mit"
    # Ergebnis vor 49 Stunden, gestern war Pause: die Frist ist noch offen - der Captain trägt selbst nach.
    yesterday = (today - timedelta(days=1)).isoformat()
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"blocked_periods": [
        {"start_date": yesterday, "end_date": yesterday, "label": "Pause"}]}})
    late = (now_utc() - timedelta(hours=49)).isoformat()
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"completed_at": late}})
    assert await amend_until(flow, w) > now_utc()
    flow.act_as(w["users"]["Falke1"])
    amended = await flow.put(f"/api/matches/{w['match']['id']}/lineups", json={"games": [
        {"position": 1, "lineup": ids(w, "Falke1", "Falke2")}, {"position": 2, "lineup": ids(w, "Falke2", "Falke3")}]})
    assert amended.status_code == 200, amended.text
