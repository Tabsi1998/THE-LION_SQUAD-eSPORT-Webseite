"""Mehrtägige Events (#884) über die echte Anwendung: Tage anlegen und ändern, Beginn und Ende ergeben sich aus dem
ersten und letzten Tag, Listen und Detailseite tragen den Plan, Turniere unter dem Event nennen ihren Tag, ein
eintägiges Event bleibt, wie es ist."""
import pathlib
import sys
from datetime import date, timedelta

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


def weekend(offset_days=20):
    friday = date.today() + timedelta(days=offset_days)
    return [
        {"date": friday.isoformat(), "start": "18:00", "end": "23:00", "door": "17:00", "title": "Warm-up"},
        {"date": (friday + timedelta(days=1)).isoformat(), "start": "10:00", "end": "22:00", "location_key": "ort-1"},
        {"date": (friday + timedelta(days=2)).isoformat(), "start": "10:00", "end": "16:00", "title": "Finaltag"},
    ]


@pytest.mark.asyncio
async def test_days_define_the_range_and_show_up_everywhere(flow):
    admin = await flow.add_user(role="tournament_admin", name="tl")
    flow.act_as(admin)
    days = weekend()
    created = await flow.post("/api/events", json={
        "name": "LAN-Wochenende", "status": "scheduled", "visibility": "public", "has_registration": True,
        "locations": [{"name": "Vereinsheim", "city": "Telfs"}],
        "days": list(reversed(days)),
    })
    assert created.status_code == 200, created.text
    event = created.json()
    assert [day["date"] for day in event["days"]] == [day["date"] for day in days], "geordnet nach Beginn"
    assert event["start_date"] == event["days"][0]["start_at"] and event["end_date"] == event["days"][-1]["end_at"]
    assert event["door_time"] == event["days"][0]["door_at"]
    assert event["schedule"]["count"] == 3 and event["schedule"]["label"].startswith("3 Tage · ")
    assert event["schedule"]["days"][1]["location_name"] == "Vereinsheim"

    # Ein Turnier am Samstag nennt auf der Event-Seite seinen Tag.
    saturday_start = f"{days[1]['date']}T12:00:00+02:00"
    await flow.db.games.insert_one({"id": "g1", "name": "Rocket League", "slug": "rocket-league"})
    tournament = await flow.post("/api/tournaments", json={"title": "Samstags-Cup", "game_id": "g1", "format": "single_elim", "event_id": event["id"], "start_date": saturday_start, "status": "scheduled", "visibility": "public", "is_public": True})
    assert tournament.status_code in (200, 201), tournament.text

    flow.act_as(None)
    view = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert view["schedule"]["now"]["state"] == "before" and view["schedule"]["now"]["text"].startswith("Beginnt am ")
    assert view["public_phase"]["state"] in {"announced", "registration_open"}
    assert view["tournaments"][0]["event_day"] == {"index": 2, "count": 3, "label": view["schedule"]["days"][1]["label"], "date": days[1]["date"]}

    listed = (await flow.get("/api/events?compact=true")).json()
    row = next(item for item in listed if item["id"] == event["id"])
    assert row["schedule"]["count"] == 3 and row["schedule"]["range_label"] == view["schedule"]["range_label"]

    # Ändern ohne `days`: Beginn und Ende bleiben die der Tage, auch wenn ein altes Formular sie mitschickt.
    flow.act_as(admin)
    stale = await flow.put(f"/api/events/{event['id']}", json={"description": "Drei Tage LAN", "start_date": "2030-01-01T10:00:00+00:00"})
    assert stale.status_code == 200 and stale.json()["start_date"] == event["start_date"]
    assert stale.json()["description"] == "Drei Tage LAN"

    # Fehler sind Sätze fürs Formular.
    bad = await flow.put(f"/api/events/{event['id']}", json={"days": [days[0], {**days[0]}]})
    assert bad.status_code == 400 and "Jeder Tag kommt nur einmal vor" in bad.json()["detail"]
    bad = await flow.put(f"/api/events/{event['id']}", json={"days": [days[0], {**days[1], "location_key": "fremd"}]})
    assert bad.status_code == 400 and "Standort" in bad.json()["detail"]

    # Zurück auf einen Tag: leere Liste, Beginn und Ende aus der Anfrage gelten wieder.
    single_start = f"{days[0]['date']}T18:00:00+02:00"
    single = await flow.put(f"/api/events/{event['id']}", json={"days": [], "start_date": single_start, "end_date": f"{days[0]['date']}T23:00:00+02:00"})
    assert single.status_code == 200, single.text
    assert single.json()["days"] == [] and single.json()["schedule"] is None
    assert single.json()["start_date"].startswith(days[0]["date"])


@pytest.mark.asyncio
async def test_single_day_events_are_untouched(flow):
    admin = await flow.add_user(role="tournament_admin", name="tl")
    flow.act_as(admin)
    start = (now_utc() + timedelta(days=5)).replace(microsecond=0)
    created = await flow.post("/api/events", json={"name": "Stammtisch", "status": "scheduled", "visibility": "public", "start_date": start.isoformat()})
    assert created.status_code == 200, created.text
    event = created.json()
    assert "days" not in event or not event["days"]
    assert event["schedule"] is None
    flow.act_as(None)
    view = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert view["schedule"] is None and view["start_date"] == start.isoformat()


@pytest.mark.asyncio
async def test_days_reach_calendar_home_app_and_daily_center(flow):
    from services.daily_center import club_day_window, today_items
    from services.event_days import VIENNA, derived_range, normalize_days

    admin = await flow.add_user(role="tournament_admin", name="tl")
    flow.act_as(admin)
    today = now_utc().astimezone(VIENNA).date()
    # Tag 1 war gestern, Tag 2 ist morgen: das Event „läuft“, steckt aber gerade in der Pause zwischen zwei Tagen.
    days = [
        {"date": (today - timedelta(days=1)).isoformat(), "start": "10:00", "end": "12:00"},
        {"date": (today + timedelta(days=1)).isoformat(), "start": "10:00", "end": "12:00"},
        {"date": (today + timedelta(days=2)).isoformat(), "start": "10:00", "end": "16:00"},
    ]
    created = await flow.post("/api/events", json={"name": "Herbst-LAN", "status": "scheduled", "visibility": "public", "days": days})
    assert created.status_code == 200, created.text
    event = created.json()
    await flow.db.events.update_one({"id": event["id"]}, {"$set": {"status": "live"}})   # so setzt es der Planer am ersten Tag

    flow.act_as(None)
    # Kalender: je Tag ein Termin mit dem Weg zur einen Event-Seite, keiner für das ganze Event.
    items = {item["id"]: item for item in (await flow.get("/api/calendar")).json()["items"] if item["id"].startswith(event["id"])}
    assert event["id"] not in items
    second = items[f"{event['id']}-tag-2"]
    assert second["title"] == "Herbst-LAN – Tag 2/3" and second["marker"] == "event_day" and second["path"] == f"/events/{event['slug']}"
    assert second["start"] == event["days"][1]["start_at"] and second["end"] == event["days"][1]["end_at"]

    # Die ICS-Datei des Events trägt je Tag einen Eintrag mit Erinnerung.
    ics = await flow.get(f"/api/calendar/events/{event['slug']}.ics")
    assert ics.status_code == 200 and ics.text.count("BEGIN:VEVENT") == 3 and ics.text.count("BEGIN:VALARM") == 3
    assert "Herbst-LAN – Tag 2/3" in ics.text and 'filename="herbst-lan.ics"' in ics.headers["content-disposition"]

    # Startseite: in der Pause nicht unter „läuft“, sondern unter „bald“ mit dem nächsten Tag.
    state = (await flow.get("/api/home/state")).json()
    assert event["id"] not in {row["id"] for row in state["live"]["events"]}
    soon = next(row for row in state["soon"]["events"] if row["id"] == event["id"])
    assert soon["public_phase"]["state"] == "day_break" and soon["public_phase"]["label"] == "Tag 2/3"
    assert soon["schedule"]["now"] == {"state": "break", "day_index": 2, "text": "Tag 2 beginnt morgen um 10:00"}

    # App: die Übersicht trägt den Plan.
    data = (await flow.get("/api/mobile/dashboard")).json()
    row = next(item for item in data["public"]["events"] if item["id"] == event["id"])
    assert row["schedule"]["count"] == 3 and row["schedule"]["now"]["state"] == "break"

    # Tageszentrale: ohne Tag heute nicht in „heute“, obwohl der Zeitraum den Tag umfasst; mit Tag heute mit Satz.
    now = now_utc()
    all_day = normalize_days([{"date": today.isoformat(), "start": "00:00", "end": "23:59"}, {"date": (today + timedelta(days=3)).isoformat(), "start": "10:00", "end": "12:00"}])
    await flow.db.events.insert_one({"id": "e-heute", "slug": "heute", "name": "Heute dabei", "status": "live", "visibility": "public", "days": all_day, **derived_range(all_day)})
    titles = [item["title"] for item in await today_items(flow.db, now)]
    assert titles == ["Heute dabei · Heute 00:00–23:59"], titles
    assert club_day_window(now)[0] <= now
