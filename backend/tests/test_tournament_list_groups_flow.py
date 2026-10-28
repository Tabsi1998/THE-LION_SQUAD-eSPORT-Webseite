"""Turnierliste für Spieler (#2124, TP12/TP13): Status-Gruppen am Server und Seiten zum Nachladen.

- „Beendet“ (``status=finished``) umfasst beendet, Ergebnisse veröffentlicht und archiviert - nicht nur ``completed``.
- „Live“ (``status=running``) umfasst laufende und pausierte Turniere.
- Ein einzelner Status (``status=completed``) bleibt, wie er war - die App fragt so.
- Mit ``paged=true`` kommen ``items`` und ``total``: die Webseite lädt so ältere Turniere nach.
Erfundene Turniere."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


STATUSES = ["registration_open", "live", "paused", "completed", "results_published", "archived", "draft"]


async def seed(flow):
    for index, status in enumerate(STATUSES):
        await flow.create_tournament(id=f"t-{status}", slug=f"cup-{status}", status=status,
                                     created_at=f"2026-0{1 + index % 9}-01T10:00:00+00:00")
    flow.act_as(None)


async def ids(flow, **params) -> set[str]:
    response = await flow.get("/api/tournaments", params={"compact": "true", **params})
    assert response.status_code == 200, response.text
    return {row["id"] for row in response.json()}


@pytest.mark.asyncio
async def test_status_groups_finished_and_running(flow):
    await seed(flow)

    assert await ids(flow, status="finished") == {"t-completed", "t-results_published", "t-archived"}
    assert await ids(flow, status="running") == {"t-live", "t-paused"}
    assert await ids(flow, status="completed") == {"t-completed"}, "ein einzelner Status bleibt, wie er war"
    assert "t-draft" not in await ids(flow), "Entwürfe nie in der öffentlichen Liste"


@pytest.mark.asyncio
async def test_paged_list_loads_older_tournaments(flow):
    for number in range(30):
        await flow.create_tournament(id=f"t-{number:02d}", slug=f"cup-{number:02d}", status="completed",
                                     created_at=f"2026-01-01T10:{number:02d}:00+00:00")
    flow.act_as(None)

    first = (await flow.get("/api/tournaments", params={"compact": "true", "paged": "true", "limit": 24})).json()
    assert len(first["items"]) == 24 and first["total"] > 24
    second = (await flow.get("/api/tournaments", params={"compact": "true", "paged": "true", "limit": 24, "offset": 24})).json()
    shown = [row["id"] for row in first["items"]] + [row["id"] for row in second["items"]]
    assert len(shown) == len(set(shown)) == 30, "jedes Turnier genau einmal - auch das älteste"
    assert "t-00" in shown
