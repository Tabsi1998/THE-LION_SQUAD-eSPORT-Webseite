"""Station löschen, solange Spiele daran hängen (Praxis 14.10.) - durch die echten Routen.

Die alte Matchplanung hing an einer Station, die danach gelöscht wurde: die Spiele behielten die Kennung einer Station,
die es nicht mehr gab, und der Plan war nicht mehr zu lesen. Jetzt lehnt das Löschen ab, solange ein Spiel, das nicht
vorbei ist, an der Station hängt - es nennt die Spiele und den Weg (umlegen oder Termine lösen). Was vorbei ist, hält
die Station nicht fest.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id, now_utc  # noqa: E402
from routes import match_routes, station_routes  # noqa: E402
from services import match_scheduler  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def on_site_cup(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    start = (now_utc() + timedelta(hours=1)).replace(microsecond=0)
    tournament, _users, _registrations = await flow.with_participants(
        4, event_mode="local", schedule_mode="fixed_by_staff", result_entry_mode=None, start_date=start.isoformat())
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    station = {"id": new_id(), "name": "Switch 1", "device_type": "switch2", "tournament_id": tournament["id"],
               "status": "free", "current_match_id": None, "notes": None}
    await flow.db.stations.insert_one(dict(station))
    matches = [match for match in await flow.matches(tournament) if not match.get("is_preview")]
    return tournament, station, matches


async def put_on(flow, match, station, **fields):
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
        "station_id": station["id"], "scheduled_at": (now_utc() + timedelta(hours=2)).isoformat(),
        "schedule_source": "manual", **fields}})


@pytest.mark.asyncio
async def test_a_station_with_an_unstarted_match_is_not_deleted(flow):
    _tournament, station, matches = await on_site_cup(flow)
    await put_on(flow, matches[0], station)
    response = await flow.delete(f"/api/stations/{station['id']}")
    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert "Switch 1" in detail and "1 Spiel" in detail and "Matchplan" in detail
    assert (matches[0].get("match_key") or "") in detail
    assert await flow.db.stations.find_one({"id": station["id"]}) is not None
    kept = await flow.db.matches_v2.find_one({"id": matches[0]["id"]}, {"_id": 0})
    assert kept["station_id"] == station["id"] and kept["scheduled_at"] and kept["schedule_source"] == "manual"


@pytest.mark.asyncio
async def test_a_running_match_also_keeps_its_station(flow):
    _tournament, station, matches = await on_site_cup(flow)
    await put_on(flow, matches[0], station, status="in_progress", started_at=now_utc().isoformat())
    response = await flow.delete(f"/api/stations/{station['id']}")
    assert response.status_code == 409, response.text
    assert await flow.db.stations.find_one({"id": station["id"]}) is not None


@pytest.mark.asyncio
async def test_finished_matches_do_not_hold_the_station(flow):
    _tournament, station, matches = await on_site_cup(flow)
    await put_on(flow, matches[0], station, status="completed")
    response = await flow.delete(f"/api/stations/{station['id']}")
    assert response.status_code == 200, response.text
    assert await flow.db.stations.find_one({"id": station["id"]}) is None
    # Die Geschichte bleibt: das gespielte Spiel behält, wo es gespielt wurde.
    assert (await flow.db.matches_v2.find_one({"id": matches[0]["id"]}))["station_id"] == station["id"]


@pytest.mark.asyncio
async def test_a_station_without_matches_is_deleted(flow):
    _tournament, station, _matches = await on_site_cup(flow)
    response = await flow.delete(f"/api/stations/{station['id']}")
    assert response.status_code == 200, response.text
    assert await flow.db.stations.find_one({"id": station["id"]}) is None


# ---- verschränkt (Codex zu #1611): Zwischen Prüfung und Löschen darf kein Spiel an die Station kommen - und kein Spiel
# an eine Station, die gerade gelöscht wird. Löschen markiert die Station zuerst (deleting), prüft dann; Zuweisungen
# lehnen markierte Stationen ab und prüfen nach dem Schreiben noch einmal.

@pytest.mark.asyncio
async def test_an_assignment_while_the_station_is_being_deleted_is_refused(flow, monkeypatch):
    _tournament, station, matches = await on_site_cup(flow)
    seen = {}
    original = station_routes.load_matches_by_query

    async def assign_in_between(db, query, **kwargs):
        # Die Station ist schon markiert, die Prüfung noch nicht gelaufen: genau jetzt wollen zwei Wege zuweisen.
        seen["patch"] = await flow.patch(f"/api/matches/{matches[0]['id']}", json={"station_id": station["id"]})
        seen["assign"] = await flow.post(f"/api/stations/{station['id']}/assign/{matches[1]['id']}")
        return await original(db, query, **kwargs)

    monkeypatch.setattr(station_routes, "load_matches_by_query", assign_in_between)
    response = await flow.delete(f"/api/stations/{station['id']}")
    assert response.status_code == 200, response.text
    assert seen["patch"].status_code == 409, seen["patch"].text
    assert seen["assign"].status_code == 409, seen["assign"].text
    assert await flow.db.stations.find_one({"id": station["id"]}) is None
    assert not await flow.db.matches_v2.find_one({"station_id": station["id"]})


@pytest.mark.asyncio
async def test_a_deletion_while_a_match_is_being_put_on_the_station_is_caught_after_writing(flow, monkeypatch):
    _tournament, station, matches = await on_site_cup(flow)
    seen = {}
    original = match_routes.ensure_station_open

    async def delete_in_between(db, station_id):
        # Die Zuweisung hat die Station geprüft (offen), noch nicht geschrieben: genau jetzt wird gelöscht.
        await original(db, station_id)
        seen["delete"] = await flow.delete(f"/api/stations/{station['id']}")

    monkeypatch.setattr(match_routes, "ensure_station_open", delete_in_between)
    response = await flow.patch(f"/api/matches/{matches[0]['id']}", json={"station_id": station["id"]})
    assert seen["delete"].status_code == 200, seen["delete"].text
    assert response.status_code == 409, response.text
    assert not await flow.db.matches_v2.find_one({"station_id": station["id"]}), "kein Spiel an einer gelöschten Station"


@pytest.mark.asyncio
async def test_applying_a_plan_onto_a_station_being_deleted_writes_nothing_there(flow):
    tournament, station, matches = await on_site_cup(flow)
    match = matches[0]
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"schedule_forecast": True, "updated_at": "vorher"},
                                                              "$unset": {"schedule_written_at": ""}})
    match = await flow.db.matches_v2.find_one({"id": match["id"]}, {"_id": 0})
    await flow.db.stations.update_one({"id": station["id"]}, {"$set": {"deleting": True}})
    plan = {"assignments": [{
        "match_id": match["id"], "changed": True, "schedule_source": "planner", "station_id": station["id"],
        "scheduled_at": (now_utc() + timedelta(hours=3)).isoformat(), "forecast": False,
        "previous": {"scheduled_at": match.get("scheduled_at"), "schedule_source": match.get("schedule_source"),
                     "status": match.get("status"), "station_id": match.get("station_id")},
    }]}
    result = await match_scheduler.apply_plan(flow.db, tournament, plan)
    assert result["written"] == 0
    assert any(item.get("type") == "station_gone" for item in result["warnings"])
    after = await flow.db.matches_v2.find_one({"id": match["id"]}, {"_id": 0})
    assert after.get("station_id") == match.get("station_id") and after.get("scheduled_at") == match.get("scheduled_at")
    # Alles, was der Plan gesetzt hat, steht wieder wie vorher - auch Prognose und Schreib-Metadaten (Codex zu #1611).
    assert after == match


@pytest.mark.asyncio
async def test_a_failed_deletion_takes_its_mark_back(flow):
    _tournament, station, matches = await on_site_cup(flow)
    await put_on(flow, matches[0], station)
    refused = await flow.delete(f"/api/stations/{station['id']}")
    assert refused.status_code == 409
    assert not (await flow.db.stations.find_one({"id": station["id"]})).get("deleting")
    # Und die Station nimmt danach wieder Spiele an.
    response = await flow.patch(f"/api/matches/{matches[1]['id']}", json={"station_id": station["id"]})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_a_failure_while_deleting_takes_the_mark_back(flow, monkeypatch):
    # Codex zu #1611: bräche das Löschen nach dem Markieren ab, bliebe die Station sonst für immer gesperrt.
    _tournament, station, matches = await on_site_cup(flow)

    async def broken(*_args, **_kwargs):
        raise RuntimeError("Datenbank weg")

    monkeypatch.setattr(station_routes, "load_matches_by_query", broken)
    with pytest.raises(RuntimeError):
        await flow.delete(f"/api/stations/{station['id']}")
    assert not (await flow.db.stations.find_one({"id": station["id"]})).get("deleting")


@pytest.mark.asyncio
async def test_the_patch_rollback_restores_the_match_exactly(flow, monkeypatch):
    # Codex zu #1611: auch ein per $unset entferntes „aufgerufen um“ kommt zurück, und nichts Neues bleibt stehen.
    _tournament, station, matches = await on_site_cup(flow)
    await flow.db.matches_v2.update_one({"id": matches[0]["id"]}, {"$set": {"called_at": "2026-10-14T18:00:00+00:00"}})
    before = await flow.db.matches_v2.find_one({"id": matches[0]["id"]}, {"_id": 0})
    original = match_routes.ensure_station_open

    async def delete_in_between(db, station_id):
        await original(db, station_id)
        await flow.delete(f"/api/stations/{station['id']}")

    monkeypatch.setattr(match_routes, "ensure_station_open", delete_in_between)
    response = await flow.patch(f"/api/matches/{matches[0]['id']}", json={
        "station_id": station["id"], "scheduled_at": (now_utc() + timedelta(hours=4)).isoformat()})
    assert response.status_code == 409, response.text
    assert await flow.db.matches_v2.find_one({"id": matches[0]["id"]}, {"_id": 0}) == before
