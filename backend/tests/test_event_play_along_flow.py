"""„Spielst du auch mit?“ (#1184): nach der Event-Anmeldung meldet ein Schritt die Einzel-Turniere des Events in einem
Rutsch an. Jede Anmeldung läuft einzeln durch die normale Selbstanmeldung - dieselben Regeln (voll → Warteliste,
Event-Pflicht #875, Startgeld #319); die Summe ist die Summe der Rechnungsaufträge. Team-Turniere meldet der Kapitän auf
der Turnierseite an, Fast Laps brauchen keine Anmeldung. Ohne Konto gibt es den Schritt nicht."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from test_billing_invoice_terms_flow import person  # noqa: E402

FEE_10 = {"enabled": True, "positions": [{"key": "startgeld", "label": "Startgeld", "amount": "10", "basis": "per_person"}]}
FEE_5 = {"enabled": True, "positions": [{"key": "startgeld", "label": "Startgeld", "amount": "5", "basis": "per_person"}]}
ACCEPT = {"accept_rules": True, "accept_privacy": True, "accept_costs": True}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def lan_event(flow, admin, **extra):
    flow.act_as(admin)
    response = await flow.post("/api/events", json={"name": "Vereins-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
                                                    "start_date": (now_utc() + timedelta(days=20)).isoformat(), **extra})
    assert response.status_code == 200, response.text
    return response.json()


async def cup(flow, admin, event, title, **extra):
    flow.act_as(admin)
    if not await flow.db.games.find_one({"id": "g1"}):
        await flow.db.games.insert_one({"id": "g1", "name": "Rocket League", "slug": "rocket-league"})
    payload = {"title": title, "game_id": "g1", "status": "registration_open", "visibility": "public", "is_public": True, "format": "single_elim",
               "team_mode": "solo", "team_size": 1, "max_participants": 8, "start_date": (now_utc() + timedelta(days=20, hours=2)).isoformat(),
               **({"event_id": event["id"]} if event else {}), **extra}
    response = await flow.post("/api/tournaments", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


async def join_event(flow, user, event):
    flow.act_as(user)
    response = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})
    assert response.status_code == 200, response.text
    return response.json()


async def own_registrations(flow, user):
    return await flow.db.tournament_registrations.find({"user_id": user["id"]}, {"_id": 0}).to_list(50)


async def own_orders(flow, user):
    return await flow.db.billing_orders.find({"user_id": user["id"], "kind": "tournament"}, {"_id": 0}).to_list(50)


def by_id(rows, key="id"):
    return {row[key]: row for row in rows}


@pytest.mark.asyncio
async def test_several_registrations_in_one_step_with_waitlist_event_gate_and_fees(flow):
    admin = await person(flow, "chef", role="superadmin")
    event = await lan_event(flow, admin)
    gated = await cup(flow, admin, event, "LAN-Cup", billing=FEE_10, requires_event_registration=True)
    full = await cup(flow, admin, event, "Mini-Cup", max_participants=1)
    cheap = await cup(flow, admin, event, "Fun-Cup", billing=FEE_5)
    team_cup = await cup(flow, admin, event, "Team-Cup", team_mode="team", team_size=2)
    early = await person(flow, "frueh")
    flow.act_as(early)
    assert (await flow.post(f"/api/tournaments/{full['id']}/register", json={"accept_rules": True, "accept_privacy": True})).status_code == 200

    paula = await person(flow, "paula")
    await join_event(flow, paula, event)
    flow.act_as(paula)
    options = await flow.get(f"/api/events/{event['id']}/play-along")
    assert options.status_code == 200, options.text
    data = options.json()
    assert data["show"] is True
    entries = by_id(data["entries"])
    assert entries[gated["id"]]["selectable"] is True and entries[gated["id"]]["fee"] == {"total_cents": 1000, "currency": "EUR"}
    assert entries[gated["id"]]["mode"] == "Einzel" and entries[gated["id"]]["game"] == "Rocket League"
    assert entries[full["id"]]["selectable"] is True and entries[full["id"]]["full"] is True and entries[full["id"]]["spots_left"] == 0
    assert entries[cheap["id"]]["fee"]["total_cents"] == 500 and entries[cheap["id"]]["spots_left"] == 8
    assert entries[team_cup["id"]]["selectable"] is False and entries[team_cup["id"]]["team"] is True
    assert entries[team_cup["id"]]["reason"] == "Dein Kapitän meldet das Team an." and entries[team_cup["id"]]["captain"] is False

    response = await flow.post(f"/api/events/{event['id']}/play-along",
                               json={**ACCEPT, "tournament_ids": [gated["id"], full["id"], cheap["id"], team_cup["id"]]})
    assert response.status_code == 200, response.text
    result = response.json()
    rows = by_id(result["results"])
    assert [row["id"] for row in result["results"]] == [gated["id"], full["id"], cheap["id"], team_cup["id"]]
    assert rows[gated["id"]]["state"] == "registered" and rows[gated["id"]]["price"]["total_cents"] == 1000
    assert rows[full["id"]]["state"] == "waitlist" and rows[full["id"]]["price"] is None
    assert rows[cheap["id"]]["state"] == "registered" and rows[cheap["id"]]["price"]["total_cents"] == 500
    assert rows[team_cup["id"]]["state"] == "error" and "Kapitän" in rows[team_cup["id"]]["detail"]

    registrations = by_id(await own_registrations(flow, paula), "tournament_id")
    assert set(registrations) == {gated["id"], full["id"], cheap["id"]}, "das Team-Turnier wird nicht angemeldet"
    assert registrations[full["id"]]["status"] == "waitlist"
    assert all(reg["registered_via"] == "event" for reg in registrations.values())
    orders = await own_orders(flow, paula)
    assert result["total_cents"] == 1500 == sum(order["total_cents"] for order in orders)
    assert result["currency"] == "EUR" and len(orders) == 2, "Warteliste zahlt erst beim Nachrücken"

    flow.act_as(paula)
    after = by_id((await flow.get(f"/api/events/{event['id']}/play-along")).json()["entries"])
    assert after[gated["id"]]["selectable"] is False and after[gated["id"]]["my_status"]["state"] == "approved"


@pytest.mark.asyncio
async def test_event_gate_applies_per_entry_and_waitlist_at_the_event_does_not_count(flow):
    admin = await person(flow, "chef", role="superadmin")
    event = await lan_event(flow, admin, max_participants=1)
    gated = await cup(flow, admin, event, "LAN-Cup", requires_event_registration=True)
    open_cup = await cup(flow, admin, event, "Offen-Cup")
    await join_event(flow, await person(flow, "erste"), event)
    late = await person(flow, "spaet")
    assert (await join_event(flow, late, event))["status"] == "waitlist"

    flow.act_as(late)
    entries = by_id((await flow.get(f"/api/events/{event['id']}/play-along")).json()["entries"])
    assert entries[gated["id"]]["selectable"] is False
    assert entries[gated["id"]]["reason"] == "Für dieses Turnier musst du zuerst beim Event „Vereins-LAN“ angemeldet sein."
    assert entries[open_cup["id"]]["selectable"] is True

    result = (await flow.post(f"/api/events/{event['id']}/play-along", json={**ACCEPT, "tournament_ids": [gated["id"], open_cup["id"]]})).json()
    rows = by_id(result["results"])
    assert rows[gated["id"]]["state"] == "error" and rows[gated["id"]]["detail"] == entries[gated["id"]]["reason"]
    assert rows[open_cup["id"]]["state"] == "registered"
    assert {reg["tournament_id"] for reg in await own_registrations(flow, late)} == {open_cup["id"]}


@pytest.mark.asyncio
async def test_a_repeated_request_creates_nothing_twice(flow):
    admin = await person(flow, "chef", role="superadmin")
    event = await lan_event(flow, admin)
    paid = await cup(flow, admin, event, "LAN-Cup", billing=FEE_10)
    free = await cup(flow, admin, event, "Fun-Cup")
    paula = await person(flow, "paula")
    await join_event(flow, paula, event)
    flow.act_as(paula)
    body = {**ACCEPT, "tournament_ids": [paid["id"], free["id"], paid["id"]]}

    first = (await flow.post(f"/api/events/{event['id']}/play-along", json=body)).json()
    assert [row["state"] for row in first["results"]] == ["registered", "registered"], "doppelte Haken zählen einmal"
    second = (await flow.post(f"/api/events/{event['id']}/play-along", json=body)).json()
    assert [row["state"] for row in second["results"]] == ["already", "already"]
    assert second["total_cents"] == 0, "nichts Neues, nichts zu zahlen"
    assert len(await own_registrations(flow, paula)) == 2
    assert len(await own_orders(flow, paula)) == 1


@pytest.mark.asyncio
async def test_guests_without_account_get_401(flow):
    admin = await person(flow, "chef", role="superadmin")
    event = await lan_event(flow, admin)
    tournament = await cup(flow, admin, event, "LAN-Cup")
    flow.act_as(None)
    assert (await flow.get(f"/api/events/{event['id']}/play-along")).status_code == 401
    refused = await flow.post(f"/api/events/{event['id']}/play-along", json={**ACCEPT, "tournament_ids": [tournament["id"]]})
    assert refused.status_code == 401
    assert await flow.db.tournament_registrations.count_documents({}) == 0


@pytest.mark.asyncio
async def test_only_tournaments_of_this_event_and_rules_must_be_accepted(flow):
    admin = await person(flow, "chef", role="superadmin")
    event = await lan_event(flow, admin)
    other = await lan_event(flow, admin, name="Anderes Event")
    elsewhere = await cup(flow, admin, other, "Fremd-Cup")
    own = await cup(flow, admin, event, "LAN-Cup")
    paula = await person(flow, "paula")
    await join_event(flow, paula, event)
    flow.act_as(paula)

    refused = await flow.post(f"/api/events/{event['id']}/play-along", json={"tournament_ids": [own["id"]], "accept_rules": False, "accept_privacy": True})
    assert refused.status_code == 400 and "Regeln" in refused.json()["detail"]
    result = (await flow.post(f"/api/events/{event['id']}/play-along", json={**ACCEPT, "tournament_ids": [elsewhere["id"], "gibt-es-nicht", own["id"]]})).json()
    states = [(row["id"], row["state"]) for row in result["results"]]
    assert states == [(elsewhere["id"], "error"), ("gibt-es-nicht", "error"), (own["id"], "registered")]
    assert result["results"][0]["detail"] == "Dieses Turnier gehört nicht zu diesem Event."
    assert {reg["tournament_id"] for reg in await own_registrations(flow, paula)} == {own["id"]}


@pytest.mark.asyncio
async def test_costs_must_be_accepted_like_on_the_tournament_page(flow):
    admin = await person(flow, "chef", role="superadmin")
    event = await lan_event(flow, admin)
    paid = await cup(flow, admin, event, "LAN-Cup", billing=FEE_10)
    paula = await person(flow, "paula")
    await join_event(flow, paula, event)
    flow.act_as(paula)
    result = (await flow.post(f"/api/events/{event['id']}/play-along", json={**ACCEPT, "accept_costs": False, "tournament_ids": [paid["id"]]})).json()
    assert result["results"][0]["state"] == "error" and "Startgeld" in result["results"][0]["detail"]
    assert result["total_cents"] == 0 and not await own_registrations(flow, paula)


@pytest.mark.asyncio
async def test_step_only_with_tournaments_or_fast_laps_and_captains_get_the_team_link(flow):
    admin = await person(flow, "chef", role="superadmin")
    empty = await lan_event(flow, admin, name="Nur Treffen")
    paula = await person(flow, "paula")
    await join_event(flow, paula, empty)
    flow.act_as(paula)
    assert (await flow.get(f"/api/events/{empty['id']}/play-along")).json() == {"show": False, "entries": []}

    event = await lan_event(flow, admin)
    await flow.db.f1_challenges.insert_one({"id": "fl-1", "slug": "lan-fast-lap", "title": "LAN Fast Lap", "status": "active", "visibility": "public",
                                            "event_id": event["id"], "start_date": (now_utc() + timedelta(days=20)).isoformat()})
    await flow.db.f1_challenges.insert_one({"id": "fl-old", "slug": "alt", "title": "Alte Fast Lap", "status": "completed", "visibility": "public",
                                            "event_id": event["id"]})
    flow.act_as(paula)
    data = (await flow.get(f"/api/events/{event['id']}/play-along")).json()
    assert data["show"] is True
    assert [(row["kind"], row["id"], row["selectable"]) for row in data["entries"]] == [("fastlap", "fl-1", False)]
    assert data["entries"][0]["mode"] == "Bestzeit fahren" and "Keine Anmeldung" in data["entries"][0]["reason"]

    team_cup = await cup(flow, admin, event, "Team-Cup", team_mode="team", team_size=2)
    await flow.db.teams.insert_one({"id": "team-1", "name": "Lions", "leader_id": paula["id"], "co_leader_ids": [], "member_ids": [paula["id"]]})
    flow.act_as(paula)
    entries = by_id((await flow.get(f"/api/events/{event['id']}/play-along")).json()["entries"])
    assert entries[team_cup["id"]]["captain"] is True
    assert entries[team_cup["id"]]["reason"] == "Melde dein Team auf der Turnierseite an."
