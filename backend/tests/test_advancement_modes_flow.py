"""Weiterkommen in vier Modi (#1590) über die echten Routen: Show-Auslosung („Jetzt auslosen“, Erinnerung, Zeitablauf),
sofort zufällig (parallele Ergebnisse, kein Doppel-Platz), Migration des alten Schalters und die Leitungs-Ansicht.
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
from services import change_events, scheduler  # noqa: E402
from services.draw_show import sweep  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def ranking(match: dict) -> dict:
    regs = [slot["registration_id"] for slot in match["slots"] if slot.get("registration_id")]
    return {"results": [{"registration_id": regs[0], "rank": 1, "score": 2}, {"registration_id": regs[1], "rank": 2, "score": 0}]}


async def bracket(flow, count: int = 8, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(count, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    return staff, tournament, users, registrations


async def round_matches(flow, tournament, number: int) -> list[dict]:
    rows = [m for m in await flow.matches(tournament) if m.get("round") == number and m.get("section") == "WB"]
    return sorted(rows, key=lambda m: m.get("order") or 0)


async def play_round_one(flow, tournament) -> None:
    for match in await round_matches(flow, tournament, 1):
        response = await flow.post(f"/api/matches/{match['id']}/result", json=ranking(match))
        assert response.status_code == 200, response.text


def events_since(version: int, event_type: str) -> list[dict]:
    return [e for e in list(change_events._event_buffer) if e.get("version", 0) > version
            and (e.get("tournament_event") or {}).get("type") == event_type]


async def lead(flow, tournament) -> dict:
    response = await flow.get(f"/api/tournaments/{tournament['id']}/lead")
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------------------------- Show-Auslosung

@pytest.mark.asyncio
async def test_show_round_waits_for_the_lead_and_the_lead_draws(flow):
    staff, tournament, _users, _regs = await bracket(flow, advancement_mode="draw_show")
    before = change_events._version
    await play_round_one(flow, tournament)
    second = await round_matches(flow, tournament, 2)
    assert all(m["status"] == "pending" and not m.get("draw") for m in second)
    assert all(isinstance(m.get("draw_ready"), dict) for m in second)
    ready_events = events_since(before, "draw_ready")
    assert len(ready_events) == 1
    public = change_events._event_for_scope(ready_events[0], "public")
    assert set(public["tournament_event"]["match_ids"]) == {m["id"] for m in second}
    assert staff["id"] not in str(public)
    entry = await flow.db.audit_logs.find_one({"action": "tournament.draw.ready"}, {"_id": 0})
    assert entry and entry["data"]["pot_size"] == 4
    assert not await flow.db.audit_logs.count_documents({"action": "tournament.draw.done"})

    # Die Leitungs-Ansicht zeigt den Topf mit Namen und wie lange es noch bis zum automatischen Los dauert.
    view = await lead(flow, tournament)
    draws = view["draws"]
    assert len(draws) == 1
    card = draws[0]
    group = second[0]["settings"]["draw_group"]
    assert card["group"] == group and card["stage_id"] == second[0]["stage_id"]
    assert card["label"] == "Runde 1" and card["can_draw"] is True
    assert sorted(card["pot"]) == sorted(f"Spieler {n}" for n in (1, 2, 3, 4))
    assert card["pot_size"] == 4 and card["remind_minutes"] == 10
    assert card["since"] == second[0]["draw_ready"]["since"]
    assert card["remind_at"] > card["since"] and card["due_at"] > card["remind_at"]
    assert set(card["match_ids"]) == {m["id"] for m in second}

    member = await flow.add_user()
    flow.act_as(member)
    url = f"/api/tournaments/{tournament['id']}/stages/{second[0]['stage_id']}/draw"
    assert (await flow.post(url, json={"group": group})).status_code == 403

    flow.act_as(staff)
    before = change_events._version
    response = await flow.post(url, json={"group": group})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["draw"]["trigger"] == "show" and body["draw"]["group"] == group
    drawn = await round_matches(flow, tournament, 2)
    assert all(m["status"] == "ready" and m["draw"]["id"] == body["draw"]["id"] and not m.get("draw_ready") for m in drawn)
    done = await flow.db.audit_logs.find_one({"action": "tournament.draw.done"}, {"_id": 0})
    assert done["actor_id"] == staff["id"] and done["data"]["trigger"] == "show"
    assert len(events_since(before, "draw_done")) == 1
    assert (await lead(flow, tournament))["draws"] == []
    again = await flow.post(url, json={"group": group})
    assert again.status_code == 409
    assert (await flow.post(url, json={"group": "XX:9"})).status_code == 404


@pytest.mark.asyncio
async def test_show_sweep_reminds_after_the_minutes_and_draws_after_twice_the_minutes(flow):
    staff, tournament, _users, _regs = await bracket(flow, advancement_mode="draw_show", draw_show_minutes=5)
    await play_round_one(flow, tournament)
    second = await round_matches(flow, tournament, 2)
    since = now_utc() - timedelta(minutes=6)
    await flow.db.matches_v2.update_many({"id": {"$in": [m["id"] for m in second]}},
                                         {"$set": {"draw_ready.since": since.isoformat()}})
    first = await sweep(flow.db)
    assert first == {"reminded": 1, "drawn": 0}
    notes = await flow.db.notifications.find({"meta.reason": "draw_ready"}, {"_id": 0}).to_list(10)
    assert len(notes) == 1 and notes[0]["user_id"] == staff["id"]
    assert "Auslosung" in notes[0]["title"] and "4 Namen" in notes[0]["body"]
    assert notes[0]["url"].endswith("/leitung?fall=draw-" + second[0]["settings"]["draw_group"])
    # Noch einmal: keine zweite Erinnerung, noch kein Los.
    assert await sweep(flow.db) == {"reminded": 0, "drawn": 0}
    reloaded = [await flow.reload(m) for m in second]
    assert all(not m.get("draw") for m in reloaded)
    assert reloaded[0]["draw_ready"]["reminded_at"]

    await flow.db.matches_v2.update_many({"id": {"$in": [m["id"] for m in second]}},
                                         {"$set": {"draw_ready.since": (now_utc() - timedelta(minutes=11)).isoformat()}})
    before = change_events._version
    results = await asyncio.gather(sweep(flow.db), sweep(flow.db))
    assert sum(row["drawn"] for row in results) == 1
    drawn = await round_matches(flow, tournament, 2)
    assert all(m["status"] == "ready" and m.get("draw") and m["draw"]["trigger"] == "timeout" for m in drawn)
    done = await flow.db.audit_logs.find_one({"action": "tournament.draw.done"}, {"_id": 0})
    assert done["actor_id"] is None and done["data"]["trigger"] == "timeout"
    assert len(events_since(before, "draw_done")) == 1
    assert await sweep(flow.db) == {"reminded": 0, "drawn": 0}


def test_the_show_job_runs_on_one_replica_only():
    source = inspect.getsource(scheduler.start_scheduler)
    assert '_single_replica("draw_show", _safe_draw_show' in source


@pytest.mark.asyncio
async def test_undo_of_the_last_result_takes_the_ready_state_back(flow):
    _staff, tournament, _users, _regs = await bracket(flow, advancement_mode="draw_show")
    await play_round_one(flow, tournament)
    last = (await round_matches(flow, tournament, 1))[-1]
    response = await flow.post(f"/api/matches/{last['id']}/result/undo", json={})
    assert response.status_code == 200, response.text
    second = await round_matches(flow, tournament, 2)
    assert all(not m.get("draw_ready") and not m.get("draw") for m in second)
    assert (await lead(flow, tournament))["draws"] == []
    again = await flow.post(f"/api/matches/{last['id']}/result", json=ranking(await flow.reload(last)))
    assert again.status_code == 200, again.text
    assert all(isinstance(m.get("draw_ready"), dict) for m in await round_matches(flow, tournament, 2))


# ---------------------------------------------------------------------------------------------- Sofort zufällig

@pytest.mark.asyncio
async def test_instant_parallel_results_never_share_a_seat(flow):
    staff, tournament, _users, _regs = await bracket(flow, count=16, advancement_mode="instant")
    first = await round_matches(flow, tournament, 1)
    before = change_events._version
    responses = await asyncio.gather(*[flow.post(f"/api/matches/{m['id']}/result", json=ranking(m)) for m in first])
    assert all(r.status_code == 200 for r in responses), [r.text for r in responses if r.status_code != 200]
    second = await round_matches(flow, tournament, 2)
    seated = [s["registration_id"] for m in second for s in m["slots"] if s.get("registration_id")]
    winners = {m["slots"][0]["registration_id"] for m in first}
    assert len(seated) == len(set(seated)) == 8 and set(seated) == winners
    assert all(m["status"] == "ready" for m in second)
    assert all(not m.get("draw") for m in second)
    assert all(s["source_result"]["draw_id"] for m in second for s in m["slots"])
    assert await flow.db.audit_logs.count_documents({"action": "tournament.draw.assigned"}) == 8
    entry = await flow.db.audit_logs.find_one({"action": "tournament.draw.assigned"}, {"_id": 0})
    assert entry["actor_id"] == staff["id"] and len(entry["data"]["assignments"]) == 1
    assigned = events_since(before, "draw_assigned")
    assert len(assigned) == 8
    assert all(len(e["tournament_event"]["match_ids"]) == 1 for e in assigned)
    assert staff["id"] not in str([change_events._event_for_scope(e, "public") for e in assigned])
    assert (await lead(flow, tournament))["draws"] == []


@pytest.mark.asyncio
async def test_instant_result_is_idempotent_and_undo_frees_only_that_seat(flow):
    _staff, tournament, _users, _regs = await bracket(flow, advancement_mode="instant")
    first = await round_matches(flow, tournament, 1)
    for match in first[:2]:
        assert (await flow.post(f"/api/matches/{match['id']}/result", json=ranking(match))).status_code == 200
    replay = await flow.post(f"/api/matches/{first[0]['id']}/result", json=ranking(first[0]))
    assert replay.status_code == 200 and replay.json()["idempotent_replay"] is True
    assert await flow.db.audit_logs.count_documents({"action": "tournament.draw.assigned"}) == 2
    second = await round_matches(flow, tournament, 2)
    seated = {s["registration_id"] for m in second for s in m["slots"] if s.get("registration_id")}
    assert len(seated) == 2
    undo = await flow.post(f"/api/matches/{first[0]['id']}/result/undo", json={})
    assert undo.status_code == 200, undo.text
    second = await round_matches(flow, tournament, 2)
    seated = {s["registration_id"] for m in second for s in m["slots"] if s.get("registration_id")}
    assert seated == {first[1]["slots"][0]["registration_id"]}


# ---------------------------------------------------------------------------------------------- Einstellung

@pytest.mark.asyncio
async def test_tournament_form_keeps_old_flag_and_new_mode_in_step(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(randomize_advancement_rounds=True)
    # Alt gespeichert: nur der Schalter - gelesen wird „Auslosung nach der Runde“.
    read = await flow.get(f"/api/tournaments/{tournament['id']}")
    assert read.status_code == 200, read.text
    assert read.json()["advancement_mode"] == "draw_round"
    saved = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"advancement_mode": "instant", "draw_show_minutes": 7})
    assert saved.status_code == 200, saved.text
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert stored["advancement_mode"] == "instant" and stored["randomize_advancement_rounds"] is True
    assert stored["draw_show_minutes"] == 7
    saved = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"advancement_mode": "fixed"})
    assert saved.status_code == 200, saved.text
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert stored["advancement_mode"] == "fixed" and stored["randomize_advancement_rounds"] is False
    # Ein alter Client schickt nur den Schalter: der Modus folgt.
    saved = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"randomize_advancement_rounds": True})
    assert saved.status_code == 200, saved.text
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert stored["advancement_mode"] == "draw_round"
    bad = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"advancement_mode": "unsinn"})
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_stage_settings_keep_mode_and_flag_in_step(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament()
    created = await flow.post(f"/api/tournaments/{tournament['id']}/stages", json={
        "name": "Baum", "stage_type": "single_elimination", "match_type": "duel",
        "settings": {"advancement_mode": "draw_show", "draw_show_minutes": 3}})
    assert created.status_code == 200, created.text
    stage = created.json()
    assert stage["settings"]["advancement_mode"] == "draw_show" and stage["settings"]["randomize_advancement_rounds"] is True
    assert stage["settings"]["draw_show_minutes"] == 3
    updated = await flow.patch(f"/api/tournaments/{tournament['id']}/stages/{stage['id']}", json={"settings": {"advancement_mode": None}})
    assert updated.status_code == 200, updated.text
    assert updated.json()["settings"]["advancement_mode"] is None and updated.json()["settings"]["randomize_advancement_rounds"] is None
    legacy = await flow.patch(f"/api/tournaments/{tournament['id']}/stages/{stage['id']}", json={"settings": {"randomize_advancement_rounds": False}})
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["settings"]["advancement_mode"] == "fixed"


# ------------------------------------------------------------------------------------------- App (#1633)

@pytest.mark.asyncio
async def test_public_bracket_carries_mode_and_ready_pot_for_the_app(flow):
    """Die App (#1633) liest Modus und Topf aus der öffentlichen Baum-Antwort - wie der TV-Schlüssel seit #1634."""
    _staff, tournament, _users, _regs = await bracket(flow, advancement_mode="draw_show")
    await play_round_one(flow, tournament)
    flow.act_as(None)
    response = await flow.get(f"/api/tournaments/{tournament['id']}/bracket")
    assert response.status_code == 200, response.text
    targets = [m for m in response.json()["matches_v2"] if (m.get("settings") or {}).get("draw_group")]
    assert targets and all(m["settings"]["advancement_mode"] == "draw_show" for m in targets)
    ready = [m["draw_ready"] for m in targets if m.get("round") == 2]
    assert ready and all(marker["pot_size"] == 4 and marker["since"] for marker in ready)
    assert all(slot["source"]["draw"]["label"] for m in targets if m.get("round") == 2 for slot in m["slots"])
    detail = await flow.get(f"/api/tournaments/{tournament['id']}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["advancement_mode"] == "draw_show"
