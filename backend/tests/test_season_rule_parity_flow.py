"""Season-Regeln im Profil (#2516, #2521) über alle Betrachter, Sichtbarkeiten und Status. Nur erfundene Namen.

- ``opens_season_page`` (der Link im Profil) wiederholt ``league_service.can_see_season`` genau, damit die Erfolge nicht über
  ``league_service`` Discord, Mail und Routen importieren (tests/test_import_cycles_unit.py) - dieser Test hält beide gleich.
- ``sees_season`` (was das Profil zeigt; ``awards._season_visible`` nutzt sie) ist bewusst enger (Fabian, 18.11.): Liga-Rechte zählen
  nicht - „Nur Liga-Leitung“ und „Aus“ sieht im Profil nur die Person selbst, auch Liga-Leitung und Admins nicht. Archivierte Seasons
  zählen nie. Gäste sehen Öffentliches, Vereinsmitglieder dazu „Nur Mitglieder“.
"""
import itertools
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services import awards, league_service  # noqa: E402
from services.profile_visibility import PUBLIC, SELF, members_scope, opens_season_page, sees_season  # noqa: E402
from services.visibility import user_can_see  # noqa: E402

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
async def test_season_rules_of_the_profile(flow):
    member = await flow.add_user(role="player", name="nachtfalke")
    await flow.db.memberships.insert_one({"id": new_id(), "user_id": member["id"], "member_status": "active"})
    outsider = await flow.add_user(role="player", name="turbolurch")
    staff = await flow.add_user(role="player", name="ligastab")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga-1", "user_id": staff["id"], "capabilities": ["results"]})
    # Liga-Leitung mit Mitgliedschaft: im Profil wie ein Mitglied, auf der Season-Seite wie die Leitung.
    member_staff = await flow.add_user(role="player", name="ligamitglied")
    await flow.db.memberships.insert_one({"id": new_id(), "user_id": member_staff["id"], "member_status": "active"})
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga-1", "user_id": member_staff["id"], "capabilities": ["manage"]})
    viewers = {"gast": None, "mitglied": member, "nicht-mitglied": outsider, "liga-stab-liga-1": staff, "liga-mitglied-liga-1": member_staff}

    checked = 0
    for (label, viewer), visibility, status, league_id in itertools.product(viewers.items(), VISIBILITIES, STATUSES, LEAGUES):
        season = {"id": f"s-{visibility}-{status}-{league_id}", "league_id": league_id, "status": status}
        if visibility is not None:
            season["visibility"] = visibility
        # Der Link: genau die Season-Seite.
        assert await opens_season_page(viewer, season, {}) == await league_service.can_see_season(viewer, season), (
            "opens_season_page", label, visibility, status, league_id)
        # Was das Profil zeigt: ohne Liga-Rechte, nie archiviert.
        expected = status != "archived" and (visibility == "public" or (
            visibility == "members" and viewer is not None and await user_can_see(viewer, "members")))
        # Je Kombination ein frischer Scope - der Merker darf zwischen den Fällen nichts weitertragen.
        got = await awards._season_visible(season, members_scope(viewer) if viewer else None)
        assert got == expected, ("awards", label, visibility, status, league_id)
        direct = await sees_season(members_scope(viewer) if viewer else PUBLIC, season)
        assert direct == expected, ("sees_season", label, visibility, status, league_id)
        # Die Person selbst sieht jede Season, die nicht archiviert ist.
        assert await sees_season(SELF, season) is (status != "archived")
        checked += 1
    assert checked == len(viewers) * len(VISIBILITIES) * len(STATUSES) * len(LEAGUES)
    # Ausdrücklich: Die Liga-Leitung öffnet „Nur Liga-Leitung“, im Profil einer anderen Person sieht sie die Season nicht.
    admins = {"id": "s-leitung", "league_id": "liga-1", "status": "active", "visibility": "admins"}
    assert await league_service.can_see_season(member_staff, admins) is True
    assert await sees_season(members_scope(member_staff), admins) is False
