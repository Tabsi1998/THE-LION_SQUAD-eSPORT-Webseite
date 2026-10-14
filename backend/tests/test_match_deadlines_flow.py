"""Frist „nicht erschienen“ (#1551, Entscheidung E6): vor Ort 10 Minuten ab Aufruf, online 15 Minuten ab Öffnung des
Spiels - je Turnier und Phase einstellbar. Nach Ablauf entsteht genau einmal ein Vorschlag „kampflos verloren“ (nur dieses
Spiel) für die Turnierleitung: als Nachricht und in der Ansicht „Braucht Aufmerksamkeit“. Die Turnierleitung bestätigt
(Wertung über den bestehenden Forfeit-Weg) oder verlängert.
"""
import asyncio
import inspect
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import scheduler  # noqa: E402
from services.match_deadline_sweep import sweep  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def ago(minutes: float) -> str:
    return (now_utc() - timedelta(minutes=minutes)).isoformat()


def later(minutes: float):
    return now_utc() + timedelta(minutes=minutes)


async def bracket(flow, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    match = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[0]
    first, second = [slot["registration_id"] for slot in match["slots"]]
    player = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    return staff, tournament, match, first, second, player


async def proposals(flow) -> list[dict]:
    return await flow.db.audit_logs.find({"action": "match.no_show.proposed"}, {"_id": 0}).to_list(20)


async def lead(flow, tournament) -> dict:
    response = await flow.get(f"/api/tournaments/{tournament['id']}/lead")
    assert response.status_code == 200, response.text
    return response.json()


async def decide(flow, tournament, match, **body):
    return await flow.post(f"/api/tournaments/{tournament['id']}/lead/no-show/{match['id']}", json=body)


@pytest.mark.asyncio
async def test_on_site_ten_minutes_after_the_call_one_proposal(flow):
    staff, tournament, match, first, second, _player = await bracket(flow, event_mode="local")
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"station_id": "station-1", "called_at": ago(9)}})
    assert (await sweep(flow.db))["proposed"] == 0, "9 Minuten nach dem Aufruf ist die Frist noch nicht um"

    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"called_at": ago(11)}})
    assert (await sweep(flow.db))["proposed"] == 1
    assert (await sweep(flow.db))["proposed"] == 0, "der Vorschlag entsteht genau einmal"
    stored = await flow.reload(match)
    assert stored["no_show_proposal"]["rule"] == "on_site" and stored["no_show_proposal"]["minutes"] == 10
    assert len(await proposals(flow)) == 1
    notes = await flow.db.notifications.find({"kind": "match_attention", "meta.reason": "no_show"}, {"_id": 0}).to_list(10)
    assert [row["user_id"] for row in notes] == [staff["id"]], "eine Nachricht an die Turnierleitung"
    assert f"fall=ns-{match['id']}" in notes[0]["url"]

    item = next(row for row in (await lead(flow, tournament))["attention"] if row["kind"] == "no_show")
    assert item["id"] == f"ns-{match['id']}" and item["action"] == "no_show"
    assert {row["registration_id"] for row in item["participants"]} == {first, second}


@pytest.mark.asyncio
async def test_online_fifteen_minutes_after_the_match_opens(flow):
    _staff, _tournament, match, first, second, player = await bracket(flow, event_mode="online")
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": ago(14)}})
    assert (await sweep(flow.db))["proposed"] == 0
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": ago(16)}})
    assert (await sweep(flow.db))["proposed"] == 1
    assert (await flow.reload(match))["no_show_proposal"]["rule"] == "online"


@pytest.mark.asyncio
async def test_a_reported_match_was_played(flow):
    _staff, _tournament, match, first, second, player = await bracket(flow, event_mode="online")
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": ago(30)}})
    flow.act_as(player[first])
    reported = await flow.post(f"/api/matches/{match['id']}/report",
                               json={"results": [{"registration_id": first, "rank": 1}, {"registration_id": second, "rank": 2}]})
    assert reported.status_code == 200, reported.text
    assert (await sweep(flow.db, now=now_utc()))["proposed"] == 0, "wer meldet, ist erschienen"


@pytest.mark.asyncio
async def test_deadline_is_set_per_tournament_and_per_phase(flow):
    _staff, tournament, match, _first, _second, _player = await bracket(flow, event_mode="online", no_show_minutes_online=30)
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": ago(16)}})
    assert (await sweep(flow.db))["proposed"] == 0, "das Turnier hat 30 Minuten eingestellt"
    await flow.db.tournament_stages.update_one({"id": match["stage_id"]}, {"$set": {"settings.no_show_minutes_online": 5}})
    assert (await sweep(flow.db))["proposed"] == 1, "die Phase geht vor"


@pytest.mark.asyncio
async def test_extend_then_new_proposal_after_the_extension(flow):
    _staff, tournament, match, _first, _second, _player = await bracket(flow, event_mode="local")
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"station_id": "station-1", "called_at": ago(12)}})
    await sweep(flow.db)
    extended = await decide(flow, tournament, match, action="extend", minutes=5)
    assert extended.status_code == 200, extended.text
    stored = await flow.reload(match)
    assert not stored.get("no_show_proposal") and stored.get("no_show_extended_until")
    assert not [row for row in (await lead(flow, tournament))["attention"] if row["kind"] == "no_show"]
    assert (await sweep(flow.db))["proposed"] == 0, "innerhalb der Verlängerung kein neuer Vorschlag"
    assert (await sweep(flow.db, now=later(6)))["proposed"] == 1
    assert await flow.db.audit_logs.count_documents({"action": "match.no_show.extended"}) == 1


@pytest.mark.asyncio
async def test_confirm_counts_as_walkover_for_this_match_only(flow):
    _staff, tournament, match, first, second, _player = await bracket(flow, event_mode="local")
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"station_id": "station-1", "called_at": ago(12)}})
    await sweep(flow.db)
    missing_side = await decide(flow, tournament, match, action="confirm")
    assert missing_side.status_code == 422, "wer nicht erschienen ist, wählt die Turnierleitung"
    confirmed = await decide(flow, tournament, match, action="confirm", registration_id=second)
    assert confirmed.status_code == 200, confirmed.text
    stored = await flow.reload(match)
    assert stored["status"] == "forfeit" and stored["forfeit_registration_id"] == second
    assert stored["no_show_proposal"]["decision"] == "confirmed"
    follow_up = await flow.match_for(tournament, first, after_round=match["round"])
    assert follow_up is not None, "die andere Seite rückt weiter"
    assert await flow.db.audit_logs.count_documents({"action": "match.forfeit"}) == 1
    again = await decide(flow, tournament, match, action="confirm", registration_id=second)
    assert again.status_code == 200 and again.json()["idempotent_replay"] is True
    assert not [row for row in (await lead(flow, tournament))["attention"] if row["kind"] == "no_show"]


@pytest.mark.asyncio
async def test_parallel_sweeps_create_one_proposal(flow):
    _staff, _tournament, match, _first, _second, _player = await bracket(flow, event_mode="local")
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"station_id": "station-1", "called_at": ago(12)}})
    results = await asyncio.gather(sweep(flow.db), sweep(flow.db))
    assert sum(row["proposed"] for row in results) == 1
    assert len(await proposals(flow)) == 1


def test_the_job_runs_on_one_replica_only():
    source = inspect.getsource(scheduler.start_scheduler)
    assert '_single_replica("match_deadlines", _safe_match_deadlines' in source


@pytest.mark.asyncio
async def test_deadlines_are_fields_of_the_tournament_form(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament()
    saved = await flow.patch(f"/api/tournaments/{tournament['id']}", json={
        "no_show_minutes_on_site": 7, "no_show_minutes_online": 20, "result_confirm_minutes_online": 30, "result_confirm_hours_league": 72})
    assert saved.status_code == 200, saved.text
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert (stored["no_show_minutes_on_site"], stored["no_show_minutes_online"], stored["result_confirm_minutes_online"],
            stored["result_confirm_hours_league"]) == (7, 20, 30, 72)
    reset = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"no_show_minutes_on_site": None})
    assert reset.status_code == 200
    assert (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})).get("no_show_minutes_on_site") is None, "leer heißt Standard"
    refused = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"no_show_minutes_on_site": 0})
    assert refused.status_code == 422
