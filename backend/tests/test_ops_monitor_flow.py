"""Betriebssicht (#233) durch die echte Anwendung: Fehler werden zu Gruppen, langsame
Anfragen zu Einträgen, und nur der Vereinsadmin sieht beides."""
import pathlib
import sys

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from flow_harness import load_application, make_flow  # noqa: E402

from services import ops_monitor  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest_asyncio.fixture
async def boom_route():
    """Eine Route, die absichtlich abstürzt - nur für diese Tests."""
    _database, server, *_rest = load_application()

    async def boom():
        raise RuntimeError("Absichtlich kaputt für person@example.test")

    server.app.add_api_route("/api/_test/boom/{item_id}", boom, methods=["GET"])
    route = server.app.router.routes[-1]
    try:
        yield server.app
    finally:
        server.app.router.routes.remove(route)


def _client_that_returns_500(app):
    # httpx wirft App-Ausnahmen sonst direkt in den Test; hier soll die 500-Antwort
    # ankommen, wie sie ein Browser sähe.
    return AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://testserver")


@pytest.mark.asyncio
async def test_an_exception_becomes_one_group_that_counts(flow, boom_route):
    async with _client_that_returns_500(boom_route) as client:
        first = await client.get("/api/_test/boom/0123456789ab")
        second = await client.get("/api/_test/boom/ffffffffffff")
    assert first.status_code == 500 and second.status_code == 500

    groups = await flow.db.ops_errors.find({}, {"_id": 0}).to_list(10)
    assert len(groups) == 1, "dieselbe Ausnahme auf derselben Route ist eine Gruppe"
    group = groups[0]
    assert group["count"] == 2
    assert group["error_type"] == "RuntimeError"
    assert group["route"] == "/api/_test/boom/{item_id}"
    assert group["method"] == "GET"
    assert group["resolved_at"] is None
    assert "person@example.test" not in group["message"]
    assert "[redacted-email]" in group["message"]
    assert "RuntimeError" in group["stack"]


@pytest.mark.asyncio
async def test_only_the_club_admin_reads_and_resolves_groups(flow, boom_route):
    async with _client_that_returns_500(boom_route) as client:
        await client.get("/api/_test/boom/1")

    flow.act_as(await flow.add_user(role="user"))
    assert (await flow.get("/api/admin/ops/errors")).status_code == 403

    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    listed = (await flow.get("/api/admin/ops/errors")).json()
    assert [row["route"] for row in listed] == ["/api/_test/boom/{item_id}"]
    fingerprint = listed[0]["fingerprint"]

    resolved = (await flow.post(f"/api/admin/ops/errors/{fingerprint}/resolve")).json()
    assert resolved["resolved_at"]
    assert (await flow.get("/api/admin/ops/errors?status=open")).json() == []

    # Tritt der Fehler wieder auf, ist die Gruppe wieder offen.
    async with _client_that_returns_500(boom_route) as client:
        await client.get("/api/_test/boom/2")
    reopened = (await flow.get("/api/admin/ops/errors?status=open")).json()
    assert [row["count"] for row in reopened] == [2]

    summary = (await flow.get("/api/admin/ops/summary")).json()
    assert summary["open_error_groups"] == 1
    assert summary["error_groups_24h"] == 1


@pytest.mark.asyncio
async def test_slow_requests_are_recorded_and_ranked(flow, monkeypatch):
    monkeypatch.setattr(ops_monitor, "SLOW_REQUEST_MS", 0)

    assert (await flow.get("/api/")).status_code == 200
    assert (await flow.get("/api/")).status_code == 200
    assert (await flow.get("/api/health/ready")).status_code in (200, 503), "Gesundheitsprüfungen zählen nie als langsam"

    rows = await flow.db.ops_slow_requests.find({}, {"_id": 0}).to_list(10)
    assert [row["route"] for row in rows] == ["/api/", "/api/"]
    assert all(row["method"] == "GET" and row["status_code"] == 200 for row in rows)

    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    overview = (await flow.get("/api/admin/ops/slow?hours=24")).json()
    assert overview["total"] >= 2
    top = overview["routes"][0]
    assert top["route"] == "/api/" and top["count"] >= 2
    assert top["max_ms"] >= top["avg_ms"] >= 0

    dashboard = (await flow.get("/api/admin/dashboard")).json()
    assert dashboard["ops"]["slow_requests_24h"] >= 2
