"""Abgebrochene Messwert-Sendungen sind kein Serverfehler (#2446).

Die Website schickt ihre Messwerte per ``navigator.sendBeacon`` meist beim Verlassen der Seite. Der Browser trennt die
Verbindung dann oft, bevor der Server den Körper gelesen hat - der Server bekommt ``http.disconnect`` statt der Daten.
Das ist ein Abbruch durch den Client: keine Gruppe in ``ops_errors``, kein Alarm. Echte Fehler zählen weiter.

Die Anfragen gehen hier als rohe ASGI-Aufrufe in die echte Anwendung, so wie uvicorn sie schickt - httpx kann eine
getrennte Verbindung nicht nachstellen.
"""
import json
import pathlib
import sys

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from flow_harness import load_application, make_flow  # noqa: E402

from services import maintenance  # noqa: E402

BEACON = json.dumps([{"name": "LCP", "value": 1234.5, "rating": "good", "page": "/"}]).encode("utf-8")


@pytest_asyncio.fixture
async def flow():
    maintenance.reset_cache()
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        maintenance.reset_cache()
        await shutdown()


def beacon_scope(path: str = "/api/ops/vitals") -> dict:
    """So kommt ein ``sendBeacon`` bei uvicorn an: POST mit JSON-Blob, ASGI-Spezifikation 2.4."""
    return {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"}, "http_version": "1.1",
        "method": "POST", "scheme": "http", "path": path, "raw_path": path.encode("ascii"), "query_string": b"",
        "root_path": "", "client": ("127.0.0.1", 50123), "server": ("testserver", 80),
        "headers": [(b"host", b"testserver"), (b"content-type", b"application/json"),
                    (b"content-length", str(len(BEACON)).encode("ascii"))],
    }


async def call_app(scope: dict, receive, send) -> BaseException | None:
    """Ruft die App wie uvicorn auf und gibt eine durchgereichte Ausnahme zurück statt sie zu werfen."""
    _database, server, *_rest = load_application()
    try:
        await server.app(scope, receive, send)
    except Exception as exc:  # noqa: BLE001 - der Test prüft, ob überhaupt etwas herauskommt
        return exc
    return None


@pytest.mark.asyncio
async def test_a_beacon_cut_off_before_its_body_is_no_server_error(flow):
    """Der Browser ist weg, bevor der Körper gelesen ist: ``receive`` liefert nur noch ``http.disconnect``."""
    sent = []

    async def receive():
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    leaked = await call_app(beacon_scope(), receive, send)

    groups = await flow.db.ops_errors.find({}, {"_id": 0, "error_type": 1, "message": 1, "route": 1}).to_list(10)
    assert groups == [], "ein Abbruch durch den Client ist kein Serverfehler"
    assert leaked is None, f"der Abbruch darf nicht als Ausnahme bis zum Server durchschlagen: {leaked!r}"
    assert not [message for message in sent if message.get("status", 0) >= 500]
    assert await flow.db.ops_vitals.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_beacon_whose_client_leaves_while_the_answer_goes_out_is_no_server_error(flow):
    """Der Körper kam an, beim Antworten ist die Verbindung zu: uvicorn wirft dann beim Senden einen ``OSError``."""
    messages = [{"type": "http.request", "body": BEACON, "more_body": False}]

    async def receive():
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(_message):
        raise OSError("client disconnected")

    leaked = await call_app(beacon_scope(), receive, send)

    assert await flow.db.ops_errors.count_documents({}) == 0
    assert leaked is None, f"der Abbruch darf nicht als Ausnahme bis zum Server durchschlagen: {leaked!r}"


@pytest.mark.asyncio
async def test_a_beacon_cut_off_during_the_write_pause_is_no_server_error_either(flow):
    await maintenance.activate(flow.db, ttl_seconds=60)

    async def receive():
        return {"type": "http.disconnect"}

    async def send(_message):
        return None

    leaked = await call_app(beacon_scope(), receive, send)

    assert leaked is None
    assert await flow.db.ops_errors.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_complete_beacon_is_stored_as_before(flow):
    sent = []
    messages = [{"type": "http.request", "body": BEACON, "more_body": False}]

    async def receive():
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    leaked = await call_app(beacon_scope(), receive, send)

    assert leaked is None
    start = next(message for message in sent if message["type"] == "http.response.start")
    assert start["status"] == 202
    headers = {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in start["headers"]}
    assert headers["cache-control"] == "no-store"
    assert headers["x-content-type-options"] == "nosniff"
    assert await flow.db.ops_errors.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_real_error_in_the_vitals_route_still_becomes_a_group(flow, monkeypatch):
    """Absicherung: Nur der Abbruch durch den Client fällt weg - ein Absturz der Route zählt weiter."""
    from routes import ops_routes

    async def broken_store(_db, _entries):
        raise RuntimeError("Speichern kaputt")

    monkeypatch.setattr(ops_routes, "store_vitals", broken_store)
    _database, server, *_rest = load_application()
    async with AsyncClient(transport=ASGITransport(app=server.app, raise_app_exceptions=False),
                           base_url="http://testserver") as client:
        response = await client.post("/api/ops/vitals", content=BEACON, headers={"Content-Type": "application/json"})

    assert response.status_code == 500
    groups = await flow.db.ops_errors.find({}, {"_id": 0}).to_list(10)
    assert len(groups) == 1
    assert groups[0]["error_type"] == "RuntimeError"
    assert groups[0]["route"] == "/api/ops/vitals"
    assert groups[0]["method"] == "POST"
    assert groups[0]["status_code"] == 500
