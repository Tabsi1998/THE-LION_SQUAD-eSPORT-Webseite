"""Startgelder für Turniere (#319): Solo und Team über dasselbe Preismodell und denselben
Rechnungsweg wie Events - Zahlungspflichtig ist, wer anmeldet; verbindlich heißt freigegeben."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import billing_orders, dolibarr_client  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    return instance


async def person(flow, name, *, role="player", **fields):
    user = await flow.add_user(role=role, name=name)
    fields.setdefault("email", f"{name}@example.test")
    fields.setdefault("display_name", name.capitalize())
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    return user


FEE = {"enabled": True, "positions": [{"key": "startgeld", "label": "Startgeld", "amount": "10", "basis": "per_person"}]}


async def tournament(flow, admin, *, team_mode="solo", team_size=1, billing=None, max_participants=32, **extra):
    flow.act_as(admin)
    if not await flow.db.games.find_one({"id": "g1"}):
        await flow.db.games.insert_one({"id": "g1", "name": "Rocket League", "slug": "rocket-league"})
    payload = {"title": "Herbst-Cup", "game_id": "g1", "status": "registration_open", "visibility": "public", "is_public": True, "format": "single_elim",
               "team_mode": team_mode, "team_size": team_size, "max_participants": max_participants,
               "start_date": (now_utc() + timedelta(days=10)).isoformat(), **extra}
    if billing is not None:
        payload["billing"] = billing
    response = await flow.post("/api/tournaments", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


async def register(flow, user, tournament_id, **body):
    flow.act_as(user)
    return await flow.post(f"/api/tournaments/{tournament_id}/register", json={"accept_rules": True, "accept_privacy": True, **body})


@pytest.mark.asyncio
async def test_solo_fee_needs_cost_acceptance_and_freezes_on_approval(flow):
    kassier = await person(flow, "kassier", role="club_admin")
    t = await tournament(flow, kassier, billing=FEE)
    assert t["offer"]["positions"][0]["amount_cents"] == 1000
    paula = await person(flow, "paula")

    refused = await register(flow, paula, t["id"])
    assert refused.status_code == 400 and "Startgeld" in refused.json()["detail"]
    booked = await register(flow, paula, t["id"], accept_costs=True)
    assert booked.status_code == 200, booked.text
    assert booked.json()["status"] == "approved" and booked.json()["price_snapshot"]["total_cents"] == 1000
    order = await flow.db.billing_orders.find_one({"kind": "tournament"}, {"_id": 0})
    assert order["user_id"] == paula["id"] and order["total_cents"] == 1000 and order["status"] == "pending"

    flow.act_as(paula)
    view = (await flow.get(f"/api/tournaments/{t['slug']}")).json()
    assert "billing" not in view and view["offer"]["enabled"] is True
    own = next(r for r in (await flow.get(f"/api/tournaments/{t['id']}/bracket")).json()["registrations"] if r.get("user_id") == paula["id"])
    assert own["price"]["total_cents"] == 1000 and own["price"]["payer_user_id"] == paula["id"]
    other = await person(flow, "zuschauer")
    flow.act_as(other)
    rows = (await flow.get(f"/api/tournaments/{t['id']}/bracket")).json()["registrations"]
    assert all("price" not in r for r in rows), "fremde Anmeldungen zeigen kein Geld"

    # Abmeldung vor dem Beleg: Auftrag zu.
    flow.act_as(paula)
    assert (await flow.client.delete(f"/api/tournaments/{t['id']}/registrations/{booked.json()['id']}")).status_code == 200
    assert (await flow.db.billing_orders.find_one({"kind": "tournament"}, {"_id": 0}))["status"] == "cancelled"


@pytest.mark.asyncio
async def test_team_fee_per_person_counts_the_roster_and_bills_the_leader(flow):
    kassier = await person(flow, "kassier", role="club_admin")
    t = await tournament(flow, kassier, team_mode="team", team_size=5, billing=FEE)
    leader = await person(flow, "captain")
    mate = await person(flow, "mate")
    await flow.db.teams.insert_one({"id": "team-1", "name": "Lions", "tag": "TLS", "leader_id": leader["id"], "co_leader_ids": [], "member_ids": [leader["id"], mate["id"]]})

    denied = await register(flow, mate, t["id"], team_id="team-1", accept_costs=True)
    assert denied.status_code == 403, "nur die Teamleitung meldet an - und übernimmt die Kosten"
    booked = await register(flow, leader, t["id"], team_id="team-1", accept_costs=True)
    assert booked.status_code == 200, booked.text
    snapshot = booked.json()["price_snapshot"]
    assert snapshot["total_cents"] == 5000, "je Person mal Teamgröße, weil noch kein Roster feststeht"
    assert snapshot["recipient"]["user_id"] == leader["id"] and snapshot["source"]["team_id"] == "team-1"

    # Mit Roster zählt der Roster - Ersatzspieler nur, wenn eingestellt.
    from services import tournament_fees
    reg = {"registration_type": "team", "roster": [{"user_id": "a"}, {"user_id": "b"}, {"user_id": "c", "substitute": True}]}
    assert tournament_fees.roster_size(reg, {"team_size": 5}, {"count_substitutes": False}) == 2
    assert tournament_fees.roster_size(reg, {"team_size": 5}, {"count_substitutes": True}) == 3
    assert tournament_fees.roster_size({"registration_type": "solo"}, {"team_size": 5}, {}) == 1


@pytest.mark.asyncio
async def test_waitlist_pays_on_approval_and_rejection_closes_the_order(flow):
    kassier = await person(flow, "kassier", role="club_admin")
    t = await tournament(flow, kassier, billing=FEE, max_participants=1)
    first = await person(flow, "erste")
    second = await person(flow, "zweite")
    assert (await register(flow, first, t["id"], accept_costs=True)).json()["status"] == "approved"
    waiting = (await register(flow, second, t["id"], accept_costs=True)).json()
    assert waiting["status"] == "waitlist" and "price_snapshot" not in waiting
    assert await flow.db.billing_orders.count_documents({"kind": "tournament"}) == 1

    flow.act_as(kassier)
    approved = await flow.put(f"/api/tournaments/{t['id']}/registrations/{waiting['id']}", json={"status": "approved"})
    assert approved.status_code == 200 and approved.json()["price_snapshot"]["total_cents"] == 1000
    assert await flow.db.billing_orders.count_documents({"kind": "tournament", "status": "pending"}) == 2

    rejected = await flow.put(f"/api/tournaments/{t['id']}/registrations/{waiting['id']}", json={"status": "rejected"})
    assert rejected.status_code == 200
    order = await flow.db.billing_orders.find_one({"registration_id": waiting["id"]}, {"_id": 0})
    assert order["status"] == "cancelled"
    assert (await flow.db.tournament_registrations.find_one({"id": waiting["id"]}, {"_id": 0}))["billing_status"] == "cancelled"


@pytest.mark.asyncio
async def test_fee_included_in_event_is_not_charged_twice(flow):
    kassier = await person(flow, "kassier", role="club_admin")
    await flow.db.events.insert_one({"id": "e1", "slug": "lan", "name": "LAN", "status": "registration_open", "visibility": "public"})
    t = await tournament(flow, kassier, billing={**FEE, "included_in_event": True}, event_id="e1")
    assert t["offer"] is None, "im Eventbeitrag enthalten - nichts zu zahlen"
    paula = await person(flow, "paula")
    booked = await register(flow, paula, t["id"])
    assert booked.status_code == 200 and "price_snapshot" not in booked.json()
    assert await flow.db.billing_orders.count_documents({}) == 0

    turnierleitung = await person(flow, "tl", role="tournament_admin")
    flow.act_as(turnierleitung)
    assert (await flow.put(f"/api/tournaments/{t['id']}", json={"billing": FEE})).status_code == 403, "Kosten pflegt nur Finanzen"


@pytest.mark.asyncio
async def test_tournament_fee_becomes_a_dolibarr_invoice(flow, fake):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {"id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL,
                                                                    "api_key": encrypt_secret(API_KEY), "instance": "verein", "entity": 1, "write_enabled": True}}, upsert=True)
    kassier = await person(flow, "kassier", role="club_admin")
    t = await tournament(flow, kassier, billing=FEE)
    gast = await person(flow, "gast")
    booked = (await register(flow, gast, t["id"], accept_costs=True)).json()
    assert (await billing_orders.classify_due())["invoiced"] == 1
    order = await flow.db.billing_orders.find_one({"kind": "tournament"}, {"_id": 0})
    invoice = fake.core_invoices[order["invoice_id"]]
    assert invoice["note_public"].startswith("Anmeldung: Startgeld Herbst-Cup")
    reg = await flow.db.tournament_registrations.find_one({"id": booked["id"]}, {"_id": 0})
    assert reg["billing_status"] == "invoiced" and reg["invoice_ref"] == invoice["ref"]
    flow.act_as(kassier)
    overview = (await flow.get("/api/admin/finance/overview")).json()
    assert overview["invoiced"][0]["source"] == {"name": "Startgeld Herbst-Cup", "slug": t["slug"], "kind": "tournament"}
