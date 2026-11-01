"""Die eigene Event-Anmeldung ändern (#2113, L-A3): Begleitpersonen und Hinweis selbst ändern - bisher ging das nur über
Stornieren und neu anmelden. Dieselbe Frist wie beim Stornieren (bis zum Beginn, nicht nach dem Check-in), mehr
Begleitpersonen nur mit freien Plätzen, bei Kosten ein neuer Preis, solange noch keine Rechnung erstellt ist. Die
interne Notiz der Turnierleitung sieht die Person nicht. Erfundene Konten, keine echten Personen."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402

OFFER = {"enabled": True, "positions": [{"key": "beitrag", "label": "Kostenbeitrag", "amount": "20", "basis": "per_person"}]}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup_event(flow, *, companions=0, **extra):
    boss = await flow.add_user(role="superadmin", name="chefin")
    flow.act_as(boss)
    payload = {"name": "Herbst-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
               "allow_companions": True, "max_companions_per_registration": 3,
               "start_date": (now_utc() + timedelta(days=10)).isoformat(), "location": "Vereinsheim", **extra}
    response = await flow.post("/api/events", json=payload)
    assert response.status_code == 200, response.text
    event = response.json()
    paula = await flow.add_user(role="player", name="paula")
    flow.act_as(paula)
    registered = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": companions, "note": "komme mit dem Zug"})
    assert registered.status_code == 200, registered.text
    return event, paula


async def stored(flow, event):
    return await flow.db.event_registrations.find_one({"event_id": event["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_own_registration_changes_companions_and_note(flow):
    event, _paula = await setup_event(flow)
    page = (await flow.get(f"/api/events/{event['slug']}")).json()["own_registration"]
    assert page["can_edit"] is True and page["note"] == "komme mit dem Zug"

    response = await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"companion_count": 2, "note": "  komme später  "})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["companion_count"] == 2 and body["seat_count"] == 3 and body["note"] == "komme später"
    row = await stored(flow, event)
    assert row["companion_count"] == 2 and row["seat_count"] == 3 and row["status"] == "registered"
    audit = await flow.db.audit_logs.find_one({"action": "event.registration.self_update"}, {"_id": 0})
    assert audit["data"]["fields"] == ["companion_count", "note", "seat_count"]

    cleared = await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"note": ""})
    assert cleared.status_code == 200 and (await stored(flow, event))["note"] is None


@pytest.mark.asyncio
async def test_status_and_internal_note_stay_with_the_staff(flow):
    event, _paula = await setup_event(flow)
    await flow.db.event_registrations.update_one({"event_id": event["id"]}, {"$set": {"internal_note": "nur intern"}})
    refused = await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"status": "checked_in"})
    assert refused.status_code == 422
    page = (await flow.get(f"/api/events/{event['slug']}")).json()["own_registration"]
    assert "internal_note" not in page
    own = (await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"note": "neu"})).json()
    assert "internal_note" not in own


@pytest.mark.asyncio
async def test_more_companions_need_free_seats(flow):
    event, _paula = await setup_event(flow, max_participants=3)
    full = await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"companion_count": 3})
    assert full.status_code == 409
    assert "kein Platz" in full.json()["detail"]
    assert (await stored(flow, event))["companion_count"] == 0
    assert (await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"companion_count": 2})).status_code == 200


@pytest.mark.asyncio
async def test_companions_off_or_over_the_limit_are_refused(flow):
    event, _paula = await setup_event(flow)
    over = await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"companion_count": 4})
    assert over.status_code == 400 and "Maximal 3" in over.json()["detail"]


@pytest.mark.asyncio
async def test_after_the_start_or_check_in_only_the_staff_changes(flow):
    event, _paula = await setup_event(flow)
    await flow.db.event_registrations.update_one({"event_id": event["id"]}, {"$set": {"status": "checked_in"}})
    checked_in = await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"note": "x"})
    assert checked_in.status_code == 409 and "eingecheckt" in checked_in.json()["detail"]
    await flow.db.event_registrations.update_one({"event_id": event["id"]}, {"$set": {"status": "registered"}})
    await flow.db.events.update_one({"id": event["id"]}, {"$set": {"start_date": (now_utc() - timedelta(hours=1)).isoformat()}})
    assert (await flow.get(f"/api/events/{event['slug']}")).json()["own_registration"]["can_edit"] is False
    started = await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"note": "x"})
    assert started.status_code == 409 and "begonnen" in started.json()["detail"]
    assert (await stored(flow, event))["note"] == "komme mit dem Zug"


@pytest.mark.asyncio
async def test_without_registration_nothing_to_change(flow):
    event, _paula = await setup_event(flow)
    stranger = await flow.add_user(role="player", name="otto")
    flow.act_as(stranger)
    assert (await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"note": "x"})).status_code == 404


@pytest.mark.asyncio
async def test_paid_event_requotes_before_the_invoice_and_refuses_after(flow):
    event, paula = await setup_event(flow, billing=OFFER)
    first = await stored(flow, event)
    assert first["price_snapshot"]["total_cents"] == 2000

    flow.act_as(paula)
    more = await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"companion_count": 1})
    assert more.status_code == 200, more.text
    row = await stored(flow, event)
    assert row["price_snapshot"]["total_cents"] == 4000 and row["billing_status"] == "pending"
    orders = await flow.db.billing_orders.find({"registration_id": row["id"]}, {"_id": 0}).to_list(None)
    assert sorted(order["status"] for order in orders if order["status"] == "cancelled") == ["cancelled"]
    assert [order["snapshot"]["total_cents"] for order in orders if order["status"] != "cancelled"] == [4000]

    await flow.db.event_registrations.update_one({"id": row["id"]}, {"$set": {"billing_status": "invoiced"}})
    invoiced = await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"companion_count": 2})
    assert invoiced.status_code == 409 and "Rechnung" in invoiced.json()["detail"]
    # Der Hinweis geht trotzdem.
    assert (await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"note": "vegetarisch"})).status_code == 200
    assert (await stored(flow, event))["companion_count"] == 1


PAID_LATER = {"enabled": True, "currency": "EUR", "version": 1,
              "positions": [{"key": "beitrag", "label": "Beitrag", "amount_cents": 2000, "basis": "per_person", "tax_profile": "none"}]}


@pytest.mark.asyncio
async def test_free_registration_is_never_billed_by_changing_companions(flow):
    """Kostenlos angemeldet, der Verein schaltet Kosten ein: eine Begleitperson weniger erzeugt keine Rechnung."""
    event, _paula = await setup_event(flow, companions=1)
    await flow.db.events.update_one({"id": event["id"]}, {"$set": {"billing": PAID_LATER}})
    refused = await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"companion_count": 0})
    assert refused.status_code == 409 and "Turnierleitung" in refused.json()["detail"]
    row = await stored(flow, event)
    assert row["companion_count"] == 1 and not row.get("price_snapshot") and not row.get("billing_status")
    assert await flow.db.billing_orders.count_documents({"registration_id": row["id"]}) == 0
    # Der Hinweis geht weiter.
    assert (await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"note": "später"})).status_code == 200


@pytest.mark.asyncio
async def test_changed_offer_is_not_applied_by_the_person_herself(flow):
    event, _paula = await setup_event(flow, billing=OFFER)
    first = await stored(flow, event)
    version = first["price_snapshot"]["offer_version"]
    await flow.db.events.update_one({"id": event["id"]}, {"$set": {"billing": {**PAID_LATER, "version": version + 1}}})
    refused = await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"companion_count": 1})
    assert refused.status_code == 409 and "Kosten" in refused.json()["detail"]
    row = await stored(flow, event)
    assert row["price_snapshot"]["total_cents"] == first["price_snapshot"]["total_cents"] and row["companion_count"] == 0


@pytest.mark.asyncio
async def test_after_registration_closed_no_more_companions_but_fewer_and_note_go(flow):
    event, _paula = await setup_event(flow, companions=1)
    await flow.db.events.update_one({"id": event["id"]}, {"$set": {"registration_closes_at": (now_utc() - timedelta(days=1)).isoformat()}})
    more = await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"companion_count": 3})
    assert more.status_code == 409 and "geschlossen" in more.json()["detail"]
    assert (await stored(flow, event))["companion_count"] == 1
    fewer = await flow.patch(f"/api/events/{event['id']}/registrations/me", json={"companion_count": 0, "note": "nur ich"})
    assert fewer.status_code == 200, fewer.text
    row = await stored(flow, event)
    assert row["companion_count"] == 0 and row["note"] == "nur ich"
