"""Helferdienste (#331, Vereine 1.4): nur mit Weg zur Akte und Fähigkeit „events“; Veranstaltungen ab heute mit
Plätzen und eigenem Stand; Anfrage → angefragt (nochmal ändert nichts), voll/vorbei/überschneidend 409 mit Satz,
Rücknahme nur unbestätigt; die Anmeldestelle je Veranstaltung kommt vom Modul, die Website erfindet keine zweite."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, dolibarr_identity  # noqa: E402
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


async def connect(flow, mode="live"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)


async def bind(flow, code: str) -> dict:
    response = await flow.post("/api/membership/me/identity", json={"code": code})
    assert response.status_code == 200 and response.json()["status"] == "bound", response.text
    return response.json()


def seed_events(fake: FakeDolibarr) -> None:
    fake.add(member(12), email="paula@example.test")
    fake.add(member(13), email="max@example.test")
    fake.add_event(5, label="Sommerfest 2026", day="2026-10-10", place="Vereinsheim", visibility="members", registration=("dolibarr", ""), shifts=[
        {"id": 51, "label": "Aufbau", "day": "2026-10-10", "start": "14:00", "end": "16:00", "capacity": 2},
        {"id": 52, "label": "Bar", "day": "2026-10-10", "start": "15:00", "end": "20:00", "capacity": 1},
        {"id": 53, "label": "Abbau", "day": "2026-10-10", "start": "21:00", "end": "23:00", "capacity": 3},
    ])
    fake.add_event(6, label="LAN-Party", day="2026-11-14", end_day="2026-11-15", visibility="public", registration=("external", "lionsquad.at/events/lan"), shifts=[
        {"id": 61, "label": "Technik", "day": "2026-11-14", "start": "10:00", "end": "14:00", "capacity": 2},
    ])
    fake.add_event(7, label="Weihnachtsfeier 2025", day="2025-12-20", shifts=[{"id": 71, "label": "Küche", "day": "2025-12-20", "start": "17:00", "end": "22:00", "capacity": 2}])  # vorbei


@pytest.mark.asyncio
async def test_helper_shifts_run_through_the_binding(flow, fake):
    await connect(flow)
    seed_events(fake)
    paula = await flow.add_user(role="player", name="paula")
    paula["is_club_member"] = True
    flow.act_as(paula)

    view = (await flow.get("/api/membership/me/helper-shifts")).json()
    assert view["available"] is False and view["reason"] == "not_bound"
    assert (await flow.put("/api/membership/me/events/5/shifts/51")).status_code == 403

    fake.invite("DOCS", 12, capabilities=("documents",))
    await bind(flow, "DOCS")
    view = (await flow.get("/api/membership/me/helper-shifts")).json()
    assert view["available"] is False and view["reason"] == "no_capability_events" and "Veranstaltungen" in view["text"]
    assert (await flow.put("/api/membership/me/events/5/shifts/51")).status_code == 409

    fake.revoke_identity(paula["id"])
    fake.invite("ALL", 12, capabilities=("documents", "events"))
    await bind(flow, "ALL")
    view = (await flow.get("/api/membership/me/helper-shifts")).json()
    assert view["available"] is True and [event["id"] for event in view["events"]] == [5, 6], "vorbei ist nicht dabei"
    fest = view["events"][0]
    assert fest["status_label"] == "geplant" and fest["visibility_label"] == "nur für Mitglieder" and fest["registration"]["text"] == "Anmeldung beim Verein"
    assert fest["upcoming"] is True and fest["open_places"] == 6 and fest["mine"] == [] and view["my_count"] == 0 and view["open_places"] == 8
    aufbau = fest["shifts"][0]
    assert aufbau == {"id": 51, "label": "Aufbau", "day": "2026-10-10", "start": "14:00", "end": "16:00", "capacity": 2, "taken": 0, "free": 2, "full": False,
                      "mine": "", "mine_label": "", "can_request": True, "can_withdraw": False}
    assert view["events"][1]["registration"]["text"] == "Anmeldung bei lionsquad.at/events/lan"

    # Anfrage: angefragt, noch kein Platz belegt; nochmal ändert nichts; überschneidend 409.
    requested = (await flow.put("/api/membership/me/events/5/shifts/51")).json()
    assert requested["shifts"][0]["mine"] == "requested" and requested["shifts"][0]["mine_label"].startswith("angefragt") and requested["shifts"][0]["taken"] == 0
    assert requested["shifts"][0]["can_request"] is False and requested["shifts"][0]["can_withdraw"] is True and len(requested["mine"]) == 1
    again = (await flow.put("/api/membership/me/events/5/shifts/51")).json()
    assert again["shifts"][0]["mine"] == "requested"
    overlap = await flow.put("/api/membership/me/events/5/shifts/52")
    assert overlap.status_code == 409 and "überschneidet" in overlap.json()["detail"]
    assert (await flow.put("/api/membership/me/events/5/shifts/99")).status_code == 404
    assert (await flow.put("/api/membership/me/events/7/shifts/71")).status_code == 404

    # Voll: Max hat den letzten Platz bestätigt bekommen.
    fake.confirm_shift(5, 52, 13)
    view = (await flow.get("/api/membership/me/helper-shifts")).json()
    bar = view["events"][0]["shifts"][1]
    assert bar["taken"] == 1 and bar["full"] is True and bar["free"] == 0 and bar["can_request"] is False
    fake.request_shift(5, 53, 12)   # der Vorstand hat Paula selbst eingetragen
    fake.confirm_shift(5, 53, 12)
    view = (await flow.get("/api/membership/me/helper-shifts")).json()
    abbau = view["events"][0]["shifts"][2]
    assert abbau["mine"] == "confirmed" and abbau["mine_label"] == "bestätigt" and abbau["can_withdraw"] is False and view["my_count"] == 2

    # Rücknahme: unbestätigt ja, bestätigt nein (409 mit dem Satz).
    withdrawn = (await flow.delete("/api/membership/me/events/5/shifts/51")).json()
    assert withdrawn["shifts"][0]["mine"] == "" and withdrawn["shifts"][0]["can_request"] is True
    confirmed = await flow.delete("/api/membership/me/events/5/shifts/53")
    assert confirmed.status_code == 409 and "Vorstand" in confirmed.json()["detail"]
    fake.set_event_status(6, "cancelled")
    cancelled = await flow.put("/api/membership/me/events/6/shifts/61")
    assert cancelled.status_code == 409 and "abgesagt" in cancelled.json()["detail"]
    view = (await flow.get("/api/membership/me/helper-shifts")).json()
    assert view["events"][1]["status_label"] == "abgesagt" and view["events"][1]["shifts"][0]["can_request"] is False

    # Widerruf der Bindung: zu.
    fake.revoke_identity(paula["id"])
    assert (await flow.get("/api/membership/me/helper-shifts")).json()["reason"] == "not_bound"
    assert (await flow.delete("/api/membership/me/events/5/shifts/51")).status_code == 403


@pytest.mark.asyncio
async def test_without_live_connection_there_is_only_the_reason(flow, fake):
    await connect(flow, mode="preview")
    paula = await flow.add_user(role="player", name="paula")
    flow.act_as(paula)
    view = (await flow.get("/api/membership/me/helper-shifts")).json()
    assert view["available"] is False and view["reason"] == "not_connected" and view["events"] == []
    assert (await flow.put("/api/membership/me/events/5/shifts/51")).status_code == 403
