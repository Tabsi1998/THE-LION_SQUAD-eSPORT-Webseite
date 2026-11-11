"""Season-Felder der Gruppe ``incidents`` (docs/LIGA.md, „D.5/E.2-Vertrag“ → „Season-Felder“, #1619). Erfundene Namen.

Über die echten Routen: speichern an der Season, Grenzen, „Übertragen“ in eine laufende Staffel (wie Check-in), nicht in eine
gesperrte, und die Variablen im Regeltext.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_start_world import ADMIN, build, ok, start  # noqa: E402
from services import league_incidents, league_rule_vars, league_service  # noqa: E402
from services.league_presets import INCIDENT_FIELDS, PRESETS  # noqa: E402

VALUES = {"map_break_after": 3, "map_break_minutes": 10, "incident_answer_minutes": 15, "incident_quota_per_map": 2,
          "clarification_mode": "pause_series"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def staffel(flow, world: dict) -> dict:
    return await flow.db.tournaments.find_one({"id": world["tid"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_a_season_without_the_fields_uses_the_presets(flow):
    world = await build(flow, 2)
    season = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    assert not any(key in season for key in INCIDENT_FIELDS), "keine Migration: jedes Feld ist optional"
    tournament = await staffel(flow, world)
    assert not any(key in tournament for key in INCIDENT_FIELDS)
    assert await league_incidents.settings_for(flow.db, tournament) == {key: PRESETS[key] for key in INCIDENT_FIELDS}


@pytest.mark.asyncio
async def test_saved_values_reach_a_running_staffel_by_transfer_but_not_a_locked_one(flow):
    world = await build(flow, 2)
    assert (await start(flow, world)).status_code == 200
    flow.act_as(world["lead"])
    saved = ok(await flow.patch(f"{ADMIN}/seasons/{world['season']['id']}", json=VALUES))
    season = saved.get("season") or saved
    assert {key: season[key] for key in INCIDENT_FIELDS} == VALUES
    untouched = await staffel(flow, world)
    assert not any(key in untouched for key in INCIDENT_FIELDS), "erst das Übertragen bringt die Werte in die Staffel"

    # Gesperrte Staffel: die Gruppe wird ausgelassen - mit Grund.
    await flow.db.tournaments.update_one({"id": world["tid"]}, {"$set": {"locked_at": "2026-11-01T00:00:00+00:00"}})
    locked = ok(await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/sync"))
    row = next(item for item in locked["staffeln"] if item["tournament_id"] == world["tid"])
    assert "incidents" not in row["applied"]
    assert any(item["group"] == "incidents" and item["label"] == "Vorfälle und Pausen" for item in row["skipped"])
    still = await staffel(flow, world)
    assert not any(key in still for key in INCIDENT_FIELDS)

    # Laufende, nicht gesperrte Staffel: wie der Check-in gehen die Werte auch während der Season über.
    await flow.db.tournaments.update_one({"id": world["tid"]}, {"$set": {"locked_at": None}})
    synced = ok(await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/sync"))
    row = next(item for item in synced["staffeln"] if item["tournament_id"] == world["tid"])
    assert "incidents" in row["applied"] and set(INCIDENT_FIELDS) <= set(row["changed"])
    tournament = await staffel(flow, world)
    assert {key: tournament[key] for key in INCIDENT_FIELDS} == VALUES
    assert await league_incidents.settings_for(flow.db, tournament) == VALUES


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [
    ("incident_answer_minutes", 0), ("incident_answer_minutes", 121), ("incident_quota_per_map", -1), ("incident_quota_per_map", 6),
    ("map_break_after", 0), ("map_break_after", 8), ("map_break_minutes", -1), ("map_break_minutes", 61),
    ("clarification_mode", "abbrechen"),
])
async def test_values_outside_the_range_are_refused(flow, field, value):
    world = await build(flow, 2)
    flow.act_as(world["lead"])
    refused = await flow.patch(f"{ADMIN}/seasons/{world['season']['id']}", json={field: value})
    assert refused.status_code == 422, refused.text
    assert field not in await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_an_empty_value_keeps_what_is_stored(flow):
    """Gegenprobe: ``null`` löscht keinen Wert - die Felder bleiben wie die anderen Pflichtwerte der Season."""
    world = await build(flow, 2)
    flow.act_as(world["lead"])
    ok(await flow.patch(f"{ADMIN}/seasons/{world['season']['id']}", json={"incident_answer_minutes": 15}))
    ok(await flow.patch(f"{ADMIN}/seasons/{world['season']['id']}", json={"incident_answer_minutes": None}))
    assert (await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0}))["incident_answer_minutes"] == 15


def test_the_group_and_the_rule_variable_are_registered():
    assert league_service.SYNC_GROUPS["incidents"] == INCIDENT_FIELDS
    assert league_service.SYNC_GROUP_LABELS["incidents"] == "Vorfälle und Pausen"
    assert set(INCIDENT_FIELDS) <= set(league_service.SEASON_FIELDS) and set(INCIDENT_FIELDS) <= league_service.STAFFEL_SOURCE_FIELDS
    # Ohne Feld an der Season nimmt die Staffel nichts mit - mit Feld genau diesen Wert.
    league, division = {"game_id": "g", "name": "L"}, {"level": 1}
    base = {"id": "s", "start_date": "2026-11-01T00:00:00+00:00", "name": "S"}
    assert not any(key in league_service.staffel_fields(league, base, division) for key in INCIDENT_FIELDS)
    fields = league_service.staffel_fields(league, {**base, **VALUES}, division)
    assert {key: fields[key] for key in INCIDENT_FIELDS} == VALUES
    assert "incident.answer_minutes" in league_rule_vars.STATIC
