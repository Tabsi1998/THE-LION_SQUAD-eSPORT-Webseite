"""Gast mit Konto verknüpfen (#1585, Entscheidung Fabian 14.10.2026).

Legt ein Gast später ein Konto an, ordnet die Leitung (oder ein Admin) den Gast diesem Konto zu: alle Zeiten des
Gastes gehören dann dem Konto, und das Konto zählt voll - Rangliste, Gewinne, Saisonpunkte, Erfolge.

- Nur Leitung/Admin; vorher eine Vorschau („X Zeiten von Gast … gehen an Konto …“).
- Nach der Veröffentlichung wie eine Korrektur: Begründung Pflicht, Protokoll ``fastlap.guest.link`` nur mit
  Kennungen, danach Abgleich der Gewinne und Saisonpunkte (Gewinne werden nie entzogen, nur markiert).
- Hat das Konto schon Zeiten: zusammenführen; die Versuchsgrenze darf dabei überschritten werden (Hinweis), die
  Gleichstand-Regel nach ``created_at`` bleibt.
- Der Gast bleibt als „verknüpft“ stehen; seine Einträge in „Am Start / Als Nächstes“ hängen am Konto.
- Unter einer Sperre und wiederholbar: ein zweites Verknüpfen mit demselben Konto ändert nichts.
"""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402

REASON = "Gast hat inzwischen ein Konto angelegt"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow, **challenge_extra):
    lead = await flow.add_staff()
    flow.act_as(lead)
    cid, tid = new_id(), new_id()
    await flow.db.f1_challenges.insert_one({"id": cid, "slug": f"fl-{cid[:8]}", "title": "Fast Lap", "status": "live",
                                            "visibility": "public", "unlimited_attempts": False, "max_attempts": 3, **challenge_extra})
    await flow.db.f1_tracks.insert_one({"id": tid, "challenge_id": cid, "name": "Teststrecke"})
    helper = await flow.add_user(name="zeitnehmer")
    await flow.db.f1_staff_assignments.insert_one({"id": new_id(), "challenge_id": cid, "user_id": helper["id"],
                                                   "role": "scorekeeper", "is_active": True})
    return cid, tid, lead, helper


async def add_guest(flow, cid, name="Anna"):
    response = await flow.post(f"/api/f1/challenges/{cid}/guests", json={"display_name": name})
    assert response.status_code == 200, response.text
    return response.json()


async def enter(flow, cid, tid, *, user=None, guest=None, time_ms=81000, **fields):
    who = {"user_id": user["id"]} if user else {"guest_id": guest["id"]}
    response = await flow.post(f"/api/f1/challenges/{cid}/times", json={**who, "track_id": tid, "time_ms": time_ms, **fields})
    assert response.status_code == 200, response.text
    return response.json()


async def link(flow, guest, user, **body):
    return await flow.post(f"/api/f1/guests/{guest['id']}/link", json={"user_id": user["id"], **body})


async def board(flow, cid, tid):
    response = await flow.get(f"/api/f1/challenges/{cid}/leaderboard", params={"track_id": tid})
    assert response.status_code == 200
    return response.json()


@pytest.mark.asyncio
async def test_preview_says_what_moves(flow):
    cid, tid, _lead, _helper = await setup(flow)
    guest = await add_guest(flow, cid, "Anna")
    account = await flow.add_user(name="anna-konto")
    await enter(flow, cid, tid, guest=guest)
    await enter(flow, cid, tid, guest=guest, time_ms=80000)
    await enter(flow, cid, tid, user=account, time_ms=82000)
    await enter(flow, cid, tid, user=account, time_ms=82500)
    response = await flow.get(f"/api/f1/guests/{guest['id']}/link-preview", params={"user_id": account["id"]})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["laps"] == 2 and data["account_laps"] == 2
    assert data["guest_name"] == "Anna" and data["account_name"] == "anna-konto"
    assert data["over_limit"] == [{"track_id": tid, "track_name": "Teststrecke", "attempts": 4, "max_attempts": 3}]
    assert await flow.db.f1_lap_times.count_documents({"guest_id": guest["id"], "user_id": None}) == 2


@pytest.mark.asyncio
async def test_linking_moves_every_time_to_the_account_and_keeps_the_guest_marked(flow):
    cid, tid, lead, _helper = await setup(flow)
    guest = await add_guest(flow, cid, "Anna")
    account = await flow.add_user(name="anna-konto")
    await enter(flow, cid, tid, guest=guest, time_ms=80000)
    await enter(flow, cid, tid, guest=guest, time_ms=0, is_invalid=True, admin_note="Strecke verlassen")
    response = await link(flow, guest, account)
    assert response.status_code == 200, response.text
    assert response.json()["laps_moved"] == 2
    assert await flow.db.f1_lap_times.count_documents({"challenge_id": cid, "user_id": account["id"]}) == 2
    assert await flow.db.f1_lap_times.count_documents({"challenge_id": cid, "user_id": None}) == 0
    row = await flow.db.f1_guests.find_one({"id": guest["id"]})
    assert row["linked_user_id"] == account["id"] and row["linked_by"] == lead["id"] and row["display_name"] == "Anna"
    entry = (await board(flow, cid, tid))["entries"][0]
    assert entry["user_id"] == account["id"] and entry["is_guest"] is False and entry["attempts"] == 2
    logs = await flow.db.audit_logs.find({"action": "fastlap.guest.link"}, {"_id": 0}).to_list(10)
    assert len(logs) == 1 and logs[0]["actor_id"] == lead["id"] and logs[0]["target_id"] == guest["id"]
    assert logs[0]["data"]["user_id"] == account["id"] and logs[0]["data"]["laps_moved"] == 2
    assert "Anna" not in str(logs[0]["data"]) and "anna-konto" not in str(logs[0]["data"])
    # Ein verknüpfter Gast fährt nicht mehr als Gast.
    response = await flow.post(f"/api/f1/challenges/{cid}/times", json={"guest_id": guest["id"], "track_id": tid, "time_ms": 81000})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_linking_twice_with_the_same_account_changes_nothing_another_account_is_refused(flow):
    cid, tid, _lead, _helper = await setup(flow)
    guest = await add_guest(flow, cid)
    account, other = await flow.add_user(name="konto"), await flow.add_user(name="anderes")
    await enter(flow, cid, tid, guest=guest)
    first = await link(flow, guest, account)
    again = await link(flow, guest, account)
    assert first.status_code == 200 and again.status_code == 200
    assert again.json()["laps_moved"] == 0 and again.json()["already_linked"] is True
    response = await link(flow, guest, other)
    assert response.status_code == 409
    assert await flow.db.audit_logs.count_documents({"action": "fastlap.guest.link"}) == 1


@pytest.mark.asyncio
async def test_two_parallel_links_move_once(flow):
    cid, tid, _lead, _helper = await setup(flow)
    guest = await add_guest(flow, cid)
    account = await flow.add_user(name="konto")
    await enter(flow, cid, tid, guest=guest)
    answers = await asyncio.gather(link(flow, guest, account), link(flow, guest, account))
    assert all(response.status_code in (200, 409) for response in answers)
    assert sum(response.json().get("laps_moved", 0) for response in answers if response.status_code == 200) == 1
    assert await flow.db.audit_logs.count_documents({"action": "fastlap.guest.link"}) == 1
    assert await flow.db.f1_lap_times.count_documents({"user_id": account["id"]}) == 1


@pytest.mark.asyncio
async def test_only_the_lead_links(flow):
    cid, tid, _lead, helper = await setup(flow)
    guest = await add_guest(flow, cid)
    account = await flow.add_user(name="konto")
    await enter(flow, cid, tid, guest=guest)
    flow.act_as(helper)
    response = await link(flow, guest, account)
    assert response.status_code == 403
    response = await flow.get(f"/api/f1/guests/{guest['id']}/link-preview", params={"user_id": account["id"]})
    assert response.status_code == 403
    assert await flow.db.f1_lap_times.count_documents({"user_id": None}) == 1


@pytest.mark.asyncio
async def test_an_unknown_account_is_refused(flow):
    cid, tid, _lead, _helper = await setup(flow)
    guest = await add_guest(flow, cid)
    await enter(flow, cid, tid, guest=guest)
    response = await flow.post(f"/api/f1/guests/{guest['id']}/link", json={"user_id": "gibt-es-nicht"})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_merging_keeps_the_tie_rule_and_may_pass_the_attempt_limit(flow):
    cid, tid, _lead, _helper = await setup(flow)
    guest = await add_guest(flow, cid)
    account, rival = await flow.add_user(name="konto"), await flow.add_user(name="rivale")
    await enter(flow, cid, tid, user=account, time_ms=80000)
    await enter(flow, cid, tid, user=rival, time_ms=79000)
    await enter(flow, cid, tid, guest=guest, time_ms=81000)
    await enter(flow, cid, tid, guest=guest, time_ms=79000)
    await enter(flow, cid, tid, guest=guest, time_ms=82000)
    response = await link(flow, guest, account)
    assert response.status_code == 200, response.text
    assert response.json()["over_limit"][0]["attempts"] == 4
    entries = (await board(flow, cid, tid))["entries"]
    # Rivale und Konto (über den Gast) gleich schnell - der Rivale fuhr die Zeit zuerst.
    assert [(row["user_id"], row["time_ms"], row["attempts"]) for row in entries] == [
        (rival["id"], 79000, 1), (account["id"], 79000, 4)]


@pytest.mark.asyncio
async def test_after_publishing_only_with_a_reason_and_the_account_gets_the_prize(flow):
    cid, tid, lead, _helper = await setup(flow, prize_places=[{"place": 1, "label": "1. Platz", "value": "Pokal"}])
    guest = await add_guest(flow, cid)
    account, runner_up = await flow.add_user(name="konto"), await flow.add_user(name="zweiter")
    await enter(flow, cid, tid, guest=guest, time_ms=70000)
    await enter(flow, cid, tid, user=runner_up, time_ms=80000)
    response = await flow.patch(f"/api/f1/challenges/{cid}", json={"status": "results_published"})
    assert response.status_code == 200, response.text
    pickups = await flow.db.prize_pickups.find({"fastlap_challenge_id": cid}, {"_id": 0}).to_list(10)
    assert [(row["user_id"], row["place"]) for row in pickups] == [(runner_up["id"], 1)]
    response = await link(flow, guest, account)
    assert response.status_code == 409
    assert await flow.db.f1_lap_times.count_documents({"user_id": account["id"]}) == 0
    response = await link(flow, guest, account, change_reason=REASON)
    assert response.status_code == 200, response.text
    pickups = {row["user_id"]: row for row in await flow.db.prize_pickups.find({"fastlap_challenge_id": cid}, {"_id": 0}).to_list(10)}
    assert pickups[account["id"]]["place"] == 1 and not pickups[account["id"]].get("needs_review")
    # Gewinne werden nie entzogen - der bisherige steht zur Prüfung.
    assert pickups[runner_up["id"]]["needs_review"] is True
    logs = await flow.db.audit_logs.find({"action": "fastlap.guest.link"}, {"_id": 0}).to_list(10)
    assert logs[0]["data"]["reason"] == REASON and logs[0]["data"]["after_publishing"] is True
    assert await flow.db.audit_logs.count_documents({"action": "fastlap.results.resync"}) == 1
    assert logs[0]["actor_id"] == lead["id"]


@pytest.mark.asyncio
async def test_the_guest_queue_entry_moves_to_the_account(flow):
    cid, tid, _lead, _helper = await setup(flow)
    guest = await add_guest(flow, cid)
    account = await flow.add_user(name="konto")
    response = await flow.post(f"/api/f1/challenges/{cid}/queue", json={"guest_id": guest["id"], "track_id": tid, "station": "Simulator 1"})
    assert response.status_code == 200
    response = await link(flow, guest, account)
    assert response.status_code == 200, response.text
    row = await flow.db.f1_queue.find_one({"challenge_id": cid})
    assert row["user_id"] == account["id"] and row["guest_id"] is None and row["station"] == "Simulator 1"


@pytest.mark.asyncio
async def test_a_duplicate_queue_entry_is_not_created(flow):
    cid, tid, _lead, _helper = await setup(flow)
    guest = await add_guest(flow, cid)
    account = await flow.add_user(name="konto")
    for who in ({"guest_id": guest["id"]}, {"user_id": account["id"]}):
        response = await flow.post(f"/api/f1/challenges/{cid}/queue", json={**who, "track_id": tid})
        assert response.status_code == 200
    response = await link(flow, guest, account)
    assert response.status_code == 200
    assert await flow.db.f1_queue.count_documents({"challenge_id": cid}) == 1


@pytest.mark.asyncio
async def test_linked_guests_are_marked_in_the_guest_list(flow):
    cid, tid, _lead, _helper = await setup(flow)
    guest = await add_guest(flow, cid)
    account = await flow.add_user(name="konto")
    response = await link(flow, guest, account)
    assert response.status_code == 200
    rows = (await flow.get(f"/api/f1/challenges/{cid}/guests")).json()
    assert rows[0]["linked_user_id"] == account["id"]


@pytest.mark.asyncio
async def test_a_club_member_account_gets_the_times_as_reference_when_members_are_excluded(flow):
    cid, tid, _lead, _helper = await setup(flow, block_club_member_results=True)
    guest = await add_guest(flow, cid)
    member = await flow.add_user(name="mitglied")
    await flow.db.memberships.insert_one({"id": new_id(), "user_id": member["id"], "member_status": "active"})
    await enter(flow, cid, tid, guest=guest, time_ms=80000)
    response = await link(flow, guest, member)
    assert response.status_code == 200, response.text
    lap = await flow.db.f1_lap_times.find_one({"user_id": member["id"]})
    assert lap["score_scope"] == "club_reference" and lap["moved_by_member_rule"] is True
    assert (await board(flow, cid, tid))["entries"] == []
