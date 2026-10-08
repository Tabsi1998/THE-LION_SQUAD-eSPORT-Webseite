"""Team-Turniere: wer welche Nachricht bekommt und was tun darf (#1136) - eine Regel an einer Stelle.

Spiel-Hinweise (Aufruf, „Match startet jetzt“, Erinnerung, „Ergebnis bestätigt“) bekommen alle Spieler: bei Teams
jedes Mitglied. Aufgaben (einchecken, Ergebnis melden, Dispute) erledigen die Verantwortlichen: wer angemeldet hat,
Teamleitung und Co-Leitung. Ein Team, das die Turnierleitung ohne Person angemeldet hat, läuft über die Teamleitung.
Steht eine Aufstellung (Team am Spieltag, #1192), treten nur die Aufgestellten an - Aufruf, Start, Erinnerung und
Ergebnis gehen dann nur an sie.
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
from services import match_audience, team_lineup  # noqa: E402
from services.match_notifications import notify_match_result_confirmed  # noqa: E402
from services.match_reminder import _recipients_with_opponents  # noqa: E402
from services.station_runtime import notify_match_started  # noqa: E402
from services.tournament_reminders import _unchecked_registration_users  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def team(flow, name: str, *, leader: dict, co_leaders: list[dict] = (), members: list[dict] = ()) -> dict:
    people = [leader, *co_leaders, *members]
    doc = {
        "id": new_id(), "name": name, "tag": name[:3].upper(), "leader_id": leader["id"],
        "co_leader_ids": [user["id"] for user in co_leaders], "member_ids": [user["id"] for user in people],
    }
    await flow.db.teams.insert_one(dict(doc))
    for user in people:
        role = "leader" if user is leader else "co_leader" if user in co_leaders else "member"
        await flow.db.team_members.insert_one({"team_id": doc["id"], "user_id": user["id"], "role": role})
    return doc


async def team_registration(flow, tournament: dict, team_doc: dict, *, by: dict | None) -> dict:
    registration = {
        "id": new_id(), "tournament_id": tournament["id"], "team_id": team_doc["id"], "user_id": (by or {}).get("id"),
        "display_name": f"[{team_doc['tag']}] {team_doc['name']}", "status": "approved", "registration_type": "team",
    }
    await flow.db.tournament_registrations.insert_one(dict(registration))
    return registration


async def setup(flow):
    """Zwei Teams im selben Spiel: Löwen (angemeldet von einem Mitglied, mit Leitung und Co-Leitung) und Falken
    (von der Turnierleitung ohne Person angemeldet)."""
    names = ["Anmelder", "Leitung", "CoLeitung", "Mitglied", "FalkenLeitung", "FalkenMitglied", "Fremd"]
    users = {name: await flow.add_user(name=name) for name in names}
    tournament = await flow.create_tournament(team_mode="team", status="live", event_mode="online")
    lions = await team(flow, "Loewen", leader=users["Leitung"], co_leaders=[users["CoLeitung"]],
                       members=[users["Anmelder"], users["Mitglied"]])
    falcons = await team(flow, "Falken", leader=users["FalkenLeitung"], members=[users["FalkenMitglied"]])
    lions_reg = await team_registration(flow, tournament, lions, by=users["Anmelder"])
    falcons_reg = await team_registration(flow, tournament, falcons, by=None)
    match = {
        "id": new_id(), "tournament_id": tournament["id"], "stage_id": new_id(), "match_key": "A", "match_type": "duel",
        "status": "scheduled", "scheduled_at": (now_utc() + timedelta(minutes=10)).isoformat(),
        "slots": [
            {"slot": 1, "position": 1, "status": "filled", "registration_id": lions_reg["id"]},
            {"slot": 2, "position": 2, "status": "filled", "registration_id": falcons_reg["id"]},
        ],
    }
    await flow.db.matches_v2.insert_one(dict(match))
    return users, tournament, match, lions_reg, falcons_reg


def ids(users: dict, *names: str) -> set[str]:
    return {users[name]["id"] for name in names}


async def recipients(flow, kind: str) -> set[str]:
    return {row["user_id"] for row in await flow.db.notifications.find({"kind": kind}, {"_id": 0}).to_list(100)}


ALL_PLAYERS = ("Anmelder", "Leitung", "CoLeitung", "Mitglied", "FalkenLeitung", "FalkenMitglied")
RESPONSIBLE = ("Anmelder", "Leitung", "CoLeitung", "FalkenLeitung")


@pytest.mark.asyncio
async def test_the_rule_names_players_and_responsible_people(flow):
    users, _tournament, _match, lions_reg, falcons_reg = await setup(flow)
    regs = [lions_reg, falcons_reg]

    players = await match_audience.player_user_ids(flow.db, regs)
    responsible = await match_audience.responsible_user_ids(flow.db, regs)
    assert players == ids(users, *ALL_PLAYERS)
    assert responsible == ids(users, *RESPONSIBLE), "ein Team ohne anmeldende Person läuft über seine Teamleitung"
    acting = {name: await match_audience.acting_registration(flow.db, regs, users[name]["id"]) for name in users}
    for name in ("Anmelder", "Leitung", "CoLeitung"):
        assert acting[name]["id"] == lions_reg["id"]
    assert acting["FalkenLeitung"]["id"] == falcons_reg["id"]
    for name in ("Mitglied", "FalkenMitglied", "Fremd"):
        assert acting[name] is None


@pytest.mark.asyncio
async def test_match_start_reminder_and_result_reach_every_team_member(flow):
    users, _tournament, match, _lions_reg, _falcons_reg = await setup(flow)

    await notify_match_started(flow.db, match, {"id": "s1", "name": "Station 3"}, "matches_v2")
    started = await recipients(flow, "match_station")
    assert started == ids(users, *ALL_PLAYERS), "„Match startet jetzt“ auch für das Team, das die Turnierleitung ohne Person angemeldet hat"

    pairs = await _recipients_with_opponents(flow.db, match)
    assert {user["id"] for user, _ in pairs} == ids(users, *ALL_PLAYERS)
    opponents = {user["id"]: opponent for user, opponent in pairs}
    assert opponents[users["Mitglied"]["id"]] == "[FAL] Falken", "der Gegner ist das andere Team, nie die eigenen Mitspieler"
    assert opponents[users["FalkenMitglied"]["id"]] == "[LOE] Loewen"

    decided = {**match, "status": "completed", "results": [
        {"registration_id": match["slots"][0]["registration_id"], "rank": 1, "score": 2, "outcome": "winner"},
        {"registration_id": match["slots"][1]["registration_id"], "rank": 2, "score": 0},
    ], "updated_at": now_utc().isoformat()}
    await notify_match_result_confirmed(flow.db, decided)
    confirmed = await recipients(flow, "match_result")
    assert confirmed == ids(users, *ALL_PLAYERS)
    assert users["Fremd"]["id"] not in confirmed


@pytest.mark.asyncio
async def test_a_lineup_narrows_start_reminder_and_result_to_the_players_on_the_field(flow):
    users, _tournament, match, lions_reg, falcons_reg = await setup(flow)
    lineup = [users["Mitglied"]["id"], users["CoLeitung"]["id"]]
    await flow.db.tournament_registrations.update_one({"id": lions_reg["id"]}, {"$set": {"lineup": lineup}})
    regs = [{**lions_reg, "lineup": lineup}, falcons_reg]
    playing = ids(users, "Mitglied", "CoLeitung", "FalkenLeitung", "FalkenMitglied")

    assert await match_audience.playing_user_ids(flow.db, regs) == playing
    assert await team_lineup.registration_recipients(flow.db, regs) == playing, "eine Regel - auch unter dem alten Namen"
    assert await match_audience.player_user_ids(flow.db, regs) == ids(users, *ALL_PLAYERS), "Matchchat und Dispute: das ganze Team"
    assert await match_audience.responsible_user_ids(flow.db, regs) == ids(users, *RESPONSIBLE), "Aufgaben bleiben bei der Leitung"

    await notify_match_started(flow.db, match, {"id": "s1", "name": "Station 3"}, "matches_v2")
    assert await recipients(flow, "match_station") == playing
    pairs = await _recipients_with_opponents(flow.db, match)
    assert {user["id"] for user, _ in pairs} == playing
    decided = {**match, "status": "completed", "results": [
        {"registration_id": lions_reg["id"], "rank": 1, "score": 2, "outcome": "winner"},
        {"registration_id": falcons_reg["id"], "rank": 2, "score": 0},
    ], "updated_at": now_utc().isoformat()}
    await notify_match_result_confirmed(flow.db, decided)
    assert await recipients(flow, "match_result") == playing


@pytest.mark.asyncio
async def test_checkin_reminders_and_the_dashboard_task_go_to_responsible_people_only(flow):
    users, tournament, _match, _lions_reg, _falcons_reg = await setup(flow)

    reminded = {user["id"] for user in await _unchecked_registration_users(tournament["id"])}
    assert reminded == ids(users, *RESPONSIBLE)

    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {
        "status": "check_in", "start_date": (now_utc() + timedelta(hours=2)).isoformat(),
        "check_in_from": (now_utc() - timedelta(minutes=10)).isoformat(),
        "check_in_until": (now_utc() + timedelta(minutes=50)).isoformat(),
    }})
    seen = {}
    for name in ("Anmelder", "Leitung", "Mitglied", "FalkenLeitung", "FalkenMitglied"):
        flow.act_as(users[name])
        data = (await flow.get("/api/mobile/dashboard")).json()
        assert [row["id"] for row in data["me"]["tournaments"]] == [tournament["id"]], "jedes Mitglied sieht das Turnier"
        seen[name] = [action["type"] for action in data["me"]["actions"] if action["type"].startswith("tournament_checkin")]
    assert seen["Anmelder"] and seen["Leitung"] and seen["FalkenLeitung"]
    assert seen["Mitglied"] == [] and seen["FalkenMitglied"] == [], "„Turnier Check-in offen“ nur für die, die einchecken dürfen"


@pytest.mark.asyncio
async def test_reporting_disputing_and_checkin_follow_the_same_rule(flow):
    users, tournament, match, lions_reg, falcons_reg = await setup(flow)
    body = {"results": [
        {"registration_id": lions_reg["id"], "rank": 1, "score": 2},
        {"registration_id": falcons_reg["id"], "rank": 2, "score": 0},
    ]}

    flow.act_as(users["Mitglied"])
    refused_report = await flow.post(f"/api/matches/{match['id']}/report", json=body)
    assert refused_report.status_code == 403
    refused_dispute = await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "Lag"})
    assert refused_dispute.status_code == 403
    page = (await flow.get(f"/api/matches/{match['id']}/page")).json()
    assert page["can_player_report_result"] is False

    flow.act_as(users["Leitung"])
    page = (await flow.get(f"/api/matches/{match['id']}/page")).json()
    assert page["can_player_report_result"] is True, "die Teamleitung meldet - nicht nur, wer angemeldet hat"
    reported = await flow.post(f"/api/matches/{match['id']}/report", json=body)
    assert reported.status_code == 200, reported.text

    flow.act_as(users["FalkenLeitung"])
    confirmed = await flow.post(f"/api/matches/{match['id']}/report", json=body)
    assert confirmed.status_code == 200, confirmed.text
    decided = await flow.reload(match)
    assert decided["status"] == "completed", "zwei gleiche Meldungen der Verantwortlichen entscheiden"

    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "check_in"}})
    await flow.db.tournament_registrations.update_one({"id": falcons_reg["id"]}, {"$set": {"status": "approved"}})
    flow.act_as(users["FalkenMitglied"])
    member_checkin = await flow.post(f"/api/tournaments/{tournament['id']}/checkin")
    assert member_checkin.status_code == 404
    flow.act_as(users["FalkenLeitung"])
    checked = await flow.post(f"/api/tournaments/{tournament['id']}/checkin")
    assert checked.status_code == 200, checked.text
    stored = await flow.db.tournament_registrations.find_one({"id": falcons_reg["id"]})
    assert stored["status"] == "checked_in"
