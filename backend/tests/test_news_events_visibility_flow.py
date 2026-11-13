"""News und Events nach Sichtbarkeit (#932): Gäste sehen nur Öffentliches, angemeldete Personen dazu die
Community-Beiträge, Mitglieder-Inhalte bleiben gesperrt, Entwürfe sieht nur die Verwaltung, und anlegen darf eine
normale Person weder News noch Events.

Durch die echte Anwendung (flow_harness) statt gegen einen laufenden Server. Ersetzt aus
test_phase3_news_events_gallery.py: TestNews::test_public_list_only_published_public_pinned_first,
TestNews::test_community_user_sees_public_and_community, TestNews::test_filter_by_category,
TestNews::test_members_visibility_anon_403, TestNews::test_cu_cannot_create_news, TestNews::test_admin_news_includes_drafts,
TestNews::test_anon_news_excludes_drafts, TestEvents::test_list_events_anon_no_drafts, TestEvents::test_upcoming_filter,
TestEvents::test_filter_by_event_type, TestEvents::test_draft_event_anon_404, TestEvents::test_members_event_anon_403,
TestEvents::test_cu_cannot_create_event; aus test_phase4_documents.py: test_anon_does_not_see_members_news.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def news(flow, slug: str, *, visibility: str = "public", category: str = "club", published: bool = True,
               pinned: bool = False, published_at: str = "2026-10-01T10:00:00+00:00") -> None:
    await flow.db.news_posts.insert_one({
        "id": new_id(), "slug": slug, "title": f"Beitrag {slug}", "content": "Text", "category": category,
        "visibility": visibility, "published": published, "pinned": pinned, "published_at": published_at,
        "created_at": published_at,
    })


async def event(flow, slug: str, *, status: str = "scheduled", visibility: str = "public", event_type: str = "general",
                start: str = "2030-06-01T18:00:00+00:00", end: str | None = None) -> None:
    await flow.db.events.insert_one({
        "id": new_id(), "slug": slug, "name": f"Event {slug}", "status": status, "visibility": visibility,
        "event_type": event_type, "start_date": start, "end_date": end or start,
    })


async def news_slugs(flow, **params) -> list[str]:
    res = await flow.get("/api/news", params=params)
    assert res.status_code == 200, res.text
    return [post["slug"] for post in res.json()]


async def event_rows(flow, **params) -> list[dict]:
    res = await flow.get("/api/events", params=params)
    assert res.status_code == 200, res.text
    return res.json()


# ---------------------------------------------------------------- News
@pytest.mark.asyncio
async def test_news_list_follows_visibility_and_puts_pinned_first(flow):
    # Der angepinnte Beitrag ist älter - er steht trotzdem vorne.
    await news(flow, "angepinnt", category="announcement", pinned=True, published_at="2026-09-01T10:00:00+00:00")
    await news(flow, "normal")
    await news(flow, "community", visibility="community", category="community")
    await news(flow, "mitglieder", visibility="members", category="members")
    await news(flow, "entwurf", published=False)

    flow.act_as(None)
    guest = await news_slugs(flow)
    assert guest == ["angepinnt", "normal"], "Gäste sehen nur Veröffentlichtes und Öffentliches"
    members_detail = await flow.get("/api/news/mitglieder")
    assert members_detail.status_code == 403

    flow.act_as(await flow.add_user(name="community"))
    logged_in = await news_slugs(flow)
    assert set(logged_in) == {"angepinnt", "normal", "community"}, "ohne Mitgliedschaft keine Mitglieder-News"
    assert logged_in[0] == "angepinnt"


@pytest.mark.asyncio
async def test_news_filter_by_category(flow):
    await news(flow, "ankuendigung", category="announcement")
    await news(flow, "verein", category="club")
    flow.act_as(None)
    res = await flow.get("/api/news", params={"category": "announcement"})
    assert res.status_code == 200
    rows = res.json()
    assert [post["slug"] for post in rows] == ["ankuendigung"]
    assert all(post["category"] == "announcement" for post in rows)


@pytest.mark.asyncio
async def test_only_the_editorial_team_creates_news_and_sees_drafts(flow):
    await news(flow, "entwurf", published=False)
    flow.act_as(await flow.add_user(name="community"))
    refused = await flow.post("/api/news", json={"title": "Nein", "content": "x", "category": "club"})
    assert refused.status_code == 403, refused.text
    assert await flow.db.news_posts.count_documents({"title": "Nein"}) == 0

    flow.act_as(await flow.add_staff())
    admin_list = await flow.get("/api/admin/news")
    assert admin_list.status_code == 200
    assert "entwurf" in [post["slug"] for post in admin_list.json()]
    # Die öffentliche Liste bleibt auch für die Verwaltung ohne Entwurf.
    assert "entwurf" not in await news_slugs(flow)


# ---------------------------------------------------------------- Events
@pytest.mark.asyncio
async def test_event_list_hides_drafts_and_filters_by_type_and_upcoming(flow):
    await event(flow, "lan", event_type="lan_party")
    await event(flow, "vereinsabend", event_type="club_evening")
    await event(flow, "entwurf", status="draft")
    await event(flow, "vorbei", status="completed", start="2026-01-01T18:00:00+00:00")
    await event(flow, "archiv", status="archived")
    await event(flow, "gestern", start="2025-01-01T18:00:00+00:00")
    flow.act_as(None)

    listed = await event_rows(flow)
    assert "draft" not in {row["status"] for row in listed}
    assert "entwurf" not in [row["slug"] for row in listed]

    by_type = await event_rows(flow, event_type="lan_party")
    assert [row["slug"] for row in by_type] == ["lan"]

    upcoming = await event_rows(flow, upcoming="true")
    assert {row["slug"] for row in upcoming} == {"lan", "vereinsabend"}
    assert not {row["status"] for row in upcoming} & {"completed", "archived", "draft"}


@pytest.mark.asyncio
async def test_event_detail_hides_drafts_and_members_events_from_guests(flow):
    await event(flow, "entwurf", status="draft")
    await event(flow, "nur-mitglieder", visibility="members")
    flow.act_as(None)
    draft = await flow.get("/api/events/entwurf")
    assert draft.status_code == 404
    members = await flow.get("/api/events/nur-mitglieder")
    assert members.status_code == 403


@pytest.mark.asyncio
async def test_a_normal_person_cannot_create_an_event(flow):
    flow.act_as(await flow.add_user(name="community"))
    refused = await flow.post("/api/events", json={"name": "Nein", "event_type": "general"})
    assert refused.status_code == 403, refused.text
    assert await flow.db.events.count_documents({}) == 0
