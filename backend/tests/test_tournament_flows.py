"""The tournament flows that need two people and stored data.

These are the ones nobody was checking. The operator cannot play both sides of a
result report in the live system, and the unit tests replace the database with
hand-written fakes. Here the routes and the database semantics are real; only
the storage engine is in memory.

Each test is written as a sequence of actual requests, in the order a member or
a tournament host would make them.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def ranking(winner: str, loser: str) -> list[dict]:
    return [
        {"registration_id": winner, "rank": 1, "score": 2},
        {"registration_id": loser, "rank": 2, "score": 0},
    ]


async def bracket_of(flow, count=4, **fields):
    """A staffed tournament with a generated bracket, ready to be played."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(count, **fields)
    response = await flow.post(
        f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    return staff, tournament, users, registrations


def user_for(users, registrations, registration_id):
    index = next(i for i, r in enumerate(registrations) if r["id"] == registration_id)
    return users[index]


# ---------------------------------------------------------------- Aufbau

@pytest.mark.asyncio
async def test_the_harness_runs_the_real_application(flow):
    """Wenn das hier faellt, testet alles Folgende nichts."""
    _staff, tournament, _users, _regs = await bracket_of(flow, 4)

    matches = await flow.matches(tournament)

    assert len(matches) == 3
    assert all(match["tournament_id"] == tournament["id"] for match in matches)


@pytest.mark.asyncio
async def test_an_anonymous_request_is_refused(flow):
    flow.act_as(None)

    response = await flow.post("/api/tournaments/irgendwas/bracket/from-format")

    assert response.status_code == 401


# ---------------------------------------------------------------- Beide melden

@pytest.mark.asyncio
async def test_two_matching_reports_decide_the_match_and_advance_the_winner(flow):
    """Der Ablauf, den ein Einzelner im Livesystem nicht durchspielen kann."""
    _staff, tournament, users, regs = await bracket_of(flow, 4)
    match = (await flow.matches(tournament))[0]
    first, second = [s["registration_id"] for s in match["slots"]]
    body = {"results": ranking(first, second)}

    flow.act_as(user_for(users, regs, first))
    one = await flow.post(f"/api/matches/{match['id']}/report", json=body)
    assert one.status_code == 200, one.text
    assert one.json()["awaiting_confirmation"] is True, "Eine Meldung entscheidet nichts"

    flow.act_as(user_for(users, regs, second))
    two = await flow.post(f"/api/matches/{match['id']}/report", json=body)
    assert two.status_code == 200, two.text

    decided = await flow.reload(match)
    assert decided["status"] == "completed"
    assert [r["registration_id"] for r in decided["results"] if r["rank"] == 1] == [first]

    follow_up = await flow.match_for(tournament, first, after_round=match["round"])
    assert follow_up is not None, "Der Sieger muss in der naechsten Runde stehen"


@pytest.mark.asyncio
async def test_conflicting_reports_wait_for_staff_instead_of_guessing(flow):
    _staff, tournament, users, regs = await bracket_of(flow, 4)
    match = (await flow.matches(tournament))[0]
    first, second = [s["registration_id"] for s in match["slots"]]

    flow.act_as(user_for(users, regs, first))
    await flow.post(f"/api/matches/{match['id']}/report", json={"results": ranking(first, second)})
    flow.act_as(user_for(users, regs, second))
    await flow.post(f"/api/matches/{match['id']}/report", json={"results": ranking(second, first)})

    undecided = await flow.reload(match)
    assert undecided["status"] != "completed"
    assert not undecided.get("results")


@pytest.mark.asyncio
async def test_the_same_report_twice_changes_nothing(flow):
    _staff, tournament, users, regs = await bracket_of(flow, 4)
    match = (await flow.matches(tournament))[0]
    first, second = [s["registration_id"] for s in match["slots"]]
    body = {"results": ranking(first, second)}

    flow.act_as(user_for(users, regs, first))
    await flow.post(f"/api/matches/{match['id']}/report", json=body)
    repeat = await flow.post(f"/api/matches/{match['id']}/report", json=body)

    assert repeat.json()["idempotent_replay"] is True
    stored = await flow.reload(match)
    assert len(stored.get("reports") or []) == 1


@pytest.mark.asyncio
async def test_a_stranger_cannot_report_someone_elses_match(flow):
    _staff, tournament, users, regs = await bracket_of(flow, 4)
    match = (await flow.matches(tournament))[0]
    first, second = [s["registration_id"] for s in match["slots"]]
    outsider = await flow.add_user(name="Unbeteiligt")
    flow.act_as(outsider)

    response = await flow.post(
        f"/api/matches/{match['id']}/report", json={"results": ranking(first, second)})

    assert response.status_code == 403


# ---------------------------------------------------------------- Einspruch

@pytest.mark.asyncio
async def test_a_participant_can_contest_a_result(flow):
    _staff, tournament, users, regs = await bracket_of(flow, 4)
    match = (await flow.matches(tournament))[0]
    first = flow.registration_of(match, 0)
    flow.act_as(user_for(users, regs, first))

    response = await flow.post(
        f"/api/matches/{match['id']}/dispute", json={"reason": "Gegner war nicht anwesend"})

    assert response.status_code == 200, response.text
    contested = await flow.reload(match)
    assert contested["status"] == "disputed"
    assert len(contested["disputes"]) == 1


@pytest.mark.asyncio
async def test_the_same_objection_twice_is_recorded_once(flow):
    _staff, tournament, users, regs = await bracket_of(flow, 4)
    match = (await flow.matches(tournament))[0]
    flow.act_as(user_for(users, regs, flow.registration_of(match, 0)))
    body = {"reason": "Falscher Punktstand"}

    await flow.post(f"/api/matches/{match['id']}/dispute", json=body)
    repeat = await flow.post(f"/api/matches/{match['id']}/dispute", json=body)

    assert repeat.json()["idempotent_replay"] is True
    assert len((await flow.reload(match))["disputes"]) == 1


# ---------------------------------------------------------------- Forfeit

@pytest.mark.asyncio
async def test_staff_can_award_a_walkover_and_the_winner_advances(flow):
    staff, tournament, _users, _regs = await bracket_of(flow, 4)
    match = (await flow.matches(tournament))[0]
    survivor = flow.registration_of(match, 0)
    flow.act_as(staff)

    response = await flow.post(
        f"/api/matches/{match['id']}/forfeit",
        json={"winner_id": survivor, "note": "Gegner nicht angetreten"})

    assert response.status_code == 200, response.text
    walkover = await flow.reload(match)
    assert walkover["status"] == "forfeit"
    assert [r["registration_id"] for r in walkover["results"] if r["rank"] == 1] == [survivor]
    assert await flow.match_for(tournament, survivor, after_round=match["round"]) is not None


@pytest.mark.asyncio
async def test_a_walkover_without_a_reason_is_refused(flow):
    """Ein Forfeit ist eine Sanktion - der Betroffene hat ein Recht auf Begruendung."""
    staff, tournament, _users, _regs = await bracket_of(flow, 4)
    match = (await flow.matches(tournament))[0]
    flow.act_as(staff)

    response = await flow.post(
        f"/api/matches/{match['id']}/forfeit",
        json={"winner_id": flow.registration_of(match, 0), "note": "x"})

    assert response.status_code == 422
    assert (await flow.reload(match))["status"] != "forfeit"


@pytest.mark.asyncio
async def test_a_participant_cannot_award_a_walkover_to_themselves(flow):
    _staff, tournament, users, regs = await bracket_of(flow, 4)
    match = (await flow.matches(tournament))[0]
    survivor = flow.registration_of(match, 0)
    flow.act_as(user_for(users, regs, survivor))

    response = await flow.post(
        f"/api/matches/{match['id']}/forfeit",
        json={"winner_id": survivor, "note": "Gegner nicht da"})

    assert response.status_code == 403


# ---------------------------------------------------------------- Schweizer System

@pytest.mark.asyncio
async def test_swiss_rounds_follow_each_other_and_rotate_the_bye(flow):
    """Fuenf Teilnehmer: pro Runde zwei Partien und ein Freilos, das wandert."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, regs = await flow.with_participants(5, format="swiss")
    await flow.start(tournament)

    first = await flow.post(f"/api/tournaments/{tournament['id']}/swiss/next-round")
    assert first.status_code == 200, first.text
    assert first.json()["round"] == 1
    round_one = await flow.matches(tournament)
    assert len(round_one) == 3

    byes = [m for m in round_one if m["status"] == "completed"]
    assert len(byes) == 1, "Genau einer setzt aus"
    first_bye = byes[0]["results"][0]["registration_id"]

    blocked = await flow.post(f"/api/tournaments/{tournament['id']}/swiss/next-round")
    assert blocked.status_code == 400, "Offene Partien halten die naechste Runde auf"

    for match in [m for m in round_one if m["status"] != "completed"]:
        winner, loser = [s["registration_id"] for s in match["slots"]]
        flow.act_as(staff)
        await flow.post(f"/api/matches/{match['id']}/result",
                        json={"results": ranking(winner, loser)})

    second = await flow.post(f"/api/tournaments/{tournament['id']}/swiss/next-round")
    assert second.status_code == 200, second.text
    assert second.json()["round"] == 2

    round_two = [m for m in await flow.matches(tournament) if m["round"] == 2]
    second_bye = [m for m in round_two if m["status"] == "completed"]
    assert len(second_bye) == 1
    assert second_bye[0]["results"][0]["registration_id"] != first_bye, \
        "Niemand setzt zweimal aus, solange ein anderer noch gar nicht ausgesetzt hat"


@pytest.mark.asyncio
async def test_swiss_needs_participants_before_a_round_exists(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(format="swiss")

    response = await flow.post(f"/api/tournaments/{tournament['id']}/swiss/next-round")

    assert response.status_code == 400
    assert "Teilnehmer" in response.text


# ---------------------------------------------------------------- Gruppen

@pytest.mark.asyncio
async def test_a_group_stage_splits_the_field_and_keeps_the_seeds_apart(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, regs = await flow.with_participants(8, format="groups")

    response = await flow.post(
        f"/api/tournaments/{tournament['id']}/groups/generate", json={"group_count": 2})

    assert response.status_code == 200, response.text
    assert response.json()["group_count"] == 2
    assert response.json()["match_count"] == 12

    groups = (await flow.get(f"/api/tournaments/{tournament['id']}/groups")).json()
    assert len(groups) == 2
    rosters = [set(group["participant_ids"]) for group in groups]
    assert sum(len(r) for r in rosters) == 8
    top_two = {regs[0]["id"], regs[1]["id"]}
    assert not any(top_two <= roster for roster in rosters), \
        "Setzplatz 1 und 2 gehoeren nicht in dieselbe Gruppe"


@pytest.mark.asyncio
async def test_the_group_table_is_kept_per_group(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(8, format="groups")
    await flow.post(f"/api/tournaments/{tournament['id']}/groups/generate",
                    json={"group_count": 2})

    standings = (await flow.get(f"/api/tournaments/{tournament['id']}/standings")).json()

    assert len(standings) == 2
    assert all("group" in entry and "standings" in entry for entry in standings)


# ---------------------------------------------------------------- Liga

@pytest.mark.asyncio
async def test_a_league_plays_everyone_twice(flow):
    _staff, tournament, _users, _regs = await bracket_of(flow, 4, format="league")

    matches = await flow.matches(tournament)

    assert len(matches) == 12
    assert max(match["round"] for match in matches) == 6


@pytest.mark.asyncio
async def test_a_drawn_league_match_gives_both_sides_a_point(flow):
    """Der Fehler, der hier einmal steckte: geteilter Rang 1 wurde als Sieg gezaehlt."""
    staff, tournament, _users, _regs = await bracket_of(flow, 4, format="league")
    match = (await flow.matches(tournament))[0]
    first, second = [s["registration_id"] for s in match["slots"]]
    flow.act_as(staff)

    await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
        {"registration_id": first, "rank": 1, "score": 2},
        {"registration_id": second, "rank": 1, "score": 2},
    ]})

    standings = (await flow.get(f"/api/tournaments/{tournament['id']}/standings")).json()
    rows = {row["registration_id"]: row for row in standings}
    assert rows[first]["points"] == 1
    assert rows[second]["points"] == 1
    assert rows[first]["drawn"] == 1


# ---------------------------------------------------------------- Format -> Struktur

@pytest.mark.asyncio
@pytest.mark.parametrize("tournament_format,expected_stage_type", [
    ("single_elim", "single_elimination"),
    ("double_elim", "double_elimination"),
    ("round_robin", "round_robin_groups"),
    ("groups", "round_robin_groups"),
    ("league", "league"),
    ("ffa", "simple"),
    ("battle_royale", "simple"),
])
async def test_the_format_alone_decides_the_structure(flow, tournament_format, expected_stage_type):
    """Ohne mitgeschickten Strukturtyp gilt die Zuordnung aus competition_formats.

    Das Bearbeiten-Formular verlaesst sich darauf: es schickt keinen eigenen
    Strukturtyp mehr mit, wenn die Turnierleitung keinen gewaehlt hat. Frueher
    schickte es fuer neun von zwoelf Formaten "single_elimination" - eine Liga
    wurde damit beim Anwenden zur Einzelausscheidung.
    """
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4, format=tournament_format)

    response = await flow.post(
        f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text

    stages = (await flow.get(f"/api/tournaments/{tournament['id']}/stages")).json()
    assert stages, "Es muss eine Phase entstanden sein"
    assert stages[0]["stage_type"] == expected_stage_type
