"""Liga-Start ab 17 Teams (#2201, D-18). Erfundene Namen.

Die Schätzung für den Spielplan rundete die Staffelgröße auf eine Zweierpotenz und rechnete immer Hin- und Rückrunde: Aus 20
Teams wurden 32 mal 31 Spiele, über der Obergrenze. Dann gab es keine Vorschau, und der Start scheiterte mit 409.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_start_world import build, ok, start  # noqa: E402
from routes.tournament_common import _can_create_initial_stage_preview, _estimated_match_count  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.parametrize("teams, legs, expected", [(16, 1, 120), (17, 1, 136), (20, 1, 190), (20, 2, 380), (32, 2, 992)])
def test_the_estimate_counts_the_real_pairings_of_a_league_with_legs(teams, legs, expected):
    assert _estimated_match_count({"format": "league", "max_participants": teams, "round_robin_legs": legs}) == expected


def test_a_large_league_with_legs_is_still_refused():
    assert _can_create_initial_stage_preview({"format": "league", "max_participants": 20, "round_robin_legs": 2}) is True
    assert _can_create_initial_stage_preview({"format": "league", "max_participants": 32, "round_robin_legs": 2}) is False
    assert _can_create_initial_stage_preview({"format": "league", "max_participants": 40, "round_robin_legs": 1}) is False


def test_without_legs_the_estimate_stays_as_it_was():
    """Regression: Ohne ``round_robin_legs`` rechnet alles wie bisher - auch die Rundung auf eine Zweierpotenz."""
    assert _estimated_match_count({"format": "league", "max_participants": 16}) == 240
    assert _estimated_match_count({"format": "league", "max_participants": 17}) == 992
    assert _estimated_match_count({"format": "round_robin", "max_participants": 8}) == 28
    assert _estimated_match_count({"format": "single_elim", "max_participants": 16, "round_robin_legs": 1}) == 15
    assert _can_create_initial_stage_preview({"format": "league", "max_participants": 20}) is False


@pytest.mark.asyncio
@pytest.mark.parametrize("teams", [17, 20])
async def test_a_staffel_with_more_than_sixteen_teams_starts(flow, teams):
    world = await build(flow, teams, max_staffel_size=20)
    ok(await start(flow, world))
    matches = await flow.db.matches_v2.find({"tournament_id": world["tid"], "is_preview": {"$ne": True}}, {"_id": 0}).to_list(None)
    assert len(matches) == teams * (teams - 1) // 2
    rounds = {int(row["round"]) for row in matches}
    assert len(rounds) == (teams if teams % 2 else teams - 1), "ungerade Zahl: ein Spieltag mehr, ein Team hat spielfrei"
    registrations = await flow.db.tournament_registrations.distinct("id", {"tournament_id": world["tid"]})
    for registration in registrations:
        count = sum(any(slot.get("registration_id") == registration for slot in row["slots"]) for row in matches)
        assert count == teams - 1, "jeder gegen jeden"
