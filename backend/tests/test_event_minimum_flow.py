"""Mindestanzahl an Anmeldungen bis zu einer Frist (#2614).

- **Einstellung je Event:** Mindestzahl, Frist, ob Begleitpersonen mitzählen, ob die Event-Seite den Stand zeigt. Ohne
  Mindestzahl bleibt alles wie bisher; die Einstellung muss zum Event passen (Anmeldung hier, Frist vor dem Beginn, nicht mehr
  als Plätze).
- **Gezählt** wird wie bei den Plätzen: angemeldet und eingecheckt, nicht die Warteliste; Begleitpersonen nur, wenn eingestellt.
- **Frist erreicht, zu wenige:** die Turnierleitung hört es einmal je Event und Frist (Job ``event_minimum_shortfall``) - auch bei
  doppelten und gleichzeitigen Läufen nur einmal. Nie automatisch abgesagt.
- **Absagen** über den vorhandenen Weg mit Pflichtgrund: jede Person bekommt genau eine Nachricht samt Mail mit dem Grund.

Die Uhr ist fest: Beginn und Frist hängen an einem Anker, der Job und die Ansicht bekommen ihre Zeit vorgegeben. Namen und Adressen
sind erfunden.
"""
import asyncio
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import InterleavedReads, make_flow  # noqa: E402
from services import event_minimum  # noqa: E402
from services.event_minimum import shortfall_sweep  # noqa: E402

# Der Anker liegt sicher in der Zukunft, damit die Anmeldung offen ist; alles Weitere rechnet von ihm aus.
ANCHOR = (datetime.now(timezone.utc) + timedelta(days=40)).replace(hour=18, minute=0, second=0, microsecond=0)
START = ANCHOR
DEADLINE = ANCHOR - timedelta(days=13, hours=1)
BEFORE = DEADLINE - timedelta(seconds=1)
REASON = "Zu wenige Anmeldungen bis zur Frist"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    # Feste Uhr für die Ansicht (Event-Seite und Verwaltung): eine Stunde vor der Frist.
    instance.clock = {"now": DEADLINE - timedelta(hours=1)}
    monkeypatch.setattr(event_minimum, "now_utc", lambda: instance.clock["now"])
    try:
        yield instance
    finally:
        await shutdown()


def minimum(count=4, *, deadline=DEADLINE, count_companions=True, public=True):
    return {"count": count, "deadline": deadline.isoformat(), "count_companions": count_companions, "public": public}


async def person(flow, name, *, role="player"):
    user = await flow.add_user(role=role, name=name)
    email = f"{name}@lionsquad-test.at"
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"email": email}})
    user["email"] = email
    return user


async def setup(flow, **extra):
    """Ein Event mit Anmeldung, Begleitpersonen erlaubt und - wenn gewünscht - Mindestzahl."""
    lead = await person(flow, "leitung", role="tournament_admin")
    flow.act_as(lead)
    payload = {"name": "Silvester im Vereinsheim", "status": "registration_open", "visibility": "public", "has_registration": True,
               "allow_companions": True, "max_companions_per_registration": 3, "start_date": START.isoformat(), **extra}
    response = await flow.post("/api/events", json=payload)
    assert response.status_code == 200, response.text
    return lead, response.json()


async def register(flow, event, user, companions=0):
    flow.act_as(user)
    response = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": companions})
    assert response.status_code == 200, response.text
    return response.json()


async def admin_view(flow, lead, event):
    flow.act_as(lead)
    response = await flow.get(f"/api/admin/events/{event['id']}")
    assert response.status_code == 200, response.text
    return response.json()


async def notices(flow):
    return await flow.db.notifications.find({"meta.reason": "event_minimum_short"}, {"_id": 0}).to_list(None)


# --------------------------------------------------------------------------- Einstellung
@pytest.mark.asyncio
async def test_without_minimum_nothing_changes(flow):
    lead, event = await setup(flow)
    assert "min_registrations" not in await flow.db.events.find_one({"id": event["id"]}, {"_id": 0})
    assert "minimum" not in await admin_view(flow, lead, event)
    # Absagen geht ohne Grund wie bisher.
    response = await flow.patch(f"/api/events/{event['id']}", json={"status": "cancelled"})
    assert response.status_code == 200, response.text
    assert "cancel_reason" not in await flow.db.events.find_one({"id": event["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_minimum_is_saved_shown_and_cleared(flow):
    lead, event = await setup(flow)
    response = await flow.patch(f"/api/events/{event['id']}", json={"min_registrations": minimum(8, count_companions=False)})
    assert response.status_code == 200, response.text
    stored = (await flow.db.events.find_one({"id": event["id"]}, {"_id": 0}))["min_registrations"]
    assert stored == {"count": 8, "deadline": DEADLINE.isoformat(), "count_companions": False, "public": True}
    view = (await admin_view(flow, lead, event))["minimum"]
    assert view["state"] == "open" and view["have"] == 0 and view["missing"] == 8 and not view["deadline_passed"]
    assert view["proposal"].startswith("Zu wenige Anmeldungen: Bis ")
    cleared = await flow.patch(f"/api/events/{event['id']}", json={"min_registrations": None})
    assert cleared.status_code == 200 and cleared.json()["min_registrations"] is None
    assert "minimum" not in await admin_view(flow, lead, event)


@pytest.mark.asyncio
@pytest.mark.parametrize("change, detail", [
    ({"min_registrations": minimum(deadline=START - timedelta(minutes=59))}, event_minimum.DEADLINE_TOO_LATE),
    ({"min_registrations": minimum(11), "max_participants": 10}, "größer als die Plätze"),
    ({"min_registrations": minimum(), "registration_url": "https://anmeldung.example.test"}, "externem Anmeldelink"),
    ({"min_registrations": minimum(), "has_registration": False}, "Anmeldung über die Website"),
])
async def test_minimum_must_fit_the_event(flow, change, detail):
    _lead, event = await setup(flow)
    response = await flow.patch(f"/api/events/{event['id']}", json=change)
    assert response.status_code == 400 and detail in response.json()["detail"]
    assert "min_registrations" not in await flow.db.events.find_one({"id": event["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_deadline_one_hour_before_the_start_is_allowed_and_moving_the_start_closer_is_not(flow):
    """Mindestens eine Stunde Abstand: Sonst läge der Hinweis nach dem Beginn - der Job meldet dann nichts mehr."""
    lead, event = await setup(flow, min_registrations=minimum(deadline=START - timedelta(hours=1)))
    assert event["min_registrations"]["deadline"] == (START - timedelta(hours=1)).isoformat()
    flow.act_as(lead)
    earlier = await flow.patch(f"/api/events/{event['id']}", json={"start_date": (START - timedelta(minutes=1)).isoformat()})
    assert earlier.status_code == 400 and earlier.json()["detail"] == event_minimum.DEADLINE_TOO_LATE


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [{"has_registration": False}, {"registration_url": "https://anmeldung.example.test"}])
async def test_switching_off_the_registration_names_the_way_out(flow, change):
    lead, event = await setup(flow, min_registrations=minimum())
    flow.act_as(lead)
    blocked = await flow.patch(f"/api/events/{event['id']}", json=change)
    assert blocked.status_code == 400 and "zuerst die Mindestanzahl ausschalten" in blocked.json()["detail"]
    # Mit der Mindestanzahl zusammen ausgeschaltet geht es (so schickt es die Maske).
    together = await flow.patch(f"/api/events/{event['id']}", json={**change, "min_registrations": None})
    assert together.status_code == 200, together.text


@pytest.mark.asyncio
async def test_cancelling_still_checks_a_minimum_sent_along(flow):
    lead, event = await setup(flow, min_registrations=minimum(4))
    flow.act_as(lead)
    bad = minimum(4, deadline=START + timedelta(days=2))
    response = await flow.patch(f"/api/events/{event['id']}", json={"status": "cancelled", "cancel_reason": REASON, "min_registrations": bad})
    assert response.status_code == 400 and response.json()["detail"] == event_minimum.DEADLINE_TOO_LATE
    stored = await flow.db.events.find_one({"id": event["id"]}, {"_id": 0})
    assert stored["status"] == "registration_open" and stored["min_registrations"]["deadline"] == DEADLINE.isoformat()


@pytest.mark.asyncio
async def test_only_the_tournament_lead_sets_a_minimum(flow):
    _lead, event = await setup(flow)
    flow.act_as(await person(flow, "paula"))
    response = await flow.patch(f"/api/events/{event['id']}", json={"min_registrations": minimum()})
    assert response.status_code == 403
    assert "min_registrations" not in await flow.db.events.find_one({"id": event["id"]}, {"_id": 0})


# --------------------------------------------------------------------------- Zählen und Sichtbarkeit
@pytest.mark.asyncio
@pytest.mark.parametrize("count_companions, have", [(True, 5), (False, 2)])
async def test_companions_count_only_when_set_and_the_waitlist_never(flow, count_companions, have):
    lead, event = await setup(flow, max_participants=5, min_registrations=minimum(5, count_companions=count_companions))
    await register(flow, event, await person(flow, "paula"), companions=3)
    await register(flow, event, await person(flow, "max"), companions=0)
    waiting = await register(flow, event, await person(flow, "otto"), companions=1)
    assert waiting["status"] == "waitlist"
    view = (await admin_view(flow, lead, event))["minimum"]
    assert view["have"] == have and view["companions"] == (3 if count_companions else 0)
    assert view["state"] == ("reached" if have >= 5 else "open")


@pytest.mark.asyncio
async def test_event_page_shows_the_state_when_public_and_hides_it_otherwise(flow):
    lead, event = await setup(flow, min_registrations=minimum(8))
    await register(flow, event, await person(flow, "paula"), companions=2)
    flow.act_as(None)
    shown = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert shown["minimum"]["count"] == 8 and shown["minimum"]["have"] == 3 and shown["minimum"]["missing"] == 5
    assert "proposal" not in shown["minimum"] and "min_registrations_notice" not in shown
    flow.act_as(lead)
    await flow.patch(f"/api/events/{event['id']}", json={"min_registrations": minimum(8, public=False)})
    flow.act_as(await person(flow, "max"))
    hidden = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert "minimum" not in hidden and "min_registrations" not in hidden
    listed = (await flow.get("/api/events")).json()
    assert all("minimum" not in row and "min_registrations" not in row for row in listed)
    assert (await admin_view(flow, lead, event))["minimum"]["have"] == 3


@pytest.mark.asyncio
async def test_view_turns_short_only_once_the_deadline_has_passed(flow):
    lead, event = await setup(flow, min_registrations=minimum(4))
    flow.clock["now"] = BEFORE
    assert (await admin_view(flow, lead, event))["minimum"]["state"] == "open"
    flow.clock["now"] = DEADLINE
    view = (await admin_view(flow, lead, event))["minimum"]
    assert view["state"] == "short" and view["deadline_passed"] is True


# --------------------------------------------------------------------------- Hinweis an die Verwaltung
@pytest.mark.asyncio
async def test_no_notice_before_the_deadline(flow):
    await setup(flow, min_registrations=minimum(4))
    assert (await shortfall_sweep(flow.db, now=BEFORE))["told"] == 0
    assert await notices(flow) == []


@pytest.mark.asyncio
async def test_notice_at_the_deadline_goes_to_the_lead_only_and_cancels_nothing(flow):
    lead, event = await setup(flow, min_registrations=minimum(4))
    paula = await person(flow, "paula")
    await register(flow, event, paula, companions=1)
    result = await shortfall_sweep(flow.db, now=DEADLINE)
    assert result == {"checked": 1, "told": 1}
    told = await notices(flow)
    assert [row["user_id"] for row in told] == [lead["id"]]
    assert "2 von mindestens 4 Personen" in told[0]["body"] and "nicht von selbst abgesagt" in told[0]["body"]
    assert told[0]["url"] == f"/admin/events/{event['id']}"
    stored = await flow.db.events.find_one({"id": event["id"]}, {"_id": 0})
    assert stored["status"] == "registration_open"
    assert stored["min_registrations_notice"]["have"] == 2
    assert (await flow.db.event_registrations.find_one({"user_id": paula["id"]}, {"_id": 0}))["status"] == "registered"
    assert await flow.db.audit_logs.count_documents({"action": "event.minimum_short"}) == 1


@pytest.mark.asyncio
async def test_no_notice_when_the_minimum_is_reached(flow):
    _lead, event = await setup(flow, min_registrations=minimum(2))
    await register(flow, event, await person(flow, "paula"), companions=1)
    assert (await shortfall_sweep(flow.db, now=DEADLINE))["told"] == 0
    assert await notices(flow) == []


@pytest.mark.asyncio
async def test_notice_only_once_on_repeated_runs(flow):
    await setup(flow, min_registrations=minimum(4))
    first = await shortfall_sweep(flow.db, now=DEADLINE)
    second = await shortfall_sweep(flow.db, now=DEADLINE + timedelta(minutes=15))
    assert (first["told"], second["told"]) == (1, 0)
    assert len(await notices(flow)) == 1


@pytest.mark.asyncio
async def test_notice_only_once_when_two_runs_meet(flow):
    await setup(flow, min_registrations=minimum(4))
    gate = InterleavedReads(flow.db, "events", before=("update_one",))
    results = await asyncio.gather(shortfall_sweep(gate, now=DEADLINE), shortfall_sweep(gate, now=DEADLINE))
    assert sorted(result["told"] for result in results) == [0, 1]
    assert len(await notices(flow)) == 1
    assert await flow.db.audit_logs.count_documents({"action": "event.minimum_short"}) == 1


@pytest.mark.asyncio
async def test_a_lead_missed_in_one_run_gets_the_notice_in_the_next(flow, monkeypatch):
    """Erst benachrichtigen, dann die Marke: Fällt eine Leitung aus, holt der nächste Lauf sie nach - die andere nicht doppelt."""
    from services import user_notifications

    await setup(flow, min_registrations=minimum(4))
    await person(flow, "zweite", role="tournament_admin")
    real = user_notifications.create_user_notification
    calls = {"n": 0}

    async def flaky(user_id, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("Datenbank kurz weg")
        return await real(user_id, *args, **kwargs)

    monkeypatch.setattr(user_notifications, "create_user_notification", flaky)
    first = await shortfall_sweep(flow.db, now=DEADLINE)
    assert first["told"] == 1 and len(await notices(flow)) == 1
    monkeypatch.setattr(user_notifications, "create_user_notification", real)
    second = await shortfall_sweep(flow.db, now=DEADLINE + timedelta(minutes=15))
    assert second["told"] == 1
    assert len({row["user_id"] for row in await notices(flow)}) == len(await notices(flow)) == 2
    assert (await shortfall_sweep(flow.db, now=DEADLINE + timedelta(minutes=30)))["told"] == 0
    assert await flow.db.audit_logs.count_documents({"action": "event.minimum_short"}) == 1


@pytest.mark.asyncio
async def test_a_lead_without_the_active_field_is_told_too(flow):
    lead, _event = await setup(flow, min_registrations=minimum(4))
    await flow.db.users.update_one({"id": lead["id"]}, {"$unset": {"is_active": ""}})
    assert (await shortfall_sweep(flow.db, now=DEADLINE))["told"] == 1


@pytest.mark.asyncio
async def test_without_companions_allowed_it_says_registrations(flow):
    lead, event = await setup(flow, allow_companions=False, max_companions_per_registration=0, min_registrations=minimum(4))
    view = (await admin_view(flow, lead, event))["minimum"]
    assert view["count_companions"] is False
    await shortfall_sweep(flow.db, now=DEADLINE)
    assert "0 von mindestens 4 Anmeldungen" in (await notices(flow))[0]["body"]


@pytest.mark.asyncio
async def test_a_hidden_minimum_keeps_its_numbers_out_of_the_proposal(flow):
    lead, event = await setup(flow, min_registrations=minimum(8, public=False))
    flow.clock["now"] = DEADLINE + timedelta(minutes=1)
    proposal = (await admin_view(flow, lead, event))["minimum"]["proposal"]
    assert proposal == event_minimum.PROPOSAL_HIDDEN
    assert not any(char.isdigit() for char in proposal)


@pytest.mark.asyncio
async def test_a_moved_deadline_gets_its_own_notice(flow):
    lead, event = await setup(flow, min_registrations=minimum(4))
    await shortfall_sweep(flow.db, now=DEADLINE)
    later = DEADLINE + timedelta(days=3)
    flow.act_as(lead)
    moved = await flow.patch(f"/api/events/{event['id']}", json={"min_registrations": minimum(4, deadline=later)})
    assert moved.status_code == 200, moved.text
    assert (await shortfall_sweep(flow.db, now=DEADLINE + timedelta(days=1)))["told"] == 0
    assert (await shortfall_sweep(flow.db, now=later))["told"] == 1
    assert len(await notices(flow)) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["cancelled", "draft", "completed"])
async def test_no_notice_for_settled_events(flow, status):
    _lead, event = await setup(flow, min_registrations=minimum(4))
    await flow.db.events.update_one({"id": event["id"]}, {"$set": {"status": status}})
    assert (await shortfall_sweep(flow.db, now=DEADLINE))["checked"] == 0
    assert await notices(flow) == []


@pytest.mark.asyncio
async def test_no_notice_once_the_event_has_begun(flow):
    await setup(flow, min_registrations=minimum(4))
    assert (await shortfall_sweep(flow.db, now=START))["checked"] == 0
    assert await notices(flow) == []


# --------------------------------------------------------------------------- Absagen
@pytest.mark.asyncio
async def test_cancelling_an_event_with_minimum_needs_a_reason(flow):
    lead, event = await setup(flow, min_registrations=minimum(4))
    await register(flow, event, await person(flow, "paula"))
    flow.act_as(lead)
    for body in ({"status": "cancelled"}, {"status": "cancelled", "cancel_reason": " kurz "}):
        response = await flow.patch(f"/api/events/{event['id']}", json=body)
        assert response.status_code == 422 and response.json()["detail"] == event_minimum.REASON_SHORT
    stored = await flow.db.events.find_one({"id": event["id"]}, {"_id": 0})
    assert stored["status"] == "registration_open" and "cancel_reason" not in stored
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == 0


@pytest.mark.asyncio
async def test_only_the_tournament_lead_cancels(flow):
    _lead, event = await setup(flow, min_registrations=minimum(4))
    flow.act_as(await person(flow, "paula"))
    response = await flow.patch(f"/api/events/{event['id']}", json={"status": "cancelled", "cancel_reason": REASON})
    assert response.status_code == 403
    assert (await flow.db.events.find_one({"id": event["id"]}, {"_id": 0}))["status"] == "registration_open"


@pytest.mark.asyncio
async def test_cancelling_with_reason_tells_everyone_exactly_once(flow, monkeypatch):
    from routes import event_routes

    lead, event = await setup(flow, max_participants=3, min_registrations=minimum(3, count_companions=False))
    people = [await person(flow, name) for name in ("paula", "max", "otto", "lena")]
    for user in people:
        await register(flow, event, user)  # lena landet auf der Warteliste - auch sie hört von der Absage
    await shortfall_sweep(flow.db, now=DEADLINE)
    gate = InterleavedReads(flow.db, "events", before=("update_one",))
    monkeypatch.setattr(event_routes, "get_db", lambda: gate)
    flow.act_as(lead)
    body = {"status": "cancelled", "cancel_reason": REASON}
    first, second = await asyncio.gather(flow.patch(f"/api/events/{event['id']}", json=body),
                                         flow.patch(f"/api/events/{event['id']}", json=body))
    assert [first.status_code, second.status_code] == [200, 200]
    assert ["cancellation" in first.json(), "cancellation" in second.json()].count(True) == 1

    notes = await flow.db.notifications.find({"kind": "event_message"}, {"_id": 0}).to_list(None)
    assert sorted(note["user_id"] for note in notes) == sorted(user["id"] for user in people)
    assert all(f"Grund: {REASON}" in note["body"] for note in notes)
    mails = await flow.db.mail_jobs.find({"template_key": "event_cancelled"}, {"_id": 0}).to_list(None)
    assert sorted(mail["to"] for mail in mails) == sorted(user["email"] for user in people)
    assert all(REASON in mail["html"] for mail in mails)
    stored = await flow.db.events.find_one({"id": event["id"]}, {"_id": 0})
    assert stored["status"] == "cancelled" and stored["cancel_reason"] == REASON
    audit = await flow.db.audit_logs.find_one({"action": "event.cancel"}, {"_id": 0})
    assert audit["data"]["reason"] == REASON
    # Der Job meldet ein abgesagtes Event nicht mehr - und schickt niemandem etwas nach.
    assert (await shortfall_sweep(flow.db, now=DEADLINE + timedelta(hours=1)))["checked"] == 0
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == len(people)
    flow.act_as(None)
    assert (await flow.get(f"/api/events/{event['slug']}")).json()["cancel_reason"] == REASON


@pytest.mark.asyncio
async def test_taking_back_the_cancellation_clears_its_reason(flow):
    lead, event = await setup(flow, min_registrations=minimum(4))
    flow.act_as(lead)
    await flow.patch(f"/api/events/{event['id']}", json={"status": "cancelled", "cancel_reason": REASON})
    response = await flow.patch(f"/api/events/{event['id']}", json={"status": "registration_open"})
    assert response.status_code == 200 and response.json()["cancel_reason"] is None
