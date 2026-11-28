"""Plan A/B/C beim Ort (#2613): Am Event liegen vorab mehrere Orte als Alternativen, umgeschaltet wird mit einem Klick.

- Ein Plan hat Name, Adresse bzw. Treffpunkt und Hinweis. Der aktive Plan steht in den bisherigen Ortsfeldern - Listen,
  Kalender, ICS-Datei, Mails und die App lesen ihn dort, ohne etwas Neues zu kennen. Die Seite zeigt „Plan B aktiv“.
- Umschalten fragt wie beim Verschieben „Angemeldete informieren?“: mit Nachricht genau eine je Person und Umschaltung
  (``dedupe_key`` mit der laufenden Nummer der Umschaltung), ohne Nachricht keine. Jede Umschaltung steht im Protokoll.
- Zwei gleichzeitige Umschaltungen: auf denselben Plan zählt eine; auf verschiedene gewinnt die erste, die zweite
  bekommt 409 statt den Plan still zu überschreiben.

Namen und Adressen sind erfunden; es wird nichts echt verschickt.
"""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import InterleavedReads, make_flow  # noqa: E402
from models import now_utc  # noqa: E402

PLANS = [
    {"name": "Rodelbahn Hochegg", "address": "Hocheggweg 1", "postal_code": "6410", "city": "Telfs", "note": "Treffpunkt Parkplatz"},
    {"name": "Rodelbahn Gaisalm", "address": "Gaisweg 5", "postal_code": "6410", "city": "Telfs", "note": "Bei wenig Schnee"},
    {"name": "Vereinsheim", "city": "Telfs", "note": "Kein Schnee: wir feiern gleich drinnen"},
]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def person(flow, name, *, role="player"):
    user = await flow.add_user(role=role, name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"email": f"{name}@lionsquad-test.at"}})
    user["email"] = f"{name}@lionsquad-test.at"
    return user


async def setup_event(flow, plans=PLANS):
    """Zwei Plätze, zwei Angemeldete und eine Person auf der Warteliste; die Pläne A, B, C am Event."""
    leitung = await person(flow, "leitung", role="tournament_admin")
    flow.act_as(leitung)
    payload = {"name": "Silvesterparty", "status": "registration_open", "visibility": "public", "has_registration": True,
               "max_participants": 2, "start_date": (now_utc() + timedelta(days=30)).replace(microsecond=0).isoformat(),
               "place_plans": plans}
    response = await flow.post("/api/events", json=payload)
    assert response.status_code == 200, response.text
    event = response.json()
    people = {name: await person(flow, name) for name in ("paula", "max", "otto")}
    for user in people.values():
        flow.act_as(user)
        assert (await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})).status_code == 200
    return leitung, event, people


async def switch(flow, actor, event, key, **extra):
    flow.act_as(actor)
    return await flow.post(f"/api/admin/events/{event['id']}/place-plan", json={"key": key, **extra})


async def stored(flow, event):
    return await flow.db.events.find_one({"id": event["id"]}, {"_id": 0})


# --------------------------------------------------------------------------- Hinterlegen
@pytest.mark.asyncio
async def test_plans_are_saved_with_letters_and_the_first_one_is_the_place(flow):
    _leitung, event, _people = await setup_event(flow)
    doc = await stored(flow, event)
    keys = [plan["key"] for plan in doc["place_plans"]]
    assert keys == ["plan-a", "plan-b", "plan-c"] and doc["active_place_plan"] == "plan-a"
    assert (doc["location"], doc["address"], doc["postal_code"], doc["city"]) == ("Rodelbahn Hochegg", "Hocheggweg 1", "6410", "Telfs")

    flow.act_as(None)
    page = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert page["place_plan"]["label"] == "Plan A" and page["place_plan"]["alternative"] is False
    assert page["place_plan"]["note"] == "Treffpunkt Parkplatz" and page["place_plan"]["total"] == 3
    assert [(plan["label"], plan["active"]) for plan in page["place_plans"]] == [("Plan A", True), ("Plan B", False), ("Plan C", False)]
    assert page["place_plans"][1]["address_line"] == "Gaisweg 5, 6410 Telfs"
    assert "place_plan_round" not in page


@pytest.mark.asyncio
@pytest.mark.parametrize("plans, word", [
    ([PLANS[0]], "zwei"),
    ([PLANS[0], {"note": "nur ein Hinweis"}], "Name oder Adresse"),
    ([PLANS[0]] * 6, "Höchstens"),
    ([{**PLANS[0], "key": "x"}, {**PLANS[1], "key": "x"}], "eindeutig"),
])
async def test_invalid_plans_are_refused(flow, plans, word):
    leitung = await person(flow, "leitung", role="tournament_admin")
    flow.act_as(leitung)
    response = await flow.post("/api/events", json={"name": "Silvester", "place_plans": plans})
    assert response.status_code == 400, response.text
    assert word in response.json()["detail"]


@pytest.mark.asyncio
async def test_plans_and_a_list_of_several_places_do_not_mix(flow):
    leitung = await person(flow, "leitung", role="tournament_admin")
    flow.act_as(leitung)
    places = [{"name": "Halle"}, {"name": "Lokal"}]
    response = await flow.post("/api/events", json={"name": "Silvester", "locations": places, "place_plans": PLANS})
    assert response.status_code == 400 and "Standorte" in response.json()["detail"]
    event = (await flow.post("/api/events", json={"name": "Silvester", "locations": places})).json()
    later = await flow.patch(f"/api/events/{event['id']}", json={"place_plans": PLANS})
    assert later.status_code == 400


@pytest.mark.asyncio
async def test_saving_the_plans_keeps_the_active_plan_from_the_database(flow):
    """Eine Maske, die vor der Umschaltung geöffnet wurde, setzt den aktiven Plan beim Speichern nicht zurück."""
    leitung, event, _people = await setup_event(flow)
    assert (await switch(flow, leitung, event, "plan-b")).status_code == 200
    edited = [dict(plan) for plan in PLANS]
    edited[2]["note"] = "Kein Schnee: Garage"
    response = await flow.patch(f"/api/events/{event['id']}", json={"place_plans": [{**plan, "key": f"plan-{letter}"} for plan, letter in zip(edited, "abc")]})
    assert response.status_code == 200, response.text
    doc = await stored(flow, event)
    assert doc["active_place_plan"] == "plan-b" and doc["location"] == "Rodelbahn Gaisalm"
    assert doc["place_plans"][2]["note"] == "Kein Schnee: Garage"
    # Pläne weg: der Ort bleibt, wie er gerade ist.
    cleared = await flow.patch(f"/api/events/{event['id']}", json={"place_plans": []})
    assert cleared.status_code == 200
    doc = await stored(flow, event)
    assert doc["place_plans"] == [] and doc["active_place_plan"] is None and doc["location"] == "Rodelbahn Gaisalm"


# --------------------------------------------------------------------------- Umschalten
@pytest.mark.asyncio
async def test_switching_without_a_message_changes_the_place_everywhere_and_logs_it(flow):
    leitung, event, _people = await setup_event(flow)
    response = await switch(flow, leitung, event, "plan-b")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["changed"] is True and body["place_plan"]["label"] == "Plan B" and body["notice"] is None
    doc = await stored(flow, event)
    assert (doc["location"], doc["address"]) == ("Rodelbahn Gaisalm", "Gaisweg 5")
    assert (doc["active_place_plan"], doc["place_plan_round"]) == ("plan-b", 1)
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == 0
    audit = await flow.db.audit_logs.find_one({"action": "event.place_plan"}, {"_id": 0})
    assert audit["actor_id"] == leitung["id"] and audit["data"]["from"] == "plan-a" and audit["data"]["to"] == "plan-b"
    assert audit["data"]["to_label"] == "Plan B" and audit["data"]["notified"] == 0

    flow.act_as(None)
    page = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert page["location"] == "Rodelbahn Gaisalm" and page["place_plan"]["alternative"] is True
    calendar = (await flow.get("/api/calendar")).json()
    item = next(entry for entry in calendar["items"] if entry["id"] == event["id"])
    assert item["location"] == "Rodelbahn Gaisalm, Telfs" and item["place_plan"] == "Plan B"
    ics = (await flow.get(f"/api/calendar/events/{event['slug']}.ics")).text
    assert "LOCATION:Rodelbahn Gaisalm\\, Telfs" in ics and "Plan B aktiv" in ics

    # Die Verwaltung sieht, wer wann umgeschaltet hat.
    flow.act_as(leitung)
    admin = (await flow.get(f"/api/admin/events/{event['id']}")).json()
    assert admin["place_plan_history"][0]["to_label"] == "Plan B" and admin["place_plan_history"][0]["actor_name"]


@pytest.mark.asyncio
async def test_switching_with_a_message_tells_each_person_exactly_once_per_switch(flow):
    leitung, event, people = await setup_event(flow)
    told = await switch(flow, leitung, event, "plan-c", notify=True)
    assert told.status_code == 200 and told.json()["notice"]["notified"] == 3
    notes = await flow.db.notifications.find({"kind": "event_message"}, {"_id": 0}).to_list(10)
    assert sorted(note["user_id"] for note in notes) == sorted(user["id"] for user in people.values())
    assert all("Plan C" in note["title"] and "Vereinsheim" in note["body"] and "Kein Schnee" in note["body"] for note in notes)
    assert all(note["meta"]["dedupe_key"] == f"event-place:{event['id']}:1:{note['user_id']}" for note in notes)
    assert await flow.db.mail_jobs.count_documents({"template_key": "event_message"}) == 3

    # Derselbe Plan noch einmal: nichts ändert sich, niemand bekommt etwas.
    again = await switch(flow, leitung, event, "plan-c", notify=True)
    assert again.status_code == 200 and again.json()["changed"] is False
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == 3
    # Zurück auf Plan A ist eine neue Umschaltung - jede Person erfährt auch sie genau einmal.
    back = await switch(flow, leitung, event, "plan-a", notify=True)
    assert back.json()["notice"]["notified"] == 3
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == 6
    assert await flow.db.audit_logs.count_documents({"action": "event.place_plan"}) == 2


@pytest.mark.asyncio
async def test_two_admins_switching_to_the_same_plan_at_once_count_once(flow, monkeypatch):
    from routes import event_poll_routes

    leitung, event, _people = await setup_event(flow)
    zweite = await person(flow, "zweite", role="tournament_admin")
    gate = InterleavedReads(flow.db, "events", before=("update_one",))
    monkeypatch.setattr(event_poll_routes, "get_db", lambda: gate)
    flow.act_as(leitung)
    url = f"/api/admin/events/{event['id']}/place-plan"
    first, second = await asyncio.gather(flow.post(url, json={"key": "plan-b", "notify": True}),
                                         flow.post(url, json={"key": "plan-b", "notify": True}))
    assert [first.status_code, second.status_code] == [200, 200]
    assert sorted([first.json()["changed"], second.json()["changed"]]) == [False, True]
    assert (await stored(flow, event))["place_plan_round"] == 1
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == 3
    assert await flow.db.audit_logs.count_documents({"action": "event.place_plan"}) == 1
    del zweite


@pytest.mark.asyncio
async def test_two_admins_switching_to_different_plans_at_once_one_gets_409(flow, monkeypatch):
    from routes import event_poll_routes

    leitung, event, _people = await setup_event(flow)
    gate = InterleavedReads(flow.db, "events", before=("update_one",))
    monkeypatch.setattr(event_poll_routes, "get_db", lambda: gate)
    flow.act_as(leitung)
    url = f"/api/admin/events/{event['id']}/place-plan"
    first, second = await asyncio.gather(flow.post(url, json={"key": "plan-b", "expected": "plan-a"}),
                                         flow.post(url, json={"key": "plan-c", "expected": "plan-a"}))
    assert sorted([first.status_code, second.status_code]) == [200, 409]
    loser = first if first.status_code == 409 else second
    assert "Inzwischen" in loser.json()["detail"]
    doc = await stored(flow, event)
    assert doc["place_plan_round"] == 1 and doc["active_place_plan"] in ("plan-b", "plan-c")
    assert doc["location"] == {"plan-b": "Rodelbahn Gaisalm", "plan-c": "Vereinsheim"}[doc["active_place_plan"]]


@pytest.mark.asyncio
async def test_a_stale_expected_plan_is_refused(flow):
    leitung, event, _people = await setup_event(flow)
    assert (await switch(flow, leitung, event, "plan-b")).status_code == 200
    stale = await switch(flow, leitung, event, "plan-c", expected="plan-a")
    assert stale.status_code == 409 and "Plan B" in stale.json()["detail"]
    assert (await stored(flow, event))["active_place_plan"] == "plan-b"


@pytest.mark.asyncio
async def test_switching_needs_the_staff_and_a_known_plan(flow):
    leitung, event, people = await setup_event(flow)
    assert (await switch(flow, people["paula"], event, "plan-b")).status_code == 403
    assert (await switch(flow, leitung, event, "plan-z")).status_code == 404
    flow.act_as(leitung)
    plain = (await flow.post("/api/events", json={"name": "Stammtisch", "location": "Vereinsheim"})).json()
    assert (await switch(flow, leitung, plain, "plan-a")).status_code == 409


@pytest.mark.asyncio
async def test_a_draft_or_cancelled_event_switches_quietly(flow):
    leitung, event, _people = await setup_event(flow)
    flow.act_as(leitung)
    assert (await flow.patch(f"/api/events/{event['id']}", json={"status": "cancelled"})).status_code == 200
    before = await flow.db.notifications.count_documents({})
    response = await switch(flow, leitung, event, "plan-b", notify=True)
    assert response.status_code == 200 and response.json()["notice"] is None
    assert await flow.db.notifications.count_documents({}) == before


@pytest.mark.asyncio
async def test_a_poll_over_the_plans_can_take_over_its_result(flow):
    """Optional aus #2613: Antworten einer Abstimmung, deren Codes die Pläne sind - das Ergebnis wird mit einem Klick zum Ort."""
    leitung, event, people = await setup_event(flow)
    flow.act_as(leitung)
    options = [{"code": f"plan-{letter}", "label": f"Plan {letter.upper()}"} for letter in "abc"]
    poll = (await flow.post(f"/api/admin/events/{event['id']}/polls", json={"question": "Welche Rodelbahn?", "options": options})).json()
    assert poll["place_plan_poll"] is True
    for name in ("paula", "max"):
        flow.act_as(people[name])
        assert (await flow.put(f"/api/events/{event['id']}/polls/{poll['id']}/vote", json={"choices": ["plan-b"]})).status_code == 200
    flow.act_as(leitung)
    winner = (await flow.get(f"/api/admin/events/{event['id']}/polls")).json()[0]["result"]["winner"]
    assert winner == "plan-b"
    assert (await switch(flow, leitung, event, winner, expected="plan-a")).json()["changed"] is True


# --------------------------------------------------------------------------- Review-Runde (Befunde 1, 2, 3, 5)
@pytest.mark.asyncio
async def test_removing_a_middle_plan_and_adding_a_new_one_never_reuses_a_key(flow):
    """Befund 1: B entfernen und einen neuen Plan anlegen - der neue bekommt den nächsten nie benutzten Schlüssel."""
    leitung, event, _people = await setup_event(flow)
    a, _b, c = (await stored(flow, event))["place_plans"]
    flow.act_as(leitung)
    response = await flow.patch(f"/api/events/{event['id']}", json={"place_plans": [a, c, {"key": "", "name": "Neue Bahn", "city": "Telfs"}]})
    assert response.status_code == 200, response.text
    assert [plan["key"] for plan in (await stored(flow, event))["place_plans"]] == ["plan-a", "plan-c", "plan-d"]
    doc = await stored(flow, event)
    again = await flow.patch(f"/api/events/{event['id']}", json={"place_plans": [*doc["place_plans"], {"key": "plan-b", "name": "Alte Bahn"}]})
    assert again.status_code == 400 and "schon vergeben" in again.json()["detail"]


@pytest.mark.asyncio
async def test_a_poll_over_a_removed_plan_does_not_point_to_a_new_place(flow):
    """Befund 2: Ein entfernter Plan C kommt nie als neuer Plan C zurück - die Abstimmung über C lenkt nicht auf einen fremden Ort."""
    leitung, event, people = await setup_event(flow)
    doc = await stored(flow, event)
    flow.act_as(leitung)
    options = [{"code": plan["key"], "label": plan["name"]} for plan in doc["place_plans"]]
    poll = (await flow.post(f"/api/admin/events/{event['id']}/polls", json={"question": "Welcher Ort?", "options": options})).json()
    flow.act_as(people["paula"])
    assert (await flow.put(f"/api/events/{event['id']}/polls/{poll['id']}/vote", json={"choices": ["plan-c"]})).status_code == 200
    a, b, _c = doc["place_plans"]
    flow.act_as(leitung)
    assert (await flow.patch(f"/api/events/{event['id']}", json={"place_plans": [a, b]})).status_code == 200
    added = await flow.patch(f"/api/events/{event['id']}", json={"place_plans": [a, b, {"key": "", "name": "Pizzeria", "city": "Zirl"}]})
    assert added.status_code == 200
    assert (await stored(flow, event))["place_plans"][2]["key"] == "plan-d"
    admin = (await flow.get(f"/api/admin/events/{event['id']}/polls")).json()[0]
    assert admin["place_plan_poll"] is False


@pytest.mark.asyncio
async def test_plan_keys_from_the_api_must_be_clean(flow):
    leitung = await person(flow, "leitung", role="tournament_admin")
    flow.act_as(leitung)
    response = await flow.post("/api/events", json={"name": "Silvester", "place_plans": [{**PLANS[0], "key": "Plan B!"}, PLANS[1]]})
    assert response.status_code == 400 and "Schlüssel" in response.json()["detail"]


@pytest.mark.asyncio
async def test_saving_the_form_while_someone_switches_is_refused(flow, monkeypatch):
    """Befund 3: Schaltet jemand um, während die Maske speichert, gewinnt das Umschalten - das Speichern bekommt 409."""
    from routes import event_routes
    from services import event_place_plans

    leitung, event, _people = await setup_event(flow)
    original = event_routes._apply_facts
    fired = {}

    async def racing(updates, raw, existing=None):
        if not fired:
            fired["switch"] = await event_place_plans.switch(flow.db, await stored(flow, event), "plan-b", leitung, notify=True)
        return await original(updates, raw, existing)

    monkeypatch.setattr(event_routes, "_apply_facts", racing)
    plans = (await stored(flow, event))["place_plans"]
    plans[2] = {**plans[2], "note": "neu"}
    flow.act_as(leitung)
    response = await flow.patch(f"/api/events/{event['id']}", json={"place_plans": plans})
    assert response.status_code == 409 and "Inzwischen wurde umgeschaltet" in response.json()["detail"]
    after = await stored(flow, event)
    assert fired["switch"]["changed"] is True
    assert (after["active_place_plan"], after["location"]) == ("plan-b", "Rodelbahn Gaisalm")
    assert after["place_plans"][2]["note"] == PLANS[2]["note"]


@pytest.mark.asyncio
async def test_place_fields_without_plans_change_the_active_plan_along(flow):
    """Befund 5: Ortsfelder über API oder Inhalte-Helfer ändern - der aktive Plan ändert sich mit, nie auseinander."""
    leitung, event, _people = await setup_event(flow)
    flow.act_as(leitung)
    response = await flow.patch(f"/api/events/{event['id']}", json={"location": "Ganz woanders", "city": "Innsbruck"})
    assert response.status_code == 200, response.text
    flow.act_as(None)
    page = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert page["location"] == "Ganz woanders" == page["place_plan"]["name"]
    assert page["place_plan"]["city"] == "Innsbruck" and page["place_plan"]["address"] == "Hocheggweg 1"
    doc = await stored(flow, event)
    assert doc["place_plans"][0]["name"] == "Ganz woanders" and doc["place_plans"][1]["name"] == "Rodelbahn Gaisalm"
