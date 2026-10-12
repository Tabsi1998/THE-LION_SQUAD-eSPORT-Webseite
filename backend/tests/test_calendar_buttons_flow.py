"""Ein Knopf „In den Kalender“ (#1272): ein Tag eines mehrtägigen Events, Fast Laps als Datei, und Versammlungen
sowie eigene Helferschichten nur für die Person selbst - ohne Namen anderer, ohne Zugangslink."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member, pin_club_clock  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import calendar_items, club_calendar, dolibarr_client, dolibarr_identity  # noqa: E402
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


async def bind(flow, code: str) -> None:
    response = await flow.post("/api/membership/me/identity", json={"code": code})
    assert response.status_code == 200 and response.json()["status"] == "bound", response.text


def vevents(text: str) -> int:
    return text.count("BEGIN:VEVENT")


@pytest.mark.asyncio
async def test_one_day_of_a_multi_day_event_and_fastlaps_as_file(flow):
    await flow.db.events.insert_one({
        "id": "e-lan", "slug": "lan", "name": "Herbst-LAN", "status": "scheduled", "visibility": "public",
        "start_date": "2026-11-13T16:00:00+00:00", "end_date": "2026-11-15T20:00:00+00:00",
        "days": [
            {"date": "2026-11-13", "start_at": "2026-11-13T16:00:00+00:00", "end_at": "2026-11-13T22:00:00+00:00"},
            {"date": "2026-11-14", "start_at": "2026-11-14T09:00:00+00:00", "end_at": "2026-11-14T22:00:00+00:00"},
            {"date": "2026-11-15", "start_at": "2026-11-15T09:00:00+00:00", "end_at": "2026-11-15T20:00:00+00:00"},
        ],
    })
    await flow.db.events.insert_one({"id": "e-one", "slug": "abend", "name": "Vereinsabend", "status": "scheduled", "visibility": "public",
                                     "start_date": "2026-11-20T18:00:00+00:00"})
    await flow.db.f1_challenges.insert_many([
        {"id": "f-spa", "slug": "spa", "title": "Fast Lap Spa", "status": "scheduled", "visibility": "public",
         "start_date": "2026-11-14T10:00:00+00:00", "end_date": "2026-11-14T18:00:00+00:00"},
        {"id": "f-intern", "slug": "intern", "title": "Intern", "status": "scheduled", "visibility": "members", "start_date": "2026-11-14T10:00:00+00:00"},
    ])
    flow.act_as(None)

    whole = await flow.get("/api/calendar/events/lan.ics")
    assert whole.status_code == 200 and vevents(whole.text) == 3
    one = await flow.get("/api/calendar/events/lan.ics", params={"day": 2})
    assert one.status_code == 200, one.text
    assert vevents(one.text) == 1 and "Tag 2/3" in one.text and "DTSTART:20261114T090000Z" in one.text
    assert (await flow.get("/api/calendar/events/lan.ics", params={"day": 4})).status_code == 404
    assert (await flow.get("/api/calendar/events/abend.ics", params={"day": 1})).status_code == 404, "eintägig hat keine Tage"

    lap = await flow.get("/api/calendar/fastlaps/spa.ics")
    assert lap.status_code == 200 and "SUMMARY:Fast Lap Spa" in lap.text and "Fast Lap" in lap.text
    assert (await flow.get("/api/calendar/fastlaps/intern.ics")).status_code == 404, "nur Öffentliches als Datei"


@pytest.mark.asyncio
async def test_meeting_and_own_shift_only_for_the_person(flow, fake):
    await connect(flow)
    fake.add(member(12), email="paula@example.test")
    fake.add_meeting(7, invited=[(12, True)], agenda=("Begrüßung", "Bericht des Vorstands"))
    fake.add_meeting(8, kind="board", title="Vorstandssitzung Oktober", day="2026-10-01", format="virtual", invited=[(99, True)])
    fake.add_event(5, label="Sommerfest 2026", day="2026-10-10", place="Vereinsheim", visibility="members", registration=("dolibarr", ""), shifts=[
        {"id": 51, "label": "Aufbau", "day": "2026-10-10", "start": "14:00", "end": "16:00", "capacity": 2},
        {"id": 52, "label": "Bar", "day": "2026-10-10", "start": "22:00", "end": "01:00", "capacity": 1},
    ])
    fake.request_shift(5, 52, 12)
    paula = await flow.add_user(role="player", name="paula")
    paula["is_club_member"] = True

    flow.act_as(None)
    assert (await flow.get("/api/calendar/meetings/7.ics")).status_code == 401, "Gäste bekommen nichts"
    assert (await flow.get("/api/calendar/shifts/5/52.ics")).status_code == 401

    flow.act_as(paula)
    assert (await flow.get("/api/calendar/meetings/7.ics")).status_code == 404, "ohne Weg zur Akte keine Versammlung"

    fake.invite("ALL", 12, capabilities=("documents", "meetings", "events"))
    await bind(flow, "ALL")
    meeting = await flow.get("/api/calendar/meetings/7.ics")
    assert meeting.status_code == 200, meeting.text
    assert "SUMMARY:Generalversammlung 2026" in meeting.text and "DTSTART:20261024T160000Z" in meeting.text
    assert "no-store" in meeting.headers["cache-control"], "Persönliches bleibt in keinem Zwischenspeicher"
    for private in ("meet.example.test", "Bericht des Vorstands", "Paula", "Beispiel"):
        assert private not in meeting.text, f"{private} gehört nicht in die Datei"
    assert (await flow.get("/api/calendar/meetings/8.ics")).status_code == 404, "fremde Vorstandssitzung"

    shift = await flow.get("/api/calendar/shifts/5/52.ics")
    assert shift.status_code == 200, shift.text
    assert "Helferschicht: Bar · Sommerfest 2026" in shift.text
    assert "DTSTART:20261010T200000Z" in shift.text and "DTEND:20261010T230000Z" in shift.text, "über Mitternacht"
    assert (await flow.get("/api/calendar/shifts/5/51.ics")).status_code == 404, "eine freie Schicht ist nicht deine"


def test_meeting_without_time_is_a_whole_day():
    item = club_calendar.meeting_item({"id": 3, "kind": "general", "kind_label": "Generalversammlung", "title": "Generalversammlung 2027",
                                       "day": "2027-03-12", "time": "", "status": "invited", "response": "yes"})
    assert item["all_day"] is True and item["mine"] is True and item["title"] == "Generalversammlung 2027"
    text = calendar_items.ics_single(item, origin="https://lionsquad.at")
    assert "DTSTART;VALUE=DATE:20270312" in text and "DTEND;VALUE=DATE:20270313" in text
    assert "VALARM" not in text, "kein Wecker um 23 Uhr am Vortag"
    assert club_calendar.meeting_item({"id": 3, "day": "kaputt"}) is None
    board = club_calendar.meeting_item({"id": 4, "kind_label": "Vorstandssitzung", "title": "Oktober", "day": "2026-10-01", "time": "19:30"})
    assert board["title"] == "Vorstandssitzung: Oktober" and board["path"] == "/members/meetings?meeting=4" and board["mine"] is False
