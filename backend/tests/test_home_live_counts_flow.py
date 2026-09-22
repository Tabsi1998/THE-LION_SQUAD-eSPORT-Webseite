"""Startseite lebendiger (#224): Live-Zahlen je Karte kommen mit dem Stand - Anmeldungen,
laufende Matches, Fahrer - ohne dass die Seite je Karte nachfragen muss."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_home_state_carries_live_counts_per_card(flow):
    soon = (now_utc() + timedelta(days=2)).isoformat()
    await flow.db.tournaments.insert_one({"id": "t1", "slug": "cup", "title": "Cup", "status": "registration_open", "is_public": True, "visibility": "public",
                                          "start_date": soon, "max_participants": 16, "created_at": now_utc().isoformat()})
    for i in range(3):
        await flow.db.tournament_registrations.insert_one({"id": f"r{i}", "tournament_id": "t1", "status": "approved"})
    await flow.db.tournament_registrations.insert_one({"id": "r-x", "tournament_id": "t1", "status": "rejected"})
    await flow.db.matches_v2.insert_one({"id": "m1", "tournament_id": "t1", "status": "running"})
    await flow.db.matches_v2.insert_one({"id": "m2", "tournament_id": "t1", "status": "completed"})
    await flow.db.events.insert_one({"id": "e1", "slug": "lan", "name": "LAN", "status": "registration_open", "visibility": "public", "start_date": soon,
                                     "has_registration": True, "max_participants": 20, "created_at": now_utc().isoformat()})
    await flow.db.event_registrations.insert_one({"id": "er1", "event_id": "e1", "status": "registered"})
    await flow.db.event_registrations.insert_one({"id": "er2", "event_id": "e1", "status": "cancelled"})
    await flow.db.events.insert_one({"id": "e2", "slug": "treffen", "name": "Treffen ohne Anmeldung", "status": "scheduled", "visibility": "public", "start_date": soon,
                                     "created_at": now_utc().isoformat()})
    await flow.db.f1_challenges.insert_one({"id": "c1", "slug": "fastlap", "title": "Fast Lap", "status": "live", "visibility": "public", "start_date": now_utc().isoformat(),
                                            "created_at": now_utc().isoformat()})
    for user_id in ("u1", "u2", "u2"):
        await flow.db.f1_lap_times.insert_one({"id": f"lap-{user_id}-{now_utc().timestamp()}", "challenge_id": "c1", "user_id": user_id, "time_ms": 1000})
    await flow.db.f1_lap_times.insert_one({"id": "lap-ref", "challenge_id": "c1", "user_id": "u3", "time_ms": 900, "score_scope": "club_reference"})

    flow.act_as(None)
    state = (await flow.get("/api/home/state")).json()

    tournament = next(row for group in ("soon", "upcoming") for row in state[group]["tournaments"] if row["id"] == "t1")
    assert tournament["live_counts"] == {"registered": 3, "capacity": 16, "running_matches": 1}
    events = {row["id"]: row for group in ("soon", "upcoming") for row in state[group]["events"]}
    assert events["e1"]["live_counts"] == {"registered": 1, "capacity": 20}
    assert "live_counts" not in events["e2"], "ohne Anmeldung keine Zahl"
    challenge = next(row for row in state["live"]["challenges"] if row["id"] == "c1")
    assert challenge["live_counts"] == {"participants": 2}, "Referenzzeiten des Vereins zählen nicht als Fahrer"
