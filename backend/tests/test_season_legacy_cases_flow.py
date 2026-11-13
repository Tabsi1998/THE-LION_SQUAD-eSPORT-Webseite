"""Jahreswertungen: die noch gültigen Fälle der alten Live-Tests, jetzt durch die echten Routen (#932).

Eine neue Wertung lässt sich anlegen, finden (Liste und Seite über den Slug) und als Entwurf wieder löschen; die
Startseite zeigt von der aktiven Wertung die Spitze - höchstens fünf Einträge mit Platz, Punkten und Namen.

Ersetzt:
- test_phase2_3.py::TestSeasons::test_create_list_delete_season
- test_phase3.py::test_featured_standings_shape
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_create_find_and_delete_a_draft_season(flow):
    flow.act_as(await flow.add_staff())
    created = await flow.post("/api/seasons", json={"name": "Saison Test", "slug": "saison-test", "kind": "season"})
    assert created.status_code == 200, created.text
    season = created.json()
    assert season["id"] and season["status"] == "draft"

    listed = await flow.get("/api/seasons")
    assert "saison-test" in [row["slug"] for row in listed.json()]
    page = await flow.get("/api/seasons/saison-test")
    assert page.status_code == 200, page.text
    assert page.json()["id"] == season["id"]

    deleted = await flow.delete(f"/api/seasons/{season['id']}")
    assert deleted.status_code == 200, deleted.text
    assert await flow.db.seasons.count_documents({"id": season["id"]}) == 0


@pytest.mark.asyncio
async def test_featured_season_shows_at_most_five_ranked_rows(flow):
    season_id = new_id()
    await flow.db.seasons.insert_one({"id": season_id, "slug": "saison-aktiv", "name": "Saison aktiv", "status": "active",
                                      "start_date": "2026-01-01T00:00:00"})
    # Ein Entwurf ist nie die vorgestellte Wertung.
    await flow.db.seasons.insert_one({"id": new_id(), "slug": "saison-entwurf", "name": "Entwurf", "status": "draft",
                                      "start_date": "2026-06-01T00:00:00"})
    points = [60, 50, 40, 30, 20, 10, 5]
    people = []
    for index, total in enumerate(points):
        user = await flow.add_user(name=f"spieler{index + 1}")
        people.append(user)
        await flow.db.season_points.insert_one({
            "id": new_id(), "season_id": season_id, "user_id": user["id"], "team_id": None,
            "source_type": "tournament", "source_id": f"t-{index}", "rank": index + 1,
            "raw_points": total, "total_points": total,
        })

    flow.act_as(None)
    featured = await flow.get("/api/seasons/active/featured")
    assert featured.status_code == 200, featured.text
    data = featured.json()
    assert data["season"]["id"] == season_id
    standings = data["standings"]
    assert len(standings) == 5
    assert [row["rank"] for row in standings] == [1, 2, 3, 4, 5]
    assert [row["points"] for row in standings] == points[:5]
    assert [row["display_name"] for row in standings] == [person["display_name"] for person in people[:5]]
