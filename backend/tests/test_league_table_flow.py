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


# ---------------------------------------------------------------- Gleichstand (Codex-Befund zu #1593)

async def report(flow, staff, match, first_score, second_score):
    first, second = [slot["registration_id"] for slot in match["slots"]]
    flow.act_as(staff)
    draw = first_score == second_score
    response = await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
        {"registration_id": first, "rank": 1, "score": first_score},
        {"registration_id": second, "rank": 1 if draw else 2, "score": second_score},
    ]})
    assert response.status_code == 200, response.text
    return first, second


def round_matches(matches, round_number):
    return sorted([m for m in matches if int(m.get("round") or 0) == round_number], key=lambda m: m.get("order") or 0)


@pytest.mark.asyncio
async def test_rows_equal_in_every_criterion_share_their_place(flow):
    staff, tournament, _users, _regs = await league_of(flow)
    for match in round_matches(await flow.matches(tournament), 1):
        await report(flow, staff, match, 3, 1)

    rows = await table(flow, tournament)

    # Zwei Sieger mit 3:1, zwei Verlierer mit 1:3 - Wettbewerbsrang 1, 1, 3, 3 statt 1, 2, 3, 4 nach Zufall.
    assert sorted(row["rank"] for row in rows.values()) == [1, 1, 3, 3]


@pytest.mark.asyncio
async def test_a_tie_on_place_three_is_shared_and_the_next_place_skips(flow):
    staff, tournament, _users, _regs = await league_of(flow, count=6)
    clear, close, level = round_matches(await flow.matches(tournament), 1)
    clear_winner, _ = await report(flow, staff, clear, 3, 0)
    close_winner, _ = await report(flow, staff, close, 3, 1)
    drawn = await report(flow, staff, level, 1, 1)

    rows = await table(flow, tournament)

    assert rows[clear_winner]["rank"] == 1
    assert rows[close_winner]["rank"] == 2
    assert [rows[rid]["rank"] for rid in drawn] == [3, 3]
    assert sorted(row["rank"] for row in rows.values()) == [1, 2, 3, 3, 5, 6]


@pytest.mark.asyncio
async def test_the_movement_uses_the_shared_places_of_the_previous_matchday(flow):
    staff, tournament, _users, _regs = await league_of(flow)
    for match in round_matches(await flow.matches(tournament), 1):
        await report(flow, staff, match, 3, 1)
    after_first = await table(flow, tournament)
    assert sorted(row["rank"] for row in after_first.values()) == [1, 1, 3, 3]
    for match in round_matches(await flow.matches(tournament), 2):
        await report(flow, staff, match, 2, 0)

    after_second = await table(flow, tournament)

    assert {rid: row["previous_rank"] for rid, row in after_second.items()} == {rid: row["rank"] for rid, row in after_first.items()}


@pytest.mark.asyncio
async def test_a_swiss_table_shares_places_too(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4, format="swiss")
    await flow.start(tournament)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/swiss/next-round")
    assert response.status_code == 200, response.text
    for match in round_matches(await flow.matches(tournament), 1):
        await report(flow, staff, match, 2, 0)

    rows = await table(flow, tournament)

    assert sorted(row["rank"] for row in rows.values()) == [1, 1, 3, 3]


@pytest.mark.asyncio
async def test_a_knockout_team_row_says_it_is_a_team(flow):
    """Sieger-Moment „mit deinem Team“: auch im K.-o. trägt die eigene Zeile die Team-Kennung (öffentlich wie in der Anmeldung)."""
    staff = await flow.add_staff()
    member = await flow.add_user(name="Mitglied")
    flow.act_as(staff)
    tournament = await flow.create_tournament(format="single_elim", team_mode="team", team_size=2, max_participants=4)
    team_ids = []
    for index in range(4):
        team_id = new_id()
        team_ids.append(team_id)
        await flow.db.teams.insert_one({"id": team_id, "name": f"Team {index + 1}", "member_ids": []})
        if index == 0:
            await flow.db.team_members.insert_one({"team_id": team_id, "user_id": member["id"], "role": "member"})
        await flow.db.tournament_registrations.insert_one({
            "id": new_id(), "tournament_id": tournament["id"], "team_id": team_id,
            "display_name": f"Team {index + 1}", "status": "approved", "seed": index + 1})
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    for match in round_matches(await flow.matches(tournament), 1):
        await report(flow, staff, match, 2, 0)

    flow.act_as(member)
    rows = await table(flow, tournament)

    mine = [row for row in rows.values() if row.get("is_mine")]
    assert len(mine) == 1 and mine[0]["team_id"] == team_ids[0]
    assert all(row.get("team_id") in team_ids for row in rows.values())


# ---------------------------------------------------------------- Geteilte Plätze in Saison, Preisen, Auszeichnungen

@pytest.mark.asyncio
async def test_a_shared_place_counts_for_both_in_season_prizes_and_awards(flow):
    """Ein geteiltes 1. ist für beide ein 1. - Saisonpunkte, Preis und Auszeichnung; der nächste Platz ist 3."""
    await flow.db.seasons.insert_one({"id": "s1", "name": "Herbst", "status": "active", "start_date": "2026-09-01T00:00:00+00:00"})
    staff, tournament, users, regs = await league_of(flow, prize_places=[
        {"group": "overall", "place": 1, "label": "Gold", "value": "Pokal"},
        {"group": "overall", "place": 3, "label": "Bronze", "value": "Medaille"},
    ])
    winners, losers = [], []
    for match in round_matches(await flow.matches(tournament), 1):
        first, second = await report(flow, staff, match, 3, 1)
        winners.append(first)
        losers.append(second)
    user_of = {reg["id"]: user["id"] for reg, user in zip(regs, users)}
    flow.act_as(staff)
    for status in ("completed", "results_published"):
        response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": status})
        assert response.status_code == 200, response.text

    points = {doc["user_id"]: doc for doc in await flow.db.season_points.find({"source_id": tournament["id"]}, {"_id": 0}).to_list(50)}
    assert {points[user_of[rid]]["rank"] for rid in winners} == {1}
    assert {points[user_of[rid]]["rank"] for rid in losers} == {3}
    assert points[user_of[winners[0]]]["total_points"] == points[user_of[winners[1]]]["total_points"]

    pickups = await flow.db.prize_pickups.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(50)
    assert sorted((doc["place"], doc["user_id"]) for doc in pickups) == sorted(
        [(1, user_of[rid]) for rid in winners] + [(3, user_of[rid]) for rid in losers])
    # Noch einmal auslösen legt keinen zweiten Datensatz je Person an.
    from services.prize_service import auto_create_for_tournament
    assert await auto_create_for_tournament(tournament["id"]) == 0

    awards = {doc["registration_id"]: doc["rank"] for doc in await flow.db.tournament_awards.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(50)}
    assert {awards[rid] for rid in winners} == {1} and {awards[rid] for rid in losers} == {3}


async def shared_first_place(flow):
    """Liga mit vier, erster Spieltag mit gleichen Ergebnissen: zwei teilen sich Platz 1."""
    staff, tournament, users, regs = await league_of(flow)
    winners = []
    for match in round_matches(await flow.matches(tournament), 1):
        first, _second = await report(flow, staff, match, 3, 1)
        winners.append(first)
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    return stored, users, regs, winners


@pytest.mark.asyncio
async def test_the_migration_preview_sees_the_shared_place_too(flow):
    from services.competition_read import load_competition_read_model
    from services.migration_dryrun import tournament_fingerprint

    tournament, _users, regs, winners = await shared_first_place(flow)
    snapshot = (await load_competition_read_model(flow.db, tournament["id"])).structure_snapshot()

    fingerprint = tournament_fingerprint(tournament, snapshot, regs)

    assert fingerprint["placements"]["1"] == sorted(winners)
    assert "2" not in fingerprint["placements"]


@pytest.mark.asyncio
async def test_both_holders_of_a_shared_first_place_count_a_tournament_win(flow):
    from services.achievement_progress import compute_user_progress

    _tournament, users, regs, winners = await shared_first_place(flow)
    user_of = {reg["id"]: user["id"] for reg, user in zip(regs, users)}

    progress = [await compute_user_progress(user_of[rid]) for rid in winners]

    assert [entry["tournaments_won"] for entry in progress] == [1, 1]
