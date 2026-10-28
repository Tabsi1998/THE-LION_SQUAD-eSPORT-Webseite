"""News in der Redaktion (#2122): Beitrag einzeln laden, öffentliche Listen wie für Gäste mit Vorschau für das
Admin-Team, wer zuletzt geändert hat, Verlauf, Autor ändern, Zurückziehen statt Löschen, Entwurf als Start."""
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


async def news(flow, slug, *, visibility="public", published=True, days_ago=1, **fields):
    doc = {
        "id": f"n-{slug}", "slug": slug, "title": slug.title(), "content": "Text", "category": "club",
        "visibility": visibility, "published": published,
        "published_at": (now_utc() - timedelta(days=days_ago)).isoformat(), "created_at": now_utc().isoformat(),
        **fields,
    }
    await flow.db.news_posts.insert_one(dict(doc))
    return doc


# ---------------------------------------------------------------- NW4 Beitrag einzeln

@pytest.mark.asyncio
async def test_editor_loads_a_single_post_even_beyond_the_list_limit(flow):
    await news(flow, "alt", days_ago=600, mentioned_user_ids=["u-x"])
    await flow.db.users.insert_one({"id": "u-x", "username": "erika", "display_name": "Erika Beispiel"})
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    single = await flow.get("/api/admin/news/n-alt")
    assert single.status_code == 200 and single.json()["slug"] == "alt"
    assert [user["display_name"] for user in single.json()["mentioned_users"]] == ["Erika Beispiel"]
    assert (await flow.get("/api/admin/news/gibt-es-nicht")).status_code == 404


@pytest.mark.asyncio
async def test_single_post_needs_the_content_area(flow):
    await news(flow, "geheim")
    flow.act_as(await flow.add_user(name="leser"))
    assert (await flow.get("/api/admin/news/n-geheim")).status_code == 403


# ---------------------------------------------------------------- NW2 öffentliche Listen wie für Gäste

@pytest.mark.asyncio
async def test_public_lists_hide_drafts_and_scheduled_posts_from_admins_too(flow):
    await news(flow, "live")
    await news(flow, "entwurf", published=False)
    await news(flow, "geplant", days_ago=-2)
    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    listed = [row["slug"] for row in (await flow.get("/api/news")).json()]
    assert listed == ["live"], "die öffentliche Liste zeigt dem Vorstand dasselbe wie Gästen"
    compact = [row["slug"] for row in (await flow.get("/api/news?compact=true")).json()]
    assert compact == ["live"]
    in_use = {row["k"]: row["count"] for row in (await flow.get("/api/news-meta")).json()["in_use"]}
    assert in_use == {"club": 1}
    assert [row["title"] for row in (await flow.get("/api/search?q=Live")).json()["items"]] == ["Live"], "die Suche greift"
    assert (await flow.get("/api/search?q=Entwurf")).json()["items"] == []


@pytest.mark.asyncio
async def test_detail_page_shows_admins_a_marked_preview(flow):
    await news(flow, "entwurf", published=False)
    await news(flow, "geplant", days_ago=-2)
    await news(flow, "live")
    flow.act_as(None)
    assert (await flow.get("/api/news/entwurf")).status_code == 404
    assert (await flow.get("/api/news/geplant")).status_code == 404
    assert "preview" not in (await flow.get("/api/news/live")).json()

    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    assert (await flow.get("/api/news/entwurf")).json()["preview"] == {"state": "draft"}
    planned = (await flow.get("/api/news/geplant")).json()["preview"]
    assert planned["state"] == "scheduled" and planned["published_at"]
    assert "preview" not in (await flow.get("/api/news/live")).json()
