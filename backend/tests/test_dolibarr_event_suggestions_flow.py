"""Öffentliche Events aus Dolibarr als Entwurf (#850): Ein öffentliches Event ab heute erscheint unter Admin → Events
als Vorschlag; übernommen ist es ein verknüpfter Entwurf mit Name, Tagen, Ort und Anmeldeweg. Ändert der Vorstand in
Dolibarr Tag, Ort oder sagt ab, kommt das als Unterschied - übernehmen oder ignorieren, nie still überschrieben.
Interne und vergangene Events kommen nicht; ausgeblendete Vorschläge bleiben weg."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, dolibarr_events, dolibarr_identity  # noqa: E402
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
    return instance


async def scene(flow, fake) -> dict:
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1,
    }}, upsert=True)
    fake.add_event(4, label="Winter-Cup", day="2026-12-05", place="Vereinsheim", visibility="public", registration=("external", "lionsquad.at"))
    fake.add_event(5, label="Vorstandsklausur", day="2026-11-02", visibility="members")
    fake.add_event(6, label="Sommerfest", day="2026-07-01", visibility="public")
    admin = await flow.add_user(role="tournament_admin", name="turnierleitung")
    flow.act_as(admin)
    return admin


@pytest.mark.asyncio
async def test_a_public_event_becomes_a_linked_draft(flow, fake):
    await scene(flow, fake)
    refreshed = await flow.post("/api/admin/event-suggestions/refresh")
    assert refreshed.status_code == 200 and refreshed.json()["count"] == 1, refreshed.text
    view = refreshed.json()["view"]
    assert [(s["id"], s["label"], s["registration_label"]) for s in view["suggestions"]] == [(4, "Winter-Cup", "Anmeldung über eine Anwendung")]

    adopted = await flow.post("/api/admin/event-suggestions/4/adopt")
    assert adopted.status_code == 200, adopted.text
    event = await flow.db.events.find_one({"id": adopted.json()["event_id"]}, {"_id": 0})
    assert (event["name"], event["status"], event["visibility"], event["location"], event["has_registration"]) == ("Winter-Cup", "draft", "public", "Vereinsheim", True)
    assert event["start_date"].startswith("2026-12-05T00:00:00") and event["dolibarr_event_id"] == 4
    assert (await flow.get("/api/admin/event-suggestions")).json()["suggestions"] == [], "übernommen ist kein Vorschlag mehr"
    assert (await flow.post("/api/admin/event-suggestions/4/adopt")).status_code == 409


@pytest.mark.asyncio
async def test_changes_in_dolibarr_come_as_differences_never_silently(flow, fake):
    await scene(flow, fake)
    await flow.post("/api/admin/event-suggestions/refresh")
    event_id = (await flow.post("/api/admin/event-suggestions/4/adopt")).json()["event_id"]
    # Auf der Website wird die Uhrzeit ergänzt und der Ort genauer benannt - das bleibt.
    await flow.db.events.update_one({"id": event_id}, {"$set": {"start_date": "2026-12-05T18:00:00+01:00", "location": "Vereinsheim, Saal 2"}})

    fake.events[4].update(day="2026-12-06", place="Stadthalle")
    view = (await flow.post("/api/admin/event-suggestions/refresh")).json()["view"]
    changed = view["changed"][0]
    assert changed["event_id"] == event_id
    assert [(d["field"], d["before"], d["dolibarr"], d["website"]) for d in changed["differences"]] == [
        ("day", "2026-12-05", "2026-12-06", "2026-12-05"), ("place", "Vereinsheim", "Stadthalle", "Vereinsheim, Saal 2")]
    event = await flow.db.events.find_one({"id": event_id}, {"_id": 0})
    assert event["start_date"] == "2026-12-05T18:00:00+01:00" and event["location"] == "Vereinsheim, Saal 2", "nichts still überschrieben"

    # Tag übernehmen behält die Uhrzeit; den Ort ignorieren behält die Website-Angabe.
    after = (await flow.post("/api/admin/event-suggestions/4/settle", json={"field": "day", "take": True})).json()
    assert [d["field"] for d in after["changed"][0]["differences"]] == ["place"]
    assert (await flow.post("/api/admin/event-suggestions/4/settle", json={"field": "place", "take": False})).json()["changed"] == []
    event = await flow.db.events.find_one({"id": event_id}, {"_id": 0})
    assert event["start_date"].startswith("2026-12-06T18:00:00") and event["location"] == "Vereinsheim, Saal 2"

    # Abgesagt in Dolibarr: übernommen heißt abgesagt auf der Website.
    fake.events[4]["status"] = "cancelled"
    await flow.post("/api/admin/event-suggestions/refresh")
    await flow.post("/api/admin/event-suggestions/4/settle", json={"field": "status", "take": True})
    assert (await flow.db.events.find_one({"id": event_id}, {"_id": 0}))["status"] == "cancelled"


@pytest.mark.asyncio
async def test_dismissed_stays_away_and_only_event_staff_may_act(flow, fake):
    await scene(flow, fake)
    await flow.post("/api/admin/event-suggestions/refresh")
    view = (await flow.post("/api/admin/event-suggestions/4/dismiss")).json()
    assert view["suggestions"] == [] and view["dismissed"] == 1
    assert (await flow.post("/api/admin/event-suggestions/99/adopt")).status_code == 404

    # Dolibarr nicht erreichbar: der alte Stand bleibt, der Grund steht da.
    fake.fail_with = 503
    failed = (await flow.post("/api/admin/event-suggestions/refresh")).json()
    assert failed["ok"] is False and failed["view"]["error_text"]
    fake.fail_with = None
    assert (await dolibarr_events.load_state(flow.db))["events"][0]["id"] == 4

    flow.act_as(await flow.add_user(role="player", name="gast"))
    assert (await flow.get("/api/admin/event-suggestions")).status_code == 403
