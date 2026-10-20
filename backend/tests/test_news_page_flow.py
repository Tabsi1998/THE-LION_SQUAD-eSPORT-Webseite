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


# ---------------------------------------------------------------- #1343 Sieger für die Text-Karte

async def finished_tournament(flow, winner_name, **fields):
    tournament = await flow.create_tournament(**{"status": "results_published", "title": "Kart-Cup", **fields})
    winner = await flow.add_user(name=winner_name)
    second = await flow.add_user(name="Zweiter")
    reg_winner = await flow.register(tournament, winner)
    reg_second = await flow.register(tournament, second)
    await flow.db.tournament_awards.insert_many([
        {"id": "a1-" + tournament["id"], "tournament_id": tournament["id"], "registration_id": reg_winner["id"], "user_id": winner["id"], "rank": 1},
        {"id": "a2-" + tournament["id"], "tournament_id": tournament["id"], "registration_id": reg_second["id"], "user_id": second["id"], "rank": 2},
    ])
    return tournament


@pytest.mark.asyncio
async def test_result_news_carry_the_winner_in_list_and_on_home(flow):
    cup = await finished_tournament(flow, "NeonFalke")
    await news(flow, "ergebnis", category="recap", linked_tournament_ids=[cup["id"]])
    await news(flow, "ankuendigung", category="tournaments", days_ago=2)

    flow.act_as(None)
    listed = {row["slug"]: row for row in (await flow.get("/api/news?compact=true")).json()}
    assert listed["ergebnis"]["result"] == {"winner": "NeonFalke", "tournament": "Kart-Cup"}
    assert listed["ankuendigung"].get("result") is None
    assert "linked_tournament_ids" not in listed["ergebnis"], "die kompakte Liste bleibt schlank"

    home = {row["slug"]: row for row in (await flow.get("/api/home/state")).json()["news"]}
    assert home["ergebnis"]["result"]["winner"] == "NeonFalke"


@pytest.mark.asyncio
async def test_no_winner_before_results_or_for_hidden_tournaments(flow):
    running = await finished_tournament(flow, "Frueh", status="live")
    hidden = await finished_tournament(flow, "Versteckt", is_public=False)
    members = await finished_tournament(flow, "Intern", visibility="members")
    await news(flow, "laeuft", linked_tournament_ids=[running["id"]])
    await news(flow, "versteckt", linked_tournament_ids=[hidden["id"]])
    await news(flow, "mitglieder", linked_tournament_ids=[members["id"]])

    flow.act_as(None)
    listed = {row["slug"]: row for row in (await flow.get("/api/news?compact=true")).json()}
    assert all(row.get("result") is None for row in listed.values())


# ---------------------------------------------------------------- #1342 derselbe Aufmacher

@pytest.mark.asyncio
async def test_home_lead_is_the_pinned_news_like_on_the_news_page(flow):
    await news(flow, "alt-angepinnt", pinned=True, days_ago=30)
    for day in range(1, 10):
        await news(flow, f"neu-{day}", days_ago=day)

    flow.act_as(None)
    state = (await flow.get("/api/home/state")).json()
    assert [n["slug"] for n in state["featured_news"]] == ["alt-angepinnt"], "auch wenn neun neuere News folgen"
    assert "alt-angepinnt" in [n["slug"] for n in state["news"]]
    listed = (await flow.get("/api/news?compact=true")).json()
    assert listed[0]["slug"] == "alt-angepinnt", "die News-Seite stellt dieselbe News nach vorne"


@pytest.mark.asyncio
async def test_home_lead_without_pinned_news_is_the_newest(flow):
    await news(flow, "gestern", days_ago=1)
    await news(flow, "vorgestern", days_ago=2)
    flow.act_as(None)
    assert [n["slug"] for n in (await flow.get("/api/home/state")).json()["featured_news"]] == ["gestern"]
