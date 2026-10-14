"""Spielplaner: Reihenfolge und Stationen aus der Praxis (Fabian, 14.10.2026, Kart-Cup FFA 16 Doppel-K.-o.).

Der Matchplan zeigte eine Bahn „Station“ mit 13 Spielen, obwohl das Turnier keine Station hatte, und LE stand vor LC,
obwohl LE auf LC wartet - ohne Warnung. Die Zeiten stammten aus der alten Matchplanung (von Hand, „manual“), die
Station war inzwischen gelöscht. Der Planer behält feste Termine (richtig), prüfte sie ohne freie Station aber gar nicht
mehr und sagte nicht, dass die Spiele an einer Station hängen, die es nicht mehr gibt.

Dazu ein Wächter über die echten Generatoren: kein Spiel beginnt vor dem Ende aller Spiele, auf die es wartet
(Platz-Herkunft und - gemischt - alle Quellspiele der Auslosungs-Gruppe), plus Mindestpause.
"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402
from services.advancement_draw import prerequisite_ids  # noqa: E402

CUP_SCHEMA = """[WB]
# Runde 1
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
# Runde 2
E=[W:A:1,W:A:2,W:B:1,W:B:2]
F=[W:C:1,W:C:2,W:D:1,W:D:2]
# Runde 3
G=[W:E:1,W:E:2,W:F:1,W:F:2]

[LB]
# Runde 1
LA=[L:A:1,L:A:2,L:B:1,L:B:2]
LB=[L:C:1,L:C:2,L:D:1,L:D:2]
# Runde 2
LC=[W:LA:1,W:LA:2,L:E:1,L:E:2]
LD=[W:LB:1,W:LB:2,L:F:1,L:F:2]
# Runde 3
LE=[W:LC:1,W:LC:2,W:LD:1,W:LD:2]
# Runde 4
LF=[W:LE:1,W:LE:2,L:G:1,L:G:2]

[FINAL]
# Finale
FINAL=[W:G:1,W:G:2,W:LF:1,W:LF:2]"""
CUP = {"name": "Läufe", "stage_type": "ffa_custom_bracket", "match_type": "ffa",
       "settings": {"schema": CUP_SCHEMA, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2}}
# Der gespeicherte Plan aus der alten Matchplanung (Wiener Zeit am 31.10.2026, also UTC+1): Start, eigene Dauer,
# Station - LF ohne Station, G, LF und das Finale mit 30 statt 20 Minuten.
OLD_PLAN = {"A": ("15:30", None, True), "B": ("15:50", None, True), "C": ("16:10", None, True), "D": ("16:30", None, True),
            "E": ("16:50", None, True), "F": ("17:10", None, True), "LA": ("17:30", None, True), "LB": ("17:50", None, True),
            "G": ("18:10", 30, True), "LD": ("18:50", None, True), "LE": ("19:10", None, True), "LC": ("19:40", None, True),
            "LF": ("19:50", 30, False), "FINAL": ("20:20", 30, True)}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def vienna(clock: str) -> str:
    hour, minute = (int(part) for part in clock.split(":"))
    return datetime(2026, 10, 31, hour - 1, minute, tzinfo=timezone.utc).isoformat()


async def cup(flow, *, mixed=True, preview=False, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(
        16, format="ffa_custom_bracket", event_mode="local", schedule_mode="fixed_by_staff", result_entry_mode="staff_only",
        start_date=vienna("15:30"), match_duration_minutes=20, randomize_advancement_rounds=mixed, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview={'true' if preview else 'false'}", json=CUP)
    assert response.status_code == 200, response.text
    return tournament


async def by_key(flow, tournament) -> dict:
    return {match["match_key"]: match for match in await flow.matches(tournament) if not match.get("is_preview")}


async def fabians_case(flow):
    """Der Cup nach dem Check-in, alte Matchplanung auf „Station A“ gespeichert, danach die Station gelöscht."""
    tournament = await cup(flow)
    station = await flow.post("/api/stations", json={"name": "Station A", "device_type": "switch", "tournament_id": tournament["id"]})
    assert station.status_code == 200, station.text
    matches = await by_key(flow, tournament)
    for key, (clock, duration, on_station) in OLD_PLAN.items():
        response = await flow.patch(f"/api/matches/{matches[key]['id']}", json={
            "scheduled_at": vienna(clock), "station_id": station.json()["id"] if on_station else None, "duration_minutes": duration})
        assert response.status_code == 200, f"{key}: {response.text}"
    # Altdaten wie vor #1611 herstellen: das Station-Dokument direkt entfernen, die Spiele behalten ihre station_id (die
    # Route lehnt das Löschen ab, solange geplante Spiele daran hängen).
    await flow.db.stations.delete_one({"id": station.json()["id"]})
    return tournament, station.json(), await by_key(flow, tournament)


@pytest.mark.asyncio
async def test_without_a_station_the_planner_still_reports_fixed_times_before_their_predecessors(flow):
    tournament, _station, matches = await fabians_case(flow)
    plan = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    early = {item["match_id"]: item for item in plan["warnings"] if item["type"] == "too_early"}
    # LE wartet auf LC (und LD), steht aber um 19:10 - LC läuft erst ab 19:40. Das Finale wartet auf LF (bis 20:20).
    assert matches["LE"]["id"] in early, plan["warnings"]
    assert early[matches["LE"]["id"]]["other_match_id"] == matches["LC"]["id"]
    assert "LE ist fest um 19:10, aber LC ist erst um 20:00 vorbei." == early[matches["LE"]["id"]]["message"]
    assert matches["FINAL"]["id"] in early
    assert any(item["type"] == "no_stations" for item in plan["warnings"])


@pytest.mark.asyncio
async def test_matches_on_a_deleted_station_are_named_instead_of_shown_on_a_nameless_lane(flow):
    tournament, station, matches = await fabians_case(flow)
    plan = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    unknown = [item for item in plan["warnings"] if item["type"] == "unknown_station"]
    assert len(unknown) == 1 and unknown[0]["severity"] == "error"
    assert unknown[0]["station_id"] == station["id"]
    assert sorted(unknown[0]["match_ids"]) == sorted(matches[key]["id"] for key, value in OLD_PLAN.items() if value[2])
    assert "13 Spiele" in unknown[0]["message"] and "die es nicht mehr gibt" in unknown[0]["message"]
    # Was der Planer an Stationen kennt, steht in der Antwort - hier keine: Kopf und Zeitleiste sagen dasselbe.
    assert plan["stations"] == []


@pytest.mark.asyncio
async def test_the_stations_the_planner_knows_include_those_of_the_event(flow):
    event_id = new_id()
    tournament = await cup(flow, event_id=event_id)
    own = await flow.post("/api/stations", json={"name": "Switch 1", "device_type": "switch", "tournament_id": tournament["id"]})
    hall = {"id": new_id(), "name": "Bühne", "device_type": "switch", "event_id": event_id, "tournament_id": None, "status": "free",
            "current_match_id": None}
    await flow.db.stations.insert_one(dict(hall))
    plan = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    known = {item["id"]: item for item in plan["stations"]}
    assert set(known) == {own.json()["id"], hall["id"]}
    assert known[hall["id"]]["name"] == "Bühne" and known[hall["id"]]["usable"] is True and known[hall["id"]]["scope"] == "event"
    assert known[own.json()["id"]]["scope"] == "tournament"
    assert {item["station_id"] for item in plan["assignments"]} <= set(known)


@pytest.mark.asyncio
async def test_a_fixed_time_in_a_mixed_round_waits_for_every_match_of_the_round_before(flow):
    # Gemischt (#1548): E wartet auf A, B, C und D - erst wenn alle fertig sind, wird ausgelost.
    tournament = await cup(flow)
    await flow.post("/api/stations", json={"name": "Switch 1", "device_type": "switch", "tournament_id": tournament["id"]})
    await flow.post("/api/stations", json={"name": "Switch 2", "device_type": "switch", "tournament_id": tournament["id"]})
    matches = await by_key(flow, tournament)
    assert (matches["E"].get("settings") or {}).get("draw_group"), "der Generator markiert die gemischte Runde"
    first = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    planned = {item["match_id"]: item for item in first["assignments"]}
    a_end = datetime.fromisoformat(planned[matches["A"]["id"]]["scheduled_at"]) + timedelta(minutes=20)
    # E fest gleich nach A und B - aber C und D laufen da noch.
    response = await flow.patch(f"/api/matches/{matches['E']['id']}", json={"scheduled_at": (a_end + timedelta(minutes=5)).isoformat(), "station_id": None})
    assert response.status_code == 200, response.text
    plan = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    early = [item for item in plan["warnings"] if item["type"] == "too_early" and item["match_id"] == matches["E"]["id"]]
    assert early and early[0]["other_match_id"] in {matches["C"]["id"], matches["D"]["id"]}, plan["warnings"]


# ---------------------------------------------------------------- Wächter über die Generatoren

GENERATOR_CASES = [
    ("single_elim", 8, {}, None),
    ("single_elim", 13, {}, None),
    ("double_elim", 8, {}, None),
    ("double_elim", 24, {}, None),
    ("ffa_custom_bracket", 16, {}, None),
    ("ffa_custom_bracket", 40, {}, None),
    ("ffa_custom_bracket", 16, {"randomize_advancement_rounds": True}, CUP),
    ("ffa_custom_bracket", 16, {"randomize_advancement_rounds": False}, CUP),
    ("double_elim", 16, {"randomize_advancement_rounds": True}, None),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("fmt,count,fields,structure", GENERATOR_CASES)
async def test_no_planned_match_starts_before_everything_it_waits_for_has_ended(flow, fmt, count, fields, structure):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(
        count, format=fmt, event_mode="local", schedule_mode="fixed_by_staff", result_entry_mode="staff_only",
        start_date=vienna("15:30"), match_duration_minutes=20, match_break_minutes=5, **fields)
    if fmt == "ffa_custom_bracket" and structure is None:
        structure = {"name": "Läufe", "stage_type": "ffa_custom_bracket", "match_type": "ffa",
                     "settings": {"match_size": 4, "qualifiers_per_match": 2, "min_players": 2}}
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false", json=structure)
    assert response.status_code == 200, response.text
    for index in range(3):
        await flow.post("/api/stations", json={"name": f"Switch {index + 1}", "device_type": "switch", "tournament_id": tournament["id"]})
    plan = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    assert plan["mode"] == "stations", plan
    matches = [match for match in await flow.matches(tournament) if not match.get("is_preview")]
    by_id = {match["id"]: match for match in matches}
    by_stage_key = {(match.get("stage_id"), match.get("match_key")): match for match in matches}
    planned = {item["match_id"]: item for item in plan["assignments"]}
    start = {match_id: datetime.fromisoformat(item["scheduled_at"]) for match_id, item in planned.items()}
    end = {match_id: start[match_id] + timedelta(minutes=item["duration_minutes"]) for match_id, item in planned.items()}
    checked = 0
    for match_id in planned:
        match = by_id[match_id]
        waits = set(prerequisite_ids(match, [row for row in matches if row.get("stage_id") == match.get("stage_id")]))
        for slot in match.get("slots") or []:
            source = slot.get("source") or {}
            if source.get("type") == "rank" and source.get("match_key"):
                previous = by_stage_key.get((match.get("stage_id"), source["match_key"]))
                if previous:
                    waits.add(previous["id"])
        for previous_id in waits:
            if previous_id in end:
                checked += 1
                assert start[match_id] >= end[previous_id] + timedelta(minutes=5), (
                    f"{fmt} {count}: {match.get('match_key')} um {start[match_id]:%H:%M} vor dem Ende von "
                    f"{by_id[previous_id].get('match_key')} ({end[previous_id]:%H:%M})")
    assert checked > 0


# ---------------------------------------------------------------- Alle Termine von Hand lösen (Praxis 14.10.)

async def audit_rows(flow, tournament):
    return await flow.db.audit_logs.find({"action": "tournament.schedule.released", "target_id": tournament["id"]}, {"_id": 0}).to_list(10)


@pytest.mark.asyncio
async def test_releasing_all_manual_times_gives_every_unstarted_match_back_to_the_planner(flow):
    tournament, _station, matches = await fabians_case(flow)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/release", json={"scope": "all"})
    assert response.status_code == 200, response.text
    assert response.json()["released"] == 14
    for match in await flow.matches(tournament):
        assert match.get("scheduled_at") is None and match.get("station_id") is None and match.get("schedule_source") is None, match["match_key"]
    assert (await by_key(flow, tournament))["G"].get("duration_minutes") == 30, "die eigene Dauer bleibt"
    rows = await audit_rows(flow, tournament)
    assert len(rows) == 1 and rows[0]["data"]["released"] == 14 and rows[0]["data"]["scope"] == "all"
    await flow.post("/api/stations", json={"name": "Switch 1", "device_type": "switch", "tournament_id": tournament["id"]})
    plan = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    assert len(plan["assignments"]) == 14
    assert not [item for item in plan["warnings"] if item["type"] in {"too_early", "unknown_station"}]


@pytest.mark.asyncio
async def test_releasing_only_the_deleted_station_keeps_the_others(flow):
    tournament, _station, matches = await fabians_case(flow)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/release", json={"scope": "missing_stations"})
    assert response.status_code == 200, response.text
    assert response.json()["released"] == 13
    lf = (await by_key(flow, tournament))["LF"]
    assert lf["schedule_source"] == "manual" and lf["scheduled_at"], "LF hing an keiner Station und bleibt fest"


@pytest.mark.asyncio
async def test_a_station_of_another_tournament_counts_as_missing_like_in_the_planner(flow):
    # Codex zu #1607: Die Station gibt es noch - aber bei einem anderen Turnier/Event. Der Planer meldet sie als
    # unbekannt, also muss „nur gelöschte Stationen lösen“ sie auch lösen (eine Abfrage für beide).
    tournament = await cup(flow, event_id=new_id())
    other = {"id": new_id(), "name": "Fremd", "device_type": "switch", "event_id": new_id(), "tournament_id": new_id(),
             "status": "free", "current_match_id": None}
    await flow.db.stations.insert_one(dict(other))
    own = await flow.post("/api/stations", json={"name": "Switch 1", "device_type": "switch", "tournament_id": tournament["id"]})
    matches = await by_key(flow, tournament)
    for key, station_id in (("A", other["id"]), ("B", own.json()["id"])):
        await flow.db.matches_v2.update_one({"id": matches[key]["id"]}, {"$set": {
            "scheduled_at": vienna("15:30"), "station_id": station_id, "schedule_source": "manual"}})
    plan = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    unknown = [item for item in plan["warnings"] if item["type"] == "unknown_station"]
    assert [item["match_ids"] for item in unknown] == [[matches["A"]["id"]]]
    response = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/release", json={"scope": "missing_stations"})
    assert response.status_code == 200, response.text
    assert response.json()["match_ids"] == [matches["A"]["id"]]
    after = await by_key(flow, tournament)
    assert after["A"]["station_id"] is None and after["B"]["station_id"] == own.json()["id"]


@pytest.mark.asyncio
async def test_releasing_works_while_the_bracket_is_still_a_preview(flow):
    # Fabian live (14.10.): Baum noch Vorschau bis Check-in-Ende, alte Termine auf einer gelöschten Station. Vorschau-
    # Spiele haben nie begonnen - Lösen gilt auch für sie. Sonst trägt das Check-in-Ende die alten Termine samt
    # gelöschter Station in den fixen Baum mit (_collect_match_plan / _apply_match_plan).
    tournament = await cup(flow, preview=True)
    station = (await flow.post("/api/stations", json={"name": "Station A", "device_type": "switch", "tournament_id": tournament["id"]})).json()
    preview = {match["match_key"]: match for match in await flow.matches(tournament) if match.get("is_preview")}
    assert set(OLD_PLAN) <= set(preview)
    for key, (clock, duration, on_station) in OLD_PLAN.items():
        response = await flow.patch(f"/api/matches/{preview[key]['id']}", json={
            "scheduled_at": vienna(clock), "station_id": station["id"] if on_station else None, "duration_minutes": duration})
        assert response.status_code == 200, f"{key}: {response.text}"
    await flow.db.stations.delete_one({"id": station["id"]})  # Altdaten: Station weg, Spiele behalten die Kennung
    gone = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/release", json={"scope": "missing_stations"})
    assert gone.status_code == 200, gone.text
    assert gone.json()["released"] == 13
    rest = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/release", json={"scope": "all"})
    assert rest.json()["released"] == 1, "LF hing an keiner Station und war noch von Hand gesetzt"
    for match in await flow.matches(tournament):
        assert not match.get("station_id") and not match.get("scheduled_at"), match["match_key"]
        assert match.get("is_preview"), "der Baum bleibt Vorschau"


@pytest.mark.asyncio
async def test_a_started_match_keeps_its_time_and_station(flow):
    tournament, _station, matches = await fabians_case(flow)
    await flow.db.matches_v2.update_one({"id": matches["A"]["id"]}, {"$set": {"status": "in_progress", "started_at": vienna("15:31")}})
    response = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/release", json={"scope": "all"})
    assert response.json()["released"] == 13
    a = (await by_key(flow, tournament))["A"]
    assert a["scheduled_at"] and a["station_id"] and a["schedule_source"] == "manual"


@pytest.mark.asyncio
async def test_only_the_planning_team_may_release(flow):
    tournament, _station, _matches = await fabians_case(flow)
    flow.act_as(await flow.add_user())
    response = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/release", json={"scope": "all"})
    assert response.status_code == 403
