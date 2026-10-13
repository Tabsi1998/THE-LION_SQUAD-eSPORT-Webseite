"""Anmeldungen & Einlass (#1372): die Arbeitsseite der Turnierleitung für die Anmeldungen eines Events.

Geprüft wird über die echten Routen: wer die Liste sieht (nur die Turnierleitung), was sie zeigt (Mail-Adressen nur
gekürzt), Suche und Filter „noch nicht da“, Einchecken samt „Rückgängig“ und Nachrücken mit Platzprüfung über den
vorhandenen Weg - und „Nachricht an alle“: nur nach Bestätigung der Empfängerzahl, genau einmal je angemeldeter Person,
mit Protokoll. Namen und Adressen sind erfunden.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import event_lead  # noqa: E402


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


async def create_event(flow, admin, **extra):
    flow.act_as(admin)
    payload = {"name": "Herbst-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
               "allow_companions": True, "max_companions_per_registration": 2, "show_participants": False,
               "start_date": (now_utc() + timedelta(days=10)).isoformat(), **extra}
    response = await flow.post("/api/events", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


async def register(flow, event, user, **body):
    flow.act_as(user)
    response = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0, **body})
    assert response.status_code == 200, response.text
    return response.json()


async def setup_event(flow, **extra):
    leitung = await person(flow, "leitung", role="tournament_admin")
    event = await create_event(flow, leitung, **extra)
    paula = await person(flow, "paula", display_name="Paula Brünner")
    max_ = await person(flow, "max", display_name="Max Mustermann")
    zoe = await person(flow, "zoe", display_name="Zoë Adler")
    await register(flow, event, paula, companion_count=1, note="komme später")
    await register(flow, event, max_)
    await register(flow, event, zoe)
    return leitung, event, {"paula": paula, "max": max_, "zoe": zoe}


async def lead(flow, event, **params):
    response = await flow.get(f"/api/events/{event['slug']}/lead", params=params)
    assert response.status_code == 200, response.text
    return response.json()


# --------------------------------------------------------------------------- Rechte
@pytest.mark.asyncio
async def test_only_tournament_lead_sees_the_list(flow):
    leitung, event, people = await setup_event(flow)

    flow.act_as(None)
    assert (await flow.get(f"/api/events/{event['id']}/lead")).status_code == 401
    flow.act_as(people["paula"])
    assert (await flow.get(f"/api/events/{event['id']}/lead")).status_code == 403
    # Der Vorstand (Bereich Vereinsverwaltung) und die Moderation sehen die Arbeitsseite nicht.
    vorstand = await person(flow, "vorstand", areas=["club"])
    flow.act_as(vorstand)
    assert (await flow.get(f"/api/events/{event['id']}/lead")).status_code == 403
    moderator = await person(flow, "moderator", role="moderator")
    flow.act_as(moderator)
    assert (await flow.get(f"/api/events/{event['id']}/lead")).status_code == 403

    # Turnierleitung als Rolle und als Freigabe.
    flow.act_as(leitung)
    response = await flow.get(f"/api/events/{event['slug']}/lead")
    assert response.status_code == 200 and response.headers["cache-control"] == "private, no-store"
    view = response.json()
    assert view["event"]["id"] == event["id"] and view["can_message"] is True
    freigabe = await person(flow, "freigabe", areas=["tournaments"])
    flow.act_as(freigabe)
    assert (await flow.get(f"/api/events/{event['id']}/lead")).status_code == 200


@pytest.mark.asyncio
async def test_list_carries_only_needed_fields_and_masked_mail(flow):
    leitung, event, people = await setup_event(flow)
    flow.act_as(leitung)
    view = await lead(flow, event, filter="all")
    rows = {row["display_name"]: row for row in view["registrations"]}
    paula = rows["Paula Brünner"]
    assert paula["email_masked"] == "p***@lionsquad-test.at"
    assert "email" not in paula and "user_id" not in paula and "price" not in paula
    assert paula["companion_count"] == 1 and paula["seat_count"] == 2 and paula["has_note"] is True
    # Notizen stehen nicht in der Liste - nur der Merker (Codex-Prüfung #1517).
    assert all("note" not in row and "internal_note" not in row for row in view["registrations"])
    assert rows["Max Mustermann"]["has_note"] is False

    # Die Notiz holt die Detailansicht - je Anmeldung, nur für die Turnierleitung.
    detail = await flow.get(f"/api/events/{event['id']}/lead/registrations/{paula['id']}")
    assert detail.status_code == 200 and detail.headers["cache-control"] == "private, no-store"
    assert detail.json()["note"] == "komme später" and detail.json()["email_masked"] == "p***@lionsquad-test.at"
    assert "email" not in detail.json()
    missing = await flow.get(f"/api/events/{event['id']}/lead/registrations/gibt-es-nicht")
    assert missing.status_code == 404
    vorstand = await person(flow, "vorstand", areas=["club"])
    flow.act_as(vorstand)
    denied = await flow.get(f"/api/events/{event['id']}/lead/registrations/{paula['id']}")
    assert denied.status_code == 403
    # Sortiert nach Namen - an der Tür sucht man nach dem Namen.
    assert [row["display_name"] for row in view["registrations"]] == ["Max Mustermann", "Paula Brünner", "Zoë Adler"]
    assert all("@" not in str(value) or key == "email_masked" for row in view["registrations"] for key, value in row.items())


def test_door_rows_leave_out_notes_and_mail():
    """Die eingeschränkte Zeile für den Einlass (#1375 bringt die Freigabe dazu): Name, Status, Plätze, Begleitpersonen."""
    reg = {"id": "r1", "display_name": "Paula", "status": "registered", "companion_count": 2, "email": "paula@example.test",
           "note": "privat", "internal_note": "intern", "user_id": "u1"}
    door = event_lead.registration_row(reg, full=False)
    assert set(door) == {"id", "display_name", "status", "companion_count", "seat_count"}
    assert door["seat_count"] == 3
    full = event_lead.registration_row(reg, full=True)
    assert full["email_masked"] == "p***@example.test" and full["has_note"] is True and "email" not in full
    assert "note" not in full and "internal_note" not in full


# --------------------------------------------------------------------------- Suche und Filter
@pytest.mark.asyncio
async def test_search_and_filter_not_yet_here(flow):
    leitung, event, people = await setup_event(flow)
    flow.act_as(leitung)
    view = await lead(flow, event)
    assert view["counts"]["open"] == 3 and view["counts"]["here"] == 0
    max_row = next(row for row in view["registrations"] if row["display_name"] == "Max Mustermann")

    # Einchecken über den vorhandenen Weg - danach steht Max nicht mehr unter „noch nicht da“.
    checked = await flow.patch(f"/api/events/{event['id']}/registrations/{max_row['id']}", json={"status": "checked_in"})
    assert checked.status_code == 200, checked.text
    view = await lead(flow, event, filter="open")
    assert [row["display_name"] for row in view["registrations"]] == ["Paula Brünner", "Zoë Adler"]
    expected = {"open": 2, "here": 1, "expected": 3, "here_seats": 1, "expected_seats": 4}
    assert view["counts"] == {**view["counts"], **expected}
    assert [row["display_name"] for row in (await lead(flow, event, filter="here"))["registrations"]] == ["Max Mustermann"]

    # Suche: Groß/klein, Umlaute und Teile des Namens.
    found = await lead(flow, event, q="brun", filter="all")
    assert [row["display_name"] for row in found["registrations"]] == ["Paula Brünner"]
    found = await lead(flow, event, q="ZOE", filter="all")
    assert [row["display_name"] for row in found["registrations"]] == ["Zoë Adler"]
    assert (await lead(flow, event, q="paula", filter="here"))["registrations"] == []
    # Nach der Mail-Adresse wird nicht gesucht - sie steht nicht in der Liste.
    assert (await lead(flow, event, q="lionsquad-test", filter="all"))["registrations"] == []

    # „Rückgängig“: zurück auf angemeldet.
    undone = await flow.patch(f"/api/events/{event['id']}/registrations/{max_row['id']}", json={"status": "registered"})
    assert undone.status_code == 200
    assert (await lead(flow, event))["counts"]["here"] == 0


@pytest.mark.asyncio
async def test_unknown_filter_is_refused(flow):
    leitung, event, _ = await setup_event(flow)
    flow.act_as(leitung)
    assert (await flow.get(f"/api/events/{event['id']}/lead", params={"filter": "egal"})).status_code == 400


@pytest.mark.asyncio
async def test_move_up_from_waitlist_checks_the_seats(flow):
    leitung = await person(flow, "leitung", role="tournament_admin")
    event = await create_event(flow, leitung, max_participants=2)
    paula = await person(flow, "paula", display_name="Paula")
    max_ = await person(flow, "max", display_name="Max")
    await register(flow, event, paula, companion_count=1)
    waiting = await register(flow, event, max_)
    assert waiting["status"] == "waitlist"

    flow.act_as(leitung)
    view = await lead(flow, event, filter="waitlist")
    assert [row["display_name"] for row in view["registrations"]] == ["Max"] and view["counts"]["waitlist"] == 1
    full = await flow.patch(f"/api/events/{event['id']}/registrations/{waiting['id']}", json={"status": "registered"})
    assert full.status_code == 400, "kein Platz frei - Nachrücken lehnt der Server ab"
    # Paula bringt niemanden mit: ein Platz wird frei, Max rückt nach.
    paula_row = next(row for row in (await lead(flow, event, filter="all"))["registrations"] if row["display_name"] == "Paula")
    alone = await flow.patch(f"/api/events/{event['id']}/registrations/{paula_row['id']}", json={"companion_count": 0})
    assert alone.status_code == 200
    moved = await flow.patch(f"/api/events/{event['id']}/registrations/{waiting['id']}", json={"status": "registered"})
    assert moved.status_code == 200, moved.text
    assert (await lead(flow, event))["counts"]["waitlist"] == 0


# --------------------------------------------------------------------------- Nachricht an alle
@pytest.mark.asyncio
async def test_message_needs_tournament_lead(flow):
    leitung, event, people = await setup_event(flow)
    vorstand = await person(flow, "vorstand", areas=["club"])
    for who in (people["paula"], vorstand):
        flow.act_as(who)
        response = await flow.post(f"/api/events/{event['id']}/lead/message", json={"text": "Hallo", "confirm_count": 3})
        assert response.status_code == 403
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == 0


@pytest.mark.asyncio
async def test_message_reaches_each_registered_person_once_with_audit(flow):
    leitung, event, people = await setup_event(flow)
    # Warteliste und Abgemeldete bekommen nichts.
    ella = await person(flow, "ella", display_name="Ella")
    await register(flow, event, ella)
    flow.act_as(ella)
    cancelled = await flow.delete(f"/api/events/{event['id']}/registrations/me")
    assert cancelled.status_code == 200
    # Max hat Mails zu Turnier-Updates abbestellt - er bekommt die Nachricht nur im Postfach.
    no_mail = {"notification_preferences": {"email:tournament_updates": False}}
    await flow.db.users.update_one({"id": people["max"]["id"]}, {"$set": no_mail})

    flow.act_as(leitung)
    view = await lead(flow, event)
    assert view["message_recipients"] == 3

    # Ohne die bestätigte Zahl geht nichts hinaus.
    url = f"/api/events/{event['id']}/lead/message"
    text = "Parkplatz gesperrt, bitte Hintereingang"
    response = await flow.post(url, json={"text": text})
    assert response.status_code == 422
    response = await flow.post(url, json={"text": text, "confirm_count": 2})
    assert response.status_code == 409 and "3" in response.json()["detail"]
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == 0

    response = await flow.post(url, json={"text": text, "confirm_count": 3})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["recipient_count"] == 3 and result["notified"] == 3 and result["mails"] == 2

    notes = await flow.db.notifications.find({"kind": "event_message"}, {"_id": 0}).to_list(50)
    assert sorted(note["user_id"] for note in notes) == sorted(people[name]["id"] for name in ("paula", "max", "zoe"))
    assert all(note["body"] == text and note["url"] == f"/events/{event['slug']}" for note in notes)
    mails = await flow.db.mail_jobs.find({"template_key": "event_message"}, {"_id": 0, "to": 1, "subject": 1}).to_list(50)
    assert sorted(mail["to"] for mail in mails) == sorted(people[name]["email"] for name in ("paula", "zoe"))
    assert all("Herbst-LAN" in mail["subject"] for mail in mails)

    audit = await flow.db.audit_logs.find_one({"action": "event.message.send"}, {"_id": 0})
    assert audit["actor_id"] == leitung["id"] and audit["target_id"] == event["id"]
    assert audit["data"]["recipient_count"] == 3 and audit["data"]["message_id"] == result["message_id"]
    # Das Protokoll steht auf der Arbeitsseite.
    [logged] = (await lead(flow, event))["messages"]
    assert logged["text"] == text and logged["recipient_count"] == 3


@pytest.mark.asyncio
async def test_message_limits(flow):
    leitung, event, _ = await setup_event(flow)
    flow.act_as(leitung)
    url = f"/api/events/{event['id']}/lead/message"
    empty = await flow.post(url, json={"text": "   ", "confirm_count": 3})
    assert empty.status_code == 400
    too_long = await flow.post(url, json={"text": "x" * (event_lead.MESSAGE_MAX + 1), "confirm_count": 3})
    assert too_long.status_code == 400
    sent = await flow.post(url, json={"text": "Wir starten 15 Minuten später.", "confirm_count": 3})
    assert sent.status_code == 200
    # Ein zweiter Tipp gleich danach schickt nicht noch einmal an alle.
    again = await flow.post(url, json={"text": "Wir starten 15 Minuten später.", "confirm_count": 3})
    assert again.status_code == 429
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == 3


@pytest.mark.asyncio
async def test_message_without_registrations_is_refused(flow):
    leitung = await person(flow, "leitung", role="tournament_admin")
    event = await create_event(flow, leitung)
    flow.act_as(leitung)
    response = await flow.post(f"/api/events/{event['id']}/lead/message", json={"text": "Hallo", "confirm_count": 0})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_blocked_deactivated_and_erased_accounts_get_nothing(flow):
    """Codex-Prüfung #1517: gesperrte, deaktivierte und gelöschte Konten zählen nicht und bekommen nichts."""
    leitung, event, people = await setup_event(flow)
    gesperrt = await person(flow, "gesperrt", display_name="Gesperrt")
    aus = await person(flow, "aus", display_name="Deaktiviert")
    weg = await person(flow, "weg", display_name="Gelöscht")
    for who in (gesperrt, aus, weg):
        await register(flow, event, who)
    await flow.db.users.update_one({"id": gesperrt["id"]}, {"$set": {"is_banned": True}})
    await flow.db.users.update_one({"id": aus["id"]}, {"$set": {"is_active": False}})
    await flow.db.users.update_one({"id": weg["id"]}, {"$set": {"anonymized_at": now_utc().isoformat()}})

    flow.act_as(leitung)
    assert (await lead(flow, event))["message_recipients"] == 3
    response = await flow.post(f"/api/events/{event['id']}/lead/message", json={"text": "Hallo", "confirm_count": 3})
    assert response.status_code == 200, response.text
    reached = {note["user_id"] for note in await flow.db.notifications.find({"kind": "event_message"}, {"_id": 0}).to_list(50)}
    assert reached == {people[name]["id"] for name in ("paula", "max", "zoe")}
    mails = {mail["to"] for mail in await flow.db.mail_jobs.find({"template_key": "event_message"}, {"_id": 0, "to": 1}).to_list(50)}
    assert not mails & {gesperrt["email"], aus["email"], weg["email"]}


@pytest.mark.asyncio
async def test_one_message_per_minute_per_sender_across_events(flow):
    """Codex-Prüfung #1517: die Sperre gilt auch je Absender - ein zweites Event umgeht sie nicht."""
    leitung, event, people = await setup_event(flow)
    second = await create_event(flow, leitung, name="Winter-LAN")
    await register(flow, second, people["paula"])
    flow.act_as(leitung)
    first = await flow.post(f"/api/events/{event['id']}/lead/message", json={"text": "Hallo", "confirm_count": 3})
    assert first.status_code == 200
    other = await flow.post(f"/api/events/{second['id']}/lead/message", json={"text": "Hallo", "confirm_count": 1})
    assert other.status_code == 429
    # Eine andere Leitung darf beim zweiten Event schreiben.
    kollegin = await person(flow, "kollegin", role="tournament_admin")
    flow.act_as(kollegin)
    allowed = await flow.post(f"/api/events/{second['id']}/lead/message", json={"text": "Hallo", "confirm_count": 1})
    assert allowed.status_code == 200, allowed.text


@pytest.mark.asyncio
async def test_stored_false_per_channel_is_respected(flow):
    """Punkt 5 der Codex-Prüfung: die Nachricht folgt den Einstellungen - ein gespeichertes false je Kanal greift."""
    leitung, event, people = await setup_event(flow)
    # Paula: Postfach und Push für Turnier-Updates aus - keine Benachrichtigung, die Mail kommt.
    off_inbox = {"in_app:tournament_updates": False, "push:tournament_updates": False}
    await flow.db.users.update_one({"id": people["paula"]["id"]}, {"$set": {"notification_preferences": off_inbox}})
    # Max: Mail ganz aus - Benachrichtigung ja, Mail nein.
    off_mail = {"email": False}
    await flow.db.users.update_one({"id": people["max"]["id"]}, {"$set": {"notification_preferences": off_mail}})

    flow.act_as(leitung)
    response = await flow.post(f"/api/events/{event['id']}/lead/message", json={"text": "Hallo", "confirm_count": 3})
    assert response.status_code == 200
    assert response.json()["notified"] == 2 and response.json()["mails"] == 2
    reached = {note["user_id"] for note in await flow.db.notifications.find({"kind": "event_message"}, {"_id": 0}).to_list(50)}
    assert reached == {people["max"]["id"], people["zoe"]["id"]}
    mails = {mail["to"] for mail in await flow.db.mail_jobs.find({"template_key": "event_message"}, {"_id": 0, "to": 1}).to_list(50)}
    assert mails == {people["paula"]["email"], people["zoe"]["email"]}
