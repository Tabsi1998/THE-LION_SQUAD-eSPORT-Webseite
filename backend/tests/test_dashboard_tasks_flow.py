"""Startseite (#1139): kein Match doppelt - Aktionen nur, wenn etwas zu tun ist; die Station-Crew trägt Ergebnisse ein.

„Match offen“ fällt aus den Aktionen weg, die Matches stehen schon unter „Meine aktiven Matches“. Eine Aktion gibt es
für das Ergebnis: melden, wenn das Spiel läuft oder seine Zeit da ist, und bestätigen, wenn die Gegenseite gemeldet hat
(#1132). „Anmeldung wartet auf Freigabe“ ist keine Aufgabe. Entscheidung des Betreibers: Die Station-Crew darf
Ergebnisse eintragen.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


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


async def dashboard(flow, user) -> dict:
    flow.act_as(user)
    response = await flow.get("/api/mobile/dashboard")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_no_match_open_actions_but_real_result_tasks(flow):
    _staff, tournament, match, first, second, player = await bracket(flow, result_entry_mode=None)
    data = await dashboard(flow, player[first])
    assert [row["id"] for row in data["me"]["matches"]] == [match["id"]], "das Match steht unter „Meine aktiven Matches“"
    assert not [action for action in data["me"]["actions"] if action["type"].startswith("match")], "kein „Match offen“ mehr"

    # Die Zeit ist da: „Ergebnis melden“.
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": (now_utc() - timedelta(minutes=5)).isoformat()}})
    data = await dashboard(flow, player[first])
    [task] = [action for action in data["me"]["actions"] if action["type"].startswith("match")]
    assert (task["type"], task["label"], task["target_id"]) == ("match_report", "Ergebnis melden", match["id"])
    assert data["stats"]["open_actions"] == len(data["me"]["actions"])

    # Die Gegenseite hat gemeldet: „Ergebnis bestätigen“ - bei der Gegenseite, nicht beim Melder.
    flow.act_as(player[second])
    reported = await flow.post(f"/api/matches/{match['id']}/report", json={"results": [
        {"registration_id": second, "rank": 1}, {"registration_id": first, "rank": 2}]})
    assert reported.status_code == 200, reported.text
    data = await dashboard(flow, player[first])
    [task] = [action for action in data["me"]["actions"] if action["type"].startswith("match")]
    assert (task["type"], task["label"]) == ("match_confirm", "Ergebnis bestätigen")
    assert task["detail"].startswith(tournament["title"])
    data = await dashboard(flow, player[second])
    assert not [action for action in data["me"]["actions"] if action["type"].startswith("match")], "wer gemeldet hat, wartet"


@pytest.mark.asyncio
async def test_a_pending_registration_is_no_task(flow):
    player = await flow.add_user(name="Wartend")
    tournament = await flow.create_tournament(start_date=(now_utc() + timedelta(days=3)).isoformat())
    await flow.register(tournament, player, status="pending")
    data = await dashboard(flow, player)
    assert [row["id"] for row in data["me"]["tournaments"]] == [tournament["id"]]
    assert data["me"]["actions"] == []


@pytest.mark.asyncio
async def test_the_station_crew_enters_results(flow):
    _staff, tournament, match, first, second, _player = await bracket(flow, event_mode="local", result_entry_mode=None)
    crew = await flow.add_user(name="StationCrew")
    await flow.db.tournament_staff_assignments.insert_one({"id": new_id(), "tournament_id": tournament["id"], "user_id": crew["id"],
                                                           "role": "station_manager", "scope": "tournament", "is_active": True})
    flow.act_as(crew)
    page = await flow.get(f"/api/matches/{match['id']}/page")
    assert page.json()["can_staff_submit_result"] is True
    entered = await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
        {"registration_id": first, "rank": 1, "score": 2}, {"registration_id": second, "rank": 2, "score": 0}]})
    assert entered.status_code == 200, entered.text
    stored = await flow.reload(match)
    assert stored["status"] == "completed"
