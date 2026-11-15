"""Nachmeldung (Entscheidung Nr. 180, #1632): Das Anmeldefenster darf über den Beginn der Season hinausgehen, etwa für nachrückende
Teams. Das erste Veröffentlichen prüft test_league_pools_flow.py; hier: eine schon veröffentlichte Season verlängert das Fenster, und eine
Nachmeldung kommt nach dem Start in die Staffel. Durch die echten Routen, erfundene Namen."""
from __future__ import annotations

import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_application_world import application_world, inbox_url, submitted  # noqa: E402
from league_rules_world import ADMIN_LEAGUES  # noqa: E402
from league_start_world import ok  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def season_url(world: dict) -> str:
    return f"{ADMIN_LEAGUES}/seasons/{world['season']['id']}"


def past_start(world: dict, days: int = 20) -> dict:
    """Ein offenes Fenster, das ``days`` Tage nach heute endet - die Season beginnt in acht Tagen."""
    closes = (now_utc() + timedelta(days=days)).isoformat()
    assert closes[:10] > world["season"]["start_date"][:10]
    return {"application_opens_at": (now_utc() - timedelta(hours=1)).isoformat(), "application_closes_at": closes}


@pytest.mark.asyncio
async def test_a_published_season_extends_its_window_past_the_start(flow):
    world = await application_world(flow, teams=1)
    flow.act_as(world["lead"])
    saved = ok(await flow.patch(season_url(world), json=past_start(world, days=40)))
    assert saved["application_closes_at"][:10] > world["season"]["start_date"][:10]


@pytest.mark.asyncio
async def test_a_late_entry_and_a_started_staffel(flow):
    """Nach dem Start: Die Leitung nimmt eine Nachmeldung an - wie sich Zuteilung, Spielplan und Tabelle verhalten."""
    world = await application_world(flow, teams=3)
    flow.act_as(world["lead"])
    ok(await flow.patch(season_url(world), json=past_start(world)))
    first, second, late = world["teams"]
    for side in (first, second):
        application = await submitted(flow, world, side)
        flow.act_as(world["lead"])
        ok(await flow.post(f"{inbox_url(world)}/{application['id']}/accept", json={"tournament_id": world["tid"]}))
    flow.act_as(world["lead"])
    ok(await flow.post(f"/api/tournaments/{world['tid']}/status", json={"status": "live"}))
    before = await flow.db.matches_v2.count_documents({"tournament_id": world["tid"], "is_preview": {"$ne": True}})

    application = await submitted(flow, world, late)
    flow.act_as(world["lead"])
    accepted = ok(await flow.post(f"{inbox_url(world)}/{application['id']}/accept", json={"tournament_id": world["tid"]}))
    assert accepted["status"] == "accepted"
    registrations = ok(await flow.get(f"/api/tournaments/{world['tid']}/registrations"))
    assert len(registrations) == 3
    # Die Tabelle führt das nachgemeldete Co-Team mit null Spielen und dem Hinweis. Das Zuteilen legt keine Spiele an (keine stille
    # Änderung, #2422): Die Leitung trägt sie nach Vorschau nach (test_league_late_entry_flow.py).
    standings = {row["registration_id"]: row for row in ok(await flow.get(f"/api/tournaments/{world['tid']}/standings"))}
    late_row = standings[accepted["assignment"]["registration_id"]]
    assert late_row["played"] == 0 and late_row["points"] == 0 and late_row["late_entry"] is True
    registration = await flow.db.tournament_registrations.find_one({"id": accepted["assignment"]["registration_id"]}, {"_id": 0})
    assert registration["late_entry"]["state"] == "open"
    after = await flow.db.matches_v2.count_documents({"tournament_id": world["tid"], "is_preview": {"$ne": True}})
    assert after == before
