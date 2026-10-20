"""Austritt nach einem gefahrenen Lauf im Läufe-Cup mit Loser Bracket (#1839), über die echten Routen.

Lauf A ist eingetragen, der Erste tritt aus: der Dritte rückt ins Finale nach und verlässt dafür das Loser Bracket, dort
rückt der Vierte auf, der letzte Platz aus A wird ein Freilos. Baum (Web und TV lesen denselben) und Warteschlange
zeigen jede Person höchstens einmal je Runde, und alle Läufe lassen sich danach eintragen. Ist das Loser Bracket
schon eingetragen, bleibt es, wie es ist - im Finale wird der Platz ein Freilos.
"""
import pathlib
import sys
from collections import Counter
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services import scheduler  # noqa: E402

# Zwei Läufe zu viert, die zwei Besten ins Finale, Platz 3 und 4 ins Loser Bracket (wie der Läufe-Cup im Seed).
SCHEME = """[WB]
A=[1,2,3,4]
B=[5,6,7,8]
F=[W:A:1,W:A:2,W:B:1,W:B:2]

[LB]
LA=[L:A:1,L:A:2,L:B:1,L:B:2]
"""


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def heats_cup(flow) -> dict:
    """Ein Läufe-Cup vor Ort mit acht Spielern und zwei Stationen, live."""
    tournament, _users, _registrations = await flow.with_participants(
        8, format="ffa_custom_bracket", event_mode="local", status="registration_open")
    for name in ("1", "2"):
        await flow.db.stations.insert_one({"id": new_id(), "name": name, "tournament_id": tournament["id"],
                                           "status": "free", "current_match_id": None})
    await flow.db.tournament_stages.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Läufe",
        "stage_type": "ffa_custom_bracket", "match_type": "ffa", "status": "pending",
        "settings": {"schema": SCHEME, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2},
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })
    flow.act_as(await flow.add_staff())
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "check_in"})
    assert response.status_code == 200, response.text
    await flow.db.tournament_registrations.update_many({"tournament_id": tournament["id"]}, {"$set": {"status": "checked_in"}})
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {
        "check_in_until": (now_utc() - timedelta(minutes=1)).isoformat()}})
    await scheduler._safe_status_transitions()
    await flow.start(tournament)
    return tournament


async def by_key(flow, tournament: dict) -> dict[str, dict]:
    return {match["match_key"]: match for match in await flow.matches(tournament)}


def seats(match: dict) -> list[str]:
    """Die Anmeldungen eines Laufs nach Sitzplatz."""
    ordered = sorted(match["slots"], key=lambda slot: slot["slot"])
    return [slot["registration_id"] for slot in ordered if slot.get("registration_id")]


def from_heat(target: dict, heat: dict) -> dict[int, str]:
    """Wer aus diesem Lauf in ``target`` sitzt - je Platz im Lauf."""
    return {
        int(slot["source_result"]["rank"]): slot["registration_id"]
        for slot in target["slots"]
        if (slot.get("source_result") or {}).get("from_match_id") == heat["id"] and slot.get("registration_id")
    }


async def enter(flow, match: dict, ranking: list[str]) -> None:
    response = await flow.post(f"/api/matches/{match['id']}/result", json={
        "results": [{"registration_id": reg, "rank": index + 1} for index, reg in enumerate(ranking)]})
    assert response.status_code == 200, response.text


async def withdraw(flow, tournament: dict, registration_id: str) -> dict:
    url = f"/api/tournaments/{tournament['id']}/registrations/{registration_id}/removal"
    proposed = await flow.post(url, json={"kind": "withdrawn"})
    assert proposed.status_code == 200, proposed.text
    plan = proposed.json()["plan"]
    applied = await flow.post(url, json={"kind": "withdrawn", "plan_id": plan["id"]})
    assert applied.status_code == 200, applied.text
    return plan


async def assert_tree_once_per_round(flow, tournament: dict) -> None:
    """Der Baum, wie Web und TV ihn lesen: jede Person höchstens einmal je Runde."""
    response = await flow.get(f"/api/tournaments/{tournament['id']}/bracket")
    assert response.status_code == 200, response.text
    seen: dict[tuple[int, str], str] = {}
    for match in response.json()["matches_v2"]:
        if match.get("status") == "cancelled":
            continue
        for slot in match.get("slots") or []:
            reg = slot.get("registration_id")
            if slot.get("status") != "filled" or not reg:
                continue
            key = (int(match.get("round") or 0), reg)
            assert key not in seen, f"{reg} steht in Runde {key[0]} in {seen[key]} und {match['match_key']}"
            seen[key] = match["match_key"]


async def assert_queue_once(flow, tournament: dict) -> None:
    """Die Warteschlange nennt in den offenen Läufen jede Person höchstens einmal."""
    response = await flow.get(f"/api/tournaments/{tournament['id']}/live-queue")
    assert response.status_code == 200, response.text
    names = Counter(name for entry in (response.json().get("matches") or {}).values() for name in entry.get("names") or [])
    assert not [name for name, count in names.items() if count > 1], names


@pytest.mark.asyncio
async def test_withdrawal_after_a_heat_moves_the_third_from_the_loser_bracket_into_the_final(flow):
    tournament = await heats_cup(flow)
    heat = (await by_key(flow, tournament))["A"]
    first, second, third, fourth = seats(heat)
    await enter(flow, heat, [first, second, third, fourth])
    before = await by_key(flow, tournament)
    assert from_heat(before["LA"], heat) == {3: third, 4: fourth}

    plan = await withdraw(flow, tournament, first)
    after = await by_key(flow, tournament)
    assert from_heat(after["F"], heat) == {2: second, 3: third}
    assert from_heat(after["LA"], heat) == {4: fourth}, "der Nachrücker sitzt nicht zugleich im Loser Bracket"
    assert "F:" in plan["summary"] and "LA:" in plan["summary"], "der Vorschlag nennt beide Läufe"
    assert [slot["status"] for slot in after["LA"]["slots"]
            if (slot.get("source") or {}).get("match_key") == "A" and not slot.get("registration_id")] == ["bye"]
    assert (await flow.db.tournament_registrations.find_one({"id": first}))["status"] == "withdrawn"
    await assert_tree_once_per_round(flow, tournament)
    await assert_queue_once(flow, tournament)

    # Weiter wie gewohnt: Lauf B, dann Loser Bracket und Finale - jedes Eintragen geht durch.
    other = after["B"]
    await enter(flow, other, seats(other))
    after = await by_key(flow, tournament)
    assert after["LA"]["status"] in {"ready", "scheduled"} and after["F"]["status"] in {"ready", "scheduled"}
    await assert_tree_once_per_round(flow, tournament)
    await assert_queue_once(flow, tournament)
    await enter(flow, after["LA"], seats(after["LA"]))
    await enter(flow, after["F"], seats(after["F"]))
    final = await by_key(flow, tournament)
    assert final["F"]["status"] == "completed" and final["LA"]["status"] == "completed"
    assert first not in seats(final["F"]) + seats(final["LA"])


@pytest.mark.asyncio
async def test_withdrawal_after_the_loser_round_was_entered_leaves_it_and_frees_the_final_seat(flow):
    tournament = await heats_cup(flow)
    matches = await by_key(flow, tournament)
    first, second, third, fourth = seats(matches["A"])
    await enter(flow, matches["A"], [first, second, third, fourth])
    await enter(flow, matches["B"], seats(matches["B"]))
    loser_round = (await by_key(flow, tournament))["LA"]
    await enter(flow, loser_round, seats(loser_round))
    entered = await flow.reload(loser_round)

    await withdraw(flow, tournament, first)
    after = await by_key(flow, tournament)
    assert after["LA"]["results"] == entered["results"] and after["LA"]["status"] == "completed"
    assert from_heat(after["F"], matches["A"]) == {2: second}, "wer schon im Loser Bracket gefahren ist, bleibt dort"
    await assert_tree_once_per_round(flow, tournament)
    await assert_queue_once(flow, tournament)
    await enter(flow, after["F"], seats(after["F"]))
    assert (await flow.reload(after["F"]))["status"] == "completed"
