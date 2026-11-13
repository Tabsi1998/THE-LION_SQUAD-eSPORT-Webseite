"""Stationen in der Turnierleitung (#1162) durch die echten Routen: Freigeben, Defekt und Umlegen vom Handy.

- ``POST .../live-queue/broken``: die Stationsleitung setzt „Defekt“ ohne Admin-Recht - nur an ihrer Station; „wieder
  bereit“ stellt den Stand her, der zum gehaltenen Spiel passt.
- ``POST .../live-queue/move``: ein laufendes Spiel wechselt die Station und behält Startzeit und Uhr; ein aufgerufenes
  wird an der neuen Station neu aufgerufen.
- ``POST .../live-queue/release``: ein Aufruf geht zurück in die Warteschlange; ein laufendes Spiel gibt die Station ab.
- „Als Nächstes“ je freier Station: dieselbe Reihenfolge wie die automatische Zuweisung (Spielplaner).
- Zwei Leitungen zugleich: genau ein Wechsel, die andere bekommt 409 - oder bei demselben Wunsch ``idempotent_replay``.
- Aufruf bei Teams: an alle Mitglieder (#1136).
"""

import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from test_live_queue_flow import call, calls, first_round, on_site, queue, start  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def broken(flow, tournament, station, value=True):
    return await flow.post(
        f"/api/tournaments/{tournament['id']}/live-queue/broken", json={"station_id": station["id"], "broken": value}
    )


async def move(flow, tournament, station, match, target):
    return await flow.post(
        f"/api/tournaments/{tournament['id']}/live-queue/move",
        json={"station_id": station["id"], "match_id": match["id"], "to_station_id": target["id"]},
    )


async def release(flow, tournament, station, match):
    return await flow.post(
        f"/api/tournaments/{tournament['id']}/live-queue/release",
        json={"station_id": station["id"], "match_id": match["id"]},
    )


async def station_of(flow, station) -> dict:
    return await flow.db.stations.find_one({"id": station["id"]}, {"_id": 0})


async def add_station(flow, tournament, name: str) -> dict:
    doc = {"id": new_id(), "name": name, "device_type": "switch2", "tournament_id": tournament["id"],
           "status": "free", "current_match_id": None}
    await flow.db.stations.insert_one(dict(doc))
    return doc


async def station_lead(flow, tournament, station) -> dict:
    helper = await flow.add_user(name="Stationsleitung")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "user_id": helper["id"], "role": "station_manager",
        "scope": "station", "scope_id": station["id"], "is_active": True,
    })
    return helper


async def audit(flow, action: str) -> list[dict]:
    return await flow.db.audit_logs.find({"action": action}, {"_id": 0}).to_list(50)


@pytest.mark.asyncio
async def test_the_station_lead_sets_broken_without_admin_rights_only_at_her_station(flow):
    staff, tournament, stations, players = await on_site(flow)
    helper = await station_lead(flow, tournament, stations[1])

    flow.act_as(helper)
    marked = await broken(flow, tournament, stations[1])
    assert marked.status_code == 200, marked.text
    assert marked.json() == {"ok": True, "idempotent_replay": False, "holds": None}
    stored = await station_of(flow, stations[1])
    assert stored["status"] == "broken" and stored["broken_at"]
    assert [row["data"]["station_id"] for row in await audit(flow, "station.broken")] == [stations[1]["id"]]
    again = await broken(flow, tournament, stations[1])
    assert again.status_code == 200 and again.json()["idempotent_replay"] is True, "Doppeltipp ändert nichts"
    assert len(await audit(flow, "station.broken")) == 1

    # Der Admin-Weg bleibt der Stationsleitung verschlossen - der schmale Weg genügt.
    admin_way = await flow.patch(f"/api/stations/{stations[1]['id']}", json={"status": "free"})
    assert admin_way.status_code == 403

    # Nur die eigene Station, nur mit Recht, nur Stationen dieses Turniers.
    refused = await broken(flow, tournament, stations[0])
    assert refused.status_code == 403
    assert (await station_of(flow, stations[0]))["status"] == "free"
    flow.act_as(next(iter(players.values())))
    player = await broken(flow, tournament, stations[1], value=False)
    assert player.status_code == 403
    flow.act_as(None)
    anonymous = await broken(flow, tournament, stations[1], value=False)
    assert anonymous.status_code == 401
    flow.act_as(staff)
    _other_staff, other, other_stations, _ = await on_site(flow)
    flow.act_as(staff)
    foreign = await broken(flow, tournament, other_stations[0])
    assert foreign.status_code == 404
    assert (await station_of(flow, other_stations[0]))["status"] == "free"
    assert other["id"] != tournament["id"]

    flow.act_as(helper)
    repaired = await broken(flow, tournament, stations[1], value=False)
    assert repaired.status_code == 200, repaired.text
    stored = await station_of(flow, stations[1])
    assert stored["status"] == "free" and "broken_at" not in stored
    assert len(await audit(flow, "station.repaired")) == 1


@pytest.mark.asyncio
async def test_a_running_match_stays_on_a_broken_station_until_it_is_moved_with_its_clock(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    match = (await first_round(flow, tournament))[0]
    spare = await add_station(flow, tournament, "3")
    assert (await call(flow, tournament, stations[0], match)).status_code == 200
    assert (await start(flow, tournament, stations[0], match)).status_code == 200
    started = (await flow.reload(match))["started_at"]
    start_messages = await flow.db.notifications.count_documents({"kind": "match_station"})

    marked = await broken(flow, tournament, stations[0])
    assert marked.status_code == 200, marked.text
    assert marked.json()["holds"] == {"match_id": match["id"], "match_key": match["match_key"], "state": "running"}
    row = next(row for row in (await queue(flow, tournament))["stations"] if row["id"] == stations[0]["id"])
    assert row["status"] == "broken" and row["running"]["match_id"] == match["id"]

    # Auf eine belegte Station: nein. Auf sich selbst: nein.
    other = (await first_round(flow, tournament))[1]
    assert (await call(flow, tournament, stations[1], other)).status_code == 200
    taken = await move(flow, tournament, stations[0], match, stations[1])
    assert taken.status_code == 409 and "belegt" in taken.json()["detail"]
    same = await move(flow, tournament, stations[0], match, stations[0])
    assert same.status_code == 422

    moved = await move(flow, tournament, stations[0], match, spare)
    assert moved.status_code == 200, moved.text
    assert moved.json()["state"] == "running" and moved.json()["to"] == "Station 3 · Switch 2"
    stored = await flow.reload(match)
    assert stored["station_id"] == spare["id"] and stored["started_at"] == started and stored["status"] == "in_progress"
    target = await station_of(flow, spare)
    assert target["status"] == "busy" and target["current_match_id"] == match["id"]
    source = await station_of(flow, stations[0])
    assert source["status"] == "broken" and not source.get("current_match_id"), "die defekte Station bleibt defekt"
    assert await flow.db.notifications.count_documents({"kind": "match_station"}) == start_messages, "keine zweite Startnachricht"
    logged = await audit(flow, "match.moved")
    assert [(row["data"]["from_station_id"], row["data"]["to_station_id"]) for row in logged] == [(stations[0]["id"], spare["id"])]
    running = next(row for row in (await queue(flow, tournament))["stations"] if row["id"] == spare["id"])["running"]
    assert running["match_id"] == match["id"] and running["started_at"] == started

    replay = await move(flow, tournament, stations[0], match, spare)
    assert replay.status_code == 200 and replay.json()["idempotent_replay"] is True

    # Wieder bereit: frei, denn das Spiel ist umgelegt.
    assert (await broken(flow, tournament, stations[0], value=False)).status_code == 200
    assert (await station_of(flow, stations[0]))["status"] == "free"


@pytest.mark.asyncio
async def test_moving_a_called_match_calls_the_players_again_at_the_new_station(flow):
    _staff, tournament, stations, players = await on_site(flow)
    match = (await first_round(flow, tournament))[0]
    assert (await call(flow, tournament, stations[0], match)).status_code == 200
    first_calls = await calls(flow)
    first_called = (await flow.reload(match))["called_at"]
    assert (await broken(flow, tournament, stations[0])).json()["holds"]["state"] == "called"

    moved = await move(flow, tournament, stations[0], match, stations[1])
    assert moved.status_code == 200, moved.text
    stored = await flow.reload(match)
    assert stored["station_id"] == stations[1]["id"] and stored["called_at"] and stored["called_at"] >= first_called
    assert (await station_of(flow, stations[1]))["status"] == "reserved"
    source = await station_of(flow, stations[0])
    assert source["status"] == "broken" and not source.get("current_match_id") and not source.get("called_at")
    fresh = [row for row in await calls(flow) if row not in first_calls]
    expected = {players[slot["registration_id"]]["id"] for slot in match["slots"]}
    assert {row["user_id"] for row in fresh} == expected
    assert all(row["meta"]["station_id"] == stations[1]["id"] and "Station 2" in row["title"] for row in fresh)


@pytest.mark.asyncio
async def test_move_needs_a_held_open_match_and_rights_on_both_stations(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    one, two = await first_round(flow, tournament)
    # Nur geplant, nicht aufgerufen: hier gibt es nichts umzulegen.
    not_held = await move(flow, tournament, stations[0], one, stations[1])
    assert not_held.status_code == 409
    assert (await call(flow, tournament, stations[0], one)).status_code == 200
    wrong = await move(flow, tournament, stations[0], two, stations[1])
    assert wrong.status_code == 409 and "anderes Spiel" in wrong.json()["detail"]

    helper = await station_lead(flow, tournament, stations[0])
    flow.act_as(helper)
    refused = await move(flow, tournament, stations[0], one, stations[1])
    assert refused.status_code == 403, "die Zielstation gehört nicht zum Einsatz"
    assert (await flow.reload(one))["station_id"] == stations[0]["id"]


@pytest.mark.asyncio
async def test_releasing_a_call_returns_the_match_to_the_queue_and_a_running_one_frees_the_station(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    one, two = await first_round(flow, tournament)
    assert (await call(flow, tournament, stations[0], one)).status_code == 200
    released = await release(flow, tournament, stations[0], one)
    assert released.status_code == 200, released.text
    assert released.json() == {"ok": True, "idempotent_replay": False, "state": "called"}
    stored = await flow.reload(one)
    assert not stored.get("called_at") and not stored.get("station_id")
    station = await station_of(flow, stations[0])
    assert station["status"] == "free" and not station.get("current_match_id") and not station.get("called_at")
    view = await queue(flow, tournament)
    assert one["id"] in {row["next"]["match_id"] for row in view["stations"] if row["next"]}, "wieder in der Warteschlange"
    replay = await release(flow, tournament, stations[0], one)
    assert replay.status_code == 200 and replay.json()["idempotent_replay"] is True

    assert (await call(flow, tournament, stations[1], two)).status_code == 200
    assert (await start(flow, tournament, stations[1], two)).status_code == 200
    stale = await release(flow, tournament, stations[1], one)
    assert stale.status_code == 409 and "anderes Spiel" in stale.json()["detail"]
    released = await release(flow, tournament, stations[1], two)
    assert released.status_code == 200 and released.json()["state"] == "running"
    stored = await flow.reload(two)
    assert stored["status"] == "in_progress" and stored["started_at"], "das Ergebnis kommt danach"
    assert (await station_of(flow, stations[1]))["status"] == "free"
    assert [row["data"]["state"] for row in await audit(flow, "station.released")] == ["called", "running"]


@pytest.mark.asyncio
async def test_a_broken_station_keeps_its_status_when_released(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    match = (await first_round(flow, tournament))[0]
    assert (await call(flow, tournament, stations[0], match)).status_code == 200
    assert (await broken(flow, tournament, stations[0])).status_code == 200
    assert (await release(flow, tournament, stations[0], match)).status_code == 200
    station = await station_of(flow, stations[0])
    assert station["status"] == "broken" and not station.get("current_match_id")
    # Wieder bereit ohne Spiel: frei.
    assert (await broken(flow, tournament, stations[0], value=False)).status_code == 200
    assert (await station_of(flow, stations[0]))["status"] == "free"


@pytest.mark.asyncio
async def test_next_on_a_free_station_follows_the_automatic_assignment(flow):
    _staff, tournament, stations, _players = await on_site(flow, count=8)
    assert (await broken(flow, tournament, stations[0])).status_code == 200
    preview = await flow.post(f"/api/stations/auto-assign?tournament_id={tournament['id']}&plan=true")
    assert preview.status_code == 200, preview.text
    planned = sorted(
        (row for row in preview.json()["assignments"] if row.get("station_id") == stations[1]["id"]),
        key=lambda row: (row["scheduled_at"], row.get("match_key") or ""),
    )
    view = await queue(flow, tournament)
    rows = {row["id"]: row for row in view["stations"]}
    assert rows[stations[0]["id"]]["status"] == "broken" and rows[stations[0]["id"]]["next"] is None
    free = rows[stations[1]["id"]]
    assert free["next"]["ready"] is True
    assert [free["next"]["match_id"], free["after"]["match_id"]] == [row["match_id"] for row in planned[:2]]
    round_one = {row["id"] for row in await first_round(flow, tournament)}
    assert free["next"]["match_id"] in round_one


@pytest.mark.asyncio
async def test_two_leads_at_once_give_exactly_one_change(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    one, two = await first_round(flow, tournament)
    spare = await add_station(flow, tournament, "3")
    for station, match in ((stations[0], one), (stations[1], two)):
        assert (await call(flow, tournament, station, match)).status_code == 200
        assert (await start(flow, tournament, station, match)).status_code == 200

    # Beide wollen ihr Spiel auf die eine freie Station 3.
    results = await asyncio.gather(move(flow, tournament, stations[0], one, spare), move(flow, tournament, stations[1], two, spare))
    assert sorted(result.status_code for result in results) == [200, 409], [result.text for result in results]
    held = (await station_of(flow, spare))["current_match_id"]
    winner = one if held == one["id"] else two
    loser = two if winner is one else one
    assert (await flow.reload(winner))["station_id"] == spare["id"]
    assert (await flow.reload(loser))["station_id"] != spare["id"]
    assert len(await audit(flow, "match.moved")) == 1

    # Doppeltipp auf „Defekt“: genau ein Wechsel, ein Protokolleintrag.
    results = await asyncio.gather(broken(flow, tournament, stations[1]), broken(flow, tournament, stations[1]))
    codes = sorted(result.status_code for result in results)
    assert codes in ([200, 200], [200, 409]), [result.text for result in results]
    assert sum(1 for result in results if result.status_code == 200 and not result.json()["idempotent_replay"]) == 1
    assert len(await audit(flow, "station.broken")) == 1


@pytest.mark.asyncio
async def test_calling_a_team_match_reaches_every_team_member(flow):
    _staff, tournament, stations, players = await on_site(flow, team_mode="team")
    match = (await first_round(flow, tournament))[0]
    members: set[str] = set()
    for slot in match["slots"]:
        lead = players[slot["registration_id"]]
        mates = [await flow.add_user(name=f"Mitglied {index}") for index in range(2)]
        team_id = new_id()
        await flow.db.teams.insert_one({"id": team_id, "name": f"Team {lead['display_name']}", "leader_id": lead["id"],
                                        "co_leader_ids": [], "member_ids": [lead["id"], *[mate["id"] for mate in mates]]})
        await flow.db.tournament_registrations.update_one({"id": slot["registration_id"]}, {"$set": {"team_id": team_id}})
        members |= {lead["id"], *[mate["id"] for mate in mates]}

    called = await call(flow, tournament, stations[0], match)
    assert called.status_code == 200, called.text
    assert {row["user_id"] for row in await calls(flow)} == members
    assert len(members) == 6


# ---------------------------------------------------------------- Geteilte Event-Stationen (#1162, Review H1)

async def shared_world(flow):
    """Zwei Turniere eines Events, eine geteilte Station ohne Turnier; Turnier B ruft dort auf. Orga A ist Helferin
    nur in Turnier A."""
    event_id = new_id()
    staff, a, _a_stations, _ = await on_site(flow, event_id=event_id)
    flow.act_as(staff)
    _staff_b, b, _b_stations, _ = await on_site(flow, event_id=event_id)
    shared = {"id": new_id(), "name": "S", "device_type": "switch2", "tournament_id": None, "event_id": event_id,
              "status": "free", "current_match_id": None}
    await flow.db.stations.insert_one(dict(shared))
    b_match = (await first_round(flow, b))[0]
    flow.act_as(staff)
    assert (await call(flow, b, shared, b_match)).status_code == 200
    org_a = await flow.add_user(name="Orga A")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": a["id"], "user_id": org_a["id"], "role": "organizer",
        "scope": "tournament", "scope_id": None, "is_active": True,
    })
    return staff, a, b, shared, b_match, org_a


@pytest.mark.asyncio
async def test_a_shared_station_held_by_another_tournament_is_not_released_from_here(flow):
    _staff, a, b, shared, b_match, org_a = await shared_world(flow)
    flow.act_as(org_a)
    view = await queue(flow, a)
    row = next(row for row in view["stations"] if row["id"] == shared["id"])
    assert row["hold_issue"] == {"kind": "other", "tournament_title": b["title"]}

    refused = await release(flow, a, shared, b_match)
    assert refused.status_code == 409, refused.text
    assert "dessen Leitung gibt frei" in refused.json()["detail"] and b["title"] in refused.json()["detail"]
    stored = await flow.reload(b_match)
    assert stored["called_at"] and stored["station_id"] == shared["id"], "der Aufruf von B bleibt"
    assert (await station_of(flow, shared))["current_match_id"] == b_match["id"]
    assert not await audit(flow, "station.released")

    # Über Turnier B darf Orga A gar nicht.
    direct = await release(flow, b, shared, b_match)
    assert direct.status_code == 403


@pytest.mark.asyncio
async def test_a_shared_station_goes_broken_only_after_asking_and_the_other_lead_hears_of_it(flow):
    staff, a, b, shared, b_match, org_a = await shared_world(flow)
    flow.act_as(org_a)
    asked = await broken(flow, a, shared)
    assert asked.status_code == 409 and "trotzdem als defekt melden" in asked.json()["detail"]
    assert (await station_of(flow, shared))["status"] == "reserved"

    confirmed = await flow.post(f"/api/tournaments/{a['id']}/live-queue/broken",
                                json={"station_id": shared["id"], "broken": True, "confirm_other": True})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["holds"] == {"match_id": b_match["id"], "match_key": b_match["match_key"], "state": "called",
                                         "other_tournament": b["title"]}
    stored = await station_of(flow, shared)
    assert stored["status"] == "broken" and stored["current_match_id"] == b_match["id"], "das Spiel von B bleibt, bis B umlegt"
    logged = await audit(flow, "station.broken")
    assert sorted(row["target_id"] for row in logged) == sorted([a["id"], b["id"]])
    told = await flow.db.notifications.find({"kind": "match_attention", "meta.station_id": shared["id"]}, {"_id": 0}).to_list(10)
    assert staff["id"] in {row["user_id"] for row in told} and org_a["id"] not in {row["user_id"] for row in told}
    assert all(row["meta"]["tournament_id"] == b["id"] and "reiter=stationen" in row["url"] for row in told)

    # Bei B steht es unter „Braucht Aufmerksamkeit“ - mit Umlegen.
    flow.act_as(staff)
    lead = (await flow.get(f"/api/tournaments/{b['id']}/lead")).json()
    case = next(item for item in lead["attention"] if item["kind"] == "station_broken")
    assert case["station_id"] == shared["id"] and case["match_ids"] == [b_match["id"]]


# ---------------------------------------------------------------- Hängende Station räumen (#1162, Review M2)

async def clear(flow, tournament, station):
    return await flow.post(f"/api/tournaments/{tournament['id']}/live-queue/clear", json={"station_id": station["id"]})


@pytest.mark.asyncio
async def test_deleting_a_stage_frees_the_stations_of_its_matches(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    match = (await first_round(flow, tournament))[0]
    assert (await call(flow, tournament, stations[0], match)).status_code == 200
    assert (await broken(flow, tournament, stations[1])).status_code == 200
    other = (await first_round(flow, tournament))[1]
    await flow.db.stations.update_one({"id": stations[1]["id"]}, {"$set": {"current_match_id": other["id"]}})
    deleted = await flow.delete(f"/api/tournaments/{tournament['id']}/stages/{match['stage_id']}?force=true")
    assert deleted.status_code == 200, deleted.text
    first = await station_of(flow, stations[0])
    assert first["status"] == "free" and not first.get("current_match_id") and not first.get("called_at")
    second = await station_of(flow, stations[1])
    assert second["status"] == "broken" and not second.get("current_match_id"), "defekt bleibt defekt"


@pytest.mark.asyncio
async def test_a_stuck_station_is_shown_and_cleared_but_never_one_with_an_open_match(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    helper = await station_lead(flow, tournament, stations[0])
    await flow.db.stations.update_one({"id": stations[0]["id"]}, {"$set": {"status": "busy", "current_match_id": "weg"}})
    flow.act_as(helper)
    row = next(row for row in (await queue(flow, tournament))["stations"] if row["id"] == stations[0]["id"])
    assert row["hold_issue"] == {"kind": "stuck", "tournament_title": None}
    cleared = await clear(flow, tournament, stations[0])
    assert cleared.status_code == 200 and cleared.json()["idempotent_replay"] is False, cleared.text
    stored = await station_of(flow, stations[0])
    assert stored["status"] == "free" and not stored.get("current_match_id")
    assert [row["data"]["stale_match_id"] for row in await audit(flow, "station.cleared")] == ["weg"]
    again = await clear(flow, tournament, stations[0])
    assert again.status_code == 200 and again.json()["idempotent_replay"] is True
    # Fremde Station: nur mit Recht.
    assert (await clear(flow, tournament, stations[1])).status_code == 403

    # Mit einem offenen Spiel dieses Turniers: nicht räumen.
    match = (await first_round(flow, tournament))[0]
    assert (await call(flow, tournament, stations[0], match)).status_code == 200
    refused = await clear(flow, tournament, stations[0])
    assert refused.status_code == 409 and "Freigeben" in refused.json()["detail"]
    assert (await station_of(flow, stations[0]))["current_match_id"] == match["id"]


@pytest.mark.asyncio
async def test_a_shared_station_of_another_tournament_is_not_cleared_from_here(flow):
    _staff, a, b, shared, b_match, org_a = await shared_world(flow)
    flow.act_as(org_a)
    refused = await clear(flow, a, shared)
    assert refused.status_code == 409 and "dessen Leitung gibt frei" in refused.json()["detail"]
    assert (await station_of(flow, shared))["current_match_id"] == b_match["id"]
    assert b["id"] != a["id"]


# ---------------------------------------------------------------- Anderes Spiel aufrufen (#1162, Review M3)

@pytest.mark.asyncio
async def test_another_ready_match_can_be_called_at_a_free_station_but_only_where_it_fits(flow):
    _staff, tournament, stations, _players = await on_site(flow, count=8)
    view = await queue(flow, tournament)
    nexts = {row["id"]: row["next"]["match_id"] for row in view["stations"]}
    # Ein bereites Spiel, das nicht „Als Nächstes“ an Station 1 steht.
    other = next(entry for entry in view["matches"].values()
                 if entry["ready"] and entry["state"] == "queued" and entry["match_id"] != nexts[stations[0]["id"]])
    called = await flow.post(f"/api/tournaments/{tournament['id']}/live-queue/call",
                             json={"station_id": stations[0]["id"], "match_id": other["match_id"]})
    assert called.status_code == 200, called.text
    assert (await flow.db.matches_v2.find_one({"id": other["match_id"]}, {"_id": 0}))["station_id"] == stations[0]["id"]

    # Eine Station für ein anderes Spiel (game_id) passt nicht.
    game = {"id": new_id(), "name": "Anderes Spiel"}
    await flow.db.games.insert_one(dict(game))
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"game_id": new_id()}})
    await flow.db.stations.update_one({"id": stations[1]["id"]}, {"$set": {"game_id": game["id"]}})
    rest = next(entry for entry in view["matches"].values()
                if entry["ready"] and entry["state"] == "queued" and entry["match_id"] != other["match_id"])
    refused = await flow.post(f"/api/tournaments/{tournament['id']}/live-queue/call",
                              json={"station_id": stations[1]["id"], "match_id": rest["match_id"]})
    assert refused.status_code == 409 and "passt nicht" in refused.json()["detail"]
    assert not (await flow.db.matches_v2.find_one({"id": rest["match_id"]}, {"_id": 0})).get("called_at")


@pytest.mark.asyncio
async def test_move_only_to_a_free_station_that_fits_the_game(flow):
    _staff, tournament, stations, _players = await on_site(flow)
    match = (await first_round(flow, tournament))[0]
    assert (await call(flow, tournament, stations[0], match)).status_code == 200
    # Hängt (belegt ohne Spiel): nicht frei.
    await flow.db.stations.update_one({"id": stations[1]["id"]}, {"$set": {"status": "busy"}})
    stuck = await move(flow, tournament, stations[0], match, stations[1])
    assert stuck.status_code == 409 and "nicht frei" in stuck.json()["detail"]
    # Station für ein anderes Spiel: passt nicht.
    other_game = await add_station(flow, tournament, "3")
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"game_id": new_id()}})
    await flow.db.stations.update_one({"id": other_game["id"]}, {"$set": {"game_id": new_id()}})
    wrong = await move(flow, tournament, stations[0], match, other_game)
    assert wrong.status_code == 409 and "passt nicht" in wrong.json()["detail"]
    assert (await flow.reload(match))["station_id"] == stations[0]["id"]
    fitting = await add_station(flow, tournament, "4")
    moved = await move(flow, tournament, stations[0], match, fitting)
    assert moved.status_code == 200, moved.text
