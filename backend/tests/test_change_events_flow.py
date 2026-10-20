"""Live-Meldungen je Turnier (#1801), durch die echte Anwendung geschickt.

Die Meldung nennt das Turnier, damit nur seine Seiten nachladen. Das Nachschlagen darf die schreibende Anfrage nicht
aufhalten (Codex-Prüfung): Die Middleware veröffentlicht nach der Antwort.
"""
import asyncio
import contextlib
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
async def test_the_change_is_published_after_the_response(flow):
    _database, server, *_rest = load_application()
    before = last_event()
    request = SimpleNamespace(method="POST", url=SimpleNamespace(path="/api/tournaments/irgendwas/register"))

    async def call_next(_request):
        return Response(status_code=200)

    response = await server.api_change_notifications(request, call_next)

    # Die Antwort ist fertig, die Meldung noch nicht: sie läuft als Hintergrund-Aufgabe nach dem Senden.
    assert last_event() is before
    assert response.background is not None
    await response.background()
    assert last_event() is not before
    assert last_event()["path"] == "/api/tournaments/irgendwas/register"


@pytest.mark.asyncio
async def test_the_change_goes_out_even_if_the_client_is_gone(flow):
    # Bricht die Verbindung nach der Antwort ab, endet auch das Warten auf die Meldung - die Meldung selbst nicht.
    _database, server, *_rest = load_application()
    request = SimpleNamespace(method="POST", url=SimpleNamespace(path="/api/tournaments/weg/register"))

    async def call_next(_request):
        return Response(status_code=200)

    response = await server.api_change_notifications(request, call_next)
    waiter = asyncio.ensure_future(response.background())
    await asyncio.sleep(0)
    waiter.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await waiter
    await asyncio.gather(*change_events._pending_publishes)

    assert last_event()["path"] == "/api/tournaments/weg/register"


@pytest.mark.asyncio
async def test_a_background_task_of_the_route_still_runs(flow):
    _database, server, *_rest = load_application()
    ran = []

    async def route_task():
        ran.append("route")

    async def call_next(_request):
        from starlette.background import BackgroundTask

        return Response(status_code=200, background=BackgroundTask(route_task))

    request = SimpleNamespace(method="PATCH", url=SimpleNamespace(path="/api/news/n-1"))
    response = await server.api_change_notifications(request, call_next)
    await response.background()

    assert ran == ["route"]
    assert last_event()["path"] == "/api/news/n-1"


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
