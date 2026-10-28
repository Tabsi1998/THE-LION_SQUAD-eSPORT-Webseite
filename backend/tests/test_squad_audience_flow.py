"""Wer bei einem Co-Team handelt und wer Nachrichten bekommt (docs/LIGA.md, Abschnitt 4; #1649).

Für Anmeldungen mit ``squad_id`` gilt in ``services.match_audience``:
- Verantwortliche (Termin, Melden, Bestätigen, Einspruch, Check-in) = Captain und Vertreter des Co-Teams; hat es
  keinen von beiden, die Leitung und Co-Leitung des Hauptteams (Fallback - niemand sperrt sich aus).
- Spieler (Spiel-Hinweise, Matchchat) = Kader des Co-Teams, die Verantwortlichen und die Leitung des Hauptteams -
  nicht die übrigen Mitglieder des Hauptteams.
Anmeldungen ohne ``squad_id`` bleiben genau wie heute - die Regressionstests stehen unten.
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
from services import match_audience  # noqa: E402
from services.match_reminder import _recipients_with_opponents  # noqa: E402
from services.station_runtime import notify_match_started  # noqa: E402
from services.tournament_reminders import _unchecked_registration_users  # noqa: E402
from squad_world import ids, league_world, make_team, squad_registration  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow, *, captain: bool = True) -> dict:
    """Löwen spielen mit „Rudel A“ (Captain Spieler1, Vertreter Spieler2), Falken mit „Horst“ ohne Rollen."""
    world = await league_world(flow)
    users = world["users"]
    if captain:
        await flow.db.team_squads.update_one(
            {"id": world["squad_a"]["id"]},
            {"$set": {"captain_id": users["Spieler1"]["id"], "vice_captain_id": users["Spieler2"]["id"]}},
        )
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"status": "live"}})
    lions_reg = await squad_registration(flow, world["tournament"], world["lions"], world["squad_a"])
    falcons_reg = await squad_registration(flow, world["tournament"], world["falcons"], world["horst"])
    match = {
        "id": new_id(),
        "tournament_id": world["tournament"]["id"],
        "stage_id": new_id(),
        "match_key": "L1",
        "match_type": "duel",
        "status": "scheduled",
        "scheduled_at": (now_utc() + timedelta(minutes=10)).isoformat(),
        "slots": [
            {"slot": 1, "position": 1, "status": "filled", "registration_id": lions_reg["id"]},
            {"slot": 2, "position": 2, "status": "filled", "registration_id": falcons_reg["id"]},
        ],
    }
    await flow.db.matches_v2.insert_one(dict(match))
    return {**world, "match": match, "lions_reg": lions_reg, "falcons_reg": falcons_reg}


def result_body(world: dict) -> dict:
    return {
        "results": [
            {"registration_id": world["lions_reg"]["id"], "rank": 1, "score": 2},
            {"registration_id": world["falcons_reg"]["id"], "rank": 2, "score": 1},
        ]
    }


SQUAD_A = ("Spieler1", "Spieler2", "Spieler3", "Spieler4")
HORST = ("Falke1", "Falke2", "Falke3", "Falke4")


@pytest.mark.asyncio
async def test_the_rule_names_captain_vice_and_the_fallback(flow):
    world = await setup(flow)
    users = world["users"]
    regs = [world["lions_reg"], world["falcons_reg"]]

    responsible = await match_audience.responsible_user_ids(flow.db, regs)
    players = await match_audience.player_user_ids(flow.db, regs)

    assert responsible == ids(users, "Spieler1", "Spieler2", "FalkenLeitung"), "Horst ohne Rollen: Hauptteam-Leitung"
    assert players == ids(users, *SQUAD_A, "Leitung", "CoLeitung", *HORST, "FalkenLeitung")
    assert not players & ids(users, "Spieler5", "Spieler6", "Fremd"), "übrige Mitglieder des Hauptteams nicht"
    acting = {name: await match_audience.acting_registration(flow.db, regs, users[name]["id"]) for name in users}
    assert acting["Spieler1"]["id"] == world["lions_reg"]["id"]
    assert acting["Spieler2"]["id"] == world["lions_reg"]["id"]
    assert acting["FalkenLeitung"]["id"] == world["falcons_reg"]["id"]
    for name in ("Leitung", "CoLeitung", "Spieler3", "Spieler5", "Falke1", "Fremd"):
        assert acting[name] is None, name
    assert await match_audience.acting_registration_ids(flow.db, regs, users["Spieler2"]["id"]) == {
        world["lions_reg"]["id"]
    }


@pytest.mark.asyncio
async def test_captain_and_vice_report_confirm_and_dispute_members_and_leaders_do_not(flow):
    world = await setup(flow)
    users = world["users"]
    match_id = world["match"]["id"]
    body = result_body(world)

    for name in ("Spieler3", "Leitung", "CoLeitung", "Spieler5", "Falke1"):
        flow.act_as(users[name])
        refused = await flow.post(f"/api/matches/{match_id}/report", json=body)
        assert refused.status_code == 403, (name, refused.text)
        refused_dispute = await flow.post(f"/api/matches/{match_id}/dispute", json={"reason": "Lag"})
        assert refused_dispute.status_code == 403, name
        page = (await flow.get(f"/api/matches/{match_id}/page")).json()
        assert page["can_player_report_result"] is False, name

    flow.act_as(users["Spieler2"])
    page = (await flow.get(f"/api/matches/{match_id}/page")).json()
    assert page["can_player_report_result"] is True and page["acting_registration_id"] == world["lions_reg"]["id"]
    reported = await flow.post(f"/api/matches/{match_id}/report", json=body)
    assert reported.status_code == 200, reported.text

    flow.act_as(users["FalkenLeitung"])
    confirmed = await flow.post(f"/api/matches/{match_id}/report", json=body)
    assert confirmed.status_code == 200, confirmed.text
    assert (await flow.reload(world["match"]))["status"] == "completed"

    flow.act_as(users["Spieler1"])
    disputed = await flow.post(f"/api/matches/{match_id}/dispute", json={"reason": "Falsche Map gezählt"})
    assert disputed.status_code == 200, disputed.text


@pytest.mark.asyncio
async def test_without_captain_and_vice_the_team_leadership_acts(flow):
    world = await setup(flow, captain=False)
    users = world["users"]
    match_id = world["match"]["id"]

    flow.act_as(users["Spieler1"])
    refused = await flow.post(f"/api/matches/{match_id}/report", json=result_body(world))
    assert refused.status_code == 403
    flow.act_as(users["CoLeitung"])
    reported = await flow.post(f"/api/matches/{match_id}/report", json=result_body(world))
    assert reported.status_code == 200, reported.text

    # Bekommt das Co-Team einen Captain, ist die Leitung raus - sofort, ohne neue Anmeldung.
    await flow.db.team_squads.update_one(
        {"id": world["squad_a"]["id"]}, {"$set": {"captain_id": users["Spieler4"]["id"]}}
    )
    regs = [world["lions_reg"], world["falcons_reg"]]
    assert await match_audience.acting_registration(flow.db, regs, users["CoLeitung"]["id"]) is None
    captain_reg = await match_audience.acting_registration(flow.db, regs, users["Spieler4"]["id"])
    assert captain_reg["id"] == world["lions_reg"]["id"]


@pytest.mark.asyncio
async def test_schedule_proposals_follow_the_same_rule(flow):
    world = await setup(flow)
    users = world["users"]
    url = f"/api/matches/{world['match']['id']}/schedule-proposals"
    body = {"scheduled_at": (now_utc() + timedelta(days=2)).isoformat(), "note": "Sonntag?"}

    for name in ("Spieler3", "Leitung", "Falke2"):
        flow.act_as(users[name])
        refused = await flow.post(url, json=body)
        assert refused.status_code == 403, name
    flow.act_as(users["Spieler2"])
    proposed = await flow.post(url, json=body)
    assert proposed.status_code == 200, proposed.text
    assert proposed.json()["actor_registration_id"] == world["lions_reg"]["id"]
    flow.act_as(users["FalkenLeitung"])
    decided = await flow.post(f"{url}/{proposed.json()['id']}/decision", json={"action": "accept"})
    assert decided.status_code == 200, decided.text


@pytest.mark.asyncio
async def test_checkin_reminders_and_app_tasks_go_to_captain_and_vice(flow):
    world = await setup(flow)
    users = world["users"]
    tid = world["tournament"]["id"]

    reminded = {user["id"] for user in await _unchecked_registration_users(tid)}
    assert reminded == ids(users, "Spieler1", "Spieler2", "FalkenLeitung")

    await flow.db.tournaments.update_one(
        {"id": tid},
        {
            "$set": {
                "status": "check_in",
                "start_date": (now_utc() + timedelta(hours=2)).isoformat(),
                "check_in_from": (now_utc() - timedelta(minutes=10)).isoformat(),
                "check_in_until": (now_utc() + timedelta(minutes=50)).isoformat(),
            }
        },
    )
    tasks = {}
    for name in ("Spieler1", "Spieler3", "Leitung"):
        flow.act_as(users[name])
        data = (await flow.get("/api/mobile/dashboard")).json()
        tasks[name] = [
            action["type"] for action in data["me"]["actions"] if action["type"].startswith("tournament_checkin")
        ]
    assert tasks["Spieler1"] and not tasks["Spieler3"] and not tasks["Leitung"]

    flow.act_as(users["Leitung"])
    by_leader = await flow.post(f"/api/tournaments/{tid}/checkin")
    assert by_leader.status_code == 404, "die Leitung handelt nur ohne Captain"
    flow.act_as(users["Spieler3"])
    by_member = await flow.post(f"/api/tournaments/{tid}/checkin")
    assert by_member.status_code == 404
    flow.act_as(users["Spieler2"])
    checked = await flow.post(f"/api/tournaments/{tid}/checkin")
    assert checked.status_code == 200, checked.text
    assert (await flow.db.tournament_registrations.find_one({"id": world["lions_reg"]["id"]}))["status"] == "checked_in"


@pytest.mark.asyncio
async def test_match_notices_reach_the_squad_roster_not_the_whole_main_team(flow):
    world = await setup(flow)
    users = world["users"]
    expected = ids(users, *SQUAD_A, "Leitung", "CoLeitung", *HORST, "FalkenLeitung")

    await notify_match_started(flow.db, world["match"], {"id": "s1", "name": "Station 3"}, "matches_v2")
    started = {
        row["user_id"] for row in await flow.db.notifications.find({"kind": "match_station"}, {"_id": 0}).to_list(100)
    }
    assert started == expected
    pairs = await _recipients_with_opponents(flow.db, world["match"])
    assert {user["id"] for user, _ in pairs} == expected
    opponents = {user["id"]: opponent for user, opponent in pairs}
    assert opponents[users["Spieler3"]["id"]] == "Falken · Horst"
    assert opponents[users["Falke1"]["id"]] == "Loewen · Rudel A"


@pytest.mark.asyncio
async def test_my_matches_and_tournament_finished_follow_the_squad(flow):
    """Aufrufer mit eigener Projektion (Meine Matches, „Turnier beendet“) lesen ``squad_id`` mit."""
    from services.match_overview import own_match_overviews
    from services.registration_notifications import notify_tournament_finished

    world = await setup(flow)
    users = world["users"]
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"status": "in_progress"}})
    seen = {}
    for name in ("Spieler1", "Spieler3", "Spieler5", "Leitung"):
        matches, _regs = await own_match_overviews(flow.db, users[name])
        seen[name] = {match["id"]: match.get("report_task") for match in matches}
    assert seen["Spieler1"] == {world["match"]["id"]: "report"}
    assert world["match"]["id"] in seen["Spieler3"] and seen["Spieler3"][world["match"]["id"]] is None
    assert seen["Leitung"] == {world["match"]["id"]: None}, "die Leitung sieht das Spiel, handelt aber nicht"
    assert seen["Spieler5"] == {}, "nicht im Kader von Rudel A"

    await notify_tournament_finished(flow.db, world["tournament"])
    finished = {
        row["user_id"]
        for row in await flow.db.notifications.find({"kind": "tournament_finished"}, {"_id": 0}).to_list(50)
    }
    assert finished == ids(users, *SQUAD_A, "Leitung", "CoLeitung", *HORST, "FalkenLeitung")


@pytest.mark.asyncio
async def test_the_whole_squad_writes_in_the_match_chat(flow):
    world = await setup(flow)
    users = world["users"]
    url = f"/api/matches/{world['match']['id']}/chat"

    for name in ("Spieler3", "Spieler1", "Leitung", "Falke4"):
        flow.act_as(users[name])
        posted = await flow.post(url, json={"message": f"Hallo von {name}"})
        assert posted.status_code == 200, (name, posted.text)
    for name in ("Spieler5", "Fremd"):
        flow.act_as(users[name])
        refused = await flow.post(url, json={"message": "Darf ich?"})
        assert refused.status_code == 403, name


@pytest.mark.asyncio
async def test_team_day_does_not_apply_to_a_squad(flow):
    world = await setup(flow)
    flow.act_as(world["users"]["Leitung"])
    data = (await flow.get(f"/api/team-day/{world['tournament']['id']}")).json()
    assert data == {"applicable": False}
    refused = await flow.put(f"/api/team-day/{world['tournament']['id']}/lineup", json={"lineup": []})
    assert refused.status_code == 404


@pytest.mark.asyncio
async def test_a_player_in_two_squads_acts_only_where_they_hold_a_role(flow):
    """Annahme (im PR genannt): ein Spieler darf in zwei Co-Teams desselben Hauptteams stehen."""
    world = await setup(flow)
    users = world["users"]
    await flow.db.team_squads.update_one(
        {"id": world["squad_b"]["id"]}, {"$set": {"captain_id": users["Spieler3"]["id"]}}
    )
    staffel_b = await flow.create_tournament(
        team_mode="team", team_size=4, format="league", game_id="cod", status="live"
    )
    reg_b = await squad_registration(flow, staffel_b, world["lions"], world["squad_b"])

    assert (await match_audience.responsible_registration(flow.db, staffel_b["id"], users["Spieler3"]["id"]))[
        "id"
    ] == reg_b["id"]
    assert (
        await match_audience.responsible_registration(flow.db, world["tournament"]["id"], users["Spieler3"]["id"])
        is None
    )
    assert (await match_audience.responsible_registration(flow.db, world["tournament"]["id"], users["Spieler1"]["id"]))[
        "id"
    ] == world["lions_reg"]["id"]
    assert await match_audience.responsible_registration(flow.db, staffel_b["id"], users["Spieler1"]["id"]) is None
    assert await match_audience.responsible_registration(flow.db, staffel_b["id"], users["Leitung"]["id"]) is None


# ---------------------------------------------------------------- Regression: Anmeldungen ohne Co-Team wie heute


async def plain_world(flow, **tournament_fields) -> dict:
    names = ["Anmelder", "Leitung", "CoLeitung", "Mitglied", "Gegner", "GegnerMitglied"]
    users = {name: await flow.add_user(name=name) for name in names}
    tournament = await flow.create_tournament(status="live", event_mode="online", **tournament_fields)
    if tournament.get("team_mode") == "team":
        lions = await make_team(
            flow,
            "Loewen",
            leader=users["Leitung"],
            co_leaders=[users["CoLeitung"]],
            members=[users["Anmelder"], users["Mitglied"]],
        )
        rivals = await make_team(flow, "Rivalen", leader=users["Gegner"], members=[users["GegnerMitglied"]])
        regs = []
        for team, by in ((lions, users["Anmelder"]), (rivals, None)):
            reg = {
                "id": new_id(),
                "tournament_id": tournament["id"],
                "team_id": team["id"],
                "user_id": (by or {}).get("id"),
                "display_name": team["name"],
                "status": "approved",
                "registration_type": "team",
            }
            await flow.db.tournament_registrations.insert_one(dict(reg))
            regs.append(reg)
        # Ein Co-Team mit Captain am selben Hauptteam ändert an dieser Anmeldung nichts.
        await flow.db.team_squads.insert_one(
            {
                "id": new_id(),
                "team_id": lions["id"],
                "name": "Rudel",
                "member_ids": [users["Mitglied"]["id"]],
                "captain_id": users["Mitglied"]["id"],
            }
        )
    else:
        regs = [await flow.register(tournament, users["Anmelder"]), await flow.register(tournament, users["Gegner"])]
    match = {
        "id": new_id(),
        "tournament_id": tournament["id"],
        "stage_id": new_id(),
        "match_type": "duel",
        "status": "scheduled",
        "slots": [
            {"slot": 1, "status": "filled", "registration_id": regs[0]["id"]},
            {"slot": 2, "status": "filled", "registration_id": regs[1]["id"]},
        ],
    }
    await flow.db.matches_v2.insert_one(dict(match))
    return {"users": users, "tournament": tournament, "regs": regs, "match": match}


TEAM_FORMATS = [
    pytest.param({"team_mode": "team", "team_size": 2, "format": "single_elim"}, id="team-cup"),
    pytest.param({"team_mode": "team", "team_size": 2, "format": "groups"}, id="team-groups"),
    pytest.param(
        {"team_mode": "team", "team_size": 2, "format": "league", "round_robin_legs": 2}, id="team-league-two-legs"
    ),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("fields", TEAM_FORMATS)
async def test_team_registrations_without_squad_keep_todays_rule(flow, fields):
    world = await plain_world(flow, **fields)
    users, regs = world["users"], world["regs"]

    assert await match_audience.responsible_user_ids(flow.db, regs) == ids(
        users, "Anmelder", "Leitung", "CoLeitung", "Gegner"
    )
    assert await match_audience.player_user_ids(flow.db, regs) == ids(users, *users)
    assert (
        await match_audience.responsible_registration(flow.db, world["tournament"]["id"], users["CoLeitung"]["id"])
        == regs[0]
    )
    assert (
        await match_audience.responsible_registration(flow.db, world["tournament"]["id"], users["Gegner"]["id"])
        == regs[1]
    )
    assert (
        await match_audience.responsible_registration(flow.db, world["tournament"]["id"], users["Mitglied"]["id"])
        is None
    )

    report = {
        "results": [
            {"registration_id": regs[0]["id"], "rank": 1, "score": 1},
            {"registration_id": regs[1]["id"], "rank": 2, "score": 0},
        ]
    }
    flow.act_as(users["Mitglied"])
    refused = await flow.post(f"/api/matches/{world['match']['id']}/report", json=report)
    assert refused.status_code == 403
    chat = await flow.post(f"/api/matches/{world['match']['id']}/chat", json={"message": "Hallo"})
    assert chat.status_code == 403, "im Matchchat schreiben bei Teams ohne Co-Team weiter nur die Verantwortlichen"
    flow.act_as(users["Leitung"])
    reported = await flow.post(f"/api/matches/{world['match']['id']}/report", json=report)
    assert reported.status_code == 200, reported.text


@pytest.mark.asyncio
async def test_team_registration_with_lineup_keeps_todays_rule(flow):
    world = await plain_world(flow, team_mode="team", team_size=2, format="single_elim")
    users, regs = world["users"], world["regs"]
    lineup = [users["Mitglied"]["id"], users["CoLeitung"]["id"]]
    regs[0]["lineup"] = lineup
    await flow.db.tournament_registrations.update_one({"id": regs[0]["id"]}, {"$set": {"lineup": lineup}})

    assert await match_audience.playing_user_ids(flow.db, regs) == ids(
        users, "Mitglied", "CoLeitung", "Gegner", "GegnerMitglied"
    )
    assert await match_audience.player_user_ids(flow.db, regs) == ids(users, *users)
    assert await match_audience.responsible_user_ids(flow.db, regs) == ids(
        users, "Anmelder", "Leitung", "CoLeitung", "Gegner"
    )


@pytest.mark.asyncio
async def test_solo_registrations_keep_todays_rule(flow):
    world = await plain_world(flow, team_mode="solo", format="single_elim")
    users, regs = world["users"], world["regs"]

    assert await match_audience.responsible_user_ids(flow.db, regs) == ids(users, "Anmelder", "Gegner")
    assert await match_audience.player_user_ids(flow.db, regs) == ids(users, "Anmelder", "Gegner")
    assert (await match_audience.acting_registration(flow.db, regs, users["Gegner"]["id"]))["id"] == regs[1]["id"]
    assert (
        await match_audience.responsible_registration(flow.db, world["tournament"]["id"], users["Leitung"]["id"])
        is None
    )
