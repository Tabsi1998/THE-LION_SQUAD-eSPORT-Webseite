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


async def heats_cup(flow, scheme: str = SCHEME, count: int = 8, **fields) -> dict:
    """Ein Läufe-Cup vor Ort mit zwei Stationen, live."""
    tournament, _users, _registrations = await flow.with_participants(
        count, format="ffa_custom_bracket", event_mode="local", status="registration_open", **fields)
    for name in ("1", "2"):
        await flow.db.stations.insert_one({"id": new_id(), "name": name, "tournament_id": tournament["id"],
                                           "status": "free", "current_match_id": None})
    await flow.db.tournament_stages.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Läufe",
        "stage_type": "ffa_custom_bracket", "match_type": "ffa", "status": "pending",
        "settings": {"schema": scheme, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2},
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


# ---------------------------------------------------------------------------------------------- Show-Auslosung und Topf

# Der Läufe-Cup aus dem Abnahme-Seed: 16 Fahrer, je Runde zwei Läufe in Sieger- und Verlierer-Weg (gemischt: Gruppen).
CUP = """[WB]
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
E=[W:A:1,W:A:2,W:B:1,W:B:2]
F=[W:C:1,W:C:2,W:D:1,W:D:2]
G=[W:E:1,W:E:2,W:F:1,W:F:2]

[LB]
LA=[L:A:1,L:A:2,L:B:1,L:B:2]
LB=[L:C:1,L:C:2,L:D:1,L:D:2]
LC=[W:LA:1,W:LA:2,L:E:1,L:E:2]
LD=[W:LB:1,W:LB:2,L:F:1,L:F:2]
LE=[W:LC:1,W:LC:2,W:LD:1,W:LD:2]
LF=[W:LE:1,W:LE:2,L:G:1,L:G:2]
"""


async def round_two(flow, tournament: dict) -> tuple[set[str], set[str]]:
    """Wer in Runde 2 sitzt: (Sieger-Weg, Loser Bracket)."""
    rows = [m for m in await flow.matches(tournament) if m.get("round") == 2]
    winners = {reg for m in rows if str(m.get("section") or "").upper() != "LB" for reg in seats(m)}
    losers = {reg for m in rows if str(m.get("section") or "").upper() == "LB" for reg in seats(m)}
    return winners, losers


async def draw(flow, tournament: dict, key: str, path: str = "draw") -> dict:
    """„Jetzt auslosen“ bzw. „Neu auslosen“ der Gruppe, in der das Spiel ``key`` liegt."""
    match = (await by_key(flow, tournament))[key]
    response = await flow.post(f"/api/tournaments/{tournament['id']}/stages/{match['stage_id']}/{path}",
                               json={"group": match["settings"]["draw_group"]})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_show_draw_leaves_out_who_withdrew_during_the_heat(flow):
    """Austritt, während der Lauf schon aufgerufen ist: die Person bleibt im Ergebnis (zuletzt gewertet), kommt aber
    beim späteren Los in keinen Topf - der Nächste rückt auf, auf beiden Wegen."""
    tournament = await heats_cup(flow, CUP, 16, advancement_mode="draw_show")
    matches = await by_key(flow, tournament)
    heat = matches["A"]
    await flow.db.matches_v2.update_one({"id": heat["id"]}, {"$set": {"station_id": "station-1", "called_at": now_utc().isoformat()}})
    gone, second, third, fourth = seats(heat)
    await withdraw(flow, tournament, gone)
    assert gone in seats(await flow.reload(heat)), "der aufgerufene Lauf bleibt, wie er ist"
    await enter(flow, heat, [gone, second, third, fourth])
    for key in "BCD":
        await enter(flow, matches[key], seats(matches[key]))
    await draw(flow, tournament, "E")
    await draw(flow, tournament, "LA")
    winners, losers = await round_two(flow, tournament)
    assert gone not in winners | losers
    assert {second, third} <= winners and fourth in losers and third not in losers
    await assert_tree_once_per_round(flow, tournament)


@pytest.mark.asyncio
async def test_redraw_after_a_withdrawal_keeps_the_withdrawn_out(flow):
    """Auslosung nach der Runde, danach tritt der Erste aus A aus und die Leitung lost beide Wege neu: er kommt nicht
    zurück, der Dritte bleibt im Sieger-Weg und nicht im Loser Bracket."""
    tournament = await heats_cup(flow, CUP, 16, advancement_mode="draw_round")
    matches = await by_key(flow, tournament)
    for key in "ABCD":
        await enter(flow, matches[key], seats(matches[key]))
    first, second, third, fourth = [row["registration_id"] for row in (await flow.reload(matches["A"]))["results"]]
    await withdraw(flow, tournament, first)
    await draw(flow, tournament, "E", "redraw")
    await draw(flow, tournament, "LA", "redraw")
    winners, losers = await round_two(flow, tournament)
    assert first not in winners | losers
    assert {second, third} <= winners and fourth in losers and third not in losers
    await assert_tree_once_per_round(flow, tournament)
