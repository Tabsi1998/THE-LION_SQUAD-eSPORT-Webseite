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
