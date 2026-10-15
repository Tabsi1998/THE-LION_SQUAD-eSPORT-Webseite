"""Live vor Ort (#1556) durch die echten Routen: Warteschlange, Aufruf vom Handy, Start, Spieler-Sicht.

- ``GET /api/tournaments/{tid}/live-queue``: öffentlich wie der Turnierbaum - je Station läuft/als Nächstes/danach,
  ohne Konto-Kennungen und ohne Notizen.
- ``GET .../live-queue/me``: „Du bist als Nächstes an Station 2“ für die angemeldete Person.
- ``POST .../live-queue/call`` und ``.../start``: Leitung oder Helfer ruft auf bzw. startet - unter dem Turnier-Lock,
  mit Compare-and-Set an der Station; zwei Helfer zugleich ergeben genau einen Aufruf und genau eine Nachricht.
- „Ergebnis fehlt“ zählt ab dem echten Start, nicht ab der Planzeit.
"""

import asyncio
import json
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import InterleavedReads, make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def on_site(flow, count=4, **fields):
    """K.-o. vor Ort: Baum aus dem echten Generator, Plan über „Planen“ und „Übernehmen“, zwei Stationen."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    start = (now_utc() - timedelta(minutes=5)).replace(microsecond=0)
    tournament, users, registrations = await flow.with_participants(
        count,
        event_mode="local",
        schedule_mode="fixed_by_staff",
        result_entry_mode="staff_only",
        start_date=start.isoformat(),
        **fields,
    )
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    await flow.start(tournament)
    stations = []
    for name in ("1", "2"):
        doc = {
            "id": new_id(),
            "name": name,
            "device_type": "switch2",
            "tournament_id": tournament["id"],
            "status": "free",
            "current_match_id": None,
            "notes": "Kabel intern",
        }
        await flow.db.stations.insert_one(dict(doc))
        stations.append(doc)
    planned = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    applied = await flow.post(
        f"/api/tournaments/{tournament['id']}/schedule/apply",
        json={"fingerprint": planned["fingerprint"], "planned_at": planned["planned_at"]},
    )
    assert applied.status_code == 200, applied.text
    players = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    return staff, tournament, stations, players


async def queue(flow, tournament):
    response = await flow.get(f"/api/tournaments/{tournament['id']}/live-queue")
    assert response.status_code == 200, response.text
    return response.json()


async def first_round(flow, tournament):
    rows = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))
    return [row for row in rows if row.get("round") == 1]


async def calls(flow) -> list[dict]:
    return await flow.db.notifications.find({"kind": "match_call"}, {"_id": 0}).to_list(50)


async def call(flow, tournament, station, match):
    return await flow.post(
        f"/api/tournaments/{tournament['id']}/live-queue/call",
        json={"station_id": station["id"], "match_id": match["id"]},
    )


async def start(flow, tournament, station, match):
    return await flow.post(
        f"/api/tournaments/{tournament['id']}/live-queue/start",
        json={"station_id": station["id"], "match_id": match["id"]},
    )


@pytest.mark.asyncio
async def test_the_queue_shows_next_per_station_and_the_public_view_has_nothing_internal(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    flow.act_as(None)
    view = await queue(flow, tournament)
    assert view["applies"] is True
    assert [row["station_text"] for row in view["stations"]] == ["Station 1 · Switch 2", "Station 2 · Switch 2"]
    nexts = {row["next"]["match_id"] for row in view["stations"]}
    assert nexts == {match["id"] for match in await first_round(flow, tournament)}
    assert all(row["running"] is None for row in view["stations"])
    final = next(entry for entry in view["matches"].values() if entry["open_slots"] == 2)
    assert final["forecast"] is True and final["ready"] is False and final["names"] == []
    text = json.dumps(view)
    assert "Kabel intern" not in text and "user_id" not in text and "registration_id" not in text
    assert "u-" not in text and "\"user:" not in text, "keine Konto-Kennungen"


@pytest.mark.asyncio
async def test_calling_from_the_phone_sends_one_message_and_the_player_sees_it(flow):
    staff, tournament, stations, players = await on_site(flow)
    match = (await first_round(flow, tournament))[0]
    station = stations[1]
    called = await call(flow, tournament, station, match)
    assert called.status_code == 200, called.text
    stored = await flow.reload(match)
    assert stored["called_at"] and stored["station_id"] == station["id"]
    first = await calls(flow)
    assert {row["user_id"] for row in first} == {players[slot["registration_id"]]["id"] for slot in match["slots"]}

    again = await call(flow, tournament, station, match)
    assert again.status_code == 200 and again.json()["idempotent_replay"] is True
    assert len(await calls(flow)) == len(first), "derselbe Aufruf noch einmal schickt nichts"

    player = players[match["slots"][0]["registration_id"]]
    flow.act_as(player)
    mine = await flow.get(f"/api/tournaments/{tournament['id']}/live-queue/me")
    assert mine.status_code == 200, mine.text
    entry = mine.json()["entries"][0]
    assert entry["match_id"] == match["id"] and entry["state"] == "called"
    assert entry["station_text"] == "Station 2 · Switch 2" and entry["report_by"] and entry["no_show_due_at"]
    view = await queue(flow, tournament)
    assert next(row for row in view["stations"] if row["id"] == station["id"])["next"]["match_id"] == match["id"]

    flow.act_as(None)
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/live-queue/me")).status_code == 401


@pytest.mark.asyncio
async def test_two_helpers_calling_at_once_give_exactly_one_call(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    one, two = await first_round(flow, tournament)
    results = await asyncio.gather(call(flow, tournament, stations[0], one), call(flow, tournament, stations[0], two))
    assert sorted(result.status_code for result in results) == [200, 409], [result.text for result in results]
    winner = one if results[0].status_code == 200 else two
    loser = two if winner is one else one
    assert {row["meta"]["match_id"] for row in await calls(flow)} == {winner["id"]}
    assert not (await flow.reload(loser)).get("called_at")

    # Dasselbe Spiel an eine andere Station rufen: nein - es ist schon an Station 1 aufgerufen.
    moved = await call(flow, tournament, stations[1], winner)
    assert moved.status_code == 409, moved.text
    assert (await flow.reload(winner))["station_id"] == stations[0]["id"]


@pytest.mark.asyncio
async def test_two_helpers_who_both_saw_a_free_station_still_give_one_call(flow, monkeypatch):
    """Wie zwei Worker auf echtem MongoDB: beide lesen „Station frei“, bevor einer schreibt.

    Trotzdem gibt es genau einen Aufruf."""
    import routes.tournament_live_routes as live_routes

    _staff, tournament, stations, _players = await on_site(flow)
    one, two = await first_round(flow, tournament)
    gate = InterleavedReads(flow.db, "stations", parties=2)
    monkeypatch.setattr(live_routes, "get_db", lambda: gate)
    results = await asyncio.gather(call(flow, tournament, stations[1], one), call(flow, tournament, stations[1], two))
    assert sorted(result.status_code for result in results) == [200, 409], [result.text for result in results]
    held = await flow.db.stations.find_one({"id": stations[1]["id"]}, {"_id": 0})
    called = [row for row in await flow.matches(tournament) if row.get("called_at")]
    assert [row["id"] for row in called] == [held["current_match_id"]]
    assert {row["meta"]["match_id"] for row in await calls(flow)} == {held["current_match_id"]}


@pytest.mark.asyncio
async def test_starting_sets_the_real_start_and_the_queue_shows_the_clock(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    match = (await first_round(flow, tournament))[0]
    response = await call(flow, tournament, stations[0], match)
    assert response.status_code == 200
    started = await start(flow, tournament, stations[0], match)
    assert started.status_code == 200, started.text
    stored = await flow.reload(match)
    assert stored["status"] == "in_progress" and stored["started_at"] and not stored.get("called_at")
    starts = await flow.db.notifications.count_documents({"kind": "match_station"})
    again = await start(flow, tournament, stations[0], match)
    assert again.status_code == 200 and again.json()["idempotent_replay"] is True
    assert await flow.db.notifications.count_documents({"kind": "match_station"}) == starts

    running = next(row for row in (await queue(flow, tournament))["stations"] if row["id"] == stations[0]["id"])[
        "running"
    ]
    assert running["match_id"] == match["id"] and running["started_at"] == stored["started_at"]
    assert running["duration_minutes"] == 30 and running["ends_at"]

    # Ein anderes Spiel an der belegten Station starten: nein.
    other = (await first_round(flow, tournament))[1]
    response = await start(flow, tournament, stations[0], other)
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_only_staff_with_station_rights_may_call(flow):
    staff, tournament, stations, players = await on_site(flow)
    match = (await first_round(flow, tournament))[0]
    flow.act_as(next(iter(players.values())))
    response = await call(flow, tournament, stations[0], match)
    assert response.status_code == 403
    helper = await flow.add_user(name="Helfer Station 2")
    await flow.db.tournament_staff_assignments.insert_one(
        {
            "id": new_id(),
            "tournament_id": tournament["id"],
            "user_id": helper["id"],
            "role": "station_manager",
            "scope": "station",
            "scope_id": stations[1]["id"],
            "is_active": True,
        }
    )
    flow.act_as(helper)
    response = await call(flow, tournament, stations[0], match)
    assert response.status_code == 403, "nur die eigene Station"
    view = await queue(flow, tournament)
    assert view["operate"] == {"all": False, "station_ids": [stations[1]["id"]]}
    response = await call(flow, tournament, stations[1], match)
    assert response.status_code == 200
    flow.act_as(None)
    response = await call(flow, tournament, stations[1], match)
    assert response.status_code == 401

    # Ein Spiel aus einem anderen Turnier über dieses Turnier aufrufen: gibt es hier nicht.
    flow.act_as(staff)
    other_staff, other, _other_stations, _ = await on_site(flow)
    flow.act_as(other_staff)
    foreign = (await first_round(flow, other))[0]
    response = await call(flow, tournament, stations[0], foreign)
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_a_match_without_both_players_cannot_be_called(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    final = next(row for row in await flow.matches(tournament) if row.get("round") == 2)
    refused = await call(flow, tournament, stations[0], final)
    assert refused.status_code == 409 and "Spieler" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_planning_again_does_not_move_a_called_match(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    match = (await first_round(flow, tournament))[0]
    target = stations[1] if match["station_id"] == stations[0]["id"] else stations[0]
    called = await call(flow, tournament, target, match)
    assert called.status_code == 200, called.text
    planned = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    assert match["id"] not in {item["match_id"] for item in planned["assignments"]}
    applied = await flow.post(
        f"/api/tournaments/{tournament['id']}/schedule/apply",
        json={"fingerprint": planned["fingerprint"], "planned_at": planned["planned_at"]},
    )
    assert applied.status_code == 200, applied.text
    assert (await flow.reload(match))["station_id"] == target["id"]


@pytest.mark.asyncio
async def test_online_has_no_queue_and_no_call(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _registrations = await flow.with_participants(
        4, event_mode="online", schedule_mode="player_proposal", start_date=now_utc().isoformat()
    )
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200
    view = await queue(flow, tournament)
    assert view["applies"] is False and view["stations"] == []
    match = (await first_round(flow, tournament))[0]
    station = {
        "id": new_id(),
        "name": "1",
        "tournament_id": tournament["id"],
        "status": "free",
        "current_match_id": None,
    }
    await flow.db.stations.insert_one(dict(station))
    response = await call(flow, tournament, station, match)
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_a_private_tournament_queue_is_not_public(flow):
    _staff, tournament, _stations, _players = await on_site(flow, is_public=False)
    flow.act_as(None)
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/live-queue")).status_code == 404


@pytest.mark.asyncio
async def test_missing_result_counts_from_the_real_start(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    one, two = await first_round(flow, tournament)
    late = (now_utc() - timedelta(minutes=60)).isoformat()
    # Geplant vor einer Stunde, aber erst vor 10 Minuten gestartet (30 Min. Dauer): kein „Ergebnis fehlt“.
    await flow.db.matches_v2.update_one(
        {"id": one["id"]},
        {
            "$set": {
                "scheduled_at": late,
                "status": "in_progress",
                "started_at": (now_utc() - timedelta(minutes=10)).isoformat(),
            }
        },
    )
    # Geplant vor einer Stunde, wartet noch an seiner Station: Verzug, kein fehlendes Ergebnis.
    await flow.db.matches_v2.update_one({"id": two["id"]}, {"$set": {"scheduled_at": late}})
    lead = (await flow.get(f"/api/tournaments/{tournament['id']}/lead")).json()
    timing = {item["id"]: item["timing"] for item in lead["matches"]}
    assert timing[one["id"]]["missing"] is False and timing[one["id"]]["running_minutes"] == 10
    assert timing[two["id"]]["missing"] is False
    assert [item for item in lead["attention"] if item["kind"] == "result_missing"] == []

    await flow.db.matches_v2.update_one(
        {"id": one["id"]}, {"$set": {"started_at": (now_utc() - timedelta(minutes=40)).isoformat()}}
    )
    lead = (await flow.get(f"/api/tournaments/{tournament['id']}/lead")).json()
    assert {item["id"]: item["timing"] for item in lead["matches"]}[one["id"]]["missing"] is True
