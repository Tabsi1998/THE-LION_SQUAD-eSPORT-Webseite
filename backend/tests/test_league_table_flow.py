"""Liga- und Gruppentabelle (#1562, #1179): Form, Differenz, Bewegung seit dem letzten Spieltag, eigene Zeile.

Alles über die echten Wege: Turnierleitung erzeugt Liga bzw. Gruppen, trägt Ergebnisse ein, Zuschauer und
Teilnehmer lesen die Tabelle. Die Spiele kommen aus dem Generator, nicht aus einer handgeschriebenen Liste.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def league_of(flow, count=4, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(count, format="league", **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    return staff, tournament, users, registrations


async def play_round(flow, staff, tournament, round_number, *, first_wins=True, scores=(3, 1)):
    """Alle Spiele eines Spieltags: je nach Wunsch gewinnt der erste oder der zweite Platz."""
    flow.act_as(staff)
    played = []
    for match in await flow.matches(tournament):
        if int(match.get("round") or 0) != round_number:
            continue
        first, second = [slot["registration_id"] for slot in match["slots"]]
        winner, loser = (first, second) if first_wins else (second, first)
        response = await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
            {"registration_id": winner, "rank": 1, "score": scores[0]},
            {"registration_id": loser, "rank": 2, "score": scores[1]},
        ]})
        assert response.status_code == 200, response.text
        played.append((winner, loser))
    assert played, f"Spieltag {round_number} hat keine Spiele"
    return played


async def table(flow, tournament):
    response = await flow.get(f"/api/tournaments/{tournament['id']}/standings")
    assert response.status_code == 200, response.text
    return {row["registration_id"]: row for row in response.json()}


@pytest.mark.asyncio
async def test_the_table_knows_the_difference_and_the_form_of_each_player(flow):
    staff, tournament, _users, _regs = await league_of(flow)
    first_round = await play_round(flow, staff, tournament, 1, first_wins=True, scores=(3, 1))
    second_round = await play_round(flow, staff, tournament, 2, first_wins=False, scores=(2, 0))
    flow.act_as(None)

    rows = await table(flow, tournament)

    for row in rows.values():
        assert row["score_diff"] == row["score_for"] - row["score_against"]
        assert len(row["form"]) == row["played"] == 2
    results = {}
    for winner, loser in [*first_round, *second_round]:
        results.setdefault(winner, []).append("W")
        results.setdefault(loser, []).append("L")
    # Ältestes zuerst, das jüngste Spiel steht rechts.
    for registration_id, form in results.items():
        assert rows[registration_id]["form"] == form


@pytest.mark.asyncio
async def test_the_form_keeps_only_the_last_five_games(flow):
    staff, tournament, _users, _regs = await league_of(flow)
    for round_number in range(1, 7):
        await play_round(flow, staff, tournament, round_number, first_wins=round_number % 2 == 1)

    rows = await table(flow, tournament)

    assert all(row["played"] == 6 for row in rows.values())
    assert all(len(row["form"]) == 5 for row in rows.values())


@pytest.mark.asyncio
async def test_a_draw_shows_up_as_a_draw_in_the_form(flow):
    staff, tournament, _users, _regs = await league_of(flow)
    match = next(m for m in await flow.matches(tournament) if int(m.get("round") or 0) == 1)
    first, second = [slot["registration_id"] for slot in match["slots"]]
    flow.act_as(staff)
    await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
        {"registration_id": first, "rank": 1, "score": 1},
        {"registration_id": second, "rank": 1, "score": 1},
    ]})

    rows = await table(flow, tournament)

    assert rows[first]["form"] == ["D"]
    assert rows[second]["form"] == ["D"]


@pytest.mark.asyncio
async def test_the_movement_compares_with_the_table_after_the_previous_matchday(flow):
    staff, tournament, _users, _regs = await league_of(flow)
    await play_round(flow, staff, tournament, 1, first_wins=True)

    after_first = await table(flow, tournament)
    # Nach dem ersten Spieltag gibt es noch nichts zu vergleichen - keine Pfeile.
    assert all(row["previous_rank"] is None for row in after_first.values())

    await play_round(flow, staff, tournament, 2, first_wins=False)
    after_second = await table(flow, tournament)

    for registration_id, row in after_second.items():
        assert row["previous_rank"] == after_first[registration_id]["rank"]


@pytest.mark.asyncio
async def test_a_reload_without_a_new_result_moves_nothing(flow):
    staff, tournament, _users, _regs = await league_of(flow)
    await play_round(flow, staff, tournament, 1)
    await play_round(flow, staff, tournament, 2, first_wins=False)

    assert await table(flow, tournament) == await table(flow, tournament)


@pytest.mark.asyncio
async def test_only_the_viewers_own_row_is_marked(flow):
    staff, tournament, users, registrations = await league_of(flow)
    await play_round(flow, staff, tournament, 1)

    flow.act_as(users[2])
    mine = await table(flow, tournament)
    flow.act_as(None)
    anonymous = await table(flow, tournament)

    assert [rid for rid, row in mine.items() if row.get("is_mine")] == [registrations[2]["id"]]
    assert not any(row.get("is_mine") for row in anonymous.values())


@pytest.mark.asyncio
async def test_a_team_member_sees_the_team_row_as_their_own(flow):
    staff = await flow.add_staff()
    member = await flow.add_user(name="Mitglied")
    flow.act_as(staff)
    tournament = await flow.create_tournament(format="league", team_mode="team", team_size=2, max_participants=4)
    team_registrations = []
    for index in range(4):
        team_id = new_id()
        await flow.db.teams.insert_one({"id": team_id, "name": f"Team {index + 1}", "member_ids": []})
        if index == 1:
            await flow.db.team_members.insert_one({"team_id": team_id, "user_id": member["id"], "role": "member"})
        registration = {"id": new_id(), "tournament_id": tournament["id"], "team_id": team_id,
                        "display_name": f"Team {index + 1}", "status": "approved", "seed": index + 1}
        await flow.db.tournament_registrations.insert_one(dict(registration))
        team_registrations.append(registration)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text

    flow.act_as(member)
    rows = await table(flow, tournament)
    bracket = (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).json()

    assert [rid for rid, row in rows.items() if row.get("is_mine")] == [team_registrations[1]["id"]]
    assert [reg["id"] for reg in bracket["registrations"] if reg.get("is_mine")] == [team_registrations[1]["id"]]


@pytest.mark.asyncio
async def test_the_bracket_marks_the_own_registration_for_solo_players(flow):
    _staff, tournament, users, registrations = await league_of(flow)

    flow.act_as(users[0])
    bracket = (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).json()
    flow.act_as(None)
    anonymous = (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).json()

    assert [reg["id"] for reg in bracket["registrations"] if reg.get("is_mine")] == [registrations[0]["id"]]
    assert not any(reg.get("is_mine") for reg in anonymous["registrations"])


@pytest.mark.asyncio
async def test_each_group_table_has_form_movement_and_the_own_row(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(8, format="groups")
    response = await flow.post(f"/api/tournaments/{tournament['id']}/groups/generate", json={"group_count": 2})
    assert response.status_code == 200, response.text
    await play_round(flow, staff, tournament, 1)

    flow.act_as(users[0])
    groups = (await flow.get(f"/api/tournaments/{tournament['id']}/standings")).json()

    assert len(groups) == 2
    rows = [row for entry in groups for row in entry["standings"]]
    assert all(row["form"] and "previous_rank" in row and "score_diff" in row for row in rows)
    assert [row["registration_id"] for row in rows if row.get("is_mine")] == [registrations[0]["id"]]
