"""Planen mit Vorschau, Übernehmen auf einmal (#1552) - durch die echten Routen.

Vor Ort: der Planer schreibt Zeit und Station zusammen, mit Quelle. Online: keine Stationen, keine
Stations-Warnungen, der Spieltag-Lauf schreibt Wiener Zeit. Eine lokale Ein-Tages-Gruppenphase lässt der Lauf
in Ruhe. Antwortfrist und Eskalation laufen über das Turnier.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio
from fastapi import HTTPException

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import TournamentCreate, new_id, now_utc  # noqa: E402
from services.matchday_schedule import persist_all_matchday_schedules  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def stations(flow, tournament, *names):
    docs = []
    for name in names:
        doc = {"id": new_id(), "name": name, "device_type": "switch2", "tournament_id": tournament["id"], "status": "free",
               "current_match_id": None, "notes": None}
        await flow.db.stations.insert_one(dict(doc))
        docs.append(doc)
    return docs


async def built(flow, count=4, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    status = fields.pop("status", None)
    tournament, users, registrations = await flow.with_participants(count, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    if status == "live":
        await flow.start(tournament)
    return staff, tournament, users, registrations


def on_site_fields(**extra):
    start = (now_utc() + timedelta(hours=1)).replace(microsecond=0)
    return {"event_mode": "local", "schedule_mode": "fixed_by_staff", "result_entry_mode": None, "start_date": start.isoformat(), **extra}


@pytest.mark.asyncio
async def test_planning_shows_a_preview_and_applying_writes_time_and_station_at_once(flow):
    _staff, tournament, _users, _registrations = await built(flow, **on_site_fields())
    first, second = await stations(flow, tournament, "1", "2")

    planned = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")
    assert planned.status_code == 200, planned.text
    plan = planned.json()
    assert plan["mode"] == "stations" and len(plan["assignments"]) == 3 and plan["warnings"] == []
    assert all(not match.get("scheduled_at") and not match.get("station_id") for match in await flow.matches(tournament)), \
        "die Vorschau schreibt nichts"

    applied = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply", json={"fingerprint": plan["fingerprint"], "planned_at": plan["planned_at"]})
    assert applied.status_code == 200, applied.text
    assert applied.json()["written"] == 3
    matches = {match["match_key"]: match for match in await flow.matches(tournament)}
    first_round = [match for match in matches.values() if match["round"] == 1]
    final = next(match for match in matches.values() if match["round"] == 2)
    assert {match["station_id"] for match in first_round} == {first["id"], second["id"]}
    assert all(match["schedule_source"] == "planner" and match["status"] == "scheduled" for match in first_round)
    assert final["schedule_source"] == "planner" and final["schedule_forecast"] is True and final["status"] == "pending"
    assert final["scheduled_at"] > first_round[0]["scheduled_at"]

    check = await flow.get(f"/api/tournaments/{tournament['id']}/planning-check")
    assert check.status_code == 200
    assert [item for item in check.json()["errors"] if item["type"] == "station_overlap"] == []


@pytest.mark.asyncio
async def test_an_outdated_preview_is_refused_instead_of_applied(flow):
    _staff, tournament, _users, _registrations = await built(flow, **on_site_fields())
    await stations(flow, tournament, "1")
    stale = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply", json={"fingerprint": "veraltet", "planned_at": now_utc().isoformat()})
    assert stale.status_code == 409, stale.text
    assert "Planen" in stale.json()["detail"]


@pytest.mark.asyncio
async def test_a_time_set_by_hand_stays_through_apply(flow):
    _staff, tournament, _users, _registrations = await built(flow, **on_site_fields())
    station, _other = await stations(flow, tournament, "1", "2")
    match = sorted(await flow.matches(tournament), key=lambda row: (row["round"], row["match_key"]))[0]
    fixed = (now_utc() + timedelta(hours=2)).replace(microsecond=0)
    updated = await flow.put(f"/api/matches/{match['id']}", json={"scheduled_at": fixed.isoformat(), "station_id": station["id"]})
    assert updated.status_code == 200, updated.text

    planned = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")
    applied = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply", json={"fingerprint": planned.json()["fingerprint"], "planned_at": planned.json()["planned_at"]})
    assert applied.status_code == 200, applied.text
    kept = await flow.reload(match)
    assert kept["schedule_source"] == "manual" and kept["scheduled_at"] == fixed.isoformat() and kept["station_id"] == station["id"]


@pytest.mark.asyncio
async def test_an_online_tournament_gets_no_stations_and_no_station_warnings(flow):
    _staff, tournament, _users, _registrations = await built(flow, event_mode="online", schedule_mode="player_proposal",
                                                             start_date=now_utc().isoformat())
    await stations(flow, tournament, "1")

    planned = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")
    assert planned.status_code == 200, planned.text
    assert planned.json()["mode"] == "none" and planned.json()["assignments"] == []

    legacy = await flow.post(f"/api/stations/auto-assign?tournament_id={tournament['id']}&plan=true")
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["assigned"] == 0
    assert all(not match.get("station_id") for match in await flow.matches(tournament))

    check = await flow.get(f"/api/tournaments/{tournament['id']}/planning-check")
    assert check.status_code == 200
    assert [item for item in check.json()["warnings"] if item["type"] == "missing_station"] == []


@pytest.mark.asyncio
async def test_the_matchday_run_leaves_a_local_one_day_group_phase_alone(flow):
    _staff, tournament, _users, _registrations = await built(flow, format="groups", status="live", **on_site_fields())
    assert any(match.get("round") for match in await flow.matches(tournament))
    assert (await persist_all_matchday_schedules(flow.db)) == {"tournaments": 1, "written": 0}


@pytest.mark.asyncio
async def test_the_matchday_run_writes_vienna_time_for_an_online_league(flow):
    start = (now_utc() - timedelta(days=1)).replace(microsecond=0)
    _staff, tournament, _users, _registrations = await built(flow, format="league", status="live", event_mode="online",
                                                             schedule_mode="player_proposal", start_date=start.isoformat())
    assert (await persist_all_matchday_schedules(flow.db))["written"] > 0
    from zoneinfo import ZoneInfo
    for match in await flow.matches(tournament):
        if not match.get("scheduled_at"):
            continue
        from datetime import datetime
        local = datetime.fromisoformat(match["scheduled_at"]).astimezone(ZoneInfo("Europe/Vienna"))
        assert local.strftime("%a %H:%M") == "Sun 20:00", match["scheduled_at"]


def test_the_response_time_is_part_of_the_tournament():
    assert TournamentCreate(title="Liga", game_id="g").match_schedule_response_hours == 72
    assert TournamentCreate(title="Liga", game_id="g", match_schedule_response_hours=24).match_schedule_response_hours == 24
    assert TournamentCreate(title="Cup", game_id="g").match_break_minutes == 5


@pytest.mark.asyncio
async def test_the_response_time_of_the_tournament_sets_the_deadline_and_runs_out_to_the_staff(flow):
    start = (now_utc() - timedelta(days=1)).replace(microsecond=0)
    staff, tournament, users, registrations = await built(flow, count=2, format="league", status="live", event_mode="online",
                                                          schedule_mode="player_proposal", start_date=start.isoformat(),
                                                          match_schedule_response_hours=24)
    match = sorted(await flow.matches(tournament), key=lambda row: row["round"])[0]
    home = next(user for user, reg in zip(users, registrations) if reg["id"] == match["slots"][0]["registration_id"])
    flow.act_as(home)
    proposed = await flow.post(f"/api/matches/{match['id']}/schedule-proposals", json={"scheduled_at": (start + timedelta(days=2)).isoformat()})
    assert proposed.status_code == 200, proposed.text
    stored = await flow.reload(match)
    from datetime import datetime
    deadline = datetime.fromisoformat(stored["schedule_deadline_at"])
    assert timedelta(hours=23) < deadline - now_utc() <= timedelta(hours=24)

    # Die Frist läuft ab: der Lauf eskaliert an die Turnierleitung - einmal.
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"schedule_deadline_at": (now_utc() - timedelta(minutes=1)).isoformat()}})
    await persist_all_matchday_schedules(flow.db)
    escalated = await flow.reload(match)
    assert escalated["schedule_status"] == "escalated" and escalated.get("schedule_escalated_at")
    notes = await flow.db.notifications.find({"kind": "schedule_escalation"}, {"_id": 0}).to_list(20)
    assert {note["user_id"] for note in notes} == {staff["id"]}
    await persist_all_matchday_schedules(flow.db)
    assert len(await flow.db.notifications.find({"kind": "schedule_escalation"}, {"_id": 0}).to_list(20)) == len(notes)


# ---------------------------------------------------------------- Codex-Prüfung zu #1569

@pytest.mark.asyncio
async def test_applying_needs_the_fingerprint_of_a_preview(flow):
    _staff, tournament, _users, _registrations = await built(flow, **on_site_fields())
    await stations(flow, tournament, "1")
    blind = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply", json={})
    assert blind.status_code == 422, blind.text
    assert all(not match.get("scheduled_at") for match in await flow.matches(tournament))


@pytest.mark.asyncio
async def test_a_match_changed_by_hand_after_the_preview_is_not_overwritten(flow):
    from services.match_scheduler import apply_plan, plan_for_tournament

    _staff, tournament, _users, _registrations = await built(flow, **on_site_fields())
    station, _other = await stations(flow, tournament, "1", "2")
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    plan = await plan_for_tournament(flow.db, stored)
    assert len(plan["assignments"]) == 3

    # Nach der Vorschau setzt jemand ein Spiel von Hand.
    match = sorted(await flow.matches(tournament), key=lambda row: (row["round"], row["match_key"]))[0]
    fixed = (now_utc() + timedelta(hours=3)).replace(microsecond=0).isoformat()
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": fixed, "station_id": station["id"], "schedule_source": "manual"}})

    result = await apply_plan(flow.db, stored, plan)
    assert result["written"] == 2
    kept = await flow.reload(match)
    assert kept["schedule_source"] == "manual" and kept["scheduled_at"] == fixed


@pytest.mark.asyncio
async def test_the_old_auto_assign_only_previews(flow):
    _staff, tournament, _users, _registrations = await built(flow, **on_site_fields())
    await stations(flow, tournament, "1")
    legacy = await flow.post(f"/api/stations/auto-assign?tournament_id={tournament['id']}&plan=true")
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["planned"] is True and legacy.json()["assigned"] == 0 and len(legacy.json()["assignments"]) == 3
    assert all(not match.get("scheduled_at") and not match.get("station_id") for match in await flow.matches(tournament)), "nur Vorschau"


@pytest.mark.asyncio
async def test_a_team_member_playing_elsewhere_at_the_event_is_not_booked_twice(flow):
    _staff, tournament, users, registrations = await built(flow, **on_site_fields(event_id="ev-1"))
    await stations(flow, tournament, "1", "2")
    start = (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0}))["start_date"]
    shared = users[0]  # Spieler 1 steht auch im Team „Löwen“ des anderen Turniers
    await flow.db.tournaments.insert_one({"id": "t-team", "slug": "teamcup", "title": "Teamcup", "format": "single_elim", "status": "live",
                                          "event_mode": "local", "event_id": "ev-1", "team_mode": "team", "start_date": start, "created_at": now_utc().isoformat()})
    await flow.db.teams.insert_one({"id": "team-1", "name": "Löwen", "leader_id": "captain-1", "member_ids": ["captain-1", shared["id"]]})
    await flow.db.tournament_registrations.insert_one({"id": "reg-team-1", "tournament_id": "t-team", "team_id": "team-1", "user_id": "captain-1", "status": "approved"})
    await flow.db.tournament_registrations.insert_one({"id": "reg-team-2", "tournament_id": "t-team", "team_id": None, "user_id": "someone-else", "status": "approved"})
    await flow.db.matches_v2.insert_one({"id": "m-team", "tournament_id": "t-team", "match_key": "T1", "round": 1, "status": "scheduled", "match_type": "duel",
                                          "scheduled_at": start, "duration_minutes": 40, "station_id": "st-team",
                                          "slots": [{"slot": 1, "registration_id": "reg-team-1", "user_id": "captain-1"},
                                                    {"slot": 2, "registration_id": "reg-team-2", "user_id": "someone-else"}], "created_at": now_utc().isoformat()})

    planned = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")
    assert planned.status_code == 200, planned.text
    mine = next(match for match in await flow.matches(tournament)
                if any(slot.get("registration_id") == registrations[0]["id"] for slot in match["slots"]))
    item = next(item for item in planned.json()["assignments"] if item["match_id"] == mine["id"])
    from datetime import datetime
    assert datetime.fromisoformat(item["scheduled_at"]) >= datetime.fromisoformat(start) + timedelta(minutes=40 + 5)
    others = [item for item in planned.json()["assignments"] if item["match_id"] != mine["id"] and item["round"] == 1]
    assert all(datetime.fromisoformat(item["scheduled_at"]) == datetime.fromisoformat(start) for item in others)


# ---------------------------------------------------------------- Codex-Nachprüfung zu #1569

def begun_fields(**extra):
    start = (now_utc() - timedelta(hours=1)).replace(microsecond=0)
    return {"event_mode": "local", "schedule_mode": "fixed_by_staff", "result_entry_mode": None, "start_date": start.isoformat(), **extra}


@pytest.mark.asyncio
async def test_a_preview_of_a_started_tournament_can_still_be_applied_minutes_later(flow):
    from services.match_scheduler import plan_for_tournament

    _staff, tournament, _users, _registrations = await built(flow, **begun_fields())
    await stations(flow, tournament, "1", "2")
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    # Die Vorschau entstand vor zwei Minuten - Übernehmen rechnet mit genau diesem Anker, nicht mit „jetzt“.
    preview = await plan_for_tournament(flow.db, stored, now=now_utc() - timedelta(minutes=2))
    applied = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply",
                              json={"fingerprint": preview["fingerprint"], "planned_at": preview["planned_at"]})
    assert applied.status_code == 200, applied.text
    assert applied.json()["written"] == 3

    # Eine Vorschau, die älter als zehn Minuten ist, gilt nicht mehr.
    old = await plan_for_tournament(flow.db, stored, now=now_utc() - timedelta(minutes=11))
    stale = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply",
                            json={"fingerprint": old["fingerprint"], "planned_at": old["planned_at"]})
    assert stale.status_code == 409, stale.text
    assert "Planen" in stale.json()["detail"]


@pytest.mark.asyncio
async def test_a_match_started_between_preview_and_apply_stays_started(flow):
    from services.match_scheduler import apply_plan, plan_for_tournament

    _staff, tournament, _users, _registrations = await built(flow, **begun_fields())
    await stations(flow, tournament, "1", "2")
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    anchor = now_utc().replace(microsecond=0)
    await apply_plan(flow.db, stored, await plan_for_tournament(flow.db, stored, now=anchor))
    # Zehn Minuten später eine neue Vorschau: alle Zeiten rücken, jedes Spiel gilt als geändert.
    later = await plan_for_tournament(flow.db, stored, now=anchor + timedelta(minutes=10))
    assert all(item["changed"] for item in later["assignments"])

    # Dazwischen startet die Stations-Crew ein Spiel.
    first = sorted(await flow.matches(tournament), key=lambda row: (row["round"], row["match_key"]))[0]
    started_at = now_utc().isoformat()
    await flow.db.matches_v2.update_one({"id": first["id"]}, {"$set": {"status": "in_progress", "started_at": started_at}})

    result = await apply_plan(flow.db, stored, later)
    assert result["written"] == 2
    kept = await flow.reload(first)
    assert kept["status"] == "in_progress" and kept["started_at"] == started_at and kept["scheduled_at"] == first["scheduled_at"]


class _Counting:
    """Zählt Abfragen je Sammlung - damit der Lader nicht je Turnier am Event erneut liest."""

    def __init__(self, db, calls):
        self._db, self.calls = db, calls

    def __getattr__(self, name):
        return _CountingCollection(name, getattr(self._db, name), self.calls)


class _CountingCollection:
    def __init__(self, name, collection, calls):
        self._name, self._collection, self.calls = name, collection, calls

    def __getattr__(self, method):
        attr = getattr(self._collection, method)
        if method in {"find", "find_one", "distinct"}:
            def counted(*args, **kwargs):
                self.calls[(self._name, method)] = self.calls.get((self._name, method), 0) + 1
                return attr(*args, **kwargs)
            return counted
        return attr


@pytest.mark.asyncio
async def test_the_other_tournaments_of_the_event_are_loaded_together(flow):
    from services.match_scheduler import load_plan_inputs

    _staff, tournament, users, _registrations = await built(flow, **begun_fields(event_id="ev-2"))
    await stations(flow, tournament, "1")
    start = (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0}))["start_date"]
    for index in range(3):
        tid = f"t-other-{index}"
        await flow.db.tournaments.insert_one({"id": tid, "slug": tid, "title": f"Anderes {index}", "format": "single_elim", "status": "live",
                                              "event_mode": "local", "event_id": "ev-2", "start_date": start, "created_at": now_utc().isoformat()})
        await flow.db.teams.insert_one({"id": f"team-{index}", "name": f"Team {index}", "leader_id": f"cap-{index}", "member_ids": [f"cap-{index}", users[index]["id"]]})
        await flow.db.tournament_registrations.insert_one({"id": f"reg-o-{index}", "tournament_id": tid, "team_id": f"team-{index}", "user_id": f"cap-{index}", "status": "approved"})
        await flow.db.matches_v2.insert_one({"id": f"m-o-{index}", "tournament_id": tid, "match_key": "X", "round": 1, "status": "scheduled", "match_type": "duel",
                                              "scheduled_at": start, "slots": [{"slot": 1, "registration_id": f"reg-o-{index}", "user_id": f"cap-{index}"},
                                                                               {"slot": 2, "registration_id": None}], "created_at": now_utc().isoformat()})
    calls: dict = {}
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    inputs = await load_plan_inputs(_Counting(flow.db, calls), stored)
    assert len(inputs["busy_elsewhere"]) == 3
    assert {f"user:{users[index]['id']}" for index in range(3)} <= set().union(*(row["participants"] for row in inputs["busy_elsewhere"]))
    for collection in ("matches_v2", "tournament_registrations", "teams", "team_members"):
        assert calls.get((collection, "find"), 0) <= 2, (collection, calls)
    assert {row["state"] for row in inputs["busy_elsewhere"]} == {"planned"}, "geplant, nicht gestartet"


@pytest.mark.asyncio
async def test_foreign_matches_say_whether_they_run_are_called_or_only_planned(flow):
    """#1872: nur Laufendes und Aufgerufenes bindet den Spieler jetzt - auch ein gestartetes Spiel ohne geplante Zeit."""
    from services.match_scheduler import load_plan_inputs

    _staff, tournament, _users, _registrations = await built(flow, **begun_fields(event_id="ev-1872"))
    start = (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0}))["start_date"]
    await flow.db.tournaments.insert_one({"id": "t-sofort", "slug": "sofort", "title": "Sofort-Cup", "format": "single_elim", "status": "live",
                                          "event_mode": "local", "event_id": "ev-1872", "start_date": start, "created_at": now_utc().isoformat()})
    rows = {
        "m-planned": {"status": "scheduled", "scheduled_at": start},
        "m-called": {"status": "scheduled", "scheduled_at": start, "called_at": now_utc().isoformat(), "station_id": "st-x"},
        "m-running": {"status": "in_progress", "started_at": now_utc().isoformat()},
        "m-open": {"status": "pending"},
    }
    await flow.db.matches_v2.insert_many([
        {"id": match_id, "tournament_id": "t-sofort", "round": 1, "match_type": "duel", **fields,
         "slots": [{"slot": 1, "registration_id": None, "user_id": f"u-{match_id}"}, {"slot": 2, "registration_id": None}]}
        for match_id, fields in rows.items()
    ])
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    inputs = await load_plan_inputs(flow.db, stored)
    states = {row["match_id"]: row["state"] for row in inputs["busy_elsewhere"]}
    assert states == {"m-planned": "planned", "m-called": "called", "m-running": "running"}


@pytest.mark.asyncio
async def test_an_open_foreign_match_without_any_time_is_not_even_loaded(flow, monkeypatch):
    """#1872: Ein offenes fremdes Spiel ohne geplante Zeit, Start und Aufruf kommt gar nicht erst aus der Datenbank -
    sonst lösten große Events für jedes davon Teilnehmer, Teams und Phasen auf."""
    import services.match_scheduler as scheduler

    _staff, tournament, _users, _registrations = await built(flow, **begun_fields(event_id="ev-1872b"))
    start = (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0}))["start_date"]
    await flow.db.tournaments.insert_one({"id": "t-sofort-b", "slug": "sofort-b", "title": "Sofort-Cup", "format": "single_elim",
                                          "status": "live", "event_mode": "local", "event_id": "ev-1872b", "start_date": start,
                                          "created_at": now_utc().isoformat()})
    slots = [{"slot": 1, "registration_id": None, "user_id": "u-x"}, {"slot": 2, "registration_id": None}]
    await flow.db.matches_v2.insert_many([
        {"id": "m-open", "tournament_id": "t-sofort-b", "round": 1, "match_type": "duel", "status": "pending", "slots": slots},
        {"id": "m-empty", "tournament_id": "t-sofort-b", "round": 1, "match_type": "duel", "status": "pending", "slots": slots,
         "scheduled_at": None, "started_at": "", "called_at": None},
        {"id": "m-running", "tournament_id": "t-sofort-b", "round": 1, "match_type": "duel", "status": "in_progress", "slots": slots,
         "started_at": now_utc().isoformat()},
    ])
    loaded: list[str] = []
    resolve = scheduler.resolve_participant_keys

    async def spy(db, matches):
        loaded.extend(match["id"] for match in matches if match.get("tournament_id") == "t-sofort-b")
        return await resolve(db, matches)

    monkeypatch.setattr(scheduler, "resolve_participant_keys", spy)
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    await scheduler.load_plan_inputs(flow.db, stored)
    assert loaded == ["m-running"]


@pytest.mark.asyncio
async def test_station_moves_wait_for_a_running_tournament_action(flow):
    from services.mutation_lock import mutation_lock, tournament_write_resource

    # Wie in database.init_audit_indexes: nur mit dem eindeutigen Index sperrt die Sperre auch im Speicher.
    await flow.db.mutation_locks.create_index("resource", unique=True)
    _staff, tournament, _users, _registrations = await built(flow, **begun_fields())
    station, = await stations(flow, tournament, "1")
    match = sorted(await flow.matches(tournament), key=lambda row: (row["round"], row["match_key"]))[0]
    async with mutation_lock(flow.db, tournament_write_resource(tournament["id"])):
        blocked = await flow.post(f"/api/stations/{station['id']}/assign/{match['id']}")
    assert blocked.status_code == 409, blocked.text
    assert not (await flow.reload(match)).get("station_id")


# ---------------------------------------------------------------- Letzte Codex-Runde zu #1569: Stationen

@pytest.mark.asyncio
async def test_a_station_taken_in_the_meantime_is_not_given_away_twice(flow):
    """Zwei Zuweisungen sahen die Station beide „frei“: die zweite schreibt nicht gegen den alten Stand."""
    from routes.station_routes import _assign_match_to_station

    _staff, tournament, _users, _registrations = await built(flow, **begun_fields())
    station, = await stations(flow, tournament, "1")
    first, second = sorted(await flow.matches(tournament), key=lambda row: (row["round"], row["match_key"]))[:2]
    stale = dict(station)  # so sah die Station aus, bevor die andere Zuweisung durch war
    await flow.db.stations.update_one({"id": station["id"]}, {"$set": {"current_match_id": first["id"], "current_match_type": "matches_v2", "status": "reserved"}})

    with pytest.raises(HTTPException) as refused:
        await _assign_match_to_station(flow.db, stale, second, "matches_v2")
    assert refused.value.status_code == 409
    stored = await flow.db.stations.find_one({"id": station["id"]}, {"_id": 0})
    assert stored["current_match_id"] == first["id"] and stored["status"] == "reserved"
    assert not (await flow.reload(second)).get("station_id")


@pytest.mark.asyncio
async def test_releasing_a_station_that_meanwhile_holds_another_match_does_nothing(flow):
    from routes.station_routes import release_station

    _staff, tournament, _users, _registrations = await built(flow, **begun_fields())
    station, = await stations(flow, tournament, "1")
    first, second = sorted(await flow.matches(tournament), key=lambda row: (row["round"], row["match_key"]))[:2]
    await flow.db.stations.update_one({"id": station["id"]}, {"$set": {"current_match_id": second["id"], "current_match_type": "matches_v2", "status": "busy"}})

    assert await release_station(flow.db, station["id"], expected_match_id=first["id"]) is False
    stored = await flow.db.stations.find_one({"id": station["id"]}, {"_id": 0})
    assert stored["current_match_id"] == second["id"] and stored["status"] == "busy"

    assert await release_station(flow.db, station["id"], expected_match_id=second["id"]) is True
    stored = await flow.db.stations.find_one({"id": station["id"]}, {"_id": 0})
    assert stored["current_match_id"] is None and stored["status"] == "free"


@pytest.mark.asyncio
async def test_all_foreign_matches_of_a_big_event_are_loaded_not_just_the_first_thousands(flow):
    from services.match_scheduler import load_plan_inputs

    _staff, tournament, _users, _registrations = await built(flow, **begun_fields(event_id="ev-big"))
    start = (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0}))["start_date"]
    await flow.db.tournaments.insert_one({"id": "t-big", "slug": "big", "title": "Groß", "format": "single_elim", "status": "live",
                                          "event_mode": "local", "event_id": "ev-big", "start_date": start, "created_at": now_utc().isoformat()})
    count = 5_100
    await flow.db.matches_v2.insert_many([
        {"id": f"m-big-{index}", "tournament_id": "t-big", "round": 1, "status": "scheduled", "match_type": "duel", "scheduled_at": start,
         "slots": [{"slot": 1, "registration_id": None, "user_id": f"u-{index}"}, {"slot": 2, "registration_id": None}]}
        for index in range(count)
    ])
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    inputs = await load_plan_inputs(flow.db, stored)
    assert len(inputs["busy_elsewhere"]) == count


# ---------------------------------------------------------------- Neu planen nach einem Umbau der Phase (#1575)

@pytest.mark.asyncio
async def test_after_a_rebuild_the_on_site_phase_is_replanned_and_fixed_times_stay(flow):
    from services.match_scheduler import replan_after_heat_rebuild

    _staff, tournament, _users, _registrations = await built(flow, **begun_fields())
    station, _other = await stations(flow, tournament, "1", "2")
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    stage = await flow.db.tournament_stages.find_one({"tournament_id": tournament["id"]}, {"_id": 0})
    matches = sorted(await flow.matches(tournament), key=lambda row: (row["round"], row["match_key"]))
    fixed = (now_utc() + timedelta(hours=3)).replace(microsecond=0).isoformat()
    await flow.db.matches_v2.update_one({"id": matches[1]["id"]}, {"$set": {"scheduled_at": fixed, "station_id": station["id"], "schedule_source": "manual"}})

    result = await replan_after_heat_rebuild(flow.db, stored, stage)
    assert result["applies"] is True and result["written"] == 2
    for match in await flow.matches(tournament):
        if match["id"] == matches[1]["id"]:
            assert match["schedule_source"] == "manual" and match["scheduled_at"] == fixed
        else:
            assert match["schedule_source"] == "planner" and match["scheduled_at"] and match["station_id"]


@pytest.mark.asyncio
async def test_an_online_phase_is_not_replanned_after_a_rebuild(flow):
    from services.match_scheduler import replan_after_heat_rebuild

    _staff, tournament, _users, _registrations = await built(flow, event_mode="online", schedule_mode="player_proposal",
                                                             start_date=now_utc().isoformat())
    await stations(flow, tournament, "1")
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    stage = await flow.db.tournament_stages.find_one({"tournament_id": tournament["id"]}, {"_id": 0})
    assert await replan_after_heat_rebuild(flow.db, stored, stage) == {"applies": False, "written": 0, "warnings": []}
    assert all(not match.get("station_id") and not match.get("scheduled_at") for match in await flow.matches(tournament))


async def final_left_with_a_bye(flow, tournament):
    """Wie nach dem Austritt des Siegers aus Runde 1: sein Platz im Finale wird ein Freilos."""
    final = next(row for row in await flow.matches(tournament) if row["round"] == 2)
    slots = [dict(slot) for slot in final["slots"]]
    slots[0] = {**slots[0], "source": {"type": "bye"}, "registration_id": None, "user_id": None, "status": "bye"}
    await flow.db.matches_v2.update_one({"id": final["id"]}, {"$set": {"slots": slots}})
    return final


@pytest.mark.asyncio
async def test_a_planner_time_on_a_match_left_with_a_bye_is_released_on_apply(flow):
    """#1608: Nach einem Austritt hat ein späteres Spiel nur noch einen Spieler (Freilos). Der Planer plant es nicht mehr,
    und „Übernehmen“ löst seinen alten Termin samt Station, statt ihn als Überschneidung stehen zu lassen."""
    from services.match_scheduler import apply_plan, plan_for_tournament

    _staff, tournament, _users, _registrations = await built(flow, **on_site_fields())
    await stations(flow, tournament, "1", "2")
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    await apply_plan(flow.db, stored, await plan_for_tournament(flow.db, stored))
    planned = next(row for row in await flow.matches(tournament) if row["round"] == 2)
    assert planned["schedule_source"] == "planner" and planned["scheduled_at"] and planned["station_id"]

    final = await final_left_with_a_bye(flow, tournament)
    plan = await plan_for_tournament(flow.db, stored)
    assert [item["match_id"] for item in plan["releases"]] == [final["id"]]
    result = await apply_plan(flow.db, stored, plan)
    assert result["written"] >= 1
    released = await flow.reload(final)
    assert released["scheduled_at"] is None and released["station_id"] is None and released["schedule_source"] is None
    assert released["schedule_forecast"] is False
    # Nichts mehr zu lösen: der nächste Plan ist ruhig.
    assert (await plan_for_tournament(flow.db, stored))["releases"] == []


@pytest.mark.asyncio
async def test_a_release_does_not_touch_a_match_set_by_hand_after_the_preview(flow):
    from services.match_scheduler import apply_plan, plan_for_tournament

    _staff, tournament, _users, _registrations = await built(flow, **on_site_fields())
    station, _other = await stations(flow, tournament, "1", "2")
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    await apply_plan(flow.db, stored, await plan_for_tournament(flow.db, stored))
    final = await final_left_with_a_bye(flow, tournament)
    plan = await plan_for_tournament(flow.db, stored)
    assert plan["releases"]

    # Zwischen Vorschau und Übernehmen setzt die Leitung das Finale von Hand.
    fixed = (now_utc() + timedelta(hours=4)).replace(microsecond=0).isoformat()
    await flow.db.matches_v2.update_one({"id": final["id"]},
                                        {"$set": {"scheduled_at": fixed, "station_id": station["id"], "schedule_source": "manual"}})
    await apply_plan(flow.db, stored, plan)
    kept = await flow.reload(final)
    assert kept["schedule_source"] == "manual" and kept["scheduled_at"] == fixed and kept["station_id"] == station["id"]


@pytest.mark.asyncio
async def test_a_real_withdrawal_from_a_planned_final_releases_its_time_after_the_walkover(flow):
    """#1608 über den echten Weg (Codex): Das Finale ist mit beiden Siegern besetzt und vom Planer terminiert. Ein Finalist
    tritt aus, das Finale wird kampflos entschieden - und verliert dabei Termin und Station des Planers."""
    from services.match_scheduler import apply_plan, plan_for_tournament

    _staff, tournament, _users, _registrations = await built(flow, status="live", **on_site_fields())
    await stations(flow, tournament, "1", "2")
    for match in sorted(await flow.matches(tournament), key=lambda row: row["match_key"]):
        if match["round"] != 1:
            continue
        seated = [slot["registration_id"] for slot in match["slots"] if slot.get("registration_id")]
        response = await flow.post(f"/api/matches/{match['id']}/result", json={
            "results": [{"registration_id": reg, "rank": index + 1} for index, reg in enumerate(seated)]})
        assert response.status_code == 200, response.text
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    await apply_plan(flow.db, stored, await plan_for_tournament(flow.db, stored))
    final = next(row for row in await flow.matches(tournament) if row["round"] == 2)
    finalists = [slot["registration_id"] for slot in final["slots"] if slot.get("registration_id")]
    assert len(finalists) == 2
    assert final["schedule_source"] == "planner" and final["scheduled_at"] and final["station_id"]

    url = f"/api/tournaments/{tournament['id']}/registrations/{finalists[0]}/removal"
    preview = await flow.post(url, json={"kind": "withdrawn"})
    assert preview.status_code == 200, preview.text
    done = await flow.post(url, json={"kind": "withdrawn", "plan_id": preview.json()["plan"]["id"]})
    assert done.status_code == 200, done.text

    after = await flow.reload(final)
    assert after["status"] in {"completed", "cancelled"}
    assert (after.get("result_meta") or {}).get("source") == "auto_bye"
    assert after["scheduled_at"] is None and after["station_id"] is None and after["schedule_source"] is None
