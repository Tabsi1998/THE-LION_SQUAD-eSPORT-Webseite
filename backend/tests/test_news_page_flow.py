"""News-Seite und Startseite (#1249, #1342, #1343, #1266): Kategorien mit Anzahl je Besucher, der Aufmacher,
der Sieger für die Text-Karte und der Anmelde-Stand verknüpfter Turniere und Events."""
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


async def news(flow, slug, *, category="club", visibility="public", published=True, days_ago=1, **fields):
    doc = {
        "id": f"n-{slug}", "slug": slug, "title": slug.title(), "content": "Text", "category": category,
        "visibility": visibility, "published": published,
        "published_at": (now_utc() - timedelta(days=days_ago)).isoformat(), "created_at": now_utc().isoformat(),
        **fields,
    }
    await flow.db.news_posts.insert_one(dict(doc))
    return doc


async def member(flow, name):
    user = await flow.add_user(name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"is_club_member": True}})
    await flow.db.memberships.insert_one({"id": f"m-{name}", "user_id": user["id"], "member_status": "active", "membership_type": "ordinary"})
    user["is_club_member"] = True
    return user


def counts(body):
    return {row["k"]: row["count"] for row in body["in_use"]}


# ---------------------------------------------------------------- #1249 Kategorien mit Anzahl

@pytest.mark.asyncio
async def test_news_meta_counts_only_categories_with_visible_articles_per_viewer(flow):
    await news(flow, "turnier-a", category="tournaments")
    await news(flow, "turnier-b", category="tournaments")
    await news(flow, "community", category="community", visibility="community")
    await news(flow, "intern", category="members", visibility="members")
    await news(flow, "entwurf", category="sponsors", published=False)
    await news(flow, "morgen", category="recap", days_ago=-1)

    flow.act_as(None)
    body = (await flow.get("/api/news-meta")).json()
    assert counts(body) == {"tournaments": 2}, "ein Gast zählt weder Community-, Mitglieder- noch Entwurfs-Artikel"
    assert [row["l"] for row in body["in_use"]] == ["Turniere"]
    assert len(body["categories"]) == 10, "die Verwaltung braucht weiter alle Kategorien zur Auswahl"

    flow.act_as(await flow.add_user(name="spielerin"))
    assert counts((await flow.get("/api/news-meta")).json()) == {"tournaments": 2, "community": 1}

    flow.act_as(await member(flow, "mitglied"))
    assert counts((await flow.get("/api/news-meta")).json()) == {"tournaments": 2, "community": 1, "members": 1}


@pytest.mark.asyncio
async def test_news_meta_keeps_the_fixed_order_and_names_unknown_categories(flow):
    await news(flow, "video", category="video")
    await news(flow, "verein", category="club")
    await news(flow, "turnier", category="tournaments")

    flow.act_as(None)
    rows = (await flow.get("/api/news-meta")).json()["in_use"]
    assert [(row["k"], row["l"], row["count"]) for row in rows] == [
        ("club", "Verein", 1), ("tournaments", "Turniere", 1), ("video", "Video", 1),
    ]
