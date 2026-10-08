"""Team am Spieltag (#1192): Aufstellung (Rechte, Größe, Ersatz, Frist), „Ich bin da“, Anstupsen mit Grenze, wer
Spiel-Meldungen bekommt, und was die Turnierleitung beim Check-in sieht. Die Uhr steht fest (17.10.2026, Turniertag).
Erfundene Daten, keine echten Personen."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from routes import team_day_routes  # noqa: E402
from services import team_lineup  # noqa: E402

DAY = datetime(2026, 10, 17, 9, 0, tzinfo=timezone.utc)   # 11:00 in Wien, am Turniertag


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def clock(monkeypatch):
    state = {"now": DAY}

    def now():
        return state["now"]
    monkeypatch.setattr(team_lineup, "now_utc", now)
    monkeypatch.setattr(team_day_routes, "now_utc", now)
    return state


async def setup_team(flow, *, substitutes=True, team_size=2, **tournament_fields):
    captain = await flow.add_user(role="player", name="neonfalke")
    co = await flow.add_user(role="player", name="pixelpanther")
    luna = await flow.add_user(role="player", name="lunabyte")
    kiwi = await flow.add_user(role="player", name="kiwikomet")
    team = {"id": new_id(), "name": "Lions Rocket", "tag": "LRK", "leader_id": captain["id"], "co_leader_ids": [co["id"]],
            "member_ids": [captain["id"], co["id"], luna["id"], kiwi["id"]], "is_public": True}
    await flow.db.teams.insert_one(dict(team))
    for user in (captain, co, luna, kiwi):
        await flow.db.team_members.insert_one({"team_id": team["id"], "user_id": user["id"], "role": "member"})
    fields = {"team_mode": "team", "team_size": team_size, "substitutes_allowed": substitutes, "status": "check_in",
              "start_date": "2026-10-17T12:00:00+00:00", "check_in_until": "2026-10-17T11:45:00+00:00", "title": "Rocket League Herbst-Cup"}
    fields.update(tournament_fields)
    tournament = await flow.create_tournament(**fields)
    reg = {"id": new_id(), "tournament_id": tournament["id"], "team_id": team["id"], "user_id": captain["id"],
           "display_name": "[LRK] Lions Rocket", "status": "approved"}
    await flow.db.tournament_registrations.insert_one(dict(reg))
    return tournament, team, reg, (captain, co, luna, kiwi)


@pytest.mark.asyncio
async def test_lineup_rights_size_substitutes_and_deadline(flow, clock):
    tournament, team, reg, (captain, co, luna, kiwi) = await setup_team(flow)
    flow.act_as(luna)
    view = (await flow.get(f"/api/team-day/{tournament['id']}")).json()
    assert view["applicable"] is True and view["team_size"] == 2 and view["substitutes_allowed"] is True
    assert view["can_edit"] is False and view["lineup_set"] is False
    assert [m["role"] for m in view["members"]] == ["captain", "co_captain", "player", "player"]
    assert (await flow.put(f"/api/team-day/{tournament['id']}/lineup", json={"lineup": [luna["id"], kiwi["id"]]})).status_code == 403

    flow.act_as(co)
    assert (await flow.get(f"/api/team-day/{tournament['id']}")).json()["can_edit"] is True
    too_many = await flow.put(f"/api/team-day/{tournament['id']}/lineup", json={"lineup": [captain["id"], luna["id"], kiwi["id"]]})
    assert too_many.status_code == 400 and "genau 2" in too_many.json()["detail"]
    stranger = await flow.add_user(role="player", name="fremd")
    assert (await flow.put(f"/api/team-day/{tournament['id']}/lineup", json={"lineup": [luna["id"], stranger["id"]]})).status_code == 400
    assert (await flow.put(f"/api/team-day/{tournament['id']}/lineup", json={"lineup": [luna["id"], luna["id"]]})).status_code == 400
    saved = (await flow.put(f"/api/team-day/{tournament['id']}/lineup", json={"lineup": [luna["id"], kiwi["id"]]})).json()
    assert saved["lineup"] == [luna["id"], kiwi["id"]] and saved["substitutes"] == [captain["id"], co["id"]], "die übrigen sind Ersatz"
    stored = await flow.db.tournament_registrations.find_one({"id": reg["id"]})
    assert stored["lineup"] == [luna["id"], kiwi["id"]] and stored["lineup_updated_by"] == co["id"]

    # Ohne Ersatz-Erlaubnis gibt es keinen Ersatz.
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"substitutes_allowed": False}})
    assert (await flow.put(f"/api/team-day/{tournament['id']}/lineup", json={"lineup": [luna["id"], kiwi["id"]]})).json()["substitutes"] == []

    # Frist: nach dem Ende des Check-ins und sobald das Turnier läuft, ist die Aufstellung fest.
    clock["now"] = datetime(2026, 10, 17, 11, 50, tzinfo=timezone.utc)
    late = await flow.put(f"/api/team-day/{tournament['id']}/lineup", json={"lineup": [captain["id"], co["id"]]})
    assert late.status_code == 409 and "Ende des Check-ins" in late.json()["detail"]
    assert (await flow.get(f"/api/team-day/{tournament['id']}")).json()["can_edit"] is False
    clock["now"] = DAY
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "live"}})
    cleared = await flow.delete(f"/api/team-day/{tournament['id']}/lineup")
    assert cleared.status_code == 409


@pytest.mark.asyncio
async def test_solo_tournaments_show_nothing(flow, clock):
    player = await flow.add_user(role="player", name="einzel")
    tournament = await flow.create_tournament(team_mode="solo")
    await flow.register(tournament, player)
    flow.act_as(player)
    assert (await flow.get(f"/api/team-day/{tournament['id']}")).json() == {"applicable": False}


@pytest.mark.asyncio
async def test_presence_counts_lineup_and_nudge_has_a_limit(flow, clock):
    tournament, team, reg, (captain, co, luna, kiwi) = await setup_team(flow, team_size=2)
    flow.act_as(captain)
    await flow.put(f"/api/team-day/{tournament['id']}/lineup", json={"lineup": [captain["id"], luna["id"]]})

    # Vor dem Turniertag gibt es kein „Ich bin da“.
    clock["now"] = DAY - timedelta(days=1)
    assert (await flow.post(f"/api/team-day/{tournament['id']}/presence")).status_code == 409
    clock["now"] = DAY

    flow.act_as(luna)
    here = (await flow.post(f"/api/team-day/{tournament['id']}/presence")).json()
    assert here["presence"]["me_present"] is True and here["presence"]["count"] == 1 and here["presence"]["total"] == 4, "Aufstellung samt Ersatz"
    assert (await flow.post(f"/api/team-day/{tournament['id']}/nudge")).status_code == 403, "nur Kapitän und Co-Kapitän"

    flow.act_as(captain)
    nudged = await flow.post(f"/api/team-day/{tournament['id']}/nudge")
    assert nudged.status_code == 200 and nudged.json()["nudged"] == 2, "co und kiwi fehlen - der Kapitän stupst sich nicht selbst an"
    notes = await flow.db.notifications.find({"kind": "team_presence_nudge"}, {"_id": 0}).to_list(10)
    assert sorted(n["user_id"] for n in notes) == sorted([co["id"], kiwi["id"]])
    again = await flow.post(f"/api/team-day/{tournament['id']}/nudge")
    assert again.status_code == 429 and "10 Minuten" in again.json()["detail"]
    clock["now"] = DAY + timedelta(minutes=11)
    assert (await flow.post(f"/api/team-day/{tournament['id']}/nudge")).status_code == 200

    flow.act_as(luna)
    away = (await flow.delete(f"/api/team-day/{tournament['id']}/presence")).json()
    assert away["presence"]["count"] == 0 and away["presence"]["me_present"] is False


@pytest.mark.asyncio
async def test_match_messages_go_to_the_lineup_or_to_all_members(flow, clock):
    tournament, team, reg, (captain, co, luna, kiwi) = await setup_team(flow)
    assert await team_lineup.registration_recipients(flow.db, [reg]) == {captain["id"], co["id"], luna["id"], kiwi["id"]}
    flow.act_as(captain)
    await flow.put(f"/api/team-day/{tournament['id']}/lineup", json={"lineup": [luna["id"], kiwi["id"]]})
    stored = await flow.db.tournament_registrations.find_one({"id": reg["id"]}, {"_id": 0})
    assert await team_lineup.registration_recipients(flow.db, [stored]) == {luna["id"], kiwi["id"]}, "der Aufruf geht an die Aufstellung"

    other = await flow.add_user(role="player", name="gegner")
    other_reg = await flow.register(tournament, other)
    from services.match_notifications import notify_match_result_confirmed
    match = {"id": new_id(), "tournament_id": tournament["id"], "stage_id": "s1", "round": 1, "match_type": "duel", "status": "completed",
             "slots": [{"slot": 1, "registration_id": reg["id"]}, {"slot": 2, "registration_id": other_reg["id"]}],
             "results": [{"registration_id": reg["id"], "rank": 1, "score": 2}, {"registration_id": other_reg["id"], "rank": 2, "score": 0}]}
    sent = await notify_match_result_confirmed(flow.db, match)
    assert sent == 3
    receivers = {n["user_id"] for n in await flow.db.notifications.find({"kind": "match_result"}, {"_id": 0}).to_list(10)}
    assert receivers == {luna["id"], kiwi["id"], other["id"]}


@pytest.mark.asyncio
async def test_staff_see_the_lineup_at_check_in(flow, clock):
    tournament, team, reg, (captain, co, luna, kiwi) = await setup_team(flow)
    flow.act_as(captain)
    await flow.put(f"/api/team-day/{tournament['id']}/lineup", json={"lineup": [captain["id"], luna["id"]]})
    flow.act_as(luna)
    await flow.post(f"/api/team-day/{tournament['id']}/presence")
    assert (await flow.get(f"/api/team-day/{tournament['id']}/lineups")).status_code == 403
    flow.act_as(await flow.add_staff())
    lineups = (await flow.get(f"/api/team-day/{tournament['id']}/lineups")).json()
    row = lineups[reg["id"]]
    assert row["team"] == "Lions Rocket" and row["lineup_set"] is True
    assert [p["name"] for p in row["starters"]] == ["neonfalke", "lunabyte"]
    assert [p["name"] for p in row["substitutes"]] == ["pixelpanther", "kiwikomet"]
    assert (row["present"], row["total"]) == (1, 4)
