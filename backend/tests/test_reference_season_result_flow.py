"""Auf- und Abstieg je Saison als Vermerk (#1898): je Saison ein optionales „Ergebnis der Saison“ (Aufstieg, Abstieg,
Klassenerhalt, Meister oder leer) und je Spur eine optionale Reihenfolge der Stufen. Der Server speichert und prüft,
die Seiten (Liga-Weg, Vitrine) nutzen zuerst diese Angaben und erst dann die Zahl im Stufennamen.
Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes  # noqa: E402
from services import migrations  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-20")
    try:
        yield instance
    finally:
        await shutdown()


async def _board(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)


async def _lineage(flow, **fields) -> dict:
    response = await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Liga 4vs4", "kind": "team_league", **fields})
    assert response.status_code == 200, response.text
    return response.json()


async def _series(flow, lineage_id: str, **fields) -> dict:
    response = await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage_id, "season": "2025", **fields})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_a_season_carries_its_result_and_can_clear_it(flow):
    await _board(flow)
    lineage = await _lineage(flow)
    series = await _series(flow, lineage["id"], tier="Gold", season_result="promoted")
    assert series["season_result"] == "promoted"

    for value in ("relegated", "stayed", "champion"):
        response = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"season_result": value})
        assert response.status_code == 200, response.text
        assert response.json()["season_result"] == value
    cleared = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"season_result": None})
    assert cleared.json()["season_result"] is None
    wrong = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"season_result": "abgestiegen"})
    assert wrong.status_code == 422
    # Ohne Angabe bleibt das Feld leer.
    plain = await _series(flow, lineage["id"], season="2026")
    assert plain.get("season_result") is None


@pytest.mark.asyncio
async def test_a_lineage_keeps_its_own_order_of_tiers(flow):
    await _board(flow)
    lineage = await _lineage(flow, tier_order=[" Gold ", "Silber", "gold", "", "Bronze"])
    assert lineage["tier_order"] == ["Gold", "Silber", "Bronze"]
    changed = await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"tier_order": ["Silber", "Gold"]})
    assert changed.json()["tier_order"] == ["Silber", "Gold"]
    # Leer heißt: wieder die Vorgabe aus der Zahl im Namen.
    reset = await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"tier_order": []})
    assert reset.json()["tier_order"] is None
    too_long = await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"tier_order": ["x" * 61]})
    assert too_long.status_code == 422
    overview = (await flow.get(ADMIN)).json()
    assert overview["lineages"][0]["tier_order"] is None


@pytest.mark.asyncio
async def test_the_public_page_and_the_league_path_carry_result_and_order(flow):
    await _board(flow)
    lineage = await _lineage(flow, tier_order=["Gold", "Silber"])
    first = await _series(flow, lineage["id"], tier="Silber", status="completed", season_result="promoted")
    second = await _series(flow, lineage["id"], season="2026", tier="Gold", status="active")
    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{second['season_slug']}")).json()
    assert page["lineage"]["tier_order"] == ["Gold", "Silber"]
    assert page["series"]["season_result"] is None
    path = page["team_league"]["path"]
    assert [(item["season_slug"], item["season_result"]) for item in path] == [
        (first["season_slug"], "promoted"), (second["season_slug"], None)]


@pytest.mark.asyncio
async def test_the_overview_lineages_carry_result_and_order(flow):
    await _board(flow)
    lineage = await _lineage(flow, tier_order=["Gold", "Silber"])
    first = await _series(flow, lineage["id"], tier="Silber", status="completed", season_result="promoted")
    await _series(flow, lineage["id"], season="2026", tier="Gold", status="active")
    flow.act_as(None)
    response = await flow.get(f"{PUBLIC}/lineages")
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["lineage"]["tier_order"] == ["Gold", "Silber"]
    assert [(season["season_slug"], season["season_result"]) for season in item["seasons"]] == [
        (first["season_slug"], "promoted"), ("2026-gold", None)]
