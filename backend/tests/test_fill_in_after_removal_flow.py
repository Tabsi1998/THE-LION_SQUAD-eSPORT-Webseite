"""Nachrücker und Fristen nach Austritt oder Disqualifikation (#1551 mit #1553).

Ein Platz, der durch Austritt frei wurde, ist ein freier Platz für einen Nachrücker - solange dessen erstes echtes Spiel
nicht begonnen hat. Für Ausgeschiedene entsteht kein Vorschlag „nicht erschienen“.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import scheduler  # noqa: E402
from services.match_deadline_sweep import sweep  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def ago(minutes: float) -> str:
    return (now_utc() - timedelta(minutes=minutes)).isoformat()


async def eight(flow, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(max_participants=8, status="check_in", check_in_from=ago(30),
                                              check_in_until=ago(1), start_date=ago(0), **fields)
    regs = [await flow.register(tournament, await flow.add_user(name=f"Spieler {i}"), seed=i, status="checked_in")
            for i in range(1, 9)]
    await scheduler._safe_status_transitions()
    await flow.start(tournament)
    return staff, tournament, regs


def filled(match):
    return [s["registration_id"] for s in match["slots"] if s.get("status") == "filled" and s.get("registration_id")]


async def remove(flow, tournament, reg, kind="withdrawn"):
    url = f"/api/tournaments/{tournament['id']}/registrations/{reg['id']}/removal"
    plan = (await flow.post(url, json={"kind": kind})).json()["plan"]
    response = await flow.post(url, json={"kind": kind, "plan_id": plan["id"]})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_a_late_participant_takes_the_place_freed_by_a_withdrawal(flow):
    _staff, tournament, regs = await eight(flow)
    first_round = sorted((m for m in await flow.matches(tournament) if m["round"] == 1), key=lambda m: m["order"])
    match = first_round[0]
    leaving, staying = filled(match)
    await remove(flow, tournament, next(reg for reg in regs if reg["id"] == leaving))

    late = await flow.add_user(name="Nachrücker")
    response = await flow.post(f"/api/tournaments/{tournament['id']}/registrations", json={"user_id": late["id"], "status": "checked_in"})
    assert response.status_code == 200, response.text
    placement = response.json()["placement"]
    assert placement["ok"] is True and placement["match_id"] == match["id"], placement
    new_id = response.json()["registration"]["id"]

    reopened = await flow.reload(match)
    assert set(filled(reopened)) == {staying, new_id} and reopened["status"] == "ready" and not reopened.get("results")
    assert all(not (slot.get("source_result") or {}).get("removed_registration_id")
               for slot in reopened["slots"] if slot.get("registration_id") == new_id), "der Platz ist neu besetzt"
    later = [m for m in await flow.matches(tournament) if m["round"] > 1]
    assert all(staying not in filled(m) for m in later), "wer kampflos weiter war, spielt jetzt wieder Runde 1"


@pytest.mark.asyncio
async def test_a_removal_comes_back_only_on_a_free_place(flow):
    """#2111 (TA14): zurücknehmen über den Status geht wie ein Nachrücken - auf den frei gewordenen Platz. Steht die Person
    noch in festen Spielen (schon gespielt), bleibt es beim Austritt; vorher setzte der Status sie am Umbau vorbei zurück."""
    _staff, tournament, regs = await eight(flow)
    first_round = sorted((m for m in await flow.matches(tournament) if m["round"] == 1), key=lambda m: m["order"])
    url = f"/api/tournaments/{tournament['id']}/registrations"
    back = next(reg for reg in regs if reg["id"] == filled(first_round[0])[0])
    await remove(flow, tournament, back, kind="disqualified")
    undone = await flow.patch(f"{url}/{back['id']}", json={"status": "approved"})
    assert undone.status_code == 200, undone.text
    assert undone.json()["placement"]["ok"] is True

    played = next(reg for reg in regs if reg["id"] == filled(first_round[1])[0])
    await remove(flow, tournament, played, kind="withdrawn")
    # Wer schon gespielt hat, steht weiter in einem festen Spiel.
    await flow.db.matches_v2.update_one({"id": first_round[2]["id"]}, {"$set": {"slots.0.registration_id": played["id"]}})
    refused = await flow.patch(f"{url}/{played['id']}", json={"status": "approved"})
    assert refused.status_code == 409, refused.text
    assert "nicht zurücknehmen" in refused.json()["detail"]
    stored = await flow.db.tournament_registrations.find_one({"id": played["id"]}, {"_id": 0})
    assert stored["status"] == "withdrawn"


@pytest.mark.asyncio
async def test_lifting_a_removal_needs_the_right_to_remove(flow):
    """#2111: eine Disqualifikation aufheben darf nur, wer sie auch aussprechen darf - weder ein Helfer, der nur einer
    Station zugeteilt ist, noch der Weg über den Check-in."""
    staff, tournament, regs = await eight(flow)
    tid = tournament["id"]
    first_round = sorted((m for m in await flow.matches(tournament) if m["round"] == 1), key=lambda m: m["order"])
    removed = next(reg for reg in regs if reg["id"] == filled(first_round[0])[0])
    await remove(flow, tournament, removed, kind="disqualified")

    helper = await flow.add_user(name="Helfer")
    await flow.db.tournament_staff_assignments.insert_one({"tournament_id": tid, "user_id": helper["id"], "role": "referee",
                                                           "scope": "station", "scope_id": "station-1", "is_active": True})
    flow.act_as(helper)
    refused = await flow.patch(f"/api/tournaments/{tid}/registrations/{removed['id']}", json={"status": "approved"})
    assert refused.status_code == 403, refused.text

    at_checkin = await flow.post(f"/api/tournaments/{tid}/registrations/{removed['id']}/checkin", json={"status": "checked_in"})
    assert at_checkin.status_code == 409, at_checkin.text
    assert "Teilnehmerliste" in at_checkin.json()["detail"]

    stored = await flow.db.tournament_registrations.find_one({"id": removed["id"]}, {"_id": 0})
    assert stored["status"] == "disqualified" and stored["removal"]["kind"] == "disqualified"

    flow.act_as(staff)
    assert (await flow.patch(f"/api/tournaments/{tid}/registrations/{removed['id']}", json={"status": "approved"})).status_code == 200


@pytest.mark.asyncio
async def test_no_no_show_proposal_for_a_removed_participant(flow):
    _staff, tournament, regs = await eight(flow, event_mode="online")
    first_round = sorted((m for m in await flow.matches(tournament) if m["round"] == 1), key=lambda m: m["order"])
    for match in first_round:
        await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": ago(30)}})
    target = first_round[0]
    await remove(flow, tournament, next(reg for reg in regs if reg["id"] == filled(target)[0]), kind="disqualified")
    await sweep(flow.db, now=now_utc() + timedelta(minutes=20))
    assert not (await flow.reload(target)).get("no_show_proposal"), "kein Vorschlag für ein Spiel mit Ausgeschiedenen"

    # Auch wenn eine ausgeschiedene Person (Altbestand) noch in einem offenen Spiel steht: kein Vorschlag.
    other = first_round[1]
    await flow.db.tournament_registrations.update_one({"id": filled(other)[0]}, {"$set": {"status": "withdrawn"}})
    await flow.db.matches_v2.update_one({"id": other["id"]}, {"$unset": {"no_show_proposal": ""}})
    await sweep(flow.db, now=now_utc() + timedelta(minutes=20))
    assert not (await flow.reload(other)).get("no_show_proposal")
    assert (await flow.reload(first_round[2])).get("no_show_proposal"), "die anderen Spiele bekommen ihn weiter"


@pytest.mark.asyncio
async def test_a_removal_drops_an_open_no_show_proposal_and_its_extension(flow):
    _staff, tournament, regs = await eight(flow, event_mode="online")
    match = sorted((m for m in await flow.matches(tournament) if m["round"] == 1), key=lambda m: m["order"])[0]
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": ago(30)}})
    await sweep(flow.db, now=now_utc() + timedelta(minutes=20))
    extended = await flow.post(f"/api/tournaments/{tournament['id']}/lead/no-show/{match['id']}", json={"action": "extend", "minutes": 5})
    assert extended.status_code == 200, extended.text
    await sweep(flow.db, now=now_utc() + timedelta(minutes=40))
    stored = await flow.reload(match)
    assert stored.get("no_show_proposal") and stored.get("no_show_extended_until")

    await remove(flow, tournament, next(reg for reg in regs if reg["id"] == filled(match)[0]))
    after = await flow.reload(match)
    assert not after.get("no_show_proposal") and not after.get("no_show_extended_until"), "der Fall gehörte zur alten Paarung"
    lead = (await flow.get(f"/api/tournaments/{tournament['id']}/lead")).json()
    assert not [row for row in lead["attention"] if row["kind"] == "no_show" and row["match_id"] == match["id"]], "kein offener Fall"
