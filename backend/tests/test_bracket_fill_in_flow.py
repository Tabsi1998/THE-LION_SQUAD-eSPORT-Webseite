"""Nachrücker nach dem Baubau (#1551, Entscheidung E15): wer nach dem Check-in-Ende dazukommt, übernimmt genau einen freien
Platz - den Platz einer Person, die nicht erschienen ist, oder einen Platz mit Freilos. Das geht, solange das erste echte
Spiel dieses Platzes nicht begonnen hat; in der Liga, solange höchstens ein Spieltag gespielt ist. Ein Freilos-Spiel wird
dabei sauber zurückgesetzt und neu bewertet.
"""
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


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _iso(minutes: int) -> str:
    return (now_utc() + timedelta(minutes=minutes)).isoformat()


async def six_of_eight(flow, *, extra_approved: int = 0):
    """Sechs eingecheckt → Baum für 8 mit zwei Freilosen; dazu Bestätigte, die den Check-in verpasst haben."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(max_participants=16, status="check_in", event_mode="local",
                                              check_in_from=_iso(-30), check_in_until=_iso(-1), start_date=_iso(30))
    regs = []
    for index in range(6 + extra_approved):
        user = await flow.add_user(name=f"Spieler {index + 1}")
        regs.append(await flow.register(tournament, user, seed=index + 1, status="checked_in" if index < 6 else "approved"))
    await scheduler._safe_status_transitions()
    return staff, tournament, regs


def byes(matches):
    return [match for match in matches if (match.get("result_meta") or {}).get("source") == "auto_bye"]


def ids_in(match):
    return [slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")]


def downstream_of(matches, match):
    target = next(row for row in match.get("advancement") or [] if row.get("rank") == 1)
    return next(row for row in matches if row["id"] == target["to_match_id"]), target["to_slot"]


async def add_late(flow, tournament, name="Nachrücker", **extra):
    user = await flow.add_user(name=name)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/registrations",
                               json={"user_id": user["id"], "status": "checked_in", **extra})
    return user, response


@pytest.mark.asyncio
async def test_late_participant_takes_a_place_with_a_bye_and_the_bye_is_reset(flow):
    _staff, tournament, _regs = await six_of_eight(flow)
    before = await flow.matches(tournament)
    bye_matches = byes(before)
    assert len(bye_matches) == 2
    _user, response = await add_late(flow, tournament)
    assert response.status_code == 200, response.text
    body = response.json()
    placement = body["placement"]
    assert placement["ok"] is True and placement["kind"] == "bye"
    new_id = body["registration"]["id"]

    after = {row["id"]: row for row in await flow.matches(tournament)}
    bye = after[placement["match_id"]]
    assert new_id in ids_in(bye) and len(ids_in(bye)) == 2
    assert bye["status"] == "ready" and not bye.get("results") and not bye.get("result_meta"), "das Freilos ist aufgehoben"
    original = next(row for row in bye_matches if row["id"] == bye["id"])
    target, slot_no = downstream_of(list(after.values()), original)
    target_slot = next(slot for slot in target["slots"] if slot["slot"] == slot_no)
    assert not target_slot.get("registration_id") and target_slot["status"] == "pending", "wer das Freilos hatte, steht nicht mehr eine Runde weiter"
    assert target["status"] == "pending"
    audit = await flow.db.audit_logs.find_one({"action": "tournament.registration.fill_in"}, {"_id": 0})
    assert audit and audit["data"]["kind"] == "bye"


@pytest.mark.asyncio
async def test_no_show_with_a_bye_can_be_replaced(flow):
    _staff, tournament, _regs = await six_of_eight(flow)
    matches = await flow.matches(tournament)
    bye = byes(matches)[0]
    absent = ids_in(bye)[0]
    marked = await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{absent}/checkin", json={"status": "no_show"})
    assert marked.status_code == 200
    _user, response = await add_late(flow, tournament, replace_registration_id=absent)
    assert response.status_code == 200, response.text
    new_id = response.json()["registration"]["id"]

    after = {row["id"]: row for row in await flow.matches(tournament)}
    replaced = after[bye["id"]]
    assert ids_in(replaced) == [new_id]
    assert [row["registration_id"] for row in replaced["results"]] == [new_id], "das Freilos zählt jetzt für den Nachrücker"
    target, slot_no = downstream_of(list(after.values()), bye)
    assert next(slot for slot in target["slots"] if slot["slot"] == slot_no)["registration_id"] == new_id
    assert all(absent not in ids_in(row) for row in after.values())


@pytest.mark.asyncio
async def test_late_participant_prefers_the_place_of_a_no_show(flow):
    _staff, tournament, regs = await six_of_eight(flow)
    matches = await flow.matches(tournament)
    playing = next(row for row in matches if row["round"] == 1 and len(ids_in(row)) == 2)
    absent = ids_in(playing)[1]
    await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{absent}/checkin", json={"status": "no_show"})
    _user, response = await add_late(flow, tournament)
    assert response.status_code == 200, response.text
    placement = response.json()["placement"]
    assert placement["kind"] == "no_show" and placement["replaced_registration_id"] == absent
    after = await flow.reload(playing)
    assert response.json()["registration"]["id"] in ids_in(after)


@pytest.mark.asyncio
async def test_replacement_after_the_first_real_match_started_is_refused(flow):
    _staff, tournament, _regs = await six_of_eight(flow)
    matches = await flow.matches(tournament)
    playing = next(row for row in matches if row["round"] == 1 and len(ids_in(row)) == 2)
    absent = ids_in(playing)[0]
    await flow.db.matches_v2.update_one({"id": playing["id"]}, {"$set": {"status": "in_progress", "started_at": _iso(-2)}})
    await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{absent}/checkin", json={"status": "no_show"})
    _user, response = await add_late(flow, tournament, replace_registration_id=absent)
    assert response.status_code == 409
    assert "begonnen" in response.json()["detail"]

    # Ein Freilos-Spieler, dessen erstes echtes Spiel (Runde 2) schon läuft, ist genauso fest.
    bye = byes(matches)[0]
    target, _slot = downstream_of(matches, bye)
    await flow.db.matches_v2.update_one({"id": target["id"]}, {"$set": {"started_at": _iso(-1)}})
    bye_player = ids_in(bye)[0]
    _user, refused = await add_late(flow, tournament, name="Zweiter", replace_registration_id=bye_player)
    assert refused.status_code == 409


@pytest.mark.asyncio
async def test_without_free_place_the_registration_stays_outside_the_bracket(flow):
    _staff, tournament, _regs = await six_of_eight(flow)
    for bye in byes(await flow.matches(tournament)):
        target, _slot = downstream_of(await flow.matches(tournament), bye)
        await flow.db.matches_v2.update_one({"id": target["id"]}, {"$set": {"status": "in_progress", "started_at": _iso(-1)}})
    _user, response = await add_late(flow, tournament)
    assert response.status_code == 200, response.text
    placement = response.json()["placement"]
    assert placement["ok"] is False and "kein Platz frei" in placement["detail"]


@pytest.mark.asyncio
async def test_staff_check_in_after_the_end_places_a_late_arrival(flow):
    _staff, tournament, regs = await six_of_eight(flow, extra_approved=1)
    late = regs[6]
    assert all(late["id"] not in ids_in(row) for row in await flow.matches(tournament))
    response = await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{late['id']}/checkin", json={"status": "checked_in"})
    assert response.status_code == 200, response.text
    assert response.json()["placement"]["kind"] == "bye"
    assert any(late["id"] in ids_in(row) for row in await flow.matches(tournament))


async def league_of_four(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, regs = await flow.with_participants(4, format="league", status="registration_closed")
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    return tournament, regs


async def play_matchday(flow, tournament, number: int):
    for match in await flow.matches(tournament):
        if match["round"] == number:
            first, second = ids_in(match)
            await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
                "status": "completed", "results": [{"registration_id": first, "rank": 1}, {"registration_id": second, "rank": 2}]}})


@pytest.mark.asyncio
async def test_league_replacement_only_while_at_most_one_matchday_is_played(flow):
    tournament, regs = await league_of_four(flow)
    await play_matchday(flow, tournament, 1)
    absent = regs[3]["id"]
    await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{absent}/checkin", json={"status": "no_show"})
    _user, response = await add_late(flow, tournament, replace_registration_id=absent)
    assert response.status_code == 200, response.text
    new_id = response.json()["registration"]["id"]
    matches = await flow.matches(tournament)
    open_rows = [row for row in matches if row["status"] != "completed"]
    assert all(absent not in ids_in(row) for row in open_rows), "der Nachrücker übernimmt den restlichen Spielplan"
    assert any(new_id in ids_in(row) for row in open_rows)

    await play_matchday(flow, tournament, 2)
    second_absent = regs[2]["id"]
    await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{second_absent}/checkin", json={"status": "no_show"})
    _user, refused = await add_late(flow, tournament, name="Zu spät", replace_registration_id=second_absent)
    assert refused.status_code == 409
    assert "Spieltag" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_a_fill_in_asks_for_a_heat_check_afterwards(flow, monkeypatch):
    # Läufe zusammenlegen (#1550): ändert ein Nachrücker die Belegung, prüft der Server die Läufe gleich danach.
    import routes.tournament_registration_routes as registration_routes
    calls = []

    async def spy(db, tid, *, actor_id, trigger):
        calls.append((tid, trigger))

    monkeypatch.setattr(registration_routes, "evaluate_after_write", spy)
    _staff, tournament, _regs = await six_of_eight(flow)
    _user, response = await add_late(flow, tournament)
    assert response.json()["placement"]["kind"] == "bye"
    assert calls == [(tournament["id"], "fill_in")]
