"""Check-in-Ende baut den Baum (#1551, Entscheidung E5): erst wenn der Check-in endet, steht der Turnierbaum fest - aus
denen, die eingecheckt sind. Bis dahin rücken Wartende nach. Das Ende des Check-ins setzt den Status nicht mehr auf
„Anmeldung geschlossen“ zurück; das Turnier bleibt im Check-in, bis es startet.
"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import scheduler  # noqa: E402
from services.public_phase import derive_public_phase  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _iso(delta_minutes: int) -> str:
    return (now_utc() + timedelta(minutes=delta_minutes)).isoformat()


async def sixteen(flow, *, checked_in: int, **fields):
    """16 Anmeldungen, davon ``checked_in`` eingecheckt; Check-in läuft seit 30 Minuten."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(
        max_participants=16, status="registration_closed", event_mode="online",
        check_in_from=_iso(-30), check_in_until=_iso(30), start_date=_iso(60), **fields)
    registrations = []
    for index in range(16):
        user = await flow.add_user(name=f"Spieler {index + 1}")
        registrations.append(await flow.register(tournament, user, seed=index + 1,
                                                 status="checked_in" if index < checked_in else "approved"))
    return staff, tournament, registrations


async def open_check_in(flow, tournament):
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "check_in"})
    assert response.status_code == 200, response.text
    return response.json()


async def end_check_in(flow, tournament):
    """Die Zeit „Check-in endet“ ist vorbei, der Scheduler läuft einmal."""
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"check_in_until": _iso(-1)}})
    await scheduler._safe_status_transitions()
    return await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})


def bracket_ids(matches) -> set:
    return {slot.get("registration_id") for match in matches for slot in match.get("slots") or [] if slot.get("registration_id")}


@pytest.mark.asyncio
async def test_opening_the_check_in_does_not_fix_the_bracket_yet(flow):
    _staff, tournament, _regs = await sixteen(flow, checked_in=0)
    answer = await open_check_in(flow, tournament)
    assert not answer.get("auto_generated_bracket"), "beim Öffnen wird noch nichts festgelegt"
    fixed = [match for match in await flow.matches(tournament) if not match.get("is_preview")]
    assert fixed == [], "der Baum steht erst mit dem Ende des Check-ins"


@pytest.mark.asyncio
@pytest.mark.parametrize("checked_in", [6, 8, 10])
async def test_check_in_end_builds_the_bracket_only_from_checked_in(flow, checked_in):
    _staff, tournament, regs = await sixteen(flow, checked_in=checked_in)
    await open_check_in(flow, tournament)
    stored = await end_check_in(flow, tournament)

    matches = await flow.matches(tournament)
    assert matches and all(not match.get("is_preview") for match in matches)
    expected = {reg["id"] for reg in regs[:checked_in]}
    assert bracket_ids(matches) == expected, "nur wer eingecheckt hat, steht im Baum"
    assert stored["status"] == "check_in", "das Ende des Check-ins setzt nicht auf „Anmeldung geschlossen“ zurück"
    assert stored.get("check_in_closed_at")
    audits = await flow.db.audit_logs.find({"action": "tournament.checkin.close", "target_id": tournament["id"]}, {"_id": 0}).to_list(10)
    assert len(audits) == 1 and audits[0]["data"]["participant_count"] == checked_in


@pytest.mark.asyncio
async def test_check_in_end_runs_once(flow):
    _staff, tournament, _regs = await sixteen(flow, checked_in=8)
    await open_check_in(flow, tournament)
    await end_check_in(flow, tournament)
    first = sorted(match["id"] for match in await flow.matches(tournament))
    await scheduler._safe_status_transitions()
    assert sorted(match["id"] for match in await flow.matches(tournament)) == first, "ein zweiter Lauf baut nichts neu"
    assert await flow.db.audit_logs.count_documents({"action": "tournament.checkin.close"}) == 1


def test_status_after_check_in_end_stays_check_in():
    now = datetime(2026, 10, 31, 17, 0, tzinfo=timezone.utc)
    doc = {"status": "check_in", "check_in_from": (now - timedelta(hours=1)).isoformat(),
           "check_in_until": (now - timedelta(minutes=5)).isoformat(), "start_date": (now + timedelta(minutes=30)).isoformat()}
    assert scheduler._next_status(doc, now, "tournament") is None
    started = {**doc, "start_date": (now - timedelta(minutes=1)).isoformat(), "auto_start_enabled": True}
    assert scheduler._next_status(started, now, "tournament") == "live", "der Start bleibt, wie er war"


def test_public_phase_after_check_in_end_no_longer_invites_to_check_in():
    now = datetime(2026, 10, 31, 17, 0, tzinfo=timezone.utc)
    doc = {"status": "check_in", "start_date": (now + timedelta(minutes=30)).isoformat(),
           "check_in_until": (now - timedelta(minutes=5)).isoformat(), "check_in_closed_at": (now - timedelta(minutes=4)).isoformat()}
    phase = derive_public_phase(doc, "tournament", now)
    assert phase["state"] == "registration_closed" and phase["countdown_kind"] == "starts"


@pytest.mark.asyncio
async def test_going_live_from_check_in_uses_only_checked_in(flow):
    _staff, tournament, regs = await sixteen(flow, checked_in=8)
    await open_check_in(flow, tournament)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "live", "force": True})
    assert response.status_code == 200, response.text
    assert bracket_ids(await flow.matches(tournament)) == {reg["id"] for reg in regs[:8]}
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert stored["status"] == "live" and stored.get("check_in_closed_at")


@pytest.mark.asyncio
async def test_without_check_in_the_start_takes_everyone_approved(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, regs = await flow.with_participants(4, status="registration_closed")
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "live", "force": True})
    assert response.status_code == 200, response.text
    assert bracket_ids(await flow.matches(tournament)) == {reg["id"] for reg in regs}


@pytest.mark.asyncio
async def test_waitlist_moves_up_until_check_in_ends(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(max_participants=4, status="registration_closed", event_mode="local",
                                              check_in_from=_iso(-30), check_in_until=_iso(30), start_date=_iso(60))
    regs = [await flow.register(tournament, await flow.add_user(name=f"Spieler {i}"), seed=i) for i in range(1, 5)]
    waiting = await flow.register(tournament, await flow.add_user(name="Wartend"), status="waitlist")
    await flow.db.tournament_registrations.update_one({"id": waiting["id"]}, {"$set": {"created_at": _iso(-60)}})
    await open_check_in(flow, tournament)

    marked = await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{regs[0]['id']}/checkin", json={"status": "no_show"})
    assert marked.status_code == 200, marked.text
    moved = await flow.db.tournament_registrations.find_one({"id": waiting["id"]}, {"_id": 0})
    assert moved["status"] == "approved", "ein freier Platz vor dem Check-in-Ende geht an die Warteliste"
    note = await flow.db.notifications.find_one({"user_id": waiting["user_id"]}, {"_id": 0})
    assert note and "nachgerückt" in note["body"]

    await end_check_in(flow, tournament)
    marked_late = await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{regs[1]['id']}/checkin", json={"status": "no_show"})
    assert marked_late.status_code == 200
    second = await flow.register(tournament, await flow.add_user(name="Später"), status="waitlist")
    await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{regs[2]['id']}/checkin", json={"status": "no_show"})
    assert (await flow.db.tournament_registrations.find_one({"id": second["id"]}, {"_id": 0}))["status"] == "waitlist", \
        "nach dem Baubau rückt niemand von selbst nach - das entscheidet die Turnierleitung"


@pytest.mark.asyncio
async def test_self_check_in_after_the_end_is_refused(flow):
    _staff, tournament, regs = await sixteen(flow, checked_in=8)
    await open_check_in(flow, tournament)
    await end_check_in(flow, tournament)
    late_user = {"id": regs[12]["user_id"], "role": "user", "username": "spaet", "display_name": "Spät", "is_active": True}
    flow.act_as(late_user)
    refused = await flow.post(f"/api/tournaments/{tournament['id']}/checkin")
    assert refused.status_code == 409
    assert "Check-in ist beendet" in refused.json()["detail"]
