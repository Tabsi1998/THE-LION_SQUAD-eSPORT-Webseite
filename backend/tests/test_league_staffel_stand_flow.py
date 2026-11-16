"""Liga-Stand einer Staffel in der Verwaltung (#2453). Erfundene Namen.

Eine Staffel steht bis „Liga starten“ im Turnier-Status ``draft`` - auch während die Season zur Anmeldung offen ist. Das blockiert nichts:
Anmelden, Annehmen, Zuteilen, Kader und Start laufen wie im Vertrag (docs/LIGA.md, B.4 und Abschnitt 6); öffentlich bleibt eine Staffel im
Entwurf verborgen (Abschnitt 10, „Entwurf bleibt 404“), die Ligaseite zeigt das offene Anmeldefenster. Die Verwaltung bekommt je Staffel die
Season-Angaben, aus denen die Ablaufleiste den Stand ableitet (``league_season``), und ob der Spielplan fest ist (``league_plan``) - die
Ableitung selbst steht an einer Stelle im Web (``lib/seasonTabs.js``, ``seasonPhases``).
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_application_world import application_world, base_url, decide, submitted, window  # noqa: E402
from league_rules_world import ADMIN_LEAGUES  # noqa: E402
from league_start_world import ok, start  # noqa: E402
from models import new_id  # noqa: E402
from services import league_late  # noqa: E402

MANAGED_LIST = "/api/tournaments?include_drafts=true&managed=true&limit=500"
SEASON_KEYS = {"id", "status", "visibility", "application_opens_at", "application_closes_at", "start_date", "application_effective_closes_at"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def managed_row(flow, world: dict, tid: str | None = None) -> dict:
    flow.act_as(world["lead"])
    rows = ok(await flow.get(MANAGED_LIST))
    return next(row for row in rows if row["id"] == (tid or world["tid"]))


async def assign(flow, world: dict, side: dict) -> dict:
    application = await submitted(flow, world, side)
    return ok(await decide(flow, world, application, "accept", tournament_id=world["tid"]))


@pytest.mark.asyncio
async def test_a_draft_staffel_with_open_application_blocks_nothing(flow):
    w = await application_world(flow, teams=2)
    staffel = await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0})
    assert staffel["status"] == "draft"

    # Öffentlich: Die Season zeigt das offene Fenster, die Staffel im Entwurf noch nicht (Vertrag Abschnitt 10).
    flow.act_as(None)
    page = ok(await flow.get(base_url(w)))
    assert page["application"]["state"] == "open"
    assert page["divisions"][0]["staffeln"] == []
    hidden = await flow.get(f"{base_url(w)}/staffeln/{w['tid']}")
    assert hidden.status_code == 404

    # Anmelden und Zuteilen gehen in die Staffel im Entwurf.
    first = await assign(flow, w, w["teams"][0])
    assert first["status"] == "accepted" and first["assignment"]["tournament_id"] == w["tid"]
    registration = await flow.db.tournament_registrations.find_one(
        {"tournament_id": w["tid"], "squad_id": w["teams"][0]["squad"]["id"]}, {"_id": 0})
    assert registration and registration["status"] == "approved"
    # Kader der Season: das zugeteilte Co-Team steht drin.
    flow.act_as(w["lead"])
    roster = ok(await flow.get(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}/roster"))
    assert w["teams"][0]["squad"]["id"] in str(roster)

    # Auch für die Teilnehmenden bleibt der Entwurf verborgen - ihre Zuteilung steht auf der Ligaseite.
    flow.act_as(w["teams"][0]["captain"])
    hidden_for_team = await flow.get(f"/api/tournaments/{w['tid']}")
    assert hidden_for_team.status_code == 404
    mine = ok(await flow.get("/api/me/league-applications"))
    assert [(row["status"], row["staffel"]) for row in mine["items"]] == [("accepted", "Liga 1 · Staffel A")]

    # Mit dem zweiten Team startet die Liga: Entwurf → Live, die Season folgt.
    await assign(flow, w, w["teams"][1])
    ok(await start(flow, w))
    started = await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0, "status": 1})
    assert started["status"] == "live"
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0, "status": 1})
    assert season["status"] == "active"
    assert await flow.db.matches_v2.count_documents({"tournament_id": w["tid"], "is_preview": {"$ne": True}}) > 0


@pytest.mark.asyncio
async def test_the_managed_list_carries_the_season_inputs_of_a_draft_staffel(flow):
    w = await application_world(flow, teams=1)
    row = await managed_row(flow, w)
    assert row["status"] == "draft"
    assert set(row["league_season"]) == SEASON_KEYS
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    assert row["league_season"]["id"] == w["season"]["id"]
    assert row["league_season"]["status"] == "draft"
    assert row["league_season"]["visibility"] == "public"
    for key in ("application_opens_at", "application_closes_at", "start_date"):
        assert str(row["league_season"][key])[:16] == str(season[key])[:16]
    assert row["league_plan"] == {"fixed_matches": 0}
    assert row["participant_count"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("opens, closes", [(24, 48), (-1, 48), (-48, -1)])
async def test_each_window_position_reaches_the_list_unchanged(flow, opens, closes):
    """Vor, in und nach dem Anmeldefenster: Die Liste bekommt genau die Zeiten der Season - die Phase leitet das Web daraus ab."""
    w = await application_world(flow, teams=0, open_window=False, **window(opens_in_hours=opens, closes_in_hours=closes))
    row = await managed_row(flow, w)
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    assert str(row["league_season"]["application_opens_at"])[:16] == str(season["application_opens_at"])[:16]
    assert str(row["league_season"]["application_closes_at"])[:16] == str(season["application_closes_at"])[:16]


@pytest.mark.asyncio
async def test_after_the_start_the_list_knows_the_fixed_plan_and_the_running_season(flow):
    w = await application_world(flow, teams=2)
    for side in w["teams"]:
        await assign(flow, w, side)
    ok(await start(flow, w))
    row = await managed_row(flow, w)
    assert row["status"] == "live"
    assert row["league_season"]["status"] == "active"
    assert row["league_plan"]["fixed_matches"] > 0


@pytest.mark.asyncio
async def test_the_staffel_page_of_the_administration_carries_the_season_inputs(flow):
    w = await application_world(flow, teams=1)
    flow.act_as(w["lead"])
    detail = ok(await flow.get(f"/api/tournaments/{w['tid']}"))
    assert set(detail["league_season"]) == SEASON_KEYS
    assert detail["league_plan"] == {"fixed_matches": 0}


@pytest.mark.asyncio
async def test_ordinary_tournaments_and_outsiders_get_no_season_inputs(flow):
    w = await application_world(flow, teams=1)
    cup = await flow.create_tournament(title="Probe-Cup")
    flow.act_as(w["lead"])
    rows = ok(await flow.get(MANAGED_LIST))
    plain = next(row for row in rows if row["id"] == cup["id"])
    assert "league_season" not in plain and "league_plan" not in plain
    # Wer nur liest (öffentliche Liste, angemeldetes Mitglied ohne Rolle), bekommt die Angaben der Verwaltung nicht.
    flow.act_as(w["teams"][0]["captain"])
    for row in ok(await flow.get("/api/tournaments?limit=500")):
        assert "league_season" not in row


@pytest.mark.asyncio
async def test_a_shorter_late_deadline_is_the_effective_end_of_the_application(flow):
    """Nachmeldefrist (#2422): Endet sie vor dem Fenster, ist sie das Ende der Anmeldung - Label und Phasengrenze rechnen damit."""
    w = await application_world(flow, teams=0, open_window=False, **window(opens_in_hours=-1, closes_in_hours=40 * 24))
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {"late_registration_days": 2}})
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    effective = league_late.effective_closes_iso(season)
    assert effective and league_late.aware(effective) < league_late.aware(season["application_closes_at"])
    row = await managed_row(flow, w)
    assert row["league_season"]["application_effective_closes_at"] == effective
    # Ohne Frist vor dem Fensterende ist es das Fenster selbst.
    w2 = await application_world(flow, teams=0)
    row2 = await managed_row(flow, w2)
    assert league_late.aware(row2["league_season"]["application_effective_closes_at"]) == league_late.aware(row2["league_season"]["application_closes_at"])


async def started_world(flow) -> dict:
    w = await application_world(flow, teams=2)
    for side in w["teams"]:
        await assign(flow, w, side)
    ok(await start(flow, w))
    return w


@pytest.mark.asyncio
async def test_the_tournament_lead_without_leagues_gets_no_season_inputs(flow):
    w = await started_world(flow)
    lead = await flow.add_user(role="tournament_admin", name="Turnierleitung ohne Ligen")
    flow.act_as(lead)
    rows = ok(await flow.get(MANAGED_LIST))
    assert any(row["id"] == w["tid"] for row in rows)
    assert all("league_season" not in row and "league_plan" not in row for row in rows)
    detail = await flow.get(f"/api/tournaments/{w['tid']}")
    assert detail.status_code == 200
    assert "league_season" not in detail.json()


@pytest.mark.asyncio
async def test_a_helper_of_the_staffel_gets_no_season_inputs(flow):
    w = await started_world(flow)
    helper = await flow.add_user(name="Helfer der Staffel")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": w["tid"], "user_id": helper["id"], "role": "organizer", "scope": "tournament", "is_active": True})
    flow.act_as(helper)
    rows = ok(await flow.get(MANAGED_LIST))
    assert [row["id"] for row in rows] == [w["tid"]]
    assert "league_season" not in rows[0]
    detail = ok(await flow.get(f"/api/tournaments/{w['tid']}"))
    assert "league_season" not in detail


@pytest.mark.asyncio
async def test_a_captain_gets_no_season_inputs(flow):
    w = await started_world(flow)
    flow.act_as(w["teams"][0]["captain"])
    assert all("league_season" not in row for row in ok(await flow.get(MANAGED_LIST)))
    detail = ok(await flow.get(f"/api/tournaments/{w['tid']}"))
    assert "league_season" not in detail and "league_plan" not in detail
