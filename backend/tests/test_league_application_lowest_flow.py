"""Neue Co-Teams starten in der untersten Liga N (#1623, Entscheidung 15.10., docs/LIGA.md B.4): Der Eingang bietet sie zuerst an, eine
höhere Liga geht nur mit Grund. Je Season einstellbar; ohne das Feld (ältere Seasons) teilt die Leitung frei zu wie bisher. Erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_application_world import application_world, decide, inbox_url, submitted  # noqa: E402
from league_rules_world import ADMIN_LEAGUES  # noqa: E402
from league_start_world import ok  # noqa: E402

REASON = "Meister der Vorjahres-Turnierserie"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def two_leagues(flow, **season) -> dict:
    """Liga 1 mit Staffel A (``tid``) und darunter Liga 2 mit Staffel A (``low_tid``)."""
    w = await application_world(flow, teams=2, **season)
    flow.act_as(w["lead"])
    w["low"] = ok(await flow.post(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}/divisions", json={}))
    w["low_tid"] = ok(await flow.post(f"{ADMIN_LEAGUES}/divisions/{w['low']['id']}/staffeln", json={}))["tournament_id"]
    return w


async def stored(flow, application: dict) -> dict:
    return await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_a_new_season_carries_the_rule_and_an_older_one_does_not(flow):
    w = await two_leagues(flow)
    assert (await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0}))["new_squads_lowest_division"] is True
    page = ok(await flow.get(inbox_url(w)))
    assert page["new_lowest"] is True
    assert [(row["label"], row["lowest"]) for row in page["divisions"]] == [("Liga 1", False), ("Liga 2", True)]


@pytest.mark.asyncio
async def test_a_new_team_goes_to_the_lowest_league_without_a_reason(flow):
    w = await two_leagues(flow)
    application = ok(await decide(flow, w, await submitted(flow, w, w["teams"][0]), "accept"))
    page = ok(await flow.get(inbox_url(w)))
    assert page["items"][0]["target_division_id"] == w["low"]["id"]
    ok(await decide(flow, w, application, "assign", tournament_id=w["low_tid"]))
    assert "deviation_reason" not in (await stored(flow, application))["assignment"]


@pytest.mark.asyncio
async def test_a_higher_league_needs_a_reason_and_keeps_it(flow):
    w = await two_leagues(flow)
    application = ok(await decide(flow, w, await submitted(flow, w, w["teams"][0]), "accept"))
    bare = await decide(flow, w, application, "assign", tournament_id=w["tid"])
    assert bare.status_code == 422 and "untersten Liga (Liga 2)" in bare.json()["detail"]
    short = await decide(flow, w, application, "assign", tournament_id=w["tid"], deviation_reason="ja")
    assert short.status_code == 422
    assert (await stored(flow, application)).get("assignment") is None
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": w["tid"]}) == 0
    ok(await decide(flow, w, application, "assign", tournament_id=w["tid"], deviation_reason=REASON))
    assert (await stored(flow, application))["assignment"]["deviation_reason"] == REASON
    log = await flow.db.audit_logs.find_one({"action": "league.application.assign"}, {"_id": 0})
    assert log["data"]["deviation_reason"] == REASON


@pytest.mark.asyncio
async def test_accepting_straight_into_a_higher_league_needs_the_reason_too(flow):
    w = await two_leagues(flow)
    application = await submitted(flow, w, w["teams"][0])
    bare = await decide(flow, w, application, "accept", tournament_id=w["tid"])
    assert bare.status_code == 422
    assert (await stored(flow, application))["status"] == "submitted"
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": w["tid"]}) == 0
    ok(await decide(flow, w, application, "accept", tournament_id=w["tid"], deviation_reason=REASON))
    kept = await stored(flow, application)
    assert kept["status"] == "accepted" and kept["assignment"]["deviation_reason"] == REASON


@pytest.mark.asyncio
async def test_switched_off_the_lead_assigns_freely(flow):
    w = await two_leagues(flow, new_squads_lowest_division=False)
    application = ok(await decide(flow, w, await submitted(flow, w, w["teams"][0]), "accept"))
    page = ok(await flow.get(inbox_url(w)))
    assert page["new_lowest"] is False and page["items"][0]["target_division_id"] is None
    ok(await decide(flow, w, application, "assign", tournament_id=w["tid"]))


@pytest.mark.asyncio
async def test_a_season_from_before_the_field_behaves_as_before(flow):
    w = await two_leagues(flow)
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$unset": {"new_squads_lowest_division": ""}})
    application = ok(await decide(flow, w, await submitted(flow, w, w["teams"][0]), "accept"))
    ok(await decide(flow, w, application, "assign", tournament_id=w["tid"]))
    assert "deviation_reason" not in (await stored(flow, application))["assignment"]


@pytest.mark.asyncio
async def test_with_one_league_nothing_changes(flow):
    w = await application_world(flow, teams=1)
    application = await submitted(flow, w, w["teams"][0])
    ok(await decide(flow, w, application, "accept", tournament_id=w["tid"]))
    assert (await stored(flow, application))["assignment"]["tournament_id"] == w["tid"]
