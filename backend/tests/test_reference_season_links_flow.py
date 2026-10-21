"""Referenzen aus einer Saison (#1750): die Karte führt zur Saison-Seite. Liste, Detail und Mitgliederprofil tragen
``season_link`` (Spur- und Saison-Adresse, Bezeichnung, ob es die Referenz des Saisonabschlusses ist) - nur, wenn Spur
und Saison für den Besucher sichtbar und nicht archiviert sind. Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

ADMIN = "/api/reference-series/admin"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _setup(flow):
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    await flow.db.club_member_profiles.insert_one(
        {"id": "profil-alpha", "slug": "probe-alpha", "display_name": "Probe Alpha", "is_active": True})
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Liga", "kind": "team_league"})).json()
    season = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "tier": "Division 2", "status": "completed"})).json()
    hidden = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2025", "status": "completed", "visibility": "members"})).json()

    async def reference(title, **extra):
        response = await flow.post("/api/references", json={
            "title": title, "entries": [{"kind": "team", "team_name": "Probe Löwen", "placement": 2,
                                         "member_profile_ids": ["profil-alpha"]}], **extra})
        assert response.status_code == 200, response.text
        return response.json()

    linked = await reference("Probe Cup Mai", series_id=season["id"])
    closing = await reference("Probe Liga 2026")
    await flow.db.reference_series.update_one({"id": season["id"]}, {"$set": {"reference_id": closing["id"]}})
    secret = await reference("Probe Liga 2025", series_id=hidden["id"])
    alone = await reference("Probe Einzelturnier")
    return lineage, season, hidden, {"linked": linked, "closing": closing, "secret": secret, "alone": alone}


@pytest.mark.asyncio
async def test_list_and_detail_carry_the_season_link(flow):
    lineage, season, _, refs = await _setup(flow)
    flow.act_as(None)
    items = {item["title"]: item for item in (await flow.get("/api/references")).json()["items"]}
    expected = {"lineage_slug": lineage["slug"], "season_slug": season["season_slug"],
                "label": "Probe Liga · 2026 · Division 2"}
    assert items["Probe Cup Mai"]["season_link"] == {**expected, "season_end": False}
    assert items["Probe Liga 2026"]["season_link"] == {**expected, "season_end": True}
    # Nicht sichtbare Saison: keine Verknüpfung nach außen.
    assert items["Probe Liga 2025"].get("season_link") is None
    assert items["Probe Einzelturnier"].get("season_link") is None
    detail = (await flow.get(f"/api/references/{refs['closing']['id']}")).json()
    assert detail["season_link"] == {**expected, "season_end": True}


@pytest.mark.asyncio
async def test_archived_season_is_not_linked(flow):
    _, season, _, refs = await _setup(flow)
    assert (await flow.post(f"{ADMIN}/series/{season['id']}/archive")).status_code == 200
    flow.act_as(None)
    detail = (await flow.get(f"/api/references/{refs['linked']['id']}")).json()
    assert detail.get("season_link") is None


@pytest.mark.asyncio
async def test_member_profile_cards_lead_to_the_season(flow):
    lineage, season, _, _ = await _setup(flow)
    flow.act_as(None)
    profile = (await flow.get("/api/membership/profiles/probe-alpha")).json()
    links = {item["title"]: item.get("season_link") for item in profile["references"]}
    assert links["Probe Liga 2026"]["season_slug"] == season["season_slug"]
    assert links["Probe Liga 2026"]["lineage_slug"] == lineage["slug"]
    assert links["Probe Einzelturnier"] is None
