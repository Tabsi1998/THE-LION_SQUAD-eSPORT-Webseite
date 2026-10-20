"""Live-Meldungen je Turnier (#1801), durch die echte Anwendung geschickt.

Die Meldung nennt das Turnier, damit nur seine Seiten nachladen. Sie geht wie bisher hinaus, bevor die Antwort die
Middleware verlässt; das Nachschlagen kommt meist aus dem Zwischenspeicher.
"""
import pathlib
import sys
from types import SimpleNamespace

import pytest
import pytest_asyncio
from starlette.responses import Response

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import load_application, make_flow, new_id  # noqa: E402
from services import change_events  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    change_events._subscribers.clear()
    change_events.reset_scope_cache()
    try:
        yield instance
    finally:
        change_events._subscribers.clear()
        change_events.reset_scope_cache()
        await shutdown()


def last_event() -> dict | None:
    return change_events._event_buffer[-1] if change_events._event_buffer else None


@pytest.mark.asyncio
async def test_the_change_is_published_before_the_response_leaves(flow):
    _database, server, *_rest = load_application()
    request = SimpleNamespace(method="POST", url=SimpleNamespace(path="/api/tournaments/irgendwas/register"))

    async def call_next(_request):
        return Response(status_code=200)

    response = await server.api_change_notifications(request, call_next)

    assert last_event()["path"] == "/api/tournaments/irgendwas/register"
    assert response.background is None


@pytest.mark.asyncio
async def test_a_write_through_the_app_names_the_public_tournament(flow):
    tournament = {"id": new_id(), "slug": f"cup-{new_id()[:8]}", "title": "Herbst-Cup", "status": "completed",
                  "visibility": "public"}
    await flow.db.tournaments.insert_one(dict(tournament))
    flow.act_as(await flow.add_staff())

    response = await flow.post(f"/api/tournaments/{tournament['slug']}/lock")

    assert response.status_code == 200
    event = last_event()
    assert event["path"] == f"/api/tournaments/{tournament['slug']}/lock"
    public = change_events._event_for_scope(event, "public")
    assert public["tournament_id"] == tournament["id"]
    assert tournament["slug"] not in str(public)


@pytest.mark.asyncio
async def test_a_station_change_names_the_event_of_the_station(flow):
    # Codex-Prüfung: Eine Station am Event nennt das Event - Seiten anderer Events laden nicht nach.
    event_id = new_id()
    await flow.db.events.insert_one({"id": event_id, "slug": f"abend-{new_id()[:8]}", "status": "live", "visibility": "public"})
    station = {"id": new_id(), "name": "Switch 1", "status": "free", "event_id": event_id, "tournament_id": None}
    await flow.db.stations.insert_one(dict(station))
    flow.act_as(await flow.add_staff())

    response = await flow.post(f"/api/stations/{station['id']}/clear")

    assert response.status_code == 200
    public = change_events._event_for_scope(last_event(), "public")
    assert public["resource"] == "stations"
    assert public["parent_event_id"] == event_id and public["tournament_id"] is None
    assert station["id"] not in str(public)


# Turnierleitung (Codex-Prüfung): Sie zeigt Stationen, die sich die Turniere eines Events teilen. Kennt sie ihr Event,
# lädt sie nur bei Änderungen dieses Events nach - die Kennung nur, wenn die Person das Event sehen darf (#1473).

async def tournament_in_event(flow, visibility: str) -> tuple[dict, str]:
    event_id = new_id()
    await flow.db.events.insert_one({"id": event_id, "slug": f"abend-{new_id()[:8]}", "status": "live", "visibility": visibility})
    tournament = {"id": new_id(), "slug": f"cup-{new_id()[:8]}", "title": "Herbst-Cup", "status": "live",
                  "visibility": "public", "event_id": event_id}
    await flow.db.tournaments.insert_one(dict(tournament))
    return tournament, event_id


@pytest.mark.asyncio
async def test_the_lead_view_names_the_event_of_its_tournament(flow):
    tournament, event_id = await tournament_in_event(flow, "public")
    flow.act_as(await flow.add_staff())

    response = await flow.get(f"/api/tournaments/{tournament['id']}/lead")

    assert response.status_code == 200
    assert response.json()["tournament"]["event_id"] == event_id


@pytest.mark.asyncio
async def test_the_lead_view_keeps_an_unseen_event_to_itself(flow):
    tournament, _event_id = await tournament_in_event(flow, "internal")
    helper = await flow.add_user(name="Ergebnisdienst")
    await flow.db.tournament_staff_assignments.insert_one({"id": new_id(), "tournament_id": tournament["id"], "user_id": helper["id"],
                                                           "role": "scorekeeper", "scope": "tournament", "is_active": True})
    flow.act_as(helper)

    response = await flow.get(f"/api/tournaments/{tournament['id']}/lead")

    assert response.status_code == 200
    assert response.json()["tournament"]["event_id"] is None


# Zwischenspeicher (Codex-Prüfung, 2. Runde): Jede Route, die Event-Zuordnung oder Status eines Turniers ändert, leert
# ihn - die nächste Meldung folgt sofort dem neuen Stand, nicht erst nach Ablauf der Frist.

async def scope_after(tournament_id: str) -> dict:
    await change_events.publish_api_change("POST", f"/api/tournaments/{tournament_id}/register", 200)
    return change_events._event_for_scope(last_event(), "public")


async def plain_tournament(flow, **fields) -> dict:
    tournament = {"id": new_id(), "slug": f"cup-{new_id()[:8]}", "title": "Herbst-Cup", "status": "registration_open",
                  "visibility": "public", "event_id": None, **fields}
    await flow.db.tournaments.insert_one(dict(tournament))
    return tournament


@pytest.mark.asyncio
async def test_adding_to_the_program_of_a_members_event_is_seen_at_once(flow):
    tournament = await plain_tournament(flow)
    event_id = new_id()
    await flow.db.events.insert_one({"id": event_id, "slug": f"abend-{new_id()[:8]}", "name": "Vereinsabend", "status": "live",
                                     "visibility": "members"})
    flow.act_as(await flow.add_staff())
    assert (await scope_after(tournament["id"]))["tournament_id"] == tournament["id"]

    response = await flow.post(f"/api/events/{event_id}/program", json={"kind": "tournament", "item_id": tournament["id"]})

    assert response.status_code == 200
    public = await scope_after(tournament["id"])
    assert public.get("tournament_id") is None and public.get("parent_event_id") is None


@pytest.mark.asyncio
async def test_removing_from_the_program_is_seen_at_once(flow):
    event_id = new_id()
    await flow.db.events.insert_one({"id": event_id, "slug": f"abend-{new_id()[:8]}", "name": "Vereinsabend", "status": "live",
                                     "visibility": "public"})
    tournament = await plain_tournament(flow, event_id=event_id)
    flow.act_as(await flow.add_staff())
    assert (await scope_after(tournament["id"]))["parent_event_id"] == event_id

    response = await flow.delete(f"/api/events/{event_id}/program/tournament/{tournament['id']}")

    assert response.status_code == 200
    public = await scope_after(tournament["id"])
    assert public["tournament_id"] == tournament["id"] and public["parent_event_id"] is None


@pytest.mark.asyncio
async def test_a_status_change_back_to_draft_is_seen_at_once(flow):
    tournament = await plain_tournament(flow)
    flow.act_as(await flow.add_staff())
    assert (await scope_after(tournament["id"]))["tournament_id"] == tournament["id"]

    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "draft"})

    assert response.status_code == 200
    assert (await scope_after(tournament["id"])).get("tournament_id") is None


@pytest.mark.asyncio
async def test_changing_the_visibility_of_tournament_or_event_is_seen_at_once(flow):
    event_id = new_id()
    await flow.db.events.insert_one({"id": event_id, "slug": f"abend-{new_id()[:8]}", "name": "Vereinsabend", "status": "live",
                                     "visibility": "public"})
    in_event = await plain_tournament(flow, event_id=event_id)
    alone = await plain_tournament(flow)
    flow.act_as(await flow.add_staff())
    assert (await scope_after(in_event["id"]))["parent_event_id"] == event_id
    assert (await scope_after(alone["id"]))["tournament_id"] == alone["id"]

    event_change = await flow.patch(f"/api/events/{event_id}", json={"visibility": "members"})
    tournament_change = await flow.patch(f"/api/tournaments/{alone['id']}", json={"visibility": "members"})

    assert event_change.status_code == 200 and tournament_change.status_code == 200
    assert (await scope_after(in_event["id"])).get("tournament_id") is None
    assert (await scope_after(alone["id"])).get("tournament_id") is None


@pytest.mark.asyncio
async def test_moving_a_station_to_another_event_is_seen_at_once(flow):
    first, second = new_id(), new_id()
    for event_id in (first, second):
        await flow.db.events.insert_one({"id": event_id, "slug": f"abend-{new_id()[:8]}", "name": "Vereinsabend",
                                         "status": "live", "visibility": "public"})
    station = {"id": new_id(), "name": "Switch 1", "status": "free", "event_id": first, "tournament_id": None}
    await flow.db.stations.insert_one(dict(station))
    flow.act_as(await flow.add_staff())
    await change_events.publish_api_change("POST", f"/api/stations/{station['id']}/clear", 200)
    assert change_events._event_for_scope(last_event(), "public")["parent_event_id"] == first

    response = await flow.patch(f"/api/stations/{station['id']}", json={"event_id": second})

    assert response.status_code == 200
    await change_events.publish_api_change("POST", f"/api/stations/{station['id']}/clear", 200)
    assert change_events._event_for_scope(last_event(), "public")["parent_event_id"] == second


# Statuswechsel ohne eigene Route (Codex-Prüfung, 3. Runde): Das erste Spiel an einer Station startet das Turnier, und
# der Planer schaltet Turniere und Events nach der Uhr weiter - auch danach wird neu nachgeschlagen.

def counting_lookups(monkeypatch) -> list:
    calls = []
    original = change_events._lookup_scope

    async def counting(db, kind, ref):
        calls.append((kind, ref))
        return await original(db, kind, ref)

    monkeypatch.setattr(change_events, "_lookup_scope", counting)
    return calls


@pytest.mark.asyncio
async def test_starting_the_first_match_at_a_station_looks_the_tournament_up_again(flow, monkeypatch):
    from routes.station_routes import _assign_match_to_station

    tournament = await plain_tournament(flow)
    match = {"id": new_id(), "tournament_id": tournament["id"], "match_key": "A", "status": "ready",
             "slots": [{"slot": 1, "registration_id": new_id()}, {"slot": 2, "registration_id": new_id()}]}
    station = {"id": new_id(), "name": "Switch 1", "status": "free", "tournament_id": tournament["id"], "current_match_id": None}
    await flow.db.matches_v2.insert_one(dict(match))
    await flow.db.stations.insert_one(dict(station))
    await scope_after(tournament["id"])
    calls = counting_lookups(monkeypatch)

    await _assign_match_to_station(flow.db, station, match, "matches_v2", start_now=True)

    assert (await flow.db.tournaments.find_one({"id": tournament["id"]}))["status"] == "live"
    await scope_after(tournament["id"])
    assert calls == [("tournament", tournament["id"])]


@pytest.mark.asyncio
async def test_a_status_change_by_the_scheduler_looks_the_tournament_up_again(flow, monkeypatch):
    from services import scheduler

    tournament = await plain_tournament(flow)
    await scope_after(tournament["id"])
    calls = counting_lookups(monkeypatch)
    doc = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})

    assert await scheduler._write_transition(flow.db, "tournaments", "tournament", doc, "registration_closed", "2026-10-20T16:00:00+00:00")

    await scope_after(tournament["id"])
    assert calls == [("tournament", tournament["id"])]
