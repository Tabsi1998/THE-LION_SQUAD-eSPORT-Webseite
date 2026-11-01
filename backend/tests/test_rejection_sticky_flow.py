"""Eine Ablehnung bleibt (#2113): „Anmeldung entfernen“ nimmt sie nur aus der Ansicht der Person. Eine neue Anmeldung füllt
denselben Eintrag und geht als „ausstehend“ zur Turnierleitung - auch wenn das Turnier voll ist; sie gilt nie von selbst.
Die Leitung löscht weiter echt. Erfundene Konten, keine echten Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

BODY = {"accept_rules": True, "accept_privacy": True}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "rejection-sticky-flow-secret-with-at-least-32-chars")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _rejected_solo(flow, **fields):
    tournament = await flow.create_tournament(**fields)
    player = await flow.add_user(name=f"spieler-{new_id()[:6]}")
    registration = await flow.register(tournament, player, status="rejected")
    flow.act_as(player)
    return tournament, registration, player


async def _stored(flow, registration):
    return await flow.db.tournament_registrations.find_one({"id": registration["id"]}, {"_id": 0})


async def _mine(flow, tournament):
    rows = (await flow.get(f"/api/tournaments/{tournament['id']}/registrations")).json()
    return [row["id"] for row in rows]


@pytest.mark.asyncio
async def test_without_removing_a_new_registration_returns_the_old_one(flow):
    tournament, registration, _player = await _rejected_solo(flow)
    replay = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=BODY)
    assert replay.status_code == 200 and replay.json()["status"] == "rejected" and replay.json()["idempotent_replay"] is True
    assert replay.json()["id"] == registration["id"]


@pytest.mark.asyncio
async def test_removing_keeps_the_entry_hidden_and_a_new_registration_goes_to_review(flow):
    staff = await flow.add_staff()
    tournament, registration, player = await _rejected_solo(flow)
    removed = await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}")
    assert removed.status_code == 200, removed.text
    stored = await _stored(flow, registration)
    assert stored["status"] == "rejected" and stored["rejection_dismissed_at"]
    # Die Person sieht wieder „Anmelden“, die Leitung sieht den Eintrag weiter.
    assert await _mine(flow, tournament) == []
    flow.act_as(staff)
    assert await _mine(flow, tournament) == [registration["id"]]

    flow.act_as(player)
    fresh = await flow.post(f"/api/tournaments/{tournament['id']}/register", json={**BODY, "ingame_name": "Neuer Versuch"})
    assert fresh.status_code == 200, fresh.text
    body = fresh.json()
    assert body["id"] == registration["id"] and body["status"] == "pending" and body["idempotent_replay"] is False
    assert "reopened_after_rejection" in body
    stored = await _stored(flow, registration)
    assert stored["status"] == "pending" and stored["ingame_name"] == "Neuer Versuch" and "rejection_dismissed_at" not in stored
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": tournament["id"]}) == 1
    assert await _mine(flow, tournament) == [registration["id"]]
    # Bestätigung „eingegangen“ an die Person, Nachricht an die Leitung zum Prüfen.
    received = await flow.db.notifications.find_one({"user_id": player["id"], "meta.status": "pending"})
    assert received and "eingegangen" in received["title"]
    notice = await flow.db.notifications.find_one({"user_id": staff["id"], "title": {"$regex": "Anmeldung prüfen"}})
    assert notice and notice["url"] == f"/admin/tournaments/{tournament['id']}"


@pytest.mark.asyncio
async def test_full_tournament_still_goes_to_review_not_to_the_waitlist(flow):
    """Die Warteliste rückte von selbst auf „bestätigt“ nach - das wäre die Umgehung auf einem zweiten Weg."""
    tournament, registration, _player = await _rejected_solo(flow, max_participants=1)
    other = await flow.add_user(name=f"andere-{new_id()[:6]}")
    await flow.register(tournament, other)
    await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}")
    fresh = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=BODY)
    assert fresh.json()["status"] == "pending"


@pytest.mark.asyncio
async def test_team_registration_goes_the_same_way(flow):
    tournament = await flow.create_tournament(team_mode="team", team_size=2)
    leader = await flow.add_user(name=f"kapitaen-{new_id()[:6]}")
    team_id = new_id()
    await flow.db.teams.insert_one({"id": team_id, "name": "Rudel", "tag": "RDL", "leader_id": leader["id"], "co_leader_ids": [], "member_ids": [leader["id"]]})
    registration = {"id": new_id(), "tournament_id": tournament["id"], "user_id": None, "team_id": team_id, "status": "rejected",
                    "registration_type": "team", "display_name": "[RDL] Rudel", "identity_key": f"{tournament['id']}:team:{team_id}"}
    await flow.db.tournament_registrations.insert_one(dict(registration))
    flow.act_as(leader)
    # Solange die Ablehnung steht, ist das Team „bereits angemeldet“.
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/register", json={**BODY, "team_id": team_id})).status_code == 409
    deleted = await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}")
    assert deleted.status_code == 200
    assert await _mine(flow, tournament) == []
    fresh = await flow.post(f"/api/tournaments/{tournament['id']}/register", json={**BODY, "team_id": team_id})
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["id"] == registration["id"] and fresh.json()["status"] == "pending"
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": tournament["id"]}) == 1


@pytest.mark.asyncio
async def test_staff_still_delete_for_real(flow):
    staff = await flow.add_staff()
    tournament, registration, _player = await _rejected_solo(flow)
    flow.act_as(staff)
    deleted = await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}")
    assert deleted.status_code == 200
    assert await _stored(flow, registration) is None


@pytest.mark.asyncio
async def test_staff_approving_a_dismissed_entry_shows_it_again(flow):
    staff = await flow.add_staff()
    tournament, registration, player = await _rejected_solo(flow)
    await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}")
    flow.act_as(staff)
    approved = await flow.patch(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}", json={"status": "approved"})
    assert approved.status_code == 200, approved.text
    flow.act_as(player)
    assert await _mine(flow, tournament) == [registration["id"]]


@pytest.mark.asyncio
async def test_paid_tournament_bills_only_after_the_new_approval(flow):
    staff = await flow.add_staff()
    billing = {"enabled": True, "currency": "EUR", "version": 1,
               "positions": [{"key": "start", "label": "Startgeld", "amount_cents": 1000, "basis": "per_person", "tax_profile": "none"}]}
    tournament, registration, player = await _rejected_solo(flow, billing=billing)
    await flow.db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"price_snapshot": {"total_cents": 500}, "billing_status": "cancelled"}})
    await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}")
    missing = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=BODY)
    assert missing.status_code == 400 and "Startgeld" in missing.json()["detail"]
    fresh = await flow.post(f"/api/tournaments/{tournament['id']}/register", json={**BODY, "accept_costs": True})
    assert fresh.json()["status"] == "pending"
    stored = await _stored(flow, registration)
    assert "price_snapshot" not in stored and "billing_status" not in stored
    assert await flow.db.billing_orders.count_documents({"registration_id": registration["id"]}) == 0
    flow.act_as(staff)
    assert (await flow.patch(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}", json={"status": "approved"})).status_code == 200
    assert await flow.db.billing_orders.count_documents({"registration_id": registration["id"], "status": {"$ne": "cancelled"}, "user_id": player["id"]}) == 1


@pytest.mark.asyncio
async def test_the_mark_only_counts_on_a_rejected_entry(flow):
    from services import tournament_guard

    assert tournament_guard.rejection_dismissed({"status": "rejected", "rejection_dismissed_at": "2026-11-01"})
    assert not tournament_guard.rejection_dismissed({"status": "rejected"})
    assert not tournament_guard.rejection_dismissed({"status": "approved", "rejection_dismissed_at": "2026-11-01"})
    assert not tournament_guard.rejection_dismissed(None)


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ["status", "checkin"])
async def test_a_second_rejection_is_seen_again(flow, route):
    """Die Marke gilt nur für die Ablehnung, die weggenommen wurde - eine spätere muss die Person wieder sehen."""
    staff = await flow.add_staff()
    tournament, registration, player = await _rejected_solo(flow)
    await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}")
    flow.act_as(staff)
    path = f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}"
    moved = await (flow.patch(path, json={"status": "approved"}) if route == "status" else flow.post(f"{path}/checkin", json={"status": "approved"}))
    assert moved.status_code == 200, moved.text
    assert "rejection_dismissed_at" not in await _stored(flow, registration)
    again = await flow.patch(path, json={"status": "rejected"})
    assert again.status_code == 200, again.text
    flow.act_as(player)
    assert await _mine(flow, tournament) == [registration["id"]]


@pytest.mark.asyncio
async def test_public_profile_counts_no_rejected_registration(flow):
    """Eine Ablehnung ist keine Teilnahme - auch nicht, nachdem die Person sie aus ihrer Ansicht genommen hat."""
    tournament, registration, player = await _rejected_solo(flow)
    await flow.db.users.update_one({"id": player["id"]}, {"$set": {"privacy_public_profile": True}})
    played = await flow.create_tournament(title="Gespielt")
    await flow.register(played, player)
    await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}")
    flow.act_as(None)
    profile = (await flow.get(f"/api/users/public/{player['username']}")).json()
    assert [row["id"] for row in profile["tournaments"]] == [played["id"]]
    assert profile["stats"]["tournaments"] == 1


@pytest.mark.asyncio
async def test_discord_does_not_call_a_dismissed_team_registered(flow):
    from services import discord_registration

    tournament = await flow.create_tournament(team_mode="team", team_size=2)
    leader = await flow.add_user(name=f"kapitaen-{new_id()[:6]}")
    team_id = new_id()
    await flow.db.teams.insert_one({"id": team_id, "name": "Rudel", "tag": "RDL", "leader_id": leader["id"], "co_leader_ids": [], "member_ids": [leader["id"]]})
    registration = {"id": new_id(), "tournament_id": tournament["id"], "user_id": None, "team_id": team_id, "status": "rejected",
                    "registration_type": "team", "display_name": "[RDL] Rudel"}
    await flow.db.tournament_registrations.insert_one(dict(registration))
    team, reason = await discord_registration._captain_team(flow.db, leader, tournament)
    assert team is None and "schon angemeldet" in reason
    await flow.db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"rejection_dismissed_at": "2026-11-01T10:00:00+00:00"}})
    team, reason = await discord_registration._captain_team(flow.db, leader, tournament)
    assert team["id"] == team_id and reason is None
