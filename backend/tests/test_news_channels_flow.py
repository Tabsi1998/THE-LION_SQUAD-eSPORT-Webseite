"""Kanal einer News (#1532): Website und App, nur App oder nur Website - Matrix aus Kanal und Fläche.

Jede Fläche wird mit allen drei Kanälen und einer alten News ohne Feld geprüft (Gegenprobe: die beiden anderen Kanäle
stehen jeweils mit drin). Die Website fragt mit der Kopfzeile ``X-LSW-Channel: web``; die App sendet heute nichts und
gilt ohne Kopfzeile als App.

Direkter Link: Die Web-Detailseite zeigt bei „nur App“ keinen Inhalt (404 mit Code ``app_only``, die Seite schreibt
„gibt es in der LionsAPP“), die Link-Vorschau eine neutrale Karte ohne Inhalt und ohne Suchmaschine. In der App öffnet
jede News über ihren Link - Android leitet Website-Links auf ``/news/…`` in die App (App-Links), sonst endeten
Newsletter- und Discord-Links zu „nur Website“ auf dem Handy bei „nicht gefunden“.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_announcements, member_announcements, news_publish  # noqa: E402
from services.notification_preferences import enqueue_newsletter_for_item, mode_preferences  # noqa: E402

WEB = {"X-LSW-Channel": "web"}
ALL = {"beides", "alt", "nurapp", "nurweb"}
ON_WEB = {"beides", "alt", "nurweb"}
ON_APP = {"beides", "alt", "nurapp"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def news(flow, slug, *, channels=None, days_ago=1, **fields):
    doc = {
        "id": f"n-{slug}", "slug": slug, "title": f"Kanal {slug}", "excerpt": "Kanalprobe", "content": "Kanalprobe Text",
        "category": "club", "visibility": "public", "published": True,
        "published_at": (now_utc() - timedelta(days=days_ago)).isoformat(), "created_at": now_utc().isoformat(),
        **fields,
    }
    if channels is not None:
        doc["channels"] = channels
    await flow.db.news_posts.insert_one(dict(doc))
    return doc


async def four(flow, **fields):
    """Eine News je Kanal und eine alte ohne Feld."""
    await news(flow, "beides", channels=["web", "app"], **fields)
    await news(flow, "alt", **fields)
    await news(flow, "nurapp", channels=["app"], **fields)
    await news(flow, "nurweb", channels=["web"], **fields)


def slugs(rows):
    return {row["slug"] for row in rows if row.get("slug") in ALL}


# ---------------------------------------------------------------- Listen: Website und App

@pytest.mark.asyncio
async def test_news_list_per_channel(flow):
    await four(flow)
    flow.act_as(None)
    assert slugs((await flow.get("/api/news", headers=WEB)).json()) == ON_WEB
    assert slugs((await flow.get("/api/news")).json()) == ON_APP, "die App sendet keine Kopfzeile"
    assert slugs((await flow.get("/api/news", headers={"X-LSW-Channel": "app"})).json()) == ON_APP
    paged = (await flow.get("/api/news?compact=true&paged=true", headers=WEB)).json()
    assert slugs(paged["items"]) == ON_WEB and paged["total"] == 3
    assert slugs((await flow.get("/api/news?compact=true")).json()) == ON_APP


@pytest.mark.asyncio
async def test_category_counts_follow_the_channel(flow):
    await four(flow)
    flow.act_as(None)
    web = (await flow.get("/api/news-meta", headers=WEB)).json()["in_use"]
    app = (await flow.get("/api/news-meta")).json()["in_use"]
    assert [row["count"] for row in web if row["k"] == "club"] == [3]
    assert [row["count"] for row in app if row["k"] == "club"] == [3]
    await news(flow, "nurapp2", channels=["app"], category="teams")
    web = (await flow.get("/api/news-meta", headers=WEB)).json()["in_use"]
    app = (await flow.get("/api/news-meta")).json()["in_use"]
    assert "teams" not in {row["k"] for row in web}, "eine Kategorie nur mit App-News steht nicht im Web-Filter"
    assert "teams" in {row["k"] for row in app}


@pytest.mark.asyncio
async def test_home_page_shows_only_web_news(flow):
    await four(flow)
    flow.act_as(None)
    home = (await flow.get("/api/home/state")).json()
    assert slugs(home["news"]) == ON_WEB, "die Startseite der Website ist immer Web - auch ohne Kopfzeile"


@pytest.mark.asyncio
async def test_home_lead_is_never_app_only(flow):
    await news(flow, "beides", channels=["web", "app"], days_ago=3)
    await news(flow, "nurapp", channels=["app"], days_ago=1, pinned=True, pinned_until=(now_utc() + timedelta(days=5)).date().isoformat())
    flow.act_as(None)
    home = (await flow.get("/api/home/state")).json()
    assert [row["slug"] for row in home["news"]][0] == "beides"


@pytest.mark.asyncio
async def test_app_dashboard_shows_only_app_news(flow):
    await four(flow)
    flow.act_as(None)
    dashboard = (await flow.get("/api/mobile/dashboard")).json()
    assert slugs(dashboard["news"]) == ON_APP
    # Auch mit der Web-Kopfzeile bleibt das Dashboard App - es ist nur für die App da.
    assert slugs((await flow.get("/api/mobile/dashboard", headers=WEB)).json()["news"]) == ON_APP


@pytest.mark.asyncio
async def test_search_per_channel(flow):
    await four(flow)
    flow.act_as(None)
    web = (await flow.get("/api/search?q=Kanalprobe&limit=12", headers=WEB)).json()["items"]
    app = (await flow.get("/api/search?q=Kanalprobe&limit=12")).json()["items"]
    assert {row["url"].rsplit("/", 1)[-1] for row in web if row["kind"] == "news"} == ON_WEB
    assert {row["url"].rsplit("/", 1)[-1] for row in app if row["kind"] == "news"} == ON_APP


@pytest.mark.asyncio
async def test_sitemaps_list_only_web_news(flow):
    await four(flow)
    flow.act_as(None)
    for path in ("/api/sitemap.xml", "/api/sitemap-news.xml"):
        xml = (await flow.get(path)).text
        assert "/news/beides<" in xml and "/news/alt<" in xml and "/news/nurweb<" in xml, path
        assert "/news/nurapp" not in xml, path


@pytest.mark.asyncio
async def test_event_page_lists_linked_news_per_channel(flow):
    await flow.db.events.insert_one({"id": "e1", "slug": "lan", "name": "LAN", "status": "scheduled", "visibility": "public",
                                     "start_date": (now_utc() + timedelta(days=5)).isoformat(), "created_at": now_utc().isoformat()})
    await four(flow, linked_event_ids=["e1"])
    flow.act_as(None)
    assert slugs((await flow.get("/api/events/lan", headers=WEB)).json()["news"]) == ON_WEB
    assert slugs((await flow.get("/api/events/lan")).json()["news"]) == ON_APP


@pytest.mark.asyncio
async def test_member_area_counts_news_of_the_channel(flow):
    leser = await flow.add_user(name="leser")
    await flow.db.memberships.insert_one({"id": "m1", "user_id": leser["id"], "member_status": "active"})
    await four(flow, visibility="members")
    flow.act_as(leser)
    assert (await flow.get("/api/membership/area-summary", headers=WEB)).json()["news_new"] == 3
    await flow.db.news_posts.delete_one({"id": "n-nurweb"})
    assert (await flow.get("/api/membership/area-summary", headers=WEB)).json()["news_new"] == 2
    assert (await flow.get("/api/membership/area-summary")).json()["news_new"] == 3


# ---------------------------------------------------------------- Direkter Link

@pytest.mark.asyncio
async def test_web_detail_of_app_only_news_says_lionsapp(flow):
    await four(flow)
    flow.act_as(None)
    res = await flow.get("/api/news/nurapp", headers=WEB)
    assert res.status_code == 404
    detail = res.json()["detail"]
    assert detail["code"] == "app_only" and "LionsAPP" in detail["message"]
    assert "Kanal nurapp" not in res.text, "kein Titel, kein Text"
    for slug in ("beides", "alt", "nurweb"):
        assert (await flow.get(f"/api/news/{slug}", headers=WEB)).status_code == 200, slug


@pytest.mark.asyncio
async def test_app_opens_every_news_by_link(flow):
    """Website-Links auf /news/… öffnen in der App (App-Links) - auch „nur Website“ darf dort nicht brechen."""
    await four(flow)
    flow.act_as(None)
    for slug in sorted(ALL):
        res = await flow.get(f"/api/news/{slug}")
        assert res.status_code == 200, slug
        assert res.json()["slug"] == slug


@pytest.mark.asyncio
async def test_visibility_still_applies_on_top(flow):
    await news(flow, "intern", channels=["app"], visibility="members")
    flow.act_as(None)
    res = await flow.get("/api/news/intern", headers=WEB)
    assert res.status_code == 403, "Gäste erfahren nicht einmal, dass es den Beitrag in der App gibt"
    assert (await flow.get("/api/news/intern")).status_code == 403, "die Sichtbarkeit gilt auch in der App"
    assert slugs((await flow.get("/api/news")).json()) == set()


@pytest.mark.asyncio
async def test_editors_preview_app_only_news_on_the_website(flow):
    await four(flow)
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    res = await flow.get("/api/news/nurapp", headers=WEB)
    assert res.status_code == 200
    assert res.json()["preview"] == {"state": "app_only"}
    assert "preview" not in (await flow.get("/api/news/beides", headers=WEB)).json()
    # Die öffentliche Liste bleibt auch für die Redaktion wie für Gäste.
    assert slugs((await flow.get("/api/news", headers=WEB)).json()) == ON_WEB


@pytest.mark.asyncio
async def test_link_preview_of_app_only_news_is_neutral_and_hidden(flow):
    await four(flow)
    meta = (await flow.get("/api/seo/meta?path=/news/nurapp")).json()
    assert "noindex" in meta["robots"]
    assert "Kanal nurapp" not in str(meta), "kein Titel, kein Text in der Vorschau"
    assert "LionsAPP" in meta["description"]
    shown = (await flow.get("/api/seo/meta?path=/news/beides")).json()
    assert "Kanal beides" in shown["title"] and "noindex" not in shown["robots"]


@pytest.mark.asyncio
async def test_old_address_of_app_only_news_does_not_redirect_on_the_web(flow):
    await news(flow, "neu", channels=["app"], slug_history=["frueher"])
    await news(flow, "neu2", slug_history=["frueher2"])
    res =await flow.get("/api/seo/preview?path=/news/frueher", follow_redirects=False)
    assert res.status_code == 200, "keine Weiterleitung auf die neue Adresse einer App-News"
    moved = await flow.get("/api/seo/preview?path=/news/frueher2", follow_redirects=False)
    assert moved.status_code == 301, "Gegenprobe: eine Web-News wird weitergeleitet"


# ---------------------------------------------------------------- Newsletter, Discord, Meldungen

@pytest.mark.asyncio
async def test_newsletter_never_for_app_only(flow):
    result = await enqueue_newsletter_for_item("news", {"id": "x", "published": True, "visibility": "public", "channels": ["app"]})
    assert result == {"queued": 0, "reason": "app_only"}
    other = await enqueue_newsletter_for_item("news", {"id": "y", "published": True, "visibility": "public", "channels": ["web"]})
    assert other.get("reason") != "app_only"


@pytest.mark.asyncio
async def test_publishing_app_only_marks_newsletter_skipped(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    res = await flow.post("/api/news", json={"title": "Nur in der App", "content": "Text", "published": True, "channels": ["app"]})
    assert res.status_code == 200, res.text
    saved = await flow.db.news_posts.find_one({"id": res.json()["id"]}, {"_id": 0})
    assert saved["channels"] == ["app"]
    assert not saved.get("newsletter_sent_at"), "kein „Newsletter versendet“ für eine App-News"
    await news_publish.finalize_due_news()
    saved = await flow.db.news_posts.find_one({"id": res.json()["id"]}, {"_id": 0})
    assert saved.get("newsletter_skipped_reason") == "app_only"
    assert not saved.get("newsletter_sent_at")


@pytest.mark.asyncio
async def test_new_news_defaults_to_both_and_rejects_empty(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    res = await flow.post("/api/news", json={"title": "Standard", "content": "Text", "published": False})
    assert res.json()["channels"] == ["web", "app"]
    bad = await flow.post("/api/news", json={"title": "Leer", "content": "Text", "published": False, "channels": []})
    assert bad.status_code == 422
    nid = res.json()["id"]
    patched = await flow.patch(f"/api/news/{nid}", json={"channels": ["app", "app"]})
    assert patched.json()["channels"] == ["app"]
    history = (await flow.get(f"/api/admin/news/{nid}")).json()["history"]
    assert "Kanal" in history[0]["fields"]


@pytest.mark.asyncio
async def test_discord_skips_app_only(flow):
    now = now_utc().isoformat()
    assert discord_announcements.skip_reason({"channels": ["app"]}, published_at=now) == "app_only"
    assert discord_announcements.skip_reason({"channels": ["web"]}, published_at=now) is None
    assert discord_announcements.skip_reason({}, published_at=now) is None, "Events und alte News haben kein Feld"


async def _member(flow, name):
    user = await flow.add_user(name=name)
    await flow.db.memberships.insert_one({"id": f"m-{name}", "user_id": user["id"], "member_status": "active"})
    return user


def _capture(monkeypatch):
    sent = {"push": [], "browser": [], "discord": []}

    async def push(doc, *_args):
        sent["push"].append(doc["meta"].get("item_id") or doc["meta"].get("news_id"))
        return 1

    async def browser(doc, *_args):
        sent["browser"].append(doc["meta"].get("item_id") or doc["meta"].get("news_id"))
        return 1

    async def discord(doc, *_args):
        sent["discord"].append(doc["meta"].get("item_id") or doc["meta"].get("news_id"))
        return 1

    async def has_browser(*_args):
        return True

    monkeypatch.setattr("services.push_notifications.send_mobile_push_for_notification", push)
    monkeypatch.setattr("services.web_push.send_web_push_for_notification", browser)
    monkeypatch.setattr("services.web_push.has_browser_subscription", has_browser)
    monkeypatch.setattr("services.discord_dm.send_discord_dm_for_notification", discord)
    return sent


@pytest.mark.asyncio
async def test_member_news_push_per_channel(flow, monkeypatch):
    sent = _capture(monkeypatch)
    paula = await _member(flow, "paula")
    published = (now_utc() - timedelta(minutes=5)).isoformat()
    await four(flow, visibility="members", published_at=published)
    await member_announcements.notify_due()
    await member_announcements.notify_app_news(flow.db)

    assert sorted(sent["push"]) == ["n-alt", "n-beides", "n-nurapp"], "kein App-Push für „nur Website“"
    assert sorted(sent["browser"]) == ["n-alt", "n-beides", "n-nurweb"], "keine Browser-Meldung für „nur App“"
    assert "n-nurapp" not in sent["discord"]

    flow.act_as(paula)
    web_inbox = {row["meta"]["item_id"] for row in (await flow.get("/api/admin/notifications")).json()}
    app_inbox = {row["meta"]["item_id"] for row in (await flow.get("/api/mobile/notifications")).json()}
    assert web_inbox == {"n-alt", "n-beides", "n-nurweb"}
    assert app_inbox == {"n-alt", "n-beides", "n-nurapp"}


@pytest.mark.asyncio
async def test_mentions_follow_the_channel(flow, monkeypatch):
    sent = _capture(monkeypatch)
    # Zwei Personen: Erwähnungen derselben Person haben zehn Minuten Abkühlzeit.
    anna, ben = await flow.add_user(name="anna"), await flow.add_user(name="ben")
    for person in (anna, ben):
        # News & Events per Push (App und Browser) - sonst bliebe die Erwähnung still in der Glocke.
        await flow.db.users.update_one({"id": person["id"]}, {"$set": {"notification_preferences": {"browser": True, **mode_preferences("news_events", "push")}}})
    published = (now_utc() - timedelta(minutes=5)).isoformat()
    await news(flow, "nurapp", channels=["app"], mentioned_user_ids=[anna["id"]], published_at=published)
    await news(flow, "nurweb", channels=["web"], mentioned_user_ids=[ben["id"]], published_at=published)
    await news(flow, "beides", channels=["web", "app"], mentioned_user_ids=[], published_at=published)
    await news_publish.finalize_due_news()
    assert sent["push"] == ["n-nurapp"], "kein App-Push für „nur Website“"
    assert sent["browser"] == ["n-nurweb"], "keine Browser-Meldung für „nur App“"
    flow.act_as(anna)
    assert (await flow.get("/api/admin/notifications")).json() == [], "„nur App“ steht nicht in der Glocke der Website"
    assert {row["meta"]["news_id"] for row in (await flow.get("/api/mobile/notifications")).json()} == {"n-nurapp"}
    flow.act_as(ben)
    assert {row["meta"]["news_id"] for row in (await flow.get("/api/admin/notifications")).json()} == {"n-nurweb"}
    assert (await flow.get("/api/mobile/notifications")).json() == [], "„nur Website“ steht nicht im Postfach der App"


# ---------------------------------------------------------------- App-Push bei „nur App“ (Fabian, 23.11.)
# Eine öffentliche News „nur App“ geht beim Veröffentlichen als App-Push an alle App-Nutzer mit Push-Zustimmung für
# „News & Events“ - genau einmal je Person, über den Minuten-Job der Meldungen. Mitglieder- und interne News „nur App“
# gehen den bestehenden Weg (Meldung an Mitglieder bzw. Vorstand).

async def _app_user(flow, name, *, consent=True, token=True):
    user = await flow.add_user(name=name)
    prefs = mode_preferences("news_events", "push" if consent else "app")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"notification_preferences": prefs}})
    if token:
        await flow.db.mobile_push_tokens.insert_one({"id": f"t-{name}", "user_id": user["id"], "token": f"ExponentPushToken[{name}]", "enabled": True})
    return user


async def _app_pushes(flow):
    rows = await flow.db.notifications.find({"kind": "news_app"}, {"_id": 0}).to_list(100)
    return sorted((row["user_id"], row["meta"]["news_id"]) for row in rows)


@pytest.mark.asyncio
async def test_public_app_only_news_pushes_once_to_app_users_with_consent(flow, monkeypatch):
    sent = _capture(monkeypatch)
    anna = await _app_user(flow, "anna")
    await _app_user(flow, "ben", consent=False)
    await _app_user(flow, "carl", token=False)
    published = (now_utc() - timedelta(minutes=2)).isoformat()
    await four(flow, published_at=published)
    await news(flow, "community", channels=["app"], visibility="community", published_at=published)
    await news(flow, "intern", channels=["app"], visibility="members", published_at=published)
    await news(flow, "geplant", channels=["app"], published_at=(now_utc() + timedelta(days=1)).isoformat())

    await member_announcements.notify_due()
    await member_announcements.notify_app_news(flow.db)
    expected = sorted([(anna["id"], "n-nurapp"), (anna["id"], "n-community")])
    assert await _app_pushes(flow) == expected, "nur mit Token und Zustimmung, nur „nur App“, nichts Geplantes, nichts Internes"
    assert sorted(sent["push"]) == ["n-community", "n-nurapp"]
    assert sent["browser"] == [] and sent["discord"] == [], "nur App-Push"

    # Zweiter Lauf, erneutes Speichern, Zurückziehen und wieder Veröffentlichen: kein zweiter Push.
    await member_announcements.notify_due()
    await member_announcements.notify_app_news(flow.db)
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    assert (await flow.patch("/api/news/n-nurapp", json={"title": "Kanal nurapp neu"})).status_code == 200
    assert (await flow.post("/api/news/n-nurapp/withdraw")).status_code == 200
    assert (await flow.patch("/api/news/n-nurapp", json={"published": True})).status_code == 200
    await member_announcements.notify_due()
    await member_announcements.notify_app_news(flow.db)
    assert await _app_pushes(flow) == expected
    assert sorted(sent["push"]) == ["n-community", "n-nurapp"]

    flow.act_as(anna)
    assert [row for row in (await flow.get("/api/admin/notifications")).json() if row["kind"] == "news_app"] == [], "nicht in der Glocke"
    assert {row["meta"]["news_id"] for row in (await flow.get("/api/mobile/notifications")).json() if row["kind"] == "news_app"} == {"n-nurapp", "n-community"}


@pytest.mark.asyncio
async def test_app_push_only_when_published_as_app_only(flow, monkeypatch):
    sent = _capture(monkeypatch)
    anna = await _app_user(flow, "anna")
    published = (now_utc() - timedelta(minutes=2)).isoformat()
    await news(flow, "beides", channels=["web", "app"], published_at=published)
    await news(flow, "entwurf", channels=["app"], published=False)
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    # Schon öffentlich und erst danach auf „nur App“ gestellt: das ist kein Veröffentlichen - kein Push.
    assert (await flow.patch("/api/news/n-beides", json={"channels": ["app"]})).status_code == 200
    # Gegenprobe: ein Entwurf „nur App“, der jetzt erscheint, geht hinaus.
    assert (await flow.patch("/api/news/n-entwurf", json={"publish_now": True})).status_code == 200
    await member_announcements.notify_due()
    await member_announcements.notify_app_news(flow.db)
    assert await _app_pushes(flow) == [(anna["id"], "n-entwurf")]
    assert sent["push"] == ["n-entwurf"]


# ---------------------------------------------------------------- Aufräumen je Postfach (Prüfung M1)

@pytest.mark.asyncio
async def test_tidying_one_inbox_leaves_the_other_alone(flow):
    anna = await flow.add_user(name="anna")
    base = {"user_id": anna["id"], "kind": "news_member", "title": "x", "read": False, "in_app_visible": True, "created_at": now_utc().isoformat()}
    await flow.db.notifications.insert_many([
        {**base, "id": "nur-app", "meta": {"only_channel": "app"}},
        {**base, "id": "nur-web", "meta": {"only_channel": "web"}},
        {**base, "id": "beides", "meta": {}},
    ])
    flow.act_as(anna)

    async def read_state():
        return {row["id"]: row["read"] for row in await flow.db.notifications.find({}, {"_id": 0, "id": 1, "read": 1}).to_list(10)}

    res = await flow.post("/api/admin/notifications/read-all")
    assert res.status_code == 200
    assert await read_state() == {"nur-app": False, "nur-web": True, "beides": True}, "„Alle gelesen“ im Web lässt die App-Meldung ungelesen"
    res = await flow.delete("/api/admin/notifications/read")
    assert res.status_code == 200
    await flow.db.notifications.update_one({"id": "nur-app"}, {"$set": {"read": True}})
    res = await flow.delete("/api/admin/notifications/read")
    assert res.status_code == 200
    assert await read_state() == {"nur-app": True}, "„Gelesene löschen“ im Web löscht keine App-Meldung"

    await flow.db.notifications.insert_one({**base, "id": "nur-web-2", "meta": {"only_channel": "web"}})
    await flow.db.notifications.update_one({"id": "nur-app"}, {"$set": {"read": False}})
    res = await flow.post("/api/mobile/notifications/read-all")
    assert res.status_code == 200
    assert await read_state() == {"nur-app": True, "nur-web-2": False}, "„Alle gelesen“ in der App lässt die Web-Meldung ungelesen"


# ---------------------------------------------------------------- Link-Vorschau: Sichtbarkeit vor Kanal (Prüfung K2)

@pytest.mark.asyncio
async def test_link_preview_checks_visibility_before_channel(flow):
    await news(flow, "intern", channels=["app"], visibility="members", share_preview=True)
    meta = (await flow.get("/api/seo/meta?path=/news/intern")).json()
    assert "nur für Mitglieder" in meta["description"], "erst die Karte „nur für Mitglieder“, nicht „gibt es in der LionsAPP“"
    assert "noindex" in meta["robots"]
    assert "Kanal intern" not in str(meta), "auch mit Freigabe fürs Teilen kein Titel einer News nur für die App"


@pytest.mark.asyncio
async def test_app_push_waits_for_quiet_hours(flow, monkeypatch):
    """Ruhezeit gilt auch hier: die Meldung liegt sofort im Postfach, der Push wartet bis zum Ende der Ruhezeit."""
    from zoneinfo import ZoneInfo

    sent = _capture(monkeypatch)
    dora = await _app_user(flow, "dora")
    here = now_utc().astimezone(ZoneInfo("Europe/Vienna"))
    window = {"enabled": True, "start": (here - timedelta(hours=1)).strftime("%H:%M"), "end": (here + timedelta(hours=1)).strftime("%H:%M")}
    await flow.db.users.update_one({"id": dora["id"]}, {"$set": {"quiet_hours": window}})
    await news(flow, "nurapp", channels=["app"], published_at=(now_utc() - timedelta(minutes=2)).isoformat())
    await member_announcements.notify_app_news(flow.db)
    row = await flow.db.notifications.find_one({"kind": "news_app", "user_id": dora["id"]}, {"_id": 0})
    assert row and row.get("quiet_hold_until") and row.get("quiet_held_channels") == ["push"]
    assert sent["push"] == []
