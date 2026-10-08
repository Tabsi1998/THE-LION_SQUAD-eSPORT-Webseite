"""Verteilen (#1359): den Newsletter einer News schickt die Redaktion, den eines Events, wer das Event bearbeiten darf
(Turnierleitung). Ein zweites Mal nur Redaktion und System. Der Kasten bekommt nur die Zahl der Empfänger, Entwürfe gelten
nicht als gesendet, und der Verlauf gehört dem System."""
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


async def granted(flow, name: str, *areas: str) -> dict:
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": list(areas)}})
    user["areas"] = list(areas)
    return user


async def subscribers(flow, count: int) -> None:
    for index in range(count):
        reader = await flow.add_user(name=f"leserin-{index}")
        await flow.db.users.update_one({"id": reader["id"]}, {"$set": {"newsletter_consent": True}})


async def news(flow, **fields) -> str:
    post_id = new_id()
    await flow.db.news_posts.insert_one({"id": post_id, "slug": f"news-{post_id[:6]}", "title": "Herbst-LAN: Plan steht", "visibility": "public",
                                         "published": True, "published_at": "2026-10-01T10:00:00+00:00", "created_at": "2026-10-01T10:00:00+00:00", **fields})
    return post_id


async def event(flow, **fields) -> str:
    event_id = new_id()
    await flow.db.events.insert_one({"id": event_id, "slug": f"event-{event_id[:6]}", "name": "Herbst-LAN 2026", "visibility": "public",
                                     "status": "scheduled", "start_date": "2026-11-14T10:00:00+00:00", **fields})
    return event_id


@pytest.mark.asyncio
async def test_the_editors_send_news_with_only_the_number_of_recipients(flow):
    await subscribers(flow, 3)
    post_id = await news(flow)
    editor = await granted(flow, "redaktion", "content")
    flow.act_as(editor)
    state = await flow.get("/api/settings/newsletter/state", params={"kind": "news", "id": post_id})
    assert state.status_code == 200, state.text
    box = state.json()
    assert box["recipients"] == 3 and box["state"] == "ready" and box["can_send"] is True and box["can_resend"] is True
    assert "sample" not in box and "example.test" not in str(box), "nur die Zahl, keine Namen oder Adressen"
    preview = await flow.post("/api/settings/newsletter/preview", json={"kind": "news", "id": post_id})
    assert "sample" not in preview.json()

    sent = await flow.post("/api/settings/newsletter/send", json={"kind": "news", "id": post_id})
    assert sent.status_code == 200 and sent.json()["queued"] == 3, sent.text
    after = await flow.get("/api/settings/newsletter/state", params={"kind": "news", "id": post_id})
    assert after.json()["state"] == "sent" and after.json()["sent_count"] == 3
    again = await flow.post("/api/settings/newsletter/send", json={"kind": "news", "id": post_id})
    assert again.json()["skipped"] is True
    forced = await flow.post("/api/settings/newsletter/send", json={"kind": "news", "id": post_id, "force": True})
    assert forced.status_code == 200 and forced.json()["queued"] == 3

    for actor in (await flow.add_user(role="tournament_admin", name="turnierleitung"), await granted(flow, "vorstand", "club")):
        flow.act_as(actor)
        refused_state = await flow.get("/api/settings/newsletter/state", params={"kind": "news", "id": post_id})
        refused_send = await flow.post("/api/settings/newsletter/send", json={"kind": "news", "id": post_id})
        assert (refused_state.status_code, refused_send.status_code) == (403, 403), actor["username"]


@pytest.mark.asyncio
async def test_the_tournament_lead_sends_an_events_newsletter_once_resending_stays_with_the_editors(flow):
    await subscribers(flow, 2)
    event_id = await event(flow)
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    flow.act_as(lead)
    state = await flow.get("/api/settings/newsletter/state", params={"kind": "event", "id": event_id})
    assert state.json()["can_send"] is True and state.json()["can_resend"] is False
    sent = await flow.post("/api/settings/newsletter/send", json={"kind": "event", "id": event_id})
    assert sent.status_code == 200 and sent.json()["queued"] == 2, sent.text
    resend = await flow.post("/api/settings/newsletter/send", json={"kind": "event", "id": event_id, "force": True})
    assert resend.status_code == 403 and "Redaktion und System" in resend.json()["detail"]

    flow.act_as(await granted(flow, "redaktion", "content"))
    editor_resend = await flow.post("/api/settings/newsletter/send", json={"kind": "event", "id": event_id, "force": True})
    assert editor_resend.status_code == 200, editor_resend.text
    flow.act_as(await granted(flow, "vorstand", "club"))
    club_state = await flow.get("/api/settings/newsletter/state", params={"kind": "event", "id": event_id})
    assert club_state.status_code == 403


@pytest.mark.asyncio
async def test_drafts_and_internal_posts_are_never_marked_as_sent(flow):
    await subscribers(flow, 2)
    draft_id = await news(flow, published=False)
    internal_id = await news(flow, visibility="internal")
    flow.act_as(await granted(flow, "redaktion", "content"))
    draft_box = await flow.get("/api/settings/newsletter/state", params={"kind": "news", "id": draft_id})
    assert draft_box.json()["state"] == "draft" and draft_box.json()["recipients"] == 2
    refused = await flow.post("/api/settings/newsletter/send", json={"kind": "news", "id": draft_id})
    assert refused.status_code == 409 and "noch nicht veröffentlicht" in refused.json()["detail"]
    internal_box = await flow.get("/api/settings/newsletter/state", params={"kind": "news", "id": internal_id})
    assert internal_box.json()["state"] == "internal" and internal_box.json()["recipients"] == 0
    assert "Vereinsverwaltung bekommt eine Meldung" in internal_box.json()["announcement"]
    internal_send = await flow.post("/api/settings/newsletter/send", json={"kind": "news", "id": internal_id})
    assert internal_send.status_code == 409
    stored = [row async for row in flow.db.news_posts.find({"id": {"$in": [draft_id, internal_id]}}, {"_id": 0, "newsletter_sent_at": 1})]
    assert all(not row.get("newsletter_sent_at") for row in stored)


@pytest.mark.asyncio
async def test_the_history_belongs_to_the_system_area(flow):
    await news(flow, newsletter_sent_at="2026-10-05T16:02:00+00:00", newsletter_sent_count=211)
    flow.act_as(await granted(flow, "redaktion", "content"))
    refused = await flow.get("/api/settings/newsletter/history")
    assert refused.status_code == 403
    flow.act_as(await flow.add_user(role="superadmin", name="root"))
    history = await flow.get("/api/settings/newsletter/history")
    rows = history.json()["items"]
    assert rows[0]["sent_count"] == 211 and rows[0]["kind"] == "news" and rows[0]["visibility"] == "public"
