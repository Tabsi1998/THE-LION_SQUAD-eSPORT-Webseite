"""Events an mehreren Standorten (#203) und Karte aus der Adresse (#204): Standorte speichern, der
erste spiegelt in die alten Felder, bestehende Events sehen aus wie vorher, die Karte sucht die Adresse."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import event_locations  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def test_existing_events_are_one_location_and_the_map_searches_the_address():
    event = {"location": "Vereinsheim", "address": "Bahnhofstraße 1", "postal_code": "6410", "city": "Telfs", "country": "Österreich", "start_date": "2026-10-31T15:00:00Z"}
    places = event_locations.event_locations(event)
    assert len(places) == 1 and places[0]["name"] == "Vereinsheim" and places[0]["start_date"] == "2026-10-31T15:00:00Z"
    assert event_locations.map_query(places[0]) == "Bahnhofstraße 1, 6410 Telfs, Österreich", "der Name sucht nicht mit (#204)"
    assert event_locations.map_query({"name": "Vereinsheim"}) == "Vereinsheim", "ohne Adresse bleibt der Name als Rückfall"
    assert event_locations.event_locations({"name": "Online-Abend"}) == [], "ohne Ort keine Standorte"
    with pytest.raises(ValueError, match="Name oder Adresse"):
        event_locations.normalize_locations([{"note": "nur eine Notiz"}])


@pytest.mark.asyncio
async def test_locations_are_saved_ordered_mirrored_and_shown(flow):
    admin = await flow.add_user(role="tournament_admin", name="tl")
    flow.act_as(admin)
    start = (now_utc() + timedelta(days=20)).replace(microsecond=0)
    created = await flow.post("/api/events", json={
        "name": "Vereinsausflug", "status": "scheduled", "visibility": "public", "start_date": start.isoformat(),
        "locations": [
            {"name": "Treffpunkt Vereinsheim", "address": "Bahnhofstraße 1", "postal_code": "6410", "city": "Telfs", "country": "Österreich", "door_time": (start - timedelta(hours=1)).isoformat(), "max_participants": 30},
            {"name": "Kartbahn", "city": "Innsbruck", "start_date": (start + timedelta(hours=2)).isoformat(), "note": "Fahrt mit dem Bus"},
        ],
    })
    assert created.status_code == 200, created.text
    event = created.json()
    assert [p["key"] for p in event["locations"]] == ["ort-1", "ort-2"]
    assert event["location"] == "Treffpunkt Vereinsheim" and event["city"] == "Telfs", "der erste Standort steht auch in den alten Feldern"

    flow.act_as(None)
    view = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert len(view["locations"]) == 2
    first, second = view["locations"]
    assert first["address_line"] == "Bahnhofstraße 1, 6410 Telfs, Österreich" and first["map_query"] == first["address_line"]
    assert first["start_date"] == start.isoformat(), "ohne eigene Zeit gilt die des Events"
    assert first["max_participants"] == 30
    assert second["map_query"] == "Innsbruck" and second["note"] == "Fahrt mit dem Bus"
    assert second["start_date"] == (start + timedelta(hours=2)).isoformat()
    assert view["map_query"] == first["address_line"]

    # Umsortieren: der neue erste Standort spiegelt in die alten Felder.
    flow.act_as(admin)
    reordered = await flow.put(f"/api/events/{event['id']}", json={"locations": [event["locations"][1], event["locations"][0]]})
    assert reordered.status_code == 200, reordered.text
    assert reordered.json()["location"] == "Kartbahn" and reordered.json()["city"] == "Innsbruck"
    assert [p["order"] for p in reordered.json()["locations"]] == [0, 1]

    bad = await flow.put(f"/api/events/{event['id']}", json={"locations": [{"note": "x"}]})
    assert bad.status_code == 400 and "Name oder Adresse" in bad.json()["detail"]

    # Ein Event ohne Standortliste sieht aus wie vorher: ein Standort aus den alten Feldern.
    old = await flow.post("/api/events", json={"name": "Alt", "status": "scheduled", "visibility": "public", "location": "Vereinsheim", "city": "Telfs", "start_date": start.isoformat()})
    flow.act_as(None)
    old_view = (await flow.get(f"/api/events/{old.json()['slug']}")).json()
    assert [p["name"] for p in old_view["locations"]] == ["Vereinsheim"] and old_view["map_query"] == "Telfs"
