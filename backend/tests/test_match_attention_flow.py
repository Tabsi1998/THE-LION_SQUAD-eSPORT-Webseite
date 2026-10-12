"""„Braucht Aufmerksamkeit“ (#1160): fehlendes Ergebnis, Streitfall, defekte Station - je Fall ein Eintrag und eine
Benachrichtigung an die Turnierleitung, Erledigtes verschwindet.

Geprüft mit echten Routen und erfundenen Konten: die Zeitgrenze (Zeit plus Dauer plus 5 Minuten), ohne Zeit und ohne
Station kein Fall, Station defekt → Eintrag → umlegen → weg, Empfänger (nur Turnierleitung des Spiels), keine Doppel.
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
from services.match_attention import sweep  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def bracket(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, result_entry_mode="staff_only", event_mode="local")
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    matches = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))
    players = [user["id"] for user in users]
    return staff, tournament, matches[0], matches[1], players


async def lead(flow, tournament):
    response = await flow.get(f"/api/tournaments/{tournament['id']}/lead")
    assert response.status_code == 200, response.text
    return response.json()


async def alerts(flow):
    return await flow.db.notifications.find({"kind": "match_attention"}, {"_id": 0}).to_list(100)


@pytest.mark.asyncio
async def test_missing_result_after_time_plus_duration_plus_five_minutes(flow):
    staff, tournament, match, other, players = await bracket(flow)
    scorekeeper = await flow.add_user(name="Ergebnisdienst")
    await flow.db.tournament_staff_assignments.insert_one({"id": new_id(), "tournament_id": tournament["id"], "user_id": scorekeeper["id"],
                                                           "role": "scorekeeper", "scope": "tournament", "is_active": True})
    # 33 Minuten nach Beginn bei 30 Minuten Dauer: noch kein Fall. 40 Minuten: Ergebnis fehlt.
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": (now_utc() - timedelta(minutes=33)).isoformat(), "duration_minutes": 30}})
    assert (await lead(flow, tournament))["attention"] == []
    assert await sweep(flow.db) == 0
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": (now_utc() - timedelta(minutes=40)).isoformat()}})
    items = (await lead(flow, tournament))["attention"]
    assert [item["id"] for item in items] == [f"rm-{match['id']}"]
    assert items[0]["title"] == "Ergebnis fehlt" and items[0]["action"] == "enter"
    # Ohne geplante Zeit (und ohne Station): kein Fall.
    assert all(item["match_id"] != other["id"] for item in items)

    assert await sweep(flow.db) == 2
    sent = await alerts(flow)
    assert {row["user_id"] for row in sent} == {staff["id"], scorekeeper["id"]}, "nur die Turnierleitung - keine Spieler"
    assert not ({row["user_id"] for row in sent} & set(players))
    assert sent[0]["url"] == f"/tournaments/{tournament['slug']}/leitung?fall=rm-{match['id']}"
    assert await sweep(flow.db) == 0, "ein Fall, eine Nachricht"

    # Erledigt: Ergebnis eingetragen - der Fall ist weg.
    first, second = [slot["registration_id"] for slot in match["slots"]]
    saved = await flow.post(f"/api/matches/{match['id']}/result", json={"results": [{"registration_id": first, "rank": 1, "score": 1}, {"registration_id": second, "rank": 2, "score": 0}]})
    assert saved.status_code == 200
    assert (await lead(flow, tournament))["attention"] == []


@pytest.mark.asyncio
async def test_broken_station_entry_move_gone(flow):
    staff, tournament, match, other, players = await bracket(flow)
    broken = {"id": new_id(), "name": "Switch 2", "device_type": "switch", "tournament_id": tournament["id"], "status": "free"}
    spare = {"id": new_id(), "name": "Switch 3", "device_type": "switch", "tournament_id": tournament["id"], "status": "free"}
    for station in (broken, spare):
        await flow.db.stations.insert_one(dict(station))
    crew = await flow.add_user(name="Stationsleitung")
    await flow.db.tournament_staff_assignments.insert_one({"id": new_id(), "tournament_id": tournament["id"], "user_id": crew["id"],
                                                           "role": "station_manager", "scope": "station", "scope_id": broken["id"], "is_active": True})
    assigned = await flow.post(f"/api/stations/{broken['id']}/assign/{match['id']}")
    assert assigned.status_code == 200, assigned.text
    marked = await flow.put(f"/api/stations/{broken['id']}", json={"status": "broken"})
    assert marked.status_code == 200, marked.text
    assert (await flow.db.stations.find_one({"id": broken["id"]}))["broken_at"]

    data = await lead(flow, tournament)
    station_items = [item for item in data["attention"] if item["kind"] == "station_broken"]
    assert len(station_items) == 1 and station_items[0]["id"] == f"st-{broken['id']}"
    assert station_items[0]["detail"] == "1 Spiel wartet darauf" and station_items[0]["match_ids"] == [match["id"]]
    assert {row["name"] for row in data["stations"]} == {"Switch 2", "Switch 3"}

    assert await sweep(flow.db) == 2
    assert {row["user_id"] for row in await alerts(flow)} == {staff["id"], crew["id"]}, "Turnierleitung und Stationsleitung"

    moved = await flow.patch(f"/api/matches/{match['id']}", json={"station_id": spare["id"]})
    assert moved.status_code == 200, moved.text
    still = await flow.db.stations.find_one({"id": broken["id"]}, {"_id": 0})
    assert still["status"] == "broken" and still["current_match_id"] is None, "die Station bleibt defekt, gibt das Spiel ab"
    assert [item for item in (await lead(flow, tournament))["attention"] if item["kind"] == "station_broken"] == []


@pytest.mark.asyncio
async def test_dispute_and_conflict_are_cases_without_a_second_message(flow):
    staff, tournament, match, other, players = await bracket(flow)
    first, second = [slot["registration_id"] for slot in match["slots"]]
    owner = await flow.db.tournament_registrations.find_one({"id": first}, {"_id": 0})
    user = await flow.db.users.find_one({"id": owner["user_id"]}, {"_id": 0})
    flow.act_as(user)
    opened = await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "Gegner hat getauscht", "category": "rule_violation"})
    assert opened.status_code == 200, opened.text
    flow.act_as(staff)
    items = (await lead(flow, tournament))["attention"]
    assert items[0]["id"] == f"ds-{match['id']}" and items[0]["detail"].endswith("„Regelverstoß“")
    before = len(await alerts(flow))
    await sweep(flow.db)
    assert len(await alerts(flow)) == before, "der Streitfall hat schon seine Nachricht"
