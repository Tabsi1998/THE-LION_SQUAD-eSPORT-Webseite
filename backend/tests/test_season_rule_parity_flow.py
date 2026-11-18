"""Season-Regel doppelt, aber gleich (#2516): ``awards._season_visible`` wiederholt ``league_service.can_see_season``, damit die
Erfolge nicht über ``league_service`` Discord, Mail und Routen importieren (tests/test_import_cycles_unit.py). Dieser Test hält beide
gleich - über alle Betrachter, Sichtbarkeiten und Status. Einzige gewollte Ausnahme: eine archivierte Season zählt bei den
Trophäen nie (``can_see_season`` kennt den Status nicht). Nur erfundene Namen."""
import itertools
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services import awards, league_service  # noqa: E402
from services.profile_visibility import members_scope  # noqa: E402

VISIBILITIES = ("public", "members", "admins", "off", None)
STATUSES = ("active", "completed", "archived")
LEAGUES = ("liga-1", "liga-2")


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_season_rule_matches_can_see_season_except_archived(flow):
    member = await flow.add_user(role="player", name="nachtfalke")
    await flow.db.memberships.insert_one({"id": new_id(), "user_id": member["id"], "member_status": "active"})
    outsider = await flow.add_user(role="player", name="turbolurch")
    staff = await flow.add_user(role="player", name="ligastab")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga-1", "user_id": staff["id"], "capabilities": ["results"]})
    viewers = {"gast": None, "mitglied": member, "nicht-mitglied": outsider, "liga-stab-liga-1": staff}

    checked = 0
    for (label, viewer), visibility, status, league_id in itertools.product(viewers.items(), VISIBILITIES, STATUSES, LEAGUES):
        season = {"id": f"s-{visibility}-{status}-{league_id}", "league_id": league_id, "status": status}
        if visibility is not None:
            season["visibility"] = visibility
        expected = await league_service.can_see_season(viewer, season) and season["status"] != "archived"
        # Je Kombination ein frischer Scope - der Merker darf zwischen den Fällen nichts weitertragen.
        scope = members_scope(viewer) if viewer else None
        got = await awards._season_visible(season, scope)
        assert got == expected, (label, visibility, status, league_id)
        checked += 1
    assert checked == len(viewers) * len(VISIBILITIES) * len(STATUSES) * len(LEAGUES)
