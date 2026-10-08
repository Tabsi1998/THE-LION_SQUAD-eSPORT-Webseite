"""Helfer-Aufruf (#1197) mit dem Fake des Vereinsmoduls: nur der Vorstand ruft, nur Mitglieder bekommen den Aufruf,
das Thema lässt sich abschalten, höchstens ein Aufruf je Event und Tag, „Ich helfe“ führt zur richtigen Schicht und die
Erinnerung am Vortag geht nur an Bestätigte. Die Uhr des Vereins steht fest (25.09.2026). Erfundene Daten."""
import pathlib
import sys
from datetime import date

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member, pin_club_clock  # noqa: E402

from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, dolibarr_identity, helper_calls  # noqa: E402
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
    dolibarr_identity.reset_cache()
    pin_club_clock(monkeypatch)
    return instance


async def connect(flow):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)


async def bound_member(flow, fake, name, member_id, *, role="player", prefs=None):
    user = await flow.add_user(role=role, name=name)
    if prefs is not None:
        await flow.db.users.update_one({"id": user["id"]}, {"$set": {"notification_preferences": prefs}})
    await flow.db.memberships.insert_one({"user_id": user["id"], "member_status": "active"})
    fake.add(member(member_id), email=f"{name}@example.test")
    fake.invite(f"CODE{member_id}", member_id, capabilities=("documents", "events"))
    flow.act_as(user)
    response = await flow.post("/api/membership/me/identity", json={"code": f"CODE{member_id}"})
    assert response.status_code == 200 and response.json()["status"] == "bound", response.text
    return user


def seed(fake):
    fake.add_event(5, label="Herbst-LAN", day="2026-09-26", end_day="2026-09-27", shifts=[
        {"id": 51, "label": "Einlass", "day": "2026-09-26", "start": "09:00", "end": "13:00", "capacity": 3},
        {"id": 52, "label": "Abbau", "day": "2026-09-27", "start": "14:00", "end": "18:00", "capacity": 2},
        {"id": 53, "label": "Aufbau", "day": "2026-09-25", "start": "16:00", "end": "20:00", "capacity": 1},
    ])


@pytest.mark.asyncio
async def test_board_calls_members_once_a_day_and_the_topic_can_be_switched_off(flow, fake):
    await connect(flow)
    seed(fake)
    board = await bound_member(flow, fake, "vorstand", 10, role="club_admin")
    paula = await bound_member(flow, fake, "paula", 12)
    # „leise“ hat das Thema ausgeschaltet und darf nichts bekommen.
    await bound_member(flow, fake, "leise", 13, prefs={"in_app:helper_shifts": False, "push:helper_shifts": False, "discord:helper_shifts": False})
    guest = await flow.add_user(role="player", name="gast")   # kein Mitglied
    fake.confirm_shift(5, 51, 13)

    flow.act_as(paula)
    assert (await flow.get("/api/membership/helper-calls")).status_code == 403, "nur der Vorstand ruft"

    flow.act_as(board)
    view = (await flow.get("/api/membership/helper-calls")).json()
    event = view["events"][0]
    assert event["label"] == "Herbst-LAN" and [s["id"] for s in event["open_shifts"]] == [51, 52, 53]
    assert event["open_places"] == 5 and event["can_call"] is True
    assert event["text"] == "Es fehlen noch 5 Helfer: Sa 9–13 Uhr Einlass, So 14–18 Uhr Abbau, Fr 16–20 Uhr Aufbau."

    sent = await flow.post("/api/membership/helper-calls/5")
    assert sent.status_code == 200 and sent.json()["recipients"] == 2, "Paula und die Leise - nicht der Vorstand selbst, nie Gäste"
    notes = await flow.db.notifications.find({"kind": "helper_call"}, {"_id": 0}).to_list(10)
    assert [n["user_id"] for n in notes] == [paula["id"]], "wer das Thema ausschaltet, bekommt nichts"
    assert notes[0]["title"] == "Helfer gesucht: Herbst-LAN" and notes[0]["url"] == "/members/helfen?event=5"
    assert guest["id"] not in {n["user_id"] for n in notes}

    again = await flow.post("/api/membership/helper-calls/5")
    assert again.status_code == 429 and "heute schon" in again.json()["detail"]
    assert (await flow.get("/api/membership/helper-calls")).json()["events"][0]["called_today"] is True
    assert (await flow.post("/api/membership/helper-calls/99")).status_code == 404

    # „Ich helfe“ fragt über den bestehenden Weg an - die richtige Schicht.
    flow.act_as(paula)
    requested = (await flow.put("/api/membership/me/events/5/shifts/52")).json()
    assert next(s for s in requested["shifts"] if s["id"] == 52)["mine"] == "requested"


@pytest.mark.asyncio
async def test_full_events_need_no_call(flow, fake):
    await connect(flow)
    fake.add_event(6, label="Voll-LAN", day="2026-09-30", shifts=[{"id": 61, "label": "Technik", "day": "2026-09-30", "start": "10:00", "end": "12:00", "capacity": 1}])
    board = await bound_member(flow, fake, "vorstand", 10, role="club_admin")
    fake.confirm_shift(6, 61, 10)
    flow.act_as(board)
    assert (await flow.get("/api/membership/helper-calls")).json()["events"][0]["can_call"] is False
    full = await flow.post("/api/membership/helper-calls/6")
    assert full.status_code == 409 and "besetzt" in full.json()["detail"]


@pytest.mark.asyncio
async def test_reminder_the_day_before_only_for_confirmed(flow, fake):
    await connect(flow)
    seed(fake)
    paula = await bound_member(flow, fake, "paula", 12)
    max_ = await bound_member(flow, fake, "max", 13)
    fake.confirm_shift(5, 51, 12)      # Paula bestätigt, morgen (26.09.)
    fake.request_shift(5, 51, 13)      # Max nur angefragt
    result = await helper_calls.send_reminders(flow.db, today=date(2026, 9, 25))
    assert result["sent"] == 1
    note = await flow.db.notifications.find_one({"kind": "helper_reminder"}, {"_id": 0})
    assert note["user_id"] == paula["id"] and note["title"] == "Morgen hilfst du: Einlass"
    assert "Herbst-LAN · Sa 9–13 Uhr Einlass" in note["body"]
    assert max_["id"] not in {n["user_id"] for n in await flow.db.notifications.find({"kind": "helper_reminder"}, {"_id": 0}).to_list(10)}
    assert (await helper_calls.send_reminders(flow.db, today=date(2026, 9, 25)))["sent"] == 0, "genau einmal"


def test_texts_read_like_people_talk():
    assert helper_calls.shift_line({"day": "2026-10-17", "start": "09:00", "end": "13:30", "label": "Einlass"}) == "Sa 9–13:30 Uhr Einlass"
    assert helper_calls.call_text([{"day": "2026-10-18", "start": "14:00", "end": "18:00", "label": "Abbau", "free": 1}]) == "Es fehlt noch ein Helfer: So 14–18 Uhr Abbau."
