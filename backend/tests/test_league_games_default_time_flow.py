"""Der Standardtermin der Spielwoche auf der Matchseite (#2096, Browser-Durchlauf): ohne Einigung gilt er - die Seite
nennt ihn, auch solange ihn noch kein Lauf ins Spiel geschrieben hat. Sperrwochen werden übersprungen. Erfundene
Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import duel, world  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_the_match_page_names_the_default_time_of_the_week(flow):
    w = await world(flow)
    # Season 1: ab Di 10.11.2026 00:00 Wien, Standard Sonntag 20:00, Wochen 7 und 8 gesperrt (Weihnachtspause).
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {
        "start_date": "2026-11-09T23:00:00+00:00", "matchday_days": 7, "default_match_weekday": 6,
        "default_match_time": "20:00", "matchday_blocked_weeks": [7, 8]}})
    last = await duel(flow, w["tournament"], w["reg_a"], w["reg_h"], matchday=7)
    flow.act_as(None)

    first = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    seventh = (await flow.get(f"/api/matches/{last['id']}/page")).json()

    assert first["league"]["default_time"] == "2026-11-15T19:00:00+00:00"  # So 15.11. 20:00 Wien
    assert seventh["league"]["default_time"] == "2027-01-10T19:00:00+00:00"  # Woche 9, nach der Pause


@pytest.mark.asyncio
async def test_without_a_season_start_there_is_no_default_time(flow):
    w = await world(flow)
    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    assert page["league"]["default_time"] is None
