"""Gegner mischen (#1548) mit echter Anwendung: Auslosung im Protokoll, Live-Ereignis, „Neu auslosen“ und Rückgängig.

Die Auslosung passiert beim Ergebnis, das die Runde fertig macht - im Protokoll mit Zeitpunkt, Person und Ergebnis.
„Neu auslosen“ darf die Turnierleitung bis zum Start eines der betroffenen Spiele; danach 409.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import change_events  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def shuffled_bracket(flow, count: int = 8, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(count, randomize_advancement_rounds=True, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    return staff, tournament, users, registrations


def ranking(match: dict) -> dict:
    regs = [slot["registration_id"] for slot in match["slots"] if slot.get("registration_id")]
    return {"results": [{"registration_id": regs[0], "rank": 1, "score": 2}, {"registration_id": regs[1], "rank": 2, "score": 0}]}


async def round_matches(flow, tournament, number: int) -> list[dict]:
    rows = [m for m in await flow.matches(tournament) if m.get("round") == number and m.get("section") == "WB"]
    return sorted(rows, key=lambda m: m.get("order") or 0)


async def play_round_one(flow, tournament) -> dict:
    last = None
    for match in await round_matches(flow, tournament, 1):
        last = await flow.post(f"/api/matches/{match['id']}/result", json=ranking(match))
        assert last.status_code == 200, last.text
    return last.json()


@pytest.mark.asyncio
async def test_draw_happens_when_the_round_is_done_and_lands_in_the_protocol(flow):
    staff, tournament, _users, _regs = await shuffled_bracket(flow)
    first = (await round_matches(flow, tournament, 1))[0]
    response = await flow.post(f"/api/matches/{first['id']}/result", json=ranking(first))
    assert response.status_code == 200, response.text
    second = await round_matches(flow, tournament, 2)
    assert all(not any(s.get("registration_id") for s in m["slots"]) for m in second)
    assert not await flow.db.audit_logs.count_documents({"action": "tournament.draw.done"})

    before = len(change_events._event_buffer)
    await play_round_one(flow, tournament)
    second = await round_matches(flow, tournament, 2)
    assert all(m["status"] == "ready" for m in second)
    assert all(len([s for s in m["slots"] if s.get("registration_id")]) == 2 for m in second)
    entry = await flow.db.audit_logs.find_one({"action": "tournament.draw.done"}, {"_id": 0})
    assert entry["actor_id"] == staff["id"]
    assert entry["target_id"] == tournament["id"]
    assert entry["created_at"] == second[0]["draw"]["drawn_at"]
    assert entry["data"]["draw_id"] == second[0]["draw"]["id"]
    assert {row["registration_id"] for row in entry["data"]["assignments"]} == {
        s["registration_id"] for m in second for s in m["slots"]}
    events = [e for e in list(change_events._event_buffer)[before:] if e.get("event_type") == "draw_done"]
    assert len(events) == 1
    public = change_events._event_for_scope(events[0], "public")
    assert public["entity_id"] is None and "details" not in public
    staff_view = change_events._event_for_scope(events[0], "staff")
    assert staff_view["details"]["draw_id"] == entry["data"]["draw_id"]
    assert "actor_id" not in staff_view["details"]


@pytest.mark.asyncio
async def test_redraw_by_tournament_lead_until_a_match_starts(flow):
    staff, tournament, _users, _regs = await shuffled_bracket(flow)
    await play_round_one(flow, tournament)
    second = await round_matches(flow, tournament, 2)
    group = second[0]["settings"]["draw_group"]
    stage_id = second[0]["stage_id"]
    url = f"/api/tournaments/{tournament['id']}/stages/{stage_id}/redraw"

    member = await flow.add_user()
    flow.act_as(member)
    denied = await flow.post(url, json={"group": group})
    assert denied.status_code == 403

    flow.act_as(staff)
    response = await flow.post(url, json={"group": group})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["draw"]["group"] == group and body["draw"]["trigger"] == "redraw"
    entry = await flow.db.audit_logs.find_one({"action": "tournament.draw.redrawn"}, {"_id": 0})
    assert entry["actor_id"] == staff["id"] and entry["data"]["draw_id"] == body["draw"]["id"]
    redrawn = await round_matches(flow, tournament, 2)
    assert all(m["draw"]["id"] == body["draw"]["id"] for m in redrawn)

    await flow.db.matches_v2.update_one({"id": redrawn[0]["id"]}, {"$set": {"status": "in_progress"}})
    refused = await flow.post(url, json={"group": group})
    assert refused.status_code == 409
    assert "begonnen" in refused.json()["detail"]
    unknown = await flow.post(url, json={"group": "XX:9"})
    assert unknown.status_code == 404


@pytest.mark.asyncio
async def test_undo_of_the_last_result_takes_the_draw_back(flow):
    _staff, tournament, _users, _regs = await shuffled_bracket(flow)
    await play_round_one(flow, tournament)
    last = (await round_matches(flow, tournament, 1))[-1]
    response = await flow.post(f"/api/matches/{last['id']}/result/undo", json={})
    assert response.status_code == 200, response.text
    second = await round_matches(flow, tournament, 2)
    assert all(not m.get("draw") for m in second)
    assert all(not any(s.get("registration_id") for s in m["slots"]) for m in second)
    assert all(m["status"] == "pending" for m in second)
    # Ein neues Ergebnis lost neu aus.
    again = await flow.post(f"/api/matches/{last['id']}/result", json=ranking(await flow.reload(last)))
    assert again.status_code == 200, again.text
    second = await round_matches(flow, tournament, 2)
    assert all(m["status"] == "ready" and m.get("draw") for m in second)


@pytest.mark.asyncio
async def test_league_redraw_before_matchday_one(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(
        4, format="league", randomize_advancement_rounds=True)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    matches = await flow.matches(tournament)
    assert matches and all(m.get("draw", {}).get("kind") == "league" for m in matches)
    stage_id = matches[0]["stage_id"]
    url = f"/api/tournaments/{tournament['id']}/stages/{stage_id}/redraw"
    redraw = await flow.post(url, json={})
    assert redraw.status_code == 200, redraw.text
    assert redraw.json()["draw"]["kind"] == "league"
    assert await flow.db.audit_logs.count_documents({"action": "tournament.draw.redrawn"}) == 1
    after = await flow.matches(tournament)
    assert {m["id"] for m in after} == {m["id"] for m in matches}

    await flow.db.matches_v2.update_one({"id": after[0]["id"]}, {"$set": {"status": "completed", "results": [{"rank": 1}]}})
    refused = await flow.post(url, json={})
    assert refused.status_code == 409
