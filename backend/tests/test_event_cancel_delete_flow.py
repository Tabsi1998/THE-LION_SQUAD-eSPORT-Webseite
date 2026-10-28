"""Event absagen, verschieben und löschen (#2118).

- **Absagen** (Status „abgesagt“): Angemeldete und Warteliste bekommen eine Benachrichtigung und die vorhandene Mail
  „Nachricht zum Event“, ihre Anmeldungen gelten als storniert, offene Rechnungsaufträge werden storniert und ein schon
  angelegter Beleg wird zum Prüffall. Die Eventseite zeigt der Person „abgesagt“ statt „Du bist dabei“.
- **Verschieben**: neuer Termin oder Ort - die Verwaltung entscheidet mit ``notify_registrants``, ob die Angemeldeten
  davon erfahren. Gespeichert wird der Schalter nicht.
- **Löschen**: nur ohne aktive Anmeldungen, ohne Belege und ohne verknüpfte Turniere mit Anmeldungen - sonst 409 mit
  dem Hinweis auf „Absagen“. Gelöscht wird mit Protokoll.
- **Max. Teilnehmer**: leer heißt unbegrenzt, 0 oder weniger wird abgelehnt.

Namen und Adressen sind erfunden.
"""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402

OFFER = {
    "enabled": True,
    "positions": [{"key": "beitrag", "label": "Kostenbeitrag", "amount": "20", "basis": "per_person"}],
}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def person(flow, name, *, role="player", **fields):
    user = await flow.add_user(role=role, name=name)
    fields = {"email": f"{name}@lionsquad-test.at", **fields}
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    return user


async def register(flow, event, user):
    flow.act_as(user)
    response = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})
    assert response.status_code == 200, response.text
    return response.json()


async def setup_event(flow, **extra):
    """Zwei Plätze, zwei Angemeldete mit Kostenbeitrag und eine Person auf der Warteliste."""
    kassier = await person(flow, "kassier", role="tournament_admin", areas=["finance"])
    flow.act_as(kassier)
    payload = {"name": "Herbst-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
               "max_participants": 2, "billing": OFFER, "location": "Vereinsheim",
               "start_date": (now_utc() + timedelta(days=20)).isoformat(), **extra}
    response = await flow.post("/api/events", json=payload)
    assert response.status_code == 200, response.text
    event = response.json()
    people = {name: await person(flow, name) for name in ("paula", "max", "otto")}
    regs = {name: await register(flow, event, user) for name, user in people.items()}
    assert [regs[name]["status"] for name in ("paula", "max", "otto")] == ["registered", "registered", "waitlist"]
    return kassier, event, people, regs


async def patch(flow, actor, event, body):
    flow.act_as(actor)
    return await flow.patch(f"/api/events/{event['id']}", json=body)


# --------------------------------------------------------------------------- Absagen
@pytest.mark.asyncio
async def test_cancelling_informs_everyone_cancels_registrations_and_orders(flow):
    kassier, event, people, regs = await setup_event(flow)
    # Für max gibt es schon einen Beleg - der wird nicht still storniert, sondern zum Prüffall.
    await flow.db.billing_orders.update_one({"registration_id": regs["max"]["id"]},
                                            {"$set": {"status": "invoiced", "invoice_ref": "RE-TEST-1", "invoice_status": "validated"}})

    response = await patch(flow, kassier, event, {"status": "cancelled"})
    assert response.status_code == 200, response.text
    assert response.json()["cancellation"] == {"registrations": 3, "notified": 3, "orders": 2}

    stored = {row["user_id"]: row async for row in flow.db.event_registrations.find({"event_id": event["id"]}, {"_id": 0})}
    assert all(row["status"] == "cancelled" and row["cancelled_with_event"] for row in stored.values())
    assert stored[people["paula"]["id"]]["billing_status"] == "cancelled"
    paula_order = await flow.db.billing_orders.find_one({"registration_id": regs["paula"]["id"]}, {"_id": 0})
    assert paula_order["status"] == "cancelled"
    max_order = await flow.db.billing_orders.find_one({"registration_id": regs["max"]["id"]}, {"_id": 0})
    assert max_order["status"] == "invoiced" and max_order["booking_state"] == "cancelled"
    assert await flow.db.billing_cases.count_documents({"status": "open"}) == 1

    notes = await flow.db.notifications.find({"kind": "event_message"}, {"_id": 0}).to_list(10)
    assert sorted(note["user_id"] for note in notes) == sorted(user["id"] for user in people.values())
    assert all("abgesagt" in note["title"] for note in notes)
    mails = await flow.db.mail_jobs.find({"template_key": "event_message"}, {"_id": 0, "to": 1}).to_list(10)
    assert sorted(mail["to"] for mail in mails) == sorted(user["email"] for user in people.values())
    audit = await flow.db.audit_logs.find_one({"action": "event.cancel"}, {"_id": 0})
    assert audit["actor_id"] == kassier["id"] and audit["data"]["registrations"] == 3

    # Die Eventseite sagt der Person, dass ihre Anmeldung mit dem Event storniert ist.
    flow.act_as(people["paula"])
    own = (await flow.get(f"/api/events/{event['slug']}")).json()["own_registration"]
    assert own["status"] == "cancelled" and own["cancelled_with_event"] is True

    # Ein weiteres Speichern des abgesagten Events schickt nichts noch einmal.
    again = await patch(flow, kassier, event, {"description": "Leider abgesagt."})
    assert again.status_code == 200 and "cancellation" not in again.json()
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == 3


@pytest.mark.asyncio
async def test_cancelling_also_closes_failed_orders(flow):
    """Ein fehlgeschlagener Auftrag bekäme sonst über „Erneut versuchen“ später eine Rechnung zum abgesagten Event."""
    kassier, event, _people, regs = await setup_event(flow)
    await flow.db.billing_orders.update_one({"registration_id": regs["paula"]["id"]}, {"$set": {"status": "failed"}})
    response = await patch(flow, kassier, event, {"status": "cancelled"})
    assert response.status_code == 200 and response.json()["cancellation"]["orders"] == 2
    order = await flow.db.billing_orders.find_one({"registration_id": regs["paula"]["id"]}, {"_id": 0})
    assert order["status"] == "cancelled" and order["cancel_reason"] == "Event abgesagt"


@pytest.mark.asyncio
async def test_cancelling_twice_at_once_informs_everyone_once(flow):
    kassier, event, people, _regs = await setup_event(flow)
    first, second = await asyncio.gather(patch(flow, kassier, event, {"status": "cancelled"}),
                                         patch(flow, kassier, event, {"status": "cancelled"}))
    assert [first.status_code, second.status_code] == [200, 200]
    assert ["cancellation" in first.json(), "cancellation" in second.json()].count(True) == 1
    assert await flow.db.audit_logs.count_documents({"action": "event.cancel"}) == 1
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == 3

    # Zurücknehmen und wieder absagen: niemand bekommt die Absage ein zweites Mal.
    reopened = await patch(flow, kassier, event, {"status": "registration_open"})
    assert reopened.status_code == 200
    flow.act_as(people["paula"])
    again = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})
    assert again.status_code == 200, again.text
    repeated = await patch(flow, kassier, event, {"status": "cancelled"})
    assert repeated.json()["cancellation"]["registrations"] == 1
    assert await flow.db.notifications.count_documents({"kind": "event_message", "user_id": people["paula"]["id"]}) == 1


@pytest.mark.asyncio
async def test_admin_list_counts_registrations_even_with_registration_switched_off(flow):
    kassier, event, _people, _regs = await setup_event(flow)
    switched_off = await patch(flow, kassier, event, {"has_registration": False})
    assert switched_off.status_code == 200
    flow.act_as(kassier)
    listed = next(ev for ev in (await flow.get("/api/events?include_drafts=true")).json() if ev["id"] == event["id"])
    assert listed["active_registration_count"] == 3
    flow.act_as(None)
    public = next(ev for ev in (await flow.get("/api/events")).json() if ev["id"] == event["id"])
    assert "active_registration_count" not in public


@pytest.mark.asyncio
async def test_cancelling_an_event_without_registrations_just_saves(flow):
    kassier = await person(flow, "kassier", role="tournament_admin")
    flow.act_as(kassier)
    event = (await flow.post("/api/events", json={"name": "Stammtisch", "status": "scheduled"})).json()
    response = await patch(flow, kassier, event, {"status": "cancelled"})
    assert response.status_code == 200
    assert response.json()["cancellation"] == {"registrations": 0, "notified": 0, "orders": 0}


# --------------------------------------------------------------------------- Verschieben
@pytest.mark.asyncio
async def test_moving_the_date_informs_only_when_asked(flow):
    kassier, event, people, _regs = await setup_event(flow)
    later = (now_utc() + timedelta(days=40)).replace(hour=10, minute=0, second=0, microsecond=0)

    quiet = await patch(flow, kassier, event, {"start_date": later.isoformat()})
    assert quiet.status_code == 200 and "change_notice" not in quiet.json()
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == 0

    told = await patch(flow, kassier, event, {"start_date": (later + timedelta(days=1)).isoformat(), "location": "Stadtsaal",
                                              "notify_registrants": True})
    assert told.status_code == 200, told.text
    assert told.json()["change_notice"]["notified"] == 3
    assert "notify_registrants" not in (await flow.db.events.find_one({"id": event["id"]}, {"_id": 0}))
    notes = await flow.db.notifications.find({"kind": "event_message"}, {"_id": 0}).to_list(10)
    assert len(notes) == 3 and all("Stadtsaal" in note["body"] for note in notes)
    # Die Anmeldungen bleiben.
    assert await flow.db.event_registrations.count_documents({"event_id": event["id"], "status": {"$in": ["registered", "waitlist"]}}) == 3

    # Ohne Änderung an Termin oder Ort geht nichts hinaus, auch mit dem Schalter.
    nothing = await patch(flow, kassier, event, {"description": "Mehr Infos folgen.", "notify_registrants": True})
    assert nothing.status_code == 200 and "change_notice" not in nothing.json()
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == 3


# --------------------------------------------------------------------------- Löschen
@pytest.mark.asyncio
async def test_deleting_with_active_registrations_is_refused(flow):
    kassier, event, _people, _regs = await setup_event(flow)
    flow.act_as(kassier)
    response = await flow.delete(f"/api/events/{event['id']}")
    assert response.status_code == 409
    assert "absagen" in response.json()["detail"].lower()
    assert await flow.db.events.count_documents({"id": event["id"]}) == 1
    assert await flow.db.event_registrations.count_documents({"event_id": event["id"]}) == 3


@pytest.mark.asyncio
async def test_deleting_after_an_invoice_is_refused(flow):
    kassier, event, _people, regs = await setup_event(flow)
    await flow.db.billing_orders.update_one({"registration_id": regs["paula"]["id"]}, {"$set": {"status": "invoiced", "invoice_ref": "RE-TEST-2"}})
    cancelled = await patch(flow, kassier, event, {"status": "cancelled"})
    assert cancelled.status_code == 200
    flow.act_as(kassier)
    response = await flow.delete(f"/api/events/{event['id']}")
    assert response.status_code == 409 and "Rechnung" in response.json()["detail"]
    assert await flow.db.event_registrations.count_documents({"event_id": event["id"]}) == 3


@pytest.mark.asyncio
async def test_deleting_with_a_linked_tournament_that_has_registrations_is_refused(flow):
    kassier = await person(flow, "kassier", role="tournament_admin")
    flow.act_as(kassier)
    event = (await flow.post("/api/events", json={"name": "Stammtisch", "status": "scheduled"})).json()
    await flow.db.tournaments.insert_one({"id": "turnier-1", "title": "FC Cup", "event_id": event["id"], "status": "registration_open"})
    await flow.db.tournament_registrations.insert_one({"id": "t-reg-1", "tournament_id": "turnier-1", "status": "approved"})
    response = await flow.delete(f"/api/events/{event['id']}")
    assert response.status_code == 409 and "aus dem Programm lösen" in response.json()["detail"]
    assert (await flow.db.tournaments.find_one({"id": "turnier-1"}))["event_id"] == event["id"]


@pytest.mark.asyncio
async def test_deleting_a_cancelled_event_removes_it_with_a_log(flow):
    kassier, event, _people, regs = await setup_event(flow)
    await flow.db.tournaments.insert_one({"id": "turnier-2", "title": "FC Cup", "event_id": event["id"], "status": "draft"})
    cancelled = await patch(flow, kassier, event, {"status": "cancelled"})
    assert cancelled.status_code == 200
    flow.act_as(kassier)
    response = await flow.delete(f"/api/events/{event['id']}")
    assert response.status_code == 200, response.text
    assert await flow.db.events.count_documents({"id": event["id"]}) == 0
    assert await flow.db.event_registrations.count_documents({"event_id": event["id"]}) == 0
    assert (await flow.db.tournaments.find_one({"id": "turnier-2"}))["event_id"] is None
    # Die stornierten Aufträge bleiben als Beleg der Abrechnung.
    assert await flow.db.billing_orders.count_documents({"registration_id": regs["paula"]["id"], "status": "cancelled"}) == 1
    audit = await flow.db.audit_logs.find_one({"action": "event.delete"}, {"_id": 0})
    assert audit["actor_id"] == kassier["id"] and audit["data"]["name"] == "Herbst-LAN" and audit["data"]["registrations"] == 3


@pytest.mark.asyncio
async def test_deleting_an_unknown_event_is_404(flow):
    kassier = await person(flow, "kassier", role="tournament_admin")
    flow.act_as(kassier)
    missing = await flow.delete("/api/events/gibt-es-nicht")
    assert missing.status_code == 404


# --------------------------------------------------------------------------- Max. Teilnehmer
@pytest.mark.asyncio
async def test_max_participants_can_be_cleared_and_must_be_positive(flow):
    kassier = await person(flow, "kassier", role="tournament_admin")
    flow.act_as(kassier)
    zero_on_create = await flow.post("/api/events", json={"name": "Stammtisch", "max_participants": 0})
    assert zero_on_create.status_code == 422
    event = (await flow.post("/api/events", json={"name": "Stammtisch", "max_participants": 20})).json()
    negative = await patch(flow, kassier, event, {"max_participants": -3})
    zero = await patch(flow, kassier, event, {"max_participants": 0})
    assert [negative.status_code, zero.status_code] == [422, 422]
    cleared = await patch(flow, kassier, event, {"max_participants": None})
    assert cleared.status_code == 200 and cleared.json()["max_participants"] is None
    assert (await flow.db.events.find_one({"id": event["id"]}))["max_participants"] is None
