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


# ---------------------------------------------------------------- NW3 wer geändert hat, Verlauf, Autor, Zurückziehen

@pytest.mark.asyncio
async def test_edits_record_who_changed_what_and_show_a_history(flow):
    rita = await flow.add_user(role="club_admin", name="Rita")
    flow.act_as(rita)
    created = (await flow.post("/api/news", json={"title": "Herbst-LAN", "content": "Text", "published": False})).json()
    assert created["updated_by_name"] == "Rita"
    moritz = await flow.add_user(role="club_admin", name="Moritz")
    flow.act_as(moritz)
    saved = (await flow.patch(f"/api/news/{created['id']}", json={"title": "Herbst-LAN 2026", "excerpt": "Alles dazu."})).json()
    assert saved["updated_by"] == moritz["id"] and saved["updated_by_name"] == "Moritz"
    history = (await flow.get(f"/api/admin/news/{created['id']}")).json()["history"]
    assert [(row["label"], row["by"]) for row in history] == [("Geändert", "Moritz"), ("Angelegt", "Rita")]
    assert history[0]["fields"] == ["Titel", "Adresse", "Kurzbeschreibung"]


@pytest.mark.asyncio
async def test_author_can_be_changed_to_an_account_of_the_newsroom(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="Rita"))
    created = (await flow.post("/api/news", json={"title": "Bericht", "content": "Text", "published": False})).json()
    writer = await flow.add_user(name="Gastautorin")
    await flow.db.users.update_one({"id": writer["id"]}, {"$set": {"areas": ["content"]}})
    saved = (await flow.patch(f"/api/news/{created['id']}", json={"author_id": writer["id"]})).json()
    assert saved["author_id"] == writer["id"] and saved["author_name"] == "Gastautorin"
    reader = await flow.add_user(name="Leserin")
    banned = await flow.add_user(name="Gesperrt")
    await flow.db.users.update_one({"id": banned["id"]}, {"$set": {"areas": ["content"], "is_banned": True}})
    for wrong in ("gibt-es-nicht", reader["id"], banned["id"]):
        refused = await flow.patch(f"/api/news/{created['id']}", json={"author_id": wrong})
        assert refused.status_code == 400, wrong


@pytest.mark.asyncio
async def test_published_posts_are_withdrawn_not_deleted_and_links_show_a_hint(flow):
    post = await news(flow, "abgesagt", newsletter_sent_at=now_utc().isoformat(), discord_checked_at=now_utc().isoformat())
    flow.act_as(await flow.add_user(role="club_admin", name="Rita"))
    refused = await flow.delete(f"/api/news/{post['id']}")
    assert refused.status_code == 409 and "zurückziehen" in refused.json()["detail"]
    withdrawn = (await flow.post(f"/api/news/{post['id']}/withdraw")).json()
    assert withdrawn["published"] is False and withdrawn["withdrawn_at"] and withdrawn["withdrawn_by_name"] == "Rita"
    assert (await flow.get("/api/news/abgesagt")).json()["preview"]["state"] == "withdrawn", "das Admin-Team sieht die Vorschau"

    flow.act_as(None)
    gone = await flow.get("/api/news/abgesagt")
    assert gone.status_code == 410 and "zurückgezogen" in gone.json()["detail"]
    assert (await flow.get("/api/news")).json() == []
    assert await flow.db.news_posts.count_documents({"id": post["id"]}) == 1, "nichts wird gelöscht"

    flow.act_as(await flow.add_user(role="club_admin", name="Moritz"))
    restored = (await flow.post(f"/api/news/{post['id']}/restore")).json()
    assert restored["published"] is False and "withdrawn_at" not in restored, "zurück als Entwurf"
    labels = [row["label"] for row in (await flow.get(f"/api/admin/news/{post['id']}")).json()["history"]]
    assert labels == ["Wiederhergestellt", "Zurückgezogen"]


@pytest.mark.asyncio
async def test_drafts_that_never_went_out_can_still_be_deleted(flow):
    draft = await news(flow, "notiz", published=False)
    flow.act_as(await flow.add_user(role="club_admin", name="Rita"))
    deleted = await flow.delete(f"/api/news/{draft['id']}")
    assert deleted.status_code == 200
    assert await flow.db.news_posts.count_documents({"id": draft["id"]}) == 0


@pytest.mark.asyncio
async def test_republishing_a_withdrawn_post_does_not_send_the_newsletter_again(flow, monkeypatch):
    import routes.news_routes as news_routes

    calls = []

    async def fake_enqueue(kind, item, dedupe_suffix=""):
        calls.append(item.get("id"))
        return {"queued": 1}

    monkeypatch.setattr(news_routes, "enqueue_newsletter_for_item", fake_enqueue)
    post = await news(flow, "zurueck", newsletter_sent_at="2026-10-01T10:00:00+00:00", newsletter_sent_count=12)
    flow.act_as(await flow.add_user(role="club_admin", name="Rita"))
    await flow.post(f"/api/news/{post['id']}/withdraw")
    saved = (await flow.patch(f"/api/news/{post['id']}", json={"published": True})).json()
    assert saved["published"] is True and "withdrawn_at" not in saved
    assert saved["newsletter_sent_at"] == "2026-10-01T10:00:00+00:00" and saved["newsletter_sent_count"] == 12
    assert calls == [], "der Newsletter ging schon hinaus - kein zweites Mal"


@pytest.mark.asyncio
async def test_author_search_is_for_the_newsroom_only(flow):
    writer = await flow.add_user(name="Gastautorin")
    await flow.db.users.update_one({"id": writer["id"]}, {"$set": {"areas": ["content"]}})
    await flow.add_user(name="Gastleserin")
    flow.act_as(await flow.add_user(role="club_admin", name="Rita"))
    hits = (await flow.get("/api/admin/people/search", params={"purpose": "news_author", "q": "Gast"})).json()
    assert [hit["name"] for hit in hits] == ["Gastautorin"] and "email" not in hits[0], "nur, wer News pflegen darf"
    flow.act_as(await flow.add_user(name="leser"))
    assert (await flow.get("/api/admin/people/search", params={"purpose": "news_author", "q": "Gast"})).status_code == 403


# ---------------------------------------------------------------- NW1 Rückfrage „geht an N Personen“

@pytest.mark.asyncio
async def test_audience_counts_newsletter_recipients_before_the_first_save(flow):
    for name in ("Anna", "Bernd"):
        reader = await flow.add_user(name=name)
        await flow.db.users.update_one({"id": reader["id"]}, {"$set": {"newsletter_consent": True, "email": f"{name.lower()}@example.org"}})
    flow.act_as(await flow.add_user(role="club_admin", name="Rita"))
    body = (await flow.get("/api/settings/newsletter/audience", params={"kind": "news", "visibility": "public"})).json()
    assert body["recipients"] == 2 and body["internal"] is False
    internal = (await flow.get("/api/settings/newsletter/audience", params={"kind": "news", "visibility": "internal"})).json()
    assert internal["recipients"] == 0 and internal["internal"] is True and "Vereinsverwaltung" in internal["announcement"]
    flow.act_as(await flow.add_user(name="leser"))
    assert (await flow.get("/api/settings/newsletter/audience", params={"kind": "news"})).status_code == 403


@pytest.mark.asyncio
async def test_new_draft_sends_nothing_and_publishing_sends_once(flow, monkeypatch):
    import routes.news_routes as news_routes

    calls = []

    async def fake_enqueue(kind, item, dedupe_suffix=""):
        calls.append(item.get("id"))
        return {"queued": 3}

    monkeypatch.setattr(news_routes, "enqueue_newsletter_for_item", fake_enqueue)
    flow.act_as(await flow.add_user(role="club_admin", name="Rita"))
    draft = (await flow.post("/api/news", json={"title": "Plan", "content": "Text", "published": False})).json()
    assert calls == [] and not draft.get("newsletter_sent_at")
    published = (await flow.patch(f"/api/news/{draft['id']}", json={"published": True, "published_at": now_utc().isoformat()})).json()
    assert calls == [draft["id"]] and published["newsletter_sent_count"] == 3
    await flow.patch(f"/api/news/{draft['id']}", json={"excerpt": "Nachtrag"})
    assert calls == [draft["id"]], "eine spätere Änderung verschickt nichts ein zweites Mal"


@pytest.mark.asyncio
async def test_scheduled_post_waits_for_its_time(flow, monkeypatch):
    import routes.news_routes as news_routes

    calls = []

    async def fake_enqueue(kind, item, dedupe_suffix=""):
        calls.append(item.get("id"))
        return {"queued": 1}

    monkeypatch.setattr(news_routes, "enqueue_newsletter_for_item", fake_enqueue)
    flow.act_as(await flow.add_user(role="club_admin", name="Rita"))
    later = (now_utc() + timedelta(days=3)).isoformat()
    planned = (await flow.post("/api/news", json={"title": "Liga-Start", "content": "Text", "published": True, "published_at": later})).json()
    assert calls == [] and not planned.get("newsletter_sent_at"), "geplant: der Newsletter geht erst zum Termin"


# ---------------------------------------------------------------- Nachbesserung aus dem Review

async def content_editor(flow, name="bereichsredaktion"):
    """Redaktion über den Bereich (Freigabe/Vorstandsposten), ohne Admin-Rolle."""
    editor = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": editor["id"]}, {"$set": {"areas": ["content"]}})
    return {**editor, "areas": ["content"]}


@pytest.mark.asyncio
async def test_preview_works_for_editors_with_the_content_area(flow):
    await news(flow, "entwurf", published=False)
    await news(flow, "zurueck", published=False, withdrawn_at=now_utc().isoformat())
    flow.act_as(await content_editor(flow))
    draft = await flow.get("/api/news/entwurf")
    assert draft.status_code == 200 and draft.json()["preview"] == {"state": "draft"}
    assert (await flow.get("/api/news/zurueck")).json()["preview"]["state"] == "withdrawn"
    flow.act_as(await flow.add_user(name="leser"))
    assert (await flow.get("/api/news/entwurf")).status_code == 404


@pytest.mark.asyncio
async def test_withdrawn_member_post_stays_not_found_for_guests(flow):
    await news(flow, "intern-weg", visibility="members", published=False, withdrawn_at=now_utc().isoformat())
    flow.act_as(None)
    assert (await flow.get("/api/news/intern-weg")).status_code == 404, "erst die Sichtbarkeit, dann der Hinweis"


INTERNAL = {"updated_by", "updated_by_name", "withdrawn_by_name", "newsletter_sent_at", "newsletter_sent_count",
            "news_mention_notified_user_ids", "discord_outcome", "members_notified_at"}


@pytest.mark.asyncio
async def test_guests_never_see_internal_fields(flow):
    await news(flow, "offen", updated_by="u-red", updated_by_name="Rita Redaktion", newsletter_sent_at="2026-10-01T10:00:00+00:00",
               newsletter_sent_count=3, news_mention_notified_user_ids=["u-1"], discord_outcome="sent", members_notified_at="2026-10-01")
    flow.act_as(None)
    listed = (await flow.get("/api/news")).json()
    detail = (await flow.get("/api/news/offen")).json()
    home = (await flow.get("/api/home/state")).json()["news"]
    for row in (listed[0], detail, home[0]):
        assert not INTERNAL & set(row), f"interne Felder nach außen: {sorted(INTERNAL & set(row))}"
    assert "Rita Redaktion" not in str(listed) + str(detail) + str(home)
    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    assert (await flow.get("/api/admin/news/n-offen")).json()["updated_by_name"] == "Rita Redaktion", "Admin → News behält sie"


@pytest.mark.asyncio
async def test_back_to_draft_on_a_public_post_is_a_withdrawal(flow):
    post = await news(flow, "war-offen", newsletter_sent_at=now_utc().isoformat())
    flow.act_as(await flow.add_user(role="club_admin", name="Rita"))
    saved = (await flow.patch(f"/api/news/{post['id']}", json={"published": False})).json()
    assert saved["withdrawn_at"] and saved["withdrawn_by_name"] == "Rita"
    assert [row["label"] for row in (await flow.get(f"/api/admin/news/{post['id']}")).json()["history"]] == ["Zurückgezogen"]
    flow.act_as(None)
    assert (await flow.get("/api/news/war-offen")).status_code == 410, "Hinweis statt „nicht gefunden“"


@pytest.mark.asyncio
async def test_unpublishing_a_scheduled_post_that_never_went_out_is_just_a_draft(flow):
    post = await news(flow, "geplant-weg", days_ago=-3)
    flow.act_as(await flow.add_user(role="club_admin", name="Rita"))
    saved = (await flow.patch(f"/api/news/{post['id']}", json={"published": False})).json()
    assert saved["published"] is False and "withdrawn_at" not in saved
