"""Schreibpause fürs Backup mit der echten App (#1009): Lesen läuft, Schreiben bekommt 503 „gleich wieder da“,
Anmelden bleibt möglich, nach dem Ende (oder dem Ablauf der Lease) geht alles wieder. Steuern lässt sich die Pause nur
über die Kommandozeile im Container - keine Route."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import load_application, make_flow  # noqa: E402
from services import maintenance  # noqa: E402

ACCEPT = {"accept_rules": True, "accept_privacy": True}


@pytest_asyncio.fixture
async def flow():
    maintenance.reset_cache()
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        maintenance.reset_cache()
        await shutdown()


@pytest.mark.asyncio
async def test_reads_go_on_writes_get_a_friendly_503(flow):
    tournament = await flow.create_tournament()
    player = await flow.add_user(name="Nachtschicht")
    flow.act_as(player)
    started = await maintenance.activate(flow.db, ttl_seconds=60)

    detail = await flow.get(f"/api/tournaments/{tournament['slug']}")
    assert detail.status_code == 200

    blocked = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=ACCEPT)
    assert blocked.status_code == 503
    body = blocked.json()
    assert body["code"] == "write_pause"
    assert "gleich wieder möglich" in body["detail"]
    assert 1 <= int(blocked.headers["Retry-After"]) <= 60
    assert blocked.headers["Cache-Control"] == "no-store"
    assert await flow.db.tournament_registrations.count_documents({}) == 0
    # Eine gesperrte Anfrage ist kein Serverfehler in der Betriebssicht.
    assert await flow.db.ops_errors.count_documents({}) == 0

    await maintenance.release(flow.db, started["token"])
    allowed = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=ACCEPT)
    assert allowed.status_code == 200, allowed.text
    assert await flow.db.tournament_registrations.count_documents({}) == 1


@pytest.mark.asyncio
async def test_login_stays_possible_during_the_pause(flow):
    await maintenance.activate(flow.db, ttl_seconds=60)
    response = await flow.post("/api/auth/login", json={"email": "niemand@example.test", "password": "falsch-falsch"})
    # Der Login-Handler antwortet selbst (falsche Daten) - die Pause hält ihn nicht auf.
    assert response.status_code in (400, 401, 403, 422, 429), response.text
    health = await flow.get("/api/health/live")
    assert health.status_code == 200


@pytest.mark.asyncio
async def test_an_expired_lease_releases_the_site(flow):
    tournament = await flow.create_tournament()
    flow.act_as(await flow.add_user(name="Frühaufsteher"))
    # Das Backup ist abgestürzt: Die Pause steht noch in der Datenbank, die Lease ist aber vorbei.
    await flow.db.ops_maintenance.insert_one({"_id": "write_pause", "active": True, "token": "verwaist", "reason": "backup",
                                              "lease_until": datetime.now(timezone.utc) - timedelta(seconds=1)})
    response = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=ACCEPT)
    assert response.status_code == 200, response.text


def test_no_route_controls_the_pause():
    """Gesteuert wird nur über ``python -m services.maintenance`` im Container - keine Route, auch keine geschützte."""
    _database, server, _current, _optional = load_application()
    paths = [getattr(route, "path", "") for route in server.app.routes]
    assert paths
    assert not [path for path in paths if "maintenance" in path.lower() or "write-pause" in path or "write_pause" in path]
