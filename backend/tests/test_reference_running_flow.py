"""Laeuft gerade und Heute im Einsatz (#1748) ueber die echte Route ``GET /api/reference-series/public/running``:
nur laufende, sichtbare Saisons, Fortschritt, naechster Termin, Platz des Vereins - und keine fremden Namen.
Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes, reference_series_public_routes  # noqa: E402
from services import migrations  # noqa: E402

ADMIN = "/api/reference-series/admin"
RUNNING = "/api/reference-series/public/running"
OWN = "Probe Löwen"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-09")
    monkeypatch.setattr(reference_series_public_routes, "club_today", lambda: "2026-11-09")
    try:
        yield instance
    finally:
        await shutdown()


async def _season(flow, title, kind, season, days, *, status="active", visibility="public", **extra):
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": title, "kind": kind, "game_name": "Probespiel"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": season, "status": status, "visibility": visibility,
        "default_time": "20:00", **extra})).json()
    assert series.get("id"), series
    rounds = {}
    for code, day in days:
        response = await flow.post(f"{ADMIN}/series/{series['id']}/rounds", json={"code": code, "day": day})
        assert response.status_code == 200, response.text
        rounds[code] = response.json()["id"]
    return lineage, series, rounds


async def _scored(flow, series, round_id, seq, scope, rows):
    await flow.db.reference_rounds.update_one({"id": round_id}, {"$set": {"status": "scored"}})
    await flow.db.reference_standings.insert_one({
        "series_id": series["id"], "round_id": round_id, "round_seq": seq, "scope": scope, "rows": rows})


async def _setup(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    cup, cup_series, cup_rounds = await _season(
        flow, "Probe Monatscup", "series", "2026",
        [("Q1", "2026-11-02"), ("Q2", "2026-11-09"), ("Q3", "2026-11-16")])
    await flow.db.reference_participants.insert_many([
        {"id": "p-alpha", "series_id": cup_series["id"], "name": "Probe Alpha", "link": "member",
         "is_club_member": True, "name_hidden": False},
        {"id": "p-beta", "series_id": cup_series["id"], "name": "Fremd Beta", "link": "external",
         "is_club_member": False, "name_hidden": False},
    ])
    await _scored(flow, cup_series, cup_rounds["Q1"], 1, "drivers", [
        {"participant_id": "p-beta", "rank": 1, "points": 10}, {"participant_id": "p-alpha", "rank": 2, "points": 8}])
    league, league_series, league_rounds = await _season(
        flow, "Probe Liga 4vs4", "team_league", "2026", [("ST1", "2026-11-23"), ("ST2", "2026-11-30")],
        team_name=OWN)
    return admin, cup, cup_series, cup_rounds, league, league_series, league_rounds


@pytest.mark.asyncio
async def test_running_lists_active_seasons_with_progress_next_date_and_rank(flow):
    await _setup(flow)
    flow.act_as(None)
    response = await flow.get(RUNNING)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["today"] == "2026-11-09"
    by_title = {item["lineage"]["title"]: item for item in body["items"]}
    cup = by_title["Probe Monatscup"]
    assert cup["progress"] == {"total": 3, "scored": 1}
    assert (cup["next"]["code"], cup["next"]["club_day"], cup["next"]["state"]) == ("Q2", "2026-11-09", "today")
    assert cup["today"] is True
    assert cup["club"] == {"rank": 2, "of": 2}
    assert cup["series"]["season"] == "2026" and cup["lineage"]["slug"] and cup["series"]["season_slug"]
    league = by_title["Probe Liga 4vs4"]
    assert league["today"] is False and league["club"] is None
    assert league["next"]["code"] == "ST1" and league["progress"] == {"total": 2, "scored": 0}
    # Heute zuerst.
    assert [item["lineage"]["title"] for item in body["items"]] == ["Probe Monatscup", "Probe Liga 4vs4"]


@pytest.mark.asyncio
async def test_running_shows_the_own_team_rank_of_a_team_league(flow):
    *_, league_series, league_rounds = await _setup(flow)
    await _scored(flow, league_series, league_rounds["ST1"], 1, "table",
                  [{"team": "Fremd Füchse", "rank": 1}, {"team": OWN, "rank": 2}, {"team": "Fremd Bären", "rank": 3}])
    flow.act_as(None)
    items = (await flow.get(RUNNING)).json()["items"]
    league = next(item for item in items if item["lineage"]["kind"] == "team_league")
    assert league["club"] == {"rank": 2, "of": 3}
    assert "Fremd Füchse" not in str(items)


@pytest.mark.asyncio
async def test_running_hides_planned_completed_archived_and_hidden_series_and_foreign_names(flow):
    admin, cup, *_ = await _setup(flow)
    await _season(flow, "Geplant", "series", "2027", [("A1", "2027-01-03")], status="planned")
    await _season(flow, "Fertig", "series", "2025", [("A1", "2025-01-03")], status="completed")
    await _season(flow, "Nur Mitglieder", "series", "2026", [("A1", "2026-12-03")], visibility="members")
    flow.act_as(None)
    response = await flow.get(RUNNING)
    titles = [item["lineage"]["title"] for item in response.json()["items"]]
    assert sorted(titles) == ["Probe Liga 4vs4", "Probe Monatscup"]
    assert "Fremd Beta" not in response.text and "Probe Alpha" not in response.text
    flow.act_as(admin)
    await flow.db.reference_lineages.update_one({"id": cup["id"]}, {"$set": {"is_archived": True}})
    flow.act_as(None)
    titles = [item["lineage"]["title"] for item in (await flow.get(RUNNING)).json()["items"]]
    assert titles == ["Probe Liga 4vs4"]


@pytest.mark.asyncio
async def test_running_is_empty_without_active_series(flow):
    flow.act_as(None)
    body = (await flow.get(RUNNING)).json()
    assert body["items"] == []
