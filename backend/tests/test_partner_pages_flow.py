"""Partnerseiten (#469 Teil 1): ein Partner bekommt eine eigene Seite mit Kanälen, Twitch-Live-Stand
(über die Helix-App der Website), Discord-Widget (nur wenn der Partner es eingeschaltet hat), Tools
und den News, in denen er genannt wird. Alte Slugs leiten weiter, inaktive Partner sind unsichtbar."""
import pathlib
import sys

import httpx
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import dolibarr_sponsors, partner_pages  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


class FakeServices:
    """Antwortet wie Twitch (Streams) und das Discord-Widget - und zählt die Anfragen."""

    def __init__(self):
        self.calls = []
        self.live = True
        self.widget = True

    def handle(self, request):
        url = str(request.url)
        self.calls.append(url)
        if url.startswith("https://api.twitch.tv/helix/streams"):
            assert request.headers.get("Client-ID") == "cid"
            assert request.headers.get("Authorization") == "Bearer tok"
            data = [{
                "id": "1", "user_login": "pineapps", "title": "TFT Ranked Grind", "viewer_count": 23, "game_name": "Teamfight Tactics",
                "thumbnail_url": "https://static-cdn.jtvnw.net/previews-ttv/live_user_pineapps-{width}x{height}.jpg", "started_at": "2026-09-24T09:00:00Z",
            }] if self.live else []
            return httpx.Response(200, json={"data": data})
        if url.startswith("https://discord.com/api/guilds/"):
            if not self.widget:
                return httpx.Response(403, json={"code": 50004, "message": "Widget Disabled"})
            return httpx.Response(200, json={"id": "123456789012345678", "name": "PineApps", "instant_invite": "https://discord.gg/pine", "presence_count": 12, "members": []})
        return httpx.Response(404, json={"error": "unexpected"})

    def transport(self):
        return httpx.MockTransport(self.handle)


@pytest.fixture
def fake(monkeypatch):
    instance = FakeServices()
    monkeypatch.setattr(partner_pages, "_transport", instance.transport())
    partner_pages.reset_cache()
    return instance


async def _twitch_app(flow):
    await flow.db.settings.update_one(
        {"id": "branding"},
        {"$set": {"id": "branding", "twitch_client_id": "cid", "twitch_client_secret": encrypt_secret("sec"), "twitch_live_detection": True}},
        upsert=True,
    )
    await flow.db.settings.update_one(
        {"id": "twitch_app_token"},
        {"$set": {"id": "twitch_app_token", "access_token": encrypt_secret("tok"), "expires_at": "2099-01-01T00:00:00+00:00"}},
        upsert=True,
    )


PARTNER = {
    "name": "PineApps TFT", "kind": "Community", "link": "pineapps.at", "description": "TFT-Community aus Tirol.",
    "about": "Spielt viel TFT und baut Tools dafür.", "since": "2025",
    "discord_invite": "pine", "discord_guild_id": "123456789012345678", "twitch_channel": "https://www.twitch.tv/PineApps",
    "youtube_url": "https://youtube.com/@pineapps",
    "tools": [{"title": "TFT Dashboard", "url": "tft.pineapps.at", "description": "Ranglisten und Statistiken", "embed": True}],
}


@pytest.mark.asyncio
async def test_partner_page_shows_channels_live_widget_tools_and_news(flow, fake):
    await _twitch_app(flow)
    admin = await flow.add_user(role="superadmin", name="Admin")
    flow.act_as(admin)
    created = (await flow.post("/api/partners", json=PARTNER)).json()
    assert created["slug"] == "pineapps-tft"
    assert created["link"] == "https://pineapps.at"
    assert created["twitch_channel"] == "pineapps"
    assert created["discord_invite"] == "https://discord.gg/pine"
    tool = created["tools"][0]
    assert tool["url"] == "https://tft.pineapps.at" and tool["id"] and tool["embed"] is True
    await flow.db.news_posts.insert_one({
        "id": "n1", "slug": "tft-abend", "title": "TFT-Abend mit PineApps TFT", "excerpt": "Gemeinsam ranken.", "content": "Text",
        "published": True, "published_at": "2026-09-01T10:00:00+00:00", "created_at": "2026-09-01T10:00:00+00:00",
        "visibility": "public", "category": "events",
    })
    await flow.db.news_posts.insert_one({
        "id": "n2", "slug": "entwurf", "title": "Entwurf über PineApps TFT", "content": "", "published": False,
        "created_at": "2026-09-02T10:00:00+00:00", "visibility": "public",
    })

    flow.act_as(None)
    listed = (await flow.get("/api/partners")).json()
    assert [p["slug"] for p in listed] == ["pineapps-tft"]
    assert [c["key"] for c in listed[0]["channels"]] == ["website", "discord", "twitch", "youtube"]
    assert listed[0]["channels"][2] == {"key": "twitch", "label": "Twitch", "url": "https://www.twitch.tv/pineapps", "handle": "pineapps"}
    assert "contact_email" not in listed[0]

    page = (await flow.get("/api/partners/pineapps-tft")).json()
    assert page["name"] == "PineApps TFT" and page["redirected"] is False
    assert page["twitch"]["live"] is True and page["twitch"]["viewer_count"] == 23
    assert page["twitch"]["thumbnail_url"].endswith("640x360.jpg")
    assert page["discord"]["enabled"] is True and page["discord"]["online"] == 12
    assert page["discord"]["invite"] == "https://discord.gg/pine" and page["discord"]["name"] == "PineApps"
    assert page["tools"][0]["title"] == "TFT Dashboard"
    assert [n["slug"] for n in page["news"]] == ["tft-abend"]
    twitch_calls = [u for u in fake.calls if "helix/streams" in u]
    assert len(twitch_calls) == 1 and "user_login=pineapps" in twitch_calls[0]

    # Kurzspeicher: der zweite Aufruf fragt Twitch und Discord nicht noch einmal.
    again = (await flow.get("/api/partners/pineapps-tft")).json()
    assert again["twitch"]["live"] is True and again["discord"]["online"] == 12
    assert len(fake.calls) == 2

    # Widget aus beim Partner: nur die Einladung bleibt.
    fake.widget = False
    partner_pages.reset_cache()
    page = (await flow.get("/api/partners/pineapps-tft")).json()
    assert page["discord"]["enabled"] is False and "online" not in page["discord"]

    assert (await flow.get("/api/partners/gibtsnicht")).status_code == 404


@pytest.mark.asyncio
async def test_without_twitch_app_the_page_only_links_and_old_slugs_redirect(flow, fake):
    admin = await flow.add_user(role="superadmin", name="Admin")
    flow.act_as(admin)
    created = (await flow.post("/api/partners", json={"name": "Gamers Heaven", "twitch_channel": "gamersheaven"})).json()
    pid = created["id"]
    flow.act_as(None)
    page = (await flow.get("/api/partners/gamers-heaven")).json()
    assert page["twitch"]["configured"] is False and page["twitch"]["live"] is False
    assert page["discord"] is None
    assert not fake.calls

    flow.act_as(admin)
    renamed = (await flow.patch(f"/api/partners/{pid}", json={"slug": "heaven"})).json()
    assert renamed["slug"] == "heaven" and renamed["slug_history"] == ["gamers-heaven"]
    unchanged = (await flow.patch(f"/api/partners/{pid}", json={"slug": "heaven", "description": "Messe in Tirol"})).json()
    assert unchanged["slug"] == "heaven" and unchanged["description"] == "Messe in Tirol"
    flow.act_as(None)
    old = (await flow.get("/api/partners/gamers-heaven")).json()
    assert old["slug"] == "heaven" and old["redirected"] is True

    flow.act_as(admin)
    await flow.patch(f"/api/partners/{pid}", json={"is_active": False})
    flow.act_as(None)
    assert (await flow.get("/api/partners/heaven")).status_code == 404
    assert (await flow.get("/api/partners")).json() == []


@pytest.mark.asyncio
async def test_bad_fields_are_rejected_with_a_reason(flow):
    admin = await flow.add_user(role="superadmin", name="Admin")
    flow.act_as(admin)
    bad_guild = await flow.post("/api/partners", json={"name": "X", "discord_guild_id": "pine"})
    assert bad_guild.status_code == 400 and "Server-ID" in bad_guild.json()["detail"]
    bad_twitch = await flow.post("/api/partners", json={"name": "X", "twitch_channel": "kein kanal!"})
    assert bad_twitch.status_code == 400 and "Twitch-Kanal" in bad_twitch.json()["detail"]
    bad_tool = await flow.post("/api/partners", json={"name": "X", "tools": [{"title": "", "url": "https://x.test"}]})
    assert bad_tool.status_code == 400 and "Titel fehlt" in bad_tool.json()["detail"]
    bad_url = await flow.post("/api/partners", json={"name": "X", "youtube_url": "nur-text"})
    assert bad_url.status_code == 400 and "YouTube" in bad_url.json()["detail"]
    assert await flow.db.partners.count_documents({}) == 0


@pytest.mark.asyncio
async def test_partners_from_dolibarr_and_from_before_get_a_slug(flow):
    await flow.db.partners.insert_one({"id": "alt", "name": "Alter Partner", "is_active": True, "kind": "verein", "order_index": 0})
    result = await dolibarr_sponsors.apply_partners(flow.db, {
        7: {"dolibarr_id": 7, "name": "Gamma Verein", "kind": "partner", "link": "https://gamma.test", "partner_kind": "Verein", "closed": False},
    })
    assert result["created"] == 1
    flow.act_as(None)
    listed = (await flow.get("/api/partners")).json()
    assert sorted(p["slug"] for p in listed) == ["alter-partner", "gamma-verein"]
    assert (await flow.db.partners.find_one({"id": "alt"}, {"_id": 0, "slug": 1}))["slug"] == "alter-partner"


@pytest.mark.asyncio
async def test_partners_at_events_and_tournaments_show_up_on_both_sides(flow):
    """Teil 2: ein Partner am Event oder Turnier - die Seite nennt ihn, die Partnerseite zeigt beides
    unter „Gemeinsam“; unbekannte Partner fallen weg, Entwürfe erscheinen nicht."""
    await flow.db.games.insert_one({"id": "g1", "name": "Teamfight Tactics", "slug": "tft"})
    admin = await flow.add_user(role="superadmin", name="Admin")
    flow.act_as(admin)
    partner = (await flow.post("/api/partners", json={"name": "PineApps eSports"})).json()
    event = (await flow.post("/api/events", json={"name": "TFT-Abend", "status": "scheduled", "visibility": "public", "start_date": "2026-11-05T18:00:00+00:00", "partner_ids": [partner["id"], "gibtsnicht"]})).json()
    assert event["partner_ids"] == [partner["id"]]
    await flow.post("/api/events", json={"name": "Geheimplan", "status": "draft", "visibility": "public", "partner_ids": [partner["id"]]})
    tournament = (await flow.post("/api/tournaments", json={
        "title": "TFT Open", "game_id": "g1", "status": "registration_open", "visibility": "public", "is_public": True,
        "format": "single_elim", "team_mode": "solo", "team_size": 1, "max_participants": 8,
        "start_date": "2026-12-01T18:00:00+00:00", "partner_ids": [partner["id"]],
    })).json()
    assert tournament["partner_ids"] == [partner["id"]]
    cleared = (await flow.patch(f"/api/tournaments/{tournament['id']}", json={"partner_ids": ["gibtsnicht"]})).json()
    assert cleared["partner_ids"] == []
    restored = (await flow.patch(f"/api/tournaments/{tournament['id']}", json={"partner_ids": [partner["id"]]})).json()
    assert restored["partner_ids"] == [partner["id"]]
    changed = (await flow.patch(f"/api/events/{event['id']}", json={"partner_ids": [partner["id"], partner["id"]]})).json()
    assert changed["partner_ids"] == [partner["id"]]

    flow.act_as(None)
    event_page = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert [p["slug"] for p in event_page["partners"]] == ["pineapps-esports"]
    tournament_page = (await flow.get(f"/api/tournaments/{tournament['slug']}")).json()
    assert [p["name"] for p in tournament_page["partners"]] == ["PineApps eSports"]
    shared = (await flow.get("/api/partners/pineapps-esports")).json()["shared"]
    assert [e["slug"] for e in shared["events"]] == [event["slug"]]
    assert [t["slug"] for t in shared["tournaments"]] == [tournament["slug"]]
    assert shared["tournaments"][0]["game"]["name"] == "Teamfight Tactics"


@pytest.mark.asyncio
async def test_references_belong_to_the_partner_by_tick_or_organizer(flow):
    """Teil 3: eine Referenz gehört zum Partner per Haken oder weil er als Veranstalter steht; nicht-öffentliche
    Referenzen sieht ein Gast auch auf der Partnerseite nicht; die Referenz selbst nennt den Partner."""
    admin = await flow.add_user(role="superadmin", name="Admin")
    flow.act_as(admin)
    partner = (await flow.post("/api/partners", json={"name": "PineApps eSports"})).json()
    entry = [{"kind": "solo", "placement": 2, "lineup": ["Anni"]}]
    ticked = (await flow.post("/api/references", json={"title": "TFT Cup", "organizer": "ESL", "start_date": "2026-05-01", "partner_ids": [partner["id"], "gibtsnicht"], "entries": entry})).json()
    assert ticked["partner_ids"] == [partner["id"]] and [p["slug"] for p in ticked["partners"]] == ["pineapps-esports"]
    by_name = (await flow.post("/api/references", json={"title": "PineApps Open", "organizer": "PineApps eSports", "start_date": "2026-06-01", "entries": entry})).json()
    assert by_name["partner_ids"] == [] and by_name["partners"] == []
    await flow.post("/api/references", json={"title": "Intern", "organizer": "PineApps eSports", "visibility": "members", "entries": entry})
    await flow.post("/api/references", json={"title": "Anderes", "organizer": "ESL", "entries": entry})

    flow.act_as(None)
    listed = (await flow.get("/api/references")).json()["items"]
    assert [p["name"] for p in next(item for item in listed if item["id"] == ticked["id"])["partners"]] == ["PineApps eSports"]
    shared = (await flow.get("/api/partners/pineapps-esports")).json()["shared"]
    assert [(r["title"], r["matched_by"], r["placement"]) for r in shared["references"]] == [("PineApps Open", "organizer", 2), ("TFT Cup", "partner", 2)]
