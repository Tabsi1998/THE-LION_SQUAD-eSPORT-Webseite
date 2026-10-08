"""Teilen (#1154): jede der sechs Seitenarten liefert beim Teilen Titel und Vorschaubild für WhatsApp und Discord;
das Bild ist das Banner (bis #1281 eigene Bilder zeichnet). Mitglieder-Alben verraten dabei nichts."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def preview_html(flow, path):
    flow.act_as(None)
    response = await flow.get("/api/seo/preview", params={"path": path})
    assert response.status_code == 200, path
    return response.text


def og(html, prop):
    marker = f'property="og:{prop}" content="'
    start = html.index(marker) + len(marker)
    return html[start:html.index('"', start)]


@pytest.mark.asyncio
async def test_sechs_seitenarten_liefern_titel_und_banner(flow):
    soon = (now_utc() + timedelta(days=20)).isoformat()
    past = (now_utc() - timedelta(days=2)).isoformat()
    await flow.db.events.insert_one({"id": "e1", "slug": "herbst-lan", "name": "Herbst-LAN 2026", "status": "scheduled", "visibility": "public", "start_date": soon, "banner_url": "/api/static/uploads/lan.webp"})
    await flow.db.tournaments.insert_one({"id": "t1", "slug": "fc-cup", "title": "FC 26 Cup", "status": "registration_open", "visibility": "public", "start_date": soon, "banner_url": "/api/static/uploads/cup.webp"})
    await flow.db.f1_challenges.insert_one({"id": "f1", "slug": "monza", "title": "Monza Hotlap", "status": "active", "visibility": "public", "start_date": past, "banner_url": "/api/static/uploads/monza.webp"})
    await flow.db.news_posts.insert_one({"id": "n1", "slug": "saisonfinale", "title": "Saisonfinale im Vereinsheim", "published": True, "visibility": "public", "published_at": past, "banner_url": "/api/static/uploads/finale.webp"})
    await flow.db.teams.insert_one({"id": "team1", "name": "Lions Rocket", "tag": "LRK", "is_public": True, "logo_url": "/api/static/uploads/logo.webp", "banner_url": "/api/static/uploads/team-banner.webp"})
    await flow.db.gallery_albums.insert_one({"id": "a1", "slug": "sommerfest", "title": "Sommerfest 2026", "published": True, "visibility": "public", "cover_url": "/api/static/uploads/sommer.webp"})
    cases = {
        "/events/herbst-lan": ("Herbst-LAN 2026", "lan.webp"),
        "/tournaments/fc-cup": ("FC 26 Cup", "cup.webp"),
        "/fastlap/monza": ("Monza Hotlap", "monza.webp"),
        "/news/saisonfinale": ("Saisonfinale im Vereinsheim", "finale.webp"),
        "/teams/team1": ("Lions Rocket", "team-banner.webp"),
        "/galerie/sommerfest": ("Sommerfest 2026", "sommer.webp"),
    }
    for path, (title, image) in cases.items():
        html = await preview_html(flow, path)
        assert title in og(html, "title"), path
        assert og(html, "image").endswith(image), path
        assert og(html, "url").endswith(path), path


@pytest.mark.asyncio
async def test_mitglieder_album_laesst_sich_teilen_verraet_aber_nichts(flow):
    await flow.db.gallery_albums.insert_one({"id": "a2", "slug": "vereinsabend", "title": "Geheimer Vereinsabend", "published": True, "visibility": "members", "cover_url": "/api/static/uploads/geheim.webp"})
    html = await preview_html(flow, "/galerie/vereinsabend")
    assert "Geheimer Vereinsabend" not in html
    assert "geheim.webp" not in html
    assert "noindex" in html
