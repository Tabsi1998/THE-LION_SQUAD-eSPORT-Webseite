"""Teilnehmer am Event für Verwaltung und Vorstand (#397): dieselbe Route wie im Web, die Rechte
kommen vom Server - `participant_view` und `can_check_in` statt Rollen im Client."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def person(flow, name, *, role="player", member=False, **fields):
    user = await flow.add_user(role=role, name=name)
    fields = {"email": f"{name}@lionsquad-test.at", **fields}
    if member:
        await flow.db.memberships.insert_one({"id": f"m-{name}", "user_id": user["id"], "member_status": "active"})
        fields["is_club_member"] = True
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    return user


OFFER = {"enabled": True, "positions": [{"key": "beitrag", "label": "Kostenbeitrag", "amount": "20", "basis": "per_person"}]}


async def create_event(flow, admin, **extra):
    flow.act_as(admin)
    payload = {"name": "Vereinsabend", "status": "registration_open", "visibility": "members", "has_registration": True,
               "allow_companions": True, "max_companions_per_registration": 2, "show_participants": False,
               "start_date": (now_utc() + timedelta(days=10)).isoformat(), **extra}
    response = await flow.post("/api/events", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_board_sees_participants_without_money_and_only_tournament_staff_may_check_in(flow):
    kassier = await person(flow, "kassier", role="club_admin")
    event = await create_event(flow, kassier, billing=OFFER)
    paula = await person(flow, "paula", member=True, display_name="Paula B.")
    flow.act_as(paula)
    booked = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 1, "note": "komme später"})
    assert booked.status_code == 200, booked.text

    # Ein Mitglied ohne Bereich: keine Liste, weil das Event sie nicht zeigt; die eigene Anmeldung mit Preis.
    view = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert view["participant_view"] == "none" and view["can_check_in"] is False
    assert view["registrations"] == []
    assert view["own_registration"]["price"]["total_cents"] == 4000
    assert "payment_state" in view["own_registration"]["price"]

    # Der Vorstand (Bereich club per Freigabe) sieht Status, Begleitpersonen, Notiz und E-Mail - kein Geld, kein Check-in.
    vorstand = await person(flow, "vorstand", member=True, areas=["club"])
    flow.act_as(vorstand)
    view = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert view["participant_view"] == "staff" and view["can_check_in"] is False
    [entry] = view["registrations"]
    assert entry["display_name"] == "Paula B." and entry["status"] == "registered" and entry["companion_count"] == 1
    assert entry["note"] == "komme später" and entry["email"] == paula["email"]
    assert "price" not in entry, "der Vorstand sieht die Teilnehmer, aber kein Geld"
    denied = await flow.client.patch(f"/api/events/{event['id']}/registrations/{entry['id']}", json={"status": "checked_in"})
    assert denied.status_code == 403

    # Die Turnierleitung darf einchecken und sieht den eingefrorenen Preis wie bisher.
    leitung = await person(flow, "leitung", role="tournament_admin")
    flow.act_as(leitung)
    view = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert view["participant_view"] == "staff" and view["can_check_in"] is True
    assert view["registrations"][0]["price"]["total_cents"] == 4000
    checked = await flow.client.patch(f"/api/events/{event['id']}/registrations/{entry['id']}", json={"status": "checked_in"})
    assert checked.status_code == 200, checked.text
    assert checked.json()["status"] == "checked_in"

    # Wer Finanzen hat, aber keine Staff-Rolle, sieht Geld und Liste, darf aber nicht einchecken.
    finanzen = await person(flow, "finanzen", member=True, areas=["club", "finance"])
    flow.act_as(finanzen)
    view = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert view["can_check_in"] is False and view["registrations"][0]["price"]["total_cents"] == 4000


@pytest.mark.asyncio
async def test_public_list_stays_names_only(flow):
    admin = await person(flow, "admin", role="club_admin")
    event = await create_event(flow, admin, visibility="public", show_participants=True)
    gast = await person(flow, "gast", display_name="Gast G.")
    flow.act_as(gast)
    assert (await flow.post(f"/api/events/{event['id']}/registrations", json={"note": "geheim"})).status_code == 200
    andere = await person(flow, "andere")
    flow.act_as(andere)
    view = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert view["participant_view"] == "public" and view["can_check_in"] is False
    [entry] = view["registrations"]
    assert entry["display_name"] == "Gast G." and entry["seat_count"] == 1
    assert "note" not in entry and "email" not in entry and "price" not in entry
