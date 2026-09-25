"""YouTube-Videos als News (#578): Handle einmal auflösen, erster Abruf nur merken, danach jedes neue
Video genau einmal als News (Entwurf oder veröffentlicht), Shorts wahlweise, Fehler im Klartext -
alles mit nachgestelltem YouTube."""
import pathlib
import sys

import httpx
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import discord_bot, youtube_feed  # noqa: E402

CHANNEL = "UCabcdefghijklmnopqrstuv"
HANDLE_URL = "https://www.youtube.com/@TheLionSquadeSports"
FEED = "https://www.youtube.com/feeds/videos.xml?channel_id=" + CHANNEL


def entry(video_id: str, title: str, published: str, description: str = "") -> str:
    return f"""
  <entry>
    <id>yt:video:{video_id}</id>
    <yt:videoId>{video_id}</yt:videoId>
    <yt:channelId>{CHANNEL}</yt:channelId>
    <title>{title}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v={video_id}"/>
    <published>{published}</published>
    <media:group>
      <media:title>{title}</media:title>
      <media:thumbnail url="https://i4.ytimg.com/vi/{video_id}/hqdefault.jpg" width="480" height="360"/>
      <media:description>{description}</media:description>
    </media:group>
  </entry>"""


def feed(*entries: str) -> str:
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" '
            'xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">\n<title>THE LION SQUAD</title>'
            + "".join(entries) + "\n</feed>")


class FakeYoutube:
    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.shorts: set[str] = set()
        self.channel_ok = True
        self.feed_text = feed(entry("aaaaaaaaaaa", "Sommer-Cup Finale", "2026-09-01T18:00:00+00:00", "Das Finale in voller Länge.\nMit Kommentar."))

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.calls.append((request.method, url))
        if url == HANDLE_URL:
            if not self.channel_ok:
                return httpx.Response(404, text="<html>nicht da</html>")
            return httpx.Response(200, text='<html><head><meta itemprop="identifier" content="' + CHANNEL + '"><script>var x = {"channelId":"' + CHANNEL + '"}</script></head></html>')
        if url == FEED:
            return httpx.Response(200, text=self.feed_text)
        if url.startswith("https://www.youtube.com/shorts/"):
            video_id = url.rsplit("/", 1)[-1]
            return httpx.Response(200 if video_id in self.shorts else 303, headers={} if video_id in self.shorts else {"Location": f"https://www.youtube.com/watch?v={video_id}"})
        return httpx.Response(404, text="nicht da")


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeYoutube()
    monkeypatch.setattr(youtube_feed, "_transport", httpx.MockTransport(instance.handle))
    return instance


async def as_admin(flow):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "youtube_url": HANDLE_URL}}, upsert=True)
    return admin


def test_feed_parsing_and_url_helpers():
    entries = youtube_feed.parse_feed(feed(entry("bbbbbbbbbbb", "Neu", "2026-09-05T10:00:00+00:00"), entry("aaaaaaaaaaa", "Alt", "2026-09-01T10:00:00+00:00", "Text")))
    assert [row["video_id"] for row in entries] == ["aaaaaaaaaaa", "bbbbbbbbbbb"], "älteste zuerst"
    assert entries[0]["url"] == "https://www.youtube.com/watch?v=aaaaaaaaaaa" and entries[0]["thumbnail_url"].endswith("/hqdefault.jpg") and entries[0]["description"] == "Text"
    assert youtube_feed.channel_id_from_url("https://www.youtube.com/channel/" + CHANNEL + "/videos") == CHANNEL
    assert youtube_feed.channel_id_from_url(HANDLE_URL) == ""
    assert youtube_feed.is_youtube_url("youtube.com/@lions") and youtube_feed.is_youtube_url(HANDLE_URL) and not youtube_feed.is_youtube_url("https://example.com/@lions")
    assert youtube_feed.excerpt_of("") == youtube_feed.DEFAULT_EXCERPT and youtube_feed.excerpt_of("x" * 400).endswith("…")
    with pytest.raises(youtube_feed.YoutubeError):
        youtube_feed.parse_feed("<kaputt")


@pytest.mark.asyncio
async def test_first_run_only_remembers_then_new_videos_become_drafts_once(flow, fake):
    await as_admin(flow)
    before = (await flow.get("/api/settings/youtube")).json()
    assert before["enabled"] is False and before["publish"] is False and before["branding_url"] == HANDLE_URL and before["channel_id"] == ""

    assert (await youtube_feed.sync(flow.db))["skipped"] == "disabled", "aus = kein Abruf"
    assert fake.calls == []

    fetched = (await flow.post("/api/settings/youtube/fetch")).json()
    assert fetched["result"]["baseline"] is True and fetched["result"]["created"] == 0 and fetched["result"]["seen"] == 1, fetched
    assert fetched["channel_id"] == CHANNEL and fetched["last_video"]["title"] == "Sommer-Cup Finale" and fetched["videos_seen"] == 1
    assert await flow.db.news_posts.count_documents({}) == 0, "der erste Abruf legt keine News an"
    assert sum(1 for _m, url in fake.calls if url == HANDLE_URL) == 1

    fake.feed_text = feed(entry("bbbbbbbbbbb", "Ranked Grind mit Paula", "2026-09-10T18:00:00+00:00", "Zweite Folge.\n\nViel Spaß!"),
                          entry("aaaaaaaaaaa", "Sommer-Cup Finale", "2026-09-01T18:00:00+00:00"))
    assert (await flow.put("/api/settings/youtube", json={"enabled": True})).status_code == 200
    result = await youtube_feed.sync(flow.db)
    assert result["created"] == 1 and result["baseline"] is False, result
    assert sum(1 for _m, url in fake.calls if url == HANDLE_URL) == 1, "das Handle wird nur einmal aufgelöst"
    post = await flow.db.news_posts.find_one({"youtube_video_id": "bbbbbbbbbbb"}, {"_id": 0})
    assert post["published"] is False and post["category"] == "video" and post["title"] == "Ranked Grind mit Paula"
    assert post["video_url"] == "https://www.youtube.com/watch?v=bbbbbbbbbbb" and post["banner_url"].endswith("/bbbbbbbbbbb/hqdefault.jpg")
    assert post["excerpt"] == "Zweite Folge." and "[Auf YouTube ansehen](https://www.youtube.com/watch?v=bbbbbbbbbbb)" in post["content"]
    assert post["slug"] == "ranked-grind-mit-paula" and post["author_name"] == "YouTube" and post["source"] == "youtube"

    again = await youtube_feed.sync(flow.db)
    assert again["created"] == 0 and again["seen"] == 0, "nie doppelt"
    assert await flow.db.news_posts.count_documents({}) == 1
    status = (await flow.get("/api/settings/youtube")).json()
    assert status["news_created"] == 1 and status["videos_seen"] == 2 and status["last_error"] is None


@pytest.mark.asyncio
async def test_publish_switch_publishes_and_discord_announces_it(flow, fake, monkeypatch):
    posted = []

    async def fake_send_embed(channel_id, embed):
        posted.append({"channel_id": channel_id, "embed": embed})
        return {"ok": True, "message_id": "m1", "channel_id": channel_id}

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "send_embed", fake_send_embed)
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    await as_admin(flow)
    await flow.put("/api/settings/discord", json={"channels": {"news": "100000000000000002"}, "events": {"news.published": True},
                                                  "bot_token": "test" * 6 + ".fake." + "token" * 8, "bot_enabled": True})
    await flow.post("/api/settings/youtube/fetch")  # erster Abruf: nur merken
    saved = (await flow.put("/api/settings/youtube", json={"enabled": True, "publish": True})).json()
    assert saved["publish"] is True

    fake.feed_text = feed(entry("ccccccccccc", "Neues Video", "2026-09-12T18:00:00+00:00", "Beschreibung"), entry("aaaaaaaaaaa", "Sommer-Cup Finale", "2026-09-01T18:00:00+00:00"))
    assert (await youtube_feed.sync(flow.db))["created"] == 1
    post = await flow.db.news_posts.find_one({"youtube_video_id": "ccccccccccc"}, {"_id": 0})
    assert post["published"] is True and post["published_at"]

    public = (await flow.get(f"/api/news/{post['slug']}")).json()
    assert public["video_url"] == "https://www.youtube.com/watch?v=ccccccccccc" and public["category"] == "video"

    from services.discord_announcements import announce_due
    outcome = await announce_due()
    assert outcome["outcomes"].get("sent") == 1, outcome
    assert len(posted) == 1 and posted[0]["channel_id"] == "100000000000000002" and posted[0]["embed"]["title"] == "📰 Neues Video"


@pytest.mark.asyncio
async def test_shorts_are_skipped_unless_wanted_and_errors_are_plain_text(flow, fake):
    await as_admin(flow)
    await flow.post("/api/settings/youtube/fetch")
    await flow.put("/api/settings/youtube", json={"enabled": True})
    fake.shorts.add("sssssssssss")
    fake.feed_text = feed(entry("sssssssssss", "Kurz #shorts", "2026-09-12T18:00:00+00:00"), entry("aaaaaaaaaaa", "Sommer-Cup Finale", "2026-09-01T18:00:00+00:00"))
    result = await youtube_feed.sync(flow.db)
    assert result["created"] == 0 and result["skipped_shorts"] == 1
    assert (await flow.db.youtube_videos.find_one({"video_id": "sssssssssss"}, {"_id": 0}))["outcome"] == "short_skipped"

    await flow.put("/api/settings/youtube", json={"include_shorts": True})
    fake.shorts.add("ttttttttttt")
    fake.feed_text = feed(entry("ttttttttttt", "Noch ein Short", "2026-09-13T18:00:00+00:00"), entry("sssssssssss", "Kurz #shorts", "2026-09-12T18:00:00+00:00"))
    assert (await youtube_feed.sync(flow.db))["created"] == 1, "mit Schalter werden Shorts News"
    assert not any(url.startswith("https://www.youtube.com/shorts/ttttttttttt") for _m, url in fake.calls), "mit Schalter wird nicht einmal nachgefragt"

    bad = await flow.put("/api/settings/youtube", json={"channel_url": "https://example.com/kanal"})
    assert bad.status_code == 400 and "YouTube" in bad.json()["detail"]
    other = (await flow.put("/api/settings/youtube", json={"channel_url": "https://www.youtube.com/@AndererKanal"})).json()
    assert other["channel_url"] == "https://www.youtube.com/@AndererKanal" and other["channel_id"] == "", "neue Adresse = Kanal-ID neu ermitteln"
    fake.channel_ok = False
    fake.calls.clear()
    broken = (await flow.post("/api/settings/youtube/fetch")).json()
    assert broken["result"]["error"] and "Kanal" in broken["result"]["error"] and broken["last_error"] == broken["result"]["error"]
    assert broken["result"]["created"] == 0

    player = await flow.add_user(role="player", name="paula")
    flow.act_as(player)
    assert (await flow.get("/api/settings/youtube")).status_code in (401, 403)
    assert (await flow.post("/api/settings/youtube/fetch")).status_code in (401, 403)
