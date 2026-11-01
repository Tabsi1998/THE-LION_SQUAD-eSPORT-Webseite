"""Bescheid zur eigenen Event-Anmeldung (#2127, EV6, EV13): angemeldet, Warteliste, nachgerückt per Knopf, von der Leitung
storniert oder „nicht erschienen“ - Glocke und Mail wie bei Turnieren. Niemand rückt von selbst nach. Namen sind erfunden."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services.event_notifications import KIND, registration_message  # noqa: E402

PAID = {"enabled": True, "positions": [{"key": "eintritt", "label": "Eintritt", "amount_cents": 1000, "basis": "per_person"}]}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def person(flow, name, **fields):
    user = await flow.add_user(role=fields.pop("role", "player"), name=name)
    fields = {"email": f"{name}@lionsquad-test.at", **fields}
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    return user


async def setup(flow, **extra):
    lead = await person(flow, "leitung", role="superadmin")
    flow.act_as(lead)
    response = await flow.post("/api/events", json={"name": "Herbst-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
                                                    "max_participants": 1, "start_date": (now_utc() + timedelta(days=5)).isoformat(), **extra})
    assert response.status_code == 200, response.text
    return lead, response.json()


async def register(flow, event, user):
    flow.act_as(user)
    response = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})
    assert response.status_code == 200, response.text
    return response.json()


async def notes(flow, user):
    return await flow.db.notifications.find({"kind": KIND, "user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(20)


async def mails(flow, user):
    return await flow.db.mail_jobs.find({"template_key": "event_registration", "to": user["email"]}, {"_id": 0}).to_list(20)


@pytest.mark.asyncio
async def test_anmeldung_und_warteliste_bekommen_bescheid_ohne_push_fuer_sich_selbst(flow):
    _lead, event = await setup(flow)
    erste = await person(flow, "erste")
    zweite = await person(flow, "zweite")
    assert (await register(flow, event, erste))["status"] == "registered"
    assert (await register(flow, event, zweite))["status"] == "waitlist"

    first = (await notes(flow, erste))[0]
    assert first["title"] == "Du bist dabei: Herbst-LAN" and first["meta"]["in_app_only"] is True
    second = (await notes(flow, zweite))[0]
    assert second["title"] == "Warteliste: Herbst-LAN" and "kann dich die Turnierleitung nachholen" in second["body"]
    mail = (await mails(flow, zweite))[0]
    assert mail["subject"] == "Warteliste: Herbst-LAN"


@pytest.mark.asyncio
async def test_abmeldung_laesst_niemanden_von_selbst_nachruecken_erst_der_knopf(flow):
    lead, event = await setup(flow)
    erste = await person(flow, "erste")
    zweite = await person(flow, "zweite")
    await register(flow, event, erste)
    wartend = await register(flow, event, zweite)

    flow.act_as(erste)
    cancelled = await flow.delete(f"/api/events/{event['id']}/registrations/me")
    assert cancelled.status_code == 200
    stored = await flow.db.event_registrations.find_one({"id": wartend["id"]}, {"_id": 0, "status": 1})
    assert stored["status"] == "waitlist", "kein automatisches Nachrücken - der Platz kann etwas kosten"
    assert len(await notes(flow, erste)) == 1, "wer sich selbst abmeldet, bekommt keine Nachricht"

    flow.act_as(lead)
    view = (await flow.get(f"/api/events/{event['slug']}/lead", params={"filter": "all"})).json()
    assert view["counts"]["spots_left"] == 1 and view["counts"]["waitlist"] == 1

    response = await flow.patch(f"/api/events/{event['id']}/registrations/{wartend['id']}", json={"status": "registered"})
    assert response.status_code == 200, response.text
    moved = (await notes(flow, zweite))[-1]
    assert moved["title"] == "Nachgerückt: Herbst-LAN" and "nachgerückt" in moved["body"]
    assert "in_app_only" not in moved["meta"], "die Person hat es nicht selbst getan: auch per Push"
    assert (await mails(flow, zweite))[-1]["subject"] == "Nachgerückt: Herbst-LAN"


@pytest.mark.asyncio
async def test_nachruecken_mit_kosten_nennt_den_preis(flow):
    lead, event = await setup(flow, billing=PAID)
    erste = await person(flow, "erste")
    zweite = await person(flow, "zweite")
    first = await register(flow, event, erste)
    wartend = await register(flow, event, zweite)
    flow.act_as(lead)
    await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"status": "cancelled"})
    await flow.patch(f"/api/events/{event['id']}/registrations/{wartend['id']}", json={"status": "registered"})
    moved = (await notes(flow, zweite))[-1]
    assert "10,00" in moved["body"] and "Die Rechnung findest du" in moved["body"]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["registered", "checked_in"])
async def test_wieder_aktiviert_neuer_preis_neuer_auftrag_und_ehrlicher_text(flow, status):
    lead, event = await setup(flow, billing=PAID)
    erste = await person(flow, "erste")
    first = await register(flow, event, erste)
    before = await flow.db.event_registrations.find_one({"id": first["id"]}, {"_id": 0})
    flow.act_as(lead)
    await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"status": "cancelled"})
    response = await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"status": status})
    assert response.status_code == 200, response.text

    row = await flow.db.event_registrations.find_one({"id": first["id"]}, {"_id": 0})
    assert row["billing_status"] == "pending" and row["price_snapshot"]["hash"] != before["price_snapshot"]["hash"]
    orders = await flow.db.billing_orders.find({"registration_id": first["id"]}, {"_id": 0, "status": 1, "booking_key": 1}).to_list(5)
    assert sorted(order["status"] for order in orders) == ["cancelled", "pending"], "der neue Preis hat seinen eigenen Auftrag"
    assert len({order["booking_key"] for order in orders}) == 2
    back = (await notes(flow, erste))[-1]
    assert back["title"] == "Du bist wieder dabei: Herbst-LAN" and "10,00" in back["body"]


@pytest.mark.asyncio
async def test_wieder_aktiviert_mit_gestellter_rechnung_kein_zweiter_auftrag_und_kein_kostensatz(flow):
    lead, event = await setup(flow, billing=PAID)
    erste = await person(flow, "erste")
    first = await register(flow, event, erste)
    await flow.db.billing_orders.update_many({"registration_id": first["id"]}, {"$set": {"status": "invoiced", "invoice_ref": "RE-1"}})
    flow.act_as(lead)
    await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"status": "cancelled"})
    response = await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"status": "registered"})
    assert response.status_code == 200, response.text
    row = await flow.db.event_registrations.find_one({"id": first["id"]}, {"_id": 0})
    assert row["billing_status"] == "cancelled"
    assert await flow.db.billing_orders.count_documents({"registration_id": first["id"]}) == 1
    order = await flow.db.billing_orders.find_one({"registration_id": first["id"]}, {"_id": 0})
    assert order["booking_change"] == "Anmeldung wieder aktiviert", "Finanzen bekommt den Prüffall"
    back = (await notes(flow, erste))[-1]
    assert back["title"] == "Du bist wieder dabei: Herbst-LAN"
    assert "Kostenbeitrag" not in back["body"] and "Rechnung" not in back["body"]


def test_kostensatz_nach_rechnungszeitpunkt():
    now = {"price_snapshot": {"total_cents": 1000, "currency": "EUR", "invoice_timing": "on_confirm"}}
    later = {"price_snapshot": {"total_cents": 1000, "currency": "EUR", "invoice_timing": "manual"}}
    assert "Die Rechnung findest du" in registration_message({}, now, "registered")["detail"]
    assert "Die Rechnung bekommst du später" in registration_message({}, later, "registered")["detail"]
    gone = {**now, "billing_status": "cancelled"}
    assert "Kostenbeitrag" not in registration_message({}, gone, "registered", "cancelled")["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize("status,title", [("cancelled", "Anmeldung storniert: Herbst-LAN"), ("no_show", "Nicht erschienen: Herbst-LAN")])
async def test_leitung_storniert_die_person_erfaehrt_es_und_der_text_ist_ehrlich(flow, status, title):
    lead, event = await setup(flow, billing=PAID)
    erste = await person(flow, "erste")
    reg = await register(flow, event, erste)
    flow.act_as(lead)
    response = await flow.patch(f"/api/events/{event['id']}/registrations/{reg['id']}", json={"status": status})
    assert response.status_code == 200, response.text
    note = (await notes(flow, erste))[-1]
    assert note["title"] == title and "meldet sich der Verein" in note["body"]
    orders = await flow.db.billing_orders.find({"registration_id": reg["id"]}, {"_id": 0, "status": 1}).to_list(5)
    assert orders and all(order["status"] == "cancelled" for order in orders), "Rechnungsaufträge wie bisher"


@pytest.mark.asyncio
async def test_einchecken_und_zuruecknehmen_schicken_nichts(flow):
    lead, event = await setup(flow)
    erste = await person(flow, "erste")
    reg = await register(flow, event, erste)
    before = len(await notes(flow, erste))
    flow.act_as(lead)
    await flow.patch(f"/api/events/{event['id']}/registrations/{reg['id']}", json={"status": "checked_in"})
    await flow.patch(f"/api/events/{event['id']}/registrations/{reg['id']}", json={"status": "registered"})
    await flow.patch(f"/api/events/{event['id']}/registrations/{reg['id']}", json={"note": "kommt später"})
    assert len(await notes(flow, erste)) == before


def test_texte_je_stand():
    event = {"name": "LAN"}
    assert registration_message(event, {}, "registered", "checked_in") is None
    assert registration_message(event, {}, "checked_in", "waitlist")["headline"] == "Nachgerückt"
    assert registration_message(event, {}, "registered", "cancelled")["headline"] == "Du bist wieder dabei"
    assert "gesetzt" in registration_message(event, {}, "waitlist", "registered")["detail"]
    assert "Kostenbeitrag" not in registration_message(event, {}, "cancelled", "registered")["detail"]
    assert registration_message(event, {}, "registered", "registered") is None
