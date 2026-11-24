"""Einstellungen und Rechte für Playoffs und Relegation (#2404, docs/LIGA.md „F.6 … Rechte“; Nr. 218, 228, 232) - über die echten Routen.

Wer einstellen und anlegen darf, Befangenheit mit Notausnahme, die Sperre ab dem ersten Abschluss, die Abweichung je Liga N - und dass
„Vorgaben auf Staffeln übertragen“ eine Playoff-Staffel nicht zurück auf die Werte der Season setzt. Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_postseason_world import build, close, cockpit, create, division_of  # noqa: E402
from league_start_world import ADMIN, ok  # noqa: E402
from models import now_utc  # noqa: E402

PLAYOFFS_4 = {"playoffs": {"enabled": True, "per_staffel": 4}}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def lead(flow, league: dict, name: str, *capabilities: str) -> dict:
    user = await flow.add_user(name=name)
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league["id"], "user_id": user["id"],
                                           "capabilities": list(capabilities), "created_at": now_utc().isoformat()})
    return user


def url(world: dict, tail: str = "") -> str:
    return f"{ADMIN}/seasons/{world['season']['id']}/postseason{tail}"


async def own_team(flow, world: dict, user: dict) -> None:
    """Die Person leitet das Team auf Platz 3 der Staffel A von Liga 1."""
    registration = world["regs"][world["tids"][1][0]][2]
    await flow.db.teams.update_one({"id": registration["team_id"]}, {"$set": {"leader_id": user["id"]}})


# ---------------------------------------------------------------- Rechte

@pytest.mark.asyncio
async def test_everybody_in_the_league_reads_but_only_season_saves_and_creates(flow):
    world = await build(flow, postseason=PLAYOFFS_4)
    await close(flow, world)
    planner = await lead(flow, world["league"], "Planerin", "matches", "results")
    flow.act_as(planner)
    view = ok(await flow.get(url(world)))
    assert view["can_act"] is False and division_of(view, 1)["playoffs"]["can_create"] is False
    assert (await flow.put(url(world), json=PLAYOFFS_4)).status_code == 403
    assert (await flow.put(f"{ADMIN}/divisions/{world['divisions'][1]['id']}/postseason", json={})).status_code == 403
    refused = await create(flow, world, "playoffs", actor=planner)
    assert refused.status_code == 403 and await flow.db.tournaments.count_documents({"league_context.kind": "playoff"}) == 0
    flow.act_as(await flow.add_user(name="Fremde"))
    assert (await flow.get(url(world))).status_code == 403
    flow.act_as(None)
    assert (await flow.get(url(world))).status_code in (401, 403)
    configurer = await lead(flow, world["league"], "Season-Leitung", "season")
    created = await create(flow, world, "playoffs", actor=configurer)
    assert created.status_code == 200, created.text
    log = await flow.db.audit_logs.find_one({"action": "league.postseason.create"}, {"_id": 0})
    assert log["actor_id"] == configurer["id"] and log["data"]["kind"] == "playoff" and log["data"]["teams"] == 4


@pytest.mark.asyncio
async def test_nobody_creates_the_playoffs_of_the_own_team_except_the_superadmin_with_a_reason(flow):
    world = await build(flow, postseason=PLAYOFFS_4)
    await close(flow, world)
    involved = await lead(flow, world["league"], "Leitung im Team", "season")
    await own_team(flow, world, involved)
    flow.act_as(involved)
    part = division_of(ok(await flow.get(url(world))), 1)["playoffs"]
    assert part["own_team"] is True and part["can_create"] is False
    refused = await create(flow, world, "playoffs", actor=involved)
    assert refused.status_code == 403 and "andere Person" in refused.json()["detail"]
    # Der Superadmin als Notausnahme, mit Grund - im Protokoll.
    await own_team(flow, world, world["lead"])
    bare = await create(flow, world, "playoffs")
    assert bare.status_code == 403 and "Notausnahme" in bare.json()["detail"]
    ok(await create(flow, world, "playoffs", conflict_reason="Niemand sonst erreichbar"))
    override = await flow.db.audit_logs.find_one({"action": "league.conflict.override"}, {"_id": 0})
    assert override["data"]["action"] == "postseason_create" and override["data"]["reason"] == "Niemand sonst erreichbar"


# ---------------------------------------------------------------- Speichern, Abweichung, Sperre

@pytest.mark.asyncio
async def test_settings_are_saved_per_season_and_a_division_may_differ(flow):
    world = await build(flow, levels=2)
    flow.act_as(world["lead"])
    saved = ok(await flow.put(url(world), json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 5, "third_place": True},
                                                "champion_source": "playoffs"}))
    assert saved["settings"]["playoffs"]["best_of"] == 5 and saved["settings"]["champion_source"] == "playoffs"
    division = world["divisions"][2]["id"]
    ok(await flow.put(f"{ADMIN}/divisions/{division}/postseason", json={"playoffs": {"enabled": True, "per_staffel": 2}}))
    view = await cockpit(flow, world)
    assert view["configured"] and view["settings"]["playoffs"]["per_staffel"] == 4
    upper, lower = division_of(view, 1), division_of(view, 2)
    assert upper["settings"]["playoffs"]["per_staffel"] == 4 and upper["settings"]["playoffs"]["third_place"] is True
    assert lower["settings"]["playoffs"]["per_staffel"] == 2 and lower["settings"]["playoffs"]["third_place"] is False
    assert lower["settings"]["playoffs"]["best_of"] == 3 and lower["settings"]["own"] == {"playoffs": True, "relegation": False}
    # Ein leerer Körper heißt wieder „wie die Season“.
    ok(await flow.put(f"{ADMIN}/divisions/{division}/postseason", json={}))
    assert division_of(await cockpit(flow, world), 2)["settings"]["playoffs"]["per_staffel"] == 4
    stored = await flow.db.league_divisions.find_one({"id": division}, {"_id": 0})
    assert "postseason" not in stored
    log = await flow.db.audit_logs.count_documents({"action": "league.postseason.settings"})
    assert log == 3


@pytest.mark.asyncio
async def test_wrong_settings_are_refused_in_plain_words(flow):
    world = await build(flow)
    flow.act_as(world["lead"])
    missing = await flow.put(url(world), json={"playoffs": {"enabled": True}})
    assert missing.status_code == 422 and "wie viele Teams" in missing.json()["detail"]
    champion = await flow.put(url(world), json={"champion_source": "playoffs"})
    assert champion.status_code == 422 and "braucht Playoffs in der obersten Liga" in champion.json()["detail"]
    unknown = await flow.put(url(world), json={"playoffs": {"enabled": True, "per_staffel": 4, "wildcards": 2}})
    assert unknown.status_code == 422
    assert "postseason" not in await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_after_the_first_close_the_sporting_values_are_fixed(flow):
    world = await build(flow, staffeln={1: [4, 4]}, postseason=PLAYOFFS_4)
    await close(flow, world, world["tids"][1][0])
    flow.act_as(world["lead"])
    # Nr. 228: Plätze je Staffel, an/aus und „Meister aus“ stehen ab dem ersten Abschluss fest - der Endstand hält sie fest.
    for body in ({"playoffs": {"enabled": True, "per_staffel": 2}}, {"playoffs": {"enabled": False}},
                 {**PLAYOFFS_4, "champion_source": "playoffs"}):
        refused = await flow.put(url(world), json=body)
        assert refused.status_code == 409 and "abgeschlossen" in refused.json()["detail"], body
    own = await flow.put(f"{ADMIN}/divisions/{world['divisions'][1]['id']}/postseason", json={"playoffs": {"enabled": True, "per_staffel": 3}})
    assert own.status_code == 409
    # Best of, Platz 3, Heimrecht und Termine bleiben bis zum Anlegen änderbar.
    ok(await flow.put(url(world), json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 5, "third_place": True, "home": "draw"}}))
    assert division_of(await cockpit(flow, world), 1)["locked"] is True


@pytest.mark.asyncio
async def test_transferring_the_season_defaults_leaves_the_playoff_staffel_alone(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 5}})
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    before = await flow.db.tournaments.find_one({"league_context.kind": "playoff"}, {"_id": 0})
    flow.act_as(world["lead"])
    report = ok(await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/sync"))
    after = await flow.db.tournaments.find_one({"league_context.kind": "playoff"}, {"_id": 0})
    # V3: Format, Best of und Kalender gehören der Playoff-Staffel - das Übertragen setzt sie nicht auf die Werte der Season zurück.
    for key in ("format", "best_of", "start_date", "end_date", "max_participants", "matchday_weeks_total", "veto_rules"):
        assert after.get(key) == before.get(key), key
    assert after["best_of"] == 5 and after["format"] == "single_elim"
    own = next(row for row in report["staffeln"] if row["tournament_id"] == before["id"])
    assert {row["group"] for row in own["skipped"]} >= {"before_start", "before_result"}
    assert any("eigene Werte" in row["reason"] for row in own["skipped"])
