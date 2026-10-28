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


@pytest.mark.asyncio
async def test_has_bracket_tree_follows_format_and_playoff_stages(flow):
    """Turnierbaum je Format (#2124, Review B1): Jeder gegen jeden ohne Baum - mit einer K.-o.-Phase (Playoffs) doch."""
    await flow.create_tournament(id="t-rr", slug="rr-cup", format="round_robin")
    await flow.create_tournament(id="t-rr-po", slug="rr-playoffs", format="round_robin")
    await flow.create_tournament(id="t-se", slug="ko-cup", format="single_elim")
    await flow.create_tournament(id="t-gp", slug="gp-serie", format="grand_prix")
    await flow.db.tournament_stages.insert_many([
        {"id": "st-rr", "tournament_id": "t-rr-po", "stage_type": "round_robin_groups", "number": 1},
        {"id": "st-po", "tournament_id": "t-rr-po", "stage_type": "single_elimination", "number": 2},
        {"id": "st-gp", "tournament_id": "t-gp", "stage_type": "ffa_league", "number": 1},
    ])
    flow.act_as(None)

    detail = {slug: (await flow.get(f"/api/tournaments/{slug}")).json()["has_bracket_tree"]
              for slug in ("rr-cup", "rr-playoffs", "ko-cup", "gp-serie")}
    assert detail == {"rr-cup": False, "rr-playoffs": True, "ko-cup": True, "gp-serie": False}
    listed = {row["id"]: row["has_bracket_tree"] for row in (await flow.get("/api/tournaments", params={"compact": "true"})).json()}
    assert listed == {"t-rr": False, "t-rr-po": True, "t-se": True, "t-gp": False}


def test_has_bracket_tree_with_known_stages():
    from services.bracket_tree import has_bracket_tree

    assert has_bracket_tree({"format": "league"}, [{"stage_type": "league"}]) is False
    assert has_bracket_tree({"format": "league"}, [{"stage_type": "league"}, {"stage_type": "double_elimination"}]) is True
    assert has_bracket_tree({"format": "swiss"}, []) is True


@pytest.mark.asyncio
async def test_compact_list_enriches_only_the_page(flow, monkeypatch):
    """Review O5: die kurze Liste reichert nur die gezeigte Seite an - Reihenfolge und Zahl bleiben."""
    import routes.tournament_crud_routes as crud

    for number in range(30):
        await flow.create_tournament(id=f"t-{number:02d}", slug=f"cup-{number:02d}", created_at=f"2026-01-01T10:{number:02d}:00+00:00")
    flow.act_as(None)
    enriched = []
    original = crud._enrich_tournament

    async def counting(t, user=None):
        enriched.append(t["id"])
        return await original(t, user)

    monkeypatch.setattr(crud, "_enrich_tournament", counting)
    page = (await flow.get("/api/tournaments", params={"compact": "true", "paged": "true", "limit": 10, "offset": 5})).json()
    assert [row["id"] for row in page["items"]] == [f"t-{number:02d}" for number in range(24, 14, -1)]
    assert page["total"] == 30 and page["offset"] == 5 and page["limit"] == 10
    assert sorted(enriched) == sorted(row["id"] for row in page["items"])