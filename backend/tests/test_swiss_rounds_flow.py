"""Schweizer System komplett (#1559) als Ablauf: die nächste Runde entsteht von selbst, die Abschlussregel beendet das
System, und nichts läuft doppelt. Echte Routen, Datenbank im Speicher. Nur erfundene Namen.
"""
import asyncio
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
    return [{"registration_id": winner, "rank": 1, "score": 2}, {"registration_id": loser, "rank": 2, "score": 0}]


async def swiss(flow, count, **settings):
    staff = await flow.add_staff()
    flow.act_as(staff)
    fields = {"swiss_settings": settings} if settings else {}
    tournament, _users, regs = await flow.with_participants(count, format="swiss", **fields)
    await flow.start(tournament)
    return staff, tournament, regs


async def next_round(flow, tournament):
    return await flow.post(f"/api/tournaments/{tournament['id']}/swiss/next-round")


async def round_matches(flow, tournament, round_number):
    return [match for match in await flow.matches(tournament) if match["round"] == round_number]


async def decide(flow, match, winner=None):
    """Ein Spiel werten - ohne Angabe gewinnt die erste Seite."""
    sides = [slot["registration_id"] for slot in match["slots"] if slot["registration_id"]]
    first = winner or sides[0]
    other = next(side for side in sides if side != first)
    response = await flow.post(f"/api/matches/{match['id']}/result", json={"results": ranking(first, other)})
    assert response.status_code == 200, response.text
    return first, other


async def play_round(flow, tournament, round_number, winners=()):
    """Alle offenen Spiele einer Runde werten; wer in ``winners`` steht, gewinnt sein Spiel."""
    for match in await round_matches(flow, tournament, round_number):
        if match["status"] == "completed":
            continue
        sides = [slot["registration_id"] for slot in match["slots"] if slot["registration_id"]]
        await decide(flow, match, next((side for side in sides if side in winners), None))


# ---------------------------------------------------------------- Nächste Runde automatisch

@pytest.mark.asyncio
async def test_the_next_round_is_paired_as_soon_as_the_last_match_is_decided(flow):
    _staff, tournament, _regs = await swiss(flow, 6, auto_next_round=True)
    first = await next_round(flow, tournament)
    assert first.status_code == 200, first.text
    round_one = await round_matches(flow, tournament, 1)
    assert len(round_one) == 3

    await decide(flow, round_one[0])
    await decide(flow, round_one[1])
    assert await round_matches(flow, tournament, 2) == [], "Solange ein Spiel offen ist, entsteht nichts"

    await decide(flow, round_one[2])

    round_two = await round_matches(flow, tournament, 2)
    assert len(round_two) == 3
    assert all(match["status"] == "ready" for match in round_two)
    seated = sorted(slot["registration_id"] for match in round_two for slot in match["slots"])
    assert len(seated) == len(set(seated)) == 6
    audit = await flow.db.audit_logs.find({"action": "tournament.swiss.next_round"}, {"_id": 0}).to_list(10)
    assert [entry["data"].get("automatic") for entry in audit] == [False, True]


@pytest.mark.asyncio
async def test_without_the_setting_the_lead_starts_every_round(flow):
    _staff, tournament, _regs = await swiss(flow, 4)
    assert (await next_round(flow, tournament)).status_code == 200

    await play_round(flow, tournament, 1)

    assert await round_matches(flow, tournament, 2) == []
    assert (await next_round(flow, tournament)).status_code == 200


@pytest.mark.asyncio
async def test_a_corrected_result_does_not_pair_the_round_again(flow):
    """Die Runde 2 steht schon; eine Korrektur in Runde 1 löst nichts mehr aus."""
    _staff, tournament, _regs = await swiss(flow, 4, auto_next_round=True)
    assert (await next_round(flow, tournament)).status_code == 200
    await play_round(flow, tournament, 1)
    before = await round_matches(flow, tournament, 2)
    assert len(before) == 2

    match = (await round_matches(flow, tournament, 1))[0]
    sides = [slot["registration_id"] for slot in match["slots"]]
    corrected = await flow.post(f"/api/matches/{match['id']}/result?force=true", json={
        "results": ranking(sides[1], sides[0]), "reason": "Seiten vertauscht eingetragen"})
    assert corrected.status_code == 200, corrected.text

    after = await flow.matches(tournament)
    assert len([m for m in after if m["round"] == 2]) == 2
    assert max(m["round"] for m in after) == 2


@pytest.mark.asyncio
async def test_asking_twice_never_writes_a_round_twice(flow):
    """Der Auslöser nach dem Ergebnis und ein Klick der Leitung zur selben Zeit: eine Runde, nicht zwei."""
    from services import swiss_rounds

    _staff, tournament, _regs = await swiss(flow, 6, auto_next_round=True)
    assert (await next_round(flow, tournament)).status_code == 200
    await play_round(flow, tournament, 1)
    assert len(await round_matches(flow, tournament, 2)) == 3

    again = await swiss_rounds.advance_after_write(flow.db, tournament["id"], actor_id=None)
    clicks = await asyncio.gather(next_round(flow, tournament), next_round(flow, tournament))

    assert again is None
    assert all(response.status_code in (400, 409) for response in clicks)
    assert len(await round_matches(flow, tournament, 2)) == 3
    assert max(match["round"] for match in await flow.matches(tournament)) == 2


@pytest.mark.asyncio
async def test_the_same_round_written_twice_is_refused_by_its_ids(flow):
    """Sicherung unter der Sperre: dieselbe Runde ergibt dieselben Kennungen - ein zweites Schreiben fügt nichts hinzu."""
    from services import swiss_rounds
    from services.graph_swiss import swiss_round_documents

    _staff, tournament, regs = await swiss(flow, 4)
    assert (await next_round(flow, tournament)).status_code == 200
    stage = await flow.db.tournament_stages.find_one({"tournament_id": tournament["id"]}, {"_id": 0})
    existing = await round_matches(flow, tournament, 1)

    rebuilt = swiss_round_documents(tournament, stage, regs, [], round_number=1)
    assert sorted(document["id"] for document in rebuilt) == sorted(match["id"] for match in existing)
    written = await swiss_rounds.insert_round(flow.db, rebuilt)

    assert written is False
    assert len(await round_matches(flow, tournament, 1)) == 2


@pytest.mark.asyncio
async def test_a_round_taken_back_comes_back_with_the_same_pairings(flow):
    _staff, tournament, _regs = await swiss(flow, 8)
    assert (await next_round(flow, tournament)).status_code == 200

    def pairs(matches):
        return sorted(tuple(slot["registration_id"] for slot in match["slots"]) for match in matches)

    first = pairs(await round_matches(flow, tournament, 1))
    undone = await flow.post(f"/api/tournaments/{tournament['id']}/swiss/undo-round")
    assert undone.status_code == 200, undone.text
    assert (await next_round(flow, tournament)).status_code == 200

    assert pairs(await round_matches(flow, tournament, 1)) == first


# ---------------------------------------------------------------- Abschlussregel

@pytest.mark.asyncio
async def test_after_the_set_number_of_rounds_no_further_round_starts(flow):
    _staff, tournament, _regs = await swiss(flow, 4, auto_next_round=True, end_rule="rounds", rounds=2, top_n=2)
    assert (await next_round(flow, tournament)).status_code == 200

    await play_round(flow, tournament, 1)
    assert len(await round_matches(flow, tournament, 2)) == 2
    await play_round(flow, tournament, 2)

    assert await round_matches(flow, tournament, 3) == []
    refused = await next_round(flow, tournament)
    assert refused.status_code == 409
    assert "abgeschlossen" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_more_rounds_can_be_added_afterwards(flow):
    _staff, tournament, _regs = await swiss(flow, 4, end_rule="rounds", rounds=1)
    assert (await next_round(flow, tournament)).status_code == 200
    await play_round(flow, tournament, 1)
    assert (await next_round(flow, tournament)).status_code == 409

    saved = await flow.put(f"/api/tournaments/{tournament['id']}", json={"swiss_settings": {"end_rule": "rounds", "rounds": 2}})
    assert saved.status_code == 200, saved.text

    assert (await next_round(flow, tournament)).status_code == 200


@pytest.mark.asyncio
async def test_three_wins_advance_three_losses_are_out_and_neither_plays_on(flow):
    """Hier mit 2 und 2: nach zwei Runden ist einer weiter und einer raus - Runde 3 spielen nur noch die beiden Offenen."""
    _staff, tournament, regs = await swiss(flow, 4, auto_next_round=True, end_rule="wins_losses",
                                           wins_to_advance=2, losses_to_exit=2)
    assert (await next_round(flow, tournament)).status_code == 200
    round_one = await round_matches(flow, tournament, 1)
    winners_one = [(await decide(flow, match))[0] for match in round_one]

    round_two = await round_matches(flow, tournament, 2)
    assert len(round_two) == 2
    top = next(match for match in round_two if {slot["registration_id"] for slot in match["slots"]} == set(winners_one))
    bottom = next(match for match in round_two if match["id"] != top["id"])
    advanced, _ = await decide(flow, top)
    _, eliminated = await decide(flow, bottom)

    round_three = await round_matches(flow, tournament, 3)
    assert len(round_three) == 1
    still_playing = {slot["registration_id"] for slot in round_three[0]["slots"]}
    assert still_playing == {reg["id"] for reg in regs} - {advanced, eliminated}

    await decide(flow, round_three[0])

    assert await round_matches(flow, tournament, 4) == []
    refused = await next_round(flow, tournament)
    assert refused.status_code == 409
    assert "weiter oder ausgeschieden" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_the_bracket_answer_says_where_the_swiss_system_stands(flow):
    _staff, tournament, _regs = await swiss(flow, 4, auto_next_round=True, end_rule="rounds", rounds=2)
    assert (await next_round(flow, tournament)).status_code == 200

    running = (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).json()["swiss"]
    assert running == {"end_rule": "rounds", "rounds_played": 1, "rounds_total": 2, "round_open": True, "complete": False,
                       "auto_next_round": True, "advanced": 0, "eliminated": 0, "active": 4,
                       "wins_to_advance": 3, "losses_to_exit": 3, "top_n": None}

    await play_round(flow, tournament, 1)
    await play_round(flow, tournament, 2)

    done = (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).json()["swiss"]
    assert done["complete"] is True and done["rounds_played"] == 2 and done["round_open"] is False


@pytest.mark.asyncio
async def test_other_formats_carry_no_swiss_state(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4)

    assert "swiss" not in (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).json()


# ---------------------------------------------------------------- Einstellungen speichern

@pytest.mark.asyncio
async def test_swiss_settings_are_checked_when_saved(flow):
    _staff, tournament, _regs = await swiss(flow, 4)
    url = f"/api/tournaments/{tournament['id']}"

    saved = await flow.put(url, json={"swiss_settings": {
        "end_rule": "wins_losses", "wins_to_advance": 3, "losses_to_exit": 3, "auto_next_round": True,
        "tiebreakers": ["median_buchholz", "buchholz", "head_to_head", "wins"]}})
    assert saved.status_code == 200, saved.text
    assert saved.json()["swiss_settings"]["end_rule"] == "wins_losses"
    assert saved.json()["swiss_settings"]["tiebreakers"] == ["median_buchholz", "buchholz", "head_to_head", "wins"]

    for bad in ({"end_rule": "irgendwann"}, {"rounds": 0}, {"rounds": 31}, {"wins_to_advance": 0},
                {"tiebreakers": ["zufall"]}, {"top_n": 0}):
        response = await flow.put(url, json={"swiss_settings": bad})
        assert response.status_code == 422, bad


# ---------------------------------------------------------------- Austritt und Modell

@pytest.mark.asyncio
async def test_a_withdrawal_that_settles_the_round_starts_the_next_one(flow):
    """Das letzte offene Spiel wird durch einen Austritt kampflos gewertet - die Runde ist fertig, die neue entsteht ohne
    die ausgetretene Person."""
    _staff, tournament, regs = await swiss(flow, 4, auto_next_round=True)
    assert (await next_round(flow, tournament)).status_code == 200
    round_one = await round_matches(flow, tournament, 1)
    await decide(flow, round_one[0])
    leaving = round_one[1]["slots"][0]["registration_id"]
    url = f"/api/tournaments/{tournament['id']}/registrations/{leaving}/removal"

    proposed = await flow.post(url, json={"kind": "withdrawn", "reason": "Krank"})
    assert proposed.status_code == 200, proposed.text
    confirmed = await flow.post(url, json={"kind": "withdrawn", "plan_id": proposed.json()["plan"]["id"]})
    assert confirmed.status_code == 200, confirmed.text

    round_two = await round_matches(flow, tournament, 2)
    seated = {slot["registration_id"] for match in round_two for slot in match["slots"] if slot["registration_id"]}
    assert seated == {reg["id"] for reg in regs} - {leaving}
    assert len(round_two) == 2, "ein Spiel und ein Freilos"


# ---------------------------------------------------------------- Rückgängig nach der nächsten Runde

async def undo(flow, match):
    return await flow.post(f"/api/matches/{match['id']}/result/undo")


@pytest.mark.asyncio
@pytest.mark.parametrize("automatic", [True, False])
async def test_taking_back_the_last_result_takes_the_untouched_next_round_with_it(flow, automatic):
    """Runde 2 ist aus den Ergebnissen von Runde 1 gepaart. Geht das letzte Ergebnis zurück, darf sie nicht stehen
    bleiben - solange niemand in ihr gespielt hat, geht sie mit und entsteht aus dem neuen Ergebnis neu."""
    _staff, tournament, _regs = await swiss(flow, 6, auto_next_round=automatic)
    assert (await next_round(flow, tournament)).status_code == 200
    round_one = await round_matches(flow, tournament, 1)
    for match in round_one:
        await decide(flow, match)
    if not automatic:
        assert (await next_round(flow, tournament)).status_code == 200
    assert len(await round_matches(flow, tournament, 2)) == 3

    undone = await undo(flow, round_one[2])

    assert undone.status_code == 200, undone.text
    assert undone.json()["removed_round"] == 2
    assert await round_matches(flow, tournament, 2) == []
    reopened = next(match for match in await round_matches(flow, tournament, 1) if match["id"] == round_one[2]["id"])
    assert reopened["status"] != "completed" and reopened["results"] == []
    audit = await flow.db.audit_logs.find({"action": "match.result.undo"}, {"_id": 0}).to_list(10)
    assert audit[-1]["data"]["removed_round"] == 2

    # Diesmal gewinnt die andere Seite - Runde 2 entsteht neu, aus diesem Ergebnis.
    other_side = reopened["slots"][1]["registration_id"]
    await decide(flow, reopened, winner=other_side)
    if not automatic:
        assert (await next_round(flow, tournament)).status_code == 200
    round_two = await round_matches(flow, tournament, 2)
    assert len(round_two) == 3
    winners = {other_side, *(match["slots"][0]["registration_id"] for match in round_one[:2])}
    mixed = sorted(len({slot["registration_id"] for slot in match["slots"]} & winners) for match in round_two)
    assert mixed == [0, 1, 2], "drei Sieger, drei Verlierer: ein Paar Sieger, ein Paar Verlierer, eines gemischt"


@pytest.mark.asyncio
async def test_a_result_stays_once_the_next_round_has_begun(flow):
    """Hat in Runde 2 schon jemand gespielt, bleibt beides stehen - mit einem Satz, was zu tun ist."""
    _staff, tournament, _regs = await swiss(flow, 6, auto_next_round=True)
    assert (await next_round(flow, tournament)).status_code == 200
    round_one = await round_matches(flow, tournament, 1)
    for match in round_one:
        await decide(flow, match)
    round_two = await round_matches(flow, tournament, 2)
    await decide(flow, round_two[0])

    refused = await undo(flow, round_one[2])

    assert refused.status_code == 409
    detail = refused.json()["detail"]
    assert "Runde 2" in detail and "Korrigieren" in detail
    assert len(await round_matches(flow, tournament, 2)) == 3
    kept = next(match for match in await round_matches(flow, tournament, 1) if match["id"] == round_one[2]["id"])
    assert kept["status"] == "completed" and kept["results"]


@pytest.mark.asyncio
async def test_a_result_taken_back_inside_a_running_round_removes_nothing(flow):
    """Solange die Runde noch läuft, gibt es keine nächste - Rückgängig nimmt nur das eine Ergebnis zurück."""
    _staff, tournament, _regs = await swiss(flow, 6, auto_next_round=True)
    assert (await next_round(flow, tournament)).status_code == 200
    round_one = await round_matches(flow, tournament, 1)
    await decide(flow, round_one[0])

    undone = await undo(flow, round_one[0])

    assert undone.status_code == 200, undone.text
    assert "removed_round" not in undone.json()
    assert len(await round_matches(flow, tournament, 1)) == 3


def test_the_model_and_the_calculation_know_the_same_values():
    from typing import get_args

    import models
    from services import graph_swiss

    assert get_args(models.SwissEndRule) == graph_swiss.END_RULES
    assert get_args(models.SwissTiebreaker) == graph_swiss.TIEBREAKERS
    assert models.SwissSettings().model_dump() == graph_swiss.swiss_settings({})
